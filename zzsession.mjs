import { chromium } from 'playwright-core';
import pg from 'pg';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', BASE='http://127.0.0.1:8099';
const NAME = 'Sal '+Math.random().toString(36).slice(2,7);
const pool = new pg.Pool({ connectionString:'postgres://postgres@/playsession?host=/tmp&port=5433' });
const CLOCK = ['last_accrued_at','gta_at','heist_at','train_at','mission_at','race_at','active_at','respec_at','world_raid_at','crew_paid_at'];
const warp = async (id,min)=>{ const s=CLOCK.map(c=>`${c}=${c} - interval '${min} minutes'`).join(', ');
  await pool.query(`UPDATE characters SET ${s} WHERE id=$1`,[id]).catch(()=>{});
  await pool.query(`UPDATE characters SET jail_until=NULL, hosp_until=NULL WHERE id=$1 AND (jail_until<now() OR hosp_until<now())`,[id]).catch(()=>{}); };
const errs=[], bad=[];
const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
const ctx = await b.newContext({ viewport:{width:1400,height:1100} });
const p = await ctx.newPage();
p.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
p.on('response', async r=>{ if(r.status()>=400){let t='';try{t=(await r.text()).slice(0,140);}catch{}
  bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')} :: ${t}`);}});
const say=console.log, clean=s=>(s||'').replace(/\s+/g,' ').trim();
const tap=(text,scope='body')=>p.evaluate(([tx,sc])=>{ const root=document.querySelector(sc)||document.body;
  const e=[...root.querySelectorAll('button,a')].filter(x=>{ if(x.disabled)return false;
    const r=x.getBoundingClientRect(); if(!r.width||!r.height)return false;
    return (x.innerText||'').trim().toLowerCase().includes(tx.toLowerCase()); });
  if(!e.length)return false; e[0].click(); return true; },[text,scope]);
const toast=async()=>clean(await p.locator('#toast').innerText().catch(()=>'')).slice(0,200);
const coach=async()=>clean(await p.locator('#coachwrap').first().innerText().catch(()=>'')).slice(0,240);
const stat=async()=>{const t=clean(await p.locator('#sheet').innerText().catch(()=>''));
  return `${(t.match(/LVL\s*\d+/i)||['?'])[0]} ${(t.match(/\$[\d,]+/)||[''])[0]}`;};
const dismiss=async()=>{ for(let i=0;i<6;i++){ if(!(await p.locator('.modal-bg:not(.hidden)').count()))break;
  await p.evaluate(()=>{const m=document.querySelector('.modal-bg:not(.hidden)'); if(m){const bs=m.querySelectorAll('button'); if(bs.length)bs[bs.length-1].click();}}); await p.waitForTimeout(250);}
  await p.evaluate(()=>{const i=document.querySelector('#introwrap button'); if(i)i.click();}).catch(()=>{}); };
const nav=async(tab)=>{ await dismiss();
  await p.evaluate(t=>{const el=document.querySelector(`#tabs [data-tab="${t}"]`); if(el){el.click();return;}
    for(const g of document.querySelectorAll('#grouprail [data-group]')){g.click();
      const e2=document.querySelector(`#tabs [data-tab="${t}"]`); if(e2){e2.click();return;}}},tab);
  await p.waitForTimeout(950); await dismiss(); };

await p.goto(BASE,{waitUntil:'networkidle'});
await p.click('text=ENTER AS A GHOST'); await p.waitForTimeout(1800);
await p.fill('input[placeholder="street name"]',NAME);
await p.click('button:has-text("STEP OUT")'); await p.waitForTimeout(3500);
for(let i=0;i<12;i++){const m=p.locator('.modal-bg:not(.hidden)').first(); if(!(await m.count()))break;
  if(await m.locator('button:has-text("next")').count()){await m.locator('button:has-text("next")').click();await p.waitForTimeout(300);}
  else{await m.locator('button').last().click().catch(()=>{});await p.waitForTimeout(380);break;}}
await dismiss(); await p.evaluate(()=>localStorage.setItem('omerta_alltabs','1')); await p.waitForTimeout(500);
const cid=(await pool.query('SELECT id FROM characters WHERE name=$1',[NAME])).rows[0].id;
say(`PLAYING: ${NAME} · ${await stat()}`);

await nav('streets');
say('\n=== THE GRIND (nerve regen warped, like hours of play) ===');
let acts=0,busts=0,seen=new Set();
for(let round=0; round<26; round++){
  for(let i=0;i<10;i++){
    await dismiss();
    if(!(await tap('do it','#tab-streets'))){ await nav('streets'); if(!(await tap('do it','#tab-streets'))) break; }
    acts++; await p.waitForTimeout(430);
    const t=await toast();
    if(/BUSTED|took you in/i.test(t)) busts++;
    if(t&&!seen.has(t.slice(0,36))){seen.add(t.slice(0,36)); if(seen.size<=8)say(`  ${t.slice(0,115)}`);}
    if(/nerve/i.test(t)) break;
  }
  await warp(cid,90);
  await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(700);
  const s=await stat();
  if(/LVL (5|6|7|8|9|1\d)/i.test(s)){ say(`  reached ${s} after ${acts} actions / ${round+1} rounds`); break; }
}
say(`  -> ${acts} actions, ${busts} busts · ${await stat()}`);
say(`COACH: ${await coach()}`);
await p.screenshot({path:'/tmp/play/10-grind.png'});
say('\nPAGEERRORS: '+(errs.length?'\n'+errs.join('\n'):'none'));
say('HTTP>=400 unique:\n'+([...new Set(bad)].join('\n')||'none'));
await pool.query('SELECT 1'); await pool.end();
await ctx.storageState({path:'/tmp/play/state.json'});
await p.evaluate(()=>localStorage.getItem('omerta_token')).then(t=>console.log('TOKEN:',t));
console.log('CHARID:',cid);
await b.close();
