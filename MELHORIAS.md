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
