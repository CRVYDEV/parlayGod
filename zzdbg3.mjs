import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage();
p.on('response',async r=>{if(r.status()>=400)console.log('  HTTP',r.status(),r.url().replace('http://127.0.0.1:8099',''),await r.text().catch(()=>'') );});
await p.goto('http://127.0.0.1:8099/',{waitUntil:'networkidle'});
const show=async(tag)=>{const s=await p.evaluate(()=>({
  btns:[...document.querySelectorAll('button')].filter(e=>e.offsetParent!==null).map(e=>e.innerText.trim().slice(0,32)),
  inputs:[...document.querySelectorAll('input')].filter(e=>e.offsetParent!==null).map(e=>e.placeholder||e.id||e.name||'(input)'),
})); console.log('\n['+tag+'] buttons:',JSON.stringify(s.btns)); console.log('['+tag+'] inputs:',JSON.stringify(s.inputs));};
await show('landing');
await p.evaluate(()=>{const e=[...document.querySelectorAll('button,a')].find(x=>x.offsetParent!==null&&/enter the city/i.test(x.innerText||''));e&&e.click();});
await p.waitForTimeout(900); await show('after enter');
await b.close();
