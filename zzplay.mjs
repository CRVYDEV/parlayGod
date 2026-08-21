import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8099';
const NAME = process.env.PNAME || ('Sal ' + Math.random().toString(36).slice(2, 7));
const errs = [], bad = [];
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1100 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('response', async (r) => { if (r.status() >= 400) { let t=''; try{t=(await r.text()).slice(0,140);}catch{}
  bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')} :: ${t}`); } });
const say = console.log;
const clean = (s) => (s||'').replace(/\s+/g,' ').trim();
const toast = async () => clean(await p.locator('#toast').innerText().catch(()=>'')).slice(0,200);
const coach = async () => clean(await p.locator('#coachwrap').first().innerText().catch(()=>'')).slice(0,300);
const sheet = async () => { const t = clean(await p.locator('#sheet').innerText().catch(()=>''));
  return (t.match(/lvl\s*\d+/i)||['lvl ?'])[0] + ' · ' + ((t.match(/\$[\d,]+/)||[''])[0]); };
const dismiss = async () => { for(let i=0;i<6;i++){ const m=p.locator('.modal-bg:not(.hidden)').first();
  if(!(await m.count()))return; await m.locator('button').last().click({timeout:1500}).catch(()=>{}); await p.waitForTimeout(250);} };
const nav = async (tab) => {
  await dismiss();
  if (await p.locator('#tabs-more:not(.hidden)').count()) await p.click('#tabs-more').catch(()=>{});
  const t = p.locator(`#tabs [data-tab="${tab}"]`);
  if (!(await t.count())) { // open the group that holds it
    for (const g of await p.locator('#grouprail [data-group]').evaluateAll(els=>els.map(e=>e.dataset.group))) {
      await p.click(`#grouprail [data-group="${g}"]`).catch(()=>{}); await p.waitForTimeout(250);
      if (await p.locator(`#tabs [data-tab="${tab}"]:not(.hidden)`).count()) break;
    }
  }
  await p.click(`#tabs [data-tab="${tab}"]`).catch(()=>{});
  await p.waitForTimeout(1100); await dismiss();
};

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.click('text=ENTER AS A GHOST'); await p.waitForTimeout(1800);
await p.fill('input[placeholder="street name"]', NAME);
await p.click('button:has-text("STEP OUT")'); await p.waitForTimeout(3500);
say(`PLAYING AS: ${NAME}`);
for (let i=0;i<12;i++){ const m=p.locator('.modal-bg:not(.hidden)').first(); if(!(await m.count()))break;
  const nx=m.locator('button:has-text("next")'); if(await nx.count()){await nx.click();await p.waitForTimeout(350);}
  else {await m.locator('button').last().click().catch(()=>{});await p.waitForTimeout(400);break;} }
await dismiss();
await p.evaluate(()=>localStorage.setItem('omerta_alltabs','1'));
await p.waitForTimeout(600);

say(`START: ${await sheet()}`);
say(`COACH: ${await coach()}\n`);

await nav('streets');
await p.screenshot({ path: '/tmp/play/06-streets.png' });
say('=== STREETS: what a level-1 player sees ===');
say(clean(await p.locator('#tab-streets').innerText().catch(()=>'')).slice(0, 1600));

say('\n=== PULLING JOBS ===');
let jobs=0, busts=0, last='';
for (let i=0;i<40;i++){
  const btn = p.locator('#tab-streets button:has-text("do it")').first();
  if (!(await btn.count())) { say('  (no "do it" button found)'); break; }
  try { await btn.click({timeout:3000}); } catch(e) { say('  click failed: '+e.message.slice(0,60)); break; }
  await p.waitForTimeout(620); await dismiss();
  const t = await toast(); if (t && t!==last) { jobs++; last=t; if(/BUSTED/i.test(t)) busts++;
    if (jobs<=8) say(`  ${jobs}. ${t.slice(0,120)}`); }
  if (/nerve/i.test(t)) { say(`  stopped: ${t.slice(0,90)}`); break; }
}
say(`  -> ${jobs} results, ${busts} busts · ${await sheet()}`);
say(`COACH NOW: ${await coach()}`);
await p.screenshot({ path: '/tmp/play/07-after-jobs.png' });

say('\nPAGEERRORS: ' + (errs.length? '\n'+errs.join('\n') : 'none'));
say('HTTP>=400 (unique): ' + ([...new Set(bad)].join('\n') || 'none'));
await ctx.storageState({ path: '/tmp/play/state.json' });
await b.close();
