/* Dublê do cliente Supabase em memória — só o pedaço da API que a IA do CRM usa.
   Nenhum dado real: os testes montam as tabelas com dados inventados. */
'use strict';
const crypto = require('node:crypto');

/* Rodada 5: `telefone_e164` é coluna GERADA no banco (só dígitos, sem o 55). O dublê
   calcula na hora a partir de `telefone`, para os filtros `.in('telefone_e164', …)`. */
function e164(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}
const virtual = r => (r && r.telefone_e164 === undefined && 'telefone' in r) ? { ...r, telefone_e164: e164(r.telefone) } : r;

function criarFakeSb(tabelas = {}) {
  const db = {};
  for (const [k, v] of Object.entries(tabelas)) db[k] = v.map(x => ({ ...x }));
  const chamadas = [];
  let falhas = null;

  function consulta(tabela) {
    const filtros = [];
    let modo = 'select', dados = null, ordem = null, limite = null, inicio = 0, unico = null, colunas = '*', contar = false, soCabeca = false, conflito = null;
    const linhas = () => db[tabela] || (db[tabela] = []);
    const casa = r => filtros.every(f => f(virtual(r)));
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
    /* rodada 5: a ficha inteira em um JSON (mesma forma da rpc real, casando por telefone_e164 OU cliente_id) */
    cliente_360(a) {
      const tel = e164(a.p_telefone);
      if (!tel) throw Object.assign(new Error('telefone inválido'), { code: '22023' });
      const t = n => (db[n] || []).map(virtual);
      const cli = t('clientes').find(c => c.telefone_e164 === tel) || null;
      const cid = cli?.id || null;
      const deste = r => r.telefone_e164 === tel || (cid && r.cliente_id === cid);
      const desc = k => (x, y) => String(y[k] || '').localeCompare(String(x[k] || ''));
      const conv = t('conversas').filter(deste).sort(desc('ultima_mensagem_em'))[0] || null;
      const leads = t('leads').filter(deste).sort(desc('created_at')).slice(0, 20).map(l => ({ ...l, link: '/?lead=' + l.id, responsavel_nome: (db.perfis || []).find(p => p.id === l.responsavel_id)?.nome || null }));
      const ag = t('agendamentos').filter(deste).sort(desc('data')).slice(0, 10).map(x => ({ ...x, link: '/?agendamento=' + x.id, consultor: null }));
      const patio = (db.patio_os || []).filter(o => e164(o.telefone) === tel || (cid && o.cliente_id === cid)).slice(0, 10)
        .map(o => ({ ...o, link: '/?os=' + o.id, extras_pendentes: (db.patio_extras || []).filter(x => x.os_id === o.id && x.status === 'pendente').length, link_cliente: o.token_publico ? 'https://indycar-patio.netlify.app/acompanhar/?t=' + o.token_publico : null }));
      const orc = (db.orc_orcamentos || []).filter(q => e164(q.cliente_telefone) === tel || (cid && q.cliente_id === cid)).slice(0, 10).map(q => ({ ...q, link: '/?orcamento=' + q.id }));
      const com = t('posvenda_envios').filter(deste).slice(0, 15);
      const msgs = t('whatsapp_mensagens').filter(deste).sort(desc('created_at')).slice(0, 20);
      const leadIds = new Set(leads.map(l => l.id)), agIds = new Set(ag.map(x => x.id));
      const tarefas = (db.tarefas || []).filter(x => x.status === 'aberta' && ((cid && x.cliente_id === cid) || (conv && x.conversa_id === conv.id) || leadIds.has(x.lead_id) || agIds.has(x.agendamento_id)));
      const ind = db.indicacoes || [];
      const soma = (l, k) => l.reduce((s, x) => s + (Number(x[k]) || 0), 0);
      const agC = ag.filter(x => x.status === 'concluido'), ldC = leads.filter(x => x.status === 'concluido');
      return {
        telefone: tel, telefone_55: '55' + tel, gerado_em: new Date().toISOString(),
        cliente: cli ? { ...cli, cliente_desde: cli.created_at, link_crm: '/?cliente=' + cli.id } : null,
        conversa: conv ? { ...conv, link: '/?conversa=' + conv.id, etapa: conv.etapa || null, atribuida_a_nome: null } : null,
        mensagens: msgs, leads, agendamentos: ag, patio, orcamentos: orc, comunicar: com, tarefas,
        indicacoes: { fez: cid ? ind.filter(i => i.indicado_por === cid) : [], foi_indicado_por: (() => { const i = ind.find(x => e164(x.telefone) === tel); const c = i && (db.clientes || []).find(x => x.id === i.indicado_por); return c ? { cliente_id: c.id, nome: c.nome, telefone: c.telefone, quando: i.created_at } : null; })() },
        resumo: { total_agendamentos: ag.length, servicos_feitos: agC.length, faltas: ag.filter(x => x.status === 'nao_veio').length, nao_fechou: ag.filter(x => x.status === 'nao_fechou').length,
          gasto_agenda: soma(agC, 'valor'), gasto_leads: soma(ldC, 'valor_pago'), total_gasto: Math.max(soma(agC, 'valor'), soma(ldC, 'valor_pago')),
          ultima_visita: null, proximo_horario: null, carro_na_oficina: patio.some(o => !['entregue', 'cancelado'].includes(o.etapa)),
          total_leads: leads.length, leads_abertos: leads.filter(l => !['concluido', 'perdido'].includes(l.status)).length,
          mensagens_total: msgs.length, ultima_mensagem_em: msgs[0]?.created_at || null, tarefas_abertas: tarefas.length },
      };
    },
  };
  async function rpc(nome, args = {}) {
    chamadas.push({ rpc: nome, args });
    if (falhas && falhas.has('rpc:' + nome)) return { data: null, error: { message: 'falha simulada' } };
    if (!rpcs[nome]) return { data: null, error: { message: 'função não existe: ' + nome } };
    try { return { data: rpcs[nome](args), error: null }; }
    catch (e) { return { data: null, error: { message: e.message, code: e.code || 'P0001' } }; }
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
