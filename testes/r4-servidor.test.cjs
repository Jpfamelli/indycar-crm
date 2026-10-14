/* Rodada 4 (servidor real sobre banco em memória): ping, compressão, ETag,
   idempotência, clientes acima de 1.000, valor pago em lote e distribuição. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, PESSOAS, U } = require('./servidor-falso.cjs');

const L = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const dias = n => new Date(Date.now() - n * 864e5).toISOString();
function leads(qtd, extra = () => ({})) {
  return Array.from({ length: qtd }, (_, i) => ({ id: L(i), nome: `Cliente Fictício ${i}`, telefone: '1299' + String(1000000 + i), status: 'novo', origem: 'whatsapp',
    valor_orcado: 0, valor_pago: 0, observacoes: '', created_at: dias(100 - i % 90), updated_at: dias(5), closed_at: null, responsavel_id: null, ...extra(i) }));
}

test('ping sem login, compressão do JSON e ETag dos estáticos', async () => {
  const s = await subirServidor({ tabelas: { leads: leads(40) } });
  try {
    const p = await s.req(null, '/api/ping');
    assert.equal(p.status, 200); assert.equal(p.corpo.ok, true); assert.match(p.corpo.versao, /r4/);
    const r = await fetch(s.url + '/api/leads', { headers: { Authorization: `Bearer tok-${PESSOAS.gestor.id}-z`, 'Accept-Encoding': 'gzip' } });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-encoding'), 'gzip');
    assert.equal((await r.json()).length, 40);
    const br = await fetch(s.url + '/app.js', { headers: { 'Accept-Encoding': 'br, gzip' } });
    assert.equal(br.headers.get('content-encoding'), 'br');
    const etag = br.headers.get('etag'); assert.ok(etag);
    const r304 = await fetch(s.url + '/app.js', { headers: { 'If-None-Match': etag } });
    assert.equal(r304.status, 304);
    const html = await fetch(s.url + '/');
    assert.match(html.headers.get('content-security-policy'), /script-src/);
    const post = await fetch(s.url + '/app.js', { method: 'POST' });
    assert.equal(post.status, 405);
  } finally { await s.fechar(); }
});

test('idempotência: a mesma escrita repetida não cria dois leads', async () => {
  const s = await subirServidor();
  try {
    const corpo = { nome: 'Cliente Fictício', telefone: '12991234567' };
    const a = await s.req('atendente', '/api/leads', { body: corpo, headers: { 'x-idempotencia': 'kteste12345' } });
    const b = await s.req('atendente', '/api/leads', { body: corpo, headers: { 'x-idempotencia': 'kteste12345' } });
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    assert.equal(b.headers.get('x-idempotencia-repetida'), '1');
    assert.equal(a.corpo.id, b.corpo.id);
    assert.equal(s.db.leads.length, 1);
    // outra pessoa com a mesma chave é outro pedido
    const c = await s.req('atendente2', '/api/leads', { body: corpo, headers: { 'x-idempotencia': 'kteste12345' } });
    assert.equal(c.status, 201); assert.equal(s.db.leads.length, 2);
    // chave inválida é ignorada (cria normalmente)
    await s.req('atendente', '/api/leads', { body: corpo, headers: { 'x-idempotencia': '<x>' } });
    assert.equal(s.db.leads.length, 3);
  } finally { await s.fechar(); }
});

test('clientes acima de 1.000 aparecem todos (paginação)', async () => {
  const clientes = Array.from({ length: 1500 }, (_, i) => ({ id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, nome: `Pessoa ${String(i).padStart(4, '0')}`, telefone: '1298' + String(1000000 + i), created_at: dias(10) }));
  const s = await subirServidor({ tabelas: { clientes } });
  try {
    const r = await s.req('atendente', '/api/clientes');
    assert.equal(r.status, 200); assert.equal(r.corpo.totalBase, 1500);
    const b = await s.req('atendente', '/api/clientes?q=' + encodeURIComponent('Pessoa 1499'));
    assert.equal(b.corpo.total, 1);
  } finally { await s.fechar(); }
});

test('concluídos sem valor: gestor vê todos, atendente só os dele, com sugestões', async () => {
  const ls = leads(6, i => ({ status: 'concluido', closed_at: dias(i), responsavel_id: i < 3 ? PESSOAS.atendente.id : PESSOAS.atendente2.id, valor_orcado: i === 0 ? 350 : 0, valor_pago: i === 5 ? 200 : 0, observacoes: i === 4 ? 'Cortesia: sem cobrança' : '' }));
  const s = await subirServidor({ tabelas: { leads: ls, agendamentos: [{ id: 'a1', lead_id: L(1), valor: 480, data: '2026-10-01', created_at: dias(3), status: 'concluido' }],
    orc_orcamentos: [{ id: 'o1', lead_id: L(2), total: 990, status: 'aprovado', created_at: dias(4) }, { id: 'o2', lead_id: L(2), total: 50, status: 'recusado', created_at: dias(1) }] } });
  try {
    const g = await s.req('gestor', '/api/leads/sem-valor');
    assert.equal(g.status, 200); assert.equal(g.corpo.total, 4, 'cortesia e o que já tem valor ficam de fora');
    const porId = Object.fromEntries(g.corpo.leads.map(l => [l.id, l]));
    assert.equal(porId[L(0)].valor_orcado, 350);
    assert.equal(porId[L(1)].sugestoes.agendamento, 480);
    assert.equal(porId[L(2)].sugestoes.orcamento, 990, 'orçamento recusado não vira sugestão');
    const a = await s.req('atendente', '/api/leads/sem-valor');
    assert.equal(a.corpo.total, 3);
    assert.ok(a.corpo.leads.every(l => l.responsavel_id === PESSOAS.atendente.id));
  } finally { await s.fechar(); }
});

test('valor pago em lote: só gestor, pula o que mudou, cortesia e desfazer', async () => {
  const ls = leads(4, i => ({ status: i === 3 ? 'contato' : 'concluido', closed_at: dias(2), valor_pago: i === 2 ? 100 : 0 }));
  const s = await subirServidor({ tabelas: { leads: ls } });
  try {
    const neg = await s.req('atendente', '/api/leads/valores-lote', { body: { itens: [{ id: L(0), valor_pago: 10 }] } });
    assert.equal(neg.status, 403); assert.equal(neg.corpo.codigo, 'so_gestor');
    const inval = await s.req('gestor', '/api/leads/valores-lote', { body: { itens: [{ id: L(0), valor_pago: -5 }] } });
    assert.equal(inval.status, 400);
    const rep = await s.req('gestor', '/api/leads/valores-lote', { body: { itens: [{ id: L(0), valor_pago: 10 }, { id: L(0), valor_pago: 20 }] } });
    assert.equal(rep.status, 400);
    const r = await s.req('gestor', '/api/leads/valores-lote', { body: { itens: [{ id: L(0), valor_pago: 450.555 }, { id: L(1), cortesia: true }, { id: L(2), valor_pago: 300 }, { id: L(3), valor_pago: 90 }] } });
    assert.equal(r.status, 200); assert.equal(r.corpo.atualizados, 2);
    assert.deepEqual(r.corpo.pulados.map(x => x.motivo).sort(), ['alguém já preencheu', 'não está mais concluído']);
    const db = id => s.db.leads.find(l => l.id === id);
    assert.equal(db(L(0)).valor_pago, 450.56);
    assert.match(db(L(1)).observacoes, /Cortesia: sem cobrança/);
    assert.equal(db(L(2)).valor_pago, 100);
    assert.ok(s.db.auditoria.some(a => a.acao === 'valores_lote'));
    // desfazer volta só o que ninguém mexeu depois
    db(L(1)).valor_pago = 77;   // alguém mexeu na mão
    const d = await s.req('gestor', '/api/leads/valores-lote/desfazer', { body: { itens: r.corpo.feitos } });
    assert.equal(d.status, 200); assert.equal(d.corpo.voltaram, 1); assert.deepEqual(d.corpo.pulados, [L(1)]);
    assert.equal(db(L(0)).valor_pago, 0);
  } finally { await s.fechar(); }
});

test('distribuição: só gestor, só sem dono, um aviso por pessoa e desfazer', async () => {
  const ls = leads(10, i => ({ responsavel_id: i === 9 ? PESSOAS.atendente.id : null }));
  const s = await subirServidor({ tabelas: { leads: ls, crm_distribuicoes: [] } });
  try {
    const grupos = { [PESSOAS.atendente.id]: [L(0), L(1), L(2), L(3), L(9)], [PESSOAS.atendente2.id]: [L(4), L(5), L(6), L(7), L(8)] };
    const neg = await s.req('atendente', '/api/leads/distribuir', { body: { grupos } });
    assert.equal(neg.status, 403);
    const fora = await s.req('gestor', '/api/leads/distribuir', { body: { grupos: { [PESSOAS.agenda.id]: [L(0)] } } });
    assert.equal(fora.status, 400, 'papel agenda não recebe lead');
    const dup = await s.req('gestor', '/api/leads/distribuir', { body: { grupos: { [PESSOAS.atendente.id]: [L(0)], [PESSOAS.atendente2.id]: [L(0)] } } });
    assert.equal(dup.status, 400);
    // o gatilho real cria uma notificação por lead: simula duas que já existiam
    s.db.notificacoes.push({ id: 'n-x', perfil_id: PESSOAS.atendente.id, chave: `lead:${L(0)}:${PESSOAS.atendente.id}`, titulo: 'Lead passado', created_at: dias(0) });
    const r = await s.req('gestor', '/api/leads/distribuir', { body: { grupos, modo: 'igual', filtros: { status: ['novo'] } } });
    assert.equal(r.status, 200); assert.equal(r.corpo.atualizados, 9); assert.equal(r.corpo.pulados, 1, 'o lead que já tinha dono fica com ele');
    assert.ok(r.corpo.lote);
    assert.equal(s.db.leads.find(l => l.id === L(9)).responsavel_id, PESSOAS.atendente.id);
    assert.equal(s.db.leads.filter(l => l.responsavel_id === PESSOAS.atendente2.id).length, 5);
    assert.ok(!s.db.notificacoes.some(n => n.id === 'n-x'), 'aviso por lead some');
    const resumo = s.db.notificacoes.filter(n => /Você recebeu/.test(n.titulo));
    assert.equal(resumo.length, 2);
    assert.ok(s.db.auditoria.some(a => a.acao === 'distribuir_leads'));
    const lista = await s.req('gestor', '/api/leads/distribuicoes');
    assert.equal(lista.corpo.distribuicoes.length, 1); assert.equal(lista.corpo.distribuicoes[0].total, 9);
    // alguém passou um lead para outra pessoa depois: o desfazer não mexe nele
    s.db.leads.find(l => l.id === L(4)).responsavel_id = PESSOAS.atendente.id;
    const d = await s.req('gestor', `/api/leads/distribuicoes/${r.corpo.lote}/desfazer`, { method: 'POST', body: {} });
    assert.equal(d.status, 200); assert.equal(d.corpo.voltaram, 8); assert.equal(d.corpo.ficaram, 1);
    assert.equal(s.db.leads.filter(l => !l.responsavel_id).length, 8);
    const de2 = await s.req('gestor', `/api/leads/distribuicoes/${r.corpo.lote}/desfazer`, { method: 'POST', body: {} });
    assert.equal(de2.status, 409);
  } finally { await s.fechar(); }
});

test('desempenho aceita intervalo livre (relatórios) e recusa intervalo errado', async () => {
  const s = await subirServidor({ tabelas: { leads: leads(3, i => ({ responsavel_id: PESSOAS.atendente.id, created_at: '2026-09-1' + i + 'T15:00:00Z' })) } });
  try {
    const r = await s.req('gestor', '/api/desempenho?livre=1&de=2026-09-10&ate=2026-09-11');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.periodo.de, '2026-09-10');
    assert.equal(r.corpo.pessoas.find(p => p.perfil_id === PESSOAS.atendente.id).leads, 2);
    const x = await s.req('gestor', '/api/desempenho?livre=1&de=2026-09-12&ate=2026-09-01');
    assert.equal(x.status, 400);
  } finally { await s.fechar(); }
});
