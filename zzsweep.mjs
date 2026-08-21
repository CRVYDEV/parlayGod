import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', BASE='http://127.0.0.1:8099';
const TOKEN=process.env.TOK;
const errs=[],bad=[];
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('response',async r=>{if(r.status()>=400){let t='';try{t=(await r.text()).slice(0,120);}catch{}
  bad.push(`${r.status()} ${r.url().replace(BASE,'')} :: ${t}`);}});
const clean=s=>(s||'').replace(/\s+/g,' ').trim();
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await p.evaluate(t=>{localStorage.setItem('omerta_token',t);localStorage.setItem('omerta_alltabs','1');
  localStorage.setItem('omerta_welcomed','1');localStorage.setItem('omerta_tour2','1');},TOKEN);
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
const dismiss=async()=>{for(let i=0;i<6;i++){if(!(await p.locator('.modal-bg:not(.hidden)').count()))break;
  await p.evaluate(()=>{const m=document.querySelector('.modal-bg:not(.hidden)');if(m){const bs=m.querySelectorAll('button');if(bs.length)bs[bs.length-1].click();}});await p.waitForTimeout(220);}};
await dismiss();
const tabs = await p.evaluate(()=>[...document.querySelectorAll('#tabs [data-tab]')].map(e=>e.dataset.tab));
const groups = await p.evaluate(()=>[...document.querySelectorAll('#grouprail [data-group]')].map(e=>e.dataset.group));
console.log('groups:', groups.join(', '));
const all=new Set();
for (const g of groups){
  await p.evaluate(gg=>document.querySelector(`#grouprail [data-group="${gg}"]`)?.click(), g);
  await p.waitForTimeout(400);
  for (const t of await p.evaluate(()=>[...document.querySelectorAll('#tabs [data-tab]')].map(e=>e.dataset.tab))) all.add(t);
}
console.log('screens:', [...all].join(', '), `(${all.size})`);
console.log('\n=== SWEEPING EVERY SCREEN ===');
const findings=[];
for (const tab of all){
  const before=errs.length;
  await p.evaluate(t=>{const el=document.querySelector(`#tabs [data-tab="${t}"]`);if(el){el.click();return;}
    for(const g of document.querySelectorAll('#grouprail [data-group]')){g.click();
      const e2=document.querySelector(`#tabs [data-tab="${t}"]`);if(e2){e2.click();return;}}},tab);
  await p.waitForTimeout(1500); await dismiss();
  const txt = clean(await p.locator(`#tab-${tab}`).innerText().catch(()=>''));
  const bads = [];
  for (const pat of ['undefined','NaN','[object Object]','null','Infinity','ReferenceError']) {
    const re = new RegExp(`(^|[^A-Za-z])${pat.replace(/[[\]]/g,'\\$&')}([^A-Za-z]|$)`,'g');
    const m = txt.match(re); if (m) bads.push(`${pat}×${m.length}`);
  }
  const newErrs = errs.length-before;
  const flag = bads.length||newErrs ? '  ⚠️ ' + [...bads, newErrs?`${newErrs} pageerror`:''].filter(Boolean).join(' ') : '';
  console.log(` ${tab.padEnd(12)} ${String(txt.length).padStart(5)} chars${flag}`);
  if (bads.length) findings.push({tab, bads, sample: txt.match(new RegExp(`.{0,90}(undefined|NaN|\\[object Object\\]).{0,90}`))?.[0]});
  if (txt.length < 40) findings.push({tab, bads:['EMPTY SCREEN'], sample: txt});
}
console.log('\n=== FINDINGS ===');
for (const f of findings) console.log(` ${f.tab}: ${f.bads.join(', ')}\n    "${(f.sample||'').slice(0,190)}"`);
console.log('\nPAGEERRORS: '+(errs.length?errs.join('\n'):'none'));
console.log('HTTP>=400: '+([...new Set(bad)].join('\n')||'none'));
await b.close();
