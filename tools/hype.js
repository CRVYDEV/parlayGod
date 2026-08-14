// OMERTÀ — launch hype video builder. See HYPE.md.
//
//   node tools/hype.js                      → the free Ken-Burns montage (no key, no spend) → hype.mp4
//   FAL_KEY=… node tools/hype.js --fal       → generate the real-motion clip library (parallel, capped),
//                                              then build ALL cuts (hype / flywheel / earn / short)
//   node tools/hype.js --all                 → rebuild all cuts from the already-downloaded library
//   node tools/hype.js --cut flywheel        → rebuild one cut
//   …--music track.mp3                       → swap the placeholder synth bed for a licensed track
//
// The library (public/art/hype/<plate>.mp4) is Kling image-to-video of the game's own noir plates —
// real camera + scene motion. Every cut is a FAST edit (short shots, hard cuts, a driving bed) built
// from that shared library, so 3–4 videos cost ONE round of generation.
//
// COPY: the founder lifted the no-earnings rule (2026-08-14) and asked for earnings + the $OMR value
// flywheel. Copy is MECHANISM-TRUE (spenders fund earners; every token was bought with real money;
// buybacks from real revenue; no faucet) and carries NO fabricated numbers (no "$X/day", no "10×").
// The founder signs the exact wording + a licensed track before anything ships publicly.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'public', 'art');
const LIB = path.join(ART, 'hype');            // the fal clip library
const TMP = path.join(ROOT, '.hype-tmp');
const FONT = '/mnt/skills/examples/canvas-design/canvas-fonts/BigShoulders-Bold.ttf';

// ffmpeg-static may live in the project node_modules OR a side-installed prefix; fall back to PATH.
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

// ── the motion library: one Kling i2v clip per plate, with the prompt that gives it life ──────────
const NOIR = 'cinematic film-noir, 1940s, moody amber and teal lighting, volumetric fog, rain, wet '
  + 'cobblestones, deep shadows, 35mm film grain, no on-screen text, no added logos, no watermark';
const LIBRARY = {
  'hero-poster':       `a man in a fedora and long coat strides toward camera through pouring rain, coat flaring, neon reflections rippling on wet cobblestones, slow menacing dolly-in, ${NOIR}`,
  'district-neon':     `neon signs buzz and flicker, a car's headlights sweep across the wet street, steam rising from a grate, slow lateral tracking shot, ${NOIR}`,
  'interior-kitchen':  `steam and haze drift through a clandestine kitchen, a shadowed figure works in the background, flickering bulb, slow push-in, ${NOIR}`,
  'interior-den':      `cigarette smoke curls up under a low hanging lamp over a card table, chips glinting, tense stillness, slow creeping push-in, ${NOIR}`,
  'hitman-legbreaker': `a menacing enforcer steps forward out of deep shadow, fists clenching, dramatic push-in, threatening, ${NOIR}`,
  'district-docks':    `thick fog rolls across the harbour docks at night, black water rippling, a lantern swaying on a post, slow drift, ${NOIR}`,
  'crest':             `candle flames flicker over an ornate wax family crest on dark wood, smoke curling, slow ominous push-in, ${NOIR}`,
  'interior-estate':   `a grand opulent estate hall bathed in warm golden light, dust motes drifting, slow reveal dolly-back, ${NOIR}`,
  'interior-pen':      `a cold prison cell, a guard's shadow sweeps across the iron bars, a flickering fluorescent tube, bleak, slow push-in, ${NOIR}`,
  'citymap':           `an old noir map of the city under lamplight, ink and shadow spreading across districts, slow pull-back, ${NOIR}`,
  'hero-backdrop':     `heavy rain pours on an empty noir street, a lone silhouetted figure far down the block under a streetlamp, slow push-in, ${NOIR}`,
};

// ── the cuts: each references the shared library; copy carries earnings + the $OMR flywheel ───────
// shot = { p: plate, use: seconds shown, off: start offset into the 5s clip, sub|title|cta: copy }
const VIDEOS = {
  // 1 — the cinematic trailer: world first, earnings closer
  hype: { w: 1920, h: 1080, fit: 'pad', shots: [
    { p: 'hero-poster',       use: 1.9, off: 0.2 },
    { p: 'district-neon',     use: 1.8, off: 0.6, sub: 'A CITY THAT RUNS ON SILENCE' },
    { p: 'interior-kitchen',  use: 1.5, off: 0.7, sub: 'BUILD AN EMPIRE' },
    { p: 'interior-den',      use: 1.5, off: 0.7, sub: 'OR BLEED FOR ONE' },
    { p: 'hitman-legbreaker', use: 1.5, off: 0.5, sub: 'EVERY STREET REMEMBERS' },
    { p: 'interior-pen',      use: 1.7, off: 0.5, sub: 'ONE LIFE · NO RESPAWNS' },
    { p: 'interior-estate',   use: 1.8, off: 0.6, sub: 'EVERY DOLLAR IS REAL' },
    { p: 'citymap',           use: 1.6, off: 0.7, sub: 'TAKE IT OFF SOMEBODY' },
    { p: 'hero-backdrop',     use: 3.0, off: 0.4, title: 'OMERTÀ', cta: 'enter the city — omerta.fun' },
  ] },
  // 2 — the flywheel: the protocol, mechanism-true
  flywheel: { w: 1920, h: 1080, fit: 'pad', shots: [
    { p: 'hero-poster',      use: 2.0, off: 0.2, sub: '$OMR ISN’T PRINTED' },
    { p: 'district-neon',    use: 2.0, off: 0.6, sub: 'IT’S BOUGHT — WITH REAL MONEY' },
    { p: 'interior-den',     use: 2.2, off: 0.7, sub: 'EVERY SINK BUYS $OMR OFF THE MARKET' },
    { p: 'crest',            use: 2.1, off: 0.6, sub: 'BUYBACKS FROM REAL REVENUE' },
    { p: 'interior-estate',  use: 2.2, off: 0.6, sub: 'FUND THE PLAYERS WHO PLAY' },
    { p: 'interior-kitchen', use: 2.1, off: 0.7, sub: 'SPENDERS FUND EARNERS' },
    { p: 'citymap',          use: 2.2, off: 0.7, sub: 'MORE PLAYERS · MORE VOLUME · MORE DEMAND' },
    { p: 'district-docks',   use: 2.0, off: 0.8, sub: 'A REAL ECONOMY. A REAL FLYWHEEL.' },
    { p: 'hero-backdrop',    use: 3.0, off: 0.4, title: 'OMERTÀ', cta: '$OMR · omerta.fun' },
  ] },
  // 3 — risk to earn
  earn: { w: 1920, h: 1080, fit: 'pad', shots: [
    { p: 'hero-poster',       use: 1.9, off: 0.2, sub: 'PLAY. TAKE RISKS.' },
    { p: 'interior-kitchen',  use: 1.7, off: 0.7, sub: 'BUILD AN EMPIRE IN THE STREETS' },
    { p: 'hitman-legbreaker', use: 1.7, off: 0.5, sub: 'TAKE IT OFF SOMEBODY WHO DIDN’T' },
    { p: 'interior-den',      use: 1.7, off: 0.7, sub: 'EVERY $OMR WAS BOUGHT WITH REAL MONEY' },
    { p: 'interior-estate',   use: 1.9, off: 0.6, sub: 'TURN THE STREETS INTO A LIVING' },
    { p: 'district-neon',     use: 1.7, off: 0.6, sub: 'CASH OUT — ON-CHAIN, FOR REAL' },
    { p: 'hero-backdrop',     use: 3.0, off: 0.4, title: 'OMERTÀ', cta: 'risk to earn — omerta.fun' },
  ] },
  // 4 — vertical short for social
  short: { w: 1080, h: 1920, fit: 'crop', shots: [
    { p: 'hero-poster',       use: 1.6, off: 0.3, sub: 'ONE LIFE.' },
    { p: 'hitman-legbreaker', use: 1.4, off: 0.5, sub: 'NO RESPAWNS.' },
    { p: 'interior-den',      use: 1.5, off: 0.7, sub: 'REAL MONEY.' },
    { p: 'interior-estate',   use: 1.5, off: 0.6, sub: 'REAL STAKES.' },
    { p: 'citymap',           use: 1.5, off: 0.7, sub: 'TAKE IT OFF SOMEBODY.' },
    { p: 'hero-backdrop',     use: 2.6, off: 0.4, title: 'OMERTÀ', cta: 'omerta.fun' },
  ] },
};

// ── title cards (SVG → PNG, transparent, the display font), scaled to the cut's dimensions ────────
function titlePng(shot, i, w, h) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const portrait = h > w;
  const titleSize = Math.round(w * (portrait ? 0.14 : 0.10));
  const subSize   = Math.round(w * (portrait ? 0.058 : 0.034));
  const ctaSize   = Math.round(w * (portrait ? 0.034 : 0.022));
  let body = '';
  if (shot.title) {
    body += `<text x="${w / 2}" y="${h / 2 + titleSize * 0.2}" font-family="Big Shoulders" font-weight="700"
      font-size="${titleSize}" letter-spacing="${titleSize * 0.09}" fill="#f4efe6" text-anchor="middle">${esc(shot.title)}</text>`;
    if (shot.cta) body += `<text x="${w / 2}" y="${h / 2 + titleSize * 0.75}" font-family="Big Shoulders" font-weight="700"
      font-size="${ctaSize}" letter-spacing="${ctaSize * 0.25}" fill="#c9a24b" text-anchor="middle">${esc(shot.cta.toUpperCase())}</text>`;
  } else if (shot.sub) {
    const y = portrait ? h * 0.72 : h - Math.round(h * 0.13);
    body += `<text x="${w / 2}" y="${y}" font-family="Big Shoulders" font-weight="700"
      font-size="${subSize}" letter-spacing="${subSize * 0.06}" fill="#f4efe6" text-anchor="middle">${esc(shot.sub)}</text>`;
  } else return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  const png = new Resvg(svg, { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Big Shoulders' } })
    .render().asPng();
  const p = path.join(TMP, `title-${i}.png`);
  fs.writeFileSync(p, png);
  return p;
}

// ── one shot → a silent clip: trim the liveliest window, fit to the cut, burn the title ───────────
function shotClip(shot, i, w, h, fit) {
  const src = path.join(LIB, `${shot.p}.mp4`);
  const out = path.join(TMP, `fx-${String(i).padStart(2, '0')}.mp4`);
  const title = titlePng(shot, i, w, h);
  const tOut = Math.max(0.4, shot.use - 0.45);
  const fitv = fit === 'crop'
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`                       // fill (vertical)
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`; // letterbox
  let inputs, fc;
  if (fs.existsSync(src)) {
    const base = `[0:v]trim=${shot.off}:${(shot.off + shot.use).toFixed(2)},setpts=PTS-STARTPTS,${fitv},fps=${FPS},format=yuv420p`;
    inputs = ['-i', src];
    if (title) { inputs.push('-loop', '1', '-t', String(shot.use), '-i', title);
      fc = `${base}[bg];[1:v]format=rgba,fade=in:st=0:d=0.3:alpha=1,fade=out:st=${tOut}:d=0.35:alpha=1[t];[bg][t]overlay=0:0[v]`;
    } else fc = `${base}[v]`;
  } else { // fallback: a gentle push on the still plate (no fal clip for this plate yet)
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

// ── stitch (hard cuts — punchier than dissolves) + a driving synth bed, or a licensed track ───────
function assembleCut(clips, out, music) {
  const total = clips.reduce((a, c) => a + c.sec, 0);
  const listFile = path.join(TMP, `list-${path.basename(out, '.mp4')}.txt`);
  fs.writeFileSync(listFile, clips.map((c) => `file '${c.clip}'`).join('\n'));
  const D = total.toFixed(3), titleMs = Math.round((total - clips[clips.length - 1].sec) * 1000);
  const vin = ['-f', 'concat', '-safe', '0', '-i', listFile];
  let ain, fc, amap;
  if (music) {
    ain = ['-i', music];
    fc = `[1:a]afade=in:st=0:d=0.5,afade=out:st=${(total - 1.5).toFixed(3)}:d=1.5,atrim=0:${D},asetpts=N/SR/TB[a]`;
    amap = '[a]';
  } else {
    // DRIVING bed: 4-on-the-floor kick + sub drone + a noise riser into the finale + a boom on the title.
    ain = ['-f', 'lavfi', '-i', `aevalsrc='0.9*sin(2*PI*55*t)*exp(-11*mod(t,0.5))':d=${D}:s=44100`,
      '-f', 'lavfi', '-i', `sine=frequency=41:duration=${D}`,
      '-f', 'lavfi', '-i', `anoisesrc=d=${D}:color=pink:amplitude=1`,
      '-f', 'lavfi', '-i', `aevalsrc='0.95*sin(2*PI*44*t)*exp(-2.2*t)':d=${D}:s=44100`];
    // NB: input 0 is the concat VIDEO; the lavfi audio sources are inputs 1..4.
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
  const clips = v.shots.map((s, i) => {
    if (!fs.existsSync(path.join(LIB, `${s.p}.mp4`))) { missing++; }
    return shotClip(s, i, v.w, v.h, v.fit);
  });
  const out = path.join(ART, id === 'hype' ? 'hype.mp4' : `hype-${id}.mp4`);
  const total = assembleCut(clips, out, music);
  fs.rmSync(TMP, { recursive: true, force: true });
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`  ✓ ${path.relative(ROOT, out)} — ${v.w}×${v.h}, ${total.toFixed(1)}s, ${kb} KB${missing ? `  (⚠ ${missing} still-fallback shots)` : ''}`);
  return out;
}

// ── the fal.ai image-to-video library (real motion; needs FAL_KEY) ─────────────────────────────────
const FAL_VIDEO_MODEL = process.env.FAL_VIDEO_MODEL || 'fal-ai/kling-video/v1.6/standard/image-to-video';
const FAL_BASE = FAL_VIDEO_MODEL.split('/').slice(0, 2).join('/');
const PUBLIC = (process.env.PUBLIC_URL || 'https://www.omerta.fun').replace(/\/$/, '');
const EST_PER = Number(process.env.FAL_EST_PER || '0.30');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function falRun() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set — the --fal path needs a fal.ai key + a budget.');
  const cap = Number(opt('--cap', '9'));
  const H = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  fs.mkdirSync(LIB, { recursive: true });
  const ledger = path.join(LIB, 'hype-manifest.json');
  const man = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { spentUsd: 0, clips: [] };
  const have = new Set(Object.keys(LIBRARY).filter((p) => fs.existsSync(path.join(LIB, `${p}.mp4`))));
  const todo = [];
  for (const p of Object.keys(LIBRARY)) {
    if (have.has(p)) continue;
    if (man.spentUsd + (todo.length + 1) * EST_PER > cap) { console.log(`cap $${cap} would be exceeded — stopping at ${p}`); break; }
    todo.push(p);
  }
  console.log(`${have.size} clips in hand; queueing ${todo.length} (est +$${(todo.length * EST_PER).toFixed(2)}, cap $${cap})`);
  const jobs = [];
  for (const p of todo) {
    const r = await fetch(`https://queue.fal.run/${FAL_VIDEO_MODEL}`, { method: 'POST', headers: H,
      body: JSON.stringify({ image_url: `${PUBLIC}/art/${p}.jpg`, prompt: LIBRARY[p], duration: '5' }) });
    const j = await r.json();
    if (!r.ok || !j.request_id) throw new Error(`fal submit ${p}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    jobs.push({ p, id: j.request_id, done: false });
    console.log(`  queued ${p} (${j.request_id})`);
  }
  let pending = jobs.length;
  for (let round = 0; pending && round < 80; round++) {
    await sleep(15000);
    for (const job of jobs) {
      if (job.done) continue;
      const rr = await fetch(`https://queue.fal.run/${FAL_BASE}/requests/${job.id}`, { headers: H });
      if (rr.status === 200) {
        const j = await rr.json();
        const url = j?.video?.url || j?.videos?.[0]?.url;
        if (url) {
          fs.writeFileSync(path.join(LIB, `${job.p}.mp4`), Buffer.from(await (await fetch(url)).arrayBuffer()));
          man.spentUsd += EST_PER; man.clips.push({ plate: job.p, url, est: EST_PER });
          fs.writeFileSync(ledger, JSON.stringify(man, null, 2));
          job.done = true; pending--;
          console.log(`  ✓ ${job.p}  (${pending} left, ~$${man.spentUsd.toFixed(2)})`);
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
  if (flag('--fal')) await falRun();               // generate the library, then build all cuts
  const which = opt('--cut', null);
  const buildAll = flag('--fal') || flag('--all');
  if (which) { buildCut(which, music); return; }
  if (buildAll) {
    console.log('building cuts from the library:');
    for (const id of Object.keys(VIDEOS)) buildCut(id, music);
    console.log('\nWATCH each before it ships. Copy carries earnings + the $OMR flywheel — founder signs wording + a licensed track.');
    return;
  }
  // default (no key): the free Ken-Burns montage of the 16:9 hype cut, from the STILLS
  console.log('no --fal/--all/--cut — building the free montage (stills, Ken-Burns) → hype.mp4');
  fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
  const v = VIDEOS.hype;
  const clips = v.shots.map((s, i) => shotClip(s, i, v.w, v.h, v.fit)); // shotClip falls back to stills if no lib clip
  const total = assembleCut(clips, path.join(ART, 'hype.mp4'), music);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`✓ hype.mp4 — ${total.toFixed(1)}s. (montage; run --fal for real motion + all 4 cuts.)`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
