// Service Worker do IndyCar CRM — torna o app instalável e abre a casca
// rápido mesmo com internet ruim na oficina.
// v6 (14/10/2026, rodada 4): o Render gratuito dorme e responde 503 por alguns
// minutos ao acordar. A casca (HTML, CSS, JS) sai do cache quando o servidor
// demora mais de 3,5 s ou responde erro — a tela abre e avisa "acordando".
// Biblioteca do Supabase e fontes (endereços com versão) ficam em cache direto.
const CACHE = 'indycar-crm-v7';
const CACHE_EXTERNO = 'indycar-crm-externo-v1';

/* Se QUALQUER item desta lista faltar, o addAll rejeita e o service worker
   NÃO instala. Só o que existe de verdade. */
const CORE = ['/', '/styles.css', '/app.js', '/crm-utils.js', '/crm-r4.js', '/melhorias.js', '/acesso.js', '/equipe.js', '/rodada4.js', '/crm-ia.js', '/crm-ia.css',
              '/manifest.json', '/icon-192.png', '/icon-512.png'];
const EXTERNOS = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];
const ESPERA_REDE_MS = 3500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CACHE_EXTERNO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Rede primeiro, mas sem esperar para sempre: depois de ESPERA_REDE_MS (ou se a
   resposta for 5xx, como o 503 "hibernate" do Render) usa o que está guardado.
   A resposta da rede que chegar depois ainda atualiza o cache. */
function redeComPrazo(req, chave) {
  return new Promise((resolve) => {
    let respondeu = false;
    const doCache = () => caches.match(chave).then((m) => m || (req.mode === 'navigate' ? caches.match('/') : null));
    const timer = setTimeout(() => {
      doCache().then((m) => { if (m && !respondeu) { respondeu = true; resolve(m); } });
    }, ESPERA_REDE_MS);
    fetch(req).then((r) => {
      if (r.ok && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(chave, cp)); }
      if (respondeu) return;
      if (r.status >= 500) {
        return doCache().then((m) => { if (respondeu) return; respondeu = true; clearTimeout(timer); resolve(m || r); });
      }
      respondeu = true; clearTimeout(timer); resolve(r);
    }).catch(() => {
      doCache().then((m) => { if (respondeu) return; respondeu = true; clearTimeout(timer); resolve(m || Response.error()); });
    });
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // biblioteca do Supabase (com versão no endereço) e fontes: cache primeiro
  if (url.origin !== self.location.origin) {
    if (!EXTERNOS.some((p) => e.request.url.startsWith(p))) return;
    e.respondWith(caches.open(CACHE_EXTERNO).then((c) => c.match(e.request).then((m) => m || fetch(e.request).then((r) => {
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
      return r;
    }))));
    return;
  }

  /* NUNCA servir /api/ do cache. Lead e valor mudam o tempo todo;
     número velho em tela de CRM leva a decisão errada. Links com ?lead=/?tel=
     usam a mesma casca "/" (o cache não guarda telefone na chave). */
  if (url.pathname.startsWith('/api/')) return;
  const chave = e.request.mode === 'navigate' ? '/' : url.pathname;
  e.respondWith(redeComPrazo(e.request, chave));
});
