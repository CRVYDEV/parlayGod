// PWA — the game installs to the home screen (iOS + Android): a web manifest, app icons, and the
// install meta in the client. Confirms the manifest is valid + complete, the icons serve as PNGs, the
// service worker is an app-shell (network-first navigations, never caches the API), and the client head
// carries the install tags. Runs on pg-mem — zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';

const app = await buildServer();
const get = async (url) => { const r = await app.inject({ method: 'GET', url }); return r; };

// ── the manifest: valid, complete, installable ──
const m = await get('/manifest.json');
assert.equal(m.statusCode, 200, 'manifest serves');
assert.ok(/application\/manifest\+json/.test(m.headers['content-type']), 'the right content-type');
const man = JSON.parse(m.body);
assert.ok(man.name && man.short_name, 'has a name');
assert.equal(man.display, 'standalone', 'display: standalone (opens as an app, no browser chrome)');
assert.ok(man.start_url, 'has a start_url');
assert.equal(man.theme_color, '#0c0b0d', 'the noir theme color');
assert.ok(Array.isArray(man.icons) && man.icons.length >= 2, 'at least two icon sizes');
assert.ok(man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512'), '192 + 512 present');
assert.ok(man.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon (Android safe-zone)');
// the alt name some platforms probe
assert.equal((await get('/manifest.webmanifest')).statusCode, 200, '/manifest.webmanifest also serves');

// ── the icons are real PNGs ──
for (const f of ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']) {
  const r = await get(f);
  assert.equal(r.statusCode, 200, `${f} serves`);
  assert.ok(/image\/png/.test(r.headers['content-type']), `${f} is a PNG`);
  const b = r.rawPayload;
  assert.ok(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, `${f} has the PNG magic bytes`);
  // every icon the manifest lists must actually resolve (a 404 icon breaks install)
}
for (const i of man.icons) assert.equal((await get(i.src)).statusCode, 200, `manifest icon ${i.src} resolves`);

// ── the service worker is an app shell (not just push) ──
const sw = (await get('/sw.js')).body;
assert.ok(/addEventListener\(['"]install['"]/.test(sw), 'the SW handles install (pre-caches the shell)');
assert.ok(/addEventListener\(['"]fetch['"]/.test(sw), 'the SW handles fetch (offline shell)');
assert.ok(/addEventListener\(['"]push['"]/.test(sw), 'the SW still handles push');
assert.ok(sw.includes("startsWith('/v1/')"), 'the SW NEVER caches the API');

// ── the client head carries the install tags ──
const html = (await get('/')).body;
assert.ok(html.includes('<link rel="manifest" href="/manifest.json">'), 'the client links the manifest');
assert.ok(html.includes('rel="apple-touch-icon"'), 'an apple-touch-icon (iOS home screen)');
assert.ok(html.includes('name="apple-mobile-web-app-capable"'), 'iOS standalone meta');
assert.ok(html.includes('name="theme-color"'), 'a theme-color');

console.log('pwa: PASS');
await app.close();
process.exit(0);
