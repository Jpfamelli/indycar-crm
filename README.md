# IndyCar CRM

Servidor Node puro e interface em `public/`. Produção: https://indycar-crm.onrender.com.

Execute `npm.cmd start` no Windows (ou `npm start`). O servidor exige Supabase Auth e perfil ativo para as rotas privadas. A configuração fica no ambiente; nunca publique `.env`.

Para testar sem clientes ou credenciais reais:

1. `npm.cmd test` executa funções puras e o servidor real com banco e autenticação simulados.
2. `npm.cmd run mock` abre a interface real em http://127.0.0.1:3101 com login fictício.
3. As alterações no mock ficam somente em memória e desaparecem quando o processo termina.

O mock não lê `.env`, não chama Supabase e não envia mensagens. Para conferir: pesquisar telefone com +55, ordenar/exportar leads, abrir ficha, salvar aniversário/preferência, movimentar etapa no funil e alternar tema; conferir desktop e 375 px.

Aniversário usa `clientes.nascimento`; 1904 representa ano desconhecido. A preferência usa `clientes.aceita_mensagens` e sua data de alteração. Nenhuma migração acompanha esta rodada.

O Render acompanha `main`. Após publicar, conferir a versão v3 de `/sw.js`, os módulos da interface e HTTP 401 de `/api/leads` e `/api/saude` sem autenticação.

## IA do CRM

A IA lê a ficha inteira do cliente (lead, cliente 360, conversa e últimas mensagens do WhatsApp, Agenda, Orçador, Comunicar e satisfação) e **propõe**; a pessoa clica. Tudo fica em `ia_acoes` (origem `crm`) e segue `ia_config` (ligada/desligada, modelos, autonomia, limite diário).

- **Próxima ação** (ligar, mensagem com texto pronto, agendar, cobrar orçamento, mudar etapa, marcar perdido com motivo) com prioridade e justificativa.
- **Qualificar**: quente/morno/frio + chance de fechar + motivo.
- **Preencher pela conversa**: carro, ano, placa, serviço (só do catálogo) e origem; no modo automático preenche sozinha só campo vazio (origem sempre com clique).
- **Triagem**: leads parados (novo/contato 3+ dias, orçamento sem resposta, em serviço 7+ dias, agendado sem novidade) com proposta por lead; funciona pelas regras mesmo sem IA; ações em lote.
- **Pergunte ao CRM**: o servidor monta um JSON agregado (contagens, métricas por origem/mês, listas curtas sem telefone) e a IA responde só com ele. Nenhum SQL vem da IA.
- **Resumo semanal/mensal** (`POST /api/resumo-ia {periodo:'semana'|'mes'}`) no `modelo_forte`, com Atendimento, Comunicar e Orçador.

Regras: texto do cliente vai cercado por marca aleatória (é dado, não instrução); a IA não vê valores em R$ nem telefone; texto com preço é descartado e o vocabulário proibido é trocado; mensagem nunca é enviada (a tela copia o texto e abre a conversa no Atendimento); concluído/perdido sempre pedem confirmação; "Executar" confere se o lead mudou desde a proposta (409) e "Desfazer" volta o que foi aplicado.

Rotas (login): `GET /api/ia/lead/:id/contexto`, `POST /api/ia/lead/:id/proxima-acao|qualificar|preencher`, `POST /api/ia/triagem {dias,limite,usarIA}`, `POST /api/ia/perguntar {pergunta}`, `POST /api/ia/acoes/:id/executar {confirmarFaturamento}|recusar {motivo}|desfazer`, `POST /api/ia/acoes/executar-lote {ids,confirmarFaturamento}`, `GET /api/ia/acoes?leadId=&limite=`, `GET /api/ia/uso`, `GET /api/lead-por-telefone?t=` (ou `?tel=`). `/api/saude` traz `ia`. Freio: 40 pedidos à IA por pessoa a cada 10 min.

Código: `lib/contexto-lead.js` (ficha), `lib/metricas.js` (números puros), `lib/ia-crm.js` (IA injetável), `public/crm-ia.js` + `.css` (tela, pluga nos slots `#iaSlotLead`, `#iaSlotPainel`, `#iaSlotTela`; sem slot vira botão "✨ IA"). Testes: `testes/ia-crm.test.cjs` e `testes/server-ia.test.cjs` com banco em memória e IA falsa roteirizada (`testes/ia-fake-sb.cjs`) — nenhum gasto de API. Links de saída podem ser trocados por `CRM_URL_ATENDIMENTO`, `CRM_URL_AGENDA`, `CRM_URL_COMUNICAR`, `CRM_URL_ORCADOR`.

## Rodada 3 — equipe, tarefas, automações e segurança (servidor)

**Acesso.** Toda rota `/api` (menos `config` e `primeiro-acesso`) exige token do Supabase Auth, perfil ativo, papel `admin|gestor|atendente` e `crm` em `perfis.apps` (admin sempre). Recusas: 401 `{codigo:'sem_login'|'sessao_expirada'|'sessao_invalida'|'desativado'}`, 403 `{codigo:'sem_acesso_app', apps:[{app,url}]}` ou `'sem_perfil'`, 503 `'indisponivel'` (Auth fora — a tela não desloga). O último acesso (`ultimo_acesso_em`, `ultimo_app='crm'`) é gravado no máximo a cada 5 min. Desativar, mudar papel ou apps corta na hora (o cache de 60 s é esquecido). `GET /api/eu` devolve perfil, apps, `precisa_trocar_senha`, `outrosApps` e `pode` (o que a tela deve mostrar).

**Equipe e leads.** `leads.responsavel_id` em tudo: `GET /api/leads?minhas=1|responsavel=eu|nenhum|<uuid>`, `GET /api/vendedores`, `PATCH /api/leads/:id/responsavel`, `POST /api/leads/responsavel-lote` (gestor), `POST /api/rodizio` (gestor; o automático pega só leads novos sem dono das últimas 48 h, por menor carga, respeitando `recebe_leads` e o app `crm`), `GET /api/desempenho?mes=|dias=`, `GET /api/ranking`, `GET/PUT /api/metas` (gestor grava; progresso, projeção e risco). Apagar lead é só de gestor.

**Tarefas** (tabela `tarefas`, substituem os lembretes do navegador): `GET /api/tarefas?minhas=1&lead=&cliente=&status=&responsavel=`, `POST /api/tarefas`, `PATCH|DELETE /api/tarefas/:id`. A IA ganhou `criar_tarefa` na próxima ação e a triagem vira tarefas (`POST /api/ia/triagem/tarefas`, ou sozinha no modo `automatico`).

**Automações** (servidor, a cada `CRM_AUTOMACOES_MIN` min; trava no banco `crm_pegar_trava` para não duplicar): rodízio, lead novo sem contato em 2 h → notificação ao responsável (sem dono: gestores), orçamento sem resposta em 3 dias → tarefa, lead parado 14 dias → sugestão de perdido em `ia_acoes` (`crm_sugestao_perdido`, nada muda sozinho), meta do mês em risco → notificação aos gestores (1×/semana). O Render gratuito dorme: um agendador externo pode chamar `POST /api/automacoes/rodar` com o cabeçalho `x-agendador-token: $CRM_AGENDADOR_TOKEN`. `GET /api/automacoes` (gestor) mostra a última volta. Histórico em `crm_automacoes_execucoes`.

**Segurança.** CSP (página com hash dos `<script>` embutidos; API `default-src 'none'`), `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy, HSTS, COOP; CORS só do ecossistema; corpo JSON-objeto obrigatório (415/400), 64 KB; freio por IP, por pessoa e por rota cara; 40 tokens recusados por IP em 10 min = espera; erros sem detalhe interno; auditoria (`registrar_auditoria`) em exportar CSV (`POST /api/auditoria/exportacao`), fechamento/reabertura, valores, apagar, reatribuir, metas, equipe, integrações, investimento, catálogo e ações da IA; `GET /api/auditoria` (admin). `npm run segredos` varre o repositório; `npm run auditar` = `npm audit` (alta/crítica); `npm run verificar` = testes + segredos + audit.

Variáveis novas (todas opcionais): `CRM_AUTOMACOES=0` desliga as automações, `CRM_AUTOMACOES_MIN` (padrão 15), `CRM_AGENDADOR_TOKEN`, `CRM_RODIZIO=0` desliga o rodízio automático, `CRM_CORS_EXTRA` (origens a mais, separadas por vírgula), `CRM_ATRAS_DE_PROXY=1` (fora do Render).

Código: `lib/acesso.js`, `lib/equipe-crm.js`, `lib/tarefas.js`, `lib/automacoes.js`, `lib/auditoria.js`, `lib/seguranca.js`, `lib/rotas.js`, `lib/util-servidor.js`; SQL em `scripts/sql/crm_automacoes_travas.sql`. Testes: `testes/servidor-falso.cjs` sobe o `server.js` real com o `db-supabase.js` real sobre banco em memória e uma pessoa de cada papel (admin, gestor, atendente, agenda, sem app, desativado, troca de senha).
