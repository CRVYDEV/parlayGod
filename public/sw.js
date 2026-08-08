/* OMERTÀ service worker — WEB PUSH + PWA app shell.
   Two jobs: (1) receive push events and show a notification (learn while away); (2) make the game an
   installable app that opens instantly and survives a flaky connection — WITHOUT ever serving stale game
   code. The whole game is one HTML file that changes on every deploy, so navigations are NETWORK-FIRST
   (you always get the latest client online; the cached shell is only an offline fallback). Static assets
   (icons, art) are cache-first. The API (/v1/*, the websocket) is NEVER cached. */
const CACHE = 'omerta-shell-v1';
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // third-party → passthrough
  // NEVER cache the live game surface — the API, the websocket, the SW itself.
  if (url.pathname.startsWith('/v1/') || url.pathname === '/openapi.json' || url.pathname === '/sw.js') return;

  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    // NETWORK-FIRST: always try fresh (a deploy must reach the player); fall back to the cached shell
    // only when the network is gone. Cache '/' as the canonical shell so any route resolves offline.
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('/').then((m) => m || caches.match(req)))
    );
    return;
  }
  // static assets (icons, /art/*, manifest) → CACHE-FIRST, then fill the cache.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});

/* ── WEB PUSH ── */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'OMERTÀ', body: '' }; }
  const title = d.title || 'OMERTÀ';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/' },
    tag: d.tag || title,          // collapse repeats of the same kind
    renotify: false,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) return w.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
