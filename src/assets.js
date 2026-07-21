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

// ── CARS ── distinct 1930s ARCHETYPE silhouettes (a boattail speedster reads nothing like a milk
// truck), chosen from the item's NAME (the catalog already implies the body — "Coupe"/"Hauler"/
// "Town Car"/"Roadster") then value tier. Period forms only (out of design-patent), never a brand.
function carArchetype(c) {
  const n = (c.name || '').toLowerCase(), val = Number(c.val) || 0;
  if (/armor|armour|bullion|blackout|phantom|walking vault/.test(n)) return 'armored';
  if (/truck|van|hauler|flatbed|pickup|rig|ladder|route|delivery|dray|postal|milk|freight|cannery|gardener/.test(n)) return 'truck';
  if (/roadster|speedster|boattail|convertible|cabriolet|drophead|phaeton| gt|comet|corsair|vesper|monarch|aurora|land-speed|tempest|skyline|regatta|prototype|berlinetta|drophead/.test(n)) return 'speedster';
  if (/limous|town car|landau|parade|brougham|sovereign|diplomat|ambassador|meridian|sedan de ville|sable|regent|grand touring|leviathan|spectre/.test(n)) return 'limo';
  if (/coupe|coup|runabout|business/.test(n)) return 'coupe';
  if (/junker|jalopy|hatch|pigeon|errand|county|volara|off-duty|cabbie|conductor/.test(n) && val < 6000) return 'junker';
  if (val >= 120000) return 'speedster';
  if (val >= 45000) return 'limo';
  if (val >= 12000) return 'coupe';
  if (val >= 2500) return 'sedan';
  return 'junker';
}
function carArt(c) {
  const h = hashId(c.id), val = Number(c.val) || 0, rare = !!c.rare;
  const tier = val < 2500 ? 0 : val < 12000 ? 1 : val < 40000 ? 2 : val < 120000 ? 3 : 4;
  const arch = carArchetype(c), acc = rare ? TEAL : GOLD, G = 116;
  const P = [shadow(120, 92, rare)];
  const gid = 'cg' + (h % 97);
  if (rare) P.push(glowDefs(gid));
  P.push(`<g${rare ? ` filter="url(#${gid})"` : ''}>`);
  const lamp = (x, y) => P.push(`<circle cx="${x}" cy="${y}" r="4" fill="${acc}" stroke="none"/>`);
  const wheel = (x, r, spoke) => { P.push(`<circle cx="${x}" cy="${G}" r="${r}"/>`); P.push(`<circle cx="${x}" cy="${G}" r="${r - (spoke ? 3 : 6)}" stroke="${rare ? TEAL : DIM}" stroke-width="${spoke ? 1 : 2}"/>`); if (spoke) for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; P.push(`<line x1="${x}" y1="${G}" x2="${(x + Math.cos(a) * (r - 3)).toFixed(1)}" y2="${(G + Math.sin(a) * (r - 3)).toFixed(1)}" stroke="${DIM}" stroke-width="1"/>`); } };
  const board = (a, b) => P.push(`<line x1="${a}" y1="${G - 8}" x2="${b}" y2="${G - 8}" stroke="${DIM}" stroke-width="2"/>`);
  const fender = (x, r) => P.push(`<path d="M${x - r - 4} ${G - 4} Q${x - r} ${G - r - 8} ${x} ${G - r - 9} Q${x + r} ${G - r - 8} ${x + r + 4} ${G - 4}" stroke="${GOLD}" stroke-width="2"/>`);

  if (arch === 'speedster') {                     // Auburn/Duesenberg boattail — long hood, pointed tail, low
    P.push(`<path d="M22 100 L36 92 L118 84 Q140 66 168 68 L190 82 Q216 90 214 100 Q212 108 202 106 L120 106 Q118 96 96 96 L60 96 Q40 96 34 106 Q24 106 22 100Z" fill="${FILL}"/>`);
    P.push(`<path d="M126 84 Q140 70 162 71 L182 82 Z" stroke="${DIM}" stroke-width="1.4"/>`);      // low windshield/tonneau
    P.push(`<path d="M190 82 Q214 88 214 100" stroke="${GOLD}" stroke-width="2"/>`);                // boattail
    P.push(`<line x1="40" y1="90" x2="118" y2="84" stroke="${DIM}" stroke-width="1.3"/>`);          // hood louvre line
    fender(64, 17); fender(184, 17);
    if (tier >= 3) P.push(`<circle cx="44" cy="${G - 8}" r="9" stroke="${DIM}" stroke-width="1.5"/>`); // side-mount spare in fender
    lamp(30, 90); wheel(64, 17, true); wheel(184, 17, true);
  } else if (arch === 'limo') {                    // long formal town car — tall upright cabin, landau
    P.push(`<path d="M24 104 L24 96 L44 92 Q52 66 96 64 L176 64 Q196 66 200 90 L216 94 L216 104 Z" fill="${FILL}"/>`);
    P.push(`<path d="M60 64 L64 46 L118 45 L120 64 M126 64 L128 46 L182 47 Q190 54 190 64" stroke="${DIM}" stroke-width="1.4"/>`); // 2 tall windows + division
    board(58, 186);
    P.push(`<path d="M150 48 q10 -6 12 6" stroke="${DIM}" stroke-width="1.4"/>`);                    // landau iron
    lamp(30, 92); if (tier >= 3) P.push(`<circle cx="46" cy="${G - 6}" r="8" stroke="${DIM}" stroke-width="1.5"/>`);
    wheel(66, 16); wheel(178, 16);
  } else if (arch === 'coupe') {                   // business coupe — short cabin forward, long deck
    P.push(`<path d="M28 104 L30 94 L54 90 Q62 66 104 66 L128 68 Q142 74 150 92 L206 96 L208 104 Z" fill="${FILL}"/>`);
    P.push(`<path d="M70 66 L76 50 L118 51 L128 68 Z" stroke="${DIM}" stroke-width="1.4"/>`);
    board(62, 176);
    lamp(34, 92); wheel(70, 16); wheel(178, 16);
  } else if (arch === 'truck') {                   // panel delivery / stakebed — short hood, tall box
    const van = (h & 1);
    if (van) { P.push(`<path d="M26 104 L26 60 L120 58 L120 78 L150 82 Q160 82 162 74 L186 74 Q200 74 200 90 L214 94 L214 104 Z" fill="${FILL}"/>`);
      P.push(`<rect x="34" y="66" width="76" height="30" stroke="${DIM}" stroke-width="1.3"/>`);      // cargo box side
      P.push(`<path d="M166 78 L170 66 L184 66 L186 76 Z" stroke="${DIM}" stroke-width="1.3"/>`); }    // cab window
    else { P.push(`<path d="M26 104 L28 82 Q34 66 68 66 L92 68 L96 82 L206 84 L206 104 Z" fill="${FILL}"/>`);
      P.push(`<path d="M40 66 L46 54 L86 55 L90 68 Z" stroke="${DIM}" stroke-width="1.3"/>`);          // cab
      P.push(`<rect x="100" y="72" width="100" height="14" stroke="${DIM}" stroke-width="1.2"/>`);    // flat bed / stakes
      for (let i = 0; i < 5; i++) P.push(`<line x1="${108 + i * 22}" y1="72" x2="${108 + i * 22}" y2="86" stroke="${DIM}" stroke-width="1"/>`); }
    lamp(32, 92); wheel(64, 16); wheel(180, 16);
  } else if (arch === 'armored') {                 // heavy armored sedan — thick, slit windows
    P.push(`<path d="M26 104 L28 92 L46 90 Q54 68 96 66 L172 66 Q192 68 196 90 L214 94 L214 104 Z" fill="${STEEL}"/>`);
    P.push(`<rect x="64" y="72" width="30" height="9" stroke="${DIM}" stroke-width="1.4"/>`);         // slit windows
    P.push(`<rect x="104" y="72" width="30" height="9" stroke="${DIM}" stroke-width="1.4"/>`);
    P.push(`<rect x="144" y="72" width="30" height="9" stroke="${DIM}" stroke-width="1.4"/>`);
    board(60, 182); P.push(`<path d="M28 92 L46 90" stroke="${GOLD}" stroke-width="3"/>`);             // heavy fender
    lamp(34, 92); wheel(66, 16); wheel(178, 16);
  } else if (arch === 'junker') {                  // Model-T jalopy — tall, narrow, spindly big wheels
    P.push(`<path d="M58 104 L58 92 L70 88 Q74 62 104 62 L140 63 Q150 66 152 90 L182 92 L182 104 Z" fill="${FILL}"/>`);
    P.push(`<path d="M80 62 L84 48 L138 49 L140 63 Z" stroke="${DIM}" stroke-width="1.4"/>`);
    P.push(`<line x1="120" y1="49" x2="120" y2="62" stroke="${DIM}" stroke-width="1.2"/>`);
    lamp(64, 84); wheel(78, 17, true); wheel(168, 17, true);
  } else {                                         // sedan — upright 4-window saloon, running boards
    P.push(`<path d="M28 104 L30 94 L50 90 Q58 66 100 64 L162 66 Q184 70 190 90 L210 94 L210 104 Z" fill="${FILL}"/>`);
    P.push(`<path d="M66 66 L72 50 L110 51 L112 66 M118 66 L120 51 L160 53 Q172 58 174 68" stroke="${DIM}" stroke-width="1.3"/>`);
    board(64, 180); lamp(34, 92); wheel(70, 16); wheel(176, 16);
  }
  P.push('</g>');
  return svg(P.join(''));
}

// ── BOATS ── distinct vessel types by id (rowboat / outboard skiff / fishing trawler / patrol cutter
// / cargo freighter / low speedboat) — period marine forms, differentiated silhouettes.
const BOAT_FORM = { dinghy: 'dinghy', skiff: 'skiff', trawler: 'trawler', cutter: 'cutter', freighter: 'freighter', cigarette: 'runner' };
function boatArt(b) {
  const hold = Number(b.hold) || 40, speed = Number(b.speed) || 30;
  const form = BOAT_FORM[b.id] || (speed >= 90 ? 'runner' : hold >= 100 ? 'freighter' : hold >= 60 ? 'trawler' : 'skiff');
  const D = 102, P = [];
  P.push(`<path d="M6 116 Q40 110 74 116 T138 116 T202 116 T236 114" stroke="#3a6f68" stroke-width="1.6"/>`);
  P.push(`<path d="M18 126 Q52 121 86 126 T150 126 T214 126" stroke="#26433f" stroke-width="1.4"/>`);
  if (form === 'dinghy') {                         // little rowboat
    P.push(`<path d="M74 ${D} Q120 ${D + 16} 166 ${D} L158 ${D + 8} Q120 ${D + 20} 82 ${D + 8} Z" fill="#12303c" stroke="${GOLD}"/>`);
    P.push(`<line x1="110" y1="${D + 4}" x2="132" y2="${D + 4}" stroke="${DIM}" stroke-width="1.4"/>`);   // thwart
    P.push(`<line x1="140" y1="${D + 2}" x2="176" y2="${D - 14}" stroke="${GOLD}" stroke-width="2"/>`);   // oar
  } else if (form === 'skiff') {                   // small open outboard runner
    P.push(`<path d="M60 ${D} L176 ${D - 4} Q186 ${D - 3} 182 ${D + 6} L70 ${D + 10} Q58 ${D + 8} 60 ${D}Z" fill="#12303c" stroke="${GOLD}"/>`);
    P.push(`<path d="M120 ${D - 4} L126 ${D - 16} L146 ${D - 15} L150 ${D - 3}" stroke="${GOLD}" stroke-width="1.6"/>`); // small windscreen
    P.push(`<path d="M60 ${D - 2} l-10 4 2 8 8 -2Z" fill="${FILL}" stroke="${GOLD}"/>`);                   // outboard motor
  } else if (form === 'trawler') {                 // fishing trawler — tall wheelhouse + mast/boom
    P.push(`<path d="M44 ${D} L196 ${D - 4} Q208 ${D - 2} 202 ${D + 10} L58 ${D + 12} Q42 ${D + 10} 44 ${D}Z" fill="#12303c" stroke="${GOLD}"/>`);
    P.push(`<rect x="70" y="${D - 26}" width="40" height="24" fill="${FILL}" stroke="${GOLD}"/>`);        // wheelhouse
    P.push(`<rect x="78" y="${D - 22}" width="10" height="9" stroke="${DIM}" stroke-width="1.2"/><rect x="94" y="${D - 22}" width="10" height="9" stroke="${DIM}" stroke-width="1.2"/>`);
    P.push(`<line x1="130" y1="${D - 2}" x2="130" y2="${D - 42}" stroke="${GOLD}" stroke-width="2"/>`);   // mast
    P.push(`<line x1="130" y1="${D - 34}" x2="168" y2="${D - 12}" stroke="${DIM}" stroke-width="1.6"/>`);// boom
  } else if (form === 'cutter') {                  // sleek patrol cutter — long low hull, raked bridge
    P.push(`<path d="M40 ${D} L192 ${D - 6} Q210 ${D - 4} 200 ${D + 8} L54 ${D + 10} Q38 ${D + 8} 40 ${D}Z" fill="#12303c" stroke="${GOLD}"/>`);
    P.push(`<path d="M96 ${D - 6} L104 ${D - 22} L138 ${D - 22} L146 ${D - 5} Z" fill="${FILL}" stroke="${GOLD}"/>`); // bridge
    P.push(`<line x1="120" y1="${D - 22}" x2="120" y2="${D - 40}" stroke="${GOLD}" stroke-width="1.6"/>`);// radio mast
    P.push(`<line x1="52" y1="${D - 3}" x2="188" y2="${D - 8}" stroke="${DIM}" stroke-width="1.3"/>`);
  } else if (form === 'freighter') {               // cargo freighter — high sides, funnel, hatches
    P.push(`<path d="M30 ${D - 4} L206 ${D - 8} L200 ${D + 12} L44 ${D + 12} Q30 ${D + 10} 30 ${D - 4}Z" fill="#12303c" stroke="${GOLD}"/>`);
    P.push(`<rect x="150" y="${D - 26}" width="34" height="22" fill="${FILL}" stroke="${GOLD}"/>`);       // aft superstructure
    P.push(`<rect x="162" y="${D - 40}" width="10" height="16" fill="${FILL}" stroke="${GOLD}"/>`);       // funnel
    for (let i = 0; i < 3; i++) P.push(`<rect x="${52 + i * 30}" y="${D - 12}" width="22" height="8" stroke="${DIM}" stroke-width="1.2"/>`); // cargo hatches
    P.push(`<line x1="100" y1="${D - 4}" x2="100" y2="${D - 30}" stroke="${GOLD}" stroke-width="1.6"/>`);// derrick
  } else {                                         // runner — low cigarette speedboat, spray
    P.push(`<path d="M40 ${D} L192 ${D - 4} Q214 ${D - 2} 206 ${D + 8} L96 ${D + 10} Q70 ${D + 8} 52 ${D + 6} L40 ${D}Z" fill="#12303c" stroke="${GOLD}"/>`);
    P.push(`<path d="M120 ${D - 4} Q126 ${D - 14} 140 ${D - 12} L154 ${D - 4} Z" fill="${FILL}" stroke="${GOLD}"/>`); // low cockpit
    P.push(`<path d="M188 ${D - 4} l14 -6 4 8" stroke-width="1.6"/>`);                                     // engine cowl
    P.push(`<path d="M40 ${D} q-14 2 -18 9" stroke="${TEAL}" stroke-width="1.6" opacity="0.75"/>`);       // spray
  }
  return svg(P.join(''));
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

// ── GUNS ── period iron by NAME (the catalog already says the type — "Drum-Fed"→a Tommy gun,
// "Street-Sweeper"→a shotgun, "Lever-Gun"→a carbine, "Silenced"→a suppressor) then by firepower.
function gunArchetype(g) {
  const n = (g.name || '').toLowerCase(), fp = Number(g.fp) || 5;
  if (/drum|belt|orchestra|chorus|thompson|chopper|tommy/.test(n)) return 'tommy';
  if (/trench|sweeper|doorbell|broom|shotgun|sawed|12g|scatter/.test(n)) return 'shotgun';
  if (/lever|rancher|carbine|long-case|undertaker|rifle/.test(n)) return 'rifle';
  if (/silenc|whisper|suppress/.test(n)) return 'suppressed';
  if (/revolver|snub|\.38|alley|badge|target|penny/.test(n) && fp < 30) return 'revolver';
  if (fp < 8) return 'pocket';
  if (fp < 34) return 'auto';
  if (fp < 50) return 'tommy';
  return 'rifle';
}
function gunArt(g) {
  const cash = Number(g.cash) || 500, arch = gunArchetype(g), acc = cash >= 100000 ? TEAL : GOLD;
  const P = [shadow(120, 74, cash >= 100000)];
  const sight = (x, y) => P.push(`<rect x="${x}" y="${y}" width="6" height="6" fill="${acc}" stroke="none"/>`);
  if (arch === 'pocket' || arch === 'auto' || arch === 'suppressed') {
    const L = arch === 'pocket' ? 92 : 148, x0 = 120 - L / 2, x1 = 120 + L / 2, sy = 72;
    P.push(`<path d="M${x0} ${sy} L${x1} ${sy} L${x1} ${sy + 14} L${x0 + L * 0.6} ${sy + 14} L${x0 + L * 0.6} ${sy + 20} L${x0 + 16} ${sy + 20} Q${x0 + 8} ${sy + 20} ${x0 + 7} ${sy + 14} L${x0} ${sy + 14} Z" fill="${STEEL}" stroke="${GOLD}"/>`);
    P.push(`<line x1="${x0 + 8}" y1="${sy + 5}" x2="${x1 - 6}" y2="${sy + 5}" stroke="${DIM}" stroke-width="1.4"/>`);
    sight(x0 + 10, sy - 6);
    const gx = x0 + L * 0.6;
    P.push(`<path d="M${gx} ${sy + 20} L${gx + 15} ${sy + 20} L${gx + 8} ${sy + 56} Q${gx + 6} ${sy + 62} ${gx} ${sy + 62} L${gx - 11} ${sy + 62} Q${gx - 17} ${sy + 62} ${gx - 15} ${sy + 56} Z" fill="${FILL}" stroke="${GOLD}"/>`);
    P.push(`<path d="M${gx - 17} ${sy + 20} Q${gx - 25} ${sy + 33} ${gx - 13} ${sy + 39} L${gx - 8} ${sy + 32}" stroke-width="1.8"/>`);
    if (arch === 'auto') P.push(`<path d="M${x1} ${sy} q9 -2 9 8" stroke-width="1.8"/>`);
    if (arch === 'suppressed') P.push(`<rect x="${x0 - 34}" y="${sy}" width="34" height="14" rx="6" fill="${FILL}" stroke="${GOLD}"/>`); // fat suppressor can
  } else if (arch === 'revolver') {
    P.push(`<path d="M60 72 L150 72 L150 84 L120 84 L120 90 L92 90 Q84 90 82 84 L60 84 Z" fill="${STEEL}" stroke="${GOLD}"/>`);
    P.push(`<circle cx="112" cy="82" r="12" fill="${FILL}" stroke="${GOLD}"/>`);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; P.push(`<circle cx="${(112 + Math.cos(a) * 6).toFixed(1)}" cy="${(82 + Math.sin(a) * 6).toFixed(1)}" r="1.6" stroke="${DIM}" stroke-width="1"/>`); }
    P.push(`<path d="M118 90 L134 90 L126 124 Q124 130 118 130 L108 130 Q102 130 104 124 Z" fill="${FILL}" stroke="${GOLD}"/>`);
    sight(66, 66);
  } else if (arch === 'tommy') {                  // the Thompson — foregrip + drum + straight stock
    P.push(`<path d="M40 66 L176 66 L176 80 L64 80 L64 88 L48 88 Q40 88 40 80 Z" fill="${STEEL}" stroke="${GOLD}"/>`); // receiver
    P.push(`<line x1="24" y1="70" x2="40" y2="70" stroke="${GOLD}" stroke-width="4"/>`);        // barrel + Cutts comp
    P.push(`<line x1="24" y1="66" x2="24" y2="74" stroke="${GOLD}" stroke-width="2"/>`);
    P.push(`<circle cx="92" cy="100" r="17" fill="${FILL}" stroke="${GOLD}"/><circle cx="92" cy="100" r="7" stroke="${DIM}" stroke-width="1.4"/>`); // drum
    P.push(`<path d="M60 80 L54 100 L64 100 L70 80 Z" fill="${FILL}" stroke="${GOLD}"/>`);       // front vertical foregrip
    P.push(`<path d="M138 80 L150 80 L144 108 Q142 112 138 112 L132 112 Z" fill="${FILL}" stroke="${GOLD}"/>`); // rear grip
    P.push(`<path d="M176 68 L214 74 L214 82 L176 78 Z" fill="${FILL}" stroke="${GOLD}"/>`);     // straight stock
    sight(50, 60);
  } else if (arch === 'shotgun') {                // side-by-side / trench gun — twin barrels + wood
    P.push(`<line x1="26" y1="74" x2="150" y2="74" stroke="${GOLD}" stroke-width="3"/>`);        // barrels
    P.push(`<line x1="26" y1="79" x2="150" y2="79" stroke="${GOLD}" stroke-width="3"/>`);
    P.push(`<path d="M150 70 L166 70 L166 86 L150 86 Z" fill="${STEEL}" stroke="${GOLD}"/>`);     // action
    P.push(`<path d="M166 72 L212 80 L212 92 Q212 96 206 96 L172 90 Z" fill="${FILL}" stroke="${GOLD}"/>`); // wood stock
    P.push(`<path d="M158 86 L168 86 L164 104 L154 104 Z" fill="${FILL}" stroke="${GOLD}"/>`);   // grip/trigger
    sight(30, 68);
  } else {                                        // rifle / carbine / violin-case long gun
    P.push(`<line x1="26" y1="76" x2="150" y2="76" stroke="${GOLD}" stroke-width="3"/>`);        // long barrel
    P.push(`<path d="M120 70 L166 70 L166 84 L128 88 Z" fill="${STEEL}" stroke="${GOLD}"/>`);     // receiver
    P.push(`<path d="M166 72 L214 80 L214 94 Q214 98 208 98 L172 90 Z" fill="${FILL}" stroke="${GOLD}"/>`); // wood stock
    P.push(`<path d="M138 88 Q132 100 144 106 L150 100" stroke="${GOLD}" stroke-width="1.8"/>`); // lever loop
    P.push(`<line x1="40" y1="72" x2="66" y2="72" stroke="${DIM}" stroke-width="5"/>`);          // fore-end
    sight(196, 64);
  }
  return svg(P.join(''));
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
// exported so the AI-art prompt generator (tools/art-prompts.js) assigns the SAME archetype an item's
// SVG gets — a painted set stays in lockstep with the vector set (same id → same body form).
export { carArchetype, gunArchetype, BOAT_FORM, DRUG_FORM };
