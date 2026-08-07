// src/avatar.js — procedural player portraits (cosmetic; ZERO §10.4 / ledger surface).
//
// A name is just text on the roster, the Cast, the leaderboards. A deterministic noir "mugshot" per
// player makes them read as a PERSON — a face under a fedora, distinct at a glance — without commissioning
// art for everyone. Pure function of a stable hash of a SEED string (a character id), the itemArt / seeded-
// "now spinning" precedent: no Math.random (the sim forbids it), same seed → same face forever, cacheable.
//
// SAFETY: the seed is used ONLY as a hash input — it is NEVER written into the SVG markup — so there is no
// injection surface and no escaping needed even though the route is public + keyless. Served by
// GET /v1/avatar/:seed and embedded inline in the broadcast cards + the public profile. Art moves no value.
import { hashId } from './assets.js';

// noir palette — dark coats, hat felt, a few plausible skin tones, one bright accent (hatband / tie).
const SKINS = ['#e8c9a8', '#dcb088', '#c68a5a', '#a86b42', '#7d4a2c', '#5a3420'];
const HATS  = ['#191c24', '#23262f', '#33291d', '#3a2626', '#1e2830', '#2a2130'];
const COATS = ['#151821', '#20242e', '#26201c', '#1b2626', '#241f2a', '#2b271d'];
const BGS   = ['#0c0e12', '#111318', '#130f16', '#0e1214', '#141009', '#0d1216'];
const ACC   = ['#c9a24b', '#4fd6c2', '#b8504a', '#5a8fd6', '#c98a4b', '#9a7f4b'];

// derive N stable bytes from the seed (FNV + a cheap mix so bytes 4+ don't correlate with the low ones)
function bytesOf(seed) {
  const h = hashId('av:' + String(seed == null ? '' : seed));
  const g = hashId('av2:' + String(seed == null ? '' : seed));
  return [h & 255, (h >> 8) & 255, (h >> 16) & 255, (h >> 24) & 255, g & 255, (g >> 8) & 255, (g >> 16) & 255];
}

// ── the portrait — a deterministic 100×100 noir bust. Layers back-to-front: bg → coat/shoulders →
// collar+tie accent → neck → face (skin, jaw-width varies) → optional stubble → eyes/brow → fedora
// (brim width varies) → hatband accent. ──
export function avatarSvg(seed, size = 64) {
  const b = bytesOf(seed);
  const skin = SKINS[b[0] % SKINS.length];
  const hat  = HATS[b[1] % HATS.length];
  const coat = COATS[b[2] % COATS.length];
  const bg   = BGS[b[3] % BGS.length];
  const acc  = ACC[b[4] % ACC.length];
  const brim = 30 + (b[5] % 14);      // brim half-width 30..43
  const jaw  = 19 + (b[6] % 6);       // face half-width 19..24
  const stubble = (b[0] % 3) === 0;   // a shadowed jaw on some
  const px = Math.max(8, Math.min(512, Number(size) || 64));
  const parts = [
    `<rect width="100" height="100" fill="${bg}"/>`,
    // coat / shoulders
    `<path d="M8 100 Q8 70 50 70 Q92 70 92 100 Z" fill="${coat}"/>`,
    // shirt collar (two flaps) + tie
    `<path d="M40 72 L50 84 L44 92 Z" fill="#d7d2c4"/><path d="M60 72 L50 84 L56 92 Z" fill="#d7d2c4"/>`,
    `<path d="M50 84 L46 100 L54 100 Z" fill="${acc}"/>`,
    // neck
    `<rect x="44" y="60" width="12" height="14" fill="${skin}"/>`,
    // face
    `<path d="M${50 - jaw} 44 Q${50 - jaw} 66 50 68 Q${50 + jaw} 66 ${50 + jaw} 44 Q${50 + jaw} 30 50 30 Q${50 - jaw} 30 ${50 - jaw} 44 Z" fill="${skin}"/>`,
    stubble ? `<path d="M${50 - jaw + 3} 50 Q50 70 ${50 + jaw - 3} 50 Q50 62 ${50 - jaw + 3} 50 Z" fill="#000" opacity="0.16"/>` : '',
    // eyes + brow (the "face")
    `<ellipse cx="43" cy="42" rx="2" ry="2.4" fill="#15110c"/><ellipse cx="57" cy="42" rx="2" ry="2.4" fill="#15110c"/>`,
    `<path d="M39 37 L47 37 M53 37 L61 37" stroke="#000" stroke-width="1.4" opacity="0.4"/>`,
    // fedora — brim then crown then hatband
    `<ellipse cx="50" cy="31" rx="${brim}" ry="7.5" fill="${hat}"/>`,
    `<path d="M33 31 Q33 12 50 12 Q67 12 67 31 Z" fill="${hat}"/>`,
    `<rect x="33" y="27" width="34" height="4" fill="${acc}" opacity="0.85"/>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${px}" height="${px}">${parts.join('')}</svg>`;
}
