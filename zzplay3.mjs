import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8099';
const errs = [], bad = [];
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1100 } });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('response', async (r) => { if (r.status() >= 400) { let t=''; try{t=(await r.text()).slice(0,160);}catch{} bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')} :: ${t}`); } });

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.click('text=ENTER AS A GHOST');
await p.waitForTimeout(2000);
await p.fill('input[placeholder="street name"]', 'Sal Marchetti');
await p.click('button:has-text("STEP OUT")');
await p.waitForTimeout(3500);
await p.screenshot({ path: '/tmp/play/03-first-screen.png' });

console.log('=== THE VERY FIRST SCREEN A NEW PLAYER SEES ===');
console.log((await p.locator('body').innerText()).slice(0, 2500));
console.log('\n### modals open? ###');
const modals = await p.locator('.modal-bg:not(.hidden)').count();
console.log('open modal count:', modals);
if (modals) {
  console.log('MODAL TEXT:', (await p.locator('.modal-bg:not(.hidden)').first().innerText()).slice(0,900));
}
console.log('\nERRORS:', errs.length ? errs.join('\n') : 'none');
console.log('HTTP>=400:', bad.length ? bad.join('\n') : 'none');
await ctx.storageState({ path: '/tmp/play/state.json' });
await b.close();
