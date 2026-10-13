/* ============================================================
   IndyCar CRM — utilidades do servidor (sem dependências)
   Erro com status HTTP, UUID, paginação do Supabase, datas no
   fuso de São Paulo (UTC-3, sem horário de verão desde 2019).
   ============================================================ */
'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = v => UUID.test(String(v ?? ''));

/** Erro que vira resposta HTTP com mensagem para a pessoa (sem detalhe interno). */
class ErroHttp extends Error {
  constructor(status, msg, extra = {}) { super(msg); this.status = status; Object.assign(this, extra); }
}
const falha = (status, msg, extra) => new ErroHttp(status, msg, extra);

/** Lê todas as linhas de 1000 em 1000 (o Supabase corta em 1000 por consulta). */
async function todas(fazer, max = 20000) {
  const out = [];
  for (let i = 0; i < max; i += 1000) {
    const { data, error } = await fazer().range(i, i + 999);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}

const FUSO_MS = 3 * 3600_000;                       // America/Sao_Paulo = UTC-3
const DIA = 864e5;

/** 'AAAA-MM' do instante no fuso de São Paulo. */
const mesBRT = t => new Date(t - FUSO_MS).toISOString().slice(0, 7);
/** 'AAAA-MM-DD' do instante no fuso de São Paulo. */
const diaBRT = t => new Date(t - FUSO_MS).toISOString().slice(0, 10);

/** Aceita 'AAAA-MM' ou 'AAAA-MM-01'; devolve 'AAAA-MM' ou null. */
function normalizaMes(v) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const ano = Number(m[1]);
  if (ano < 2020 || ano > 2100) return null;
  return `${m[1]}-${m[2]}`;
}

/** Início e fim (ms) de um mês 'AAAA-MM' no fuso de São Paulo. */
function limitesMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const inicio = Date.UTC(a, m - 1, 1) + FUSO_MS;
  const fim = Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1) + FUSO_MS;
  return { inicio, fim };
}

const ts = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = v => Math.round(num(v) * 100) / 100;
const corta = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
/** Texto vindo de fora: só string/número, cortado no limite. */
const texto = (v, max) => (v === null || v === undefined || typeof v === 'object') ? '' : String(v).slice(0, max);

const PAPEIS_EQUIPE = ['admin', 'gestor', 'atendente'];
const PAPEIS = ['admin', 'gestor', 'atendente', 'agenda'];
const APPS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'];
const ehGestor = p => p === 'admin' || p === 'gestor';
/** Pessoa que pode trabalhar no CRM: ativa, da equipe e com 'crm' nos apps (admin sempre). */
const podeCrm = p => !!p && p.ativo !== false && PAPEIS_EQUIPE.includes(p.papel)
  && (p.papel === 'admin' || (Array.isArray(p.apps) && p.apps.includes('crm')));

module.exports = {
  ehUuid, ErroHttp, falha, todas, mesBRT, diaBRT, normalizaMes, limitesMes, ts, num, r2, corta, texto,
  FUSO_MS, DIA, PAPEIS_EQUIPE, PAPEIS, APPS, ehGestor, podeCrm,
};
