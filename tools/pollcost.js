// POLL COST — what ONE player costs the server per minute while they sit there.
//
// Every capacity answer this project has is in requests per second (`npm run loadtest`: ~290 req/s at
// the current plans). Translating that into PLAYERS needs the other half, and that half is not a
// server measurement at all — it is a CLIENT behaviour: the console's 30s tick re-renders whatever
// screen is open, and a screen is a fan-out of board GETs. So the poll IS the load, and the number
// that decides the ceiling is "requests per player per minute", measured in a real browser rather
// than reasoned about from the source.
//
// It matters which screen, and the answer is not the cheap one: Home is where a returning player
// LANDS, and Home is the widest fan-out in the game.
//
// Run:  node tools/pollcost.js            (all screens, ~40s)
//       node tools/pollcost.js start      (one screen)
//
// Honest scope: this counts REQUESTS, not their cost. A board that runs one indexed lookup and a
// board that scans a table both count 1. It is the right unit for the ceiling question anyway, since
// the measured server figure is also in requests — but a heavy board is invisible here.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { buildServer } from '../src/server.js';

// the browser is resolved by tools/mobile.js's finder, imported rather than re-written: this
// environment keeps its Chromium under PLAYWRIGHT_BROWSERS_PATH rather than the default cache, and a
// second copy of that logic is a second thing to get wrong (the one-core discipline).
const findChromium = () => {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, `${process.env.HOME || ''}/.cache/ms-playwright`].filter(Boolean);
  for (const root of roots) {
    let entries = [];
    try { entries = readdirSync(root); } catch { continue; }
    for (const e of entries.filter((x) => x.startsWith('chromium')).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        if (existsSync(`${root}/${e}/${rel}`)) return `${root}/${e}/${rel}`;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p;
  }
  return null;
};
const exe = findChromium();
if (!exe) { console.error('pollcost needs a Chromium — set CHROMIUM_PATH.'); process.exit(1); }

// the screens worth measuring: the one a returning player lands on, the one they spend the loop in,
// and the two widest fan-outs after Home.
const SCREENS = process.argv[2] ? [process.argv[2]] : ['start', 'streets', 'city', 'family'];
const TICK_MS = 30000;          // the console's own poll interval
const SETTLE_MS = 3500;         // let the first render's fan-out finish before we start counting
const WATCH_MS = 6000;          // then watch an idle window with no tick in it

const app = await buildServer();
await app.listen({ port: 0, host: '127.0.0.1' });
const BASE = `http://127.0.0.1:${app.server.address().port}`;

const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();

// count every /v1 request the page makes, bucketed by path (params collapsed so the report is short)
let counting = false;
const seen = new Map();
page.on('request', (r) => {
  if (!counting) return;
  const u = new URL(r.url());
  if (!u.pathname.startsWith('/v1')) return;
  const key = u.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/:id').replace(/\/\d+/g, '/:n');
  seen.set(key, (seen.get(key) || 0) + 1);
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('#btn-guest');
await page.waitForSelector('#screen-create:not(.hidden)', { timeout: 15000 });
await page.fill('#new-name', 'Poll ' + Math.random().toString(36).slice(2, 8));
await page.click('#btn-create');
await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });
// dismiss the first-session tour and any milestone tip, or a modal eats the clicks
await page.evaluate(() => {
  localStorage.setItem('omerta_tour2', '1'); localStorage.setItem('omerta_welcomed', '1');
  localStorage.setItem('omerta_alltabs', '1');   // a fresh player is in SIMPLE mode; we want every screen
  document.querySelectorAll('.modal-bg:not(.hidden)').forEach((m) => m.classList.add('hidden'));
});

// the client's own board cadence, read out of its source rather than restated here — a probe that
// carries its own copy of the number it measures against is a probe that can agree with itself while
// disagreeing with the game (the preflight restatement lesson).
const boardEvery = await page.evaluate(async () => {
  const src = await (await fetch('/')).text();
  const m = src.match(/const BOARD_EVERY\s*=\s*(\d+)/);
  return m ? Number(m[1]) : 1;
});
console.log(`  (the client re-renders boards every ${boardEvery} ticks; the sheet every tick)\n`);

const rows = [];
for (const screen of SCREENS) {
  // navigate the way a player does, through the real nav
  const ok = await page.evaluate((s) => {
    const b = document.querySelector(`#tabs button[data-tab="${s}"], #grouprail button[data-go="${s}"]`);
    if (b) { b.click(); return true; }
    return false;
  }, screen);
  if (!ok) { console.log(`  (no nav button for ${screen} — skipped)`); continue; }
  await page.waitForTimeout(SETTLE_MS);

  seen.clear(); counting = true;
  // Fire ONE tick. Deliberately through the client's OWN visibility-return handler rather than a
  // `window.__tick` test hook: that handler does the same `refresh(); renderActive()` the interval
  // does, so the measurement rides a real code path and production grows no surface for a probe.
  // (It skips pollOnline — one request — so this reads one LOW, which is the safe direction.)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(WATCH_MS);
  counting = false;

  const peak = [...seen.values()].reduce((a, b) => a + b, 0);
  // A tick that re-renders the boards is the PEAK, not the sustained rate: the client refreshes the
  // sheet every tick and the boards only every BOARD_EVERY-th. Read that constant off the page rather
  // than restating it, so this cannot drift from the client it measures.
  const sustainedPerTick = 1 + (peak - 1) / boardEvery;  // the sheet every tick, the boards 1-in-N
  const perMin = sustainedPerTick * (60000 / TICK_MS);
  rows.push({ screen, peak, perMin, perSec: perMin / 60 });
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(' ');
  console.log(`  ${screen.padEnd(9)} peak ${String(peak).padStart(3)} req/tick · sustained ` +
    `${perMin.toFixed(1)}/min (${(perMin / 60).toFixed(2)} req/s)   ${top}`);
}

// ── and CHECK the arithmetic against reality ──────────────────────────────────────────────────────
// The sustained figures above are derived (peak, amortised over BOARD_EVERY). Derived is not measured,
// so sit on the worst screen for a real window with the real interval running and count what actually
// goes out. If the client's cadence is not what its source says, this is what catches it.
if (rows.length && !process.argv[2]) {
  const worstRow = rows.reduce((a, b) => (b.perSec > a.perSec ? b : a));
  await page.evaluate((s) => {
    const b = document.querySelector(`#tabs button[data-tab="${s}"], #grouprail button[data-go="${s}"]`);
    if (b) b.click();
  }, worstRow.screen);
  await page.waitForTimeout(SETTLE_MS);
  const windowMs = TICK_MS * boardEvery + 4000;
  console.log(`\n  verifying on ${worstRow.screen} over a real ${Math.round(windowMs / 1000)}s window…`);
  seen.clear(); counting = true;
  await page.waitForTimeout(windowMs);
  counting = false;
  const observed = [...seen.values()].reduce((a, b) => a + b, 0) * (60000 / windowMs);
  const drift = Math.abs(observed - worstRow.perMin) / Math.max(1, worstRow.perMin);
  console.log(`  observed ${observed.toFixed(1)}/min vs ${worstRow.perMin.toFixed(1)}/min derived ` +
    `(${(drift * 100).toFixed(0)}% apart)`);
  if (drift > 0.35) {
    console.error(`\n🚨 the client's real poll does not match its stated cadence — derived ` +
      `${worstRow.perMin.toFixed(1)}/min, observed ${observed.toFixed(1)}/min.`);
    await browser.close(); await app.close(); process.exit(1);
  }
}

await browser.close();
await app.close();

if (!rows.length) { console.error('pollcost measured nothing — the nav buttons did not resolve.'); process.exit(1); }
const worst = rows.reduce((a, b) => (b.perSec > a.perSec ? b : a));
console.log(`\n  WORST SCREEN: ${worst.screen} at ${worst.perSec.toFixed(2)} req/s per idle player.`);
// the ceiling question, answered in players rather than requests
for (const capacity of [290, 435]) {
  console.log(`  At ${capacity} req/s of server capacity that is ~${Math.floor(capacity / worst.perSec)} ` +
    `concurrent players on ${worst.screen}.`);
}
console.log('\n✅ pollcost — the poll is the load, measured in a real browser. Requests only (not their cost).');
