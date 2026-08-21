import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto('http://127.0.0.1:8099',{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},process.env.TOK);
await p.goto('http://127.0.0.1:8099',{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
for(let i=0;i<6;i++){if(!(await p.locator('.modal-bg:not(.hidden)').count()))break;
  await p.evaluate(()=>{const m=document.querySelector('.modal-bg:not(.hidden)');if(m){const bs=m.querySelectorAll('button');if(bs.length)bs[bs.length-1].click();}});await p.waitForTimeout(200);}
await p.evaluate(()=>document.querySelector('#tabs [data-tab="streets"]')?.click()); await p.waitForTimeout(1600);
const full = (await p.locator('#tab-streets').innerText()).replace(/\s+/g,' ');
const i = full.search(/FREIGHT GAME/i);
console.log('=== 1200 chars from the FREIGHT GAME header ===');
console.log(full.slice(i, i+1200));
console.log('\n=== section headers on Streets ===');
console.log(await p.evaluate(()=>[...document.querySelectorAll('#tab-streets h2')].map(h=>h.innerText.replace(/\s+/g,' ').trim()).join(' | ')));
console.log('\n=== is there a goods grid in the DOM? ===');
console.log(await p.evaluate(()=>{
  const sec=[...document.querySelectorAll('#tab-streets h2')].find(h=>/FREIGHT/i.test(h.innerText));
  if(!sec) return 'no freight header';
  let n=sec.nextElementSibling, out=[];
  for(let k=0;k<5&&n;k++,n=n.nextElementSibling) out.push(n.tagName+'.'+(n.className||'')+' :: '+(n.innerText||'').replace(/\s+/g,' ').slice(0,150));
  return out.join('\n');
}));
await b.close();
