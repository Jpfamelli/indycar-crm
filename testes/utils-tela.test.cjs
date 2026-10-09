// Rodada 2 (tela): funções puras da interface do CRM.
const {test} = require('node:test'); const assert = require('node:assert/strict'); const u = require('../public/crm-utils');
const AGORA = new Date(2026, 9, 9, 15, 0); // 09/10/2026 15h local
const diasAtras = n => new Date(AGORA.getTime() - n * 86400000).toISOString();

test('tempo na etapa e alerta de parado por etapa', () => {
  assert.equal(u.diasNaEtapa({created_at: diasAtras(3)}, +AGORA), 3);
  assert.equal(u.diasNaEtapa({created_at: diasAtras(9), updated_at: diasAtras(1)}, +AGORA), 1);
  assert.equal(u.diasNaEtapa({created_at: 'lixo'}, +AGORA), 0);
  assert.equal(u.parado({status: 'novo', created_at: diasAtras(2)}, +AGORA), true);
  assert.equal(u.parado({status: 'orcamento', created_at: diasAtras(2)}, +AGORA), false);
  assert.equal(u.parado({status: 'concluido', created_at: diasAtras(90)}, +AGORA), false);
  assert.equal(u.parado({status: 'perdido', created_at: diasAtras(90)}, +AGORA), false);
  assert.equal(u.textoDias(0), 'hoje'); assert.equal(u.textoDias(1), '1 dia'); assert.equal(u.textoDias(5), '5 dias');
});

test('soma da coluna usa pago no concluído e orçado nas demais', () => {
  const r = u.resumoColuna([{status: 'concluido', valor_pago: '300.50', valor_orcado: 999}, {status: 'orcamento', valor_orcado: 200}, {status: 'novo', valor_orcado: 'abc', created_at: diasAtras(4)}], +AGORA);
  assert.deepEqual(r, {qtd: 3, valor: 500.5, parados: 1});
});

test('períodos: hoje, 7, 30, mês e personalizado com comparação', () => {
  const h = u.periodo('hoje', AGORA); assert.equal(h.dias, 1); assert.equal(h.ini.getDate(), 9); assert.equal(h.antIni.getDate(), 8);
  const s = u.periodo('7', AGORA); assert.equal(s.dias, 7); assert.equal(s.ini.getDate(), 3); assert.equal(+s.antFim, +s.ini);
  assert.equal(u.periodo('30', AGORA).dias, 30);
  const m = u.periodo('mes', AGORA); assert.equal(m.ini.getDate(), 1); assert.equal(m.dias, 9); assert.equal(m.antIni.getMonth(), 8); assert.equal(m.antFim.getDate(), 10);
  const p = u.periodo('personalizado', AGORA, '2026-09-01', '2026-09-30'); assert.equal(p.dias, 30); assert.equal(p.antIni.getMonth(), 7);
  assert.throws(() => u.periodo('personalizado', AGORA, '2026-09-30', '2026-09-01'));
  assert.throws(() => u.periodo('personalizado', AGORA, '', '2026-09-01'));
});

test('métricas: conversão, ticket, ciclo, origem e motivos de perda', () => {
  const p = u.periodo('7', AGORA);
  const leads = [
    {status: 'concluido', origem: 'google', valor_pago: 400, created_at: diasAtras(4), closed_at: diasAtras(2)},
    {status: 'concluido', origem: 'google', valor_pago: 600, created_at: diasAtras(20), closed_at: diasAtras(1)},
    {status: 'perdido', origem: 'meta', created_at: diasAtras(3), updated_at: diasAtras(1), observacoes: 'oi\nMotivo da perda: Preço'},
    {status: 'perdido', origem: 'meta', created_at: diasAtras(3), updated_at: diasAtras(1)},
    {status: 'novo', origem: 'meta', created_at: diasAtras(1)},
    {status: 'novo', origem: 'meta', created_at: diasAtras(40)},
  ];
  const m = u.metricas(leads, p.ini, p.fim);
  assert.equal(m.entradas, 4); assert.equal(m.ganhos, 2); assert.equal(m.perdidos, 2);
  assert.equal(m.faturamento, 1000); assert.equal(m.ticket, 500); assert.equal(m.conversao, 50);
  assert.equal(m.cicloMedio, 10.5);
  assert.deepEqual(m.porOrigem.map(o => [o.origem, o.leads, o.ganhos]), [['meta', 3, 0], ['google', 1, 2]]);
  assert.equal(m.porOrigem[1].conversao, 100);
  assert.deepEqual(m.motivos, [{motivo: 'Preço', qtd: 1}, {motivo: 'Sem motivo registrado', qtd: 1}]);
  assert.equal(u.metricas([], p.ini, p.fim).cicloMedio, null);
});

test('funil por etapa e comparação percentual', () => {
  const f = u.funilPassagem([{status: 'novo'}, {status: 'contato'}, {status: 'concluido'}, {status: 'perdido'}]);
  assert.deepEqual(f.map(x => x.chegaram), [4, 2, 1, 1, 1, 1]);
  assert.equal(f[1].taxa, 50); assert.equal(f[0].taxa, 100);
  assert.equal(u.comparar(10, 5), 100); assert.equal(u.comparar(5, 10), -50); assert.equal(u.comparar(3, 0), null); assert.equal(u.comparar(0, 0), 0);
});

test('motivo da perda entra nas observações sem duplicar', () => {
  const a = u.comMotivoPerda('Cliente pediu desconto', 'Achou caro');
  assert.equal(a, 'Cliente pediu desconto\nMotivo da perda: Achou caro');
  const b = u.comMotivoPerda(a, '  Foi   em outra oficina ');
  assert.equal(u.motivoPerda(b), 'Foi em outra oficina'); assert.equal(b.match(/Motivo da perda/g).length, 1);
  assert.equal(u.comMotivoPerda('', 'Sem retorno'), 'Motivo da perda: Sem retorno');
  assert.throws(() => u.comMotivoPerda('x', '   '));
  assert.ok(u.comMotivoPerda('a'.repeat(5000), 'Preço').length <= 4000);
  assert.equal(u.motivoPerda(null), null);
});

test('links de ação do telefone', () => {
  assert.equal(u.telE164('+55 (12) 99999-0001'), '12999990001');
  assert.equal(u.telE164('123'), '');
  assert.equal(u.linkWhatsApp('(12) 99999-0001'), 'https://wa.me/5512999990001');
  assert.equal(u.linkLigar('12 3632-0000'), 'tel:+551236320000');
  assert.equal(u.linkConversa('5512999990001'), 'https://indycar-atendimento.onrender.com/?tel=12999990001');
  assert.equal(u.linkConversa(''), '');
  assert.equal(u.linkComunicar(''), 'https://indycar-posvenda.onrender.com/');
  assert.equal(u.linkAgenda('12999990001'), 'https://indycar-agendamentos.onrender.com/?tel=12999990001');
  assert.equal(u.formatarTelefone('12999990001'), '(12) 99999-0001');
  assert.equal(u.formatarTelefone('1236320000'), '(12) 3632-0000');
  assert.equal(u.formatarTelefone(' 99 '), '99');
});

test('paginação limita página e calcula faixa', () => {
  const l = Array.from({length: 120}, (_, i) => i);
  assert.deepEqual(u.paginar(l, 3, 50).itens, l.slice(100));
  const p = u.paginar(l, 99, 50); assert.equal(p.pagina, 3); assert.equal(p.de, 101); assert.equal(p.ate, 120);
  assert.equal(u.paginar([], 1).paginas, 1); assert.equal(u.paginar([], 1).de, 0);
  assert.equal(u.paginar(l, 'x').pagina, 1);
});

test('linha do tempo junta formatos do servidor, deduplica e ordena', () => {
  const t = u.linhaDoTempo({
    mensagens: [{direcao: 'entrada', corpo: 'Oi', created_at: '2026-10-01T10:00:00Z'}, {direcao: 'saida', gerada_por_ia: true, corpo: 'Olá', created_at: '2026-10-01T10:01:00Z'}],
    agendamentos: [{data: '2026-10-05', hora: '09:00:00', status: 'confirmado', servico: 'Freios'}],
    orcamentos: [{created_at: '2026-10-02T12:00:00Z', status: 'enviado', total: 350}],
    envios: [{enviado_em: '2026-10-07T12:00:00Z', tipo: 'pos_venda', corpo: 'Tudo certo?'}],
    historico: [{em: '2026-10-03T12:00:00Z', de: 'novo', para: 'contato'}],
    eventos: [{tipo: 'nota', quando: '2026-10-08T12:00:00Z', titulo: 'Nota'}, {tipo: 'sem data'}],
  }, [{tipo: 'status', quando: '2026-10-03T12:00:00Z', titulo: 'Etapa: contato'}, {tipo: 'lixo', quando: 'nunca', titulo: 'x'}]);
  assert.deepEqual(t.map(i => i.tipo), ['nota', 'comunicar', 'agendamento', 'status', 'orcamento', 'mensagem', 'mensagem']);
  assert.equal(t.at(-1).titulo, 'Cliente escreveu'); assert.equal(t.at(-2).titulo, 'IA respondeu');
  assert.match(t[4].detalhe, /350,00/);
  assert.deepEqual(u.linhaDoTempo(null), []);
});

test('lembretes: validação, situação e ordem', () => {
  assert.throws(() => u.novaTarefa({texto: '  '})); assert.throws(() => u.novaTarefa({texto: 'x'.repeat(201)})); assert.throws(() => u.novaTarefa({texto: 'ok', para: '10/10'}));
  const t = u.novaTarefa({texto: ' Ligar  de novo ', para: '2026-10-09', leadId: 7, leadNome: 'Fulano'}, AGORA);
  assert.equal(t.texto, 'Ligar de novo'); assert.equal(t.leadId, '7'); assert.equal(u.situacaoTarefa(t, AGORA), 'hoje');
  const lista = [{id: 'a', para: '2026-10-20'}, {id: 'b', para: '2026-10-01'}, {id: 'c', para: '', }, {id: 'd', para: '2026-10-01', feita: true}, {id: 'e', para: '2026-10-09'}];
  assert.deepEqual(u.ordenarTarefas(lista, AGORA).map(x => x.id), ['b', 'e', 'a', 'c', 'd']);
});

test('colunas configuráveis sempre mantêm o cliente', () => {
  assert.deepEqual(u.colunasValidas(['valor', 'cliente', 'lixo']), ['cliente', 'valor']);
  assert.deepEqual(u.colunasValidas(['valor']), u.COLUNAS_PADRAO);
  assert.deepEqual(u.colunasValidas(null), u.COLUNAS_PADRAO);
  assert.equal(u.ATALHOS_ABA.f, 'pipeline');
});

test('linha do tempo entende o contexto real (orçamento nº, resposta do Comunicar, satisfação, anexo)', () => {
  const t = u.linhaDoTempo({
    mensagens: [{direcao: 'entrada', anexo_mime: 'image/jpeg', created_at: '2026-10-01T10:00:00Z'}],
    orcamentos: [{numero: 42, status: 'recusado', total: 900, motivo_recusa: 'caro', created_at: '2026-10-02T10:00:00Z'}],
    comunicar: [{tipo: 'pos_venda', corpo: 'Tudo certo?', created_at: '2026-10-03T09:00:00Z', enviado_em: '2026-10-03T10:00:00Z', respondido_em: '2026-10-03T11:00:00Z', resposta: 'Sim!'}],
    satisfacao: [{nota: 9, comentario: 'Ótimo', created_at: '2026-10-04T10:00:00Z'}],
  });
  assert.deepEqual(t.map(i => i.titulo), ['Pesquisa de satisfação · nota 9', 'Cliente respondeu ao Comunicar', 'Comunicar · pos venda', 'Orçamento nº 42 · recusado', 'Cliente escreveu']);
  assert.equal(t[2].quando, '2026-10-03T10:00:00Z');
  assert.match(t[3].detalhe, /recusa: caro/); assert.equal(t[4].detalhe, '[anexo]');
});
