// src/portrait.js — THE MADE MAN, phase 1: the bloodline portrait, entirely off-chain.
//
// `omerta-identity-nft-design.md` §5 sequences this deliberately: the portrait ships FIRST, with no
// gates, because it is most of the value and it needs no token, no wallet and no chain — and because
// it generates the thing the token would later point at, so the ordering is not a compromise. The
// contract half (step 6's other leg) waits on an open launch-checklist row and on the third-party
// audit BATCH, which the dynasty design says to batch rather than dribble.
//
// ── ARCHITECTURE: layered composition (design §2, approach 2) ──
// Six slots composited back-to-front, assembled live from game state, ~0 cost per read. The design
// assumed the parts would be pre-generated plates; they are DRAWN instead, for two reasons that are
// constraints rather than preferences: the art budget stands at $11.12 of a $12 cap (38 plates would
// need ~$1.90) and there is no FAL_KEY in this environment, so generated parts were not on the table.
// Procedural is also the proven shape here — `src/avatar.js` ships deterministic noir SVG already.
// The compositor does not care where a part came from: any slot's variant can be swapped for a
// generated plate later without touching the assembly, which is the whole point of slotting it.
//
// ── THE BRIGHT LINE, and it is narrower than the design's own slot table ──
// The design's §4 states the constraint exactly right — *"a free, permanently-public, indexed-by-
// every-marketplace blob must be AT MOST as revealing as the paid one"* — and then §3's slot table
// violates it in two places. This module holds the line instead:
//
//   the portrait encodes ONLY what `cards.js:publicDossier` already discloses,
//   plus per-character deterministic art variety.
//
// What that changed, and why each is not a downgrade:
//   • BACKDROP was "home district". There is no home district in this game — only live `loc`, which
//     is precisely what the Wire's PAID tap sells. A keyless image keyed on it is a position tracker
//     a hunter can poll. It is now deterministic from the character id: the corner this street came
//     up on, fixed at birth. Same eight-way art variety, zero leak.
//   • FIGURE was "build (muscle/cunning/speed dominant)". Build is on no public surface, and not even
//     on the paid dossier. Now deterministic too.
//   • EFFECTS drops the rat mark. `wanted`/`welsher` are on publicDossier; `rat` is a PAID Wire flag,
//     and the design's "a broken frame for a rat" would have given it away for free.
//   • FRAME was "dynasty tier + estate tier" — and `dynastyTierOf` DOES NOT EXIST: it went with the
//     Portfolio at D11, which the design's own 2026-08-10 banner flags as needing a re-source before
//     any metadata is frozen. Re-sourced to GENERATION (public, account-level, survives death), which
//     is thematically the better answer anyway: the frame is the bloodline's age, pawn-shop wood
//     deepening to gilt as the generations stack.
//
// What still moves with play, so the thing visibly rewards playing: ATTIRE climbs the ten `RANKS`,
// EFFECTS light on hitman rank and on going wanted or welshing, and FRAME + PLATE deepen every time
// the bloodline buries someone.
//
// ── SAFETY: this one renders text, which avatar.js never does ──
// avatar.js is injection-proof by construction because the seed is hash-only. The PLATE engraves the
// street name, the dynasty name and the family tag — untrusted strings on a public keyless route — so
// every one goes through `esc`, the same discipline `cards.js` uses on the profile page. SVG ids are
// suffixed from the seed hash: two portraits on one page with a shared `clipPath` id would clip each
// other, and the console renders these in a grid.
//
// ZERO §10.4: art moves no value and writes no ledger row.
import { hashId } from './assets.js';
import { RANKS, rankIdxOf, levelOf, hitmanRankOf } from './rules.js';
// the ONE escape, shared with the profile page rather than copied (see cards.js)
import { esc } from './cards.js';

// ── palettes ──────────────────────────────────────────────────────────────────────────────────
// Muted deliberately. The avatar's brighter skins read fine at 64px; at portrait scale a flat lit
// oval reads as clip-art, so the face is carried by the LIGHT (a hard key from the left, the brim's
// shadow across the eyes) rather than by its fill — which is what the genre actually looks like.
const SKINS = ['#b8926b', '#a88964', '#96754f', '#7d5c3c', '#634629', '#4a3420'];
const HATS  = ['#191c24', '#23262f', '#33291d', '#3a2626', '#1e2830', '#2a2130'];
const ACC   = ['#c9a24b', '#4fd6c2', '#b8504a', '#5a8fd6', '#c98a4b', '#9a7f4b'];

// BACKDROP (8) — the corner this street came up on. Deterministic; never live position.
const BACKDROPS = [
  { id: 'alley',     sky: '#0d1014', glow: '#1b2732', name: 'The Alley' },
  { id: 'waterfront',sky: '#0b1116', glow: '#16303a', name: 'The Waterfront' },
  { id: 'neon',      sky: '#120c16', glow: '#3a1740', name: 'Under the Neon' },
  { id: 'chapel',    sky: '#0e0d12', glow: '#2a2233', name: 'Chapel Shadow' },
  { id: 'foundry',   sky: '#12100b', glow: '#3a2a12', name: 'The Foundry' },
  { id: 'canal',     sky: '#0a1113', glow: '#153033', name: 'Canal Fog' },
  { id: 'rooftops',  sky: '#0c0f16', glow: '#1d2440', name: 'The Rooftops' },
  { id: 'lockup',    sky: '#101013', glow: '#2b2b2e', name: 'Back of the Lockup' },
];

// FIGURE (6) — silhouette + posture. Deterministic; never build.
const FIGURES = [
  { id: 'square',   lean: 0,    shoulder: 1.00, name: 'Squared Up' },
  { id: 'turned',   lean: -4,   shoulder: 1.06, name: 'Turned Away' },
  { id: 'lean',     lean: 5,    shoulder: 0.96, name: 'Leaning In' },
  { id: 'hunched',  lean: 2,    shoulder: 1.10, name: 'Collar Up' },
  { id: 'straight', lean: -2,   shoulder: 0.92, name: 'Straight Backed' },
  { id: 'looming',  lean: 3,    shoulder: 1.14, name: 'Looming' },
];

// FRAME (6) — the BLOODLINE's age. Re-sourced from the retired `dynastyTierOf` to GENERATION.
const FRAMES = [
  { upTo: 1,        wood: '#2a2018', trim: '#4a3a26', name: 'Pawn-Shop Pine' },
  { upTo: 2,        wood: '#2f2119', trim: '#5c452a', name: 'Stained Oak' },
  { upTo: 4,        wood: '#332218', trim: '#7a5a2e', name: 'Lacquered Walnut' },
  { upTo: 7,        wood: '#2e2415', trim: '#9c7530', name: 'Brass Filigree' },
  { upTo: 12,       wood: '#2b2411', trim: '#c09338', name: 'Silvered Ebony' },
  { upTo: Infinity, wood: '#2a2410', trim: '#e0b64a', name: 'Gilt' },
];

const bytesOf = (seed) => {
  const h = hashId('pt:' + String(seed == null ? '' : seed));
  const g = hashId('pt2:' + String(seed == null ? '' : seed));
  return [h & 255, (h >> 8) & 255, (h >> 16) & 255, (h >> 24) & 255, g & 255, (g >> 8) & 255, (g >> 16) & 255, (g >> 24) & 255];
};

// ── the STATE — every field here must be public (see the bright line above) ───────────────────
// `d` is a publicDossier-shaped object; nothing else is read, which is what makes the rule checkable.
export function portraitStateOf(d = {}) {
  const seed = String(d.id || d.name || '');
  const b = bytesOf(seed);
  const gen = Math.max(1, Number(d.generation) || 1);
  const level = Math.max(1, Number(d.level) || 1);
  const rank = RANKS[Math.max(0, Math.min(RANKS.length - 1, rankIdxOf(level)))];
  return {
    seed,
    backdrop: BACKDROPS[b[0] % BACKDROPS.length],
    figure: FIGURES[b[1] % FIGURES.length],
    frame: FRAMES.find((f) => gen <= f.upTo) || FRAMES[FRAMES.length - 1],
    skin: SKINS[b[2] % SKINS.length],
    hat: HATS[b[3] % HATS.length],
    acc: ACC[b[4] % ACC.length],
    brim: 30 + (b[5] % 14),
    jaw: 19 + (b[6] % 6),
    stubble: (b[7] % 3) === 0,
    level,
    rank: rank ? rank.name : 'STREET THUG',
    rankIdx: Math.max(0, Math.min(RANKS.length - 1, rankIdxOf(level))),
    generation: gen,
    name: d.name || 'UNKNOWN',
    dynasty: d.dynasty || null,
    tag: d.tag || null,
    // EFFECTS — public flags only. `rat` is deliberately absent: it is a PAID Wire signal.
    wanted: !!d.wanted,
    welsher: !!d.welsher,
    hitman: d.hitmanRank || null,
    alive: d.alive !== false,
  };
}

// how deep the attire reads — the ten RANKS drive lapel/collar/coat richness
const attireOf = (i) => ({
  coat: ['#151821', '#181b24', '#1b1e26', '#1e2029', '#20222c', '#23252f', '#262832', '#2a2b36', '#2d2e3a', '#31323f'][i] || '#151821',
  lapel: i >= 6, pocketSquare: i >= 4, tiepin: i >= 8,
});

export function portraitSvg(state, size = 300) {
  const s = state && state.backdrop ? state : portraitStateOf(state || {});
  const px = Math.max(60, Math.min(1200, Number(size) || 300));
  const uid = (hashId('uid:' + s.seed) >>> 0).toString(36).slice(0, 6);
  const at = attireOf(s.rankIdx);
  const W = 300, H = 400, X = 22, Y = 22, IW = 256, IH = 286; // frame window

  // ── backdrop: sky wash + a lamp glow + a skyline, all inside the window ──
  const skyline = [];
  const sb = bytesOf(s.seed + ':sky');
  for (let i = 0; i < 9; i++) {
    const bw = 18 + (sb[i % sb.length] % 22);
    const bh = 40 + ((sb[(i + 3) % sb.length] * (i + 1)) % 110);
    const bx = X + i * 30 - 6;
    skyline.push(`<rect x="${bx}" y="${Y + IH - bh}" width="${bw}" height="${bh}" fill="#000" opacity="0.55"/>`);
    // a couple of lit windows so the city reads as inhabited
    if ((sb[i % sb.length] % 3) === 0) skyline.push(`<rect x="${bx + 5}" y="${Y + IH - bh + 9}" width="4" height="6" fill="${s.acc}" opacity="0.5"/>`);
  }

  // ── the bust, drawn in a 100×100 space and transformed into the window ──
  const jaw = s.jaw, brim = s.brim;
  const bust = [
    `<path d="M${8 * s.figure.shoulder + (50 - 50 * s.figure.shoulder)} 100 Q8 68 50 68 Q92 68 ${92 * s.figure.shoulder + (50 - 50 * s.figure.shoulder)} 100 Z" fill="${at.coat}"/>`,
    at.lapel ? `<path d="M38 70 L50 86 L44 100 L34 100 Z" fill="#000" opacity="0.35"/><path d="M62 70 L50 86 L56 100 L66 100 Z" fill="#000" opacity="0.35"/>` : '',
    `<path d="M40 71 L50 83 L44 91 Z" fill="#d7d2c4"/><path d="M60 71 L50 83 L56 91 Z" fill="#d7d2c4"/>`,
    `<path d="M50 83 L46 100 L54 100 Z" fill="${s.acc}"/>`,
    at.tiepin ? `<rect x="47" y="92" width="6" height="1.6" fill="#e6d9a8"/>` : '',
    at.pocketSquare ? `<rect x="70" y="80" width="7" height="4" fill="${s.acc}" opacity="0.85"/>` : '',
    `<rect x="44" y="59" width="12" height="14" fill="${s.skin}"/>`,
    `<path d="M44 59 h12 v6 h-12 Z" fill="#000" opacity="0.4"/>`, // the collar's shadow on the throat
    `<path d="M${50 - jaw} 44 Q${50 - jaw} 66 50 68 Q${50 + jaw} 66 ${50 + jaw} 44 Q${50 + jaw} 29 50 29 Q${50 - jaw} 29 ${50 - jaw} 44 Z" fill="${s.skin}"/>`,
    // THE NOIR FACE: the brim throws a hard band of shadow across the eyes, the key light from the
    // left catches one cheek, and the far side falls away. The eyes are glints INSIDE the shadow —
    // two dots on a lit oval read as a smiley, which is what the first cut looked like.
    // The brim's shadow must FADE, not end. A hard-edged band with two glints in it reads as a domino
    // mask (which is what the second cut looked like) — light falling across a face has no lower edge.
    `<path d="M${50 - jaw} 44 Q${50 - jaw} 29 50 29 Q${50 + jaw} 29 ${50 + jaw} 44 L${50 + jaw} 56 Q50 60 ${50 - jaw} 56 Z" fill="url(#sh${uid})"/>`,
    `<path d="M50 29 Q${50 + jaw} 29 ${50 + jaw} 44 Q${50 + jaw} 66 50 68 Z" fill="#000" opacity="0.3"/>`,
    `<path d="M${50 - jaw} 44 Q${50 - jaw} 34 ${50 - jaw + 6} 31 L${50 - jaw + 3} 33 Q${50 - jaw + 2} 46 ${50 - jaw + 4} 56 Z" fill="#fff" opacity="0.13"/>`,
    // eyes: barely-there catchlights deep in the shadow, the far one nearly gone. Enough to read as
    // a man looking at you; not enough to draw as two dots.
    `<ellipse cx="43.5" cy="43" rx="1.2" ry="1" fill="#cfc6b6" opacity="0.34"/><ellipse cx="56.5" cy="43" rx="1.2" ry="1" fill="#cfc6b6" opacity="0.18"/>`,
    s.stubble ? `<path d="M${50 - jaw + 3} 52 Q50 70 ${50 + jaw - 3} 52 Q50 63 ${50 - jaw + 3} 52 Z" fill="#000" opacity="0.3"/>` : '',
    `<path d="M46 60 Q50 61.5 54 60" stroke="#000" stroke-width="1.1" opacity="0.35" fill="none"/>`,
    `<ellipse cx="50" cy="30" rx="${brim}" ry="7.5" fill="${s.hat}"/>`,
    `<path d="M33 30 Q33 11 50 11 Q67 11 67 30 Z" fill="${s.hat}"/>`,
    `<rect x="33" y="26" width="34" height="4" fill="${s.acc}" opacity="0.85"/>`,
  ].join('');

  // ── effects — public flags only ──
  const fx = [];
  // the hard noir key light from the left, always
  fx.push(`<path d="M${X} ${Y} L${X + 96} ${Y} L${X + 42} ${Y + IH} L${X} ${Y + IH} Z" fill="#fff" opacity="0.045"/>`);
  if (s.hitman) fx.push(`<ellipse cx="${X + IW / 2}" cy="${Y + 96}" rx="86" ry="80" fill="none" stroke="${s.acc}" stroke-width="1" opacity="0.25"/>`);
  if (s.wanted) fx.push(
    `<g transform="rotate(-13 ${X + IW / 2} ${Y + 62})"><rect x="${X + 42}" y="${Y + 44}" width="172" height="36" fill="none" stroke="#b8504a" stroke-width="3" opacity="0.85"/>`
    + `<text x="${X + IW / 2}" y="${Y + 70}" text-anchor="middle" font-family="Georgia,serif" font-size="26" letter-spacing="6" fill="#b8504a" opacity="0.9">WANTED</text></g>`);
  if (s.welsher) fx.push(`<path d="M${X + 14} ${Y + IH - 14} L${X + IW - 14} ${Y + 14}" stroke="#7a2f2c" stroke-width="5" opacity="0.6"/>`);
  if (!s.alive) fx.push(`<rect x="${X}" y="${Y}" width="${IW}" height="${IH}" fill="#000" opacity="0.45"/>`);
  // cigarette smoke — a soft drifting curl, the genre's signature
  fx.push(`<path d="M${X + 176} ${Y + 150} Q${X + 196} ${Y + 116} ${X + 178} ${Y + 84} Q${X + 162} ${Y + 56} ${X + 186} ${Y + 30}" fill="none" stroke="#cfd6dd" stroke-width="2" opacity="0.12"/>`);
  // vignette
  fx.push(`<rect x="${X}" y="${Y}" width="${IW}" height="${IH}" fill="url(#v${uid})"/>`);

  // ── the plate — ENGRAVED TEXT. Every string here is untrusted and escaped. ──
  // Roman only where a reader parses it at a glance; past X the numeral is worse than the number.
  // (The first cut clamped the INDEX, so a twelfth-generation line was engraved "GEN X" — wrong, and
  // engraved wrong, which is the one place a lie is permanent.)
  const roman = s.generation <= 10
    ? ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][s.generation] : String(s.generation);
  // The plate is a fixed 256px wide and the strings are untrusted and unbounded, so the subtitle is
  // CLAMPED rather than left to overflow the frame (a 24-char living name plus a long dynasty ran off
  // the edge in the first cut). Georgia at 9px with 2px tracking averages ~6.3px/char.
  const clamp = (str, n) => (str.length > n ? str.slice(0, n - 1) + '…' : str);
  const sub = clamp([s.rank, s.dynasty || null, s.tag ? `[${s.tag}]` : null, `GEN ${roman}`]
    .filter(Boolean).join(' · '), 38);
  const plate = [
    `<rect x="${X}" y="${Y + IH + 10}" width="${IW}" height="52" fill="#17140f" stroke="${s.frame.trim}" stroke-width="1" opacity="0.95"/>`,
    `<text x="${W / 2}" y="${Y + IH + 32}" text-anchor="middle" font-family="Georgia,serif" font-size="19" letter-spacing="1.5" fill="#e8dfc8">${esc(clamp(s.name, 24))}</text>`,
    // legibility: the subtitle used the FRAME's trim colour, which on pawn-shop pine is dark brown on
    // near-black and could not be read at all. A warm off-white reads on every frame in the ladder.
    `<text x="${W / 2}" y="${Y + IH + 48}" text-anchor="middle" font-family="Georgia,serif" font-size="9" letter-spacing="2" fill="#cbbfa3">${esc(sub)}</text>`,
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${px}" height="${Math.round(px * H / W)}" role="img" aria-label="Noir portrait of ${esc(s.name)}, ${esc(s.rank)}, generation ${s.generation}">`
    + `<defs><clipPath id="w${uid}"><rect x="${X}" y="${Y}" width="${IW}" height="${IH}"/></clipPath>`
    + `<radialGradient id="v${uid}" cx="50%" cy="42%" r="72%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.72"/></radialGradient>`
    + `<radialGradient id="g${uid}" cx="26%" cy="18%" r="70%"><stop offset="0%" stop-color="${s.backdrop.glow}" stop-opacity="0.95"/><stop offset="100%" stop-color="${s.backdrop.sky}" stop-opacity="1"/></radialGradient>`
    // the brim's shadow, in the shadow path's own bounding box: dark at the hat line, gone by the cheek
    + `<linearGradient id="sh${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0.78"/><stop offset="48%" stop-color="#000" stop-opacity="0.62"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></linearGradient></defs>`
    // frame
    + `<rect width="${W}" height="${H}" fill="${s.frame.wood}"/>`
    + `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${s.frame.trim}" stroke-width="2" opacity="0.8"/>`
    + `<rect x="${X - 4}" y="${Y - 4}" width="${IW + 8}" height="${IH + 8}" fill="none" stroke="${s.frame.trim}" stroke-width="1" opacity="0.5"/>`
    // window
    + `<g clip-path="url(#w${uid})">`
    + `<rect x="${X}" y="${Y}" width="${IW}" height="${IH}" fill="url(#g${uid})"/>`
    + skyline.join('')
    + `<g transform="translate(${X + 28} ${Y + 74}) scale(2.0) rotate(${s.figure.lean} 50 60)">${bust}</g>`
    + fx.join('')
    + `</g>`
    + plate
    + `</svg>`;
}

// ── the traits — phase 2's metadata shape, and the dossier's today ───────────────────────────
// Every entry is public by the bright line. WEALTH IS ABSENT IN ANY FORM (design §4's hard rule),
// and so is anything a hunter could price a kill from.
export function portraitTraits(state) {
  const s = state && state.backdrop ? state : portraitStateOf(state || {});
  const out = [
    { trait_type: 'Generation', value: s.generation },
    { trait_type: 'Rank', value: s.rank },
    { trait_type: 'Frame', value: s.frame.name },
    { trait_type: 'Corner', value: s.backdrop.name },
    { trait_type: 'Bearing', value: s.figure.name },
  ];
  if (s.hitman) out.push({ trait_type: 'Assassin', value: s.hitman });
  if (s.dynasty) out.push({ trait_type: 'Dynasty', value: s.dynasty });
  if (s.tag) out.push({ trait_type: 'Family', value: s.tag });
  // One value per trait_type — ERC-721 metadata consumers keep only one entry per type, so a
  // wanted welsher must not emit two 'Notoriety' rows (one flag would silently disappear).
  if (s.wanted || s.welsher) {
    out.push({ trait_type: 'Notoriety', value: s.wanted && s.welsher ? 'Wanted · Welsher' : s.wanted ? 'Wanted' : 'Welsher' });
  }
  return out;
}

// The public row the route reads. Deliberately the SAME shape publicDossier returns, so the
// portrait cannot encode a field the public dossier does not already disclose — the bright line is
// enforced by there being nothing else in scope.
export async function portraitRow(pool, characterId) {
  const row = (await pool.query(
    `SELECT c.id, c.name, c.respect, c.alive, c.wanted_until, c.welsher,
            ap.hitman_rep, ap.dynasty_name, ap.deaths,
            g.tag AS tag
       FROM characters c
       LEFT JOIN account_persistent ap ON ap.account_id = c.account_id
       LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN gangs g ON g.id = gm.gang_id
      WHERE c.id = $1 LIMIT 1`, [String(characterId || '')])).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    level: levelOf(Number(row.respect) || 0),
    alive: !!row.alive,
    wanted: !!(row.wanted_until && new Date(row.wanted_until) > new Date()),
    welsher: !!row.welsher,
    hitmanRank: Number(row.hitman_rep) > 0 ? hitmanRankOf(Number(row.hitman_rep)).title : null,
    dynasty: row.dynasty_name || null,
    tag: row.tag || null,
    generation: (Number(row.deaths) || 0) + 1,
  };
}
