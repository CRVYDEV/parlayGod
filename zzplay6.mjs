import { chromium } from 'playwright-core';
import pg from 'pg';
const pool=new pg.Pool({connectionString:'postgres://postgres@/playsession?host=/tmp&port=5433'});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1280,height:900}});
const errs=[],http=[];
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('console',m=>{if(m.type()==='error'&&!/status of 400/.test(m.text()))errs.push('CONSOLE: '+m.text().slice(0,150));});
p.on('response',r=>{if(r.status()>=500)http.push(r.status()+' '+r.url().replace('http://127.0.0.1:8099',''));});
const clickTxt=(t)=>p.evaluate((t)=>{const e=[...document.querySelectorAll('button,a,[data-tab],[data-group]')]
  .find(x=>x.offsetParent!==null&&new RegExp(t,'i').test(x.innerText||x.innerHTML||''));if(e){e.click();return true;}return false;},t);
const dismiss=async()=>{for(let i=0;i<10;i++){const d=await p.evaluate(()=>{const e=[...document.querySelectorAll('button')]
  .find(x=>x.offsetParent!==null&&/^(got it|skip|close|×|continue)$/i.test((x.innerText||'').trim()));if(e){e.click();return true;}return false;});
  if(!d)break;await p.waitForTimeout(120);}};
await p.goto('http://127.0.0.1:8099/',{waitUntil:'networkidle'});
await p.evaluate(()=>localStorage.setItem('omerta_alltabs','1'));
await clickTxt('enter as a ghost'); await p.waitForTimeout(1200);
const nm='Sal'+Math.random().toString(36).slice(2,6);
await p.evaluate((n)=>{const i=[...document.querySelectorAll('input')].find(x=>x.offsetParent!==null&&/street name/i.test(x.placeholder||''));
  i.value=n;i.dispatchEvent(new Event('input',{bubbles:true}));},nm);
await clickTxt('step out'); await p.waitForTimeout(2000); await dismiss();
const cid=(await pool.query('SELECT id FROM characters WHERE name=$1',[nm])).rows[0].id;
console.log('playing as',nm);
await pool.query('UPDATE characters SET cash=44000, bank=8000, bank_intransit=0 WHERE id=$1',[cid]);
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(1200); await dismiss();
await fetch('http://127.0.0.1:8099/v1/mod/kill',{method:'POST',headers:{'content-type':'application/json','x-mod-key':'play-session-mod-key-long-enough'},
  body:JSON.stringify({characterId:cid,reason:'copy check'})});
for(let i=0;i<12;i++){await p.waitForTimeout(1500);
  const m=await p.evaluate(()=>{const x=document.querySelector('#deathmodal');return x&&!x.classList.contains('hidden')?x.innerText:null;});
  if(m){console.log('\n===== THE DEATH MODAL, AS A PLAYER SEES IT =====\n'+m);break;}
  if(i===5)await p.reload({waitUntil:'networkidle'});}
console.log('\npage errors:',errs.length,'· 5xx:',http.length);
errs.slice(0,4).forEach(e=>console.log('  '+e)); http.slice(0,4).forEach(e=>console.log('  '+e));
await b.close(); await pool.end();
