import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
await p.goto('http://127.0.0.1:8099', { waitUntil:'networkidle' });
await p.click('text=ENTER AS A GHOST'); await p.waitForTimeout(1800);
await p.fill('input[placeholder="street name"]', 'Sal '+Math.random().toString(36).slice(2,7));
await p.click('button:has-text("STEP OUT")'); await p.waitForTimeout(3500);
for(let i=0;i<12;i++){const m=p.locator('.modal-bg:not(.hidden)').first(); if(!(await m.count()))break;
  const nx=m.locator('button:has-text("next")'); if(await nx.count()){await nx.click();await p.waitForTimeout(300);}
  else{await m.locator('button').last().click().catch(()=>{});await p.waitForTimeout(400);break;}}
await p.waitForTimeout(700);
await p.click('#tabs [data-tab="streets"]').catch(()=>{}); await p.waitForTimeout(1200);
const btns = await p.locator('button:has-text("do it")').all();
console.log('do-it buttons found:', btns.length);
for (let i=0;i<Math.min(3,btns.length);i++){
  const bb = btns[i];
  console.log(i, 'visible:', await bb.isVisible(), 'enabled:', await bb.isEnabled(), 'box:', JSON.stringify(await bb.boundingBox()));
}
// what is at that point?
if (btns.length) {
  const box = await btns[0].boundingBox();
  if (box) {
    const at = await p.evaluate(({x,y}) => { const e=document.elementFromPoint(x,y); return e? (e.tagName+'.'+e.className+'#'+e.id).slice(0,120):'null'; }, {x:box.x+box.width/2, y:box.y+box.height/2});
    console.log('elementFromPoint at button centre:', at);
  }
}
console.log('open modals:', await p.locator('.modal-bg:not(.hidden)').count());
console.log('intro card?', await p.locator('#introwrap').innerText().catch(()=>'(none)'));
await b.close();
