import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', BASE='http://127.0.0.1:8099';
const errs=[],bad=[];
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1400}})).newPage();
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('response',async r=>{if(r.status()>=400){let t='';try{t=(await r.text()).slice(0,110);}catch{}
  bad.push(`${r.status()} ${r.url().replace(BASE,'')} :: ${t}`);}});
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},process.env.TOK);
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
const dismiss=async()=>{for(let i=0;i<6;i++){if(!(await p.locator('.modal-bg:not(.hidden)').count()))break;
  await p.evaluate(()=>{const m=document.querySelector('.modal-bg:not(.hidden)');if(m){const bs=m.querySelectorAll('button');if(bs.length)bs[bs.length-1].click();}});await p.waitForTimeout(200);}
  await p.evaluate(()=>{const i=document.querySelector('#introwrap button');if(i)i.click();}).catch(()=>{});};
await dismiss();
const groups=await p.evaluate(()=>[...document.querySelectorAll('#grouprail [data-group]')].map(e=>e.dataset.group));
const all=new Set();
for(const g of groups){ await p.evaluate(gg=>document.querySelector(`#grouprail [data-group="${gg}"]`)?.click(),g); await p.waitForTimeout(350);
  for(const t of await p.evaluate(()=>[...document.querySelectorAll('#tabs [data-tab]')].map(e=>e.dataset.tab))) all.add(t); }
console.log('=== SWEEP WITH EVERY DRAWER OPEN ===');
const findings=[];
for(const tab of all){
  const before=errs.length;
  await p.evaluate(t=>{const el=document.querySelector(`#tabs [data-tab="${t}"]`);if(el){el.click();return;}
    for(const g of document.querySelectorAll('#grouprail [data-group]')){g.click();const e2=document.querySelector(`#tabs [data-tab="${t}"]`);if(e2){e2.click();return;}}},tab);
  await p.waitForTimeout(1300); await dismiss();
  const drawers=await p.evaluate(t=>{const ds=[...document.querySelectorAll(`#tab-${t} details`)]; ds.forEach(d=>d.open=true); return ds.length;},tab);
  await p.waitForTimeout(700);
  const txt=(await p.locator(`#tab-${tab}`).innerText().catch(()=>'')).replace(/\s+/g,' ').trim();
  const bads=[];
  for(const pat of ['undefined','NaN','[object Object]','Infinity','\\$NaN','null']){
    const re=new RegExp(`(^|[^A-Za-z_])${pat.replace(/[[\]$]/g,'\\$&')}([^A-Za-z_]|$)`,'g');
    const m=txt.match(re); if(m) bads.push(`${pat}×${m.length}`); }
  const ne=errs.length-before;
  console.log(` ${tab.padEnd(11)} ${String(txt.length).padStart(6)} chars · ${drawers} drawers${bads.length||ne?'   ⚠️ '+[...bads,ne?`${ne} pageerror`:''].filter(Boolean).join(' '):''}`);
  if(bads.length) findings.push({tab,bads,sample:(txt.match(new RegExp(`.{0,110}(undefined|NaN|\\[object Object\\]|Infinity).{0,110}`))||[])[0]});
}
console.log('\n=== FINDINGS ===');
findings.length?findings.forEach(f=>console.log(` ${f.tab}: ${f.bads.join(', ')}\n   "${(f.sample||'').slice(0,220)}"`)):console.log(' none');
console.log('\nPAGEERRORS: '+(errs.length?errs.join('\n'):'none'));
console.log('HTTP>=400: '+([...new Set(bad)].join('\n')||'none'));
await b.close();
