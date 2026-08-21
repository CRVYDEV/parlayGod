import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto('http://127.0.0.1:8099',{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},process.env.TOK);
await p.goto('http://127.0.0.1:8099',{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
await p.evaluate(()=>document.querySelector('#tabs [data-tab="streets"]')?.click()); await p.waitForTimeout(1800);
// count what actually rendered
console.log(await p.evaluate(()=>{
  const sec=[...document.querySelectorAll('#tab-streets h2')].find(h=>/FREIGHT/i.test(h.innerText));
  const gd=document.querySelectorAll('#tab-streets [data-gd]').length;
  const buy=document.querySelectorAll('#tab-streets [data-gdbuy]').length;
  const crimeBtns=document.querySelectorAll('#tab-streets [data-crime]').length;
  return `good qty inputs: ${gd} · buy buttons: ${buy} · crime buttons: ${crimeBtns}`;
}));
// is the section hidden by CSS or genuinely empty?
console.log(await p.evaluate(()=>{
  const sec=[...document.querySelectorAll('#tab-streets h2')].find(h=>/FREIGHT/i.test(h.innerText));
  if(!sec) return 'no header';
  let n=sec.nextElementSibling, out=[];
  while(n && n.tagName!=='H2'){ const cs=getComputedStyle(n);
    out.push(`${n.tagName}.${n.className} display=${cs.display} children=${n.children.length} text="${(n.innerText||'').replace(/\s+/g,' ').slice(0,60)}"`); n=n.nextElementSibling; }
  return out.join('\n') || '(NOTHING between FREIGHT header and next h2)';
}));
console.log('\n=== the "prices" the renderer used ===');
console.log(await p.evaluate(async()=>{ const r=await fetch('/v1/market/prices',{headers:{authorization:'Bearer '+localStorage.getItem('omerta_token')}});
  const j=await r.json(); return 'status '+r.status+' keys='+Object.keys(j).join(',')+' goodsKeys='+Object.keys(j.goods||{}).join(',').slice(0,120); }));
await b.close();
