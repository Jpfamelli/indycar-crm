/* Servidor REAL (server.js) com banco em memória, login falso e IA falsa:
   rotas /api/ia/*, papéis, validações, limites e /api/saude com a IA. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { criarFakeSb, criarIAFalsa } = require('./ia-fake-sb.cjs');

const RAIZ = path.resolve(__dirname, '..');
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLI = U(1), L1 = U(11), L2 = U(12), CV = U(21);

function tabelas() {
  const agora = new Date().toISOString();
  return {
    ia_config: [{ id: true, ativo: true, modelo_rapido: 'modelo-rapido-teste', modelo_forte: 'modelo-forte-teste', autonomia: 'confirmar', limite_chamadas_dia: 500 }],
    ia_acoes: [],
    perfis: [],
    vigia_estado: [{ problema: null, desde: null }],
    clientes: [{ id: CLI, nome: 'Cliente Fictício', telefone: '5512900000001', telefone_e164: '12900000001', aceita_mensagens: true, created_at: agora }],
    leads: [
      { id: L1, cliente_id: CLI, nome: 'Cliente Fictício', telefone: '5512900000001', status: 'orcamento', origem: 'whatsapp', valor_orcado: 900, valor_pago: 0, observacoes: '', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z' },
      { id: L2, cliente_id: null, nome: 'Outro', telefone: '5512900000002', status: 'novo', origem: 'google', valor_orcado: 0, valor_pago: 0, observacoes: '', created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z' },
    ],
    conversas: [{ id: CV, cliente_id: CLI, telefone_e164: '12900000001', ultima_mensagem_em: agora, created_at: agora }],
    whatsapp_mensagens: [{ id: U(51), conversa_id: CV, direcao: 'entrada', corpo: 'Tenho um Onix 2019', created_at: agora }],
    catalogo_servicos: [], posvenda_envios: [], posvenda_respostas: [], orc_orcamentos: [], agendamentos: [], v_cliente_360: [], etapas_funil: [],
  };
}

async function subir({ roteiros = [], papel = 'admin', usuario = 'u-teste' } = {}) {
  const sb = criarFakeSb(tabelas());
  const ia = criarIAFalsa(roteiros);
  const login = { papel, id: usuario };
  const store = {
    async getStats() { return {}; },
    async getLead(id) { return sb.db.leads.find(l => l.id === id) || null; },
    async updateLead(id, d) { const l = sb.db.leads.find(x => x.id === id); Object.assign(l, d); return l; },
    async atualizarCamposCliente(id, d) { const c = sb.db.clientes.find(x => x.id === id); Object.assign(c, d); return c; },
    async leadsPorTelefone(t) { const d = String(t).replace(/\D/g, ''); if (d.length < 10) throw Object.assign(new Error('Informe o telefone com DDD.'), { status: 400 }); return { cliente: sb.db.clientes[0], leads: sb.db.leads.filter(l => l.telefone.endsWith(d.slice(-8))), aberto: null }; },
    async weeklyData() { return { stats: { semana: { porOrigem: [], porStatus: {}, total: 0, ganhos: 0, perdidos: 0, faturamento: 0, emAberto: 0, ticket: 0, conversao: 0 }, comparativo: { leads: { anterior: 0 }, faturamento: { anterior: 0 } } }, semanaLeads: [] }; },
  };
  const libIA = require('../lib/ia-crm');
  let servidor;
  const sandbox = {
    require: n => n === 'node:http' ? { createServer: fn => (servidor = http.createServer(fn)) }
      : n === './db-supabase' ? store
      : n === '@supabase/supabase-js' ? { createClient: () => sb }
      : n === './lib/ia-crm' ? { ...libIA, criarIACrm: o => libIA.criarIACrm({ ...o, clienteIA: ia }) }
      : n.startsWith('./') ? require(path.join(RAIZ, n)) : require(n),
    __dirname: RAIZ, Buffer, URL, AbortSignal, console: { log() {}, warn() {}, error() {} },
    process: { env: { SUPABASE_URL: 'http://falso', SUPABASE_ANON_KEY: 'ficticia', SUPABASE_SERVICE_ROLE_KEY: 'ficticia', PORT: '0' }, loadEnvFile() {} },
    fetch: async url => ({ ok: true, json: async () => url.includes('/user') ? { id: login.id } : [{ ativo: true, papel: login.papel }] }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'), sandbox);
  await new Promise(r => servidor.once('listening', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let n = 0;
  const req = async (p, opts = {}) => {
    const r = await fetch(base + p, { ...opts, headers: { Authorization: `Bearer token-${login.id}-${n++}`, 'Content-Type': 'application/json', ...opts.headers } });
    let corpo = null; try { corpo = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, corpo };
  };
  const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b || {}) });
  return { sb, ia, login, req, post, base, fechar: () => new Promise(r => servidor.close(r)) };
}

const acaoPerdido = { entrada: { acao: 'marcar_perdido', prioridade: 'media', justificativa: 'Sumiu.', texto_mensagem: null, novo_status: null, motivo_perda: 'Sem resposta' } };

test('rotas da IA: login, ids, contexto, próxima ação, executar com confirmação, histórico e desfazer', async () => {
  const s = await subir({ roteiros: [acaoPerdido] });
  try {
    assert.equal((await fetch(s.base + '/api/ia/uso')).status, 401);
    assert.equal((await s.req('/api/ia/lead/nao-e-uuid/contexto')).status, 400);
    assert.equal((await s.req(`/api/ia/lead/${U(999)}/contexto`)).status, 404);
    const ctx = await s.req(`/api/ia/lead/${L1}/contexto`);
    assert.equal(ctx.status, 200);
    assert.equal(ctx.corpo.lead.id, L1);
    assert.equal(ctx.corpo.conversa.id, CV);
    assert.match(ctx.corpo.links.atendimento, /\?tel=5512900000001$/);
    assert.equal((await s.req(`/api/ia/lead/${L1}/proxima-acao`)).status, 405);

    const pa = await s.post(`/api/ia/lead/${L1}/proxima-acao`);
    assert.equal(pa.status, 200);
    assert.equal(pa.corpo.proposta.acao, 'marcar_perdido');
    assert.equal(pa.corpo.autonomia, 'confirmar');
    const id = pa.corpo.acao.id;
    const sem = await s.post(`/api/ia/acoes/${id}/executar`);
    assert.equal(sem.status, 428); assert.equal(sem.corpo.precisaConfirmar, true);
    const ok = await s.post(`/api/ia/acoes/${id}/executar`, { confirmarFaturamento: true });
    assert.equal(ok.status, 200);
    assert.equal(s.sb.db.leads[0].status, 'perdido');
    assert.equal((await s.post(`/api/ia/acoes/${id}/executar`, { confirmarFaturamento: true })).status, 409);
    const hist = await s.req(`/api/ia/acoes?leadId=${L1}`);
    assert.equal(hist.corpo.acoes[0].desfazivel, true);
    assert.equal((await s.post(`/api/ia/acoes/${id}/desfazer`)).status, 200);
    assert.equal(s.sb.db.leads[0].status, 'orcamento');
    assert.equal((await s.post('/api/ia/acoes/xyz/executar')).status, 400);
    assert.equal((await s.post(`/api/ia/acoes/${U(888)}/recusar`)).status, 404);
    assert.equal((await s.req('/api/ia/acoes?leadId=ruim')).status, 400);
    assert.equal((await s.req('/api/ia/nada')).status, 404);
  } finally { await s.fechar(); }
});

test('desfazer: atendente só desfaz o que ele mesmo executou', async () => {
  const s = await subir({ roteiros: [acaoPerdido], papel: 'atendente', usuario: 'atendente-a' });
  try {
    const pa = await s.post(`/api/ia/lead/${L1}/proxima-acao`);
    await s.post(`/api/ia/acoes/${pa.corpo.acao.id}/executar`, { confirmarFaturamento: true });
    s.login.id = 'atendente-b';
    assert.equal((await s.post(`/api/ia/acoes/${pa.corpo.acao.id}/desfazer`)).status, 403);
    s.login.id = 'atendente-a';
    assert.equal((await s.post(`/api/ia/acoes/${pa.corpo.acao.id}/desfazer`)).status, 200);
  } finally { await s.fechar(); }
});

test('perguntar, triagem, lote, uso, saúde, lead por telefone e resumo mensal', async () => {
  const s = await subir({ roteiros: [
    { entrada: { resposta: 'Um lead esperando orçamento.', leads_citados: [L1], sem_dados: false } },
    { erro: 'IA fora' },                                // triagem cai para as regras
    { texto: '## 📊 O período em uma frase\nMês fraco.' },
  ] });
  try {
    assert.equal((await s.post('/api/ia/perguntar', { pergunta: 42 })).status, 400);
    assert.equal((await s.post('/api/ia/perguntar', { pergunta: 'oi' })).status, 400);
    const p = await s.post('/api/ia/perguntar', { pergunta: 'quem está esperando orçamento há mais de 3 dias?' });
    assert.equal(p.status, 200); assert.deepEqual(p.corpo.leads.map(l => l.id), [L1]);
    assert.equal((await s.post('/api/ia/perguntar', 'não é json')).status, 400);

    const t = await s.post('/api/ia/triagem', { dias: 3 });
    assert.equal(t.status, 200); assert.equal(t.corpo.porIA, false); assert.equal(t.corpo.novos, 2);
    const ids = t.corpo.itens.map(i => i.id);
    assert.equal((await s.post('/api/ia/acoes/executar-lote', { ids: [] })).status, 400);
    const lote = await s.post('/api/ia/acoes/executar-lote', { ids });
    assert.equal(lote.status, 200); assert.equal(lote.corpo.resultados.length, 2);
    assert.ok(lote.corpo.resultados.every(r => r.ok), 'cobrar orçamento e mensagem não mexem em faturamento');

    const u = await s.req('/api/ia/uso');
    assert.equal(u.corpo.limite, 500); assert.equal(u.corpo.autonomia, 'confirmar'); assert.ok(u.corpo.doCrmHoje >= 1);
    const saude = await s.req('/api/saude');
    assert.equal(saude.corpo.ia.ativo, true); assert.equal(saude.corpo.ia.limite, 500);

    assert.equal((await s.req('/api/lead-por-telefone?t=12')).status, 400);
    const tel = await s.req('/api/lead-por-telefone?t=(12)%2090000-0001');
    assert.equal(tel.status, 200); assert.equal(tel.corpo.leads[0].id, L1); assert.equal(tel.corpo.lead.id, L1);
    assert.equal((await s.req('/api/lead-por-telefone?tel=5512900000001')).corpo.lead.id, L1, 'aceita ?tel=');

    const r = await s.post('/api/resumo-ia', { periodo: 'mes' });
    assert.equal(r.status, 200); assert.equal(r.corpo.periodo, 'mes'); assert.equal(r.corpo.modelo, 'modelo-forte-teste');
    assert.ok(s.sb.db.ia_acoes.some(a => a.tipo === 'crm_resumo' && a.status === 'executada'));
    assert.equal(s.ia.pedidos.at(-1).model, 'modelo-forte-teste');
  } finally { await s.fechar(); }
});

test('freio: no máximo 40 pedidos à IA por pessoa em 10 minutos', async () => {
  const s = await subir({ roteiros: Array.from({ length: 50 }, () => ({ entrada: { resposta: 'ok', leads_citados: [], sem_dados: false } })), usuario: 'apressado' });
  try {
    let ultimo;
    for (let i = 0; i < 41; i++) ultimo = await s.post('/api/ia/perguntar', { pergunta: 'quantos leads hoje?' });
    assert.equal(ultimo.status, 429);
    assert.equal((await s.req('/api/ia/uso')).status, 200, 'leitura não entra no freio');
  } finally { await s.fechar(); }
});

test('IA desligada nas configurações responde 503 claro', async () => {
  const s = await subir();
  s.sb.db.ia_config[0].ativo = false;
  try {
    const r = await s.post(`/api/ia/lead/${L1}/qualificar`);
    assert.equal(r.status, 503); assert.match(r.corpo.erro, /desligada/);
  } finally { await s.fechar(); }
});
