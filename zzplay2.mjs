import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8099';
const errs = [], bad = [];
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('response', async (r) => { if (r.status() >= 400) { let t=''; try{t=(await r.text()).slice(0,160);}catch{} bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')} :: ${t}`); } });
const shot = (n) => p.screenshot({ path: `/tmp/play/${n}.png` });

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.click('text=ENTER AS A GHOST');
await p.waitForTimeout(2500);
await shot('02-after-ghost');
console.log('=== AFTER "ENTER AS A GHOST" ===');
console.log((await p.locator('body').innerText()).slice(0, 1400));
console.log('\n--- inputs on screen ---');
for (const el of await p.locator('input:visible, select:visible, textarea:visible').all()) {
  console.log(' input:', await el.getAttribute('placeholder') || await el.getAttribute('id') || await el.getAttribute('name') || '(unnamed)');
}
console.log('--- buttons ---');
console.log((await p.locator('button:visible').allInnerTexts()).filter(t=>t.trim()).slice(0,20).join(' | '));
console.log('\nERRORS:', errs.length ? errs.join('\n') : 'none');
console.log('HTTP>=400:', bad.length ? bad.join('\n') : 'none');
await ctx.storageState({ path: '/tmp/play/state.json' });
await b.close();
