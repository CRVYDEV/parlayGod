import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
p.on('pageerror', e=>console.log('PAGEERROR:', e.message));
const bad=[]; p.on('response', async r=>{ if(r.status()>=400){let t='';try{t=(await r.text()).slice(0,120);}catch{} bad.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://127.0.0.1:8099','')} :: ${t}`);}});
await p.goto('http://127.0.0.1:8099', { waitUntil:'networkidle' });
await p.click('text=ENTER AS A GHOST'); await p.waitForTimeout(1800);
await p.fill('input[placeholder="street name"]', 'Sal '+Math.random().toString(36).slice(2,7));
await p.click('button:has-text("STEP OUT")'); await p.waitForTimeout(3500);
for(let i=0;i<12;i++){const m=p.locator('.modal-bg:not(.hidden)').first(); if(!(await m.count()))break;
  const nx=m.locator('button:has-text("next")'); if(await nx.count()){await nx.click();await p.waitForTimeout(300);}
  else{await m.locator('button').last().click().catch(()=>{});await p.waitForTimeout(400);break;}}
await p.waitForTimeout(700);
await p.click('#tabs [data-tab="streets"]').catch(()=>{}); await p.waitForTimeout(1200);
for (let i=0;i<12;i++){
  const btn = p.locator('button:has-text("do it")').first();
  if(!(await btn.count())) break;
  await btn.scrollIntoViewIfNeeded().catch(()=>{});
  try { await btn.click({timeout:4000}); } catch { break; }
  await p.waitForTimeout(750);
  const t=(await p.locator('#toast').innerText().catch(()=>'')).replace(/\s+/g,' ');
  if (/took you in|lockup/i.test(t)) break;
}
await p.waitForTimeout(1200); await p.locator('#introwrap button').first().click({timeout:1500}).catch(()=>{});
console.log('cash:', (await p.locator('#sheet').innerText()).match(/\$[\d,]+/)?.[0]);
console.log('\n=== ARE UNAFFORDABLE PEN CONTROLS DISABLED / EXPLAINED? ===');
for (const label of ['pay it all off','pay','buy','work']) {
  for (const el of await p.locator(`#tab-pen button:has-text("${label}")`).all()) {
    const txt=(await el.innerText()).trim(); const dis=await el.isDisabled();
    const title=await el.getAttribute('title');
    if (txt) console.log(` btn "${txt}" disabled=${dis} title=${title||'—'}`);
  }
  break;
}
console.log('\n=== press an unaffordable one: "pay it all off" ($1,600 with $500) ===');
const payAll = p.locator('#tab-pen button:has-text("pay it all off")').first();
if (await payAll.count()) {
  await payAll.scrollIntoViewIfNeeded().catch(()=>{});
  await payAll.click({timeout:4000}).catch(e=>console.log('click err', e.message.split('\n')[0]));
  await p.waitForTimeout(1200);
  console.log('toast:', (await p.locator('#toast').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,200));
} else console.log('(no pay-it-all-off button)');
console.log('\n=== press "buy" on the $50,000 Hacksaw with $500 ===');
const hack = p.locator('#tab-pen button:has-text("buy")').last();
if (await hack.count()) { await hack.scrollIntoViewIfNeeded().catch(()=>{}); await hack.click({timeout:4000}).catch(()=>{}); await p.waitForTimeout(1200);
  console.log('toast:', (await p.locator('#toast').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,200)); }
console.log('\nHTTP>=400:', bad.join('\n')||'none');
await b.close();
