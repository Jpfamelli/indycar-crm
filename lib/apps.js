/* ============================================================
   IndyCar CRM — endereços dos outros apps (rodada 5, 16/10/2026)

   Um lugar só para os links entre apps. Dois modos:
   - SOLTO (hoje): cada app no próprio endereço (Render/Netlify).
   - CENTRAL (onda B2): o CRM montado em /crm/ de um servidor que também
     serve /agenda/, /atendimento/ e /comunicar/. Aí os irmãos são caminhos
     relativos à raiz e o prefixo vem em `req.prefixo` ou na variável PREFIXO.
   Variáveis CRM_URL_<APP> continuam valendo (testes e domínios próprios).
   ============================================================ */
'use strict';

const HOSTS = {
  atendimento: process.env.CRM_URL_ATENDIMENTO || 'https://indycar-atendimento.onrender.com',
  crm: process.env.CRM_URL_CRM || 'https://indycar-crm.onrender.com',
  agenda: process.env.CRM_URL_AGENDA || 'https://indycar-agendamentos.onrender.com',
  comunicar: process.env.CRM_URL_COMUNICAR || 'https://indycar-posvenda.onrender.com',
  orcador: process.env.CRM_URL_ORCADOR || 'https://indycar-orcador.netlify.app',
  patio: process.env.CRM_URL_PATIO || 'https://indycar-patio.netlify.app',
  site: process.env.CRM_URL_SITE || 'https://indycar-taubate.netlify.app',
  ads: null,
};
const NOMES = { atendimento: 'Atendimento', crm: 'CRM', agenda: 'Agenda', comunicar: 'Comunicar', orcador: 'Orçador', patio: 'Pátio', site: 'Site', ads: 'Tráfego pago' };
/* Na Central, estes quatro moram no mesmo servidor; os outros continuam no próprio endereço. */
const NA_CENTRAL = { agenda: '/agenda/', atendimento: '/atendimento/', crm: '/crm/', comunicar: '/comunicar/' };

/** '/crm' | '' — aceita '/crm', 'crm', '/crm/' e lixo (vira ''). */
function normalizarPrefixo(p) {
  const s = String(p ?? '').trim();
  if (!s || s === '/') return '';
  const limpo = '/' + s.replace(/^\/+|\/+$/g, '');
  return /^\/[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i.test(limpo) ? limpo : '';
}

/** Raiz da Central a partir do prefixo do CRM ('/crm' → ''; '/apps/crm' → '/apps'). */
const raizDe = prefixo => { const p = normalizarPrefixo(prefixo); return p ? p.slice(0, p.lastIndexOf('/')) : ''; };

/**
 * Link para outro app. `caminho` começa com '/' (ex.: '/?tel=5512…').
 * Com prefixo (Central) e app irmão: caminho relativo à raiz; senão o host.
 */
function linkApp(app, caminho = '/', { prefixo = '' } = {}) {
  const c = String(caminho || '/');
  const rel = c.startsWith('/') ? c.slice(1) : c;
  const pre = normalizarPrefixo(prefixo);
  if (pre && NA_CENTRAL[app]) return raizDe(pre) + NA_CENTRAL[app] + rel;
  const host = HOSTS[app];
  if (!host) return null;
  return host + '/' + rel;
}

/** Link dentro do próprio CRM (notificações, respostas da API). */
const linkCrm = (caminho = '/', { prefixo = '' } = {}) => {
  const pre = normalizarPrefixo(prefixo);
  const c = String(caminho || '/');
  return pre ? pre + (c.startsWith('/') ? c : '/' + c) : (c.startsWith('/') ? c : '/' + c);
};

/** Origens permitidas no CORS (hosts soltos). */
const origens = () => Object.values(HOSTS).filter(Boolean).map(h => h.replace(/\/$/, ''));

module.exports = { HOSTS, NOMES, NA_CENTRAL, normalizarPrefixo, raizDe, linkApp, linkCrm, origens };
