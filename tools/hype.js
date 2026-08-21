// OMERTÀ — launch hype video builder. See HYPE.md.
//
//   FAL_KEY=… node tools/hype.js --fal       → generate the Seedance 2.5 motion library (parallel,
//                                              capped, per-clip aspect) then build ALL cuts
//   node tools/hype.js --all                 → rebuild all 5 from the library (no spend)
//   node tools/hype.js --cut streets         → rebuild one
//   …--music track.mp3                       → use a real track instead of the synth bed
//   node tools/hype.js                       → free Ken-Burns montage from the stills (no key)
//
// The library (public/art/hype/<plate>[__9x16].mp4) is Seedance 2.5 image-to-video of the game's own
// noir plates — real camera + scene motion. Landscape cuts use 16:9 sources; the vertical short uses
// 9:16 sources generated natively (no cropping). Jobs run in PARALLEL with a hard --cap + a ledger.
// Every cut is a FAST edit of the shared library, so the videos cost ONE round of generation.
//
// COPY: the founder lifted the no-earnings rule (2026-08-14) and asked for earnings + the $OMR value
// flywheel. Copy is mechanism-true and number-free. Founder signs the wording + a licensed track.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'public', 'art');
const LIB = path.join(ART, 'hype');
const TMP = path.join(ROOT, '.hype-tmp');
const FONT = '/mnt/skills/examples/canvas-design/canvas-fonts/BigShoulders-Bold.ttf';

function resolveFF() {
  for (const p of [() => require('ffmpeg-static'), () => require('/tmp/ffbin/node_modules/ffmpeg-static')]) {
    try { const b = p(); if (b && fs.existsSync(b)) return b; } catch { /* next */ }
  }
  try { return execFileSync('bash', ['-lc', 'command -v ffmpeg'], { encoding: 'utf8' }).trim() || 'ffmpeg'; }
  catch { return 'ffmpeg'; }
}
const FF = resolveFF();
const { Resvg } = require('@resvg/resvg-js');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const FPS = 30;

// ── the motion library: one prompt per plate (the aspect is decided per-cut, below) ───────────────
const NOIR = 'cinematic film-noir, 1940s, moody amber and teal lighting, volumetric fog, rain, wet '
  + 'cobblestones, deep shadows, 35mm film grain, no on-screen text, no added logos, no watermark';
const LIBRARY = {
  'hero-poster':        `a man in a fedora and long coat strides toward camera through pouring rain, coat flaring, neon reflections rippling on wet cobblestones, slow menacing dolly-in, ${NOIR}`,
  'hero-backdrop':      `heavy rain pours on an empty noir street, a lone silhouetted figure far down the block under a streetlamp, slow push-in, ${NOIR}`,
  'district-neon':      `neon signs buzz and flicker, a car's headlights sweep across the wet street, steam rising from a grate, slow lateral tracking shot, ${NOIR}`,
  'district-docks':     `thick fog rolls across the harbour docks at night, black water rippling, a lantern swaying on a post, slow drift, ${NOIR}`,
  'citymap':            `an old noir map of the city under lamplight, ink and shadow spreading across districts, slow pull-back, ${NOIR}`,
  'crest':              `candle flames flicker over an ornate wax family crest on dark wood, smoke curling, slow ominous push-in, ${NOIR}`,
  'interior-speakeasy': `a smoky prohibition speakeasy, a jazz band silhouetted on a small stage, patrons drinking at the bar, warm lamplight, slow drifting camera, ${NOIR}`,
  'interior-market':    `a bustling 1940s black-market bazaar under strings of bare bulbs, figures haggling in the haze, crates of contraband, slow drifting camera, ${NOIR}`,
  'interior-den':       `cigarette smoke curls up under a low hanging lamp over a card table, chips glinting, tense stillness, slow creeping push-in, ${NOIR}`,
  'interior-empire':    `a mob boss's opulent office, cigar smoke curling in lamplight, a tall leather chair, city lights beyond rain-streaked windows, slow push-in, ${NOIR}`,
  'interior-estate':    `a grand opulent estate hall bathed in warm golden light, dust motes drifting, slow reveal dolly-back, ${NOIR}`,
  'interior-law':       `a shadowy 1940s courtroom, dust and hard shafts of light, an empty judge's bench looming, tense, slow dolly-in, ${NOIR}`,
  'crime-armored':      `a nighttime armored-car robbery, headlights cutting through the rain, figures moving fast across the street, tension, handheld push-in, ${NOIR}`,
  'crime-torch':        `arson — flames leap and roil, thick black smoke billowing, embers drifting up, orange firelight flickering, handheld camera, ${NOIR}`,
  'crime-vaultjob':     `a bank vault heist, a heavy steel vault door swinging open, torchlight sweeping across stacked cash and gold bars, slow push-in, ${NOIR}`,
  'crime-counting':     `gloved hands counting thick stacks of cash under a desk lamp, bills riffling, cigarette smoke curling, slow push-in, ${NOIR}`,
  'crime-mint':         `freshly printed banknotes rolling off a press in an underground counterfeiting mint, ink and machinery turning, slow push-in, ${NOIR}`,
  'crime-diamond':      `a jewel heist — a gloved hand lifts a glittering diamond necklace off black velvet under a hard spotlight, slow push-in, ${NOIR}`,
  'heist-goldvault':    `a vault full of stacked gold bars gleaming under a swinging worklight, a figure's long shadow, slow push-in, ${NOIR}`,
  'hitman-professional':`a sharply dressed assassin in shadow deliberately screws a silencer onto a pistol, cold and unhurried, slow push-in, ${NOIR}`,
  'hitman-legbreaker':  `a menacing enforcer steps forward out of deep shadow, fists clenching, dramatic push-in, threatening, ${NOIR}`,
  'car-spectre':        `a sleek black 1940s sedan idles on a wet street at night, exhaust smoke drifting, neon reflections rippling across the hood, slow tracking shot, ${NOIR}`,
  'car-sovereign':      `a gleaming luxury 1940s limousine at the curb outside a lit hotel at night, rain beading on polished black paint, a doorman silhouette, slow tracking shot, ${NOIR}`,
  'outfit-kryl':        `a brutal crime syndicate crew in dark coats emerge from the fog under harbour lights, menacing, slow push-in, ${NOIR}`,
  'outfit-volkov':      `a menacing crew of mobsters in coats and hats stand in the fog under a streetlamp, cigarette smoke, slow push-in, threatening, ${NOIR}`,
  'npc-madame':         `a glamorous 1940s femme fatale slowly exhales cigarette smoke in a dim lounge, a catchlight in her eyes, slow push-in, ${NOIR}`,
};

// ── the cuts: each carries its own aspect + a mostly-distinct footage set ─────────────────────────
// shot = { p: plate, use: seconds shown, off: start offset, sub|title|cta: copy }
const VIDEOS = {
  // 1 — THE CITY: the cinematic trailer, atmosphere/world
  hype: { w: 1920, h: 1080, ar: '16:9', shots: [
    { p: 'hero-poster',       use: 1.9, off: 0.3 },
    { p: 'district-neon',     use: 1.8, off: 0.6, sub: 'A CITY THAT RUNS ON SILENCE' },
    { p: 'interior-speakeasy',use: 1.7, off: 0.6, sub: 'EVERYBODY OWES SOMEBODY' },
    { p: 'district-docks',    use: 1.5, off: 0.8 },
    { p: 'interior-market',   use: 1.7, off: 0.6, sub: 'BUILD AN EMPIRE' },
    { p: 'citymap',           use: 1.6, off: 0.7, sub: 'TAKE THE CITY' },
    { p: 'hero-backdrop',     use: 3.0, off: 0.5, title: 'OMERTÀ', cta: 'enter the city — omerta.fun' },
  ] },
  // 2 — THE STREETS: crime/action, high energy, its own footage
  streets: { w: 1920, h: 1080, ar: '16:9', shots: [
    { p: 'hitman-professional', use: 1.6, off: 0.6, sub: 'EVERY JOB HAS A PRICE' },
    { p: 'crime-armored',       use: 1.5, off: 0.5, sub: 'PULL THE SCORE' },
    { p: 'crime-torch',         use: 1.4, off: 0.4, sub: 'BURN THE EVIDENCE' },
    { p: 'car-spectre',         use: 1.5, off: 0.6 },
    { p: 'crime-vaultjob',      use: 1.6, off: 0.5, sub: 'CRACK THE VAULT' },
    { p: 'hitman-legbreaker',   use: 1.5, off: 0.6, sub: 'EVERY STREET REMEMBERS' },
    { p: 'hero-backdrop',       use: 2.8, off: 0.5, title: 'OMERTÀ', cta: 'one life · no respawns' },
  ] },
  // 3 — THE FLYWHEEL: the protocol, mechanism-true, money footage
  flywheel: { w: 1920, h: 1080, ar: '16:9', shots: [
    { p: 'crime-counting',   use: 2.0, off: 0.5, sub: '$OMR ISN’T PRINTED' },
    { p: 'crime-mint',       use: 2.0, off: 0.5, sub: 'IT’S BOUGHT — WITH REAL MONEY' },
    { p: 'interior-den',     use: 2.0, off: 0.7, sub: 'EVERY SINK BUYS $OMR OFF THE MARKET' },
    { p: 'interior-empire',  use: 2.1, off: 0.5, sub: 'BUYBACKS FUND THE PLAYERS WHO PLAY' },
    { p: 'heist-goldvault',  use: 2.0, off: 0.5, sub: 'SPENDERS FUND EARNERS' },
    { p: 'crest',            use: 2.0, off: 0.6, sub: 'A REAL ECONOMY. A REAL FLYWHEEL.' },
    { p: 'hero-backdrop',    use: 3.0, off: 0.5, title: 'OMERTÀ', cta: '$OMR · omerta.fun' },
  ] },
  // 4 — RISK TO EARN: extraction/wealth, its own footage
  earn: { w: 1920, h: 1080, ar: '16:9', shots: [
    { p: 'hero-poster',      use: 1.7, off: 0.3, sub: 'PLAY. TAKE RISKS.' },
    { p: 'crime-diamond',    use: 1.6, off: 0.5, sub: 'TAKE IT OFF SOMEBODY WHO DIDN’T' },
    { p: 'interior-law',     use: 1.7, off: 0.5, sub: 'EVERY $OMR IS REAL' },
    { p: 'car-sovereign',    use: 1.6, off: 0.6, sub: 'SPEND IT. FLAUNT IT.' },
    { p: 'interior-estate',  use: 1.8, off: 0.6, sub: 'TURN THE STREETS INTO A LIVING' },
    { p: 'outfit-volkov',    use: 1.6, off: 0.5, sub: 'OR LOSE IT ALL' },
    { p: 'hero-backdrop',    use: 2.9, off: 0.5, title: 'OMERTÀ', cta: 'risk to earn — omerta.fun' },
  ] },
  // 5 — VERTICAL SHORT: social, punchy, native 9:16, faces + fire + cash
  short: { w: 1080, h: 1920, ar: '9:16', shots: [
    { p: 'outfit-volkov',       use: 1.5, off: 0.5, sub: 'TRUST NO ONE.' },
    { p: 'hitman-professional', use: 1.4, off: 0.6, sub: 'ONE LIFE.' },
    { p: 'crime-torch',         use: 1.3, off: 0.4, sub: 'NO RESPAWNS.' },
    { p: 'crime-counting',      use: 1.4, off: 0.5, sub: 'REAL MONEY.' },
    { p: 'interior-estate',     use: 1.5, off: 0.6, sub: 'TAKE IT OFF SOMEBODY.' },
    { p: 'hero-backdrop',       use: 2.6, off: 0.5, title: 'OMERTÀ', cta: 'omerta.fun' },
  ] },
  // 6 — THE MONEY MAP: the fees/flows EXPLAINER (founder-directed 2026-08-21). Longer and slower
  // than the hype cuts — it WALKS the whole economy rather than teasing it. The scene list is the
  // money router's own waterfall (src/router.js — every live inflow source), then the $OMR demand
  // loop, then the RWA arc (treasury → ticker ballot → stock buys → play-weighted broker splits →
  // Street Deed vaults). The one declared source deliberately OMITTED is `trade` — it is RETIRED
  // (the sell tax is the one hook), and marketing a dead flow would be the empty-state honesty rule
  // broken on film. Copy is mechanism-true + number-free (the HYPE.md rule): no bps, no prices, no
  // value-per-$OMR figure; the closer states extraction opens at launch (the rail is not open yet).
  money: { w: 1920, h: 1080, ar: '16:9', shots: [
    { p: 'hero-poster',      use: 2.4, off: 0.3, sub: 'EVERY DOLLAR IN THIS CITY IS ON THE BOOKS',
      sub2: 'the full money map — nothing moves off the ledger' },
    // ═══ ACT I — the eight live inflows (router waterfall order) ═══
    { p: 'citymap',          use: 2.2, off: 0.6, kicker: 'I · WHERE REAL MONEY COMES IN' },
    { p: 'crest',            use: 2.8, off: 0.5, sub: 'GETTING MADE COSTS REAL ETH',
      sub2: 'identity fees on a published schedule — nobody skips the toll' },
    { p: 'interior-store',   use: 2.8, off: 0.5, sub: 'THE STORE SELLS FOR ETH',
      sub2: 'cosmetics · access · consumables — never power' },
    { p: 'crime-bonds',      use: 2.8, off: 0.5, sub: 'RESERVE BONDS RAISE ETH',
      sub2: 'discounted $OMR, vested — the only spigot that mints supply' },
    { p: 'interior-trade',   use: 2.8, off: 0.5, sub: 'EVERY $OMR SELL PAYS THE TAX',
      sub2: 'taken inside the swap — collected in ETH' },
    { p: 'interior-market',  use: 2.8, off: 0.5, sub: 'THE DESK AUCTIONS $OMR DAILY',
      sub2: 'a falling-price auction over recycled supply — paid in ETH' },
    { p: 'district-canal',   use: 2.8, off: 0.6, sub: 'THE HOUSE POOL EARNS TRADING FEES',
      sub2: 'protocol-owned liquidity — depth the game itself provides' },
    { p: 'crime-depository', use: 2.8, off: 0.5, sub: 'THE BANK TAKES A CUT OF YIELD',
      sub2: 'a performance fee on protocol profit' },
    { p: 'boat-freighter',   use: 2.8, off: 0.5, sub: 'CASHING OUT PAYS AN EXIT TOLL',
      sub2: 'and fresh tokens pay a surcharge to leave early' },
    // ═══ ACT II — where it goes: the four destinations + the $OMR demand loop ═══
    { p: 'heist-goldvault',  use: 2.2, off: 0.5, kicker: 'II · WHERE IT GOES' },
    { p: 'interior-empire',  use: 2.8, off: 0.5, sub: 'FOUR DESTINATIONS, ALL DECLARED',
      sub2: 'the vig · the treasury · liquidity · operations — every split published' },
    { p: 'crime-counting',   use: 2.8, off: 0.5, sub: 'THE VIG BUYS $OMR OFF THE MARKET',
      sub2: 'real revenue → the withdrawal reserve + the prize pool' },
    { p: 'interior-law',     use: 2.8, off: 0.5, sub: 'EXTRACTION NEVER EXCEEDS INFLOW',
      sub2: 'a full-reserve queue — it signs only what revenue backed' },
    { p: 'crime-mint',       use: 2.8, off: 0.5, sub: 'THE MONEY PRINTER IS RETIRED',
      sub2: 'no wage, no emission schedule — supply enters by being bought' },
    { p: 'crime-laundry',    use: 2.8, off: 0.5, sub: 'CASH CAN NEVER BUY $OMR',
      sub2: 'the one conversion runs the other way — grinding can’t inflate the token' },
    { p: 'interior-den',     use: 2.8, off: 0.7, sub: 'EVERY SINK LANDS BACK ON THE DESK',
      sub2: 'dues · the compound · seals · intel · vanity — resold at tomorrow’s auction' },
    { p: 'interior-family',  use: 2.8, off: 0.5, sub: 'FAMILY BUYBACKS PAY THE TOP FAMILIES',
      sub2: 'a community cut buys $OMR for the seasonal family pool' },
    { p: 'cine-payday',      use: 2.8, off: 0.5, sub: 'BANK PROFIT PAYS THE PLAYERS WHO PLAY',
      sub2: 'bought $OMR, split by real activity — money alone takes nothing' },
    { p: 'estate-4',         use: 2.8, off: 0.5, sub: 'POWER KEYS ON HELD $OMR',
      sub2: 'stake it for rank — and staked wealth is lootable. risk is the point' },
    // ═══ ACT III — the RWA arc: play accumulates real-world assets ═══
    { p: 'estate-6',         use: 2.2, off: 0.5, kicker: 'III · REAL-WORLD ASSETS' },
    { p: 'interior-legit',   use: 2.8, off: 0.5, sub: 'THE TREASURY STACKS ETH',
      sub2: 'its slice of every fee, bond, sell and yield' },
    { p: 'crime-ballot',     use: 2.8, off: 0.5, sub: 'THE FAMILIES VOTE THE TICKER',
      sub2: 'the commission picks the day’s stock' },
    { p: 'crime-ticker',     use: 2.8, off: 0.5, sub: 'THE TREASURY BUYS TOKENIZED STOCK',
      sub2: 'real fills only, behind hard price walls' },
    { p: 'interior-streets', use: 2.8, off: 0.5, sub: 'YOUR SHARE IS EARNED BY PLAYING',
      sub2: 'activated brokers split every buy by activity — idle money takes nothing' },
    { p: 'district-brick',   use: 2.8, off: 0.5, sub: 'DELIVERED INTO YOUR STREET’S VAULT',
      sub2: 'the deed is an NFT — sell the street, the book travels with it' },
    { p: 'heist-vault',      use: 2.8, off: 0.5, sub: 'OR BURN $OMR FOR TREASURY ETH',
      sub2: 'the vault only ever owes what it already holds' },
    { p: 'hero-backdrop',    use: 3.4, off: 0.5, title: 'OMERTÀ',
      cta: 'the ledger is public · extraction opens at launch · omerta.fun' },
  ] },
};

// a clip file is (plate, aspect) — 16:9 sources and 9:16 sources are distinct renders
const clipFile = (plate, ar) => path.join(LIB, ar === '9:16' ? `${plate}__9x16.mp4` : `${plate}.mp4`);
function neededClips() {
  const seen = new Map(); // key `${plate}|${ar}` → {plate, ar}
  for (const v of Object.values(VIDEOS)) for (const s of v.shots) {
    const k = `${s.p}|${v.ar}`;
    if (!seen.has(k)) seen.set(k, { plate: s.p, ar: v.ar });
  }
  return [...seen.values()];
}

// ── title cards (SVG → PNG, transparent, display font), scaled to the cut ─────────────────────────
function titlePng(shot, i, w, h) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const portrait = h > w;
  const titleSize = Math.round(w * (portrait ? 0.14 : 0.10));
  const subSize   = Math.round(w * (portrait ? 0.058 : 0.034));
  const ctaSize   = Math.round(w * (portrait ? 0.034 : 0.022));
  // a soft dark halo + crisp offset shadow behind each line so cream text always reads over bright
  // footage (resvg draws feGaussianBlur reliably; no filter → no legibility guarantee).
  const dy = Math.round(subSize * 0.05) + 2;
  const line = (x, y, size, ls, fill, str) => {
    const t = (fillc, ex, ey) => `<text x="${x + ex}" y="${y + ey}" font-family="Big Shoulders" font-weight="700"
      font-size="${size}" letter-spacing="${ls}" fill="${fillc}" text-anchor="middle">${esc(str)}</text>`;
    return `<g filter="url(#glow)">${t('#000', 0, 0)}</g>${t('#000', 0, dy)}${t(fill, 0, 0)}`;
  };
  let body = '';
  if (shot.title) {
    body += line(w / 2, h / 2 + titleSize * 0.2, titleSize, titleSize * 0.09, '#f4efe6', shot.title);
    if (shot.cta) body += line(w / 2, h / 2 + titleSize * 0.75, ctaSize, ctaSize * 0.25, '#c9a24b', shot.cta.toUpperCase());
  } else if (shot.kicker) {
    // an ACT HEADER for the explainer cut — centered, between the sub and the title in weight, with
    // a small gold overline so a chapter card reads as structure rather than as another caption.
    const kSize = Math.round(w * 0.052);
    body += line(w / 2, h / 2 - kSize * 0.55, ctaSize, ctaSize * 0.3, '#c9a24b', 'THE MONEY MAP');
    body += line(w / 2, h / 2 + kSize * 0.45, kSize, kSize * 0.07, '#f4efe6', shot.kicker);
  } else if (shot.sub) {
    const y = portrait ? h * 0.72 : h - Math.round(h * 0.13);
    // sub2 is the explainer's DETAIL line — the mechanism under the headline. The headline shifts up
    // just enough to make room; a sub-only shot renders exactly as before.
    const lift = shot.sub2 ? Math.round(subSize * 0.85) : 0;
    body += line(w / 2, y - lift, subSize, subSize * 0.06, '#f4efe6', shot.sub);
    if (shot.sub2) body += line(w / 2, y - lift + Math.round(subSize * 0.95), Math.round(subSize * 0.62), subSize * 0.04, '#c9a24b', shot.sub2);
  } else return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${Math.round(subSize * 0.18)}"/></filter></defs>${body}</svg>`;
  const png = new Resvg(svg, { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Big Shoulders' } })
    .render().asPng();
  const p = path.join(TMP, `title-${i}.png`);
  fs.writeFileSync(p, png);
  return p;
}

// ── one shot → a silent clip: trim the liveliest window, fill the cut frame, burn the title ───────
function shotClip(shot, i, v) {
  const src = clipFile(shot.p, v.ar), w = v.w, h = v.h;
  const out = path.join(TMP, `fx-${String(i).padStart(2, '0')}.mp4`);
  const title = titlePng(shot, i, w, h);
  const tOut = Math.max(0.4, shot.use - 0.45);
  // Seedance keeps the (landscape) source aspect regardless of the requested ratio. Cover-crop fills
  // the whole frame in every case: a landscape cut is a near no-op; the portrait short crops the wide
  // frame to its centre — which is where the noir plates put the subject, so it reads full-bleed and
  // premium on a phone (a blur-fill of this near-black footage just leaves it floating in black bars).
  const fitv = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  let inputs, fc;
  if (fs.existsSync(src)) {
    const base = `[0:v]trim=${shot.off}:${(shot.off + shot.use).toFixed(2)},setpts=PTS-STARTPTS,${fitv},fps=${FPS},format=yuv420p`;
    inputs = ['-i', src];
    if (title) { inputs.push('-loop', '1', '-t', String(shot.use), '-i', title);
      fc = `${base}[bg];[1:v]format=rgba,fade=in:st=0:d=0.3:alpha=1,fade=out:st=${tOut}:d=0.35:alpha=1[t];[bg][t]overlay=0:0[v]`;
    } else fc = `${base}[v]`;
  } else { // fallback: a gentle push on the still plate
    const plate = path.join(ART, `${shot.p}.jpg`), frames = Math.round(shot.use * FPS);
    const kb = `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},`
      + `zoompan=z='min(1.0+0.0022*on,1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS},format=yuv420p`;
    inputs = ['-loop', '1', '-t', String(shot.use), '-i', plate];
    if (title) { inputs.push('-loop', '1', '-t', String(shot.use), '-i', title);
      fc = `[0:v]${kb}[bg];[1:v]format=rgba,fade=in:st=0:d=0.3:alpha=1,fade=out:st=${tOut}:d=0.35:alpha=1[t];[bg][t]overlay=0:0[v]`;
    } else fc = `[0:v]${kb}[v]`;
  }
  execFileSync(FF, ['-y', ...inputs, '-filter_complex', fc, '-map', '[v]', '-an',
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', out],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  return { clip: out, sec: shot.use };
}

// ── stitch (hard cuts) + a driving synth bed, or a licensed track ─────────────────────────────────
function assembleCut(clips, out, music) {
  const total = clips.reduce((a, c) => a + c.sec, 0);
  const listFile = path.join(TMP, `list-${path.basename(out, '.mp4')}.txt`);
  fs.writeFileSync(listFile, clips.map((c) => `file '${c.clip}'`).join('\n'));
  const D = total.toFixed(3), titleAt = total - clips[clips.length - 1].sec, titleMs = Math.round(titleAt * 1000);
  const vin = ['-f', 'concat', '-safe', '0', '-i', listFile];
  let ain, fc, amap;
  if (music) {
    // the licensed track is the BED; a synth riser builds into the title and a sub-bass IMPACT slams
    // on the reveal — the classic trailer "music bed + logo BRAAAM", so every cut lands a payoff even
    // when the track's own dynamics don't. Input 0 = concat video; 1 = track; 2 = riser; 3 = impact.
    const riseStart = Math.max(0, titleAt - 2.2).toFixed(3);
    // -stream_loop: the beds are 60s and the explainer cut runs longer — loop the track and let the
    // atrim below cut it to the video's own length (a no-op for the short cuts).
    ain = ['-stream_loop', '-1', '-i', music,
      '-f', 'lavfi', '-i', `anoisesrc=d=${D}:color=pink:amplitude=1`,
      '-f', 'lavfi', '-i', `aevalsrc='0.95*sin(2*PI*44*t)*exp(-2.0*t)+0.6*sin(2*PI*88*t)*exp(-3.2*t)':d=${D}:s=44100`];
    fc = `[1:a]loudnorm=I=-15:TP=-1.2:LRA=11,afade=in:st=0:d=0.5,afade=out:st=${(total - 1.2).toFixed(3)}:d=1.2,atrim=0:${D},asetpts=N/SR/TB[bed];`
      + `[2]highpass=f=700,volume='0.02+0.6*clip((t-${riseStart})/2.2,0,1)':eval=frame,afade=out:st=${titleAt.toFixed(3)}:d=0.25[riser];`
      + `[3]adelay=${titleMs}|${titleMs},lowpass=f=220,volume=1.15[hit];`
      + `[bed][riser][hit]amix=inputs=3:normalize=0,acompressor=threshold=0.12:ratio=5:attack=6:release=140,alimiter=limit=0.96[a]`;
    amap = '[a]';
  } else {
    // input 0 is the concat VIDEO; the lavfi audio sources are inputs 1..4.
    ain = ['-f', 'lavfi', '-i', `aevalsrc='0.9*sin(2*PI*55*t)*exp(-11*mod(t,0.5))':d=${D}:s=44100`,
      '-f', 'lavfi', '-i', `sine=frequency=41:duration=${D}`,
      '-f', 'lavfi', '-i', `anoisesrc=d=${D}:color=pink:amplitude=1`,
      '-f', 'lavfi', '-i', `aevalsrc='0.95*sin(2*PI*44*t)*exp(-2.2*t)':d=${D}:s=44100`];
    fc = `[1]volume=0.55[k];`
      + `[2]volume=0.12,tremolo=f=2:d=0.4[sub];`
      + `[3]highpass=f=900,volume='0.03+0.5*clip((t-(${D}-4))/4,0,1)':eval=frame[riser];`
      + `[4]adelay=${titleMs}|${titleMs},lowpass=f=200,volume=1.1[hit];`
      + `[k][sub][riser][hit]amix=inputs=4:normalize=0,acompressor=threshold=0.15:ratio=6:attack=5:release=120,`
      + `afade=in:st=0:d=0.3,afade=out:st=${(total - 1.2).toFixed(3)}:d=1.2,alimiter=limit=0.95[a]`;
    amap = '[a]';
  }
  execFileSync(FF, ['-y', ...vin, ...ain, '-filter_complex', fc, '-map', '0:v', '-map', amap,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', D, out],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  return total;
}

function buildCut(id, music) {
  const v = VIDEOS[id];
  if (!v) throw new Error(`unknown cut '${id}' — one of: ${Object.keys(VIDEOS).join(', ')}`);
  fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
  let missing = 0;
  const clips = v.shots.map((s, i) => { if (!fs.existsSync(clipFile(s.p, v.ar))) missing++; return shotClip(s, i, v); });
  const out = path.join(ART, id === 'hype' ? 'hype.mp4' : `hype-${id}.mp4`);
  const total = assembleCut(clips, out, music);
  fs.rmSync(TMP, { recursive: true, force: true });
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`  ✓ ${path.relative(ROOT, out)} — ${v.w}×${v.h}, ${total.toFixed(1)}s, ${kb} KB${missing ? `  (⚠ ${missing} still-fallback)` : ''}`);
  return out;
}

// ── the fal.ai Seedance 2.5 image-to-video library (real motion; needs FAL_KEY) ───────────────────
const FAL_VIDEO_MODEL = process.env.FAL_VIDEO_MODEL || 'bytedance/seedance-2.5/image-to-video';
const FAL_BASE = FAL_VIDEO_MODEL.split('/').slice(0, 2).join('/');   // → bytedance/seedance-2.5
const FAL_RES = process.env.FAL_RES || '720p';
const PUBLIC = (process.env.PUBLIC_URL || 'https://www.omerta.fun').replace(/\/$/, '');
const EST_PER = Number(process.env.FAL_EST_PER || '2.37');           // Seedance 2.5 720p ~5s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function falRun() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set — the --fal path needs a fal.ai key + a budget.');
  const cap = Number(opt('--cap', '150'));
  const H = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  fs.mkdirSync(LIB, { recursive: true });
  const ledger = path.join(LIB, 'hype-manifest.json');
  const man = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { model: FAL_VIDEO_MODEL, spentUsd: 0, clips: [] };
  const need = neededClips().filter((c) => !fs.existsSync(clipFile(c.plate, c.ar)));
  const todo = [];
  for (const c of need) {
    if (man.spentUsd + (todo.length + 1) * EST_PER > cap) { console.log(`cap $${cap} would be exceeded — stopping at ${c.plate}/${c.ar}`); break; }
    todo.push(c);
  }
  console.log(`${neededClips().length - need.length} clips in hand; queueing ${todo.length} on ${FAL_VIDEO_MODEL} @ ${FAL_RES} (est +$${(todo.length * EST_PER).toFixed(2)}, cap $${cap})`);
  const jobs = [];
  for (const c of todo) {
    const body = { image_url: `${PUBLIC}/art/${c.plate}.jpg`, prompt: LIBRARY[c.plate] || `slow cinematic camera move, ${NOIR}`,
      resolution: FAL_RES, aspect_ratio: c.ar, duration: '5', generate_audio: false };
    const r = await fetch(`https://queue.fal.run/${FAL_VIDEO_MODEL}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || !j.request_id) throw new Error(`fal submit ${c.plate}/${c.ar}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    jobs.push({ c, id: j.request_id, done: false });
    console.log(`  queued ${c.plate} ${c.ar} (${j.request_id})`);
  }
  let pending = jobs.length;
  for (let round = 0; pending && round < 120; round++) {
    await sleep(15000);
    for (const job of jobs) {
      if (job.done) continue;
      const rr = await fetch(`https://queue.fal.run/${FAL_BASE}/requests/${job.id}`, { headers: H });
      if (rr.status === 200) {
        const j = await rr.json();
        const url = j?.video?.url || j?.videos?.[0]?.url;
        if (url) {
          fs.writeFileSync(clipFile(job.c.plate, job.c.ar), Buffer.from(await (await fetch(url)).arrayBuffer()));
          man.spentUsd += EST_PER; man.clips.push({ plate: job.c.plate, ar: job.c.ar, url, est: EST_PER });
          fs.writeFileSync(ledger, JSON.stringify(man, null, 2));
          job.done = true; pending--;
          console.log(`  ✓ ${job.c.plate} ${job.c.ar}  (${pending} left, ~$${man.spentUsd.toFixed(2)})`);
        }
      }
    }
    if (pending) process.stdout.write(`  … ${pending} still rendering (round ${round + 1})\n`);
  }
  if (pending) console.log(`⚠ ${pending} clip(s) never finished — building with what landed.`);
  console.log(`spent ~$${man.spentUsd.toFixed(2)} of $${cap}.\n`);
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const music = opt('--music', null);
  if (flag('--fal')) await falRun();
  const which = opt('--cut', null);
  if (which) { buildCut(which, music); return; }
  if (flag('--fal') || flag('--all')) {
    console.log('building cuts from the library:');
    for (const id of Object.keys(VIDEOS)) buildCut(id, music);
    console.log('\nWATCH each before it ships. Founder signs wording + a licensed track.');
    return;
  }
  console.log('no --fal/--all/--cut — building the free montage (stills) → hype.mp4');
  const v = VIDEOS.hype;
  fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
  const clips = v.shots.map((s, i) => shotClip(s, i, v));
  const total = assembleCut(clips, path.join(ART, 'hype.mp4'), music);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`✓ hype.mp4 — ${total.toFixed(1)}s. (montage; run --fal for real motion + all 5 cuts.)`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
