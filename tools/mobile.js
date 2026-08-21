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
const MOD_KEY = process.env.MOD_KEY || 'mobile-harness-mod-key';
process.env.MOD_KEY = MOD_KEY;   // check F opens /admin, which is mod-key gated client-side
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

  const walked = [];   // check G: what the screen-reach beacon should have recorded

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
      walked.push(id);
      await page.evaluate(() => window.scrollTo(0, 0));   // judge the fold from the top, as a player arrives
      await check(page, id, vp, { contentMustShow: true });
    }
  }

  // the overlays, which get their own stacking and their own chance to overflow
  await page.click('#btn-help'); await check(page, 'glossary', vp);
  await page.click('#glossary-close'); await page.waitForTimeout(200);
  await page.click('#btn-phone'); await check(page, 'cellphone', vp);

  // ── G — THE SCREEN-REACH BEACON ACTUALLY SENDS ────────────────────────────────────────────────
  // Not layout, and it earns its place here anyway: this is the only harness with a real browser
  // walking real screens as a logged-in player, which is exactly what the beacon measures. It
  // shipped with its auth guard reading `session?.token` — `session` is the /v1/session PROBE body
  // and has never carried a token — so every batch was dropped and reach measured NOTHING, while
  // the route, the funnel and the /admin panel all tested green. Optional chaining made it silent,
  // and an analytics number that is quietly always zero is worse than no number, because a founder
  // reads it as "nobody opens the Kitchen" and restructures a nav on it.
  //
  // Uses the client's OWN flush path (the tab going to the background), so it proves the wiring a
  // player actually exercises rather than a hand-rolled fetch.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1200);
  const reach = await page.evaluate(async (k) => {
    const r = await fetch('/v1/mod/funnel', { headers: { 'x-mod-key': k } });
    return (await r.json())?.screens || null;
  }, MOD_KEY);
  if (!reach || !reach.reporters) {
    fail('(screen reach)', vp, `the beacon recorded nothing after walking ${walked.length} screens `
      + `— ${JSON.stringify(reach)} (a silent analytics zero reads as "nobody goes there")`);
  } else {
    const missed = walked.filter((id) => !reach.opens?.[id]);
    if (missed.length) fail('(screen reach)', vp, `${missed.length} walked screen(s) were never reported: ${missed.join(', ')}`);
  }
  screensChecked++;

  // ── I — THE SHEET'S CHROME BUTTONS STATE THEIR TERMS ──────────────────────────────────────────
  // `heal` and `check in` sit in the always-visible row beside the money figure and said only their
  // own names: a price with the purchase left off, and a ladder invisible until after the money
  // landed. test/client.js proves the two figures are READ; only a browser can prove they are
  // RENDERED, which is why the assertion lives here. Crossed against what /v1/me really sends —
  // a literal would pass while the sheet and the till drifted.
  const terms = await page.evaluate(async () => {
    const r = await fetch('/v1/me', { headers: { authorization: 'Bearer ' + localStorage.omerta_token } });
    const me = (await r.json())?.character || {};
    return { text: document.querySelector('#sheet-terms')?.textContent || '', ci: me.checkin, heal: me.healCost,
      ciDisabled: !!document.querySelector('[data-do="POST /v1/checkin"]')?.disabled };
  });
  const nf = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (!terms.ci || terms.ci.done) {
    fail('(sheet terms)', vp, `this check is vacuous unless the walk reaches the sheet BEFORE the press — `
      + `that is the state the terms exist for. Got: ${JSON.stringify(terms.ci)}`);
  } else if (!terms.text.includes(nf(terms.ci.pay))) {
    fail('(sheet terms)', vp, `the button must name what today pays (${terms.ci.pay}) BEFORE the press. `
      + `Got: ${JSON.stringify(terms.text)}`);
  }
  // and the honest half: at full health there is no bill, so the line must not invent one — a
  // fabricated "$0" is a wrong number where a silence is the truth
  if (!terms.heal && /Doc wants/i.test(terms.text))
    fail('(sheet terms)', vp, `nothing to patch up, yet the line quotes a bill: ${JSON.stringify(terms.text)}`);
  if (terms.heal && !terms.text.includes(nf(terms.heal)))
    fail('(sheet terms)', vp, `the Doc's bill is ${terms.heal} and the line does not name it: ${JSON.stringify(terms.text)}`);
  // …and the OTHER state, which is the one a player sees for the rest of the day: press it for real,
  // then the line must say today is claimed, still carry the come-back-tomorrow figure, and the
  // button must go dead rather than stay live and refuse on press.
  // pressed the way a player presses it — the real act() path, so the re-render is the real one too.
  // The layout walk above leaves the cellphone open, and its card intercepts the click.
  await page.click('#phone-close'); await page.waitForTimeout(200);
  await page.click('[data-do="POST /v1/checkin"]');
  await page.waitForTimeout(2000);
  const after = await page.evaluate(async () => {
    const h = { authorization: 'Bearer ' + localStorage.omerta_token };
    const me = (await (await fetch('/v1/me', { headers: h })).json())?.character || {};
    return { text: document.querySelector('#sheet-terms')?.textContent || '', ci: me.checkin,
      disabled: !!document.querySelector('[data-do="POST /v1/checkin"]')?.disabled };
  });
  if (!after.ci?.done) fail('(sheet terms)', vp, `the press did not land, so the claimed state is untested: ${JSON.stringify(after.ci)}`);
  else {
    if (!/checked in/i.test(after.text) || (after.ci.next && !after.text.includes(nf(after.ci.next))))
      fail('(sheet terms)', vp, `today is claimed, so the line must say so and still name what tomorrow `
        + `pays (${after.ci.next}). Got: ${JSON.stringify(after.text)}`);
    if (!after.disabled) fail('(sheet terms)', vp, 'the check-in button must go dead once today is claimed '
      + '— a control that stays live and refuses on press is the game withholding its own rule');
  }
  screensChecked++;

  if (pageErrors.length) fail('(any screen)', vp, `${pageErrors.length} page error(s): ${pageErrors.slice(0, 3).join(' | ')}`);
  console.log(`   ${screensChecked} screens checked so far, ${failures.length} failure(s)`);
  await browser.close();
}

// ── E — THE RESTART WINDOW: the app must survive a server it cannot reach ───────────────────────
// Reported from production on a phone: mid-deploy, `boot()` treated the failed /v1/me error
// envelope as the character, so the sheet rendered `undefined · gen undefined` / `$NaN`, threw on
// `me.eff.muscle`, and the throw escaped boot() — buildTabs()/connectWs() never ran, leaving NO tab
// rail and NO bottom nav with nothing on screen saying why. Every deploy did this to whoever was
// loading. Deterministic by construction (a click, never the auto-retry timer): with /v1/me failing
// the player must get the honest screen and NO page error; with the server back, navigation returns.
{
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true,
    hasTouch: true, locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  const vp = { w: 375, h: 667 };

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.click('#btn-guest');
  await page.waitForSelector('#screen-create:not(.hidden)', { timeout: 20000 });
  await page.fill('#new-name', 'Restart Probe');
  await page.click('#btn-create');
  await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });

  await page.route('**/v1/me', (r) => r.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: 'db_down', message: 'unreachable' }) }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const down = await page.evaluate(() => ({
    shown: !document.querySelector('#screen-down').classList.contains('hidden'),
    main: !document.querySelector('#screen-main').classList.contains('hidden'),
    corpse: /undefined|NaN/.test(document.querySelector('#whoami')?.textContent || ''),
  }));
  if (!down.shown || down.main) {
    fail('(server unreachable)', vp, 'a player whose /v1/me fails is not told — expected the '
      + `unreachable screen, got ${JSON.stringify(down)}`);
  }
  if (down.corpse) fail('(server unreachable)', vp, 'the sheet rendered a CORPSE (undefined/NaN) instead of an honest screen');
  if (errs.length) fail('(server unreachable)', vp, `${errs.length} page error(s): ${errs.slice(0, 2).join(' | ')}`);
  screensChecked++;

  // …and the way back: with the box up again, the retry restores a usable app (tab rail + thumb bar).
  // Only reachable if the screen appeared at all — otherwise the click below times out and the harness
  // DIES on a follow-on step instead of reporting the finding it already has, which is the difference
  // between "the run named your bug" and "the run blew up" at 2am.
  await page.unroute('**/v1/me');
  if (down.shown) {
    await page.click('#btn-down-retry');
    await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });
    await page.waitForTimeout(600);
    const back = await page.evaluate(() => ({
      tabs: document.querySelectorAll('#tabs [data-tab]').length,
      bnav: document.querySelectorAll('#bnav button').length,
    }));
    if (back.tabs < 5 || back.bnav < 3)
      fail('(server recovered)', vp, `the app did not come back usable after the retry — ${JSON.stringify(back)}`);
    screensChecked++;
  }
  console.log(`   restart-window check done, ${failures.length} failure(s)`);
  await browser.close();
}

// ── F — /admin RENDERS AT ALL ───────────────────────────────────────────────────────────────────
// The founder's incident screen had NO harness at all, and on 2026-08-03 a probe found the whole
// chain panel had been dark for three days: renderChain() referenced `tre`, a local of its CALLER,
// so it threw ReferenceError on every refresh and the withdrawal reserve, extraction-≤-inflow, the
// staking pool, the Store split, the vault's allocated-≤-held wall and the oracle keeper watchdog
// all rendered as nothing. Valid syntax, so `node --check` cannot see it; a static pass cannot
// either; and a panel that renders nothing looks exactly like a quiet night — which is the worst
// thing to show someone at 2am, the same argument the dashboard's own db-down banner makes.
//
// So: load it the way a founder does, with a key, and require it to draw its panels and throw
// nothing. Deliberately NOT a layout check (this is a desktop screen, and nobody triages an
// outage on a phone) — just "does it come up, and does it come up whole".
{
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  const vp = { w: 1280, h: 900 };

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((k) => sessionStorage.setItem('omerta_mod_key', k), MOD_KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);   // one refreshAll() round trip

  // The signal is "did the renderer RUN", not "is there data" — a genuinely quiet night is a real
  // answer and a check that calls it a defect gets deleted. Every panel ships holding the boot
  // placeholder `…`; a renderer that ran overwrites it (renderActivity writes "quiet on the wire…"
  // for an empty feed), and a renderer that THREW leaves the placeholder exactly where it was.
  const panels = await page.evaluate(() => [...document.querySelectorAll('.panel')].map((p) => ({
    id: p.id, body: (p.querySelector('.body')?.textContent || '').trim(),
  })));
  const stuck = panels.filter((p) => p.body === '' || p.body === '…');
  if (!panels.length) fail('/admin', vp, 'the dashboard drew no panels at all — did the mod key take?');
  if (stuck.length) {
    fail('/admin', vp, `${stuck.length} panel(s) never rendered — ${stuck.map((p) => p.id).join(', ')}`
      + ' (still holding the boot placeholder, which is what a renderer that threw leaves behind —'
      + ' and a blank panel reads exactly like a quiet night)');
  }
  if (errs.length) fail('/admin', vp, `${errs.length} page error(s): ${errs.slice(0, 3).join(' | ')}`);
  screensChecked++;
  console.log(`   /admin check done (${panels.length} panels), ${failures.length} failure(s)`);
  await browser.close();
}

// ── H — A COOLDOWN REACHING ZERO FLIPS THE CONTROL, NOT JUST THE TEXT ───────────────────────────
// The 1s ticker repaints countdown TEXT, but whether the button beside it is disabled (or drawn at
// all) was decided by the render that drew it. Decoupling the board poll from the sheet poll made
// that gap up to BOARD_EVERY ticks wide, so the clock would read READY next to a dead button — a
// control that lies, and the exact class the wiring guard's checks 5/6 exist for, arriving through
// TIME rather than through a missing field. So the crossing re-renders the open screen.
//
// The signal has to DISCRIMINATE: a live page always has some background traffic, so "a request
// happened" passes with the fix removed (proven — that mutation survived the first cut of this
// probe). Compare the quiet window while the clock still counts against the window straddling zero.
{
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  const vp = { w: 375, h: 667 };
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.click('#btn-guest');
  await page.waitForSelector('#screen-create:not(.hidden)', { timeout: 20000 });
  await page.fill('#new-name', 'Cooldown Probe');
  await page.click('#btn-create');
  await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });
  await page.evaluate(() => {
    localStorage.setItem('omerta_tour2', '1'); localStorage.setItem('omerta_welcomed', '1');
    document.querySelectorAll('.modal-bg:not(.hidden)').forEach((m) => m.classList.add('hidden'));
  });
  await page.waitForTimeout(3000);   // let the landing fan-out settle, so the baseline is really quiet
  // THE CROSSING HAPPENS UP TO A FULL TICK BEFORE NOMINAL EXPIRY, and the window has to allow for
  // it. The ticker reads `Math.floor((until - now) / 1000)`, so the moment fewer than 1000ms remain
  // it floors to 0, paints READY and fires the re-render — correct for a seconds-resolution clock
  // (it must not sit on "0s" for a second), but it means the crossing lands in [expiry-TICK, expiry),
  // never at expiry. This measured `[expiry, expiry+2500)` and so looked PAST the re-render.
  //
  // It passed anyway until the screens were folded into one read, and the reason is worth keeping:
  // Home used to fan out to ~19 requests, whose tail ran long enough to spill past expiry into the
  // window by accident. Cutting the fan-out to 4 made the burst finish before the window even
  // opened, and the check went red on an IMPROVEMENT — it had been passing on the DURATION of a
  // request burst rather than on the thing it claims to measure. (Measured, not reasoned: the
  // re-render's `/v1/home` went out 310ms before expiry and the whole burst was done 95ms later.)
  //
  // CROSSED, not copied. The period below is the client's own, and a restatement of a value that
  // lives somewhere else is the class this project keeps a ledger for — so it is READ out of the
  // client rather than written down here, and a client that changes its period moves this window
  // with it instead of silently drifting out from under it.
  const readTick = await page.evaluate(() => {
    const m = String(document.documentElement.innerHTML).match(/setInterval\(\s*tickCooldowns\s*,\s*(\d+)\s*\)/);
    return m ? Number(m[1]) : null;
  });
  // A failure to read it is reported ONCE, here, and the run continues on the value it would have
  // had — otherwise the window below is built from `undefined`, the check fails a SECOND time, and
  // the message a human reads blames the client for a broken probe.
  if (!readTick) fail('(cooldown)', vp, "could not read the client's cooldown ticker period (setInterval(tickCooldowns, N)) "
    + "— this probe's window is derived from it, so it is measuring against a guess");
  const TICK_MS = readTick || 1000;
  const cd = await page.evaluate((TICK) => new Promise((done) => {
    const hits = [];
    const of = window.fetch;
    window.fetch = (...a) => { if (String(a[0]).includes('/v1/')) hits.push(Date.now()); return of(...a); };
    const t0 = Date.now(), expiry = t0 + 4000;
    const el = document.createElement('span');
    el.className = 'cdt'; el.dataset.until = String(expiry); el.dataset.ready = 'READY';
    (document.querySelector('#tabbodies') || document.body).appendChild(el);
    setTimeout(() => done({
      text: el.textContent, ready: el.classList.contains('cd-ready'),
      // the two windows ABUT at `expiry - TICK`: before it the clock genuinely still counts, from it
      // the crossing can fire. No overlap, so a single re-render can never be counted in both.
      quiet: hits.filter((h) => h >= t0 + 500 && h < expiry - TICK).length,
      crossing: hits.filter((h) => h >= expiry - TICK && h < expiry + 2500).length,
    }), 7000);
  }), TICK_MS);
  if (!cd.ready || cd.text !== 'READY') fail('(cooldown)', vp, `a countdown never reached READY (read ${JSON.stringify(cd.text)})`);
  else if (cd.crossing <= cd.quiet) {
    fail('(cooldown)', vp, `a countdown hit zero and re-rendered nothing — ${cd.crossing} requests in the `
      + `crossing window against a quiet baseline of ${cd.quiet}. The clock reads READY beside a control `
      + `still disabled by the render that drew it, for up to BOARD_EVERY ticks.`);
  }
  if (errs.length) fail('(cooldown)', vp, `${errs.length} page error(s): ${errs.slice(0, 3).join(' | ')}`);
  screensChecked++;
  console.log(`   cooldown-freshness check done (quiet ${cd.quiet} → crossing ${cd.crossing}), ${failures.length} failure(s)`);
  await browser.close();
}

// ── I — A COLD LOAD IN LOCKUP LANDS IN THE PEN ──────────────────────────────────────────────────
// "Going to jail takes you to jail" is a founder-asked feature, and its own comment claimed to cover
// "a page that LOADS jailed". It did not, and three things had to be true at once for it to fail:
// renderSheet() runs BEFORE buildTabs(), so the latch's setTab('pen') fired when #tab-pen did not
// exist — renderPen() threw on the null panel (an ASYNC throw, so boot()'s try/catch never saw it) —
// and the latch was spent on the way past, so it never fired again for that sentence. Even had it
// worked, buildTabs()'s own setTab('streets') and the login hook's async setTab('start') would each
// have overridden it. Played it: a cold load in a cell gave a page error, an EMPTY Pen panel, and
// the player left on Home for the whole stretch.
//
// Only a browser can see this — it is an ordering bug between three boot steps, and every one of its
// symptoms is a DOM fact. The jail is set through app.pool directly rather than by playing until a
// bust lands, because a probe whose precondition is a dice roll is the recorded flake shape.
{
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  const vp = { w: 375, h: 667 };
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.click('#btn-guest');
  await page.waitForSelector('#screen-create:not(.hidden)', { timeout: 20000 });
  await page.fill('#new-name', 'Lockup Probe');
  await page.click('#btn-create');
  await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });
  await page.evaluate(() => {
    localStorage.setItem('omerta_tour2', '1'); localStorage.setItem('omerta_welcomed', '1');
    localStorage.setItem('omerta_alltabs', '1');
  });
  const r = await app.pool.query(
    "UPDATE characters SET jail_until = now() + interval '25 minutes' WHERE name = $1 AND alive RETURNING id", ['Lockup Probe']);
  if (!r.rowCount) fail('(lockup)', vp, 'the probe could not put its own character in a cell — the seed moved, so this check proves nothing');
  else {
    errs.length = 0;                       // only the COLD LOAD's errors are this check's business
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });
    await page.waitForTimeout(3500);
    const o = await page.evaluate(() => ({
      lit: document.querySelector('#tabs button.on')?.dataset.tab || null,
      penText: (document.querySelector('#tab-pen')?.innerText || '').trim(),
    }));
    if (o.lit !== 'pen')
      fail('(lockup)', vp, `a cold load in a cell landed on ${JSON.stringify(o.lit)}, not the Pen — `
        + 'the jail jump fires before the panels exist and is then overridden by the landing, and the '
        + 'latch is spent, so the player never gets taken to their cell at all');
    if (!/INSIDE/i.test(o.penText))
      fail('(lockup)', vp, `the Pen panel rendered nothing for a jailed player (read ${JSON.stringify(o.penText.slice(0, 60))}) — `
        + 'renderPen() writes innerHTML on a panel captured before buildTabs() created it');
    if (errs.length) fail('(lockup)', vp, `${errs.length} page error(s) on a cold load in a cell: ${errs.slice(0, 3).join(' | ')}`);
    screensChecked++;
    console.log(`   lockup cold-load check done (landed on ${o.lit}), ${failures.length} failure(s)`);
  }
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
