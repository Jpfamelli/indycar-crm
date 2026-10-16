/* ============================================================
   IndyCar CRM — endereços dos apps e caminho base (rodada 5, 16/10/2026)

   O CRM pode rodar SOLTO (https://indycar-crm.onrender.com/) ou montado na
   IndyCar Central (https://…/crm/). Tudo que a tela chama ou linka passa por
   aqui, para nenhum caminho começar com "/" na raiz do domínio:
   - rota('/api/leads')      → '/api/leads' solto · '/crm/api/leads' na Central
   - urlApp('agenda', '/?tel=55…') → host da Agenda solto · '/agenda/?tel=…' na Central
   A Central pode sobrepor tudo com window.INDYCAR_APPS antes deste arquivo.
   Carrega ANTES de crm-utils.js e app.js. Sem dependências.
   ============================================================ */
(function (root) {
  'use strict';
  const doc = typeof document !== 'undefined' ? document : null;
  const loc = typeof location !== 'undefined' ? location : { pathname: '/', origin: '' };
  /* Base = pasta da página: '/' ou '/crm/' (sempre termina com '/'). */
  const BASE = (() => {
    const p = String(loc.pathname || '/');
    return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1) || '/';
  })();
  const CENTRAL = BASE !== '/';
  const RAIZ_CENTRAL = CENTRAL ? BASE.slice(0, BASE.slice(0, -1).lastIndexOf('/') + 1) : '/';
  const sobre = (root && root.INDYCAR_APPS) || {};
  const HOSTS = Object.assign({
    atendimento: 'https://indycar-atendimento.onrender.com', crm: 'https://indycar-crm.onrender.com',
    agenda: 'https://indycar-agendamentos.onrender.com', comunicar: 'https://indycar-posvenda.onrender.com',
    orcador: 'https://indycar-orcador.netlify.app', patio: 'https://indycar-patio.netlify.app',
    site: 'https://indycar-taubate.netlify.app',
  }, sobre.hosts || {});
  const NOMES = { atendimento: 'Atendimento', crm: 'CRM', agenda: 'Agenda', comunicar: 'Comunicar', orcador: 'Orçador', patio: 'Pátio', site: 'Site' };
  /* Quem mora junto na Central (irmãos de caminho); os outros ficam no próprio host. */
  const IRMAOS = Object.assign({ agenda: 'agenda/', atendimento: 'atendimento/', crm: 'crm/', comunicar: 'comunicar/' }, sobre.irmaos || {});

  /** Caminho dentro do CRM. Aceita '/api/x', 'api/x' ou '/?lead=…'. */
  function rota(caminho) {
    const c = String(caminho ?? '');
    if (/^https?:\/\//i.test(c) || c.startsWith('tel:') || c.startsWith('mailto:')) return c;
    if (CENTRAL && (c === BASE.slice(0, -1) || c.startsWith(BASE))) return c;   // já veio com o prefixo (não dobra /crm/crm/)
    return BASE + c.replace(/^\/+/, '');
  }
  /** Caminho absoluto (com origem) dentro do CRM — para redirectTo e links copiáveis. */
  const absoluto = caminho => (loc.origin || '') + rota(caminho);
  /** Link para outro app (ou para o próprio CRM com app='crm'). */
  function urlApp(app, caminho = '/') {
    const rel = String(caminho ?? '/').replace(/^\/+/, '');
    if (CENTRAL && IRMAOS[app]) return RAIZ_CENTRAL + IRMAOS[app] + rel;
    if (app === 'crm') return BASE + rel;
    const host = HOSTS[app];
    return host ? host.replace(/\/$/, '') + '/' + rel : null;
  }
  /** Origem (scheme+host) de um app — para conferir links de notificação. */
  function origemApp(app) {
    try { return new URL(urlApp(app, '/'), loc.origin || 'https://indycar-crm.onrender.com').origin; } catch { return null; }
  }
  /** Lista para o seletor "Ecossistema IndyCar". */
  const lista = () => ['agenda', 'atendimento', 'comunicar', 'orcador', 'patio', 'site'].map(a => ({ app: a, nome: NOMES[a], url: urlApp(a, '/') })).filter(x => x.url);

  const api = { BASE, CENTRAL, RAIZ_CENTRAL, HOSTS, NOMES, IRMAOS, rota, absoluto, urlApp, origemApp, lista };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IndyCarApps = Object.freeze(api);
  void doc;
})(typeof window !== 'undefined' ? window : globalThis);
