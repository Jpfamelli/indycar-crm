/* server.js real + db-supabase.js real sobre banco em memória: porteiro,
   JSON, limites, cache, preferências, cabeçalhos de segurança e CORS. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, U } = require('./servidor-falso.cjs');

const CLI = U(1);

test('servidor real: porteiro, JSON, limites, cache e preferências', async () => {
  const s = await subirServidor({ tabelas: {
    vigia_estado: [{ problema: 'Aviso fictício', desde: '2026-10-09', ultimo_resumo: 'não publicar' }],
    clientes: [{ id: CLI, nome: 'Cliente Fictício', telefone: '12900000001', aceita_mensagens: true }],
  } });
  try {
    assert.equal((await s.req(null, '/api/leads')).status, 401);
    assert.equal((await s.req('admin', '/api/leads', { method: 'POST', body: '{' })).status, 400);
    assert.equal((await s.req('admin', '/api/leads', { body: { nome: 'Teste', telefone: '123' } })).status, 400);
    assert.equal((await s.req('admin', '/api/leads', { body: { nome: 'Teste', telefone: '12900000001', observacoes: 'a'.repeat(66000) } })).status, 413);
    const st = await s.req('admin', '/api/stats');
    assert.equal(st.headers.get('cache-control'), 'no-store');
    assert.equal(st.headers.get('x-content-type-options'), 'nosniff');
    const leiturasLeads = () => s.sb.chamadas.filter(c => c.tabela === 'leads' && c.modo === 'select').length;
    const antes = leiturasLeads();
    await s.req('admin', '/api/stats');
    assert.equal(leiturasLeads(), antes, 'segunda leitura vem do cache de 60 s');
    assert.equal((await s.req('admin', '/api/leads', { body: { nome: 'Teste', telefone: '12900000001' } })).status, 201);
    await s.req('admin', '/api/stats');
    assert.ok(leiturasLeads() > antes, 'gravar invalida o cache');
    const saude = (await s.req('admin', '/api/saude')).corpo;
    assert.equal(saude.avisos.length, 1); assert.equal(saude.avisos[0].ultimo_resumo, undefined);
    assert.equal((await s.req('admin', '/api/clientes/' + CLI, { method: 'PATCH', body: { aceita_mensagens: false } })).status, 200);
    assert.equal(s.db.clientes[0].aceita_mensagens, false);
  } finally { await s.fechar(); }
});

test('segurança: cabeçalhos, CSP da página com hash do script, CORS só do ecossistema, 415 e corpo que não é objeto', async () => {
  const s = await subirServidor();
  try {
    const pag = await fetch(s.url + '/');
    const csp = pag.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net 'sha256-[A-Za-z0-9+/=]+'/, 'script embutido do tema entra por hash');
    assert.match(csp, /connect-src 'self' http:\/\/falso\.invalid wss:\/\/falso\.invalid/);
    assert.equal(pag.headers.get('x-frame-options'), 'DENY');
    assert.match(pag.headers.get('permissions-policy'), /camera=\(\)/);
    assert.equal(pag.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const api = await s.req(null, '/api/config');
    assert.equal(api.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(api.corpo.supabaseAnonKey, 'publica-ficticia');
    assert.ok(!JSON.stringify(api.corpo).includes('servico-ficticia'), 'a chave de serviço nunca sai');

    // CORS
    const bom = await fetch(s.url + '/api/config', { headers: { Origin: 'https://indycar-atendimento.onrender.com' } });
    assert.equal(bom.headers.get('access-control-allow-origin'), 'https://indycar-atendimento.onrender.com');
    const ruim = await fetch(s.url + '/api/config', { headers: { Origin: 'https://site-malicioso.invalid' } });
    assert.equal(ruim.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(s.url + '/api/leads', { method: 'OPTIONS', headers: { Origin: 'https://site-malicioso.invalid' } })).status, 403);
    const pre = await fetch(s.url + '/api/leads', { method: 'OPTIONS', headers: { Origin: 'https://indycar-orcador.netlify.app' } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);

    // corpo
    const form = await s.req('admin', '/api/tarefas', { method: 'POST', body: 'titulo=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    assert.equal((await s.req('admin', '/api/tarefas', { method: 'POST', body: '[1,2]' })).status, 400);
    assert.equal((await s.req('admin', '/api/tarefas', { method: 'POST', body: '"texto"' })).status, 400);
    assert.equal((await s.req('admin', '/api/leads', { method: 'PURGE' })).status, 405);
    // erro interno não vaza detalhe
    s.sb.falhar(['catalogo_servicos']);
    const cat = await s.req('admin', '/api/catalogo');
    assert.equal(cat.status, 503); assert.doesNotMatch(cat.corpo.erro, /falha simulada/);
    // path traversal
    for (const cam of ['/..%2f..%2fserver.js', '/%2e%2e/server.js', '/../.env']) assert.ok([403, 404].includes((await fetch(s.url + cam)).status), cam);
  } finally { await s.fechar(); }
});

test('freio: 40 tokens recusados seguidos do mesmo IP bloqueiam por um tempo', async () => {
  const s = await subirServidor();
  try {
    let r;
    for (let i = 0; i < 40; i++) r = await s.req(null, '/api/leads', { headers: { Authorization: `Bearer tok-invalido-${i}-xxxxxxxx` } });
    assert.equal(r.status, 401);
    r = await s.req('admin', '/api/leads');
    assert.equal(r.status, 429, 'depois de 40 falhas, até o login bom espera');
    assert.equal(r.corpo.codigo, 'limite');
  } finally { await s.fechar(); }
});

test('leads acima de 1000 vêm inteiros; perfil valida campos; integrações e catálogo auditados; auditoria sem segredo', async () => {
  const muitos = Array.from({ length: 1500 }, (_, i) => ({ id: U(5000 + i), nome: `L${i}`, telefone: '12900000001', status: 'novo', origem: 'google', valor_orcado: 0, valor_pago: 0, created_at: new Date(Date.now() - i * 1000).toISOString() }));
  const s = await subirServidor({ tabelas: { leads: muitos, catalogo_servicos: [{ id: U(77), servico: 'Freios', fazemos: true }], integracoes_ads: [] } });
  try {
    assert.equal((await s.req('gestor', '/api/leads')).corpo.length, 1500, 'antes cortava em 1000');
    // perfil
    assert.equal((await s.req('atendente', '/api/perfil', { method: 'PATCH', body: { telefone: '123' } })).status, 400);
    assert.equal((await s.req('atendente', '/api/perfil', { method: 'PATCH', body: { avatar_cor: 'red' } })).status, 400);
    assert.equal((await s.req('atendente', '/api/perfil', { method: 'PATCH', body: { preferencias: [1] } })).status, 400);
    const ok = await s.req('atendente', '/api/perfil', { method: 'PATCH', body: { cargo: 'Consultora', telefone: '(12) 99999-0000', avatar_cor: '#112233', preferencias: { som: false } } });
    assert.equal(ok.status, 200);
    const eu = s.db.perfis.find(p => p.email === 'ana@teste.invalid');
    assert.equal(eu.cargo, 'Consultora'); assert.equal(eu.telefone, '12999990000'); assert.equal(eu.avatar_cor, '#112233');
    assert.equal(eu.papel, 'atendente', 'perfil não muda papel');
    assert.equal((await s.req('atendente', '/api/perfil', { method: 'PATCH', body: { papel: 'admin', nome: 'Ana' } })).status, 200);
    assert.equal(s.db.perfis.find(p => p.email === 'ana@teste.invalid').papel, 'atendente', 'campo papel é ignorado');
    // integrações e catálogo: só admin, auditados sem o valor do segredo
    assert.equal((await s.req('gestor', '/api/integracoes/meta', { method: 'PATCH', body: { meta_access_token: 'segredo-que-nao-pode-vazar-123' } })).status, 403);
    assert.equal((await s.req('admin', '/api/integracoes/meta', { method: 'PATCH', body: { meta_access_token: 'segredo-que-nao-pode-vazar-123', meta_ad_account_id: 'act_1' } })).status, 200);
    const aud = s.db.auditoria.find(a => a.acao === 'integracao_salvar');
    assert.ok(aud && !JSON.stringify(aud).includes('segredo-que-nao-pode-vazar'));
    assert.equal((await s.req('admin', `/api/catalogo/${U(77)}`, { method: 'PATCH', body: { fazemos: false } })).status, 200);
    assert.ok(s.db.auditoria.some(a => a.acao === 'catalogo_fazemos' && a.detalhes.fazemos === false));
    const lista = (await s.req('admin', '/api/integracoes')).corpo.canais.find(c => c.canal === 'meta');
    assert.equal(lista.meta_access_token, null); assert.match(lista.meta_access_token_mask, /^•+-123$/);
  } finally { await s.fechar(); }
});

test('auditoria: campos com cara de segredo viram •••', () => {
  const { limparDetalhes } = require('../lib/auditoria');
  const d = limparDetalhes({ token: 'abc', api_key: 'x', nested: { senha: '1', ok: 'sim' }, texto: 'a'.repeat(900) });
  assert.equal(d.token, '•••'); assert.equal(d.api_key, '•••'); assert.equal(d.nested.senha, '•••'); assert.equal(d.nested.ok, 'sim');
  assert.equal(d.texto.length, 500);
});
