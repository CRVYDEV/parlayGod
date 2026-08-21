import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', BASE='http://127.0.0.1:8099';
const errs=[]; const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},process.env.TOK);
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(2200);
const clean=s=>(s||'').replace(/\s+/g,' ').trim();
const dismiss=async()=>{for(let i=0;i<6;i++){if(!(await p.locator('.modal-bg:not(.hidden)').count()))break;
  await p.evaluate(()=>{const m=document.querySelector('.modal-bg:not(.hidden)');if(m){const bs=m.querySelectorAll('button');if(bs.length)bs[bs.length-1].click();}});await p.waitForTimeout(200);}
  await p.evaluate(()=>{const i=document.querySelector('#introwrap button');if(i)i.click();}).catch(()=>{});};
const go=async t=>{await p.evaluate(tt=>{const el=document.querySelector(`#tabs [data-tab="${tt}"]`);if(el){el.click();return;}
  for(const g of document.querySelectorAll('#grouprail [data-group]')){g.click();const e2=document.querySelector(`#tabs [data-tab="${tt}"]`);if(e2){e2.click();return;}}},t);
  await p.waitForTimeout(1100);await dismiss();};
const toast=async()=>clean(await p.locator('#toast').innerText().catch(()=>'')).slice(0,180);
const cash=async()=>Number((clean(await p.locator('#sheet').innerText()).match(/\$([\d,]+)/)||[0,'0'])[1].replace(/,/g,''));
await dismiss(); await go('streets');
console.log('=== THE FREIGHT GAME — the loop the tour teaches ===');
// read the hero board: which good, cheapest where, richest where
const txt = clean(await p.locator('#tab-streets').innerText());
const hero = txt.match(/Trade Goods — the Freight Game.{0,600}/i)?.[0] || '(no hero)';
console.log('HERO CARD:', hero.slice(0,500));
console.log('\nCASH BEFORE:', await cash());
// buy the first good available here
const bought = await p.evaluate(()=>{
  const cards=[...document.querySelectorAll('#tab-streets .card')].filter(c=>/buy/i.test(c.innerText)&&/spot|\$/.test(c.innerText));
  for (const c of cards){ const inp=c.querySelector('input[type=number]'); const btn=[...c.querySelectorAll('button')].find(b=>/^buy/i.test(b.innerText.trim()));
    if(inp&&btn){ inp.value='4'; inp.dispatchEvent(new Event('input',{bubbles:true})); btn.click(); return c.innerText.replace(/\s+/g,' ').slice(0,120); } }
  return null; });
console.log('BUY attempt:', bought||'(no buy control found)');
await p.waitForTimeout(1500); console.log('  toast:', await toast(), '| cash:', await cash());
await go('streets');
const trunk = clean(await p.locator('#tab-streets').innerText()).match(/trunk.{0,120}/i)?.[0];
console.log('  trunk now:', trunk||'(n/a)');
console.log('\nPAGEERRORS:', errs.length?errs.join('\n'):'none');
await p.screenshot({path:'/tmp/play/30-freight.png'});
await b.close();
