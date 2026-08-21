import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
p.on('pageerror', e=>console.log('PAGEERROR:', e.message));
await p.goto('http://127.0.0.1:8099', { waitUntil:'networkidle' });
await p.click('text=ENTER AS A GHOST'); await p.waitForTimeout(1800);
await p.fill('input[placeholder="street name"]', 'Sal '+Math.random().toString(36).slice(2,7));
await p.click('button:has-text("STEP OUT")'); await p.waitForTimeout(3500);
for(let i=0;i<12;i++){const m=p.locator('.modal-bg:not(.hidden)').first(); if(!(await m.count()))break;
  const nx=m.locator('button:has-text("next")'); if(await nx.count()){await nx.click();await p.waitForTimeout(300);}
  else{await m.locator('button').last().click().catch(()=>{});await p.waitForTimeout(400);break;}}
await p.waitForTimeout(700);
await p.click('#tabs [data-tab="streets"]').catch(()=>{}); await p.waitForTimeout(1200);

// keep pulling the leading job until busted, to see the jail experience
let n=0;
for (let i=0;i<15;i++){
  const btn = p.locator('button:has-text("do it")').first();
  if(!(await btn.count())) break;
  await btn.scrollIntoViewIfNeeded().catch(()=>{});
  try { await btn.click({timeout:4000}); } catch { break; }
  n++;
  await p.waitForTimeout(800);
  const t = (await p.locator('#toast').innerText().catch(()=>'')).replace(/\s+/g,' ');
  console.log(`job ${n}: ${t.slice(0,130)}`);
  // dismiss the crime vignette
  await p.locator('#cine').click({timeout:800}).catch(()=>{});
  if (/took you in|lockup|BUSTED/i.test(t)) { console.log('   >>> BUSTED on job', n); break; }
}
await p.waitForTimeout(1500);
console.log('\n=== WHICH TAB AM I ON NOW? ===');
console.log(await p.evaluate(()=>{const a=document.querySelector('#tabs [data-tab].on, #tabs button.on'); return a? a.dataset.tab||a.textContent : 'unknown';}));
await p.screenshot({ path:'/tmp/play/08-jailed.png' });
console.log('\n=== WHAT A JAILED FIRST-TIMER SEES ===');
console.log((await p.locator('#tabbodies').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,1500));
console.log('\n=== COACH ===');
console.log((await p.locator('#coachwrap').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,300));
await b.close();
