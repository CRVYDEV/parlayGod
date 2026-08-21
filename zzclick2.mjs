import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
p.on('pageerror', e=>console.log('PAGEERROR:', e.message));
await p.goto('http://127.0.0.1:8099', { waitUntil:'networkidle' });
await p.click('text=ENTER AS A GHOST'); await p.waitForTimeout(1800);
await p.fill('input[placeholder="street name"]', 'Sal '+Math.random().toString(36).slice(2,7));
await p.click('button:has-text("STEP OUT")'); await p.waitForTimeout(3500);
for(let i=0;i<12;i++){const m=p.locator('.modal-bg:not(.hidden)').first(); if(!(await m.count()))break;
  const nx=m.locator('button:has-text("next")'); if(await nx.count()){await nx.click();await p.waitForTimeout(300);}
  else{await m.locator('button').last().click().catch(()=>{});await p.waitForTimeout(400);break;}}
await p.waitForTimeout(700);
await p.click('#tabs [data-tab="streets"]').catch(()=>{}); await p.waitForTimeout(1200);

for (let i=0;i<5;i++){
  const btn = p.locator('button:has-text("do it")').first();
  await btn.scrollIntoViewIfNeeded().catch(()=>{});
  await p.waitForTimeout(200);
  const t0 = Date.now();
  try { await btn.click({ timeout: 5000 }); console.log(`click ${i+1} OK in ${Date.now()-t0}ms`); }
  catch(e){ console.log(`click ${i+1} FAILED:`, e.message.split('\n')[0]); break; }
  await p.waitForTimeout(900);
  console.log('   toast:', (await p.locator('#toast').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,120));
}
await b.close();
