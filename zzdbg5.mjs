import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage();
p.on('response',async r=>{const u=r.url().replace('http://127.0.0.1:8099','');if(r.status()>=400&&u.startsWith('/v1'))console.log('  HTTP',r.status(),u,(await r.text().catch(()=>'')).slice(0,120));});
await p.goto('http://127.0.0.1:8099/',{waitUntil:'networkidle'});
await p.evaluate(()=>{const e=[...document.querySelectorAll('button')].find(x=>/enter as a ghost/i.test(x.innerText||''));e&&e.click();});
await p.waitForTimeout(1500);
const s=await p.evaluate(()=>({btns:[...document.querySelectorAll('button')].filter(e=>e.offsetParent!==null).map(e=>(e.innerText||e.innerHTML).trim().slice(0,30)),
  inputs:[...document.querySelectorAll('input')].filter(e=>e.offsetParent!==null).map(e=>e.placeholder||e.id||'(in)'),
  body:document.body.innerText.slice(0,300)}));
console.log('buttons:',JSON.stringify(s.btns)); console.log('inputs:',JSON.stringify(s.inputs)); console.log('---\n'+s.body);
await b.close();
