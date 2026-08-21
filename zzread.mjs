import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', BASE='http://127.0.0.1:8099';
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},process.env.TOK);
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(2200);
const dismiss=async()=>{for(let i=0;i<6;i++){if(!(await p.locator('.modal-bg:not(.hidden)').count()))break;
  await p.evaluate(()=>{const m=document.querySelector('.modal-bg:not(.hidden)');if(m){const bs=m.querySelectorAll('button');if(bs.length)bs[bs.length-1].click();}});await p.waitForTimeout(200);}};
await dismiss();
const go=async t=>{await p.evaluate(tt=>{const el=document.querySelector(`#tabs [data-tab="${tt}"]`);if(el){el.click();return;}
  for(const g of document.querySelectorAll('#grouprail [data-group]')){g.click();
    const e2=document.querySelector(`#tabs [data-tab="${tt}"]`);if(e2){e2.click();return;}}},t);
  await p.waitForTimeout(1200);await dismiss();
  return (await p.locator(`#tab-${t}`).innerText().catch(()=>'')).replace(/\s+/g,' ').trim();};
for (const t of (process.env.TABS||'family,pen,kitchen,crew,market,stable,speakeasy,loans,law').split(',')) {
  console.log(`\n───────── ${t.toUpperCase()} ─────────`);
  console.log((await go(t)).slice(0, 1000));
}
await b.close();
