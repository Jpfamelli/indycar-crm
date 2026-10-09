import {test} from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import {criarMock} from '../scripts/mock-server.mjs';
async function comMock(fn, op) { const s = criarMock(op); await new Promise(r => s.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${s.address().port}`; try { await fn(base); } finally { await new Promise(r => s.close(r)); } }
const j = async (r) => ({status: r.status, corpo: await r.json()});

test('servidor falso serve interface real e mantém mutações isoladas', () => comMock(async base => {
  const html = await (await fetch(base)).text();
  assert.ok(html.includes("access_token:'ficticio'")); assert.ok(html.includes('melhorias.js')); assert.ok(!html.includes('cdn.jsdelivr'));
  for (const id of ['iaSlotLead', 'iaSlotPainel', 'iaSlotTela']) assert.match(html, new RegExp(`<section id="${id}"[^>]*aria-label="IA"`));
  const c = (await (await fetch(base + '/api/clientes')).json()).clientes[0];
  const r = await fetch(base + '/api/clientes/' + c.id, {method: 'PATCH', body: JSON.stringify({aceita_mensagens: true, nascimento: '1904-03-12'})});
  assert.equal((await r.json()).cliente.aceita_mensagens, true); assert.equal((await fetch(base + '/api/saude')).status, 200);
  assert.equal((await fetch(base + '/api/leads', {method: 'POST', body: '{x'})).status, 400);
}));

test('base fictícia grande e coerente para testar a tela', () => comMock(async base => {
  const leads = await (await fetch(base + '/api/leads')).json(), cli = await (await fetch(base + '/api/clientes')).json();
  assert.equal(leads.length, 90); assert.equal(cli.totalBase, 2500);
  assert.ok(leads.every(l => l.updated_at && l.created_at && (['concluido', 'perdido'].includes(l.status) ? l.closed_at : l.closed_at === null)));
  const l = leads.find(x => x.status === 'novo');
  const p = await (await fetch(base + '/api/leads/' + l.id, {method: 'PATCH', body: JSON.stringify({status: 'perdido', observacoes: 'Motivo da perda: Teste'})})).json();
  assert.equal(p.status, 'perdido'); assert.ok(p.closed_at); assert.ok(p.updated_at >= l.updated_at);
  assert.equal((await fetch(base + '/api/leads/' + l.id, {method: 'PATCH', body: JSON.stringify({status: 'xyz'})})).status, 400);
}));

test('rotas da IA no formato do servidor real', () => comMock(async base => {
  const l = (await (await fetch(base + '/api/leads')).json())[0];
  const ctx = await (await fetch(`${base}/api/ia/lead/${l.id}/contexto`)).json();
  for (const k of ['lead', 'leads', 'cliente', 'mensagens', 'agendamentos', 'orcamentos', 'comunicar', 'satisfacao', 'sinais', 'links']) assert.ok(k in ctx, k);
  const pa = (await j(await fetch(`${base}/api/ia/lead/${l.id}/proxima-acao`, {method: 'POST'}))).corpo;
  assert.ok(pa.acao.id); for (const k of ['acao', 'prioridade', 'justificativa', 'texto_mensagem', 'novo_status', 'motivo_perda']) assert.ok(k in pa.proposta, k);
  assert.ok('plano' in pa && Array.isArray(pa.avisos) && pa.automatico === false && pa.autonomia);
  const q = (await (await fetch(`${base}/api/ia/lead/${l.id}/qualificar`, {method: 'POST'})).json()).qualificacao;
  assert.deepEqual(Object.keys(q).sort(), ['motivo', 'probabilidade', 'sinais', 'temperatura']);
  const pr = await (await fetch(`${base}/api/ia/lead/${l.id}/preencher`, {method: 'POST'})).json();
  assert.ok(Array.isArray(pr.campos) && pr.campos.every(c => 'campo' in c && 'atual' in c && 'sugerido' in c && 'vazio' in c));
  const tr = await (await fetch(base + '/api/ia/triagem', {method: 'POST'})).json();
  for (const k of ['itens', 'novos', 'porIA', 'erroIA', 'total']) assert.ok(k in tr, k);
  const pe = await (await fetch(base + '/api/ia/perguntar', {method: 'POST', body: JSON.stringify({pergunta: 'Quantos leads?'})})).json();
  assert.ok(pe.id && pe.pergunta && pe.resposta && Array.isArray(pe.leads) && 'semDados' in pe);
  const ex = await j(await fetch(`${base}/api/ia/acoes/${pa.acao.id}/executar`, {method: 'POST', body: '{}'}));
  assert.equal(ex.status, 200); for (const k of ['ok', 'abrir', 'texto', 'mudou']) assert.ok(k in ex.corpo, k);
  assert.equal((await fetch(`${base}/api/ia/acoes/${pa.acao.id}/executar`, {method: 'POST', body: '{}'})).status, 409);
  assert.ok(Array.isArray((await (await fetch(base + '/api/ia/acoes')).json()).acoes));
  const uso = await (await fetch(base + '/api/ia/uso')).json();
  for (const k of ['ativo', 'configurada', 'autonomia', 'hoje', 'limite', 'restante', 'doCrmHoje', 'porTipo', 'tokensHoje']) assert.ok(k in uso, k);
}));

test('lead por telefone aceita DDI e devolve cliente, leads, aberto e lead', () => comMock(async base => {
  const r = await (await fetch(base + '/api/lead-por-telefone?tel=5512900000001')).json();
  assert.equal(r.cliente.id, '11111111-1111-4111-8111-111111111111'); assert.ok(r.leads.length >= 1); assert.equal(r.lead.id, (r.aberto || r.leads[0]).id);
  const nada = await (await fetch(base + '/api/lead-por-telefone?tel=1100000000')).json();
  assert.equal(nada.lead, null); assert.equal(nada.cliente, null);
}));

test('script de teste da IA só entra quando pedido', () => {
  const arq = new URL('./_ia-teste-tmp.js', import.meta.url);
  fs.writeFileSync(arq, 'window.__iaTeste = 1;');
  return comMock(async base => {
    assert.ok((await (await fetch(base)).text()).includes('/__ia-teste.js'));
    assert.equal(await (await fetch(base + '/__ia-teste.js')).text(), 'window.__iaTeste = 1;');
  }, {iaTeste: arq}).finally(() => fs.unlinkSync(arq));
});
