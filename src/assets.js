// ── src/assets.js — procedural item art (§ cosmetic; zero ledger/§10.4 surface) ──
// One deterministic SVG per catalog item, so the whole catalog (60 cars, boats, product, iron, vests,
// goods) reads as ONE engraved gold-on-dark world without hand-drawing each. Every generator is a pure
// function of the item's real fields (value/tier/rarity/firepower/…) + a stable hash of its id, so the
// same item always yields the same icon and tiers/rarity are legible at a glance. Served by GET
// /v1/art/:kind/:id and shown in the garage/port/kitchen/armory/market tabs. Swap-compatible with the
// later AI-painted set (same id → same slot). NOT a §10.4 surface — art moves no value.

const GOLD = '#c9a24b', DIM = '#8f7433', TEAL = '#4fd6c2', FILL = '#12141a', STEEL = '#20242e';

// FNV-1a — a stable per-id hash so variation is deterministic (no Math.random, which the sim forbids too).
export function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (h, arr) => arr[h % arr.length];
const svg = (inner, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 150" fill="none" stroke="${GOLD}" ` +
  `stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${extra ? ' ' + extra : ''}>${inner}</svg>`;
const glowDefs = (id) => `<defs><filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">` +
  `<feGaussianBlur stdDeviation="3.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
const shadow = (cx, rx, rare) => rare
  ? `<ellipse cx="${cx}" cy="128" rx="${rx}" ry="7" fill="${TEAL}" opacity="0.14" stroke="none"/>`
  : `<ellipse cx="${cx}" cy="128" rx="${rx}" ry="6" fill="#000" opacity="0.34" stroke="none"/>`;

// ── CARS ── side profile; proportions + roofline + detailing scale with value tier, rarity glows teal.
function carArt(c) {
  const h = hashId(c.id), val = Number(c.val) || 0, rare = !!c.rare;
  const tier = val < 2500 ? 0 : val < 12000 ? 1 : val < 40000 ? 2 : val < 120000 ? 3 : 4;
  const acc = rare ? TEAL : GOLD;
  const ground = 116, wR = 13 + tier + (h % 3) * 0.7;         // premium rides on bigger wheels
  const len = 150 + tier * 12 + (h % 5) * 4;                  // luxury is longer
  const x0 = 120 - len / 2, x1 = 120 + len / 2;
  const wf = x0 + len * 0.24, wr = x1 - len * 0.22;           // wheel centres
  const roof = pick(h >> 3, tier >= 3 ? ['notch', 'fast', 'limo'] : tier === 0 ? ['box', 'notch', 'truck'] : ['notch', 'fast', 'box', 'truck']);
  const cowl = x0 + len * (roof === 'truck' ? 0.30 : 0.34);
  const rearRoof = roof === 'fast' ? x1 - len * 0.16 : roof === 'limo' ? x1 - len * 0.10 : x1 - len * 0.24;
  const roofY = ground - 46 - (tier >= 3 ? 6 : 0) + (roof === 'box' || roof === 'truck' ? 4 : 0);
  const beltY = ground - 22;
  // body outline
  let body = `M${x0} ${ground - 12} Q${x0 - 2} ${beltY} ${x0 + 10} ${beltY - 2} `
    + `L${cowl} ${beltY - 4} `;
  if (roof === 'fast') body += `Q${cowl + 14} ${roofY} ${(cowl + rearRoof) / 2} ${roofY} Q${rearRoof + 20} ${roofY + 2} ${x1 - 6} ${beltY - 2} `;
  else if (roof === 'truck') body += `L${cowl + 2} ${roofY} L${x0 + len * 0.52} ${roofY} L${x0 + len * 0.52} ${beltY - 4} L${x1 - 8} ${beltY - 6} `;
  else body += `Q${cowl + 8} ${roofY} ${cowl + 20} ${roofY} L${rearRoof} ${roofY} Q${rearRoof + 16} ${roofY + 1} ${x1 - 8} ${beltY - 4} `;
  body += `Q${x1 + 2} ${beltY} ${x1} ${ground - 12} `;
  body += `L${x0} ${ground - 12} Z`;
  const parts = [];
  parts.push(shadow(120, len / 2 - 6, rare));
  const gid = 'cg' + (h % 97);
  if (rare) parts.push(glowDefs(gid));
  parts.push(`<g${rare ? ` filter="url(#${gid})"` : ''}>`);
  parts.push(`<path d="${body}" fill="${FILL}"/>`);
  // windows
  const winY = roofY + 6;
  if (roof !== 'truck') parts.push(`<path d="M${cowl + 6} ${beltY - 6} L${cowl + 14} ${winY} L${rearRoof - 6} ${winY} L${rearRoof + 4} ${beltY - 6} Z" stroke="${DIM}" stroke-width="1.4"/>`);
  else parts.push(`<rect x="${cowl + 6}" y="${roofY + 4}" width="${len * 0.16}" height="${beltY - roofY - 8}" stroke="${DIM}" stroke-width="1.4"/>`);
  if (tier >= 1 && roof !== 'fast' && roof !== 'truck') parts.push(`<line x1="${(cowl + rearRoof) / 2}" y1="${winY}" x2="${(cowl + rearRoof) / 2}" y2="${beltY - 6}" stroke="${DIM}" stroke-width="1.2"/>`);
  // running board / sill
  parts.push(`<line x1="${wf + wR}" y1="${ground - 10}" x2="${wr - wR}" y2="${ground - 10}" stroke="${DIM}" stroke-width="1.6"/>`);
  // headlamp
  parts.push(`<circle cx="${x0 + 6}" cy="${beltY - 4}" r="${3.4 + tier * 0.3}" fill="${acc}" stroke="none"/>`);
  // tier flourishes
  if (tier >= 2) { parts.push(`<line x1="${x0 + len * 0.72}" y1="${beltY - 8}" x2="${x0 + len * 0.80}" y2="${beltY - 3}" stroke="${DIM}" stroke-width="1.3"/>`); parts.push(`<line x1="${x0 + len * 0.75}" y1="${beltY - 10}" x2="${x0 + len * 0.83}" y2="${beltY - 5}" stroke="${DIM}" stroke-width="1.3"/>`); }
  if (tier >= 3 && (h & 1)) parts.push(`<circle cx="${wr + wR + 8}" cy="${beltY - 2}" r="${wR - 5}" stroke="${DIM}" stroke-width="1.5"/>`); // side spare
  // wheels
  for (const wx of [wf, wr]) {
    parts.push(`<circle cx="${wx}" cy="${ground}" r="${wR}"/>`);
    parts.push(`<circle cx="${wx}" cy="${ground}" r="${wR - (tier >= 2 ? 6 : 7)}" stroke="${rare ? TEAL : DIM}" stroke-width="${tier >= 2 ? 2 : 1.4}"/>`);
  }
  parts.push('</g>');
  return svg(parts.join(''));
}

// ── BOATS ── low hull on a waterline; length by hold, cockpit + engine cowls by speed.
function boatArt(b) {
  const h = hashId(b.id), hold = Number(b.hold) || 40, speed = Number(b.speed) || 30;
  const len = 120 + Math.min(90, hold) * 0.7, x0 = 120 - len / 2, x1 = 120 + len / 2;
  const deck = 100, fast = speed >= 90;
  const parts = [];
  // water
  parts.push(`<path d="M8 116 Q40 110 72 116 T136 116 T200 116 T236 114" stroke="#3a6f68" stroke-width="1.6"/>`);
  parts.push(`<path d="M20 126 Q52 121 84 126 T148 126 T212 126" stroke="#26433f" stroke-width="1.4"/>`);
  // hull — pointed bow (right), transom (left)
  const bow = x1 + (fast ? 14 : 6);
  parts.push(`<path d="M${x0} ${deck} L${x1 - 20} ${deck - 6} Q${bow} ${deck - 4} ${bow - 8} ${deck + 6} L${x0 + 16} ${deck + 10} Q${x0 - 4} ${deck + 8} ${x0} ${deck}Z" fill="#12303c" stroke="${GOLD}"/>`);
  parts.push(`<line x1="${x0 + 14}" y1="${deck + 1}" x2="${x1 - 24}" y2="${deck - 4}" stroke="${DIM}" stroke-width="1.4"/>`);
  // cabin / cockpit
  if (hold >= 90) parts.push(`<path d="M${x0 + 24} ${deck - 4} L${x0 + 30} ${deck - 22} L${x0 + 64} ${deck - 22} L${x0 + 70} ${deck - 3} Z" fill="${FILL}" stroke="${GOLD}"/>`);
  else parts.push(`<path d="M${120} ${deck - 3} Q${126} ${deck - 15} ${140} ${deck - 13} L${156} ${deck - 11} Q${160} ${deck - 3} ${158} ${deck - 2}" />`);
  // engine cowl + spray for fast boats
  if (fast) { parts.push(`<path d="M${x0 + 6} ${deck} q-12 2 -16 8" stroke="${TEAL}" stroke-width="1.5" opacity="0.7"/>`); parts.push(`<path d="M${x1 - 34} ${deck - 4} l12 -6 4 8" stroke-width="1.6"/>`); }
  return svg(parts.join(''));
}

// ── DRUGS ── the product: form chosen per id (vial/brick/pills/baggie/powder/ampoule/blotter/jar),
// accent + a wax stamp by tier; "bottled lightning" gets its arc.
// the product line is fixed content, so each named drug gets its OWN form (a hash % 8 clustered them
// all onto "baggie"); unknown future ids fall back to the spread.
const DRUG_FORM = { glass: 'vial', ambrosia: 'ampoule', nocturne: 'brick', halo: 'pills',
  static: 'powder', lotus: 'blotter', vim: 'jar', moonmilk: 'baggie' };
function drugArt(d) {
  const h = hashId(d.id), tier = Number(d.unlock) || 0, base = Number(d.base) || 100;
  const acc = tier >= 3 ? TEAL : GOLD, gid = 'dg' + (h % 89);
  const form = DRUG_FORM[d.id] || pick(h, ['vial', 'brick', 'pills', 'baggie', 'powder', 'ampoule', 'blotter', 'jar']);
  const stamp = `<circle cx="120" cy="108" r="9" stroke="#9b2f2f" stroke-width="1.6" opacity="0.9"/>`;
  const parts = [shadow(120, 40, tier >= 3)];
  if (form === 'ampoule') {
    parts.push(glowDefs(gid));
    // a slender ampoule — tapered neck, no cork
    parts.push(`<path d="M112 40 Q120 30 128 40 L124 58 Q140 82 140 102 Q140 122 120 122 Q100 122 100 102 Q100 82 116 58 Z" fill="#0f1a22" stroke="${GOLD}"/>`);
    parts.push(`<line x1="120" y1="34" x2="120" y2="54" stroke="${GOLD}" stroke-width="1.6"/>`);
    parts.push(`<path d="M104 98 Q120 106 136 98" stroke="${acc}" stroke-width="1.6"/>`);
    parts.push(stamp);
  } else if (form === 'vial') {
    parts.push(glowDefs(gid));
    parts.push(`<path d="M104 42 L136 42 L136 56 L142 68 Q150 84 150 100 Q150 122 120 122 Q90 122 90 100 Q90 84 98 68 L104 56 Z" fill="#0f1a22" stroke="${GOLD}"/>`);
    parts.push(`<rect x="106" y="32" width="28" height="12" rx="2" fill="${DIM}" stroke="${GOLD}"/>`);
    parts.push(`<path d="M95 92 Q120 100 145 92" stroke="${acc}" stroke-width="1.6"/>`);
    if ((d.tag || '').includes('lightning') || (h & 1)) parts.push(`<path d="M124 60 L112 88 L122 88 L110 110" stroke="${TEAL}" stroke-width="2.6" filter="url(#${gid})"/>`);
    parts.push(stamp);
  } else if (form === 'brick') {
    parts.push(`<path d="M70 66 L162 58 L172 96 L80 106 Z" fill="${FILL}" stroke="${GOLD}"/>`);
    parts.push(`<path d="M70 66 L80 106 M162 58 L172 96" stroke="${DIM}" stroke-width="1.5"/>`);
    parts.push(`<line x1="116" y1="62" x2="126" y2="101" stroke="#9b2f2f" stroke-width="6" opacity="0.85"/>`); // tape
    parts.push(`<rect x="108" y="74" width="20" height="16" stroke="${acc}" stroke-width="1.6" transform="rotate(-6 118 82)"/>`);
  } else if (form === 'pills') {
    for (const [cx, cy, r] of [[104, 84, 13], [128, 74, 13], [124, 100, 13], [148, 92, 11]]) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${FILL}" stroke="${GOLD}"/>`);
      parts.push(`<line x1="${cx - r + 3}" y1="${cy}" x2="${cx + r - 3}" y2="${cy}" stroke="${acc}" stroke-width="1.4"/>`);
    }
  } else if (form === 'baggie') {
    parts.push(`<path d="M92 58 L148 58 L156 118 Q120 128 84 118 Z" fill="#0f1a22" stroke="${GOLD}"/>`);
    parts.push(`<line x1="92" y1="58" x2="148" y2="58" stroke="${DIM}" stroke-width="4"/>`);
    parts.push(`<path d="M100 92 q20 -8 40 0" stroke="${acc}" stroke-width="1.6"/>`);
    parts.push(stamp);
  } else if (form === 'powder') {
    parts.push(`<path d="M78 96 Q120 70 162 96 L156 108 Q120 96 84 108 Z" fill="${FILL}" stroke="${GOLD}"/>`);
    parts.push(`<path d="M96 90 Q120 78 144 90" stroke="${acc}" stroke-width="1.6"/>`);
    parts.push(`<line x1="120" y1="60" x2="120" y2="88" stroke="${DIM}" stroke-width="1.4"/><path d="M120 88 l-8 -10 M120 88 l8 -10" stroke="${DIM}" stroke-width="1.4"/>`);
  } else if (form === 'blotter') {
    parts.push(`<rect x="86" y="62" width="68" height="60" rx="2" fill="${FILL}" stroke="${GOLD}"/>`);
    for (let i = 1; i < 4; i++) { parts.push(`<line x1="86" y1="${62 + i * 15}" x2="154" y2="${62 + i * 15}" stroke="${DIM}" stroke-width="1.1"/>`); parts.push(`<line x1="${86 + i * 17}" y1="62" x2="${86 + i * 17}" y2="122" stroke="${DIM}" stroke-width="1.1"/>`); }
    parts.push(`<circle cx="120" cy="92" r="6" stroke="${acc}" stroke-width="1.6"/>`);
  } else { // jar
    parts.push(`<path d="M96 66 L144 66 L148 116 Q120 122 92 116 Z" fill="#0f1a22" stroke="${GOLD}"/>`);
    parts.push(`<rect x="100" y="54" width="40" height="14" rx="2" fill="${DIM}" stroke="${GOLD}"/>`);
    parts.push(`<path d="M100 96 q20 -6 40 0" stroke="${acc}" stroke-width="1.6"/>`);
    parts.push(stamp);
  }
  return svg(parts.join(''));
}

// ── GUNS ── silhouette by firepower: pocket pistol → auto → revolver → SMG → long case.
function gunArt(g) {
  const fp = Number(g.fp) || 5, cash = Number(g.cash) || 500, h = hashId(g.id);
  const cls = fp < 8 ? 'pocket' : fp < 20 ? 'auto' : fp < 34 ? 'revolver' : fp < 50 ? 'smg' : 'long';
  const acc = cash >= 100000 ? TEAL : GOLD;
  const parts = [shadow(120, 74, cash >= 100000)];
  if (cls === 'pocket' || cls === 'auto') {
    const L = cls === 'pocket' ? 96 : 150, x0 = 120 - L / 2, x1 = 120 + L / 2, sy = 70;
    parts.push(`<path d="M${x0} ${sy} L${x1} ${sy} L${x1} ${sy + 15} L${x0 + L * 0.62} ${sy + 15} L${x0 + L * 0.62} ${sy + 21} L${x0 + 18} ${sy + 21} Q${x0 + 10} ${sy + 21} ${x0 + 8} ${sy + 15} L${x0} ${sy + 15} Z" fill="${STEEL}" stroke="${GOLD}"/>`);
    parts.push(`<line x1="${x0 + 8}" y1="${sy + 6}" x2="${x1 - 6}" y2="${sy + 6}" stroke="${DIM}" stroke-width="1.4"/>`);
    parts.push(`<rect x="${x0 + 12}" y="${sy - 6}" width="6" height="6" fill="${acc}" stroke="none"/>`);
    // grip
    const gx = x0 + L * 0.62;
    parts.push(`<path d="M${gx} ${sy + 21} L${gx + 16} ${sy + 21} L${gx + 8} ${sy + 58} Q${gx + 6} ${sy + 64} ${gx} ${sy + 64} L${gx - 12} ${sy + 64} Q${gx - 18} ${sy + 64} ${gx - 16} ${sy + 58} Z" fill="${FILL}" stroke="${GOLD}"/>`);
    parts.push(`<path d="M${gx - 18} ${sy + 21} Q${gx - 26} ${sy + 34} ${gx - 14} ${sy + 40} L${gx - 8} ${sy + 33}" stroke-width="1.8"/>`); // trigger guard
    if (cls === 'auto') parts.push(`<path d="M${x1} ${sy} q9 -2 9 8" stroke-width="1.8"/>`); // hammer
  } else if (cls === 'revolver') {
    parts.push(`<path d="M60 70 L150 70 L150 84 L120 84 L120 90 L92 90 Q84 90 82 84 L60 84 Z" fill="${STEEL}" stroke="${GOLD}"/>`);
    parts.push(`<circle cx="112" cy="80" r="12" fill="${FILL}" stroke="${GOLD}"/>`); // cylinder
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; parts.push(`<circle cx="${(112 + Math.cos(a) * 6).toFixed(1)}" cy="${(80 + Math.sin(a) * 6).toFixed(1)}" r="1.7" stroke="${DIM}" stroke-width="1"/>`); }
    parts.push(`<path d="M118 90 L134 90 L126 126 Q124 132 118 132 L108 132 Q102 132 104 126 Z" fill="${FILL}" stroke="${GOLD}"/>`);
    parts.push(`<rect x="66" y="64" width="6" height="6" fill="${acc}" stroke="none"/>`);
  } else if (cls === 'smg') {
    parts.push(`<path d="M46 62 L188 62 L188 76 L70 76 L70 84 L52 84 Q46 84 46 78 Z" fill="${STEEL}" stroke="${GOLD}"/>`);
    parts.push(`<circle cx="96" cy="98" r="16" fill="${FILL}" stroke="${GOLD}"/><circle cx="96" cy="98" r="7" stroke="${DIM}" stroke-width="1.4"/>`); // drum mag
    parts.push(`<path d="M150 76 L162 76 L158 112 L146 112 Z" fill="${FILL}" stroke="${GOLD}"/>`); // rear grip
    parts.push(`<line x1="60" y1="68" x2="182" y2="68" stroke="${DIM}" stroke-width="1.4"/>`);
    parts.push(`<rect x="176" y="56" width="6" height="6" fill="${acc}" stroke="none"/>`);
  } else { // long case (rifle / "Undertaker")
    parts.push(`<line x1="30" y1="76" x2="210" y2="70" stroke="${GOLD}" stroke-width="3"/>`);
    parts.push(`<path d="M120 70 L206 66 L206 82 L128 86 Z" fill="${STEEL}" stroke="${GOLD}"/>`); // receiver/stock
    parts.push(`<path d="M150 86 L164 86 L158 116 Q156 120 150 120 L142 120 Z" fill="${FILL}" stroke="${GOLD}"/>`);
    parts.push(`<rect x="196" y="60" width="7" height="7" fill="${acc}" stroke="none"/>`);
    parts.push(`<line x1="44" y1="74" x2="70" y2="72" stroke="${DIM}" stroke-width="5"/>`); // muzzle
  }
  return svg(parts.join(''));
}

// ── VESTS ── a coat / body-armour torso; plating by protection mult.
function vestArt(v) {
  const mult = Number(v.mult) || 1.1, tier = mult >= 1.4 ? 2 : mult >= 1.2 ? 1 : 0;
  const acc = tier >= 2 ? TEAL : GOLD;
  const parts = [shadow(120, 46, tier >= 2)];
  parts.push(`<path d="M84 46 L120 58 L156 46 L168 66 L150 78 L150 120 Q120 128 90 120 L90 78 L72 66 Z" fill="${FILL}" stroke="${GOLD}"/>`);
  parts.push(`<path d="M120 58 L120 122" stroke="${DIM}" stroke-width="1.6"/>`);
  parts.push(`<path d="M84 46 L120 58 L156 46" stroke="${GOLD}" stroke-width="1.8"/>`);
  for (let i = 0; i < tier + 1; i++) parts.push(`<line x1="98" y1="${86 + i * 12}" x2="142" y2="${86 + i * 12}" stroke="${acc}" stroke-width="1.6"/>`);
  return svg(parts.join(''));
}

// ── GOODS ── trade cargo: a stamped crate/bale, seal colour by hashed id.
function goodArt(g) {
  const h = hashId(g.id), acc = pick(h, [GOLD, TEAL, '#b7783a']);
  const parts = [shadow(120, 48, false)];
  parts.push(`<path d="M78 66 L162 66 L162 116 L78 116 Z" fill="${FILL}" stroke="${GOLD}"/>`);
  parts.push(`<path d="M78 66 L120 52 L162 66 M120 52 L120 66" stroke="${GOLD}" stroke-width="1.8"/>`);          // lid perspective
  parts.push(`<path d="M78 116 L120 116 L120 66 M162 116 L120 116" stroke="${DIM}" stroke-width="1.3"/>`);
  parts.push(`<line x1="88" y1="66" x2="88" y2="116" stroke="${DIM}" stroke-width="1.2"/><line x1="152" y1="66" x2="152" y2="116" stroke="${DIM}" stroke-width="1.2"/>`);
  // a stamped shipping mark — glyph varies by id so the ten commodities read apart
  const glyph = pick(h >> 5, ['cross', 'ring', 'bars', 'tri', 'dot', 'diag']);
  parts.push(`<circle cx="120" cy="92" r="11" stroke="${acc}" stroke-width="1.6"/>`);
  if (glyph === 'cross') parts.push(`<path d="M120 85 L120 99 M113 92 L127 92" stroke="${acc}" stroke-width="1.5"/>`);
  else if (glyph === 'ring') parts.push(`<circle cx="120" cy="92" r="5" stroke="${acc}" stroke-width="1.5"/>`);
  else if (glyph === 'bars') parts.push(`<path d="M114 88 L126 88 M114 92 L126 92 M114 96 L126 96" stroke="${acc}" stroke-width="1.4"/>`);
  else if (glyph === 'tri') parts.push(`<path d="M120 86 L126 98 L114 98 Z" stroke="${acc}" stroke-width="1.4"/>`);
  else if (glyph === 'diag') parts.push(`<path d="M114 98 L126 86 M114 90 L122 98" stroke="${acc}" stroke-width="1.4"/>`);
  else parts.push(`<circle cx="120" cy="92" r="2.4" fill="${acc}" stroke="none"/>`);
  return svg(parts.join(''));
}

const GEN = { car: carArt, boat: boatArt, drug: drugArt, gun: gunArt, vest: vestArt, good: goodArt };

// itemArt(kind, item) → an <svg> string. Unknown kinds/items fall back to a neutral emblem so a route
// never 500s on a missing entry (the caller passes the resolved catalog row).
export function itemArt(kind, item) {
  const gen = GEN[kind];
  if (gen && item) { try { return gen(item); } catch { /* fall through to emblem */ } }
  return svg(`<circle cx="120" cy="86" r="34" stroke="${DIM}"/><path d="M104 86 L136 86 M120 70 L120 102" stroke="${GOLD}"/>`);
}

export const ART_KINDS = Object.keys(GEN);
