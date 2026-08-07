/* OMERTÀ service worker — WEB PUSH only (learn while away). No caching/offline; this file exists solely
   to receive push events and show a notification, and to focus the game when one is tapped. */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'OMERTÀ', body: '' }; }
  const title = d.title || 'OMERTÀ';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/art/hero-poster.jpg',
    badge: '/art/hero-poster.jpg',
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
