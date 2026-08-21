import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
await p.goto('http://127.0.0.1:8099',{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},process.env.TOK);
await p.goto('http://127.0.0.1:8099',{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
await p.evaluate(()=>document.querySelector('#tabs [data-tab="streets"]')?.click()); await p.waitForTimeout(1800);
console.log(await p.evaluate(()=>{
  const el=document.querySelector('#tab-streets [data-gdbuy]');
  if(!el) return 'no buy button';
  const chain=[]; let n=el;
  while(n && n.id!=='tab-streets'){ chain.push(`${n.tagName}${n.id?'#'+n.id:''}${n.className?'.'+String(n.className).split(' ').join('.'):''}${n.tagName==='DETAILS'?(n.open?'[OPEN]':'[CLOSED]'):''}`); n=n.parentElement; }
  const cs=getComputedStyle(el.closest('div,details')||el);
  return 'ANCESTORS: '+chain.reverse().join(' > ')+'\ndisplay='+cs.display+' visible='+(el.getBoundingClientRect().height>0);
}));
console.log('\n=== all <details> summaries on Streets ===');
console.log(await p.evaluate(()=>[...document.querySelectorAll('#tab-streets details')].map(d=>`${d.open?'OPEN ':'CLOSED'} "${(d.querySelector('summary')?.innerText||'').replace(/\s+/g,' ').trim().slice(0,70)}"`).join('\n')));
await b.close();
