# CRM — tela · Rodada 2 (09/10/2026)

Cada item foi conferido no servidor falso (`npm run mock`) no Chrome (puppeteer-core) em 1440 px e 375 px, com o `crm-ia.js` real plugado, e/ou por teste `node --test`.

## Ficha do lead (gaveta)
1. Lead abre numa gaveta lateral (tela cheia no celular) com cabeçalho: nome, telefone formatado, carro, placa, etapa, origem e valor (orçado ou pago).
2. Cabeçalho mostra há quanto tempo o lead está na etapa e destaca em amarelo quando está parado.
3. Motivo da perda aparece como etiqueta no cabeçalho do lead perdido.
4. Botão "Abrir conversa" leva ao Atendimento já no telefone do cliente (`?tel=`).
5. Botão "WhatsApp" abre o wa.me com DDI 55.
6. Botão "Ligar" usa `tel:+55…` (abre o discador no celular).
7. Botão "Agendar" abre a Agenda com o telefone do cliente.
8. Botão "Mandar mensagem" abre o Comunicar com o telefone do cliente.
9. Botão "Copiar telefone" (com aviso se o navegador bloquear a cópia).
10. Botão "Ficha 360" leva do lead à ficha do cliente.
11. Etapas clicáveis na própria ficha (mesmas regras de perda/conclusão e com Desfazer).
12. Abas Linha do tempo / Dados / Lembretes com navegação por setas (padrão WAI-ARIA de abas).
13. Linha do tempo única: conversa, respostas da IA, agendamentos, orçamentos (nº, total, recusa), Comunicar (envio e resposta do cliente), pesquisa de satisfação, outros leads do cliente, entrada e fechamento — pela rota `/api/ia/lead/:id/contexto`.
14. Reserva da linha do tempo quando a rota da IA não responde: agendamentos e outros leads da ficha 360 + entrada/fechamento do lead, com aviso discreto.
15. Etapas e status de agendamento aparecem em português na linha do tempo.
16. Respostas antigas da linha do tempo não sobrescrevem a de outro lead aberto depois.

## Contrato com a IA (crm-ia.js)
17. Evento `indycar:lead` com `{leadId, clienteId}` ao abrir a ficha de lead existente e `{leadId:null}` ao fechar (também ao pular de um lead para outro ou para a ficha 360).
18. `window.IndyCar = {authCabecalhos, toast, recarregarLeads(), abrirLead(id), papel}` congelado; `papel` é `null` na tela de login, então o módulo da IA não se monta antes do login.
19. `<section id="iaSlotLead" aria-label="IA">` no topo da ficha do lead, logo abaixo das ações.
20. `<section id="iaSlotPainel" aria-label="IA">` no Dashboard, acima dos indicadores.
21. Aba "IA" na navegação (antiga "Resumo com IA") com `<section id="iaSlotTela" aria-label="IA">` acima do resumo semanal.
22. Slots vazios não ocupam espaço (`.ia-slot:empty`).

## Mudança de etapa
23. Motivo obrigatório ao marcar perdido: lista (achou caro, outra oficina, sem retorno, desistiu, não fazemos, prazo) + "Outro" com texto; vale no funil, na ficha, no formulário e no lote.
24. Motivo gravado numa linha "Motivo da perda: …" nas observações (sem coluna nova), sem duplicar ao perder de novo.
25. Valor pago pedido ao concluir, já preenchido com o orçado e botão "Usar o orçado".
26. Cancelar a pergunta (Esc ou Cancelar) não muda nada.
27. "Desfazer" no aviso após mudar etapa (volta etapa, valor pago e observações).
28. Lista e funil se atualizam localmente após salvar, sem recarregar a base inteira.

## Funil (kanban)
29. Soma em reais de cada coluna (pago nos concluídos, orçado nas demais).
30. Tempo na etapa em cada cartão.
31. Alerta de parado por etapa (novo 1 dia, contato 3, orçamento 4, em serviço 5, agendado 7) com contorno amarelo e contagem por coluna.
32. Resumo no topo: total de leads no funil e quantos estão parados.
33. Arrastar com o mouse pelo cartão inteiro, com cartão-fantasma e coluna de destino destacada.
34. Arrastar no toque pela alça ⠿ (touch-action:none) sem travar a rolagem do funil pelo resto do cartão.
35. Funil rola sozinho quando o cartão chega perto da borda; soltar fora da área usa a coluna mais próxima.
36. Teclado: Shift + ←/→ move o cartão de etapa, mantém o foco e anuncia a mudança (aria-live).
37. Até 40 cartões por coluna com "Mostrar mais" (desempenho com base grande).
38. Um ouvinte de eventos para o funil todo (antes: um por cartão a cada desenho).
39. Colunas com encaixe (scroll-snap) no celular.

## Lista de leads
40. Colunas configuráveis (Cliente fixo; Carro, Serviço, Origem, Valor, Status, Na etapa, Entrada, Campanha), salvas no aparelho, com "Voltar ao padrão".
41. Seleção múltipla com caixa por linha e "selecionar a página".
42. Ação em lote: mudar etapa (perdido pede motivo uma vez; concluir confirma e usa o orçado como pago).
43. Ação em lote: atribuir origem.
44. Ação em lote: exportar só os selecionados.
45. Desfazer da ação em lote.
46. Paginação de 50 em 50 com faixa "51–90 de 90".
47. Filtro "Só parados" e ordenação "Mais tempo parado", salvos com os demais filtros.
48. Busca do topo filtra na tela, sem ir ao servidor a cada letra.
49. CSV inclui dias na etapa e campanha.
50. Tabela rola de lado dentro do cartão no celular, sem quebrar nome e telefone.

## Dashboard
51. Período: hoje, 7 dias, 30 dias, este mês e personalizado, lembrado no aparelho.
52. Comparação com o período anterior (no mês: o mesmo trecho do mês passado).
53. Período personalizado inválido mostra o erro em vez de números errados.
54. Indicadores: leads novos, faturamento, conversão (com p.p.), ticket médio, tempo médio até fechar e valor em aberto com parados.
55. Metas do mês (faturamento, serviços fechados, leads novos) com barra de progresso e projeção de ritmo.
56. "Precisam de atenção": os leads parados há mais tempo, com clique para abrir e "Ver todos".
57. Funil por etapa do período com taxa de passagem entre etapas.
58. Conversão por origem do período (leads, fechados, conversão, faturamento).
59. Motivos de perda do período, do mais comum ao menos comum.
60. Indicadores em 6/3/2 colunas conforme a largura.

## Lembretes do vendedor
61. Lembretes no Dashboard com data, marcados como atrasado/hoje, guardados no navegador por usuário — com aviso "só neste aparelho" (não há tabela própria).
62. Lembretes por lead na aba Lembretes da ficha, com contador na aba.
63. Selo na navegação com os lembretes de hoje e atrasados.
64. Apagar lembrete tem Desfazer.

## Clientes (base de 2.500)
65. Paginação de 50 em 50.
66. Ordenação: quem mais gastou, contato recente, sumidos há mais tempo, nome.
67. Resposta de busca antiga é descartada.
68. Atalho de WhatsApp em cada linha.
69. Ficha 360 com ações: conversa, WhatsApp, ligar, agendar e mandar mensagem.
70. Ficha 360 com botão "Criar lead" que abre o formulário já preenchido com nome, telefone, carro e placa.
71. Faltas e último serviço viraram indicadores da ficha 360; leads da ficha abrem o lead.
72. Ficha 360 com título acessível.

## Formulário
73. Validação no campo (aria-invalid + mensagem) para nome, telefone, placa e valores, com foco no primeiro erro.
74. Telefone formatado ao sair do campo e salvo só com dígitos.
75. Placa em maiúsculas ao digitar e salva sem traço.
76. Aviso de lead aberto com o mesmo telefone, com botão para abrir o existente.
77. Fechar com alterações não salvas pede confirmação.
78. Lead novo salvo mostra aviso com "Abrir".
79. Excluir confirma com o nome do lead.

## Conectividade
80. Link direto `/?lead=<id>` abre a ficha do lead.
81. Link `/?cliente=<uuid>&tel=<telefone>` (Atendimento/Comunicar) abre o lead mais recente do cliente; sem cliente_id, acha pelo telefone com ou sem 55 (também pela rota `/api/lead-por-telefone`).
82. Cliente sem lead: abre a ficha 360 com foco no botão "Criar lead".
83. O telefone sai da barra de endereço logo após abrir (não fica no histórico).

## Teclado, acessibilidade e estados
84. Atalhos G+D/L/F/C/I/O/S para trocar de aba.
85. Tela de atalhos com "?" e botão na barra lateral.
86. "Pular para o conteúdo" e aria-current na aba ativa.
87. Diálogos rápidos nativos (motivo, valor pago, metas, atalhos) com foco preso, Esc e clique fora.
88. Esc fecha primeiro o menu de colunas; depois a janela aberta.
89. Esqueletos no funil, na lista e em clientes na primeira carga.
90. Estados vazios com orientação ("Solte um cartão aqui", "Nenhum lead parado", painéis sem dados).
91. Selo "Sem internet" fixo enquanto a conexão estiver fora.
92. Aba aberta é lembrada ao recarregar a página.

## PWA e testes
93. Service worker v4: guarda a navegação só como "/" (sem ?tel= na chave), só respostas do próprio site, inclui crm-ia.js/.css; /api nunca vai para o cache.
94. Servidor falso com 90 leads e 2.500 clientes inventados e previsíveis (alguns clientes com mais de um lead).
95. Servidor falso com as rotas da IA e `/api/lead-por-telefone` no formato do servidor real (409 no segundo executar, 428 ao concluir/perder sem confirmação).
96. Servidor falso com MOCK_LATENCIA, MOCK_PAPEL, PORT e MOCK_IA_TESTE (script de teste injetado só quando pedido).
97. Servidor falso devolve 400 em JSON malformado e atualiza updated_at/closed_at como o banco.
98. 12 testes novos das funções puras da tela (período, métricas, funil, motivo da perda, links, paginação, linha do tempo, lembretes, colunas) e 4 do servidor falso.

## Validação
- `npm test`: 50 testes passando (incluindo os do outro agente).
- Chrome (puppeteer-core) no mock: arrastar com mouse e toque, Shift+setas, perda com/sem motivo, conclusão com valor, cancelar, desfazer, lote + desfazer, colunas, páginas, só parados, atalhos, validação, duplicado, alteração não salva, lembretes, metas, período, tema claro, ficha 360 → criar lead, links `?cliente=&tel=` / `?tel=` / sem lead, login sem IA, crm-ia.js real (Próxima ação respondendo no slot). Zero erros de página. Sem rolagem horizontal em 375 px.
- Nada contra o banco real além de uma leitura das colunas de `leads`/`clientes`.
