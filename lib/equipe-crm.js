/* ============================================================
   IndyCar CRM — mais de um vendedor
   - quem pode receber leads (vendedores)
   - atribuir / reatribuir / atribuição em lote (auditado; a
     notificação "lead passado para você" sai pelo gatilho do banco)
   - rodízio dos leads novos sem dono (recebe_leads, 'crm' nos apps, carga)
   - desempenho por vendedor e ranking
   - metas por pessoa e da loja (tabela metas) com progresso e projeção
   ============================================================ */
'use strict';

const U = require('./util-servidor');
const { ehUuid, falha, todas, ts, r2, podeCrm, ehGestor } = U;

const ABERTOS = ['novo', 'contato', 'orcamento', 'agendado', 'em_servico'];
const CAMPOS_META = ['leads', 'agendamentos', 'vendas', 'faturamento'];
const COLS_VENDEDOR = 'id,nome,papel,cargo,avatar_cor,apps,ativo,recebe_leads,ultimo_lead_em,ultimo_acesso_em';

/* ---------------- cálculo puro do desempenho ---------------- */
const fechamento = l => l.closed_at || l.updated_at || l.created_at;
function mediana(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Números por pessoa no período [desde, ate).
 * leads: {id,responsavel_id,status,valor_pago,created_at,closed_at,updated_at}
 * agendamentos: {id,lead_id,created_at,status}
 * conversas: {id,atribuida_a,aberta_em,created_at,primeira_resposta_em}
 */
function calcularDesempenho({ leads = [], agendamentos = [], conversas = [], vendedores = [], desde, ate }) {
  const dentro = iso => { const t = ts(iso); return t >= desde && t < ate; };
  const linha = (id, nome, extra = {}) => ({ perfil_id: id, nome, ...extra, leads: 0, agendados: 0, vendas: 0, perdidos: 0,
    faturamento: 0, abertos: 0, conversao: null, ticket: 0, tempo_resposta_min: null, respostas: 0, _tempos: [] });
  const porId = new Map(vendedores.map(v => [v.id, linha(v.id, v.nome || 'Sem nome', { avatar_cor: v.avatar_cor || null, papel: v.papel })]));
  const semDono = linha(null, 'Sem responsável');
  const loja = linha(null, 'Loja');
  const de = id => (id && porId.get(id)) || (id ? (porId.set(id, linha(id, 'Fora da equipe', { inativo: true })), porId.get(id)) : semDono);
  const donoDoLead = new Map();

  for (const l of leads) {
    donoDoLead.set(l.id, l.responsavel_id || null);
    const alvos = [de(l.responsavel_id), loja];
    for (const a of alvos) {
      if (dentro(l.created_at)) a.leads++;
      if (ABERTOS.includes(l.status)) a.abertos++;
      if (l.status === 'concluido' && dentro(fechamento(l))) { a.vendas++; a.faturamento += Number(l.valor_pago) || 0; }
      if (l.status === 'perdido' && dentro(fechamento(l))) a.perdidos++;
    }
  }
  for (const g of agendamentos) {
    if (g.status === 'cancelado' || !dentro(g.created_at)) continue;
    loja.agendados++;
    if (g.lead_id && donoDoLead.has(g.lead_id)) de(donoDoLead.get(g.lead_id)).agendados++;
    else semDono.agendados++;
  }
  for (const c of conversas) {
    const ini = ts(c.aberta_em || c.created_at), resp = ts(c.primeira_resposta_em);
    if (!(ini >= desde && ini < ate) || !Number.isFinite(resp) || resp < ini) continue;
    const min = (resp - ini) / 60000;
    if (min > 7 * 24 * 60) continue;                    // resposta de semana depois é outro atendimento
    loja._tempos.push(min);
    if (c.atribuida_a) de(c.atribuida_a)._tempos.push(min);
  }
  const fecha = a => {
    a.faturamento = r2(a.faturamento);
    const decididos = a.vendas + a.perdidos;
    a.conversao = decididos ? Math.round((a.vendas / decididos) * 1000) / 10 : null;
    a.ticket = a.vendas ? r2(a.faturamento / a.vendas) : 0;
    const md = mediana(a._tempos);
    a.tempo_resposta_min = md == null ? null : Math.round(md);
    a.respostas = a._tempos.length;
    delete a._tempos;
    return a;
  };
  const pessoas = [...porId.values()].map(fecha);
  const ranking = [...pessoas].filter(p => !p.inativo)
    .sort((a, b) => b.faturamento - a.faturamento || b.vendas - a.vendas || (b.conversao ?? -1) - (a.conversao ?? -1) || b.agendados - a.agendados || String(a.nome).localeCompare(String(b.nome)))
    .map((p, i) => ({ posicao: i + 1, perfil_id: p.perfil_id, nome: p.nome, faturamento: p.faturamento, vendas: p.vendas, conversao: p.conversao }));
  return { pessoas, semDono: fecha(semDono), loja: fecha(loja), ranking };
}

/** Progresso e projeção de uma meta. frac = parte do mês que já passou (0..1). */
function avaliarMeta(meta, realizado, frac) {
  const itens = {};
  let risco = false, algum = false, todasBatidas = true;
  for (const c of CAMPOS_META) {
    const alvo = meta ? Number(meta[c]) : null;
    if (!alvo || !(alvo > 0)) { itens[c] = { meta: null, realizado: realizado[c] ?? 0, progresso: null, projecao: null }; continue; }
    algum = true;
    const feito = Number(realizado[c]) || 0;
    const projecao = frac > 0 ? (frac >= 1 ? feito : feito / frac) : null;
    const it = {
      meta: alvo, realizado: c === 'faturamento' ? r2(feito) : feito,
      progresso: Math.round((feito / alvo) * 1000) / 10,
      projecao: projecao == null ? null : (c === 'faturamento' ? r2(projecao) : Math.round(projecao * 10) / 10),
      batida: feito >= alvo,
    };
    // em risco: já passou ~15% do mês e a projeção não chega a 85% da meta
    it.risco = !it.batida && frac >= 0.15 && frac < 1 && projecao != null && projecao < alvo * 0.85;
    if (it.risco) risco = true;
    if (!it.batida) todasBatidas = false;
    itens[c] = it;
  }
  return { itens, status: !algum ? 'sem_meta' : todasBatidas ? 'batida' : risco ? 'risco' : frac >= 1 ? 'nao_batida' : 'ok' };
}

/* ============================================================ */
function criarEquipe({ sb, agora = () => Date.now(), auditar = async () => null, log = () => {} } = {}) {
  if (!sb) throw new Error('equipe-crm: banco não configurado');

  async function vendedores({ soRecebe = false } = {}) {
    const { data, error } = await sb.from('perfis').select(COLS_VENDEDOR).eq('ativo', true);
    if (error) throw falha(503, 'Não consegui ler a equipe.');
    return (data || []).filter(podeCrm).filter(p => !soRecebe || p.recebe_leads !== false)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  }
  async function vendedor(id) {
    if (!ehUuid(id)) return null;
    const { data, error } = await sb.from('perfis').select(COLS_VENDEDOR).eq('id', id).maybeSingle();
    if (error) throw falha(503, 'Não consegui ler a equipe.');
    return podeCrm(data) ? data : null;
  }
  const publico = v => ({ id: v.id, nome: v.nome || 'Sem nome', papel: v.papel, cargo: v.cargo || null, avatar_cor: v.avatar_cor || null,
    recebe_leads: v.recebe_leads !== false, ultimo_lead_em: v.ultimo_lead_em || null });

  /** Carga = leads em aberto por pessoa. */
  async function cargas() {
    const { data, error } = await todas(() => sb.from('leads').select('id,responsavel_id').in('status', ABERTOS).order('id'));
    if (error) throw falha(503, 'Não consegui ler os leads.');
    const m = new Map();
    for (const l of data || []) if (l.responsavel_id) m.set(l.responsavel_id, (m.get(l.responsavel_id) || 0) + 1);
    return m;
  }

  async function lerLead(id) {
    const { data, error } = await sb.from('leads').select('id,nome,status,responsavel_id,cliente_id').eq('id', id).maybeSingle();
    if (error) throw falha(503, 'Não consegui ler o lead.');
    return data;
  }

  /** Muda o responsável de um lead. null tira o dono (só gestor). */
  async function atribuir(leadId, novo, quem, { motivo = null } = {}) {
    if (!ehUuid(leadId)) throw falha(400, 'Lead inválido.');
    if (novo !== null && !ehUuid(novo)) throw falha(400, 'Escolha quem vai cuidar do lead.');
    if (novo === null && !ehGestor(quem.papel)) throw falha(403, 'Só um gestor pode deixar o lead sem responsável.');
    const lead = await lerLead(leadId);
    if (!lead) throw falha(404, 'Lead não encontrado.');
    const antes = lead.responsavel_id || null;
    if (!ehGestor(quem.papel) && antes && antes !== quem.id) throw falha(403, 'Só o responsável pelo lead ou um gestor pode passá-lo para outra pessoa.');
    let alvo = null;
    if (novo) { alvo = await vendedor(novo); if (!alvo) throw falha(400, 'Essa pessoa não pode receber leads do CRM (desativada ou sem acesso).'); }
    if (antes === novo) return { ok: true, mudou: false, lead: { ...lead } };
    let q = sb.from('leads').update({ responsavel_id: novo }).eq('id', leadId);
    q = antes ? q.eq('responsavel_id', antes) : q.is('responsavel_id', null);
    const { data, error } = await q.select('id,nome,status,responsavel_id').maybeSingle();
    if (error) throw falha(503, 'Não consegui trocar o responsável.');
    if (!data) throw falha(409, 'Alguém mudou este lead agora mesmo. Recarregue e tente de novo.');
    await auditar(quem, 'reatribuir_lead', { tabela: 'leads', registro: leadId, detalhes: { de: antes, para: novo, motivo: motivo ? String(motivo).slice(0, 200) : null } });
    return { ok: true, mudou: true, lead: data, responsavel: alvo ? publico(alvo) : null };
  }

  /** Atribuição em lote (gestor). */
  async function atribuirLote(ids, novo, quem) {
    if (!ehGestor(quem.papel)) throw falha(403, 'Só um gestor distribui leads em lote.');
    const lista = Array.isArray(ids) ? [...new Set(ids.filter(ehUuid))] : [];
    if (!lista.length || lista.length > 200) throw falha(400, 'Escolha de 1 a 200 leads.');
    if (novo !== null && !ehUuid(novo)) throw falha(400, 'Escolha quem vai cuidar dos leads.');
    let alvo = null;
    if (novo) { alvo = await vendedor(novo); if (!alvo) throw falha(400, 'Essa pessoa não pode receber leads do CRM.'); }
    const { data, error } = await sb.from('leads').update({ responsavel_id: novo }).in('id', lista).select('id');
    if (error) throw falha(503, 'Não consegui distribuir os leads.');
    const feitos = (data || []).map(x => x.id);
    await auditar(quem, 'atribuir_lote', { tabela: 'leads', registro: null, detalhes: { para: novo, quantidade: feitos.length, ids: feitos } });
    return { ok: true, atualizados: feitos.length, ids: feitos, responsavel: alvo ? publico(alvo) : null };
  }

  /**
   * Rodízio: leads 'novo' sem dono vão para quem recebe leads, pela menor carga
   * (empate: quem recebeu há mais tempo). horas = só leads criados nesse prazo
   * (o automático usa 48 h para não despejar o estoque antigo em ninguém).
   */
  async function rodizio({ executar = true, quem = null, horas = 48, todos = false, limite = 50 } = {}) {
    limite = Math.max(1, Math.min(200, Math.round(Number(limite) || 50)));
    const gente = await vendedores({ soRecebe: true });
    if (!gente.length) return { ok: true, atribuidos: [], pendentes: 0, motivo: 'Ninguém está marcado para receber leads.' };
    let q = sb.from('leads').select('id,nome,created_at').eq('status', 'novo').is('responsavel_id', null);
    if (!todos) q = q.gte('created_at', new Date(agora() - Math.max(1, Number(horas) || 48) * 3600_000).toISOString());
    const { data: leads, error } = await q.order('created_at', { ascending: true }).limit(limite);
    if (error) throw falha(503, 'Não consegui ler os leads novos.');
    if (!leads?.length) return { ok: true, atribuidos: [], pendentes: 0 };
    const carga = await cargas();
    const estado = gente.map(v => ({ v, carga: carga.get(v.id) || 0, ultimo: ts(v.ultimo_lead_em) || 0 }));
    const plano = [];
    for (const l of leads) {
      estado.sort((a, b) => a.carga - b.carga || a.ultimo - b.ultimo || String(a.v.nome).localeCompare(String(b.v.nome)));
      const e = estado[0];
      plano.push({ lead_id: l.id, lead_nome: l.nome, perfil_id: e.v.id, nome: e.v.nome });
      e.carga++; e.ultimo = agora() + plano.length;   // quem acabou de receber vai para o fim da fila
    }
    if (!executar) return { ok: true, simulado: true, atribuidos: plano, pendentes: plano.length };
    const feitos = [];
    for (const p of plano) {
      const { data, error: e2 } = await sb.from('leads').update({ responsavel_id: p.perfil_id }).eq('id', p.lead_id).is('responsavel_id', null).select('id').maybeSingle();
      if (e2) { log('rodízio:', e2.message); continue; }
      if (data) feitos.push(p);                          // outro já pegou: pula
    }
    const iso = new Date(agora()).toISOString();
    for (const id of new Set(feitos.map(f => f.perfil_id))) {
      const { error: e3 } = await sb.from('perfis').update({ ultimo_lead_em: iso }).eq('id', id);
      if (e3) log('rodízio/ultimo_lead_em:', e3.message);
    }
    if (feitos.length) await auditar(quem, 'rodizio_leads', { tabela: 'leads', detalhes: { quantidade: feitos.length, por: quem ? 'pessoa' : 'automacao', atribuicoes: feitos.map(f => ({ lead: f.lead_id, para: f.perfil_id })) } });
    return { ok: true, atribuidos: feitos, pendentes: plano.length - feitos.length };
  }

  /* ---------------- desempenho ---------------- */
  async function dadosPeriodo(desde, ate) {
    const iso = new Date(desde).toISOString();
    const [l, a, c, gente] = await Promise.all([
      todas(() => sb.from('leads').select('id,responsavel_id,status,valor_pago,created_at,closed_at,updated_at').order('id')),
      todas(() => sb.from('agendamentos').select('id,lead_id,created_at,status').gte('created_at', iso).order('id')),
      todas(() => sb.from('conversas').select('id,atribuida_a,aberta_em,created_at,primeira_resposta_em').gte('created_at', new Date(desde - 30 * 864e5).toISOString()).order('id')),
      vendedores(),
    ]);
    for (const r of [l, a, c]) if (r.error) throw falha(503, 'Não consegui montar os números da equipe.');
    return { leads: l.data, agendamentos: a.data, conversas: c.data, vendedores: gente };
  }

  /** Período: mes 'AAAA-MM' (padrão: mês atual) ou dias (1..365). */
  function periodo({ mes, dias } = {}) {
    if (dias != null && dias !== '') {
      const d = Math.round(Number(dias));
      if (!(d >= 1 && d <= 365)) throw falha(400, 'Período inválido: use de 1 a 365 dias.');
      const ate = agora();
      return { desde: ate - d * 864e5, ate, rotulo: `${d} dias`, dias: d };
    }
    const m = mes ? U.normalizaMes(mes) : U.mesBRT(agora());
    if (!m) throw falha(400, 'Mês inválido: use AAAA-MM.');
    const { inicio, fim } = U.limitesMes(m);
    return { desde: inicio, ate: fim, mes: m, rotulo: m };
  }

  async function desempenho(opts = {}) {
    const p = periodo(opts);
    const d = await dadosPeriodo(p.desde, p.ate);
    const r = calcularDesempenho({ ...d, desde: p.desde, ate: p.ate });
    return { periodo: { desde: new Date(p.desde).toISOString(), ate: new Date(p.ate).toISOString(), mes: p.mes || null, dias: p.dias || null }, ...r };
  }

  /* ---------------- metas ---------------- */
  async function lerMetas({ mes } = {}) {
    const m = mes ? U.normalizaMes(mes) : U.mesBRT(agora());
    if (!m) throw falha(400, 'Mês inválido: use AAAA-MM.');
    const { inicio, fim } = U.limitesMes(m);
    const [{ data: metas, error }, dados] = await Promise.all([
      sb.from('metas').select('id,perfil_id,mes,leads,agendamentos,vendas,faturamento,updated_at').eq('mes', `${m}-01`),
      dadosPeriodo(inicio, fim),
    ]);
    if (error) throw falha(503, 'Não consegui ler as metas.');
    const r = calcularDesempenho({ ...dados, desde: inicio, ate: fim });
    const frac = Math.max(0, Math.min(1, (agora() - inicio) / (fim - inicio)));
    const metaLoja = (metas || []).find(x => !x.perfil_id) || null;
    const porPessoa = new Map((metas || []).filter(x => x.perfil_id).map(x => [x.perfil_id, x]));
    const limpa = x => x ? { id: x.id, leads: x.leads, agendamentos: x.agendamentos, vendas: x.vendas, faturamento: x.faturamento == null ? null : Number(x.faturamento), atualizada_em: x.updated_at || null } : null;
    const feito = p => ({ leads: p.leads, agendamentos: p.agendados, vendas: p.vendas, faturamento: p.faturamento });
    const pessoas = r.pessoas.filter(p => !p.inativo || porPessoa.has(p.perfil_id)).map(p => {
      const meta = porPessoa.get(p.perfil_id) || null;
      return { perfil_id: p.perfil_id, nome: p.nome, avatar_cor: p.avatar_cor || null, meta: limpa(meta), ...avaliarMeta(meta, feito(p), frac) };
    });
    return {
      mes: m, decorrido: Math.round(frac * 1000) / 10,
      loja: { meta: limpa(metaLoja), ...avaliarMeta(metaLoja, feito(r.loja), frac) },
      pessoas,
    };
  }

  function validarMeta(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw falha(400, 'Meta inválida.');
    const mes = U.normalizaMes(b.mes);
    if (!mes) throw falha(400, 'Informe o mês da meta (AAAA-MM).');
    const perfil_id = b.perfil_id == null || b.perfil_id === '' || b.perfil_id === 'loja' ? null : b.perfil_id;
    if (perfil_id !== null && !ehUuid(perfil_id)) throw falha(400, 'Pessoa da meta inválida.');
    const out = { perfil_id, mes: `${mes}-01` };
    let algum = false;
    for (const c of CAMPOS_META) {
      if (!(c in b)) continue;
      const v = b[c];
      if (v === null || v === '') { out[c] = null; algum = true; continue; }
      const n = Number(v);
      const max = c === 'faturamento' ? 10_000_000 : 100_000;
      if (!Number.isFinite(n) || n < 0 || n > max) throw falha(400, `Meta de ${c} inválida (0 a ${max.toLocaleString('pt-BR')}).`);
      out[c] = c === 'faturamento' ? Math.round(n * 100) / 100 : Math.round(n);
      algum = true;
    }
    if (!algum) throw falha(400, 'Informe ao menos um número da meta.');
    return out;
  }

  /** Grava (cria ou troca) uma meta. Só gestor. */
  async function gravarMeta(b, quem) {
    if (!ehGestor(quem.papel)) throw falha(403, 'Só um gestor define metas.');
    const m = validarMeta(b);
    if (m.perfil_id && !(await vendedor(m.perfil_id))) throw falha(400, 'Essa pessoa não está na equipe do CRM.');
    let q = sb.from('metas').select('id,perfil_id,mes,leads,agendamentos,vendas,faturamento').eq('mes', m.mes);
    q = m.perfil_id ? q.eq('perfil_id', m.perfil_id) : q.is('perfil_id', null);
    const { data: atual, error } = await q.maybeSingle();
    if (error) throw falha(503, 'Não consegui ler a meta.');
    const campos = Object.fromEntries(CAMPOS_META.filter(c => c in m).map(c => [c, m[c]]));
    let r;
    if (atual) r = await sb.from('metas').update(campos).eq('id', atual.id).select('id,perfil_id,mes,leads,agendamentos,vendas,faturamento').maybeSingle();
    else r = await sb.from('metas').insert({ perfil_id: m.perfil_id, mes: m.mes, ...campos }).select('id,perfil_id,mes,leads,agendamentos,vendas,faturamento').single();
    if (r.error || !r.data) throw falha(503, 'Não consegui gravar a meta.');
    await auditar(quem, 'meta_gravada', { tabela: 'metas', registro: r.data.id, detalhes: { mes: m.mes, perfil_id: m.perfil_id, antes: atual ? Object.fromEntries(CAMPOS_META.map(c => [c, atual[c]])) : null, depois: campos } });
    return { ...r.data, faturamento: r.data.faturamento == null ? null : Number(r.data.faturamento) };
  }

  return { vendedores, vendedor, publico, cargas, atribuir, atribuirLote, rodizio, desempenho, periodo, lerMetas, gravarMeta, validarMeta };
}

module.exports = { criarEquipe, calcularDesempenho, avaliarMeta, mediana, ABERTOS, CAMPOS_META };
