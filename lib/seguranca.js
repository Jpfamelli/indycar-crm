/* ============================================================
   IndyCar CRM — segurança do servidor HTTP
   - cabeçalhos (CSP com frame-ancestors 'none', nosniff, Referrer-Policy,
     Permissions-Policy, HSTS, COOP, X-Frame-Options)
   - CSP da página com o hash de cada <script> embutido (calculado do
     próprio index.html: se a tela mudar o script, o hash acompanha)
   - CORS só para os domínios do ecossistema IndyCar
   - IP do cliente atrás do proxy do Render
   - freio (limite por chave numa janela) que limpa a memória sozinho
   ============================================================ */
'use strict';

const crypto = require('node:crypto');

const ORIGENS_ECOSSISTEMA = [
  'https://indycar-crm.onrender.com', 'https://indycar-atendimento.onrender.com',
  'https://indycar-posvenda.onrender.com', 'https://indycar-agendamentos.onrender.com',
  'https://indycar-ads.onrender.com', 'https://indycar-orcador.netlify.app',
  'https://indycar-taubate.netlify.app',
];

function origensPermitidas({ extra = '', local = false } = {}) {
  const s = new Set(ORIGENS_ECOSSISTEMA);
  for (const o of String(extra || '').split(',').map(x => x.trim()).filter(Boolean)) if (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)) s.add(o.replace(/\/$/, ''));
  return o => !!o && (s.has(o) || (local && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)));
}

/** sha256 em base64 de cada <script> sem src (para a CSP). */
function hashesScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) if (m[1].trim()) out.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  return out;
}

function cspPagina({ hashes = [], supabaseUrl = '' } = {}) {
  let sb = '';
  try { if (supabaseUrl) { const u = new URL(supabaseUrl); sb = `${u.origin} wss://${u.host}`; } } catch { /* sem supabase */ }
  return [
    "default-src 'self'",
    `script-src 'self' https://cdn.jsdelivr.net ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${sb}`.trim(),
    "manifest-src 'self'", "worker-src 'self'",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; ');
}

const CSP_API = "default-src 'none'; frame-ancestors 'none'";

/** Cabeçalhos comuns a toda resposta (a CSP da página entra por cima no HTML). */
function aplicarCabecalhos(res, { https = true } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP_API);
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/** CORS: só ecossistema. Devolve true se respondeu a um preflight (OPTIONS). */
function tratarCors(req, res, permitida) {
  const origem = req.headers.origin;
  const ok = permitida(origem);
  if (ok) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, x-agendador-token, x-idempotencia');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(ok ? 204 : 403, { 'Content-Length': 0 }).end();
    return true;
  }
  return false;
}

/** IP de quem chamou. Na nuvem (proxy do Render) vem no x-forwarded-for. */
function ipDe(req, { atrasDeProxy = false } = {}) {
  if (atrasDeProxy) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf && xf.length <= 64) return xf;
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

/** Freio: no máximo `teto` usos por `janelaMs` para cada chave. */
function criarFreio({ agora = () => Date.now(), max = 5000 } = {}) {
  const uso = new Map();
  function dentro(chave, teto, janelaMs) {
    const t = agora();
    const atual = uso.get(chave);
    if (!atual || atual.zeraEm <= t) {
      if (uso.size >= max) { for (const [k, v] of uso) if (v.zeraEm <= t) uso.delete(k); if (uso.size >= max) uso.clear(); }
      uso.set(chave, { qtd: 1, zeraEm: t + janelaMs });
      return true;
    }
    if (atual.qtd >= teto) return false;
    atual.qtd++;
    return true;
  }
  /** Só conta (para falhas de login): true enquanto não estourou. */
  function contar(chave, teto, janelaMs) { return dentro(chave, teto, janelaMs); }
  function estourou(chave, teto) { const a = uso.get(chave); return !!a && a.zeraEm > agora() && a.qtd >= teto; }
  function quantoFalta(chave) { const a = uso.get(chave); return a ? Math.max(0, Math.ceil((a.zeraEm - agora()) / 1000)) : 0; }
  return { dentro, contar, estourou, quantoFalta, _uso: uso };
}

/** Compara dois segredos sem vazar tempo. */
function segredoConfere(dado, esperado) {
  if (!dado || !esperado) return false;
  const a = crypto.createHash('sha256').update(String(dado)).digest();
  const b = crypto.createHash('sha256').update(String(esperado)).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { ORIGENS_ECOSSISTEMA, origensPermitidas, hashesScripts, cspPagina, CSP_API, aplicarCabecalhos, tratarCors, ipDe, criarFreio, segredoConfere };
