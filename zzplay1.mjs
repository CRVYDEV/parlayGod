import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8099';
const errs = [], reqs = [];
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('response', async (r) => { if (r.status() >= 400) { let body=''; try{body=(await r.text()).slice(0,200);}catch{} reqs.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')} :: ${body}`); } });

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.screenshot({ path: '/tmp/play/01-landing.png', fullPage: false });
console.log('=== LANDING: visible text (first 900 chars) ===');
console.log((await p.locator('body').innerText()).slice(0, 900));

// find the entry control
const buttons = await p.locator('button:visible, a:visible').allInnerTexts();
console.log('\n=== LANDING controls ===');
console.log(buttons.filter(t=>t.trim()).slice(0,25).join(' | '));

await p.evaluate(() => { try { localStorage.clear(); } catch {} });
console.log('\nERRORS:', errs.length ? errs.join('\n') : 'none');
console.log('HTTP>=400:', reqs.length ? reqs.join('\n') : 'none');
await b.close();
