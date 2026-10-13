# CRM: melhorias da tela

## Rodada 3 (13/10/2026): login, perfil, acesso, equipe, tarefas e sino

Tudo conferido no servidor falso (`npm run mock`, `/?papel=…`) com puppeteer-core + Chrome em 1440 e 375 px (19 roteiros, todos passando) e por `node --test` (96 testes no total).

### Login
1. Botão de mostrar/esconder senha (login, senha nova, troca de senha) com `aria-pressed` e rótulo que muda.
2. Aviso de Caps Lock ligado nos campos de senha.
3. "Lembrar meu e-mail neste aparelho" (só com a caixa marcada; a senha nunca é guardada).
4. Mensagens claras: e-mail ou senha incorretos, usuário desativado, sem internet, muitas tentativas, e-mail não confirmado.
5. Espera progressiva depois de 5 erros seguidos (30 s, 1 min, 2 min… até 15 min) com contagem no botão; continua valendo se recarregar a página.
6. O campo de senha é limpo depois de entrar.
7. "Esqueci a senha" com `resetPasswordForEmail` e volta para o próprio CRM (`redirectTo`).
8. A resposta não revela se o e-mail tem conta.
9. Aviso do limite de e-mails do plano gratuito e de que o administrador pode gerar uma senha temporária.
10. Freio de 1 minuto entre pedidos de link e validação do e-mail antes de enviar.
11. Volta pelo link (`PASSWORD_RECOVERY` ou `#type=recovery`) abre a tela de senha nova; o token sai da barra de endereço.
12. Troca obrigatória quando `perfis.precisa_trocar_senha`: senha nova antes de abrir o CRM e o aviso é desligado no perfil.
13. Regras da senha nova: 8 a 72 caracteres, as duas iguais, diferente do e-mail (e do nome antes do @) e sem senhas óbvias.
14. As mesmas regras valem na troca de senha da Minha conta, com erros do Supabase em português.
15. Duas etapas no login: se a conta tem autenticador, o CRM pede o código depois da senha (`getAuthenticatorAssuranceLevel`).
16. O campo do código formata "000 000" e confere sozinho ao chegar em 6 números.
17. Tela "Você não tem acesso ao CRM" com os links dos apps liberados para a pessoa (papel agenda só vê a Agenda).
18. Perfil lido direto em `perfis` (RLS: a própria linha), com a rota do servidor de reserva.

### Perfil e sessão
19. Avatar com iniciais e cor no topo; menu com nome, e-mail, função e cargo.
20. Menu do perfil por teclado (setas, Home/End; Esc fecha e devolve o foco) com `aria-haspopup`/`aria-expanded`.
21. Itens do menu: meu perfil, trocar senha, duas etapas, notificações, minhas tarefas, tema, sair, sair de todos os aparelhos.
22. Meu perfil: cargo, telefone (validado com DDD) e cor do avatar (8 cores, prévia na hora), gravados em `perfis` (cor em `perfis.avatar_cor`).
23. Minha conta mostra os apps liberados e o último acesso.
24. Duas etapas: ativar com QR e chave para digitar, confirmar com código, cancelar apaga o fator pela metade, desativar com aviso quando precisa entrar com o código.
25. Preferências de notificação (aviso na tela, bipe, número na aba) salvas em `perfis.preferencias`, sem apagar chaves de outros apps.
26. Sair e "Sair de todos os aparelhos" (`signOut({scope:'global'})`) com confirmação, também num cartão Sessão.
27. Último acesso (`ultimo_acesso_em`/`ultimo_app`) gravado no máximo a cada 5 min, também quando a aba volta a ficar visível.
28. Lista da equipe (Configurações) mostra "visto há…" e cor de cada pessoa.
29. Funções gestor e agenda no cadastro e na troca de função.
30. 401/403 tratados pelo `codigo` do servidor: sessão, desativado, sem acesso ao app, sem perfil, troca de senha, duas etapas; o resto vira mensagem.
31. Token vencido: renova sozinho e repete o pedido uma vez, sem derrubar a pessoa.
32. Desativado no meio do uso: fecha gaveta e diálogos, para o realtime, limpa o título e volta ao login com o aviso.
33. Saída em outra aba ou aparelho (`SIGNED_OUT`) volta ao login.
34. Vários pedidos falhando juntos geram um aviso só.

### Sino de notificações
35. Sino no topo com contador (até 99+), `aria-label` com as não lidas e número na aba do navegador.
36. Realtime em `notificacoes` (inclui, atualiza, apaga) filtrado pela pessoa; confere a cada 2 min se o realtime cair e ao voltar para a aba.
37. Notificação nova mostra aviso com "Abrir" e bipe opcional.
38. Abrir marca como lida; `/?lead=` abre a ficha no próprio CRM; os outros apps abrem no app de origem.
39. Link fora do ecossistema ou `javascript:` é ignorado; título e corpo sempre escapados.
40. Marcar todas como lidas; apagar uma (volta se der erro).
41. Ícone por tipo, tempo relativo e app de origem; no celular o painel ocupa a largura da tela.

### Responsável do lead
42. Coluna Responsável (avatar + primeiro nome, "Você") na lista, no padrão das colunas e no CSV.
43. Filtro de responsável na lista (todos, meus, sem responsável, por pessoa), salvo no aparelho.
44. "Meus leads" é o padrão do atendente na lista e no funil; gestor começa vendo todos.
45. Funil com filtro próprio de responsável e avatar em cada cartão.
46. Ficha: seletor de responsável e "Pegar para mim", com Desfazer.
47. Ficha segue a regra do servidor: atendente só passa o lead dele ou pega lead sem dono (o resto fica travado com o motivo).
48. Lote "Passar para…" (inclui tirar o responsável) só para gestor, com Desfazer que devolve cada lead a quem estava.
49. Equipe lida de `/api/vendedores` (reserva: `/api/equipe/nomes` e `perfis`), sem o papel agenda.
50. Tarefa criada na ficha vai, por padrão, para quem cuida do lead.

### Equipe e metas (gestor/admin)
51. Aba "Equipe e metas" só para gestor/admin; barrada também por atalho e por link.
52. Meta da loja do mês: realizado, %, quanto falta e projeção pelo ritmo (do servidor; a tela calcula se faltar).
53. Metas por pessoa em tabela editável (a loja na primeira linha), com o "feito" ao lado; grava `{mes, metas}` e relê.
54. Ranking por faturamento, vendas, conversão, agendados, leads ou tempo de resposta (menor primeiro), em lista acessível e tabela.
55. Período do ranking: mês escolhido, 30 dias ou 7 dias.
56. Funil por responsável (pessoa × etapa + valor em aberto); clicar abre o funil daquela pessoa.
57. Metas no Dashboard vêm do servidor ("Minha meta" e "Loja" lado a lado); "Definir metas" só aparece para o gestor e leva à aba da equipe.
58. Barras de progresso com `aria-valuetext` ("R$ 4.520 de R$ 30.000, 15%").
59. A tela entende os dois formatos de metas/desempenho (lista plana ou o do servidor, com `loja`/`pessoas`/`itens`).

### Tarefas (tabela `tarefas`)
60. Tarefas no banco, visíveis em qualquer aparelho, no lugar dos lembretes guardados só no navegador.
61. Grupos: Atrasadas (destaque vermelho), Agenda de hoje (por hora), Próximas, Sem data e Feitas agora.
62. Criar com dia, hora (sem hora vence às 17h30), prioridade e para quem.
63. Concluir, reabrir e cancelar com Desfazer; cancelar só para quem criou ou gestor.
64. Filtros Minhas / Que passei / Equipe (gestor).
65. Selo no Dashboard com as atrasadas e as de hoje.
66. Realtime das tarefas atribuídas a mim (aparecem sem recarregar).
67. Aba Tarefas na ficha do lead (ligada ao lead e ao cliente) com contador das abertas.
68. Quatro tarefas rápidas na ficha: ligar hoje, cobrar orçamento, confirmar horário e pós-venda em 3 dias.
69. Lembretes antigos do aparelho oferecidos para importar uma vez (com cópia de segurança); "Agora não" vale até fechar a aba.
70. Tarefa vinda de outro app mostra a origem; atalhos G T (tarefas) e G E (equipe).

### Segurança, visual e PWA
71. "Excluir" só para gestor/admin; o 403 vira mensagem sem derrubar a sessão.
72. Biblioteca supabase-js fixada na versão 2.112.0.
73. Nada de `onclick` inline (compatível com a CSP do servidor).
74. Topo responsivo em 375 px (busca em linha própria, sino e avatar alinhados) e selo da navegação sem cobrir o ícone.
75. Componentes novos no tema claro e no escuro, só com as variáveis da casa e movimento reduzido respeitado.
76. Service worker v5 com `acesso.js` e `equipe.js`.

### Servidor falso e testes
77. Mock com 9 papéis via `/?papel=` (vira cookie): admin, gestor, atendente, agenda, desativado, sem_app, trocar_senha, mfa, deslogado.
78. Supabase falso no navegador (`scripts/mock-supabase.js`): senha, recuperação, MFA TOTP, sair local/global, `from()` com filtros e realtime por SSE.
79. Portão do mock igual ao servidor: 401 sem token, token vencido, desativado, sem acesso ao app e troca de senha, sempre com `codigo`.
80. Rotas novas no formato do servidor real: `/api/vendedores`, `/api/equipe/nomes`, responsável (com as regras de quem pode), lote, metas e desempenho; `/api/tarefas`.
81. "RLS" falsa: notificações só minhas, tarefas da equipe, perfil só o meu e sem mudar papel/apps/ativo.
82. Ganchos de teste `POST /__mock/notificar` e `/__mock/tarefa` para o realtime.
83. Testes novos: `testes/utils-rodada3.test.cjs` (10) e `testes/mock-rodada3.test.mjs` (8); `mock.test.mjs` passou a mandar o token.
