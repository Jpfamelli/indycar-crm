// Service Worker do IndyCar CRM — torna o app instalável e abre a casca
// rápido mesmo com internet ruim na oficina.
// v4 (09/10/2026, rodada 2): gaveta do lead, painel por período, lembretes.
const CACHE = 'indycar-crm-v4';

/* Se QUALQUER item desta lista faltar, o addAll rejeita e o service worker
   NÃO instala. Só o que existe de verdade (crm-ia.js/.css são do módulo da IA). */
const CORE = ['/', '/styles.css', '/app.js', '/crm-utils.js', '/melhorias.js', '/crm-ia.js', '/crm-ia.css',
              '/manifest.json', '/icon-192.png', '/icon-512.png'];

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
     número velho em tela de CRM leva a decisão errada. Também fora:
     outros domínios, métodos que não são GET e links com ?lead=/?tel=
     (a casca é a mesma; o cache guarda só "/", sem telefone na chave). */
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const chave = e.request.mode === 'navigate' ? '/' : e.request;

  // estático: rede primeiro (pega a versão nova), cache só quando cai
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(chave, cp)); }
        return r;
      })
      .catch(() => caches.match(chave).then((m) => m || (e.request.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});
