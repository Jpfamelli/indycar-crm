/* Sobe o server.js REAL com banco em memória (ia-fake-sb), a camada
   db-supabase.js real em cima dele, login falso e IA falsa.
   Nenhum dado real, nenhuma chamada de rede: tudo inventado aqui.

   Login: "Authorization: Bearer tok-<perfilId>-<qualquer>"; o token
   "tok-invalido-..." responde 401 no Auth falso. */
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { criarFakeSb, criarIAFalsa } = require('./ia-fake-sb.cjs');

const RAIZ = path.resolve(__dirname, '..');
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TODOS_APPS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'];

/** Equipe inventada com um de cada papel. */
const PESSOAS = {
  admin: { id: U(901), nome: 'Admin Teste', email: 'admin@teste.invalid', papel: 'admin', ativo: true, apps: ['agenda'], recebe_leads: true },
  gestor: { id: U(902), nome: 'Gestora Teste', email: 'gestora@teste.invalid', papel: 'gestor', ativo: true, apps: TODOS_APPS, recebe_leads: false },
  atendente: { id: U(903), nome: 'Ana Vendedora', email: 'ana@teste.invalid', papel: 'atendente', ativo: true, apps: TODOS_APPS, recebe_leads: true },
  atendente2: { id: U(904), nome: 'Bruno Vendedor', email: 'bruno@teste.invalid', papel: 'atendente', ativo: true, apps: TODOS_APPS, recebe_leads: true },
  agenda: { id: U(905), nome: 'Franklin Teste', email: 'agenda@teste.invalid', papel: 'agenda', ativo: true, apps: ['agenda'], recebe_leads: false },
  semApp: { id: U(906), nome: 'Sem CRM', email: 'semcrm@teste.invalid', papel: 'atendente', ativo: true, apps: ['atendimento'], recebe_leads: true },
  desativado: { id: U(907), nome: 'Ex Funcionário', email: 'ex@teste.invalid', papel: 'atendente', ativo: false, apps: TODOS_APPS, recebe_leads: true },
  trocarSenha: { id: U(908), nome: 'Nova Pessoa', email: 'nova@teste.invalid', papel: 'atendente', ativo: true, apps: TODOS_APPS, recebe_leads: false, precisa_trocar_senha: true },
};

function carregarDb(sb, env) {
  const mod = { exports: {} };
  const codigo = fs.readFileSync(path.join(RAIZ, 'db-supabase.js'), 'utf8');
  vm.runInNewContext(`(function (module, exports, require, process) {${codigo}\n})`, { console })(mod, mod.exports,
    n => n === '@supabase/supabase-js' ? { createClient: () => sb } : n.startsWith('./') ? require(path.join(RAIZ, n)) : require(n),
    { env });
  return mod.exports;
}

async function subirServidor({ tabelas = {}, roteiros = [], env = {}, comPessoas = true } = {}) {
  const base = { perfis: comPessoas ? Object.values(PESSOAS).map(p => ({ ...p })) : [], leads: [], clientes: [], conversas: [], whatsapp_mensagens: [],
    tarefas: [], metas: [], notificacoes: [], auditoria: [], ia_acoes: [], agendamentos: [], vigia_estado: [],
    ia_config: [{ id: true, ativo: true, modelo_rapido: 'modelo-rapido-teste', modelo_forte: 'modelo-forte-teste', autonomia: 'confirmar', limite_chamadas_dia: 500 }],
    catalogo_servicos: [], posvenda_envios: [], posvenda_respostas: [], orc_orcamentos: [], v_cliente_360: [], etapas_funil: [], ...tabelas };
  const sb = criarFakeSb(base);
  const ia = criarIAFalsa(roteiros);
  const procEnv = { SUPABASE_URL: 'http://falso.invalid', SUPABASE_ANON_KEY: 'publica-ficticia', SUPABASE_SERVICE_ROLE_KEY: 'servico-ficticia', PORT: '0', CRM_CACHE_LEADS_MS: '0', CRM_CACHE_CLIENTES_MS: '0', ...env };
  const store = carregarDb(sb, procEnv);
  const libIA = require('../lib/ia-crm');
  const auth = { chamadas: 0, fora: false };
  let servidor;
  const sandbox = {
    require: n => n === 'node:http' ? { createServer: fn => (servidor = http.createServer(fn)) }
      : n === './db-supabase' ? store
      : n === '@supabase/supabase-js' ? { createClient: () => sb }
      : n === './lib/ia-crm' ? { ...libIA, criarIACrm: o => libIA.criarIACrm({ ...o, clienteIA: ia }) }
      : n.startsWith('./') ? require(path.join(RAIZ, n)) : require(n),
    __dirname: RAIZ, Buffer, URL, AbortSignal, console: { log() {}, warn() {}, error() {} },
    process: { env: procEnv, loadEnvFile() {}, pid: 1 },
    fetch: async (url, opts = {}) => {
      auth.chamadas++;
      if (auth.fora) throw new Error('rede fora');
      const tok = String(opts.headers?.Authorization || '').replace(/^Bearer /, '');
      const m = /^tok-([0-9a-f-]{36})-/.exec(tok);
      if (!url.includes('/auth/v1/user') || !m) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ id: m[1], email: 'x@teste.invalid' }) };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'), sandbox);
  await new Promise(r => servidor.once('listening', r));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  let n = 0;
  /** Pedido como `quem` (chave de PESSOAS, um id, ou null = sem login). */
  async function req(quem, p, opts = {}) {
    const id = quem == null ? null : (PESSOAS[quem]?.id || quem);
    const cab = { 'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer tok-${id}-${n++}` } : {}), ...(opts.headers || {}) };
    const corpo = opts.body === undefined ? undefined : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    const r = await fetch(url + p, { method: opts.method || (corpo ? 'POST' : 'GET'), headers: cab, body: corpo });
    let dados = null; try { dados = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, corpo: dados, headers: r.headers };
  }
  return { sb, db: sb.db, ia, auth, store, url, req, PESSOAS, fechar: () => new Promise(r => servidor.close(r)) };
}

module.exports = { subirServidor, PESSOAS, U, TODOS_APPS };
