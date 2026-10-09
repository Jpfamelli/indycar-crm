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
