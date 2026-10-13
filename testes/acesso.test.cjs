/* Porteiro do CRM: papéis (admin/gestor/atendente/agenda/sem app/desativado),
   códigos 401/403, GET /api/eu, último acesso a cada 5 min e corte imediato. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, PESSOAS } = require('./servidor-falso.cjs');
const { criarAcesso, poderes } = require('../lib/acesso');
const { criarFakeSb } = require('./ia-fake-sb.cjs');

test('papéis: quem entra no CRM e com que código cada um é barrado', async () => {
  const s = await subirServidor();
  try {
    assert.equal((await s.req('admin', '/api/leads')).status, 200, 'admin entra mesmo sem "crm" nos apps');
    assert.equal((await s.req('gestor', '/api/leads')).status, 200);
    assert.equal((await s.req('atendente', '/api/leads')).status, 200);
    const ag = await s.req('agenda', '/api/leads');
    assert.equal(ag.status, 403); assert.equal(ag.corpo.codigo, 'sem_acesso_app');
    assert.deepEqual(ag.corpo.apps.map(a => a.app), ['agenda'], 'mostra para onde a pessoa pode ir');
    const sa = await s.req('semApp', '/api/leads');
    assert.equal(sa.status, 403); assert.equal(sa.corpo.codigo, 'sem_acesso_app');
    assert.deepEqual(sa.corpo.apps.map(a => a.app), ['atendimento']);
    const de = await s.req('desativado', '/api/leads');
    assert.equal(de.status, 401); assert.equal(de.corpo.codigo, 'desativado');
    const nada = await s.req(null, '/api/leads');
    assert.equal(nada.status, 401); assert.equal(nada.corpo.codigo, 'sem_login');
    const inval = await s.req(null, '/api/leads', { headers: { Authorization: 'Bearer tok-invalido-qualquer-coisa' } });
    assert.equal(inval.status, 401); assert.equal(inval.corpo.codigo, 'sessao_invalida');
    // JWT vencido nem vai ao Auth
    const carga = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString('base64url');
    const antes = s.auth.chamadas;
    const venc = await s.req(null, '/api/leads', { headers: { Authorization: `Bearer xxx.${carga}.yyy` } });
    assert.equal(venc.status, 401); assert.equal(venc.corpo.codigo, 'sessao_expirada'); assert.equal(s.auth.chamadas, antes);
    // perfil inexistente
    const sp = await s.req('11111111-2222-4333-8444-555555555555', '/api/leads');
    assert.equal(sp.status, 403); assert.equal(sp.corpo.codigo, 'sem_perfil');
    // Auth fora do ar: 503, não 401 (a tela não deve deslogar ninguém)
    s.auth.fora = true;
    const fora = await s.req('gestor', '/api/leads');
    assert.equal(fora.status, 503); assert.equal(fora.corpo.codigo, 'indisponivel');
  } finally { await s.fechar(); }
});

test('GET /api/eu: perfil, apps, poderes e troca obrigatória de senha', async () => {
  const s = await subirServidor();
  try {
    const eu = (await s.req('trocarSenha', '/api/eu')).corpo;
    assert.equal(eu.id, PESSOAS.trocarSenha.id);
    assert.equal(eu.papel, 'atendente'); assert.equal(eu.precisa_trocar_senha, true);
    assert.equal(eu.app, 'crm'); assert.equal(eu.ehGestor, false);
    assert.equal(eu.pode.apagarLead, false); assert.equal(eu.pode.metas, false);
    assert.ok(eu.outrosApps.some(a => a.app === 'atendimento' && /^https:\/\//.test(a.url)));
    const g = (await s.req('gestor', '/api/eu')).corpo;
    assert.equal(g.ehGestor, true); assert.equal(g.pode.apagarLead, true); assert.equal(g.pode.equipe, false);
    const a = (await s.req('admin', '/api/eu')).corpo;
    assert.equal(a.ehAdmin, true); assert.equal(a.pode.equipe, true);
    assert.equal(a.email, 'admin@teste.invalid');
    assert.ok(!JSON.stringify(a).includes('servico-ficticia'), 'nada de segredo no /api/eu');
  } finally { await s.fechar(); }
});

test('último acesso gravado no máximo a cada 5 min (relógio injetável)', async () => {
  let t = Date.parse('2026-10-13T12:00:00Z');
  const sb = criarFakeSb({ perfis: [{ id: 'p1', papel: 'atendente', ativo: true, apps: ['crm'] }] });
  const ac = criarAcesso({ supabaseUrl: 'http://x.invalid', anonKey: 'k', sb, agora: () => t, cacheMs: 1,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ id: 'p1' }) }) });
  const pedir = n => ac.autenticar({ headers: { authorization: `Bearer token-de-teste-${n}` } });
  const updates = () => sb.chamadas.filter(c => c.tabela === 'perfis' && c.modo === 'update').length;
  assert.equal((await pedir(1)).ok, true);
  assert.equal(updates(), 1); assert.equal(sb.db.perfis[0].ultimo_app, 'crm');
  t += 60_000; await pedir(2); assert.equal(updates(), 1, '1 min depois: não grava');
  t += 4 * 60_000 + 1000; await pedir(3); assert.equal(updates(), 2, '5 min depois: grava de novo');
  assert.equal(sb.db.perfis[0].ultimo_acesso_em, new Date(t).toISOString());
});

test('cache do login: desativar pela equipe corta na hora o mesmo token', async () => {
  const s = await subirServidor();
  try {
    const tok = `Bearer tok-${PESSOAS.atendente.id}-fixo`;
    assert.equal((await s.req(null, '/api/leads', { headers: { Authorization: tok } })).status, 200);
    const antes = s.auth.chamadas;
    assert.equal((await s.req(null, '/api/leads', { headers: { Authorization: tok } })).status, 200);
    assert.equal(s.auth.chamadas, antes, 'segundo pedido vem do cache');
    const r = await s.req('admin', '/api/equipe/ativo', { body: { id: PESSOAS.atendente.id, ativo: false } });
    assert.equal(r.status, 200);
    assert.ok(s.db.perfis.find(p => p.id === PESSOAS.atendente.id).desativado_em, 'grava quando foi desativado');
    const depois = await s.req(null, '/api/leads', { headers: { Authorization: tok } });
    assert.equal(depois.status, 401); assert.equal(depois.corpo.codigo, 'desativado');
    assert.ok(s.db.auditoria.some(a => a.acao === 'equipe_desativar' && a.perfil_id === PESSOAS.admin.id));
  } finally { await s.fechar(); }
});

test('equipe: gestor vê todos, atendente só a si; papel gestor existe; apps e recebe leads auditados', async () => {
  const s = await subirServidor();
  try {
    assert.equal((await s.req('gestor', '/api/equipe')).corpo.equipe.length, Object.keys(PESSOAS).length);
    assert.equal((await s.req('atendente', '/api/equipe')).corpo.equipe.length, 1);
    assert.equal((await s.req('gestor', '/api/equipe/papel', { body: { id: PESSOAS.atendente.id, papel: 'gestor' } })).status, 403, 'papel só o admin');
    const p = await s.req('admin', '/api/equipe/papel', { body: { id: PESSOAS.atendente.id, papel: 'gestor' } });
    assert.equal(p.status, 200); assert.equal(p.corpo.papel, 'gestor');
    const ag = await s.req('admin', '/api/equipe/papel', { body: { id: PESSOAS.atendente2.id, papel: 'agenda' } });
    assert.deepEqual(ag.corpo.apps, ['agenda'], 'papel agenda fica só com a Agenda');
    assert.equal((await s.req('admin', '/api/equipe/apps', { body: { id: PESSOAS.semApp.id, apps: ['crm', 'hackear'] } })).status, 400);
    assert.equal((await s.req('atendente2', '/api/equipe/apps', { body: { id: PESSOAS.semApp.id, apps: ['crm'] } })).status, 403);
    assert.equal((await s.req('admin', '/api/equipe/apps', { body: { id: PESSOAS.semApp.id, apps: ['crm', 'atendimento'] } })).status, 200);
    assert.equal((await s.req('semApp', '/api/leads')).status, 200, 'ganhou o CRM: entra');
    assert.equal((await s.req('atendente2', '/api/equipe/recebe-leads', { body: { id: PESSOAS.gestor.id, recebe_leads: true } })).status, 403);
    assert.equal((await s.req('gestor', '/api/equipe/recebe-leads', { body: { id: PESSOAS.gestor.id, recebe_leads: true } })).status, 200);
    const acoes = s.db.auditoria.map(a => a.acao);
    for (const a of ['equipe_papel', 'equipe_apps', 'equipe_recebe_leads']) assert.ok(acoes.includes(a), a);
    // senha temporária: admin, nunca para si, devolve a senha uma vez e marca a troca
    assert.equal((await s.req('admin', '/api/equipe/senha-temporaria', { body: { id: PESSOAS.admin.id } })).status, 400);
    const st = await s.req('admin', '/api/equipe/senha-temporaria', { body: { id: PESSOAS.gestor.id } });
    assert.equal(st.status, 200); assert.equal(st.corpo.senha.length, 12);
    assert.equal(s.db.perfis.find(x => x.id === PESSOAS.gestor.id).precisa_trocar_senha, true);
    const aud = s.db.auditoria.find(a => a.acao === 'equipe_senha_temporaria');
    assert.ok(aud && !JSON.stringify(aud).includes(st.corpo.senha), 'a senha não vai para a auditoria');
    // criar pessoa: papel gestor aceito, apps validados, troca obrigatória ligada
    const nova = await s.req('admin', '/api/equipe', { body: { nome: 'Carla', email: 'carla@teste.invalid', senha: 'senha-de-teste-123', papel: 'gestor', apps: ['crm'] } });
    assert.equal(nova.status, 201); assert.equal(nova.corpo.papel, 'gestor'); assert.equal(nova.corpo.precisa_trocar_senha, true);
    const linha = s.db.perfis.find(x => x.id === nova.corpo.id);
    assert.equal(JSON.stringify(linha.apps), '["crm"]'); assert.equal(linha.convidado_por, PESSOAS.admin.id);
  } finally { await s.fechar(); }
});

test('poderes por papel', () => {
  assert.equal(poderes({ papel: 'atendente' }).apagarLead, false);
  assert.equal(poderes({ papel: 'gestor' }).metas, true);
  assert.equal(poderes({ papel: 'gestor' }).integracoes, false);
  assert.equal(poderes({ papel: 'admin' }).auditoria, true);
});
