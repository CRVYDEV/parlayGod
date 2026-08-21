import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8099';
const errs = [], bad = [], toasts = [];
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

// ---- WALK THE TOUR, reading every step ----
console.log('=== THE TOUR ===');
for (let i = 0; i < 12; i++) {
  const modal = p.locator('.modal-bg:not(.hidden)').first();
  if (!(await modal.count())) break;
  const txt = (await modal.innerText()).replace(/\s+/g, ' ').trim();
  if (!txt) break;
  console.log(`  [${i+1}] ${txt.slice(0, 260)}`);
  const next = modal.locator('button:has-text("next")');
  if (await next.count()) { await next.click(); await p.waitForTimeout(500); }
  else { const done = modal.locator('button').last(); await done.click(); await p.waitForTimeout(600); break; }
}
await p.waitForTimeout(1200);
// dismiss anything still open
for (let i=0;i<4;i++){ const m=p.locator('.modal-bg:not(.hidden)').first(); if(!(await m.count()))break; await m.locator('button').last().click({timeout:2000}).catch(()=>{}); await p.waitForTimeout(400); }
await p.screenshot({ path: '/tmp/play/04-tour-done.png' });

const coach = async () => { try { return (await p.locator('#coachwrap, .coachbox').first().innerText()).replace(/\s+/g,' ').trim().slice(0,220); } catch { return '(none)'; } };
console.log('\n=== COACH SAYS (fresh player) ===\n ', await coach());
console.log('\nERRORS:', errs.length ? errs.join('\n') : 'none');
console.log('HTTP>=400:', bad.length ? bad.join('\n') : 'none');
await ctx.storageState({ path: '/tmp/play/state.json' });
await b.close();
