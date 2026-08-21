import { chromium } from 'playwright-core';
import pg from 'pg';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', BASE='http://127.0.0.1:8099';
const CID=process.env.CID, TOKEN=process.env.TOK;
const pool = new pg.Pool({ connectionString:'postgres://postgres@/playsession?host=/tmp&port=5433' });
const CLOCK=['last_accrued_at','gta_at','heist_at','train_at','mission_at','race_at','active_at','respec_at','world_raid_at','crew_paid_at'];
const warp=async(min)=>{ const s=CLOCK.map(c=>`${c}=${c} - interval '${min} minutes'`).join(', ');
  await pool.query(`UPDATE characters SET ${s} WHERE id=$1`,[CID]).catch(()=>{}); };
const errs=[],bad=[];
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1400,height:1100}});
const p=await ctx.newPage();
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('response',async r=>{if(r.status()>=400){let t='';try{t=(await r.text()).slice(0,140);}catch{}
  bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')} :: ${t}`);}});
const say=console.log, clean=s=>(s||'').replace(/\s+/g,' ').trim();
const tap=(text,scope='body')=>p.evaluate(([tx,sc])=>{const root=document.querySelector(sc)||document.body;
  const e=[...root.querySelectorAll('button,a')].filter(x=>{if(x.disabled)return false;
    const r=x.getBoundingClientRect(); if(!r.width||!r.height)return false;
    return (x.innerText||'').trim().toLowerCase().includes(tx.toLowerCase());});
  if(!e.length)return false; e[0].click(); return true;},[text,scope]);
const toast=async()=>clean(await p.locator('#toast').innerText().catch(()=>'')).slice(0,200);
const stat=async()=>{const t=clean(await p.locator('#sheet').innerText().catch(()=>''));
  return `${(t.match(/LVL\s*\d+/i)||['?'])[0]} ${(t.match(/\$[\d,]+/)||[''])[0]}`;};
const dismiss=async()=>{for(let i=0;i<6;i++){if(!(await p.locator('.modal-bg:not(.hidden)').count()))break;
  await p.evaluate(()=>{const m=document.querySelector('.modal-bg:not(.hidden)');if(m){const bs=m.querySelectorAll('button');if(bs.length)bs[bs.length-1].click();}});await p.waitForTimeout(240);}
  await p.evaluate(()=>{const i=document.querySelector('#introwrap button');if(i)i.click();}).catch(()=>{});};
const nav=async(tab)=>{await dismiss();
  await p.evaluate(t=>{const el=document.querySelector(`#tabs [data-tab="${t}"]`);if(el){el.click();return;}
    for(const g of document.querySelectorAll('#grouprail [data-group]')){g.click();
      const e2=document.querySelector(`#tabs [data-tab="${t}"]`);if(e2){e2.click();return;}}},tab);
  await p.waitForTimeout(1000);await dismiss();};

await p.goto(BASE,{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},TOKEN);
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(2500); await dismiss();
say(`RESUMED · ${await stat()}`);

// --- declare a Path, as the coach says ---
say('\n=== DECLARE A PATH (what the coach told me to do) ===');
await nav('streets');
say(clean(await p.locator('#tab-streets').innerText()).match(/DECLARE YOUR PATH.{0,700}/i)?.[0] || '(path card not found on Streets)');
const before=await stat();
await tap('the gun','#tab-streets') || await tap('declare','#tab-streets');
await p.waitForTimeout(1400);
say('toast: '+await toast());
say('after: '+await stat()+' (was '+before+')');

// --- grind further so more systems unlock ---
say('\n=== PUSHING ON ===');
let acts=0;
for(let round=0;round<40;round++){
  await nav('streets');
  for(let i=0;i<10;i++){ await dismiss();
    if(!(await tap('do it','#tab-streets'))) break;
    acts++; await p.waitForTimeout(400);
    const t=await toast(); if(/nerve/i.test(t)) break; }
  await warp(120);
  await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(600);
  const s=await stat(); if(/LVL (1[5-9]|[2-9]\d)/i.test(s)){ say(`  reached ${s} after ${acts} actions`); break; }
}
say(`  -> ${await stat()}`);
await pool.end();
say('\nPAGEERRORS: '+(errs.length?'\n'+errs.join('\n'):'none'));
say('HTTP>=400 unique:\n'+([...new Set(bad)].filter(x=>!/nerve|rate_limited|jailed|no_character/.test(x)).join('\n')||'(only benign refusals)'));
await ctx.storageState({path:'/tmp/play/state2.json'});
await b.close();
