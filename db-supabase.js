/* ============================================================
   IndyCar CRM — camada de dados no SUPABASE

   Expõe EXATAMENTE a mesma interface do db.js (SQLite), só que
   assíncrona. Assim o server.js e o front continuam iguais, e dá
   para voltar ao banco local trocando uma variável de ambiente.

   Diferença que importa: aqui o CRM divide o banco com a Agenda.
   Um lead que vira horário marcado é atualizado pelos gatilhos do
   Postgres — o CRM não precisa saber que a Agenda existe.
   ============================================================ */
'use strict';

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!URL || !KEY) {
  throw new Error(
    'Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY ' +
    '(ou rode com CRM_DB=sqlite para usar o banco local).'
  );
}

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- Domínios (espelham os enums do Postgres) ----
const STATUSES = ['novo', 'contato', 'orcamento', 'agendado', 'em_servico', 'concluido', 'perdido'];
const ORIGENS  = ['meta', 'google', 'indicacao', 'organico', 'whatsapp', 'passagem', 'telefone'];

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function erro(ctx, e) {
  if (e) throw new Error(`${ctx}: ${e.message || e.hint || 'falha no Supabase'}`);
}

/* O Postgres devolve `numeric` como string ("890.00"). O front faz conta
   com esses valores, então convertemos na fronteira. */
const nDec = v => (v === null || v === undefined ? 0 : Number(v));

function normalizarLead(l) {
  if (!l) return l;
  return {
    ...l,
    valor_orcado: nDec(l.valor_orcado),
    valor_pago:   nDec(l.valor_pago),
  };
}

const dinheiro = v => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
};

// Busca tolerante: ignora acento, caixa e pontuação (igual ao banco local)
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const norm   = s => semAcento(s).replace(/[^a-z0-9]+/g, ' ').trim();
const alnum  = s => semAcento(s).replace(/[^a-z0-9]/g, '');
const digitos = s => String(s ?? '').replace(/\D/g, '');
const telKey = s => { const d = digitos(s); return d.length >= 8 ? d.slice(-8) : d; };

const COLS = ['nome','telefone','carro_modelo','placa','servico','valor_orcado','valor_pago',
              'status','origem','utm_source','utm_medium','utm_campaign','observacoes'];

/* ------------------------------------------------------------
   CRUD de leads
   ------------------------------------------------------------ */
async function createLead(data = {}) {
  const row = {};
  for (const c of COLS) if (data[c] !== undefined) row[c] = data[c];
  row.valor_orcado = dinheiro(data.valor_orcado);
  row.valor_pago   = dinheiro(data.valor_pago);
  row.status = STATUSES.includes(data.status) ? data.status : 'novo';
  row.origem = ORIGENS.includes(data.origem)  ? data.origem : 'organico';
  if (data.created_at) row.created_at = data.created_at;
  // closed_at e cliente_id são preenchidos pelos gatilhos do Postgres

  const { data: novo, error } = await sb.from('leads').insert(row).select().single();
  erro('createLead', error);
  return normalizarLead(novo);
}

async function getLead(id) {
  const { data, error } = await sb.from('leads').select('*').eq('id', id).maybeSingle();
  erro('getLead', error);
  return normalizarLead(data);
}

async function listLeads({ status, origem, q } = {}) {
  let query = sb.from('leads').select('*').order('created_at', { ascending: false });
  if (status && STATUSES.includes(status)) query = query.eq('status', status);
  if (origem && ORIGENS.includes(origem))  query = query.eq('origem', origem);

  const { data, error } = await query;
  erro('listLeads', error);
  const rows = (data || []).map(normalizarLead);

  const termo = norm(q);
  if (!termo) return rows;

  const qDig = digitos(q);
  const qTel = qDig.length >= 4 ? telKey(q) : null;
  const qAln = alnum(q);

  return rows.filter(l => {
    const texto = norm([l.nome, l.telefone, l.placa, l.carro_modelo, l.servico].join(' '));
    if (texto.includes(termo)) return true;
    if (qTel && telKey(l.telefone) === qTel) return true;
    if (qAln && alnum(l.placa).includes(qAln)) return true;
    return false;
  });
}

async function updateLead(id, data = {}) {
  const patch = {};
  for (const c of COLS) if (c in data) patch[c] = data[c];
  if ('valor_orcado' in patch) patch.valor_orcado = dinheiro(patch.valor_orcado);
  if ('valor_pago'   in patch) patch.valor_pago   = dinheiro(patch.valor_pago);
  if ('status' in patch && !STATUSES.includes(patch.status)) delete patch.status;
  if ('origem' in patch && !ORIGENS.includes(patch.origem))  delete patch.origem;
  if (!Object.keys(patch).length) return getLead(id);

  const { data: row, error } = await sb.from('leads').update(patch).eq('id', id).select().maybeSingle();
  erro('updateLead', error);
  return normalizarLead(row);
}

async function deleteLead(id) {
  const { error, count } = await sb.from('leads').delete({ count: 'exact' }).eq('id', id);
  erro('deleteLead', error);
  return (count ?? 0) > 0;
}

/* ------------------------------------------------------------
   Estatísticas — mesma matemática do banco local
   ------------------------------------------------------------ */
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function statsDe(rows, sinceISO) {
  const desde = new Date(sinceISO).getTime();
  const dentro = r => new Date(r.created_at).getTime() >= desde;
  // fechamento manda na receita (igual ao SQLite corrigido)
  const fechouNaJanela = r =>
    ['concluido', 'perdido'].includes(r.status) &&
    new Date(r.closed_at || r.updated_at || r.created_at).getTime() >= desde;

  const entrada    = rows.filter(dentro);
  const fechados   = rows.filter(fechouNaJanela);
  const concluidos = fechados.filter(r => r.status === 'concluido');
  const perdidos   = fechados.filter(r => r.status === 'perdido');

  const faturamento = concluidos.reduce((s, r) => s + r.valor_pago, 0);
  const ticket = concluidos.length ? faturamento / concluidos.length : 0;
  const conversao = fechados.length ? (concluidos.length / fechados.length) * 100 : 0;

  // pipeline aberto é saldo acumulado, não fatia de janela
  const emAberto = rows
    .filter(r => !['concluido', 'perdido'].includes(r.status))
    .reduce((s, r) => s + r.valor_orcado, 0);

  const porOrigem = ORIGENS.map(o => {
    const e = entrada.filter(x => x.origem === o);
    const g = concluidos.filter(x => x.origem === o);
    return { origem: o, leads: e.length, ganhos: g.length,
             faturamento: g.reduce((s, x) => s + x.valor_pago, 0) };
  }).filter(x => x.leads > 0 || x.ganhos > 0).sort((a, b) => b.leads - a.leads);

  const porStatus = {};
  for (const s of STATUSES) porStatus[s] = entrada.filter(r => r.status === s).length;

  return { total: entrada.length, ganhos: concluidos.length, perdidos: perdidos.length,
           faturamento, emAberto, ticket, conversao, porOrigem, porStatus };
}

async function todosOsLeads() {
  const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending: false });
  erro('todosOsLeads', error);
  return (data || []).map(normalizarLead);
}

async function getStats() {
  const rows = await todosOsLeads();
  const semana = statsDe(rows, daysAgoISO(7));
  const geral  = statsDe(rows, '1970-01-01T00:00:00.000Z');

  // janela anterior real: de 14 dias atrás até 7 dias atrás
  const ini = new Date(daysAgoISO(14)).getTime();
  const fim = new Date(daysAgoISO(7)).getTime();
  const prevRows = rows.filter(r => {
    const t = new Date(r.created_at).getTime();
    return t >= ini && t < fim;
  });
  const prev = {
    total: prevRows.length,
    faturamento: prevRows.filter(r => r.status === 'concluido')
                         .reduce((s, r) => s + r.valor_pago, 0),
  };

  return {
    geral,
    semana,
    comparativo: {
      leads:       { atual: semana.total,       anterior: prev.total },
      faturamento: { atual: semana.faturamento, anterior: prev.faturamento },
    },
    dominios: { STATUSES, ORIGENS },
  };
}

async function weeklyData() {
  const rows = await todosOsLeads();
  const desde = new Date(daysAgoISO(7)).getTime();
  return {
    stats: await getStats(),
    semanaLeads: rows.filter(r => new Date(r.created_at).getTime() >= desde),
  };
}

/* ------------------------------------------------------------
   Integrações de mídia (Meta Ads / Google Ads)
   ------------------------------------------------------------ */
const CANAIS_INTEGRACAO = ['meta', 'google'];
const CAMPOS_INTEGRACAO = {
  meta:   ['conta_nome','meta_access_token','meta_ad_account_id','meta_pixel_id',
           'meta_app_id','meta_token_expira_em'],
  google: ['conta_nome','google_customer_id','google_login_customer_id',
           'google_developer_token','google_client_id','google_client_secret',
           'google_refresh_token'],
};
const SEGREDOS = new Set(['meta_access_token','google_developer_token',
                          'google_client_secret','google_refresh_token']);
const OBRIGATORIOS = {
  meta:   ['meta_access_token','meta_ad_account_id'],
  google: ['google_customer_id','google_developer_token','google_client_id',
           'google_client_secret','google_refresh_token'],
};

const MASK = '•';
function mascarar(valor, visiveis = 4) {
  if (valor === null || valor === undefined || valor === '') return null;
  const s = String(valor);
  return s.length <= visiveis ? MASK.repeat(8) : MASK.repeat(8) + s.slice(-visiveis);
}

function integracaoPublica(row, canal) {
  const base = row || { canal, ativo: false };
  const out = { canal, ativo: !!base.ativo, conta_nome: base.conta_nome ?? null };
  for (const campo of CAMPOS_INTEGRACAO[canal]) {
    if (campo === 'conta_nome') continue;
    if (SEGREDOS.has(campo)) {
      out[campo] = null;                                // o segredo nunca sai daqui
      out[`${campo}_mask`] = mascarar(base[campo]);
      out[`${campo}_definido`] = !!base[campo];
    } else {
      out[campo] = base[campo] ?? null;
    }
  }
  out.faltando = OBRIGATORIOS[canal].filter(c => !base[c]);
  out.conectado = out.faltando.length === 0 && !!base.ativo;
  out.ultimo_sync_em = base.ultimo_sync_em ?? null;
  out.updated_at = base.updated_at ?? null;
  return out;
}

async function getIntegracoes() {
  const { data, error } = await sb.from('integracoes_ads').select('*');
  erro('getIntegracoes', error);
  const porCanal = Object.fromEntries((data || []).map(r => [r.canal, r]));
  return CANAIS_INTEGRACAO.map(c => integracaoPublica(porCanal[c], c));
}

async function salvarIntegracao(canal, dados = {}) {
  if (!CANAIS_INTEGRACAO.includes(canal)) throw new Error('canal inválido');

  const { data: atual, error: e1 } = await sb.from('integracoes_ads')
    .select('*').eq('canal', canal).maybeSingle();
  erro('salvarIntegracao/ler', e1);

  const patch = { canal };
  for (const campo of CAMPOS_INTEGRACAO[canal]) {
    if (!(campo in dados)) continue;
    let v = dados[campo];
    v = v === null || v === undefined ? '' : String(v).trim();
    // segredo vazio ou mascarado = "não mexi neste campo"
    if (SEGREDOS.has(campo) && (!v || v.startsWith(MASK))) continue;
    patch[campo] = v || null;
  }
  if ('ativo' in dados) patch.ativo = !!dados.ativo;

  const { data: row, error: e2 } = await sb.from('integracoes_ads')
    .upsert(patch, { onConflict: 'canal' }).select().single();
  erro('salvarIntegracao', e2);
  return integracaoPublica(row, canal);
}

async function limparIntegracao(canal) {
  if (!CANAIS_INTEGRACAO.includes(canal)) throw new Error('canal inválido');
  const patch = { canal, ativo: false };
  for (const campo of CAMPOS_INTEGRACAO[canal]) if (campo !== 'conta_nome') patch[campo] = null;
  const { data: row, error } = await sb.from('integracoes_ads')
    .upsert(patch, { onConflict: 'canal' }).select().single();
  erro('limparIntegracao', error);
  return integracaoPublica(row, canal);
}

/* ------------------------------------------------------------
   Investimento por canal e ROI
   ------------------------------------------------------------ */
const competenciaAtual = () => new Date().toISOString().slice(0, 7);

async function salvarMetrica(m = {}) {
  const canal = String(m.canal || '');
  if (!ORIGENS.includes(canal)) throw new Error('canal inválido');
  const competencia = /^\d{4}-\d{2}$/.test(m.competencia || '') ? m.competencia : competenciaAtual();
  const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

  const { error } = await sb.from('metricas_canal').upsert({
    canal, competencia, fonte: m.fonte === 'api' ? 'api' : 'manual',
    investimento: num(m.investimento),
    impressoes: Math.round(num(m.impressoes)),
    cliques: Math.round(num(m.cliques)),
    conversoes: Math.round(num(m.conversoes)),
  }, { onConflict: 'canal,competencia,fonte' });
  erro('salvarMetrica', error);
  return getROI(competencia);
}

async function getROI(competencia = competenciaAtual()) {
  const mes = /^\d{4}-\d{2}$/.test(competencia) ? competencia : competenciaAtual();

  const { data: metricas, error: e1 } = await sb.from('metricas_canal')
    .select('*').eq('competencia', mes);
  erro('getROI/metricas', e1);

  // linha da API prevalece sobre a digitada à mão
  const porCanal = {};
  for (const m of metricas || []) {
    const ant = porCanal[m.canal];
    if (!ant || (m.fonte === 'api' && ant.fonte !== 'api')) porCanal[m.canal] = m;
  }

  const rows = await todosOsLeads();
  const doMes = (iso) => String(iso || '').slice(0, 7) === mes;
  const leadsMes    = rows.filter(l => doMes(l.created_at));
  const fechadosMes = rows.filter(l => l.status === 'concluido' &&
                                       doMes(l.closed_at || l.updated_at || l.created_at));

  const linhas = ORIGENS.map(canal => {
    const m = porCanal[canal];
    const investimento = m ? Number(m.investimento) : 0;
    const leads = leadsMes.filter(l => l.origem === canal).length;
    const ganhos = fechadosMes.filter(l => l.origem === canal);
    const faturamento = ganhos.reduce((s, l) => s + l.valor_pago, 0);
    return {
      canal, investimento, leads, ganhos: ganhos.length, faturamento,
      fonte: m ? m.fonte : null,
      impressoes: m ? m.impressoes : 0,
      cliques: m ? m.cliques : 0,
      custoPorLead:  leads && investimento ? investimento / leads : 0,
      custoPorVenda: ganhos.length && investimento ? investimento / ganhos.length : 0,
      roi: investimento > 0 ? faturamento / investimento : null,
      lucro: faturamento - investimento,
    };
  }).filter(x => x.investimento > 0 || x.leads > 0 || x.faturamento > 0);

  const totInv = linhas.reduce((s, x) => s + x.investimento, 0);
  const totFat = linhas.reduce((s, x) => s + x.faturamento, 0);
  return {
    competencia: mes,
    linhas: linhas.sort((a, b) => b.faturamento - a.faturamento),
    totais: {
      investimento: totInv, faturamento: totFat, lucro: totFat - totInv,
      roi: totInv > 0 ? totFat / totInv : null,
      leads:  linhas.reduce((s, x) => s + x.leads, 0),
      ganhos: linhas.reduce((s, x) => s + x.ganhos, 0),
    },
  };
}

/* ------------------------------------------------------------
   Dados de exemplo
   ------------------------------------------------------------ */
async function reseed() {
  // apaga só os leads; clientes e agenda ficam (são compartilhados)
  const { error } = await sb.from('leads').delete().not('id', 'is', null);
  erro('reseed/limpar', error);

  const exemplos = [
    ['Rodrigo Alves','(12) 99141-5355','Hilux 2016','EAB7D89','Revisão de Motor',2130,'contato','google',12],
    ['Priscila Moraes','(12) 99233-4471','Onix 2019','FKZ1A23','Freios',480,'orcamento','meta',9],
    ['Anderson Souza','(12) 99688-1120','HB20 2021','GHT4C55','Troca de Óleo de Motor',190,'concluido','whatsapp',21],
    ['Camila Ribeiro','(12) 99555-8890','Corolla 2020','JKL8M11','Troca de Óleo de Câmbio',940,'concluido','meta',18],
    ['Marcos Vinícius','(12) 99777-2244','Compass 2022','MNP2Q77','Suspensão',1580,'agendado','google',4],
    ['Fernanda Lima','(12) 99444-6612','Kwid 2020','QRS5T33','Pneus',1360,'novo','indicacao',2],
    ['Wesley Cardoso','(12) 99888-3301','Ranger 2018','UVW9X44','Embreagem',2380,'em_servico','passagem',6],
    ['Luciana Ferreira','(12) 99322-7788','Argo 2021','YZA1B66','Alinhamento 3D',140,'concluido','organico',15],
    ['Diego Nunes','(12) 99611-4409','Strada 2019','CDE3F99','Correia Dentada',1290,'perdido','meta',25],
    ['Beatriz Campos','(12) 99270-5583','T-Cross 2022','GHI7J22','Diagnóstico com Scanner',160,'orcamento','google',3],
  ].map(([nome, telefone, carro_modelo, placa, servico, orcado, status, origem, dias]) => ({
    nome, telefone, carro_modelo, placa, servico,
    valor_orcado: orcado,
    valor_pago: status === 'concluido' ? Math.round(orcado * 1.05 * 100) / 100 : 0,
    status, origem,
    created_at: new Date(Date.now() - dias * 864e5).toISOString(),
  }));

  const { data, error: e2 } = await sb.from('leads').insert(exemplos).select('id');
  erro('reseed/inserir', e2);
  return (data || []).length;
}

module.exports = {
  STATUSES, ORIGENS, CANAIS_INTEGRACAO,
  createLead, getLead, listLeads, updateLead, deleteLead,
  getStats, weeklyData, reseed,
  getIntegracoes, salvarIntegracao, limparIntegracao,
  salvarMetrica, getROI,
  _sb: sb,
};
