// OMERTÀ — launch hype video builder. See HYPE.md.
//
//   node tools/hype.js                     → the motion montage (default; no key, no spend)
//   node tools/hype.js --music track.mp3   → …with a licensed track instead of the synth bed
//   FAL_KEY=… node tools/hype.js --fal --cap 20   → AI image-to-video upgrade (per-shot, capped)
//   node tools/hype.js --assemble          → stitch reviewed public/art/hype/*.mp4 clips
//
// The montage is assembled locally with a bundled ffmpeg-static + @resvg/resvg-js (the rasteriser
// src/cardpng.js already uses). Title cards are rendered SVG→PNG because the static ffmpeg has no
// drawtext (no libfreetype). Output: public/art/hype.mp4.
//
// COPY RULES (marketing): no earnings/income/appreciation language; fictional only; the founder signs
// the wording + tagline before this ships. Every line below is about the WORLD/mechanics, not money.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'public', 'art');
const TMP = path.join(ROOT, '.hype-tmp');
const OUT = path.join(ART, 'hype.mp4');
const FONT = '/mnt/skills/examples/canvas-design/canvas-fonts/BigShoulders-Bold.ttf';
// ffmpeg-static may live in the project node_modules OR a side-installed prefix (the sandbox's apt
// ffmpeg 404'd on a driver dep, so it was `npm i`'d into /tmp/ffbin). Resolve robustly, then fall
// back to a system ffmpeg on PATH — a launch tool should not die because a bundle moved.
function resolveFF() {
  for (const p of [
    () => require('ffmpeg-static'),
    () => require('/tmp/ffbin/node_modules/ffmpeg-static'),
  ]) { try { const b = p(); if (b && fs.existsSync(b)) return b; } catch { /* next */ } }
  try { return execFileSync('bash', ['-lc', 'command -v ffmpeg'], { encoding: 'utf8' }).trim() || 'ffmpeg'; }
  catch { return 'ffmpeg'; }
}
const FF = resolveFF();
const { Resvg } = require('@resvg/resvg-js');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const W = 1920, H = 1080, FPS = 30, XF = 0.5; // output size / fps / cross-dissolve seconds

// ── the cut ─────────────────────────────────────────────────────────────────────────────────────
// plate = a file in public/art (no extension); motion = push|pull|panR|panL; sec = on-screen seconds;
// title = big centred word; sub = a lower-third line. A shot has title OR sub OR neither.
const SHOTS = [
  { plate: 'hero-poster',        motion: 'push', sec: 3.2, title: 'OMERTÀ' },
  { plate: 'district-neon',      motion: 'panR', sec: 2.7, sub: 'A city that runs on silence.' },
  { plate: 'interior-kitchen',   motion: 'push', sec: 2.5, sub: 'Build an empire.' },
  { plate: 'interior-den',       motion: 'push', sec: 2.5, sub: 'Or bleed for one.' },
  { plate: 'district-docks',     motion: 'panL', sec: 2.6 },
  { plate: 'hitman-legbreaker',  motion: 'push', sec: 2.3, sub: 'Every street remembers.' },
  { plate: 'crest',              motion: 'push', sec: 2.5, sub: 'Family is leverage.' },
  { plate: 'interior-estate',    motion: 'pull', sec: 2.9, sub: 'Go legit — or go down.' },
  { plate: 'interior-pen',       motion: 'push', sec: 2.6, sub: 'Death is permanent.' },
  { plate: 'citymap',            motion: 'pull', sec: 2.7, sub: "The bloodline isn't." },
  { plate: 'hero-backdrop',      motion: 'push', sec: 3.4, title: 'OMERTÀ', cta: 'enter the city — omerta.fun' },
];

// ── title cards (SVG → PNG, transparent, the display font) ───────────────────────────────────────
function titlePng(shot, i) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let body = '';
  if (shot.title) {
    // huge condensed word, centred, wide tracking — the noir poster look
    body += `<text x="${W / 2}" y="${H / 2 + 40}" font-family="Big Shoulders" font-weight="700"
      font-size="200" letter-spacing="18" fill="#f4efe6" text-anchor="middle"
      style="paint-order:stroke">${esc(shot.title)}</text>`;
    if (shot.cta) body += `<text x="${W / 2}" y="${H / 2 + 130}" font-family="Big Shoulders" font-weight="700"
      font-size="42" letter-spacing="10" fill="#c9a24b" text-anchor="middle">${esc(shot.cta.toUpperCase())}</text>`;
  } else if (shot.sub) {
    // a lower-third line
    body += `<text x="${W / 2}" y="${H - 140}" font-family="Big Shoulders" font-weight="700"
      font-size="64" letter-spacing="4" fill="#f4efe6" text-anchor="middle">${esc(shot.sub)}</text>`;
  } else return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  const png = new Resvg(svg, { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Big Shoulders' } })
    .render().asPng();
  const p = path.join(TMP, `title-${i}.png`);
  fs.writeFileSync(p, png);
  return p;
}

// ── one shot → a silent clip with Ken-Burns motion + the title overlay ───────────────────────────
function motionExpr(motion, frames) {
  // zoompan runs on a 2×-output canvas (scaled/cropped first) so the zoom stays smooth (no jitter).
  const c = { push: `min(1.0+0.0018*on,1.16)`, pull: `max(1.16-0.0018*on,1.0)`, panR: `1.12`, panL: `1.12` }[motion];
  const cx = { push: `iw/2-(iw/zoom/2)`, pull: `iw/2-(iw/zoom/2)`,
    panR: `(iw-iw/zoom)*on/${frames}`, panL: `(iw-iw/zoom)*(1-on/${frames})` }[motion];
  const cy = `ih/2-(ih/zoom/2)`;
  return { z: c, x: cx, y: cy };
}

function renderShot(shot, i) {
  const plate = path.join(ART, `${shot.plate}.jpg`);
  if (!fs.existsSync(plate)) throw new Error(`missing plate: ${shot.plate}.jpg`);
  const frames = Math.round(shot.sec * FPS);
  const { z, x, y } = motionExpr(shot.motion, frames);
  const title = titlePng(shot, i);
  const clip = path.join(TMP, `clip-${String(i).padStart(2, '0')}.mp4`);
  const inputs = ['-loop', '1', '-t', String(shot.sec), '-i', plate];
  if (title) inputs.push('-loop', '1', '-t', String(shot.sec), '-i', title);
  // fade the title alpha in, hold, fade out just before the cut
  const tIn = 0.5, tOutAt = Math.max(0.6, shot.sec - 0.7);
  const kb = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},`
    + `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${W}x${H}:fps=${FPS},`
    + `format=yuv420p`;
  let fc, map;
  if (title) {
    fc = `[0:v]${kb}[bg];`
      + `[1:v]format=rgba,fade=in:st=0:d=${tIn}:alpha=1,fade=out:st=${tOutAt}:d=0.6:alpha=1[t];`
      + `[bg][t]overlay=0:0:format=auto[v]`;
    map = '[v]';
  } else { fc = `[0:v]${kb}[v]`; map = '[v]'; }
  execFileSync(FF, ['-y', ...inputs, '-filter_complex', fc, '-map', map,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', clip],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  return { clip, sec: shot.sec };
}

// ── stitch clips with cross-dissolves + an audio bed ─────────────────────────────────────────────
function assemble(clips, music) {
  const total = clips.reduce((a, c) => a + c.sec, 0) - XF * (clips.length - 1);
  // video: chain xfade. offset advances by (running - XF) each step.
  const vin = clips.flatMap((c) => ['-i', c.clip]);
  let fc = '', prev = '[0:v]', running = clips[0].sec;
  for (let k = 1; k < clips.length; k++) {
    const off = (running - XF).toFixed(3);
    const lbl = k === clips.length - 1 ? '[v]' : `[x${k}]`;
    fc += `${prev}[${k}:v]xfade=transition=fade:duration=${XF}:offset=${off}${lbl};`;
    prev = lbl; running += clips[k].sec - XF;
  }
  // audio: a licensed track, or a rights-free noir bed (sub drone + rain texture) that fades out.
  const ain = [], D = total.toFixed(3);
  let amap;
  if (music) {
    ain.push('-i', music);
    fc += `[${clips.length}:a]afade=in:st=0:d=1,afade=out:st=${(total - 2).toFixed(3)}:d=2,atrim=0:${D},asetpts=N/SR/TB[a]`;
    amap = '[a]';
  } else {
    ain.push('-f', 'lavfi', '-i', `sine=frequency=52:duration=${D}`,
      '-f', 'lavfi', '-i', `anoisesrc=d=${D}:color=pink:amplitude=0.10`);
    const bi = clips.length, ni = clips.length + 1;
    fc += `[${bi}]volume=0.14,tremolo=f=1.6:d=0.5[bass];`
      + `[${ni}]highpass=f=1200,lowpass=f=6000,volume=0.05[rain];`
      + `[bass][rain]amix=inputs=2:normalize=0,afade=in:st=0:d=1.5,afade=out:st=${(total - 2.5).toFixed(3)}:d=2.5[a]`;
    amap = '[a]';
  }
  execFileSync(FF, ['-y', ...vin, ...ain, '-filter_complex', fc, '-map', '[v]', '-map', amap,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', D, OUT],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  return total;
}

// ── the fal.ai image-to-video path (mirrors tools/art.js's fal call; needs FAL_KEY) ──────────────
// NOT run without a key. Each shot's seed plate is served publicly, so we pass its URL as image_url
// (no fal upload). Clips land in public/art/hype/ for HUMAN review, then --assemble stitches them.
const FAL_VIDEO_MODEL = process.env.FAL_VIDEO_MODEL || 'fal-ai/kling-video/v1.6/standard/image-to-video';
const PUBLIC = (process.env.PUBLIC_URL || 'https://www.omerta.fun').replace(/\/$/, '');
async function falRun() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set — the --fal path needs a fal.ai key + a budget.');
  const cap = Number(opt('--cap', '20'));
  const dir = path.join(ART, 'hype'); fs.mkdirSync(dir, { recursive: true });
  const ledger = path.join(dir, 'hype-manifest.json');
  const man = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { spentUsd: 0, clips: [] };
  const motionPrompt = (s) => `slow cinematic ${s.motion === 'pull' ? 'dolly out' : s.motion.startsWith('pan') ? 'lateral tracking' : 'dolly in'} `
    + `camera move, subtle drifting fog and rain, flickering lamplight, film-noir, no text, no people added`;
  for (const s of SHOTS) {
    if (man.clips.find((c) => c.plate === s.plate)) continue; // resume
    const EST = 0.5; // rough per-clip USD — the founder confirms against fal's live pricing
    if (man.spentUsd + EST > cap) { console.log(`cap $${cap} reached — stopping before ${s.plate}`); break; }
    console.log(`fal i2v: ${s.plate} …`);
    const r = await fetch(`https://fal.run/${FAL_VIDEO_MODEL}`, {
      method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: `${PUBLIC}/art/${s.plate}.jpg`, prompt: motionPrompt(s), duration: '5' }),
    });
    if (!r.ok) throw new Error(`fal ${s.plate}: HTTP ${r.status} ${await r.text()}`);
    const j = await r.json();
    const url = j?.video?.url || j?.videos?.[0]?.url;
    if (!url) throw new Error(`${s.plate}: no video in response — check FAL_VIDEO_MODEL + body shape`);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(path.join(dir, `${s.plate}.mp4`), buf);
    man.spentUsd += EST; man.clips.push({ plate: s.plate, url, est: EST });
    fs.writeFileSync(ledger, JSON.stringify(man, null, 2));
  }
  console.log(`\n${man.clips.length} clips in public/art/hype/ (~$${man.spentUsd.toFixed(2)}). WATCH them, then: node tools/hype.js --assemble`);
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  if (flag('--fal')) return falRun();
  fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
  let clips;
  if (flag('--assemble')) {
    // stitch human-reviewed fal clips (public/art/hype/<plate>.mp4), same title cards + audio.
    const dir = path.join(ART, 'hype');
    clips = SHOTS.map((s, i) => {
      const src = path.join(dir, `${s.plate}.mp4`);
      if (!fs.existsSync(src)) throw new Error(`--assemble: missing reviewed clip ${s.plate}.mp4`);
      // re-time to the storyboard length + burn the title card over the AI clip
      const title = titlePng(s, i), out = path.join(TMP, `clip-${String(i).padStart(2, '0')}.mp4`);
      const tOutAt = Math.max(0.6, s.sec - 0.7);
      const base = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},trim=0:${s.sec},setpts=PTS-STARTPTS,fps=${FPS}`;
      let fc = title
        ? `${base}[bg];[1:v]format=rgba,fade=in:st=0:d=0.5:alpha=1,fade=out:st=${tOutAt}:d=0.6:alpha=1[t];[bg][t]overlay=0:0[v]`
        : `${base}[v]`;
      const inputs = ['-i', src]; if (title) inputs.push('-loop', '1', '-t', String(s.sec), '-i', title);
      execFileSync(FF, ['-y', ...inputs, '-filter_complex', fc, '-map', '[v]', '-an',
        '-r', String(FPS), '-c:v', 'libx264', '-crf', '19', '-pix_fmt', 'yuv420p', out], { stdio: ['ignore', 'ignore', 'inherit'] });
      return { clip: out, sec: s.sec };
    });
  } else {
    console.log(`rendering ${SHOTS.length} shots…`);
    clips = SHOTS.map((s, i) => { process.stdout.write(`  ${i + 1}/${SHOTS.length} ${s.plate}\n`); return renderShot(s, i); });
  }
  const total = assemble(clips, opt('--music', null));
  fs.rmSync(TMP, { recursive: true, force: true });
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`\n✓ ${path.relative(ROOT, OUT)} — ${total.toFixed(1)}s, ${kb} KB. WATCH it before it ships.`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
