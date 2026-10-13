/* Dublê do cliente Supabase em memória — só o pedaço da API que a IA do CRM usa.
   Nenhum dado real: os testes montam as tabelas com dados inventados. */
'use strict';
const crypto = require('node:crypto');

function criarFakeSb(tabelas = {}) {
  const db = {};
  for (const [k, v] of Object.entries(tabelas)) db[k] = v.map(x => ({ ...x }));
  const chamadas = [];
  let falhas = null;

  function consulta(tabela) {
    const filtros = [];
    let modo = 'select', dados = null, ordem = null, limite = null, inicio = 0, unico = null, colunas = '*', contar = false, soCabeca = false, conflito = null;
    const linhas = () => db[tabela] || (db[tabela] = []);
    const casa = r => filtros.every(f => f(r));
    const projeta = r => {
      if (colunas === '*' || !colunas) return { ...r };
      const o = {};
      for (const c of colunas.split(',').map(x => x.trim())) o[c] = r[c] === undefined ? null : r[c];
      return o;
    };
    const q = {
      select(c, o = {}) { colunas = c || '*'; q._devolve = true; if (o.count) contar = true; if (o.head) soCabeca = true; return q; },
      is(k, v) { filtros.push(r => (r[k] ?? null) === v); return q; },
      not(k, op, v) { filtros.push(op === 'is' ? (r => (r[k] ?? null) !== v) : (r => r[k] !== v)); return q; },
      delete(o = {}) { modo = 'delete'; if (o.count) contar = true; return q; },
      upsert(rows, o = {}) { modo = 'upsert'; dados = Array.isArray(rows) ? rows : [rows]; conflito = (o.onConflict || 'id').split(','); return q; },
      eq(k, v) { filtros.push(r => r[k] === v); return q; },
      neq(k, v) { filtros.push(r => r[k] !== v); return q; },
      in(k, vs) { filtros.push(r => vs.includes(r[k])); return q; },
      gte(k, v) { filtros.push(r => r[k] != null && String(r[k]) >= String(v)); return q; },
      gt(k, v) { filtros.push(r => r[k] != null && (typeof v === 'number' ? Number(r[k]) > v : String(r[k]) > String(v))); return q; },
      lt(k, v) { filtros.push(r => r[k] != null && String(r[k]) < String(v)); return q; },
      lte(k, v) { filtros.push(r => r[k] != null && String(r[k]) <= String(v)); return q; },
      like(k, pad) { const re = new RegExp('^' + pad.split('%').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'); filtros.push(r => re.test(String(r[k] ?? ''))); return q; },
      order(k, o = {}) { ordem = { k, asc: o.ascending !== false }; return q; },
      limit(n) { limite = n; return q; },
      range(a, b) { inicio = a; limite = b - a + 1; return q; },
      insert(rows) { modo = 'insert'; dados = Array.isArray(rows) ? rows : [rows]; return q; },
      update(p) { modo = 'update'; dados = p; return q; },
      maybeSingle() { unico = 'talvez'; return q; },
      single() { unico = 'um'; return q; },
      then(ok, falha) { return Promise.resolve().then(executar).then(ok, falha); },
    };
    function executar() {
      chamadas.push({ tabela, modo });
      if (tabela === '__erro__' || (falhas && falhas.has(tabela))) return { data: null, error: { message: 'falha simulada' } };
      let out;
      if (modo === 'delete') {
        const fora = linhas().filter(casa);
        db[tabela] = linhas().filter(r => !casa(r));
        return { data: soCabeca ? null : fora, error: null, count: fora.length };
      }
      if (modo === 'upsert') {
        out = dados.map(r => {
          const ja = linhas().find(x => conflito.every(k => x[k] === r[k]));
          if (ja) { Object.assign(ja, r); return ja; }
          const n = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; linhas().push(n); return n;
        });
        out = out.map(projeta);
        return unico ? { data: out[0] || null, error: null } : { data: out, error: null };
      }
      if (modo === 'insert') {
        out = dados.map(r => { const n = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; linhas().push(n); return n; });
      } else if (modo === 'update') {
        out = linhas().filter(casa);
        for (const r of out) Object.assign(r, dados);
      } else {
        out = linhas().filter(casa);
        if (contar && soCabeca) return { data: null, error: null, count: out.length };
      }
      if (ordem) out = [...out].sort((a, b) => (String(a[ordem.k] ?? '') < String(b[ordem.k] ?? '') ? -1 : String(a[ordem.k] ?? '') > String(b[ordem.k] ?? '') ? 1 : 0) * (ordem.asc ? 1 : -1));
      if (limite != null || inicio) out = out.slice(inicio, limite != null ? inicio + limite : undefined);
      out = out.map(projeta);
      if (unico) {
        if (unico === 'um' && out.length !== 1) return { data: null, error: { message: 'esperava 1 linha' } };
        return { data: out[0] || null, error: null };
      }
      return { data: out, error: null };
    }
    return q;
  }
  /* rpcs do banco que o servidor usa (mesma regra do Postgres) */
  const rpcs = {
    registrar_auditoria(a) { const n = { id: (db.auditoria || (db.auditoria = [])).length + 1, perfil_id: a.p_perfil, app: a.p_app, acao: a.p_acao, tabela: a.p_tabela, registro_id: a.p_registro, detalhes: a.p_detalhes, created_at: new Date().toISOString() }; db.auditoria.push(n); return n.id; },
    notificar(a) {
      const ns = db.notificacoes || (db.notificacoes = []);
      if (!a.p_perfil) return null;
      const p = (db.perfis || []).find(x => x.id === a.p_perfil);
      if (!p || p.ativo === false) return null;
      if (a.p_chave && ns.some(n => n.perfil_id === a.p_perfil && n.chave === a.p_chave)) return null;
      const n = { id: crypto.randomUUID(), perfil_id: a.p_perfil, tipo: a.p_tipo, titulo: a.p_titulo, corpo: a.p_corpo, link: a.p_link, app: a.p_app, chave: a.p_chave, lida_em: null, created_at: new Date().toISOString() };
      ns.push(n); return n.id;
    },
    crm_pegar_trava(a) {
      const ts = db.crm_travas || (db.crm_travas = []);
      const t = ts.find(x => x.nome === a.p_nome);
      const agora = Date.now();
      if (t && t.ate > agora && t.dono !== a.p_dono) return false;
      if (t) Object.assign(t, { dono: a.p_dono, ate: agora + a.p_segundos * 1000 }); else ts.push({ nome: a.p_nome, dono: a.p_dono, ate: agora + a.p_segundos * 1000 });
      return true;
    },
    crm_soltar_trava(a) { db.crm_travas = (db.crm_travas || []).filter(x => !(x.nome === a.p_nome && x.dono === a.p_dono)); return true; },
  };
  async function rpc(nome, args = {}) {
    chamadas.push({ rpc: nome, args });
    if (falhas && falhas.has('rpc:' + nome)) return { data: null, error: { message: 'falha simulada' } };
    if (!rpcs[nome]) return { data: null, error: { message: 'função não existe: ' + nome } };
    return { data: rpcs[nome](args), error: null };
  }
  const auth = { admin: {
    async createUser({ email }) { if ((db.__usuarios || []).includes(email)) return { data: null, error: { message: 'already been registered' } }; (db.__usuarios ||= []).push(email); const id = crypto.randomUUID(); (db.perfis ||= []).push({ id, email, papel: 'atendente', ativo: true, apps: ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'] }); return { data: { user: { id } }, error: null }; },
    async updateUserById(id, dados) { (db.__senhas ||= {})[id] = !!dados.password; return { data: { user: { id } }, error: null }; },
  } };
  return { from: consulta, rpc, auth, db, chamadas, falhar: nomes => { falhas = new Set(nomes); } };
}

/* IA falsa roteirizada: cada chamada consome o próximo roteiro.
   Um roteiro pode ser { ferramenta, entrada } | { texto } | { erro } | { recusa } | função(params). */
function criarIAFalsa(roteiros = []) {
  const pedidos = [];
  return {
    pedidos,
    async criar(params) {
      pedidos.push(params);
      let r = roteiros.shift();
      if (typeof r === 'function') r = r(params);
      if (!r) throw new Error('IA falsa sem roteiro');
      if (r.erro) throw Object.assign(new Error(r.erro), { status: r.status || 500 });
      const usage = { input_tokens: 120, output_tokens: 40 };
      if (r.recusa) return { stop_reason: 'refusal', content: [], usage, model: params.model };
      if (r.texto != null) return { stop_reason: r.stop || 'end_turn', content: [{ type: 'text', text: r.texto }], usage, model: params.model };
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: r.ferramenta || params.tools[0].name, input: r.entrada }], usage, model: params.model };
    },
  };
}

module.exports = { criarFakeSb, criarIAFalsa };
