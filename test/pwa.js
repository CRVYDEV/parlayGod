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

// ── THE MOTION LIBRARY route — the generated ambient clips behind the cinematics + the landing hero.
// The boot ALLOWLIST discipline (a request is a Map lookup — no traversal by construction), streamed
// from disk with RANGE support, which is NOT optional for <video>: Chromium's media stack refuses a
// source it cannot seek (found live by the motion probe — the element fires error and the client's
// fail-safe removes the clip).
{
  const r = await get('/art/hype/hero-poster.mp4');
  assert.equal(r.statusCode, 200, 'a motion clip serves');
  assert.ok(/video\/mp4/.test(r.headers['content-type']), 'as video/mp4');
  assert.equal(r.headers['accept-ranges'], 'bytes', 'and advertises range support (the <video> decoder needs it)');
  assert.ok(Number(r.headers['content-length']) > 100000, 'with a real content-length');
  const rr = await app.inject({ method: 'GET', url: '/art/hype/hero-poster.mp4', headers: { range: 'bytes=0-1023' } });
  assert.equal(rr.statusCode, 206, 'a range request gets 206 partial content');
  assert.equal(rr.headers['content-length'], '1024', 'exactly the requested slice');
  assert.ok(/^bytes 0-1023\//.test(rr.headers['content-range']), 'with a correct content-range');
  const bad = await app.inject({ method: 'GET', url: '/art/hype/hero-poster.mp4', headers: { range: 'bytes=999999999-' } });
  assert.equal(bad.statusCode, 416, 'an unsatisfiable range is refused, not crashed');
  assert.equal((await get('/art/hype/no-such-clip.mp4')).statusCode, 404, 'an unknown clip 404s (allowlist)');
  assert.equal((await get('/art/hype/..%2F..%2Fpackage.json')).statusCode, 404, 'traversal is a key not in the Map');
  // the AMBIENT BEDS ride the same allowlist + range machinery as the clips (an <audio> element
  // wants seekability exactly like <video>), typed audio/mp4 — and the client learns what shipped
  // from the motion manifest instead of hardcoding a list that would drift from this directory
  const bed = await get('/art/hype/bed-streets.m4a');
  assert.equal(bed.statusCode, 200, 'an ambient bed serves');
  assert.ok(/audio\/mp4/.test(bed.headers['content-type']), 'as audio/mp4');
  assert.equal(bed.headers['accept-ranges'], 'bytes', 'with range support');
  const mo = await get('/v1/art/motion');
  assert.equal(mo.statusCode, 200, 'the motion manifest serves');
  const moj = JSON.parse(mo.body);
  assert.ok(Array.isArray(moj.clips) && moj.clips.includes('hero-poster'), 'the manifest lists the clips (by plate name, no extension)');
  assert.ok(Array.isArray(moj.beds) && moj.beds.includes('bed-streets'), 'and the beds');
}

console.log('pwa: PASS');
await app.close();
process.exit(0);
