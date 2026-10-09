# CRM IndyCar — 09/10/2026

1. Aniversário aparece e pode ser editado na ficha do cliente compartilhado.
2. Ano desconhecido é salvo como 1904, preservando dia e mês, inclusive 29/02.
3. Datas inexistentes, futuras e anteriores a 1900 são rejeitadas.
4. Preferência de mensagens automáticas pode ser editada na ficha.
5. Preferência desconhecida aparece como ainda não registrada.
6. Alterações de consentimento registram aceita_mensagens_em; salvar sem mudança preserva a data.
7. Atualização de preferências usa somente colunas existentes em clientes, pela identificação do cliente.
8. Lead vinculado oferece botão para abrir sua ficha 360.
9. Ficha mostra quantidade de faltas registradas nos agendamentos.
10. Ficha mostra a data mais recente de serviço concluído entre leads e agendamentos.
11. Ficha oferece acesso à Agenda em outra aba.
12. Busca de leads compartilha normalização de acentos, caixa e pontuação.
13. Busca reconhece telefone com ou sem DDI +55.
14. Busca reconhece placa com ou sem separadores.
15. Filtros de status, origem e ordenação ficam salvos localmente, sem guardar nomes ou telefones buscados.
16. Botão Limpar filtros restaura todos os leads e a ordem padrão.
17. Leads podem ser ordenados por nome, valor, entrada recente ou antiga.
18. Exportação CSV respeita os leads filtrados e ordenados.
19. CSV usa BOM UTF-8, separador ponto e vírgula e escape de aspas para planilhas em português.
20. CSV neutraliza fórmulas em células provenientes de texto.
21. Filtragem de leads usa uma única consulta à base em vez de repetir a leitura para o recorte.
22. Respostas antigas de busca não substituem uma busca mais recente.
23. Busca do topo também filtra os cartões do funil.
24. Cartões do funil permitem mudar etapa por seletor, acessível por toque e teclado.
25. Falha na movimentação de etapa restaura a escolha anterior e exibe a mensagem de erro.
26. Atalho N abre novo lead, fora de campos de texto e com sessão ativa.
27. Atalho / abre Leads e leva o foco à busca.
28. Linhas de leads e cartões podem ser abertos com Enter ou Espaço.
29. Modais recebem papel dialog, identificação acessível e aria-modal.
30. Modais posicionam o foco ao abrir, contêm a navegação com Tab e devolvem foco ao fechar.
31. Conteúdo atrás do modal fica inerte durante sua abertura.
32. Botão de fechar a ficha permanece acessível no celular ao rolar seu conteúdo.
33. Navegação por ícones no celular mantém nomes acessíveis.
34. Toasts anunciam mensagens com role status e aria-live.
35. Carregamento de indicadores e ficha usa esqueletos com descrição acessível e respeita movimento reduzido.
36. Estado vazio de leads orienta limpar filtros ou criar novo contato.
37. Telefone usa teclado de telefone e é validado com DDD no navegador e servidor.
38. Valores negativos, não finitos ou acima de R$ 10 milhões são rejeitados.
39. Placas antigas e Mercosul são validadas no navegador e servidor.
40. Nome, observações e demais textos do lead têm limites de tamanho no servidor.
41. Conversão monetária aceita numeric em texto e impede NaN na interface.
42. Rota autenticada /api/saude consulta vigia_estado e devolve apenas problema e desde.
43. Avisos de saúde aparecem discretamente no topo; indisponibilidade da consulta também é indicada.
44. Seletor Ecossistema IndyCar liga CRM, Agenda, Atendimento, Comunicar, Orçador e Site.
45. Corpo JSON tem limite de 64 KB medido em bytes, com resposta JSON 413 sem destruir a conexão.
46. JSON malformado recebe resposta 400; falhas inesperadas não expõem detalhes internos.
47. Respostas da API usam Cache-Control no-store e X-Content-Type-Options nosniff.
48. Estatísticas têm cache de 60 segundos, invalidado nas gravações do CRM.
49. Arquivos estáticos validam caminho absoluto dentro de public e usam no-cache e nosniff.
50. Requisições da interface têm prazo máximo de 20 segundos.
51. Avisos de perda e retorno da conexão ajudam a evitar tentativas de salvar sem internet.
52. Troca de tema marca html com data-trocando-tema e desliga transições; body usa transition none.
53. Layout de 375 px mantém seletores, navegação, tabelas e funil dentro da largura da página.
54. Service worker v3 inclui módulos novos, não guarda respostas de erro nem recursos externos e limita fallback HTML à navegação.
55. Atributos de identificadores e status de leads são escapados com esc, assim como todos os novos templates com dados.
56. Servidor falso serve public real, autenticação fictícia e dados exclusivamente inventados em memória.
57. Suíte node --test cobre busca, valores, aniversário, CSV e contrato do servidor com banco/login falsos.

## Validação

- `npm.cmd test`: 8 testes passaram; `--test-isolation=none` evita subprocessos bloqueados neste ambiente.
- Verificação de sintaxe: server.js, db-supabase.js, app.js, melhorias.js, crm-utils.js e sw.js.
- Chrome com servidor falso: ficha 360, preferência salva, busca com +55, mudança de etapa, tema claro/escuro, teclado e layout móvel/desktop.
- Nenhum DDL, nenhum teste com dados reais e nenhuma senha do dono digitada.

## Limite da verificação em produção

Verificação pública de HTML, módulos, versão do service worker, cabeçalhos e bloqueio das rotas sem login. Fluxos autenticados são exercitados no servidor falso; não se grava dado de teste na base compartilhada.


# Rodada 2 (09/10/2026, tarde) — IA do CRM e tela

## 
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


## 
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

