// OMERTÀ — the $0 brand graphics pack. See HYPE.md.
//
//   node tools/brandpack.js            → render every asset to public/art/brand/<id>.png
//   node tools/brandpack.js x-header   → render one
//
// No AI spend: each asset is an HTML composition over the EXISTING noir plates (public/art/*.jpg)
// + the served display face (display.woff2), rasterized with playwright-core against the
// pre-installed chromium (the omr-flywheel.html precedent, parameterized). Copy rules are the
// HYPE.md rules: mechanism-true, number-free, extraction only ever "opens at launch"; the founder
// signs wording before anything goes public.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'public', 'art');
const OUT = path.join(ART, 'brand');

// pillar copy mirrors the LIFE cut's act enumerations (tools/hype.js) — one source of truth for
// what each pillar contains; a poster that invents its own list is how copy drifts.
const ASSETS = [
  { id: 'x-header', w: 1500, h: 500, bg: 'hero-backdrop.jpg', layout: 'wide',
    title: 'OMERTÀ', tag: 'a noir mafia city with a real economy',
    foot: 'one life · no respawns · omerta.fun' },
  { id: 'og-card', w: 1200, h: 630, bg: 'hero-poster.jpg', layout: 'wide',
    title: 'OMERTÀ', tag: 'the city pays the bold',
    foot: 'one life · no respawns · omerta.fun' },
  { id: 'poster-streets', w: 1080, h: 1350, bg: 'interior-streets.jpg', layout: 'poster',
    kicker: 'I · THE STREETS', title: 'PULL JOBS',
    lines: ['forty-three crimes — case it, do it, or go loud', 'boost cars · train your build · arm up', 'work the freight across town'] },
  { id: 'poster-rackets', w: 1080, h: 1350, bg: 'interior-empire.jpg', layout: 'poster',
    kicker: 'II · THE RACKETS', title: 'BUILD THE EMPIRE',
    lines: ['cook and deal · buy the fronts', 'crew scores, convoys, smuggling by sea', 'play the black market'] },
  { id: 'poster-vice', w: 1080, h: 1350, bg: 'interior-den.jpg', layout: 'poster',
    kicker: 'III · THE VICE', title: 'EVERY TABLE IS OPEN',
    lines: ['craps · blackjack · the numbers · hold’em', 'the track, the fights, the animals', 'race for pink slips'] },
  { id: 'poster-blood', w: 1080, h: 1350, bg: 'hitman-professional.jpg', layout: 'poster',
    kicker: 'IV · THE BLOOD', title: 'ONE LIFE. NO RESPAWNS.',
    lines: ['contracts · vendettas · the wires', 'lend hard money, collect it hard', 'beat the case — or go over the wall'] },
  { id: 'poster-family', w: 1080, h: 1350, bg: 'interior-family.jpg', layout: 'poster',
    kicker: 'V · THE FAMILY', title: 'NOBODY CLIMBS ALONE',
    lines: ['get made · pool tribute · claim turf', 'go to war, break the cartels', 'sit on the commission'] },
  { id: 'poster-legit', w: 1080, h: 1350, bg: 'interior-legit.jpg', layout: 'poster',
    kicker: 'VI · GOING LEGIT', title: 'A REAL BOOK, EARNED',
    lines: ['own your street — the deed is an NFT', 'the families vote the ticker', 'extraction opens at launch'] },
];

function html(a) {
  // data URIs, not file:// — under page.setContent the file:// subresources never loaded
  // (verified by reading the first renders: correct text stacks over near-black frames),
  // and a data URI cannot fail to resolve. A plate jpg is ~100-300KB; the woff2 is 12.7KB.
  const bg = `data:image/jpeg;base64,${fs.readFileSync(path.join(ART, a.bg)).toString('base64')}`;
  const font = `data:font/woff2;base64,${fs.readFileSync(path.join(ART, 'display.woff2')).toString('base64')}`;
  const wide = a.layout === 'wide';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family:'Oswald'; font-weight:600; src:url('${font}') format('woff2'); }
* { margin:0; padding:0; box-sizing:border-box; }
body { width:${a.w}px; height:${a.h}px; position:relative; overflow:hidden;
  font-family:'Oswald','Arial Narrow',Arial,sans-serif; background:#08090b; }
.bg { position:absolute; inset:0; background:url('${bg}') center/cover; }
.scrim { position:absolute; inset:0;
  background: linear-gradient(180deg, rgba(8,9,11,${wide ? '.25' : '.15'}) 0%, rgba(8,9,11,${wide ? '.55' : '.35'}) 55%, rgba(8,9,11,.92) 100%); }
.grain { position:absolute; inset:0;
  background-image: repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, transparent 1px 3px); }
.stack { position:absolute; left:0; right:0; bottom:${wide ? '10%' : '7%'}; text-align:center; }
.kicker { color:#e9c25a; font-size:${wide ? 22 : 30}px; letter-spacing:8px; margin-bottom:14px;
  text-shadow:0 2px 14px rgba(0,0,0,.9); }
h1 { color:#efe9d8; font-size:${wide ? 110 : 84}px; letter-spacing:${wide ? 26 : 10}px; line-height:1.04;
  font-weight:600; text-shadow:0 4px 30px rgba(0,0,0,.95), 0 0 60px rgba(233,194,90,.18);
  padding:0 40px; }
.tag { color:#cfc9ba; font-size:${wide ? 30 : 26}px; letter-spacing:6px; margin-top:18px;
  text-shadow:0 2px 12px rgba(0,0,0,.9); }
.lines { margin-top:26px; }
.lines div { color:#b9b09a; font-size:27px; letter-spacing:3px; line-height:1.9;
  text-shadow:0 2px 10px rgba(0,0,0,.9); }
.foot { color:#e9c25a; font-size:${wide ? 26 : 24}px; letter-spacing:7px; margin-top:26px;
  text-shadow:0 2px 12px rgba(0,0,0,.9); }
.rule { width:120px; height:2px; background:#e9c25a; opacity:.7; margin:22px auto 0; }
.brand { position:absolute; left:0; right:0; bottom:2.6%; text-align:center; color:#8a8471;
  font-size:19px; letter-spacing:6px; }
</style></head><body>
<div class="bg"></div><div class="scrim"></div><div class="grain"></div>
<div class="stack">
  ${a.kicker ? `<div class="kicker">${a.kicker}</div>` : ''}
  <h1>${a.title}</h1>
  ${a.tag ? `<div class="tag">${a.tag}</div>` : ''}
  ${a.lines ? `<div class="lines">${a.lines.map((l) => `<div>${l}</div>`).join('')}</div>` : ''}
  ${a.foot ? `<div class="foot">${a.foot}</div>` : '<div class="rule"></div>'}
</div>
${a.layout === 'poster' ? '<div class="brand">OMERTÀ · OMERTA.FUN</div>' : ''}
</body></html>`;
}

(async () => {
  const want = process.argv[2];
  const todo = want ? ASSETS.filter((a) => a.id === want) : ASSETS;
  if (!todo.length) throw new Error(`no such asset '${want}'`);
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = await import('playwright-core');
  const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ['--no-sandbox'] });
  for (const a of todo) {
    const page = await browser.newPage({ viewport: { width: a.w, height: a.h } });
    await page.setContent(html(a), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // assert, never assume: the first renders shipped fallback type over missing plates
    const ok = await page.evaluate(() => document.fonts.check("600 84px 'Oswald'"));
    if (!ok) throw new Error(`${a.id}: Oswald did not load`);
    const out = path.join(OUT, `${a.id}.png`);
    await page.screenshot({ path: out });
    console.log(`  ✓ ${path.relative(ROOT, out)} — ${a.w}×${a.h}`);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
