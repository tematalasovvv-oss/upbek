// UpBek service worker: работает без интернета, обновления подтягиваются при наличии сети
const CACHE = 'upbek-v9';
const FILES = ['./', 'index.html', 'style.css', 'theme.css', 'config.js', 'data.js', 'app.js', 'sync.js', 'ai.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// сначала сеть (свежая версия), если нет сети — кэш
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return; // сервер и шрифты — напрямую
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // всегда проверяем свежую версию
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
