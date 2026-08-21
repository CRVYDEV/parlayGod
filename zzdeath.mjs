import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', BASE='http://127.0.0.1:8099';
const errs=[],bad=[];
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('response',async r=>{if(r.status()>=400){let t='';try{t=(await r.text()).slice(0,120);}catch{}
  bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')} :: ${t}`);}});
const clean=s=>(s||'').replace(/\s+/g,' ').trim();
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},process.env.TOK);
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
for(let i=0;i<6;i++){if(!(await p.locator('.modal-bg:not(.hidden)').count()))break;
  await p.evaluate(()=>{const m=document.querySelector('.modal-bg:not(.hidden)');if(m){const bs=m.querySelectorAll('button');if(bs.length)bs[bs.length-1].click();}});await p.waitForTimeout(200);}
console.log('BEFORE DEATH:', clean(await p.locator('#sheet').innerText()).slice(0,120));

// kill the street from outside, exactly as a rival would — the mod-kill path
const res = await fetch(`${BASE}/v1/mod/kill`, { method:"POST", headers:{"x-mod-key":"play-session-mod-key-long-enough","content-type":"application/json"}, body: JSON.stringify({characterId: process.env.CID, reason:"a play-session test"}) });
console.log('\nMOD-KILL:', res.status, (await res.text()).slice(0,200));

// the player is sitting on the page. What do they see, and how do they find out?
console.log('\n--- waiting for the client to notice (the 30s poll / WS) ---');
for (const wait of [3000, 8000, 20000, 25000]) {
  await p.waitForTimeout(wait);
  const modal = await p.locator('.modal-bg:not(.hidden)').count();
  const sheet = clean(await p.locator('#sheet').innerText()).slice(0,110);
  console.log(` +${wait}ms · modal=${modal} · sheet: ${sheet}`);
  if (modal) {
    console.log('\n=== THE DEATH MODAL ===');
    console.log(clean(await p.locator('.modal-bg:not(.hidden)').first().innerText()).slice(0,900));
    await p.screenshot({path:'/tmp/play/40-death.png'});
    break;
  }
}
console.log('\n=== after a manual refresh (what a returning player does) ===');
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(3000);
console.log('sheet:', clean(await p.locator('#sheet').innerText()).slice(0,200));
const modal2 = await p.locator('.modal-bg:not(.hidden)').count();
if (modal2) console.log('MODAL:', clean(await p.locator('.modal-bg:not(.hidden)').first().innerText()).slice(0,700));
await p.screenshot({path:'/tmp/play/41-after-death.png'});
console.log('\nPAGEERRORS: '+(errs.length?errs.join('\n'):'none'));
console.log('HTTP>=400: '+([...new Set(bad)].join('\n')||'none'));
await b.close();
