/* Dublê do cliente Supabase em memória — só o pedaço da API que a IA do CRM usa.
   Nenhum dado real: os testes montam as tabelas com dados inventados. */
'use strict';
const crypto = require('node:crypto');

function criarFakeSb(tabelas = {}) {
  const db = {};
  for (const [k, v] of Object.entries(tabelas)) db[k] = v.map(x => ({ ...x }));
  const chamadas = [];

  function consulta(tabela) {
    const filtros = [];
    let modo = 'select', dados = null, ordem = null, limite = null, inicio = 0, unico = null, colunas = '*';
    const linhas = () => db[tabela] || (db[tabela] = []);
    const casa = r => filtros.every(f => f(r));
    const projeta = r => {
      if (colunas === '*' || !colunas) return { ...r };
      const o = {};
      for (const c of colunas.split(',').map(x => x.trim())) o[c] = r[c] === undefined ? null : r[c];
      return o;
    };
    const q = {
      select(c) { if (modo === 'select') colunas = c || '*'; else colunas = c || '*'; q._devolve = true; return q; },
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
      if (tabela === '__erro__') return { data: null, error: { message: 'falha simulada' } };
      let out;
      if (modo === 'insert') {
        out = dados.map(r => { const n = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; linhas().push(n); return n; });
      } else if (modo === 'update') {
        out = linhas().filter(casa);
        for (const r of out) Object.assign(r, dados);
      } else {
        out = linhas().filter(casa);
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
  return { from: consulta, db, chamadas };
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
