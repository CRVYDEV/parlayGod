// ── tools/make-brand.js — generate the OMERTÀ brand assets (logo + X banner) ──
// Usage: node tools/make-brand.js
// Writes brand/logo.svg + PNGs sized for X (Twitter):
//   brand/x-profile-400.png    — 400×400  (X profile photo; X crops it to a circle)
//   brand/x-profile-1000.png   — 1000×1000 (high-res master of the same mark)
//   brand/x-banner-1500x500.png — 1500×500 (X header/banner, the exact required size)
// Rasterized with @resvg/resvg-js (already an optional dependency of the game backend).
// The mark reuses the BROADCAST cards' visual language (src/cards.js): the gold fedora on noir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'brand');
fs.mkdirSync(OUT, { recursive: true });

const GOLD = '#e0b054', DEEP = '#8f7433', INK = '#e8e2d4', DIM = '#8a8672', BG = '#0c0d11';
const SERIF = 'Liberation Serif, DejaVu Serif, serif';

// The fedora, silhouette-weight so it still reads at a 40px timeline avatar:
// a filled dome crown + a swept brim, with the hat band cut in the background color.
const fedora = (cx, cy, s = 1) => `<g transform="translate(${cx} ${cy}) scale(${s})">
  <ellipse cx="0" cy="30" rx="150" ry="24" fill="${GOLD}"/>
  <path d="M -94 30 C -92 -50 -58 -88 0 -88 C 58 -88 92 -50 94 30 Z" fill="${GOLD}"/>
  <rect x="-95" y="2" width="190" height="21" fill="#17141a"/>
  <rect x="-95" y="21" width="190" height="3" fill="${DEEP}"/>
</g>`;

// ── the logo (square master, safe inside X's circle crop) ──
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>
    <radialGradient id="lamp" cx="50%" cy="18%" r="80%">
      <stop offset="0%" stop-color="${GOLD}" stop-opacity=".10"/>
      <stop offset="55%" stop-color="${GOLD}" stop-opacity=".02"/>
      <stop offset="100%" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="1000" fill="${BG}"/>
  <rect width="1000" height="1000" fill="url(#lamp)"/>
  <circle cx="500" cy="500" r="452" fill="none" stroke="${GOLD}" stroke-width="9"/>
  <circle cx="500" cy="500" r="426" fill="none" stroke="${GOLD}" stroke-width="2" opacity=".45"/>
  ${fedora(500, 385, 1.75)}
  <text x="488" y="738" text-anchor="middle" font-family="${SERIF}" font-size="116" letter-spacing="24"
    fill="${GOLD}">OMERTÀ</text>
  <g stroke="${DEEP}" stroke-width="3">
    <line x1="330" y1="790" x2="470" y2="790"/><line x1="530" y1="790" x2="670" y2="790"/>
  </g>
  <rect x="494" y="784" width="12" height="12" transform="rotate(45 500 790)" fill="${GOLD}"/>
</svg>`;

// ── the X banner (1500×500 — X's exact header size; critical content centered clear of the
//     bottom-left avatar overlap, with a lit skyline running the base) ──
const buildings = (() => {
  // a deterministic little skyline: [x, w, h] strips with a few lit windows
  const B = [[0,70,120],[80,54,168],[140,80,96],[228,60,208],[295,90,140],[392,64,180],[462,86,110],
    [556,58,150],[620,90,88],[716,70,196],[792,60,126],[858,88,160],[952,62,100],[1020,84,184],
    [1110,64,132],[1180,92,168],[1278,58,108],[1342,84,150],[1432,68,190]];
  let s = '';
  for (const [x, w, h] of B) {
    s += `<rect x="${x}" y="${500 - h}" width="${w}" height="${h}" fill="#12131c"/>`;
    // windows: a sparse grid, seeded off position so it's stable
    for (let wx = x + 10; wx < x + w - 8; wx += 18)
      for (let wy = 500 - h + 12; wy < 480; wy += 24)
        if (((wx * 7 + wy * 13) % 17) === 3) s += `<rect x="${wx}" y="${wy}" width="6" height="9" fill="${GOLD}" opacity=".55"/>`;
  }
  return s;
})();

const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#101018"/><stop offset="100%" stop-color="${BG}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="60%">
      <stop offset="0%" stop-color="${GOLD}" stop-opacity=".12"/>
      <stop offset="60%" stop-color="${GOLD}" stop-opacity=".02"/>
      <stop offset="100%" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1500" height="500" fill="url(#sky)"/>
  <rect width="1500" height="500" fill="url(#glow)"/>
  ${buildings}
  <rect y="497" width="1500" height="3" fill="#000" opacity=".5"/>
  ${fedora(750, 128, 0.72)}
  <text x="735" y="272" text-anchor="middle" font-family="${SERIF}" font-size="118" letter-spacing="30"
    fill="${GOLD}">OMERTÀ</text>
  <text x="745" y="330" text-anchor="middle" font-family="${SERIF}" font-size="23" letter-spacing="9"
    fill="${INK}" opacity=".85">SAY NOTHING. TAKE EVERYTHING.</text>
  <text x="748" y="374" text-anchor="middle" font-family="${SERIF}" font-size="17" letter-spacing="3"
    fill="${DIM}">a noir mafia RPG&#160;&#160;·&#160;&#160;@OmertaOnRH</text>
</svg>`;

const { renderAsync } = await import('@resvg/resvg-js');
const png = async (svg, width) => (await renderAsync(svg, { fitTo: { mode: 'width', value: width } })).asPng();

fs.writeFileSync(path.join(OUT, 'logo.svg'), logo);
fs.writeFileSync(path.join(OUT, 'banner.svg'), banner);
fs.writeFileSync(path.join(OUT, 'x-profile-400.png'), await png(logo, 400));
fs.writeFileSync(path.join(OUT, 'x-profile-1000.png'), await png(logo, 1000));
fs.writeFileSync(path.join(OUT, 'x-banner-1500x500.png'), await png(banner, 1500));
console.log('brand assets written to brand/ — x-profile-400.png (profile), x-banner-1500x500.png (header)');
