/* Mais de um vendedor: responsável, reatribuir, lote, rodízio, desempenho,
   ranking e metas (cálculo puro + rotas no servidor real). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, PESSOAS, U } = require('./servidor-falso.cjs');
const { criarEquipe, calcularDesempenho, avaliarMeta } = require('../lib/equipe-crm');
const { criarFakeSb } = require('./ia-fake-sb.cjs');

const ANA = PESSOAS.atendente.id, BRUNO = PESSOAS.atendente2.id, ADMIN = PESSOAS.admin.id;
const lead = (n, extra = {}) => ({ id: U(100 + n), nome: `Lead ${n}`, telefone: `129000000${String(n).padStart(2, '0')}`, status: 'novo', origem: 'google', valor_orcado: 0, valor_pago: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), responsavel_id: null, ...extra });

test('desempenho puro: leads, agendados, vendas, faturamento, conversão, tempo de resposta e ranking', () => {
  const desde = Date.parse('2026-10-01T03:00:00Z'), ate = Date.parse('2026-11-01T03:00:00Z');
  const v = [{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }];
  const r = calcularDesempenho({ vendedores: v, desde, ate,
    leads: [
      { id: 1, responsavel_id: 'a', status: 'concluido', valor_pago: 1000, created_at: '2026-10-02T12:00:00Z', closed_at: '2026-10-05T12:00:00Z' },
      { id: 2, responsavel_id: 'a', status: 'perdido', created_at: '2026-10-03T12:00:00Z', closed_at: '2026-10-06T12:00:00Z' },
      { id: 3, responsavel_id: 'b', status: 'concluido', valor_pago: 300, created_at: '2026-09-02T12:00:00Z', closed_at: '2026-10-07T12:00:00Z' },
      { id: 4, responsavel_id: 'b', status: 'orcamento', created_at: '2026-10-08T12:00:00Z' },
      { id: 5, responsavel_id: null, status: 'novo', created_at: '2026-10-09T12:00:00Z' },
      { id: 6, responsavel_id: 'a', status: 'concluido', valor_pago: 999, created_at: '2026-08-01T12:00:00Z', closed_at: '2026-09-01T12:00:00Z' },
    ],
    agendamentos: [{ id: 'g1', lead_id: 1, created_at: '2026-10-03T12:00:00Z', status: 'concluido' }, { id: 'g2', lead_id: 4, created_at: '2026-10-09T12:00:00Z', status: 'cancelado' }],
    conversas: [
      { id: 'c1', atribuida_a: 'a', aberta_em: '2026-10-02T12:00:00Z', primeira_resposta_em: '2026-10-02T12:10:00Z' },
      { id: 'c2', atribuida_a: 'a', aberta_em: '2026-10-03T12:00:00Z', primeira_resposta_em: '2026-10-03T12:30:00Z' },
      { id: 'c3', atribuida_a: 'b', aberta_em: '2026-10-03T12:00:00Z', primeira_resposta_em: '2026-10-03T12:04:00Z' },
    ] });
  const ana = r.pessoas.find(p => p.perfil_id === 'a'), bruno = r.pessoas.find(p => p.perfil_id === 'b');
  assert.equal(ana.leads, 2); assert.equal(ana.vendas, 1); assert.equal(ana.perdidos, 1); assert.equal(ana.faturamento, 1000);
  assert.equal(ana.conversao, 50); assert.equal(ana.agendados, 1); assert.equal(ana.tempo_resposta_min, 20, 'mediana de 10 e 30 min');
  assert.equal(bruno.vendas, 1, 'venda conta pela data de fechamento'); assert.equal(bruno.leads, 1); assert.equal(bruno.agendados, 0, 'cancelado não conta');
  assert.equal(bruno.abertos, 1); assert.equal(bruno.tempo_resposta_min, 4);
  assert.equal(r.semDono.leads, 1); assert.equal(r.loja.faturamento, 1300); assert.equal(r.loja.vendas, 2);
  assert.deepEqual(r.ranking.map(x => x.perfil_id), ['a', 'b']);
  assert.equal(r.ranking[0].posicao, 1);
});

test('meta: progresso, projeção, risco e batida', () => {
  const m = { leads: 100, agendamentos: null, vendas: 10, faturamento: 20000 };
  const meio = avaliarMeta(m, { leads: 50, vendas: 3, faturamento: 6000 }, 0.5);
  assert.equal(meio.itens.leads.progresso, 50); assert.equal(meio.itens.leads.projecao, 100); assert.equal(meio.itens.leads.risco, false);
  assert.equal(meio.itens.vendas.projecao, 6); assert.equal(meio.itens.vendas.risco, true, '6 < 85% de 10');
  assert.equal(meio.itens.agendamentos.meta, null);
  assert.equal(meio.status, 'risco');
  assert.equal(avaliarMeta(m, { leads: 10, vendas: 0, faturamento: 0 }, 0.05).status, 'ok', 'começo do mês não alarma');
  assert.equal(avaliarMeta(m, { leads: 120, vendas: 12, faturamento: 25000 }, 0.9).status, 'batida');
  assert.equal(avaliarMeta(null, { leads: 1 }, 0.5).status, 'sem_meta');
  assert.equal(avaliarMeta(m, { leads: 10, vendas: 1, faturamento: 1 }, 1).status, 'nao_batida');
});

test('rodízio: menor carga primeiro, empate pelo mais antigo, respeita recebe_leads e o app crm, janela de 48 h', async () => {
  const t = Date.parse('2026-10-13T15:00:00Z');
  const sb = criarFakeSb({
    perfis: [
      { id: 'ana', nome: 'Ana', papel: 'atendente', ativo: true, apps: ['crm'], recebe_leads: true, ultimo_lead_em: '2026-10-13T10:00:00Z' },
      { id: 'bia', nome: 'Bia', papel: 'atendente', ativo: true, apps: ['crm'], recebe_leads: true, ultimo_lead_em: '2026-10-12T10:00:00Z' },
      { id: 'cid', nome: 'Cid', papel: 'atendente', ativo: true, apps: ['crm'], recebe_leads: false },
      { id: 'dan', nome: 'Dan', papel: 'atendente', ativo: true, apps: ['atendimento'], recebe_leads: true },
      { id: 'eva', nome: 'Eva', papel: 'atendente', ativo: false, apps: ['crm'], recebe_leads: true },
      { id: 'fra', nome: 'Fra', papel: 'agenda', ativo: true, apps: ['agenda'], recebe_leads: true },
    ],
    leads: [
      { id: 'velho1', status: 'contato', responsavel_id: 'ana', created_at: '2026-10-01T00:00:00Z' },
      { id: 'n1', status: 'novo', responsavel_id: null, nome: 'N1', created_at: '2026-10-13T12:00:00Z' },
      { id: 'n2', status: 'novo', responsavel_id: null, nome: 'N2', created_at: '2026-10-13T13:00:00Z' },
      { id: 'n3', status: 'novo', responsavel_id: null, nome: 'N3', created_at: '2026-10-13T14:00:00Z' },
      { id: 'antigo', status: 'novo', responsavel_id: null, nome: 'Antigo', created_at: '2026-09-01T00:00:00Z' },
      { id: 'tem', status: 'novo', responsavel_id: 'cid', created_at: '2026-10-13T14:00:00Z' },
    ],
  });
  const eq = criarEquipe({ sb, agora: () => t });
  const sim = await eq.rodizio({ executar: false });
  assert.deepEqual(sim.atribuidos.map(a => [a.lead_id, a.perfil_id]), [['n1', 'bia'], ['n2', 'ana'], ['n3', 'bia']]);
  assert.equal(sb.db.leads.find(l => l.id === 'n1').responsavel_id, null, 'simular não grava');
  const r = await eq.rodizio({});
  assert.equal(r.atribuidos.length, 3);
  assert.equal(sb.db.leads.find(l => l.id === 'antigo').responsavel_id, null, 'estoque antigo fica fora do automático');
  assert.ok(sb.db.perfis.find(p => p.id === 'bia').ultimo_lead_em.startsWith('2026-10-13T15'));
  const todos = await eq.rodizio({ todos: true });
  assert.equal(todos.atribuidos.length, 1); assert.equal(todos.atribuidos[0].lead_id, 'antigo');
  sb.db.perfis.forEach(p => { p.recebe_leads = false; });
  assert.match((await eq.rodizio({})).motivo, /Ninguém/);
});

test('rotas: responsável, reatribuir com permissão, lote, filtros "meus leads" e criação com dono', async () => {
  const s = await subirServidor({ tabelas: { leads: [lead(1), lead(2, { responsavel_id: BRUNO }), lead(3), lead(4)] } });
  try {
    const L = n => U(100 + n);
    // criar lead: quem criou vira o responsável
    const novo = await s.req('atendente', '/api/leads', { body: { nome: 'Criado pela Ana', telefone: '12988887777' } });
    assert.equal(novo.status, 201); assert.equal(novo.corpo.responsavel_id, ANA);
    assert.equal((await s.req('atendente', '/api/leads', { body: { nome: 'X', telefone: '12988887770', responsavel_id: PESSOAS.agenda.id } })).status, 400, 'não dá lead ao papel agenda');
    // atendente pega lead sem dono, mas não toma o do colega
    const pega = await s.req('atendente', `/api/leads/${L(1)}/responsavel`, { method: 'PATCH', body: { responsavel_id: 'eu' } });
    assert.equal(pega.status, 200); assert.equal(pega.corpo.lead.responsavel_id, ANA);
    const toma = await s.req('atendente', `/api/leads/${L(2)}/responsavel`, { method: 'PATCH', body: { responsavel_id: ANA } });
    assert.equal(toma.status, 403);
    // passa o próprio lead para o colega
    assert.equal((await s.req('atendente', `/api/leads/${L(1)}/responsavel`, { method: 'PATCH', body: { responsavel_id: BRUNO } })).status, 200);
    assert.equal((await s.req('atendente', `/api/leads/${L(3)}/responsavel`, { method: 'PATCH', body: { responsavel_id: null } })).status, 403, 'tirar o dono é de gestor');
    assert.equal((await s.req('gestor', `/api/leads/${L(2)}/responsavel`, { method: 'PATCH', body: { responsavel_id: ANA } })).status, 200);
    for (const ruim of [PESSOAS.desativado.id, PESSOAS.semApp.id, 'nao-uuid']) assert.equal((await s.req('gestor', `/api/leads/${L(3)}/responsavel`, { method: 'PATCH', body: { responsavel_id: ruim } })).status, 400, ruim);
    assert.equal((await s.req('gestor', `/api/leads/${U(999)}/responsavel`, { method: 'PATCH', body: { responsavel_id: ANA } })).status, 404);
    assert.equal((await s.req('gestor', `/api/leads/${L(3)}/responsavel`, { method: 'PATCH', body: {} })).status, 400);
    const aud = s.db.auditoria.filter(a => a.acao === 'reatribuir_lead');
    assert.equal(aud.length, 3); assert.equal(aud.at(-1).detalhes.de, BRUNO); assert.equal(aud.at(-1).detalhes.para, ANA);
    // lote: só gestor
    assert.equal((await s.req('atendente', '/api/leads/responsavel-lote', { body: { ids: [L(3), L(4)], responsavel_id: ANA } })).status, 403);
    assert.equal((await s.req('gestor', '/api/leads/responsavel-lote', { body: { ids: [], responsavel_id: ANA } })).status, 400);
    const lote = await s.req('gestor', '/api/leads/responsavel-lote', { body: { ids: [L(3), L(4), 'lixo'], responsavel_id: BRUNO } });
    assert.equal(lote.status, 200); assert.equal(lote.corpo.atualizados, 2);
    assert.ok(s.db.auditoria.some(a => a.acao === 'atribuir_lote' && a.detalhes.quantidade === 2));
    // filtros
    const meus = (await s.req('atendente', '/api/leads?minhas=1')).corpo;
    assert.deepEqual(meus.map(l => l.id).sort(), [novo.corpo.id, L(2)].sort());
    assert.equal((await s.req('gestor', `/api/leads?responsavel=${BRUNO}`)).corpo.length, 3);
    assert.equal((await s.req('gestor', '/api/leads?responsavel=nenhum')).corpo.length, 0);
    assert.equal((await s.req('gestor', '/api/leads?responsavel=xyz')).status, 400);
    // vendedores
    const v = (await s.req('atendente', '/api/vendedores')).corpo.vendedores;
    const ids = v.map(x => x.id);
    assert.ok(ids.includes(ANA) && ids.includes(ADMIN) && ids.includes(PESSOAS.gestor.id));
    assert.ok(!ids.includes(PESSOAS.agenda.id) && !ids.includes(PESSOAS.desativado.id) && !ids.includes(PESSOAS.semApp.id));
    assert.equal(v.find(x => x.id === BRUNO).abertos, 3); assert.equal(v.find(x => x.id === ANA).eu, true);
    assert.ok(!('email' in v[0]), 'sem e-mail na lista de vendedores');
    // rodízio pela rota
    assert.equal((await s.req('atendente', '/api/rodizio', { body: {} })).status, 403);
    assert.equal((await s.req('gestor', '/api/rodizio', { body: { simular: true } })).status, 200);
  } finally { await s.fechar(); }
});

test('rotas: apagar lead só gestor, auditoria de fechamento e valores', async () => {
  const s = await subirServidor({ tabelas: { leads: [lead(1, { status: 'orcamento', valor_orcado: 500 }), lead(2)] } });
  try {
    const L = n => U(100 + n);
    assert.equal((await s.req('atendente', `/api/leads/${L(2)}`, { method: 'DELETE' })).status, 403);
    assert.equal((await s.req('gestor', `/api/leads/${L(2)}`, { method: 'DELETE' })).status, 200);
    assert.ok(s.db.auditoria.some(a => a.acao === 'apagar_lead' && a.registro_id === L(2) && a.detalhes.nome === 'Lead 2'));
    const ok = await s.req('atendente', `/api/leads/${L(1)}`, { method: 'PATCH', body: { status: 'concluido', valor_pago: 480 } });
    assert.equal(ok.status, 200);
    const fech = s.db.auditoria.find(a => a.acao === 'lead_fechado');
    assert.equal(fech.detalhes.de, 'orcamento'); assert.equal(fech.detalhes.para, 'concluido'); assert.equal(fech.perfil_id, ANA);
    assert.equal(s.db.auditoria.find(a => a.acao === 'lead_valores').detalhes.valor_pago.depois, 480);
    await s.req('atendente', `/api/leads/${L(1)}`, { method: 'PATCH', body: { status: 'contato' } });
    assert.ok(s.db.auditoria.some(a => a.acao === 'lead_reaberto'));
    // exportação CSV fica registrada
    assert.equal((await s.req('atendente', '/api/auditoria/exportacao', { body: { tipo: 'leads', quantidade: 42, filtros: { status: 'novo', q: { injetado: 1 } } } })).status, 200);
    const exp = s.db.auditoria.find(a => a.acao === 'exportar_csv');
    assert.equal(exp.detalhes.quantidade, 42); assert.equal(exp.detalhes.filtros.q, null);
    assert.equal((await s.req('atendente', '/api/auditoria')).status, 403);
    const lista = await s.req('admin', '/api/auditoria?limite=5');
    assert.equal(lista.status, 200); assert.ok(lista.corpo.registros.length <= 5); assert.ok(lista.corpo.registros[0].quem);
  } finally { await s.fechar(); }
});

test('rotas: metas (gestor grava, todos leem), desempenho e ranking', async () => {
  const mes = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
  const s = await subirServidor({ tabelas: { leads: [
    lead(1, { responsavel_id: ANA, status: 'concluido', valor_pago: 900, closed_at: new Date().toISOString() }),
    lead(2, { responsavel_id: BRUNO, status: 'concluido', valor_pago: 300, closed_at: new Date().toISOString() }),
  ] } });
  try {
    assert.equal((await s.req('atendente', '/api/metas', { method: 'PUT', body: { mes, faturamento: 1000 } })).status, 403);
    assert.equal((await s.req('gestor', '/api/metas', { method: 'PUT', body: { mes: '2026-13', faturamento: 1 } })).status, 400);
    assert.equal((await s.req('gestor', '/api/metas', { method: 'PUT', body: { mes, faturamento: -5 } })).status, 400);
    assert.equal((await s.req('gestor', '/api/metas', { method: 'PUT', body: { mes } })).status, 400, 'precisa de algum número');
    assert.equal((await s.req('gestor', '/api/metas', { method: 'PUT', body: { mes, perfil_id: PESSOAS.agenda.id, vendas: 1 } })).status, 400);
    const loja = await s.req('gestor', '/api/metas', { method: 'PUT', body: { mes, faturamento: 10000, vendas: 10 } });
    assert.equal(loja.status, 200); assert.equal(loja.corpo.meta.perfil_id, null);
    const lote = await s.req('gestor', '/api/metas', { method: 'PUT', body: { mes, metas: [{ perfil_id: ANA, vendas: 4 }, { perfil_id: BRUNO, vendas: 4, faturamento: 2000 }] } });
    assert.equal(lote.status, 200); assert.equal(lote.corpo.metas.length, 2);
    // gravar de novo troca (não duplica)
    await s.req('gestor', '/api/metas', { method: 'PUT', body: { mes, perfil_id: ANA, vendas: 5 } });
    assert.equal(s.db.metas.filter(m => m.perfil_id === ANA).length, 1);
    assert.equal(s.db.metas.find(m => m.perfil_id === ANA).vendas, 5);
    assert.ok(s.db.auditoria.filter(a => a.acao === 'meta_gravada').length >= 4);
    const m = (await s.req('atendente', `/api/metas?mes=${mes}`)).corpo;
    assert.equal(m.mes, mes); assert.equal(m.loja.itens.faturamento.realizado, 1200); assert.equal(m.loja.itens.faturamento.meta, 10000);
    const ana = m.pessoas.find(p => p.perfil_id === ANA);
    assert.equal(ana.itens.vendas.realizado, 1); assert.equal(ana.itens.vendas.meta, 5); assert.equal(ana.itens.vendas.progresso, 20);
    assert.ok(typeof m.decorrido === 'number');
    // desempenho: atendente vê só a si; ranking para todos
    const dAna = (await s.req('atendente', '/api/desempenho')).corpo;
    assert.equal(dAna.pessoas.length, 1); assert.equal(dAna.pessoas[0].perfil_id, ANA); assert.equal(dAna.loja.faturamento, 1200);
    const dG = (await s.req('gestor', `/api/desempenho?mes=${mes}`)).corpo;
    assert.ok(dG.pessoas.length >= 4);
    const rk = (await s.req('atendente', '/api/ranking')).corpo.ranking;
    assert.equal(rk[0].perfil_id, ANA); assert.equal(rk[1].perfil_id, BRUNO);
    assert.equal((await s.req('gestor', '/api/desempenho?dias=0')).status, 400);
    assert.equal((await s.req('gestor', '/api/desempenho?dias=7')).corpo.periodo.dias, 7);
  } finally { await s.fechar(); }
});

test('reatribuir: se outra pessoa trocou o dono no meio, devolve 409 (não sobrescreve)', async () => {
  const sb = criarFakeSb({
    perfis: [{ id: U(1), nome: 'G', papel: 'gestor', ativo: true, apps: ['crm'] }, { id: U(2), nome: 'A', papel: 'atendente', ativo: true, apps: ['crm'] }, { id: U(3), nome: 'B', papel: 'atendente', ativo: true, apps: ['crm'] }],
    leads: [{ id: U(10), nome: 'L', status: 'novo', responsavel_id: U(2) }],
  });
  const de = sb.from.bind(sb);
  sb.from = t => { const q = de(t); const up = q.update; q.update = p => { if (t === 'leads') sb.db.leads[0].responsavel_id = U(3); return up(p); }; return q; };
  const eq = criarEquipe({ sb });
  await assert.rejects(eq.atribuir(U(10), U(1), { id: U(1), papel: 'gestor' }), e => e.status === 409);
  assert.equal(sb.db.leads[0].responsavel_id, U(3));
});
