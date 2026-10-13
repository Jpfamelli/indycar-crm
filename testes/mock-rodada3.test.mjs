// Rodada 3 (tela): servidor falso com todos os papéis e as rotas novas no formato combinado.
import {test} from 'node:test'; import assert from 'node:assert/strict'; import {criarMock} from '../scripts/mock-server.mjs';
async function comMock(fn, op) { const s = criarMock(op); await new Promise(r => s.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${s.address().port}`; try { await fn(base); } finally { s.closeAllConnections?.(); await new Promise(r => s.close(r)); } }
const F = (base, papel = 'admin') => async (u, o = {}) => { const r = await fetch(base + u, {...o, headers: {Authorization: 'Bearer ficticio', Cookie: 'mock_papel=' + papel, ...(o.headers || {})}}); let corpo = null; try { corpo = await r.json(); } catch { /* sem json */ } return {status: r.status, corpo}; };
const UUID = /^[0-9a-f-]{36}$/;

test('portão: 401/403 com código para cada papel', () => comMock(async base => {
  assert.deepEqual((await fetch(base + '/api/leads')).status, 401);
  assert.equal((await (await fetch(base + '/api/leads')).json()).codigo, 'sem_login');
  const exp = await fetch(base + '/api/leads', {headers: {Authorization: 'Bearer expirado'}}); assert.equal(exp.status, 401); assert.equal((await exp.json()).codigo, 'token_expirado');
  for (const [papel, status, codigo] of [['desativado', 401, 'desativado'], ['agenda', 403, 'sem_acesso_app'], ['sem_app', 403, 'sem_acesso_app'], ['trocar_senha', 403, 'precisa_trocar_senha']]) {
    const r = await F(base, papel)('/api/leads'); assert.equal(r.status, status, papel); assert.equal(r.corpo.codigo, codigo, papel);
  }
  for (const papel of ['admin', 'gestor', 'atendente', 'mfa']) assert.equal((await F(base, papel)('/api/leads')).status, 200, papel);
  // perfil continua acessível para a troca obrigatória mostrar a tela certa
  const p = await F(base, 'trocar_senha')('/api/perfil'); assert.equal(p.status, 200); assert.equal(p.corpo.precisa_trocar_senha, true);
}));

test('?papel= vira cookie e o index injeta o Supabase falso do papel', () => comMock(async base => {
  const r = await fetch(base + '/?papel=gestor');
  assert.match(r.headers.get('set-cookie') || '', /mock_papel=gestor/);
  const html = await r.text(); assert.ok(html.includes('window.__MOCK_PAPEL="gestor"')); assert.ok(html.includes('getAuthenticatorAssuranceLevel'));
  assert.ok(!(await (await fetch(base + '/?papel=root')).text()).includes('"root"'), 'papel desconhecido cai no padrão');
}));

test('vendedores e equipe/nomes; responsável com as regras do servidor', () => comMock(async base => {
  const at = F(base, 'atendente'), ge = F(base, 'gestor');
  const v = (await at('/api/vendedores')).corpo.vendedores;
  assert.ok(v.length >= 4 && v.every(x => UUID.test(x.id) && 'abertos' in x && 'avatar_cor' in x)); assert.ok(!v.some(x => x.papel === 'agenda'));
  assert.equal(v.filter(x => x.eu).length, 1);
  const nomes = (await at('/api/equipe/nomes')).corpo;
  for (const n of nomes) assert.deepEqual(Object.keys(n).sort(), ['avatar_cor', 'id', 'nome', 'papel']);
  const leads = (await at('/api/leads')).corpo, EU = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  const meu = leads.find(l => l.responsavel_id === EU), alheio = leads.find(l => l.responsavel_id && l.responsavel_id !== EU), sem = leads.find(l => !l.responsavel_id);
  const passa = await at(`/api/leads/${meu.id}/responsavel`, {method: 'PATCH', body: JSON.stringify({responsavel_id: v[1].id})});
  assert.equal(passa.status, 200); assert.equal(passa.corpo.mudou, true); assert.equal(passa.corpo.lead.responsavel_id, v[1].id);
  assert.equal((await at(`/api/leads/${alheio.id}/responsavel`, {method: 'PATCH', body: JSON.stringify({responsavel_id: EU})})).status, 403, 'atendente não pega lead de outro');
  assert.equal((await at(`/api/leads/${sem.id}/responsavel`, {method: 'PATCH', body: JSON.stringify({responsavel_id: 'eu'})})).corpo.lead.responsavel_id, EU, 'pega lead sem dono');
  assert.equal((await at(`/api/leads/${sem.id}/responsavel`, {method: 'PATCH', body: JSON.stringify({responsavel_id: null})})).status, 403, 'só gestor tira o dono');
  assert.equal((await ge(`/api/leads/${sem.id}/responsavel`, {method: 'PATCH', body: JSON.stringify({responsavel_id: null})})).corpo.lead.responsavel_id, null);
  assert.equal((await ge(`/api/leads/${sem.id}/responsavel`, {method: 'PATCH', body: JSON.stringify({responsavel_id: '00000000-0000-4000-8000-999999999999'})})).status, 400);
  assert.equal((await at('/api/leads/responsavel-lote', {method: 'POST', body: JSON.stringify({ids: [sem.id], responsavel_id: EU})})).status, 403, 'lote é do gestor');
  const lote = await ge('/api/leads/responsavel-lote', {method: 'POST', body: JSON.stringify({ids: leads.slice(0, 3).map(l => l.id), responsavel_id: EU})});
  assert.equal(lote.corpo.atualizados, 3); assert.equal(lote.corpo.ids.length, 3);
  assert.equal((await ge('/api/leads/responsavel-lote', {method: 'POST', body: JSON.stringify({ids: [], responsavel_id: null})})).status, 400);
}));

test('metas no formato do servidor: loja e pessoas com itens; PUT {mes, metas} só gestor', () => comMock(async base => {
  const mes = new Date().toISOString().slice(0, 7);
  const g = await F(base, 'atendente')('/api/metas?mes=' + mes);
  assert.equal(g.status, 200); assert.equal(g.corpo.mes, mes); assert.equal(g.corpo.loja.meta.faturamento, 30000);
  for (const k of ['leads', 'agendamentos', 'vendas', 'faturamento']) assert.equal(typeof g.corpo.loja.itens[k].realizado, 'number');
  assert.ok(g.corpo.pessoas.every(p => UUID.test(p.perfil_id) && 'itens' in p && 'meta' in p));
  assert.equal((await F(base, 'atendente')('/api/metas?mes=' + mes, {method: 'PUT', body: JSON.stringify({mes, metas: [{perfil_id: null, leads: 1}]})})).corpo.codigo, 'papel_insuficiente');
  const p = await F(base, 'gestor')('/api/metas?mes=2026-11', {method: 'PUT', body: JSON.stringify({mes: '2026-11', metas: [{perfil_id: null, leads: 70, agendamentos: 35, vendas: 22, faturamento: 33000}]})});
  assert.equal(p.status, 200); assert.equal(p.corpo.ok, true);
  assert.equal((await F(base)('/api/metas?mes=2026-11')).corpo.loja.meta.faturamento, 33000);
  assert.equal((await F(base, 'gestor')('/api/metas?mes=2026-11', {method: 'PUT', body: JSON.stringify({mes: '2026-11', metas: []})})).status, 400);
  assert.equal((await F(base)('/api/metas?mes=2026-13')).status, 400);
  assert.ok(Array.isArray((await F(base)('/api/metas?mes=' + mes + '&formato=lista')).corpo), 'formato plano do contrato antigo');
}));

test('desempenho por mes ou dias: gestor vê todos, atendente só os próprios', () => comMock(async base => {
  const r = await F(base, 'gestor')('/api/desempenho?mes=2026-10');
  assert.equal(r.status, 200); assert.ok(r.corpo.pessoas.length >= 4 && Array.isArray(r.corpo.ranking));
  for (const x of r.corpo.pessoas) for (const k of ['perfil_id', 'nome', 'leads', 'agendados', 'vendas', 'faturamento', 'conversao', 'tempo_resposta_min']) assert.ok(k in x, k);
  assert.ok(!r.corpo.pessoas.some(x => /Franklin/.test(x.nome)), 'papel agenda fica fora');
  assert.equal((await F(base, 'gestor')('/api/desempenho?dias=7')).corpo.periodo.dias, 7);
  const a = await F(base, 'atendente')('/api/desempenho?mes=2026-10');
  assert.equal(a.status, 200); assert.deepEqual(a.corpo.pessoas.map(x => x.perfil_id), ['aaaaaaaa-aaaa-4aaa-8aaa-000000000001']);
}));

test('apagar lead: atendente leva 403 com código; gestor apaga', () => comMock(async base => {
  const l = (await F(base)('/api/leads')).corpo[5];
  const a = await F(base, 'atendente')('/api/leads/' + l.id, {method: 'DELETE'}); assert.equal(a.status, 403); assert.equal(a.corpo.codigo, 'papel_insuficiente');
  assert.equal((await F(base, 'gestor')('/api/leads/' + l.id, {method: 'DELETE'})).status, 200);
}));

test('banco falso: tarefas da equipe, notificações só minhas, perfil protegido', () => comMock(async base => {
  const sb = (q, papel = 'atendente') => fetch(base + '/__sb', {method: 'POST', headers: {Cookie: 'mock_papel=' + papel}, body: JSON.stringify({select: '*', filtros: [], ordem: [], ...q})}).then(r => r.json());
  const t = await sb({tabela: 'tarefas', op: 'select', filtros: [['eq', 'status', 'aberta'], ['eq', 'responsavel_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001']], ordem: [['vence_em', true, false]]});
  assert.ok(t.data.length >= 5); assert.equal(t.data.at(-1).vence_em, null, 'sem data por último');
  const nova = await sb({tabela: 'tarefas', op: 'insert', valores: {titulo: 'Teste', prioridade: 3}, devolver: 'id,titulo,criado_por,status', unico: 'single'});
  assert.equal(nova.data.criado_por, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'); assert.equal(nova.data.status, 'aberta');
  const feita = await sb({tabela: 'tarefas', op: 'update', valores: {status: 'feita'}, filtros: [['eq', 'id', nova.data.id]], devolver: 'status,concluida_em', unico: 'maybe'});
  assert.equal(feita.data.status, 'feita'); assert.ok(feita.data.concluida_em);
  assert.equal((await sb({tabela: 'tarefas', op: 'select'}, 'agenda')).error.code, '42501', 'papel agenda não lê tarefas');
  const n = await sb({tabela: 'notificacoes', op: 'select'}); assert.ok(n.data.every(x => x.perfil_id === 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'));
  const pr = await sb({tabela: 'perfis', op: 'update', valores: {papel: 'admin'}, filtros: [['eq', 'id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001']]});
  assert.match(pr.error.message, /administrador/);
  assert.equal((await sb({tabela: 'perfis', op: 'update', valores: {nome: 'x'}, filtros: [['eq', 'id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002']]})).error.code, '42501');
}));

test('realtime falso: notificação nova chega pelo SSE', () => comMock(async base => {
  const ctrl = new AbortController();
  const r = await fetch(base + '/__sb/eventos', {signal: ctrl.signal}); const leitor = r.body.getReader();
  await leitor.read();                                    // ": ok"
  await fetch(base + '/__mock/notificar', {method: 'POST', body: JSON.stringify({titulo: 'Oi do teste', link: '/?lead=22222222-2222-4222-8222-000000000001'})});
  const {value} = await leitor.read(); const txt = new TextDecoder().decode(value);
  assert.match(txt, /"table":"notificacoes"/); assert.match(txt, /"eventType":"INSERT"/); assert.match(txt, /Oi do teste/);
  ctrl.abort();
}));
