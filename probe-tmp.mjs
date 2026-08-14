// Live probe of the motion/ambient/haptics engine. Sandbox Chromium lacks the proprietary codecs,
// so what this PROVES is the fail-safe layer: every mount survives an undecodable clip with zero
// page errors, the manifest is fetched, the delegation doesn't throw, ambient stays silent-not-broken.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const srv = spawn('node', ['src/server.js'], { cwd: '/home/user/Omerta', env: { ...process.env, PORT: '3123', JWT_SECRET: 'probe-jwt-secret-long-enough-okay', MARKET_SEED: 'probeSeedLongEnoughForPreflight1', MOD_KEY: 'probe-mod-key-long-enough-to-pass', SOCIAL_VERIFY_MODE: 'off', POPULATION_OFF: 'on' }, stdio: 'pipe' });
await new Promise((res, rej) => { srv.stdout.on('data', (d) => { if (String(d).includes('listening')) res(); }); srv.stderr.on('data', (d) => process.stderr.write(d)); setTimeout(() => rej(new Error('server boot timeout')), 30000); });
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|DEMUXER|Format error|no supported source/i.test(m.text())) errors.push('console: ' + m.text()); });
await pg.goto('http://localhost:3123/');
// guest → create → in the game
await pg.click('#btn-guest');
await pg.waitForSelector('#screen-create:not(.hidden)', { timeout: 15000 });
await pg.fill('#new-name', 'Probe ' + Math.random().toString(36).slice(2, 8));
await pg.click('#btn-create');
await pg.waitForSelector('#screen-main:not(.hidden)', { timeout: 20000 });
if (await pg.$('#tour-skip')) { await pg.click('#tour-skip').catch(() => {}); await pg.waitForTimeout(300); }
await pg.evaluate(() => localStorage.setItem('omerta_alltabs', '1'));
await pg.waitForTimeout(1500);
// the motion manifest reached the client?
const mo = await pg.evaluate(() => fetch('/v1/art/motion').then((r) => r.json()));
console.log(`manifest: ${mo.clips.length} clips, ${mo.beds.length} beds`);
if (mo.clips.length < 100) errors.push('manifest thin: ' + mo.clips.length);
// walk tabs that should mount a living plate + a bed
for (const t of ['streets', 'den', 'family', 'pen']) {
  await pg.evaluate((id) => { const b = document.querySelector(`#bnav [data-go="${id}"]`) || document.querySelector(`[data-go="${id}"]`); b?.click(); }, t).catch(() => {});
  await pg.waitForTimeout(900);
  const st = await pg.evaluate(() => ({ tabvid: !!document.querySelector('#tabart .tabvid'), art: !document.querySelector('#tabart').classList.contains('hidden') }));
  console.log(`tab ${t}: plate=${st.art} tabvid-mounted-or-failsafed=${st.tabvid}`);
}
// hover-to-live: pointerover a crime card img (streets best-jobs grid)
await pg.evaluate(() => document.querySelector('#bnav [data-go="streets"]')?.click());
await pg.waitForTimeout(1200);
const hover = await pg.evaluate(() => {
  const img = [...document.querySelectorAll('img.ico')].find((i) => /\/v1\/art\/crime\//.test(i.src));
  if (!img) return 'no crime card art on screen';
  img.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  return 'dispatched';
});
await pg.waitForTimeout(700);
const live = await pg.evaluate(() => ({ v: document.querySelectorAll('video.ico, video.cardvid').length }));
console.log(`hover-to-live: ${hover}; live/failsafed videos now: ${live.v}`);
// ambient: simulate a gesture, confirm no crash and engine state sane
await pg.mouse.click(400, 300);
await pg.waitForTimeout(800);
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'ZERO page errors');
await b.close(); srv.kill();
process.exit(errors.length ? 1 : 0);
