import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8099';
const errs = [], bad = [];
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1100 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('response', async (r) => { if (r.status() >= 400) { let t=''; try{t=(await r.text()).slice(0,120);}catch{} bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')}`); } });

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.click('text=ENTER AS A GHOST');
await p.waitForTimeout(2000);
// deliberately claim a name that already exists — what does the player see?
await p.fill('input[placeholder="street name"]', 'Sal Marchetti');
await p.click('button:has-text("STEP OUT")');
await p.waitForTimeout(2500);
console.log('=== A TAKEN NAME: what the player is told ===');
console.log('still on create screen?', await p.locator('input[placeholder="street name"]').count() > 0);
const body = (await p.locator('body').innerText());
console.log('screen text:', body.replace(/\s+/g,' ').slice(0, 400));
const toast = await p.locator('#toast, .toast').allInnerTexts().catch(()=>[]);
console.log('toast:', JSON.stringify(toast));
await p.screenshot({ path: '/tmp/play/05-name-taken.png' });
console.log('\nPAGEERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
