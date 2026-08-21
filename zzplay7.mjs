import { chromium } from 'playwright-core';
import pg from 'pg';
const pool=new pg.Pool({connectionString:'postgres://postgres@/playsession?host=/tmp&port=5433'});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1280,height:900}});
const errs=[],http=[];
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,140));});
p.on('response',r=>{if(r.status()>=500)http.push(r.status()+' '+r.url().replace('http://127.0.0.1:8099',''));});
const clickTxt=(t)=>p.evaluate((t)=>{const e=[...document.querySelectorAll('button,a,[data-tab],[data-group]')]
  .find(x=>x.offsetParent!==null&&new RegExp(t,'i').test(x.innerText||x.innerHTML||''));if(e){e.click();return true;}return false;},t);
const dismiss=async()=>{for(let i=0;i<10;i++){const d=await p.evaluate(()=>{const e=[...document.querySelectorAll('button')]
  .find(x=>x.offsetParent!==null&&/^(got it|skip|close|×|continue)$/i.test((x.innerText||'').trim()));if(e){e.click();return true;}return false;});
  if(!d)break;await p.waitForTimeout(120);}};
await p.goto('http://127.0.0.1:8099/',{waitUntil:'networkidle'});
await p.evaluate(()=>localStorage.setItem('omerta_alltabs','1'));
await clickTxt('enter as a ghost'); await p.waitForTimeout(1200);
const nm='Nico'+Math.random().toString(36).slice(2,6);
await p.evaluate((n)=>{const i=[...document.querySelectorAll('input')].find(x=>x.offsetParent!==null&&/street name/i.test(x.placeholder||''));
  i.value=n;i.dispatchEvent(new Event('input',{bubbles:true}));},nm);
await clickTxt('step out'); await p.waitForTimeout(2000); await dismiss();
const cid=(await pool.query('SELECT id FROM characters WHERE name=$1',[nm])).rows[0].id;
await pool.query('UPDATE characters SET cash=50000, energy=100, nerve=50 WHERE id=$1',[cid]);
console.log('playing as',nm);
// go to Streets and find TONIGHT'S HUSTLE
await clickTxt('streets'); await p.waitForTimeout(900); await dismiss();
const openAll=()=>p.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));
await openAll(); await p.waitForTimeout(400);
for(let step=1;step<=4;step++){
  const card=await p.evaluate(()=>{const els=[...document.querySelectorAll('.card,.sect,div')]
    .filter(e=>/TONIGHT'S HUSTLE|tonight.s hustle/i.test(e.innerText||''));
    const el=els[els.length-1]; return el?el.innerText.slice(0,420):null;});
  console.log('\n--- hustle read '+step+' ---\n'+(card||'(no hustle card found on Streets)'));
  if(!card)break;
  // take whatever action the card offers
  const did=await p.evaluate(()=>{const els=[...document.querySelectorAll('.card,.sect,div')]
    .filter(e=>/TONIGHT'S HUSTLE/i.test(e.innerText||'')); const el=els[els.length-1]; if(!el)return null;
    const btn=[...el.querySelectorAll('button')].find(x=>x.offsetParent!==null&&!/^\s*$/.test(x.innerText||''));
    if(btn){const t=btn.innerText.trim();btn.click();return t;}return null;});
  console.log('   → clicked:',did||'(no button)');
  if(!did)break;
  await p.waitForTimeout(1600); await openAll();
  const toast=await p.evaluate(()=>{const t=document.querySelector('#toast,.toast');return t&&t.offsetParent!==null?t.innerText.slice(0,150):null;});
  if(toast)console.log('   toast:',toast.replace(/\n/g,' '));
}
console.log('\npage errors:',errs.length,'· 5xx:',http.length);
errs.slice(0,6).forEach(e=>console.log('  '+e)); http.slice(0,6).forEach(e=>console.log('  '+e));
await b.close(); await pool.end();
