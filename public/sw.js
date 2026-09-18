/* PAINEL NP — Service Worker
 *
 * Estratégia:
 *  - Precache do shell (rotas, manifest, ícones).
 *  - Fetch: network-first com fallback de cache. Não intercepta /api/*
 *    (precisamos de dados sempre fresh).
 *  - Ativação: limpa caches antigos.
 */

const CACHE_VERSION = 'painel-np-v1';
const PRECACHE = [
  '/',
  '/painel',
  '/tarefas',
  '/financeiro',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-maskable.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só GET
  if (req.method !== 'GET') return;

  // Não intercepta API (precisa sempre fresco)
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // Network-first com fallback cache
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cacheia responses OK pra próxima vez offline
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/painel')))
  );
});
