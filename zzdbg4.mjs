import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage();
await p.goto('http://127.0.0.1:8099/',{waitUntil:'networkidle'});
const empty=await p.evaluate(()=>[...document.querySelectorAll('button')].filter(e=>e.offsetParent!==null&&!(e.innerText||'').trim())
  .map(e=>({id:e.id,cls:e.className,html:e.innerHTML.slice(0,120),aria:e.getAttribute('aria-label'),title:e.title,
            w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)})));
console.log('EMPTY-TEXT VISIBLE BUTTONS:',JSON.stringify(empty,null,1));
await b.close();
