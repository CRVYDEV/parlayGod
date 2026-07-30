#!/usr/bin/env node
// ── THE MOBILE HARNESS ──────────────────────────────────────────────────────────────────────────
// Boots the real server, drives a real browser at a real phone size through EVERY screen, and fails
// the build on the layout defects that a human only finds by looking.
//
//   npm run mobile
//
// WHY THIS EXISTS. On 2026-07-26 a driven-and-looked-at pass found that a brand-new player's
// "Start Here" screen — the guided onboarding — showed NONE of its own content above the fold on a
// 375x667 phone. The three-column grid stacks its LEFT column (the ~1000px character sheet) above
// the tab content, so every tab pushed its own content off-screen. Nothing caught it: the suite
// tests the API, not the layout, and the previous mobile work was a CSS breakpoint pass that was
// never opened on a phone. The same pass found a horizontal-overflow bug in the Collection tracker
// that had been live for months, and caught a regression introduced by its own first fix.
//
// So the checks here are exactly the classes that shipped undetected — nothing aspirational:
//
//   A. HORIZONTAL OVERFLOW. The page must never scroll sideways. Objective, zero judgement.
//   B. THE PICKED TAB IS VISIBLE. Selecting a screen must actually bring that screen into view.
//      This is the headline defect above, stated as an assertion.
//   C. PRIMARY NAVIGATION IS THUMB-SIZED. Deliberately scoped to the three nav rails, NOT to every
//      button on the page. A guard that nags about a 34px secondary control gets deleted, and a
//      deleted guard catches nothing (the same argument test/docs.js makes about line counts).
//   D. NO PAGE ERRORS. An unhandled rejection is how a button silently does nothing.
//
// WHAT IT DOES NOT CHECK, so nobody reads a green run as more than it is: whether a screen looks
// GOOD, contrast, font choice, whether copy makes sense, gesture handling, iOS/Android engine
// quirks (this is Chromium), or anything below the fold that is merely ugly rather than broken.
// Those still need a person opening it. This catches the classes that are mechanical.
//
// Runs on pg-mem in-process — no database, no network — so it belongs in the same CI job as the
// suite. Needs a Chromium binary; see resolveBrowser() for how one is found and what happens if
// there is not one (it fails loudly, never skips: a harness that measures nothing reads exactly
// like a harness that passes).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from '../src/server.js';

const VIEWPORTS = [
  { w: 375, h: 667, name: 'iPhone SE / 8 — the tightest common phone' },
  { w: 360, h: 780, name: 'small Android' },
];
const MIN_TAP = 36;          // px. Apple says 44pt for primary targets; 36 is the floor we enforce.
const SHOTS = process.env.MOBILE_SHOTS || '';   // set a directory to keep screenshots for eyeballing

// ── finding a browser ───────────────────────────────────────────────────────────────────────────
// playwright-core deliberately downloads nothing (a browser per `npm ci` is a heavy tax on a repo
// where most work never touches the client). So we resolve one from the environment, in order of
// how explicit it is, and say precisely what to do when there is none.
function resolveBrowser() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  // a Playwright-managed install (PLAYWRIGHT_BROWSERS_PATH, or the default cache). The directory
  // is versioned, and the version pinned by playwright-core often differs from what is installed,
  // so match by GLOB rather than asking playwright-core for its own expected path.
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, `${process.env.HOME || ''}/.cache/ms-playwright`].filter(Boolean);
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries.filter((x) => x.startsWith('chromium')).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
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
  console.error(`
✗ MOBILE HARNESS CANNOT RUN — no Chromium found.

  This harness does not skip. A layout guard that quietly does nothing is worse than no guard,
  because the build still goes green and everyone assumes the screens were checked.

  Fix it with either:
     npx playwright install chromium          (downloads one into the Playwright cache)
     CHROMIUM_PATH=/path/to/chrome npm run mobile
     apt-get install -y chromium              (any system Chromium is fine)
`);
  process.exit(1);
}

// ── the server ──────────────────────────────────────────────────────────────────────────────────
// A real socket, not app.inject(): a browser has to actually fetch the page and its API calls.
const app = await buildServer();
await app.listen({ port: 0, host: '127.0.0.1' });
const BASE = `http://127.0.0.1:${app.server.address().port}`;

const failures = [];
const fail = (screen, vp, msg) => failures.push(`[${vp.w}x${vp.h}] ${screen}: ${msg}`);
let screensChecked = 0;

// Everything measured in one pass in the page, so a screen is only laid out once.
const MEASURE = (minTap) => {
  const de = document.documentElement;
  const vw = de.clientWidth, vh = window.innerHeight;
  const over = de.scrollWidth - vw;

  // who is pushing past the right edge — named so a failure is actionable, not just a number
  const widest = [];
  if (over > 1) {
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 8) {
        widest.push({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''),
          right: Math.round(r.right), w: Math.round(r.width),
          text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 46) });
      }
    }
    widest.sort((a, b) => b.right - a.right);
  }

  // PRIMARY navigation only: the group rail, the screen tabs, the thumb bar. Not every control.
  const smallNav = [];
  for (const el of document.querySelectorAll('#grouprail button, #tabs button, #bnav button')) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) continue;              // hidden tabs of other groups
    if (r.height < minTap) smallNav.push({ h: Math.round(r.height),
      text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 22) });
  }

  // is the screen you picked actually on screen? measured from the tab-content container's top.
  const bodies = document.querySelector('#tabbodies');
  const bodyTop = bodies ? Math.round(bodies.getBoundingClientRect().top) : null;

  return { vw, vh, over, widest: widest.slice(0, 5), smallNav, bodyTop };
};

const check = async (page, screen, vp, { contentMustShow = false } = {}) => {
  await page.waitForTimeout(260);
  screensChecked++;
  const m = await page.evaluate(MEASURE, MIN_TAP);   // passed in — MEASURE runs in the page, so a
                                                     // literal here would silently diverge from the
                                                     // constant the failure message quotes.
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${vp.w}-${screen}.png`) });
  }
  // A — the page must not scroll sideways
  if (m.over > 1) {
    fail(screen, vp, `scrolls sideways by ${m.over}px — widest: ` +
      m.widest.map((x) => `${x.sel} (right ${x.right}, w ${x.w})${x.text ? ` "${x.text}"` : ''}`).join('; '));
  }
  // C — the nav you steer with must be thumb-sized
  if (m.smallNav.length) {
    fail(screen, vp, `${m.smallNav.length} primary nav target(s) under ${MIN_TAP}px: ` +
      m.smallNav.map((s) => `"${s.text}" ${s.h}px`).join(', '));
  }
  // B — picking a screen must bring that screen into view
  if (contentMustShow && m.bodyTop !== null && m.bodyTop > m.vh) {
    fail(screen, vp, `the screen's own content starts ${m.bodyTop}px down, below the ${m.vh}px fold — ` +
      `a player who taps this tab sees none of it and nothing tells them to scroll`);
  }
  return m;
};

for (const vp of VIEWPORTS) {
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    // PINNED. The console auto-detects the browser locale and switches language pack, so an
    // unpinned locale would change every label on the page — and with it what this harness sees.
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const pageErrors = [];
  ctx.on('weberror', (e) => pageErrors.push(e.error().message));
  const page = await ctx.newPage();
  // A 4xx from the API is normal here (/v1/me before a character exists); a JS error is not.
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) pageErrors.push(m.text()); });

  console.log(`\n── ${vp.w}x${vp.h}  (${vp.name})`);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await check(page, 'landing', vp);

  await page.click('#btn-guest');
  await page.waitForSelector('#screen-create:not(.hidden)', { timeout: 15000 });
  await check(page, 'create', vp);

  // a fresh name per run: living-name uniqueness is enforced, and this harness may run repeatedly
  await page.fill('#new-name', 'Probe ' + Math.random().toString(36).slice(2, 8));
  await page.click('#btn-create');
  await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });
  // the first-session TOUR (the illustrated multi-step welcome) — check ITS layout on the first
  // step, then skip out; a layout guard that dismissed it blind would leave the game's very first
  // screen unchecked, which is the headline-defect class this harness exists for
  if (await page.locator('#welcome:not(.hidden)').count()) {
    await check(page, 'the tour (step 1)', vp);
    await page.click('#tour-skip'); await page.waitForTimeout(300);
  }

  // THE NEW PLAYER'S FIRST SCREEN. Checked before anything is unlocked, because this is the exact
  // state the headline defect lived in and the one every single player passes through.
  await check(page, 'start-here (fresh player)', vp, { contentMustShow: true });

  // open the whole city and walk every screen in every group
  if (await page.locator('#tabs-more:not(.hidden)').count()) await page.click('#tabs-more');
  await page.waitForTimeout(400);
  // Selected by the data-group ID, never by the button's TEXT: the labels come from the i18n
  // dictionary, and `:has-text()` is a SUBSTRING match, so text matching is wrong twice over.
  const groups = await page.locator('#grouprail [data-group]').evaluateAll(
    (els) => els.map((e) => e.dataset.group));
  if (!groups.length) fail('(nav)', vp, 'no group rail buttons found — the walk below covers nothing');
  for (const g of groups) {
    await page.click(`#grouprail [data-group="${g}"]`);
    await page.waitForTimeout(200);
    const subs = await page.locator('#tabs [data-tab]:not(.hidden)').all();
    // A ONE-SCREEN group (profile, deck) shows no sub-row at all, so the loop below runs zero
    // times and the screen was NAVIGATED to but never CHECKED — walked-but-unchecked is exactly
    // the silent coverage hole this harness exists to prevent. Check the landing screen directly.
    if (!subs.length) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await check(page, g, vp, { contentMustShow: true });
    }
    for (const t of subs) {
      const id = await t.getAttribute('data-tab');
      await t.click();
      await page.evaluate(() => window.scrollTo(0, 0));   // judge the fold from the top, as a player arrives
      await check(page, id, vp, { contentMustShow: true });
    }
  }

  // the overlays, which get their own stacking and their own chance to overflow
  await page.click('#btn-help'); await check(page, 'glossary', vp);
  await page.click('#glossary-close'); await page.waitForTimeout(200);
  await page.click('#btn-phone'); await check(page, 'cellphone', vp);

  if (pageErrors.length) fail('(any screen)', vp, `${pageErrors.length} page error(s): ${pageErrors.slice(0, 3).join(' | ')}`);
  console.log(`   ${screensChecked} screens checked so far, ${failures.length} failure(s)`);
  await browser.close();
}

await app.close();

if (failures.length) {
  console.error(`\n✗ MOBILE HARNESS FAILED — ${failures.length} problem(s) across ${screensChecked} screen checks:\n`);
  for (const f of failures) console.error('   • ' + f);
  console.error(`\n   Re-run with MOBILE_SHOTS=/tmp/shots npm run mobile to keep screenshots and look at them.\n`);
  process.exit(1);
}
console.log(`\n✅ mobile harness passed — ${screensChecked} screen checks across ${VIEWPORTS.length} phone sizes: ` +
  `no screen scrolls sideways, every screen you pick opens above the fold, every primary nav target clears ` +
  `${MIN_TAP}px, and no page threw. (Layout only — whether a screen reads WELL still needs a person.)`);
