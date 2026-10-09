# CRM — IA e servidor · Rodada 2 (09/10/2026)

## Ficha completa (lib/contexto-lead.js)
1. Ficha do lead junta lead(s), cliente, v_cliente_360, conversa, últimas 30 mensagens, agendamentos, orçamentos do Orçador, mensagens do Comunicar, satisfação e etapa do funil.
2. Conversa achada pelo cliente_id ou, para lead sem cliente, pelo telefone (com e sem o nono dígito).
3. Mensagens entregues em ordem cronológica.
4. Sinais calculados: dias na etapa, horas desde a última mensagem, quem falou por último e "cliente esperando resposta".
5. Sinal de orçamento do Orçador esperando decisão, em dias.
6. Sinais de faltas, horário futuro, resposta ao Comunicar, insatisfação e preferência de mensagens.
7. Recorte para a IA sem valores em R$ e sem telefone (testado).
8. Links de saída para Atendimento, Agenda e Comunicar com `?tel=55…` e `tel:` para ligar; bases trocáveis por variável.

## IA do CRM (lib/ia-crm.js)
9. Próxima melhor ação (ligar, mensagem, agendar, cobrar orçamento, mudar etapa, marcar perdido, aguardar) com prioridade e justificativa.
10. Texto pronto troca "prezado", "efetuar", "comparecer" e "veículo" por palavras da casa.
11. Texto com preço é descartado, com aviso na tela.
12. Ação inventada, mudança para a mesma etapa e perdido sem motivo são recusados.
13. Qualificação quente/morno/frio com chance de fechar limitada a 0–100% e até 4 sinais.
14. Preencher pela conversa: carro, ano, placa, serviço e origem provável.
15. Placa da conversa normalizada e validada (antiga e Mercosul).
16. Serviço só entra se existir no catálogo com "fazemos"; a lista vai no pedido.
17. Ano do carro vai para o cliente compartilhado, com antes/depois para desfazer.
18. No automático, preenche só campo vazio com confiança ≥ 0,7 e nunca troca a origem; o resto vira proposta.
19. Triagem por quatro regras explicáveis (parado, orçamento sem resposta, em serviço velho, agendado sem novidade).
20. Triagem funciona sem IA e quando a IA cai, com proposta padrão por regra.
21. IA da triagem trabalha por código (L1…Ln); código inventado é ignorado.
22. Triagem não repete proposta pendente das últimas 24 h nem gasta IA de novo.
23. Triagem grava as propostas em lote, com os tokens contados uma vez.
24. "Pergunte ao CRM" responde só com um JSON agregado montado pelo servidor; nenhum SQL vem da IA.
25. Agregado com contagens exatas por origem e faixa de dias para as listas que são cortadas.
26. Agregado traz Atendimento (conversas, aguardando consultor, tempo da 1ª resposta), Comunicar, Orçador e Agenda.
27. Leads citados pela IA filtrados para ids que existem nos dados.
28. Pergunta validada entre 3 e 300 caracteres.
29. Resumo migrado para `ia_config.modelo_forte` (claude-opus-5-5).
30. Resumo semanal ou mensal (`periodo`), comparando com o período anterior.
31. Resumo inclui Atendimento, Comunicar e Orçador e termina em três ações práticas.
32. Resumo registrado em ia_acoes com tokens e duração.
33. Falha da IA no resumo não mostra mensagem interna do SDK.
34. Todo pedido cerca os dados com marca aleatória; injeção dentro da conversa fica como dado (testado).
35. Regras da casa no system com prompt caching.
36. `ia_config.instrucoes_extras` entra no system.
37. Ferramentas strict com `additionalProperties:false` e `tool_choice:auto` (compatível com os modelos 5.5).
38. Campos de lista que aceitam vazio usam `anyOf` (o formato antigo era recusado pela API real; corrigido e conferido nos 5 esquemas).
39. Fallback de recusa no servidor (`fallbacks:'default'`), voltando sozinho para a chamada simples se a conta não aceitar.
40. Recusa da IA vira 422 claro e fica registrada.
41. Falha ou demora da IA vira 502 com texto simples e fica registrada.
42. Resposta fora do formato fica registrada com os tokens, contando no limite.
43. `ia_config` lido com cache de 60 s e valores de reserva.
44. IA desligada responde 503 claro.
45. Servidor sem chave responde 503 claro sem quebrar a tela.
46. Limite diário do ecossistema (todas as origens) responde 429.
47. Freio de 40 pedidos à IA por pessoa a cada 10 minutos.
48. Autonomia "sugerir": executar é recusado (403) e a tela só oferece copiar.
49. Autonomia "automático" aplica sozinha só mudança segura e reversível; concluído/perdido nunca.

## Executar, recusar, desfazer (rotas /api/ia/acoes)
50. Concluído/perdido só executam com `confirmarFaturamento` (428 pede confirmação).
51. Executar tranca a proposta antes de aplicar: o segundo clique recebe 409.
52. Executar confere se o lead mudou desde a proposta e não sobrescreve a pessoa (409).
53. Executar aplica pelos caminhos normais do db-supabase.js; os gatilhos do banco cuidam do resto.
54. Mensagem executada só devolve o texto e o link da conversa: a IA nunca envia.
55. Desfazer devolve os valores de antes, conferindo que ninguém mexeu depois.
56. Desfazer é de quem executou ou de admin/gestor.
57. Recusar registra quem recusou e o motivo.
58. Executar em lote (até 30), um por um, com resultado por item.
59. Histórico por lead com indicação do que dá para desfazer.

## Servidor e conectividade
60. `GET /api/ia/uso`: uso do dia, limite, restante, por tipo e tokens.
61. `/api/saude` inclui o estado da IA.
62. `GET /api/lead-por-telefone` aceita `t` ou `tel`, com/sem 55 e nono dígito, e devolve cliente, leads e o lead aberto.
63. `atualizarCamposCliente` mexe só nas colunas do carro e confere o valor anterior.
64. Leituras grandes paginadas de 1000 em 1000 (as conversas estavam sendo cortadas).

## Tela (public/crm-ia.js + crm-ia.css)
65. Módulo independente do app.js, ligado só pelo evento `indycar:lead` e por `window.IndyCar`.
66. Painel do lead: sinais, links, três botões, proposta com texto pronto, qualificação, tabela do preencher e histórico.
67. Selo de temperatura no topo do painel do lead.
68. Dashboard: "Pergunte ao CRM" com exemplos e leads citados que abrem a ficha.
69. "Triagem de hoje" com seleção, "Todas", execução em lote e confirmação de faturamento.
70. Sugestões pendentes da triagem aparecem sem gastar IA.
71. Aba IA com uso do dia, autonomia e estado.
72. Reserva sem slot: botão "✨ IA" com gaveta (Esc fecha, foco preso e devolvido).
73. Resposta atrasada de outro lead é descartada.
74. `esc()` em todo dado; nome e mensagem maliciosos testados no navegador.
75. Tema claro e escuro só com as variáveis da casa, sem transição na troca de tema.
76. 375 px sem rolagem horizontal e sem palavra quebrada na tabela.
77. Foco visível, aria-live, aria-busy e rótulos acessíveis.
78. Movimento reduzido respeitado.
79. Origem mostrada em português.
80. Testes `node --test`: 21 da lib e 5 do servidor real, com banco em memória e IA falsa roteirizada.

## Como foi verificado
- `npm.cmd test`: todos passando (inclui testes/ia-crm.test.cjs e testes/server-ia.test.cjs).
- Banco real só leitura: ficha de 3 leads, agregado (583 leads), uso, candidatos de triagem e dados do resumo.
- Chamadas reais baratas com autonomia "sugerir" e `ia_acoes`/`ia_config` em memória (nada gravado): próxima ação, qualificação, preencher, pergunta (Sonnet) e um resumo mensal (Opus). A resposta da pergunta bateu com SQL.
- Chrome (puppeteer) contra servidor real com banco falso: desktop escuro e 375 px claro, painel, lead, aba IA, reserva, XSS e rolagem.
- Nenhum DDL nesta rodada.
