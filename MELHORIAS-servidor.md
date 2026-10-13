# CRM — servidor, IA e segurança · Rodada 3 (13/10/2026)

Só o que ficou feito e verificado (testes `node --test`, servidor real local em leitura, Chrome).

## Acesso e login
1. Porteiro novo (`lib/acesso.js`): exige perfil ativo, papel da equipe (admin, gestor ou atendente) e `crm` em `perfis.apps`; admin sempre entra.
2. Recusas com código: 401 `sem_login`, `sessao_expirada`, `sessao_invalida` e `desativado`.
3. 403 `sem_acesso_app` (papel agenda ou sem o CRM) traz os apps que a pessoa pode abrir, com o link de cada um.
4. 403 `sem_perfil` para usuário do Auth que ainda não tem cadastro na equipe.
5. Auth fora do ar responde 503 `indisponivel` em vez de 401 (a tela não desloga ninguém por falha de rede).
6. Token JWT vencido é recusado sem nem consultar o Auth.
7. Último acesso (`ultimo_acesso_em` e `ultimo_app='crm'`) gravado no máximo a cada 5 minutos por pessoa.
8. `GET /api/eu`: perfil completo, apps, troca obrigatória de senha, outros apps com link e o mapa `pode` (o que mostrar na tela).
9. Desativar, mudar papel, mudar apps, trocar senha ou editar o perfil esquecem o login em cache: o corte é imediato.
10. Desativar grava `desativado_em` e `desativado_por`; reativar limpa os dois.

## Equipe
11. Papel `gestor` aceito ao criar pessoa e ao mudar a função (antes só admin, atendente e agenda).
12. Quem vira papel `agenda` fica só com o app Agenda; quem sai dele volta a ter todos os apps.
13. `POST /api/equipe/apps` (admin) com lista de apps validada e auditoria antes/depois.
14. `POST /api/equipe/recebe-leads` (gestor) liga/desliga quem entra no rodízio, auditado.
15. `POST /api/equipe/senha-temporaria` (admin, nunca para si): senha de 12 caracteres sem letras ambíguas, devolvida uma vez, liga `precisa_trocar_senha` e não vai para a auditoria.
16. Criar pessoa grava apps, cargo, `convidado_por` e `precisa_trocar_senha=true`.
17. `GET /api/equipe`: gestor vê a equipe inteira (com apps, cargo, último acesso, recebe leads); atendente só o próprio cadastro.
18. `GET /api/vendedores`: quem pode receber leads do CRM, com carga em aberto e "eu", sem e-mail.

## Responsável pelo lead
19. Lead criado pelo CRM nasce com quem criou como responsável (o servidor usa a chave de serviço e o gatilho não via o `auth.uid()`).
20. Responsável inválido na criação (papel agenda, desativado, sem o CRM) → 400.
21. `GET /api/leads?minhas=1` e `?responsavel=eu|nenhum|<uuid>`, com validação do parâmetro.
22. `PATCH /api/leads/:id/responsavel`: atendente pega lead sem dono e passa o próprio; só gestor tira o dono ou mexe no lead do colega.
23. Troca otimista: se outra pessoa mudou o dono no meio, devolve 409 e não sobrescreve.
24. Reatribuição auditada com de/para e motivo (a notificação sai pelo gatilho do banco).
25. `POST /api/leads/responsavel-lote` (gestor, até 200 leads) auditado com a quantidade e os ids.
26. Rodízio: menor carga primeiro, empate para quem recebeu há mais tempo; respeita `recebe_leads`, ativo e o app CRM.
27. Rodízio automático só pega leads novos das últimas 48 h (os 222 antigos sem dono não são despejados em ninguém); a rota manual tem `todos` e `simular`.
28. Rodízio atualiza `perfis.ultimo_lead_em` e é auditado.
29. Apagar lead só gestor (403 `so_gestor`), com o retrato do lead na auditoria.
30. Auditoria de fechamento (concluído/perdido), reabertura e mudança de valores, com quem fez.
31. Lista de leads e estatísticas leem de 1000 em 1000 (antes a consulta parava em 1000 leads).

## Desempenho e metas
32. `GET /api/desempenho`: por vendedor, leads, agendados, vendas, perdidos, faturamento, abertos, conversão, ticket e tempo de resposta (mediana).
33. Venda conta pela data de fechamento; agendamento cancelado não conta; resposta de mais de 7 dias fica fora do tempo de resposta.
34. Linha "sem responsável" e total da loja no mesmo retorno.
35. Ranking por faturamento, depois vendas e conversão (`GET /api/ranking` para todos).
36. Atendente recebe só a própria linha de desempenho; gestor vê todos.
37. Período por mês no fuso de São Paulo (`mes=AAAA-MM`) ou por dias (1 a 365).
38. `GET /api/metas`: meta, realizado, progresso, projeção e risco de cada número, da loja e de cada pessoa, com status (sem meta, ok, risco, batida, não batida).
39. `PUT /api/metas` só gestor, uma meta ou um lote (valida todas antes de gravar), sem duplicar a do mesmo mês.
40. Metas validadas (mês, números de 0 a 100 mil / R$ 10 milhões, pessoa da equipe do CRM) e auditadas com antes/depois.

## Tarefas
41. `GET /api/tarefas` com minhas, lead, cliente, situação e responsável; traz nome do lead e da pessoa e a contagem de abertas, atrasadas e para hoje.
42. Ordem útil: prazo mais perto primeiro, sem prazo depois, feitas por último.
43. `POST /api/tarefas` valida título, prazo, prioridade e vínculos; o cliente vem do lead sozinho.
44. `PATCH /api/tarefas/:id` só para quem cuida, quem criou ou gestor; concluir grava `concluida_por` (o gatilho não vê o usuário no servidor).
45. Reatribuir tarefa é auditado; `DELETE` só de quem criou ou de gestor, auditado.

## IA do CRM
46. Nova ação `criar_tarefa` na próxima ação (esquema strict com título e prazo de 1 a 336 h); a tarefa vai para o dono do lead.
47. Desfazer uma ação de tarefa cancela a tarefa criada.
48. No modo automático, a tarefa da próxima ação é criada sozinha (é segura e se desfaz).
49. Cada item da triagem traz a tarefa sugerida; no modo automático a triagem cria as tarefas sem duplicar lead que já tem tarefa aberta.
50. `POST /api/ia/triagem/tarefas`: um clique transforma itens da triagem em tarefas, sem duplicar ao clicar de novo.
51. Execuções da IA (uma, lote, desfazer, tarefas da triagem) auditadas, inclusive quando confirmaram faturamento.
52. Tela da IA: botão "📝 Virar tarefas" na triagem, cartão mostra a tarefa com prazo e avisa a tela (`indycar:tarefas`) para recarregar a lista.

## Automações
53. Lead novo sem contato em 2 h notifica o responsável (sem dono: gestores); mensagem antiga não conta como contato; só olha os últimos 3 dias.
54. Orçamento sem resposta em 3 dias vira tarefa do responsável; pula se o cliente respondeu, se já há tarefa aberta e espera 3 dias depois de concluída.
55. Lead parado há 14 dias ganha sugestão de perdido com motivo (`crm_sugestao_perdido`), sem mudar nada; executar pede confirmação; não repete por 30 dias.
56. Meta do mês em risco avisa gestores e admin uma vez por semana.
57. Trava dupla (no processo e no banco, `crm_pegar_trava`) impede duas voltas ao mesmo tempo; testada no Postgres com bloco revertido.
58. Erro numa regra não derruba as outras; cada volta vai para `crm_automacoes_execucoes`.
59. Rota do agendador (`x-agendador-token`, comparação em tempo constante; 503 sem token configurado); gestor também roda pelo login; `GET /api/automacoes` sem vazar o token.

## Segurança do servidor
60. Cabeçalhos em toda resposta: CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS e COOP.
61. CSP da página sem `unsafe-inline` em script: o hash de cada `<script>` embutido é calculado do próprio index.html (Chrome sem nenhum bloqueio em 1440 e 375 px).
62. CORS só para os domínios do ecossistema; preflight de fora recebe 403.
63. Corpo com conteúdo precisa ser JSON (415) e um objeto (400 para lista, número ou texto).
64. Método HTTP desconhecido → 405.
65. 40 tokens recusados pelo Auth no mesmo IP em 10 min → espera (sessão vencida não conta, porque a loja divide o IP).
66. Erros internos sem detalhe do banco (catálogo, equipe, perfil, clientes, criação de usuário).
67. Exportar CSV registrado por `POST /api/auditoria/exportacao` com filtros limpos; `GET /api/auditoria` só admin, com o nome de quem fez.
68. Auditoria troca por "•••" qualquer campo com cara de segredo; integrações registram só os nomes dos campos.
69. Integrações, investimento e catálogo auditados.
70. `PATCH /api/perfil` aceita cargo, telefone, cor do avatar e preferências, validados; papel enviado ali é ignorado.
71. `npm run segredos` varre arquivos versionados e novos (ignora valores de exemplo, confere `.env` fora do git); histórico do git limpo.
72. `npm audit`: 0 vulnerabilidades; `npm run verificar` junta testes, segredos e audit.
73. Migração `crm_automacoes_travas`: RLS ligado, `search_path` vazio, EXECUTE só para service role; advisor sem WARN novo.

## Como foi verificado
- `npm test`: 95 testes passando (inclui os da tela). Novos: `acesso`, `equipe`, `tarefas`, `automacoes` (relógio injetável), `ia-tarefas` (IA falsa) e `server` reescrito sobre `testes/servidor-falso.cjs`, que sobe o `server.js` real com o `db-supabase.js` real em banco de memória e uma pessoa de cada papel.
- Servidor real local (porta 3110, `CRM_AUTOMACOES=0`): cabeçalhos, CSP, 401 com código, CORS, 415, agendador sem token; leitura real (com escrita bloqueada) de vendedores, desempenho, metas, rodízio simulado e tarefas.
- Chrome (puppeteer-core): página com CSP sem erro; triagem → "Virar tarefas" no servidor falso da tela com a resposta da rota interceptada.
- Banco: só a migração aditiva acima e um bloco `DO` revertido para testar a trava.
