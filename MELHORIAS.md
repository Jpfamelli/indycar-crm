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



# Rodada 3 (13/10/2026) — segurança, equipe, tarefas, metas

## 
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


## 
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



# Rodada 4 (14/10/2026)

Confiabilidade com o Render dormindo, velocidade, valor pago, distribuição dos leads sem responsável, relatórios, tour e ajuda, polimento da IA. Cada linha foi conferida por `node --test` (118 testes; 22 novos em `testes/r4-servidor.test.cjs`, `testes/r4-utils.test.cjs`, `testes/r4-ia.test.cjs`) e/ou no navegador (puppeteer-core + Chrome, servidor falso com `MOCK_LEADS=700`, 1440 e 375 px, 53 verificações, zero erro de página).

## Servidor dormindo (503 do Render)
1. Faixa "O sistema está acordando… tentando de novo em N s (tentativa X de 10)" em 502/503/504 do proxy e em falha de rede, no lugar do erro cru.
2. Espera crescente entre tentativas (2, 3, 5, 8, 12, 18, 25, 30, 30, 30 s ≈ 3 min).
3. Botão "Tentar agora" na faixa e nova tentativa imediata quando a internet volta.
4. Aviso "O sistema voltou (levou N s). Pode continuar." quando o servidor responde de novo.
5. 503 do próprio CRM (JSON com "erro") não vira "acordando"; leituras tentam mais duas vezes em silêncio.
6. Leituras repetem sempre; escritas só repetem com chave de idempotência e quando o pedido nem chegou ao servidor.
7. Toda escrita da tela leva `x-idempotencia`, a mesma em todas as tentativas e na renovação do login.
8. Servidor guarda a resposta de cada escrita por 10 min: o mesmo pedido repetido recebe a mesma resposta (cabeçalho `x-idempotencia-repetida`) e não cria lead duplicado.
9. Pedido repetido enquanto o primeiro ainda roda espera o primeiro terminar, em vez de executar duas vezes.
10. Respostas 5xx não ficam guardadas (a próxima tentativa roda de verdade).
11. A chave vale por pessoa e por rota; chave malformada é ignorada.
12. CORS libera o cabeçalho `x-idempotencia` para o ecossistema.
13. Prazo próprio de quem chamou (ex.: 90 s da IA) não entra no laço de novas tentativas.
14. `GET /api/ping` sem login, barato, com versão e hora (o boot usa para acordar o servidor).
15. Configuração pública (URL e chave publicável do Supabase) guardada no aparelho: o login abre na hora, mesmo com o Render dormindo.
16. O boot cutuca `/api/ping` assim que a página abre, para o servidor acordar enquanto a pessoa digita a senha.
17. Sem configuração guardada, a busca dela também espera o servidor acordar (com a faixa), em vez de "não consegui falar com o servidor".
18. Boot espera todos os scripts carregarem antes de entrar (achado no teste: com a configuração guardada, entrava antes de equipe.js e rodada4.js).
19. Mudança de etapa sem servidor entra numa fila e a tela já mostra a etapa nova.
20. Chip "N alterações esperando o servidor" no topo; clique tenta enviar na hora.
21. Fila reenviada sozinha quando o servidor volta (ping a cada 20 s e evento "voltou").
22. Dois PATCH do mesmo lead na fila viram um só (o mais novo vence campo a campo), com a mesma chave.
23. Fila em sessionStorage: não vai para outro aparelho e some ao fechar a aba.
24. Erro definitivo ao reenviar (ex.: 4xx) avisa com o nome do lead e sai da fila.
25. Sair com alterações na fila pergunta antes; sair limpa a fila e os rascunhos do aparelho.
26. Rascunho do formulário do lead salvo a cada digitação (sessionStorage).
27. Reabrir o lead (mesmo depois de recarregar a página) oferece "Recuperar" ou "Descartar" o rascunho.
28. Rascunho com mais de 24 h, igual ao salvo ou mais velho que a última gravação do lead é descartado.
29. Fechar a aba com algo por salvar ou na fila: o navegador pergunta antes.
30. Falha ao salvar com o servidor dormindo mantém a gaveta aberta e diz para clicar em Salvar de novo.
31. Botão Salvar mostra "Salvando…" enquanto espera.
32. Service worker v6: a casca (HTML, CSS, JS) sai do cache quando a rede passa de 3,5 s.
33. Service worker: 503 do Render na navegação ou nos arquivos usa a casca guardada.
34. Service worker: biblioteca do Supabase (endereço com versão) e fontes ficam em cache próprio.
35. Service worker com os arquivos novos (crm-r4.js, rodada4.js) na lista que instala.
36. keep-alive do servidor maior que o do proxy (65 s), contra 502 por conexão reaproveitada.
37. Painel da IA (crm-ia.js) passa a usar o mesmo pedido da tela: espera o servidor, renova o login e usa idempotência (`window.IndyCar.pedir`).

## Velocidade
38. JSON acima de 1 KB comprimido com br/gzip (a lista de leads cai a ~10%).
39. Arquivos estáticos comprimidos uma vez e guardados em memória por versão.
40. ETag nos estáticos: sem mudança, o navegador recebe 304 só com cabeçalhos.
41. Estáticos aceitam só GET/HEAD (405 no resto).
42. CSP da página calculada uma vez por versão do index.html.
43. `/api/leads` com colunas explícitas (sem `select *`) e ordem estável na paginação.
44. Cache de 8 s da base de leads, esquecido em toda gravação; pedidos simultâneos dividem a mesma leitura.
45. Filtros de etapa, origem e responsável do servidor aplicados em memória sobre o cache.
46. Clientes lidos de 1.000 em 1.000: a base tem 2.464 e a busca não achava ninguém depois do milésimo.
47. Base de clientes com cache de 30 s, esquecido em qualquer gravação: a busca por letra não relê três tabelas.
48. A tela não pede mais `/api/stats` ao abrir (lia a base inteira só para saber etapas e origens).
49. Aba Origem calculada na tela com os leads já carregados.
50. Filtros de etapa, origem, "só parados" e "limpar" refazem a lista na tela, sem baixar tudo de novo.
51. Busca com índice normalizado guardado por lead (não normaliza os mesmos campos a cada tecla).
52. Saúde do ecossistema pedida depois dos leads (não atrasa a primeira pintura).

## Valor pago
53. Concluir um lead pede o valor já preenchido com a sugestão (orçado, Agenda ou Orçador), com botões de cada sugestão.
54. Dica no diálogo quando não há orçamento registrado.
55. Botão "Foi cortesia": grava zero e marca "Cortesia: sem cobrança" na observação.
56. Zero digitado conta como cortesia (o lead sai da lista de "sem valor").
57. Valor aceita vírgula.
58. Concluir pela edição da ficha usa o mesmo diálogo, com cortesia.
59. Card no painel "N vendas concluídas sem valor pago" (gestor: todas; atendente: as dele).
60. "Ver na lista" abre os concluídos sem valor (atendente: os dele).
61. Filtro "Concluídos sem valor" na lista de leads, guardado com os outros filtros.
62. `GET /api/leads/sem-valor` com sugestões da Agenda (valor do agendamento) e do Orçador (orçamento não recusado).
63. Atendente vê só os concluídos dele nessa rota.
64. "Preencher agora" (gestor): tabela com sugestões clicáveis, "usar as sugestões nos vazios" e cortesia por linha.
65. Servidor valida o lote (R$ 0,01 a 10 milhões, sem repetidos, até 300) e só grava o que continua concluído e sem valor, dizendo o motivo de cada pulado.
66. "Desfazer" o lote volta só onde ninguém mexeu depois.
67. Auditoria `valores_lote` e `valores_lote_desfeito` (quantidade, total, cortesias).
68. No celular o lote vira cartões com o campo do valor à vista.
69. Atendente que tenta o lote recebe 403 com "peça ao gestor ou preencha na ficha".

## Distribuir leads sem responsável (gestor)
70. Aba "Distribuir" para gestor/admin (atalho G B).
71. Filtros por etapa e origem com a contagem de leads sem dono em cada um, e por idade (até 7, 7–30, 30–90, mais de 7/30/90 dias).
72. Só entram leads sem responsável; quem já tem dono continua com ele.
73. Lista de quem recebe com a carga atual (leads abertos); marcados por padrão os que recebem leads no rodízio.
74. Dois jeitos de dividir: partes iguais (cada um recebe um pouco de cada etapa) ou igualar a carga.
75. Prévia por pessoa (quantos recebe, por etapa, abertos depois) e lead por lead.
76. Gravar pede confirmação; o servidor só atribui quem continua sem dono (o que alguém pegou no meio fica com quem pegou).
77. Servidor recusa pessoa sem acesso ao CRM (ex.: papel agenda), lead repetido e mais de 1.000 por vez.
78. O gatilho do banco mandaria uma notificação por lead (centenas): o CRM troca por um aviso só por pessoa ("Você recebeu N leads").
79. O aviso abre direto "Meus leads" (`/?meus=1`).
80. Histórico das últimas 10 distribuições com "Desfazer".
81. Desfazer devolve só os leads que continuam com quem recebeu; repetir o desfazer dá 409.
82. Toast com "Desfazer" logo depois de gravar.
83. Tabela `crm_distribuicoes` (migração `crm_distribuicoes_v1`): RLS ligado, sem acesso de anon/authenticated, índices nas chaves estrangeiras; advisor sem aviso novo além do padrão das tabelas crm_.
84. Auditoria `distribuir_leads` e `distribuir_desfeita`.
85. Atendente não vê Distribuir; link direto volta ao painel.

## Relatórios (gestor)
86. Aba "Relatórios" para gestor/admin (atalho G R).
87. Períodos: este mês, mês passado, 30 e 90 dias, ou datas livres (até 2 anos).
88. Indicadores: leads novos, quantos agendaram, vendas, perdas, conversão, faturamento, ticket, tempo de resposta, dias até fechar e vendas sem valor.
89. Funil do período: até onde as entradas chegaram, com a taxa de passagem de cada etapa.
90. Conversão por origem: leads, agendaram, vendas, perdas, conversão, faturamento e ticket.
91. Conversão e tempo de resposta por vendedor (sem responsável por último).
92. Motivos de perda com quantidade e porcentagem.
93. `GET /api/desempenho?livre=1&de=&ate=` (intervalo livre no fuso de São Paulo, até 2 anos).
94. Exportar CSV com todas as seções (BOM, ponto e vírgula), registrado na auditoria como "relatorio".
95. Imprimir / PDF só do relatório.

## Mais gente usando
96. "Você hoje" no painel: meus abertos, parados, tarefas de hoje, vendas no mês, sem valor e (gestor) sem responsável — cada número abre o filtro certo.
97. Tour de boas-vindas por papel (atendente 5 passos, gestor 8), pula o que não está na tela.
98. Tour: foco no "Próximo", Tab preso na caixa, Esc fecha; no celular vira uma faixa embaixo.
99. Tour visto fica em `perfis.preferencias.crm_tour` (vale em qualquer aparelho) e no aparelho.
100. Ajuda curta "Como faço…" por papel, com "Rever o tour" e "Atalhos de teclado".
101. Botão "Ajuda" na barra lateral e no menu do perfil; a tecla ? abre a ajuda.
102. Lista vazia em "Meus leads" ensina: ver os sem responsável e "Pegar para mim" (gestor: ir para Distribuir).
103. Estados vazios para base sem leads e para "concluídos sem valor".
104. Barra de seleção avisa o atendente que passar em lote é do gestor.
105. Ajuda explica a faixa "acordando" (servidor gratuito dorme e nada se perde).

## IA do CRM
106. Avaliada com 10 leads reais (5 etapas) em modo "sugerir": 20 chamadas, 0 erros, nada gravado (ia_acoes ficou em memória, outras escritas barradas).
107. Achado: a IA escrevia "há 995h". Os dados agora mandam dias acima de 48 h.
108. Justificativa e motivo convertem horas acima de 48 em dias (sem mexer em "8h" ou "17h30").
109. Achado: "Indy Car", "Indycar" e "IndyCar" na mesma rodada. Texto ao cliente padroniza "IndyCar".
110. Achado: "Oi, Família!" (nome de cadastro). Cumprimento com nome que não é de pessoa vira "Oi!".
111. Prompt: mensagem de até 3 frases curtas, nome só se for de pessoa, horário de funcionamento só ao propor dia.
112. Sinal `etapaDesatualizada` ("agendado" sem horário futuro) e a data de hoje nos dados.
113. Segunda rodada real com os mesmos 10 leads: todas em dias, "IndyCar" em todos os textos, "Oi! Tudo bem?" no cadastro "Família", mensagens mais curtas.

## Polimento
114. Origem "telefone" com nome e cor (aparecia crua).
115. Aba Origem escapa o rótulo e tem cor de reserva.
116. 375 px: textos só para leitor de tela dentro das tabelas empurravam a lista de leads 583 px para o lado; a caixa da tabela agora corta.
117. Componentes novos no tema claro e no escuro, só com as variáveis da casa.
118. Movimento reduzido: girador da faixa e animações novas param.
119. Número dos motivos de perda não quebra linha.
120. Servidor falso: `MOCK_LEADS`, `MOCK_DORMINDO`, `POST /__mock/dormir`, `?tour=1`, idempotência e as rotas novas; o tour fica escondido por padrão (não atrapalha o E2E de telas).
121. ETag fraca (o proxy do Render devolve W/"…") também vale para o 304 — achado na conferência em produção.
122. Testes: 7 do servidor (ping, compressão, ETag, idempotência, clientes > 1.000, valor pago, distribuição, desempenho livre), 10 das funções puras e 5 da IA.

## Como foi verificado
- `npm test`: 118 passando; `npm run segredos`: nada; `npm audit`: 0 vulnerabilidades.
- Navegador (puppeteer-core + Chrome) no servidor falso: 43 verificações em 1440/375 px (painel, valores em lote, distribuir/desfazer, relatórios, ajuda, acordando e volta, fila e reenvio, cortesia, rascunho após recarregar, tour do atendente em 375, 375 sem rolagem lateral) + 10 de teclado, tema claro e movimento reduzido.
- Banco real: só leitura (contagens: 589 leads sem responsável, 95 concluídos sem valor) e a migração aditiva `crm_distribuicoes_v1`; avaliação da IA sem gravar nada.
