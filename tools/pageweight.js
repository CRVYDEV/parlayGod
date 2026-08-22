#!/usr/bin/env node
// ── PAGE WEIGHT ─────────────────────────────────────────────────────────────────────────────────
// What the PLAYER downloads. The fourth cost surface, and the one nothing measured.
//
//   npm run pageweight
//
// tools/pollcost.js counts the REQUESTS an idle player makes, and says out loud that it cannot see
// what they cost. tools/boardcost.js sizes a polled BOARD against the database. tools/workercost.js
// sizes the TICK. All three measure the SERVER. None of them measures the bytes that actually cross
// the wire to a phone, which is the cost the player pays and the only one they can feel directly.
//
// That gap hid a real one. GET '/' served public/index.html — 1,047,078 bytes, the largest asset in
// the game, fetched by every player on every cold load — with no compression and no cache-control,
// while every neighbouring static route (the icons, the art plates, the manifest, the portraits) set
// one. The forgotten-sibling shape, on the single most-fetched thing we serve.
//
// WHAT IT MEASURES, and the split matters:
//   • the COLD LOAD — every response a fresh browser fetches to render the first screen, worst-first,
//     with what each one WOULD have cost compressed. Paid once per player per cache lifetime.
//   • the RECURRING half — the board tick's own fetches. Paid by every player every window, forever,
//     so a kilobyte here is worth far more than a kilobyte in the document.
//   • the COMPRESSIBLE GAP — bytes shipped uncompressed that gzip would shrink. This is the verdict
//     line, because it is the number a fix moves.
//
// TWO HONEST LIMITS, stated rather than rounded away:
//   1. It runs over LOCALHOST. The BYTES are exact; the milliseconds are a floor and not what a phone
//      on a real network sees. Read the sizes, treat the timings as a lower bound.
//   2. It measures the ORIGIN. If a CDN or proxy compresses in front of us in production, the wire
//      cost there is lower than this reports — but the origin is the half we control and the half
//      that is true on every deploy target, so it is the half worth fixing.
//
// A MEASUREMENT, NOT A GATE, and not in CI — the pollcost/boardcost/workercost precedent. A byte
// threshold would sit either so high it never fires or so low it fires on every content drop and
// gets routed around. What it FINDS gets the real guard: the compression it turned up is pinned in
// test/routes.js, which does run.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildServer } from '../src/server.js';

// ── finding a browser (the mobile-harness resolver; it fails loudly rather than skipping, because a
// harness that measures nothing reads exactly like a harness that passes) ───────────────────────
function resolveBrowser() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, `${process.env.HOME || ''}/.cache/ms-playwright`].filter(Boolean);
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries.filter((x) => x.startsWith('chromium')).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(root, e, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const exe = resolveBrowser();
if (!exe) {
  console.error(`\n✗ PAGE WEIGHT CANNOT RUN — no Chromium found.\n\n` +
    `  It does not skip: a weight report over zero resources reads exactly like a light page.\n\n` +
    `     npx playwright install chromium\n     CHROMIUM_PATH=/path/to/chrome npm run pageweight\n`);
  process.exit(1);
}

process.env.RATE_LIMIT = 'off';
const app = await buildServer();
await app.listen({ port: 0, host: '127.0.0.1' });
const BASE = `http://127.0.0.1:${app.server.address().port}`;

// A phone, because that is where a megabyte is felt and where the PWA is aimed.
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// EVERY response, in order, tagged with the phase it belongs to. Deliberately a LOG rather than a
// url-keyed Map: the recurring half is a REFETCH of urls the first phase already saw, and a Map
// would silently drop exactly the thing it exists to measure (it did, on the first cut — the tick
// reported 0 requests and the non-vacuity guard below is what caught it).
const log = [];
let phase = 'landing';
const pending = [];
page.on('response', (res) => {
  const url = res.url();
  if (!url.startsWith(BASE)) return;
  const at = phase;
  pending.push((async () => {
  let bytes = 0, body = null;
  try { body = await res.body(); bytes = body.length; } catch { /* redirect / no body */ }
  log.push({
    phase: at,
    url: url.replace(BASE, '') || '/',
    bytes,
    encoding: (res.headers()['content-encoding'] || '').trim(),
    cache: (res.headers()['cache-control'] || '').trim(),
    type: (res.headers()['content-type'] || '').split(';')[0],
    status: res.status(),
    // what gzip WOULD give — the finding is the gap, so it has to be computed rather than guessed
    gz: body && bytes > 512 && /text|json|javascript|svg|xml/.test(res.headers()['content-type'] || '')
      ? zlib.gzipSync(body, { level: 6 }).length : bytes,
  });
  })());
});
const settle = async () => { await Promise.all(pending.splice(0)); };

const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
const cold = Date.now() - t0;

// the paint + parse numbers the document itself can report
const timings = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  return {
    dcl: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    fp: paints['first-paint'] ?? null,
    fcp: paints['first-contentful-paint'] ?? null,
  };
});

// ── phase 2: what a PLAYER pays, which is a different page from what a visitor pays ──
// A visitor gets the landing; a player gets the game screen, its own screen plates and its board
// fetches. Both are cold loads and only one of them is what the game costs to PLAY, so they are
// measured apart rather than averaged into one number that describes neither.
await settle();
phase = 'enter';
await page.click('#btn-guest');
await page.waitForSelector('#screen-create:not(.hidden)', { timeout: 15000 });
await page.fill('#new-name', 'Weigh ' + Math.random().toString(36).slice(2, 8));
await page.click('#btn-create');
await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });
if (await page.locator('#welcome:not(.hidden)').count()) { await page.click('#tour-skip'); await page.waitForTimeout(400); }
await page.waitForTimeout(2500);
await settle();

// ── phase 3: the recurring half — one board tick, through the client's OWN refresh path ──
// (the visibility-return handler is what production runs; a test-only hook would measure a path
// no player ever takes.) A tick that measured zero requests would read exactly like a free tick,
// so the count is asserted below rather than merely printed.
phase = 'tick';
// hidden→visible, because the handler only refreshes on the way BACK: `if (!document.hidden && me)`.
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(3000);
await settle();

// ── the WIRE sizes ──
// res.body() hands back the DECODED bytes, so once compression is on it stops describing what
// crossed the wire — and a report that keeps calling it "served" understates the fix and overstates
// the cost. The browser's own resource timing knows both: encodedBodySize is what arrived.
const wire = await page.evaluate(() => {
  const out = {};
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) out[nav.name] = nav.encodedBodySize;
  for (const r of performance.getEntriesByType('resource')) {
    if (r.encodedBodySize) out[r.name] = r.encodedBodySize;   // last one wins: a refetch is the live cost
  }
  return out;
});
for (const r of log) {
  const w = wire[BASE + (r.url === '/' ? '/' : r.url)];
  r.wire = typeof w === 'number' && w > 0 ? w : r.bytes;   // no timing entry → the decoded size, stated below
  r.timed = typeof w === 'number' && w > 0;
}

// ── the report ──
const rows = log.filter((r) => r.phase === 'landing').sort((a, b) => b.wire - a.wire);
const playerRows = log.filter((r) => r.phase === 'enter').sort((a, b) => b.wire - a.wire);
const tickRows = log.filter((r) => r.phase === 'tick').sort((a, b) => b.wire - a.wire);

console.log(`\n  PAGE WEIGHT — a cold load of / at 375x667 (bytes exact; ms are a localhost floor)\n`);
console.log(`  ${'on the wire'.padStart(11)} ${'decoded'.padStart(9)}  enc   cache-control          resource`);
for (const r of rows.slice(0, 24)) {
  const enc = r.encoding || '—';
  const gap = r.encoding ? '' : (r.gz < r.bytes * 0.9 ? ' ←' : '');
  console.log(`  ${String(r.wire).padStart(11)} ${String(r.bytes).padStart(9)}  ${enc.padEnd(5)} ${(r.cache || '—').slice(0, 22).padEnd(22)} ${r.url.slice(0, 44)}${gap}`);
}
if (rows.length > 24) console.log(`  … and ${rows.length - 24} smaller`);

const total = rows.reduce((s, r) => s + r.wire, 0);
const ideal = rows.reduce((s, r) => s + (r.encoding ? r.wire : r.gz), 0);
const uncompressed = rows.filter((r) => !r.encoding && r.gz < r.bytes * 0.9);
const gap = uncompressed.reduce((s, r) => s + (r.bytes - r.gz), 0);
const nocache = rows.filter((r) => !r.cache && r.status === 200);

const untimed = rows.filter((r) => !r.timed).length;
console.log(`\n  ${rows.length} responses, ${(total / 1024).toFixed(0)} KB ON THE WIRE — ${(ideal / 1024).toFixed(0)} KB if everything`);
console.log(`  compressible were compressed. THE GAP IS ${(gap / 1024).toFixed(0)} KB across ${uncompressed.length} response(s),`);
console.log(`  paid by every player on every cold load.`);
if (uncompressed.length) {
  console.log(`\n  shipped uncompressed and compressible:`);
  for (const r of uncompressed.sort((a, b) => (b.bytes - b.gz) - (a.bytes - a.gz)).slice(0, 8)) {
    console.log(`    ${String(r.bytes).padStart(8)} → ${String(r.gz).padStart(7)}  (${Math.round(r.gz * 100 / r.bytes)}%)  ${r.url}`);
  }
}
if (untimed) console.log(`  (${untimed} response(s) had no timing entry and are counted at their decoded size — an over-count, never under.)`);
if (nocache.length) console.log(`\n  ${nocache.length} response(s) carry no cache-control — refetched on every load:\n    ${nocache.slice(0, 6).map((r) => r.url).join('\n    ')}`);

console.log(`\n  timings (localhost — a FLOOR, not a phone on a network):`);
console.log(`    first paint ${timings.fp ?? '?'} ms · first contentful ${timings.fcp ?? '?'} ms · DOMContentLoaded ${timings.dcl} ms · load ${timings.load} ms · settle ${cold} ms`);

// the ENTER cost: what signing in and reaching the first screen pulls down, over the landing
const enterBytes = playerRows.reduce((s2, r) => s2 + r.wire, 0);
const enterIdeal = playerRows.reduce((s2, r) => s2 + (r.encoding ? r.wire : r.gz), 0);
console.log(`\n  ENTERING THE GAME — ${playerRows.length} further response(s), ${(enterBytes / 1024).toFixed(0)} KB` +
  (enterIdeal < enterBytes ? ` (${(enterIdeal / 1024).toFixed(0)} KB compressed)` : '') + `:`);
for (const r of playerRows.slice(0, 8)) {
  console.log(`    ${String(r.wire).padStart(8)} on the wire  ${r.encoding ? '[' + r.encoding + '] ' : ''}${r.url.slice(0, 48)}`);
}

const tickBytes = tickRows.reduce((s, r) => s + r.wire, 0);
const tickDecoded = tickRows.reduce((s, r) => s + r.bytes, 0);
console.log(`\n  THE RECURRING HALF — one board tick: ${tickRows.length} request(s), ${(tickBytes / 1024).toFixed(1)} KB` +
  (tickDecoded > tickBytes ? ` on the wire (${(tickDecoded / 1024).toFixed(1)} KB decoded)` : ''));
console.log(`  Paid every window by every player, forever — so a kilobyte here outweighs a kilobyte`);
console.log(`  in the document, which is paid once.`);
// a tick that fetched nothing is a BROKEN MEASUREMENT, not a free tick, and the two read the same
// on the summary line — so it fails loudly rather than reporting 0.0 KB.
if (!tickRows.length) {
  console.error(`\n✗ the board tick fetched NOTHING — the refresh path did not run, so the recurring`);
  console.error(`  half measured nothing. A zero here reads exactly like a free tick; it is not one.`);
  await browser.close(); await app.close(); process.exit(1);
}

console.log(`\n✅ pageweight — what the player downloads. A measurement, not a gate.`);
await browser.close();
await app.close();
process.exit(0);
