// Service Worker do IndyCar CRM — é o que torna o app instalável
// e faz a casca abrir rápido mesmo com internet ruim na oficina.
const CACHE = 'indycar-crm-v3';

/* Se QUALQUER item desta lista faltar, o addAll rejeita e o service worker
   NÃO instala — o app deixa de ser instalável sem dizer por quê. Mantenha
   aqui só o que existe de verdade. */
const CORE = ['/', '/styles.css', '/app.js', '/crm-utils.js', '/melhorias.js', '/manifest.json',
              '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  /* NUNCA servir /api/ do cache. Lead e valor mudam o tempo todo;
     número velho em tela de CRM leva a decisão errada. */
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== self.location.origin) return;

  // estático: rede primeiro (pega a versão nova), cache só quando cai
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request).then((m) => m || (e.request.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});
