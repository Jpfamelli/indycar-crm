/* Rodada 4: funções puras da tela (public/crm-r4.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/crm-r4.js');
const U = require('../public/crm-utils.js');

const DIA = 864e5;
const L = (i, x = {}) => ({ id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, nome: 'Fictício ' + i, status: 'novo', origem: 'whatsapp', created_at: new Date(Date.UTC(2026, 9, 1)).toISOString(), valor_pago: 0, valor_orcado: 0, observacoes: '', responsavel_id: null, ...x });

test('acordando: esperas crescentes de ~3 min e quem conta como "dormindo"', () => {
  const e = R.esperasAcordar();
  assert.ok(e.every((x, i) => i === 0 || x >= e[i - 1]), 'espera nunca diminui');
  assert.ok(R.totalEspera() >= 150 && R.totalEspera() <= 200);
  assert.equal(R.ehAcordando(0, null), true, 'rede caiu');
  assert.equal(R.ehAcordando(503, null), true, 'HTML do Render');
  assert.equal(R.ehAcordando(502, { message: 'x' }), true, 'JSON sem "erro" não é nosso');
  assert.equal(R.ehAcordando(503, { erro: 'Não consegui ler' }), false, '503 do nosso servidor não é "acordando"');
  assert.equal(R.ehAcordando(500, null), false);
  assert.equal(R.ehAcordando(200, {}), false);
});

test('repetir: leitura sempre; escrita só com chave e quando o pedido nem chegou', () => {
  assert.equal(R.deveRepetir({ metodo: 'GET', status: 503, corpo: { erro: 'x' } }), true);
  assert.equal(R.deveRepetir({ metodo: 'GET', status: 400 }), false);
  assert.equal(R.deveRepetir({ metodo: 'POST', status: 503, corpo: null }), false, 'sem chave não repete');
  assert.equal(R.deveRepetir({ metodo: 'POST', status: 503, corpo: null, chave: true }), true);
  assert.equal(R.deveRepetir({ metodo: 'PATCH', status: 0, chave: true }), true);
  assert.equal(R.deveRepetir({ metodo: 'POST', status: 503, corpo: { erro: 'nosso' }, chave: true }), false, 'nosso 503 numa escrita: não repete');
  assert.match(R.textoAcordando(2, 10, 4.6), /tentativa 2 de 10/);
  assert.match(R.textoAcordando(2, 10, 4.6), /em 5 s/);
  const a = R.novaChave(() => 0.1, 1), b = R.novaChave(() => 0.2, 1);
  assert.notEqual(a, b); assert.match(a, /^[a-z0-9]{6,48}$/i);
});

test('rascunho: chave por lead, validade de 24 h e mais novo que o lead', () => {
  assert.equal(R.chaveRascunho(null), 'indycar_crm_rascunho_novo');
  assert.equal(R.chaveRascunho('abc-<x>'), 'indycar_crm_rascunho_abc-x');
  const agora = Date.UTC(2026, 9, 14, 12);
  const r = { em: agora - 3600e3, valores: { fNome: 'X' }, base: 'a', assinatura: 'b' };
  assert.equal(R.rascunhoValido(r, null, agora), true);
  assert.equal(R.rascunhoValido({ ...r, em: agora - 2 * DIA }, null, agora), false, 'velho demais');
  assert.equal(R.rascunhoValido(r, { updated_at: new Date(agora - 60e3).toISOString() }, agora), false, 'alguém salvou o lead depois');
  assert.equal(R.rascunhoValido({ ...r, assinatura: 'a' }, null, agora), false, 'igual ao salvo');
  assert.equal(R.rascunhoValido(null, null, agora), false);
});

test('fila: junta PATCH do mesmo lead e guarda a chave', () => {
  let f = R.filaAdicionar([], { url: '/api/leads/1', corpo: { status: 'contato' }, nome: 'A', chave: 'kaaaaaaa' });
  f = R.filaAdicionar(f, { url: '/api/leads/1', corpo: { status: 'orcamento', valor_orcado: 10 } });
  f = R.filaAdicionar(f, { url: '/api/leads/2', corpo: { status: 'perdido' } });
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].corpo, { status: 'orcamento', valor_orcado: 10 });
  assert.equal(f[0].chave, 'kaaaaaaa'); assert.equal(f[0].nome, 'A');
  assert.equal(R.textoFila(1), '1 alteração esperando o servidor');
  assert.equal(R.textoFila(3), '3 alterações esperando o servidor');
  assert.equal(R.filaAdicionar(f, null).length, 2);
});

test('valor pago: sem valor, cortesia, sugestões e validação do lote', () => {
  const ls = [L(1, { status: 'concluido' }), L(2, { status: 'concluido', valor_pago: 100 }), L(3, { status: 'concluido', observacoes: 'oi\nCortesia: sem cobrança' }), L(4)];
  assert.deepEqual(R.semValorPago(ls).map(l => l.id), [ls[0].id]);
  assert.equal(R.comCortesia(''), 'Cortesia: sem cobrança');
  assert.equal(R.comCortesia('abc'), 'abc\nCortesia: sem cobrança');
  assert.equal(R.comCortesia(R.comCortesia('abc')), 'abc\nCortesia: sem cobrança', 'não repete a marca');
  assert.deepEqual(R.sugestoesValor({ valor_orcado: 350 }, { agendamento: 350, orcamento: 990.456 }).map(s => s.valor), [350, 990.46], 'sem repetir');
  assert.deepEqual(R.sugestoesValor({ valor_orcado: 0 }, {}), []);
  assert.throws(() => R.validarValores([]), /ao menos/);
  assert.throws(() => R.validarValores([{ id: ls[0].id, valor_pago: 0 }]), /cortesia/);
  assert.deepEqual(R.validarValores([{ id: ls[0].id, valor_pago: '12.345' }, { id: ls[1].id, cortesia: true }]), [{ id: ls[0].id, valor_pago: 12.35, cortesia: false }, { id: ls[1].id, valor_pago: 0, cortesia: true }]);
});

test('distribuição: filtro por etapa, origem e idade; só sem dono', () => {
  const agora = Date.UTC(2026, 9, 14);
  const ls = [L(1, { created_at: new Date(agora - 3 * DIA).toISOString() }), L(2, { created_at: new Date(agora - 40 * DIA).toISOString(), origem: 'google' }),
    L(3, { status: 'concluido', created_at: new Date(agora - 100 * DIA).toISOString() }), L(4, { responsavel_id: 'x' })];
  assert.equal(R.filtrarDistribuir(ls, { agora }).length, 3);
  assert.equal(R.filtrarDistribuir(ls, { agora, soSemDono: false }).length, 4);
  assert.deepEqual(R.filtrarDistribuir(ls, { agora, status: ['novo'] }).map(l => l.id), [ls[0].id, ls[1].id]);
  assert.deepEqual(R.filtrarDistribuir(ls, { agora, origem: ['google'] }).map(l => l.id), [ls[1].id]);
  assert.deepEqual(R.filtrarDistribuir(ls, { agora, idade: '30' }).map(l => l.id), [ls[1].id, ls[2].id]);
  assert.deepEqual(R.filtrarDistribuir(ls, { agora, idade: '0-7' }).map(l => l.id), [ls[0].id]);
  assert.equal(R.idadeDias(ls[1], agora), 40);
});

test('distribuição: partes iguais espalha as etapas; carga iguala os abertos', () => {
  const ls = Array.from({ length: 10 }, (_, i) => L(i, { status: i < 4 ? 'orcamento' : 'novo' }));
  const gente = [{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }];
  const p = R.planoDistribuicao(ls, gente);
  assert.equal(p.total, 10);
  assert.deepEqual(p.resumo.map(x => x.recebe), [5, 5]);
  assert.deepEqual(p.resumo.map(x => x.porEtapa.orcamento), [2, 2], 'cada um recebe um pouco de cada etapa');
  const c = R.planoDistribuicao(ls, [{ id: 'a', abertos: 6 }, { id: 'b', abertos: 0 }], { modo: 'carga' });
  assert.deepEqual(c.resumo.map(x => x.recebe), [2, 8]);
  assert.deepEqual(c.resumo.map(x => x.depois), [8, 8]);
  assert.throws(() => R.planoDistribuicao(ls, []), /ao menos uma pessoa/);
  const g = R.gruposDoPlano(p.plano);
  assert.equal(g.a.length + g.b.length, 10);
  assert.equal(new Set([...g.a, ...g.b]).size, 10, 'nenhum lead repetido');
});

test('relatório: funil, origem, vendedor, motivos e intervalo', () => {
  const ini = new Date(2026, 9, 1), fim = new Date(2026, 9, 15);
  const d = s => new Date(2026, 9, s, 12).toISOString();
  const ls = [
    L(1, { created_at: d(2), status: 'concluido', closed_at: d(5), valor_pago: 300, responsavel_id: 'a', origem: 'google' }),
    L(2, { created_at: d(3), status: 'perdido', closed_at: d(4), observacoes: 'Motivo da perda: Achou caro', responsavel_id: 'a' }),
    L(3, { created_at: d(4), status: 'agendado', responsavel_id: 'b' }),
    L(4, { created_at: d(5), status: 'concluido', closed_at: d(6), valor_pago: 0 }),
    L(5, { created_at: new Date(2026, 8, 20).toISOString(), status: 'perdido', closed_at: d(7) }),
  ];
  const r = R.relatorio(ls, ini, fim, { equipe: [{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }], rotuloOrigem: o => o.toUpperCase() });
  assert.equal(r.totais.leads, 4); assert.equal(r.totais.ganhos, 2); assert.equal(r.totais.perdidos, 2);
  assert.equal(r.totais.conversao, 50); assert.equal(r.totais.faturamento, 300); assert.equal(r.totais.semValor, 1);
  assert.equal(r.totais.agendados, 3, 'agendado + 2 concluídos chegaram a agendar');
  assert.equal(r.funil[0].chegaram, 4); assert.equal(r.funil[3].chegaram, 3); assert.equal(r.funil[5].chegaram, 2);
  assert.equal(r.porOrigem.find(x => x.chave === 'google').nome, 'GOOGLE');
  const ana = r.porVendedor.find(x => x.chave === 'a');
  assert.equal(ana.nome, 'Ana'); assert.equal(ana.ganhos, 1); assert.equal(ana.conversao, 50);
  assert.equal(r.porVendedor.at(-1).nome, 'Sem responsável', 'sem dono vai para o fim');
  assert.deepEqual(r.motivos.map(m => [m.motivo, m.qtd, m.pct]), [['Achou caro', 1, 50], ['Sem motivo registrado', 1, 50]]);
  assert.equal(R.textoMinutos(42), '42 min'); assert.equal(R.textoMinutos(90), '1,5 h'); assert.equal(R.textoMinutos(null), '—');
  const iv = R.intervaloDatas('2026-10-01', '2026-10-14');
  assert.equal(iv.fim.getDate(), 15, 'fim incluído');
  assert.throws(() => R.intervaloDatas('2026-10-14', '2026-10-01'), /período válido/);
  assert.throws(() => R.intervaloDatas('2020-01-01', '2026-10-01'), /2 anos/);
});

test('tour e ajuda por papel', () => {
  const at = R.passosTour('atendente'), ge = R.passosTour('gestor');
  assert.ok(ge.length > at.length);
  assert.ok(ge.some(p => p.alvo.includes('distribuir')) && !at.some(p => p.alvo.includes('distribuir')));
  assert.equal(at.at(-1).alvo, '#btnAjuda');
  for (const p of [...at, ...ge]) { assert.ok(p.titulo && p.texto.length < 200); assert.doesNotMatch(p.texto, /prezad|efetuar|comparecer|veículo/i); }
  const aj = R.perguntasAjuda('atendente'), ag = R.perguntasAjuda('admin');
  assert.ok(ag.length > aj.length);
  assert.ok(aj.some(q => /acordando/.test(q.pergunta)));
});

test('busca com índice guardado continua achando nome, placa e telefone', () => {
  const l = { nome: 'João da Silva', telefone: '(12) 99123-4567', placa: 'ABC1D23', carro_modelo: 'Onix', servico: 'Freios' };
  assert.equal(U.buscar(l, 'joao'), true);
  assert.equal(U.buscar(l, 'abc-1d23'), true);
  assert.equal(U.buscar(l, '+55 12 99123 4567'), true);
  assert.equal(U.buscar(l, 'corolla'), false);
  const l2 = { ...l, nome: 'Maria' };   // objeto novo depois de salvar: índice novo
  assert.equal(U.buscar(l2, 'joao'), false);
  assert.equal(U.ATALHOS_ABA.b, 'distribuir'); assert.equal(U.ATALHOS_ABA.r, 'relatorios');
});
