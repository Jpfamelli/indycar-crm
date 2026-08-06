/* ============================================================
   IndyCar CRM — camada de dados (node:sqlite, zero dependências)
   Guarda TODAS as informações do cliente: nome, telefone, carro,
   placa, serviço, valor orçado, valor pago, status, ORIGEM (Meta/
   Google/indicação/etc.) e as UTMs para atribuição de campanha.
   ============================================================ */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'crm.db');
const db = new DatabaseSync(DB_PATH);

// ---- Constantes de domínio (usadas também no front) ----
const STATUSES = ['novo', 'contato', 'orcamento', 'agendado', 'em_servico', 'concluido', 'perdido'];
const ORIGENS  = ['meta', 'google', 'indicacao', 'organico', 'whatsapp', 'passagem'];

// ---- Schema ----
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nome          TEXT NOT NULL,
    telefone      TEXT NOT NULL,
    email         TEXT,
    carro_modelo  TEXT,
    carro_ano     TEXT,
    placa         TEXT,
    servico       TEXT,
    valor_orcado  REAL DEFAULT 0,
    valor_pago    REAL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'novo',
    origem        TEXT NOT NULL DEFAULT 'organico',
    utm_source    TEXT,
    utm_medium    TEXT,
    utm_campaign  TEXT,
    observacoes   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    closed_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_origem ON leads(origem);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
`);

// ---- Schema: integrações de mídia (Meta Ads / Google Ads) e investimento por canal ----
db.exec(`
  CREATE TABLE IF NOT EXISTS integracoes (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    canal                    TEXT NOT NULL UNIQUE,      -- 'meta' | 'google'
    ativo                    INTEGER NOT NULL DEFAULT 0,
    conta_nome               TEXT,

    -- Meta Ads (Facebook / Instagram)
    meta_access_token        TEXT,                      -- SEGREDO
    meta_ad_account_id       TEXT,                      -- act_1234567890
    meta_pixel_id            TEXT,
    meta_app_id              TEXT,
    meta_token_expira_em     TEXT,

    -- Google Ads
    google_customer_id       TEXT,                      -- 10 dígitos
    google_login_customer_id TEXT,                      -- MCC (opcional)
    google_developer_token   TEXT,                      -- SEGREDO
    google_client_id         TEXT,
    google_client_secret     TEXT,                      -- SEGREDO
    google_refresh_token     TEXT,                      -- SEGREDO

    ultimo_sync_em           TEXT,
    ultimo_sync_status       TEXT,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metricas_canal (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    canal        TEXT NOT NULL,
    competencia  TEXT NOT NULL,                         -- 'AAAA-MM'
    investimento REAL    NOT NULL DEFAULT 0,
    impressoes   INTEGER NOT NULL DEFAULT 0,
    cliques      INTEGER NOT NULL DEFAULT 0,
    conversoes   INTEGER NOT NULL DEFAULT 0,
    fonte        TEXT    NOT NULL DEFAULT 'manual',     -- 'manual' | 'api'
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE(canal, competencia, fonte)
  );
  CREATE INDEX IF NOT EXISTS idx_metricas_comp ON metricas_canal(competencia);
`);

const CANAIS_INTEGRACAO = ['meta', 'google'];

// campos gravados por canal; os marcados em SEGREDOS nunca voltam pela API
const CAMPOS_INTEGRACAO = {
  meta:   ['conta_nome', 'meta_access_token', 'meta_ad_account_id', 'meta_pixel_id',
           'meta_app_id', 'meta_token_expira_em'],
  google: ['conta_nome', 'google_customer_id', 'google_login_customer_id',
           'google_developer_token', 'google_client_id', 'google_client_secret',
           'google_refresh_token'],
};
const SEGREDOS = new Set(['meta_access_token', 'google_developer_token',
                          'google_client_secret', 'google_refresh_token']);
const OBRIGATORIOS = {
  meta:   ['meta_access_token', 'meta_ad_account_id'],
  google: ['google_customer_id', 'google_developer_token', 'google_client_id',
           'google_client_secret', 'google_refresh_token'],
};

const nowISO = () => new Date().toISOString();

/* Valores em R$: nunca negativos (o front aceitava -5000 e o ticket médio
   e o faturamento saíam errados) e arredondados aos centavos. */
const dinheiro = v => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
};

/* ============================================================
   CRUD
   ============================================================ */
const COLS = ['nome','telefone','email','carro_modelo','carro_ano','placa','servico',
              'valor_orcado','valor_pago','status','origem','utm_source','utm_medium',
              'utm_campaign','observacoes'];

function createLead(data) {
  const now = nowISO();
  const row = {};
  for (const c of COLS) row[c] = data[c] ?? null;
  row.valor_orcado = dinheiro(data.valor_orcado);
  row.valor_pago   = dinheiro(data.valor_pago);
  row.status = STATUSES.includes(data.status) ? data.status : 'novo';
  row.origem = ORIGENS.includes(data.origem) ? data.origem : 'organico';
  const closed = row.status === 'concluido' || row.status === 'perdido' ? now : null;

  const stmt = db.prepare(`
    INSERT INTO leads (${COLS.join(',')}, created_at, updated_at, closed_at)
    VALUES (${COLS.map(() => '?').join(',')}, ?, ?, ?)
  `);
  const info = stmt.run(...COLS.map(c => row[c]), data.created_at || now, now, closed);
  return getLead(info.lastInsertRowid);
}

function getLead(id) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

/* Normalização da busca: o LIKE do SQLite não entende acento nem caixa em
   UTF-8, então "Patricia" não achava "Patrícia" e o telefone colado do
   WhatsApp (5512996830272) não achava "(12) 99683-0272". */
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const norm  = s => semAcento(s).replace(/[^a-z0-9]+/g, ' ').trim();
const alnum = s => semAcento(s).replace(/[^a-z0-9]/g, '');
const digitos = s => String(s ?? '').replace(/\D/g, '');
// ignora +55, DDD e o 9 extra — compara pelos últimos 8 dígitos
const telKey = s => { const d = digitos(s); return d.length >= 8 ? d.slice(-8) : d; };

function listLeads({ status, origem, q } = {}) {
  let sql = 'SELECT * FROM leads';
  const where = [], args = [];
  if (status && STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
  if (origem && ORIGENS.includes(origem)) { where.push('origem = ?'); args.push(origem); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY datetime(created_at) DESC';
  const rows = db.prepare(sql).all(...args);

  const termo = norm(q);
  if (!termo) return rows;

  const qDig = digitos(q);
  const qTel = qDig.length >= 4 ? telKey(q) : null;
  const qAln = alnum(q);

  return rows.filter(l => {
    const texto = norm([l.nome, l.telefone, l.placa, l.carro_modelo, l.servico].join(' '));
    if (texto.includes(termo)) return true;
    if (qTel && telKey(l.telefone) === qTel) return true;            // telefone em qualquer formato
    if (qAln && alnum(l.placa).includes(qAln)) return true;          // placa FKZ-1A23 == fkz1a23
    return false;
  });
}

function updateLead(id, data) {
  const cur = getLead(id);
  if (!cur) return null;
  const patch = {};
  for (const c of COLS) if (c in data) patch[c] = data[c];
  if ('valor_orcado' in patch) patch.valor_orcado = dinheiro(patch.valor_orcado);
  if ('valor_pago'   in patch) patch.valor_pago   = dinheiro(patch.valor_pago);
  if (patch.status && !STATUSES.includes(patch.status)) delete patch.status;
  if (patch.origem && !ORIGENS.includes(patch.origem)) delete patch.origem;

  const keys = Object.keys(patch);
  if (!keys.length) return cur;

  // fecha o lead quando vira concluído/perdido; reabre caso contrário
  let closedSet = '';
  if (patch.status) {
    closedSet = (patch.status === 'concluido' || patch.status === 'perdido')
      ? `, closed_at = COALESCE(closed_at, '${nowISO()}')`
      : `, closed_at = NULL`;
  }
  const sql = `UPDATE leads SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ?${closedSet} WHERE id = ?`;
  db.prepare(sql).run(...keys.map(k => patch[k]), nowISO(), id);
  return getLead(id);
}

function deleteLead(id) {
  return db.prepare('DELETE FROM leads WHERE id = ?').run(id).changes > 0;
}

/* ============================================================
   ESTATÍSTICAS (dashboard + insumo da IA)
   ============================================================ */
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function statsFor(sinceISO) {
  // ENTRADA do período: leads captados (por created_at)
  const rows = db.prepare('SELECT * FROM leads WHERE datetime(created_at) >= datetime(?)').all(sinceISO);
  const total = rows.length;

  // RECEITA do período: serviços FECHADOS na janela (por closed_at).
  // Antes usava created_at, então um carro que entrou há 10 dias e foi pago
  // ontem não entrava no faturamento da semana — o dono via receita a menos.
  const fechadosRows = db.prepare(`
    SELECT * FROM leads
     WHERE status IN ('concluido','perdido')
       AND datetime(COALESCE(closed_at, updated_at)) >= datetime(?)
  `).all(sinceISO);
  const concluidos = fechadosRows.filter(r => r.status === 'concluido');
  const perdidos   = fechadosRows.filter(r => r.status === 'perdido');
  const faturamento = concluidos.reduce((s, r) => s + (r.valor_pago || 0), 0);
  const ticket = concluidos.length ? faturamento / concluidos.length : 0;
  const fechados = concluidos.length + perdidos.length;
  const conversao = fechados ? (concluidos.length / fechados) * 100 : 0;

  // ESTOQUE: pipeline aberto é saldo acumulado — não faz sentido recortar por janela
  const emAberto = db.prepare(
    "SELECT COALESCE(SUM(valor_orcado),0) v FROM leads WHERE status NOT IN ('concluido','perdido')"
  ).get().v;

  const porOrigem = ORIGENS.map(o => {
    const r = rows.filter(x => x.origem === o);          // entrada na janela
    const g = concluidos.filter(x => x.origem === o);    // fechamento na janela
    return {
      origem: o,
      leads: r.length,
      ganhos: g.length,
      faturamento: g.reduce((s, x) => s + (x.valor_pago || 0), 0),
    };
  }).filter(x => x.leads > 0 || x.ganhos > 0).sort((a, b) => b.leads - a.leads);

  const porStatus = {};
  for (const s of STATUSES) porStatus[s] = rows.filter(r => r.status === s).length;

  return { total, ganhos: concluidos.length, perdidos: perdidos.length,
           faturamento, emAberto, ticket, conversao, porOrigem, porStatus };
}

function getStats() {
  const semana = statsFor(daysAgoISO(7));
  const semanaAnterior = statsFor(daysAgoISO(14));
  // "anterior" real = 14d atrás até 7d atrás
  const prevRows = db.prepare(
    'SELECT * FROM leads WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)'
  ).all(daysAgoISO(14), daysAgoISO(7));
  const prev = {
    total: prevRows.length,
    faturamento: prevRows.filter(r => r.status === 'concluido').reduce((s, r) => s + (r.valor_pago || 0), 0),
  };
  const geral = statsFor('1970-01-01');
  return {
    geral,
    semana,
    comparativo: {
      leads: { atual: semana.total, anterior: prev.total },
      faturamento: { atual: semana.faturamento, anterior: prev.faturamento },
    },
    dominios: { STATUSES, ORIGENS },
  };
}

/* dados detalhados da semana para alimentar a IA */
function weeklyData() {
  const semanaLeads = db.prepare(
    'SELECT * FROM leads WHERE datetime(created_at) >= datetime(?) ORDER BY datetime(created_at) DESC'
  ).all(daysAgoISO(7));
  return { stats: getStats(), semanaLeads };
}

/* ============================================================
   SEED — dados de exemplo realistas
   ============================================================ */
function reseed() {
  db.exec('DELETE FROM leads;');
  const servicos = ['Troca de Óleo de Motor','Troca de Óleo de Câmbio','Freios','Suspensão',
    'Correia Dentada','Pneus','Alinhamento 3D','Embreagem','Diagnóstico com Scanner',
    'Revisão de Motor','Revisão de Suspensão','Limpeza de Bicos'];
  const carros = ['Onix 2019','HB20 2020','Corolla 2018','Civic 2017','Gol 2015','Toro 2021',
    'Hilux 2016','Compass 2022','Kwid 2020','Creta 2021','Renegade 2019','Tracker 2022',
    'Polo 2021','Strada 2020','T-Cross 2022','Sandero 2018'];
  const nomes = ['Marcelo Nunes','Patrícia Andrade','Anderson Souza','Camila Ribeiro','Rodrigo Alves',
    'Juliana Santos','Fernando Lima','Bruna Costa','Mariana Dias','Eduardo Rocha','Vanessa Melo',
    'Rafael Pinto','Aline Gomes','Gustavo Freitas','Tatiane Cruz','Leandro Barros','Priscila Moraes',
    'Renato Cardoso','Sandra Teixeira','Felipe Ramos'];
  const placas = ['FKZ1A23','GHB4C56','EAB7D89','FLM2E34','GKC5F67','EMD8G90','FNP3H45','GPE6J78'];

  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const money = (min, max) => Math.round((min + Math.random() * (max - min)) / 10) * 10;

  const N = 46;
  for (let i = 0; i < N; i++) {
    const status = rnd(STATUSES.concat(['concluido','concluido','orcamento','contato','novo'])); // pesa alguns
    const origem = rnd(ORIGENS.concat(['meta','google','whatsapp','indicacao'])); // pesa canais reais
    const orcado = money(180, 3200);
    const pago = status === 'concluido' ? orcado : 0;
    const dias = Math.floor(Math.random() * 34); // últimos ~34 dias
    const created = daysAgoISO(dias);
    const utm = origem === 'meta'   ? { s: 'facebook', m: 'cpc', c: 'trafego-cambio-automatico' }
             : origem === 'google' ? { s: 'google',   m: 'cpc', c: 'pesquisa-oficina-taubate' }
             : origem === 'organico' ? { s: 'google', m: 'organic', c: null }
             : { s: null, m: null, c: null };

    createLead({
      nome: rnd(nomes),
      telefone: `(12) 9 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`,
      email: null,
      carro_modelo: rnd(carros),
      carro_ano: null,
      placa: rnd(placas),
      servico: rnd(servicos),
      valor_orcado: orcado,
      valor_pago: pago,
      status,
      origem,
      utm_source: utm.s, utm_medium: utm.m, utm_campaign: utm.c,
      observacoes: null,
      created_at: created,
    });
  }
  return N;
}

// popula na primeira execução (banco vazio)
if (db.prepare('SELECT COUNT(*) AS n FROM leads').get().n === 0) {
  reseed();
}

/* ============================================================
   INTEGRAÇÕES (Meta Ads / Google Ads) + ROI por canal
   ============================================================ */
const MASK = '•';
/* Mostra só os 4 últimos caracteres e sempre 8 pontos — não vazar o
   comprimento real do segredo faz parte da proteção. */
function mascarar(valor, visiveis = 4) {
  if (valor === null || valor === undefined || valor === '') return null;
  const s = String(valor);
  return s.length <= visiveis ? MASK.repeat(8) : MASK.repeat(8) + s.slice(-visiveis);
}

/** Versão segura para a API: segredos viram máscara + flag, nunca o valor. */
function integracaoPublica(row, canal) {
  const base = row || { canal, ativo: 0 };
  const out = { canal, ativo: !!base.ativo, conta_nome: base.conta_nome ?? null };
  for (const campo of CAMPOS_INTEGRACAO[canal]) {
    if (campo === 'conta_nome') continue;
    if (SEGREDOS.has(campo)) {
      out[campo] = null;
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

function getIntegracoes() {
  return CANAIS_INTEGRACAO.map(canal => {
    const row = db.prepare('SELECT * FROM integracoes WHERE canal = ?').get(canal);
    return integracaoPublica(row, canal);
  });
}

/** Upsert. Um segredo enviado vazio OU mascarado é ignorado — assim o front
 *  pode reenviar o formulário inteiro sem apagar credenciais já salvas. */
function salvarIntegracao(canal, data = {}) {
  if (!CANAIS_INTEGRACAO.includes(canal)) throw new Error('canal inválido');
  const now = nowISO();
  const atual = db.prepare('SELECT * FROM integracoes WHERE canal = ?').get(canal);
  if (!atual) {
    db.prepare('INSERT INTO integracoes (canal, ativo, created_at, updated_at) VALUES (?,0,?,?)')
      .run(canal, now, now);
  }
  const sets = [], args = [];
  for (const campo of CAMPOS_INTEGRACAO[canal]) {
    if (!(campo in data)) continue;
    let v = data[campo];
    v = v === null || v === undefined ? '' : String(v).trim();
    if (SEGREDOS.has(campo) && (!v || v.startsWith(MASK))) continue;  // usuário não mexeu
    sets.push(`${campo} = ?`);
    args.push(v || null);
  }
  if ('ativo' in data) { sets.push('ativo = ?'); args.push(data.ativo ? 1 : 0); }
  if (sets.length) {
    sets.push('updated_at = ?'); args.push(now, canal);
    db.prepare(`UPDATE integracoes SET ${sets.join(', ')} WHERE canal = ?`).run(...args);
  }
  const row = db.prepare('SELECT * FROM integracoes WHERE canal = ?').get(canal);
  return integracaoPublica(row, canal);
}

/** Apaga as credenciais do canal, preservando a linha e o apelido. */
function limparIntegracao(canal) {
  if (!CANAIS_INTEGRACAO.includes(canal)) throw new Error('canal inválido');
  const campos = CAMPOS_INTEGRACAO[canal].filter(c => c !== 'conta_nome');
  db.prepare(`UPDATE integracoes SET ${campos.map(c => `${c} = NULL`).join(', ')},
              ativo = 0, updated_at = ? WHERE canal = ?`).run(nowISO(), canal);
  const row = db.prepare('SELECT * FROM integracoes WHERE canal = ?').get(canal);
  return integracaoPublica(row, canal);
}

const competenciaAtual = () => new Date().toISOString().slice(0, 7);   // 'AAAA-MM'

function salvarMetrica(m = {}) {
  const canal = String(m.canal || '');
  if (!ORIGENS.includes(canal)) throw new Error('canal inválido');
  const competencia = /^\d{4}-\d{2}$/.test(m.competencia || '') ? m.competencia : competenciaAtual();
  const fonte = m.fonte === 'api' ? 'api' : 'manual';
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const now = nowISO();
  db.prepare(`
    INSERT INTO metricas_canal (canal, competencia, investimento, impressoes, cliques, conversoes, fonte, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(canal, competencia, fonte) DO UPDATE SET
      investimento = excluded.investimento, impressoes = excluded.impressoes,
      cliques = excluded.cliques, conversoes = excluded.conversoes, updated_at = excluded.updated_at
  `).run(canal, competencia, num(m.investimento), Math.round(num(m.impressoes)),
         Math.round(num(m.cliques)), Math.round(num(m.conversoes)), fonte, now, now);
  return getROI(competencia);
}

/** Cruza investimento declarado × faturamento REAL dos leads daquele mês.
 *  Faturamento conta pelo fechamento (closed_at), igual ao dashboard. */
function getROI(competencia = competenciaAtual()) {
  const mes = /^\d{4}-\d{2}$/.test(competencia) ? competencia : competenciaAtual();

  const metricas = db.prepare('SELECT * FROM metricas_canal WHERE competencia = ?').all(mes);
  // se houver linha da API para o canal, ela prevalece sobre a digitada
  const porCanal = {};
  for (const m of metricas) {
    const ant = porCanal[m.canal];
    if (!ant || (m.fonte === 'api' && ant.fonte !== 'api')) porCanal[m.canal] = m;
  }

  const leadsMes = db.prepare(
    "SELECT * FROM leads WHERE strftime('%Y-%m', created_at) = ?").all(mes);
  const fechadosMes = db.prepare(`
    SELECT * FROM leads WHERE status = 'concluido'
      AND strftime('%Y-%m', COALESCE(closed_at, updated_at)) = ?`).all(mes);

  const linhas = ORIGENS.map(canal => {
    const m = porCanal[canal];
    const investimento = m ? m.investimento : 0;
    const leads = leadsMes.filter(l => l.origem === canal).length;
    const ganhos = fechadosMes.filter(l => l.origem === canal);
    const faturamento = ganhos.reduce((s, l) => s + (l.valor_pago || 0), 0);
    return {
      canal, investimento, leads, ganhos: ganhos.length, faturamento,
      fonte: m ? m.fonte : null,
      impressoes: m ? m.impressoes : 0,
      cliques: m ? m.cliques : 0,
      custoPorLead: leads && investimento ? investimento / leads : 0,
      custoPorVenda: ganhos.length && investimento ? investimento / ganhos.length : 0,
      // ROI = retorno sobre o investimento (faturamento ÷ investimento)
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
      leads: linhas.reduce((s, x) => s + x.leads, 0),
      ganhos: linhas.reduce((s, x) => s + x.ganhos, 0),
    },
  };
}

module.exports = {
  db, STATUSES, ORIGENS, CANAIS_INTEGRACAO,
  createLead, getLead, listLeads, updateLead, deleteLead,
  getStats, weeklyData, reseed,
  getIntegracoes, salvarIntegracao, limparIntegracao,
  salvarMetrica, getROI,
};
