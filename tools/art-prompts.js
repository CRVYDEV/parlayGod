// tools/art-prompts.js — generate one AI-image prompt per catalog item, in lockstep with the SVG
// archetypes (same id → same body form). Writes art-prompts.json (machine — feed a batch runner) +
// art-prompts.md (human — skim/tweak). LEGAL: prompts describe real 1930s FORMS, never a brand name,
// model name, logo, or badge (the GTA playbook — period designs are unprotected; the marks are not).
// Run:  node tools/art-prompts.js  →  writes to ./art/
import { writeFileSync, mkdirSync } from 'node:fs';
import { CARS, PORT, DRUGS, GUNS, VESTS, GOODS } from '../src/rules.js';
import { carArchetype, gunArchetype, BOAT_FORM, DRUG_FORM } from '../src/assets.js';

// ── the LOCKED style guide — prepended to every prompt so the whole set reads as one hand ──
const STYLE = [
  'engraved single-line gold illustration on a near-black background',
  '1930s Prohibition-era noir, art-deco poster style',
  'single centered subject in clean side profile, filling the frame',
  'warm brass-gold linework (#c9a24b), subtle depth, faint shadow beneath',
  'no text, no numbers, no logos, no badges, no brand markings, no license plate, no watermark',
  'muted, restrained, elegant — a catalogue engraving, not a photo',
].join('; ');
const NEG = 'photo, photorealistic, 3D render, modern car, modern gun, brand logo, badge, text, watermark, license plate, people, background scenery, bright colors, cartoon';
const RARE = 'the finest example of its kind, a cold teal accent glow on the wheels/edges marking it as rare and coveted';

// real FORMS by archetype — evocative of specific period machines, never named
const CAR_FORM = {
  speedster: 'a long-hooded 1930s American classic boattail speedster, low and swooping, with sweeping cycle fenders, dual side-mount spare wheels, a raked windshield and polished wire wheels',
  limo: 'a long formal 1930s chauffeur town car, tall dignified cabin, division window, landau irons, whitewall tyres, running boards',
  coupe: 'a 1930s business coupe, short two-window cabin set forward over a long rounded rear deck, running boards',
  truck: 'a 1930s panel delivery truck / stakebed work truck, tall boxy cargo body, short hood, spoked wheels',
  armored: 'a heavy 1930s armored sedan, thick slab-sided body, narrow slit windows, reinforced fenders, sombre and menacing',
  junker: 'a battered late-1920s Model-T-style jalopy, tall narrow upright body, spindly big-spoked wheels, humble and worn',
  sedan: 'an upright 1930s four-door saloon, tall greenhouse with four windows, running boards, rounded fenders',
};
const GUN_FORM = {
  tommy: 'a Prohibition-era drum-magazine submachine gun, wooden foregrip, round drum magazine, straight wooden stock, muzzle compensator',
  shotgun: 'a 1930s side-by-side / trench shotgun, twin barrels, wooden stock and forend',
  rifle: 'a 1930s lever-action carbine / long rifle, wooden stock and forend, iron sights',
  suppressed: 'a 1930s semi-automatic pistol fitted with a fat cylindrical suppressor can',
  revolver: 'a snub-nose 1930s double-action revolver, exposed cylinder, checkered grip',
  pocket: 'a small 1930s pocket semi-automatic pistol, blued steel, checkered grip',
  auto: 'a full-size 1930s .45 semi-automatic pistol, exposed hammer, checkered grip',
};
const BOAT_FORM_DESC = {
  dinghy: 'a small wooden harbour rowboat, single oar',
  skiff: 'a small open wooden outboard runner boat',
  trawler: 'a converted wooden fishing trawler, tall wheelhouse, mast and boom',
  cutter: 'a sleek fast patrol cutter, low hull, raked bridge, radio mast',
  freighter: 'a small coastal cargo freighter, high steel sides, single funnel, cargo hatches and a derrick',
  runner: 'a long low mahogany speedboat (a "cigarette" runner), open cockpit, throwing spray',
};
const DRUG_FORM_DESC = {
  vial: 'a small stoppered glass vial of glowing liquid, a wax seal', ampoule: 'a slender sealed glass ampoule of luminous fluid',
  brick: 'a taped brick of powder wrapped in wax paper, a stamped mark', pills: 'a small pile of stamped pills',
  powder: 'a folded paper packet spilling fine powder', blotter: 'a printed sheet of perforated blotter tabs',
  jar: 'a corked apothecary jar of tonic', baggie: 'a small tied cloth pouch of product, a wax seal',
};

const flavor = (it) => (it.desc || it.tag || it.blurb || '').replace(/["\n]/g, ' ').trim();
const line = (subject, it, rare) =>
  `${subject}. ${STYLE}${rare ? '; ' + RARE : ''}${flavor(it) ? `. mood: ${flavor(it)}` : ''}`;

const rows = [];
for (const c of CARS) rows.push({ kind: 'car', id: c.id, name: c.name, archetype: carArchetype(c),
  rare: !!c.rare, prompt: line(CAR_FORM[carArchetype(c)] || CAR_FORM.sedan, c, c.rare) });
for (const b of PORT.BOATS) { const f = BOAT_FORM[b.id] || 'skiff'; rows.push({ kind: 'boat', id: b.id, name: b.name,
  archetype: f, rare: false, prompt: line(BOAT_FORM_DESC[f], b, false) }); }
for (const d of DRUGS) { const f = DRUG_FORM[d.id] || 'baggie'; rows.push({ kind: 'drug', id: d.id, name: d.name,
  archetype: f, rare: (Number(d.unlock) || 0) >= 3, prompt: line(DRUG_FORM_DESC[f], d, (Number(d.unlock) || 0) >= 3) }); }
for (const g of GUNS) { const f = gunArchetype(g); rows.push({ kind: 'gun', id: g.id, name: g.name,
  archetype: f, rare: (Number(g.cash) || 0) >= 100000, prompt: line(GUN_FORM[f], g, (Number(g.cash) || 0) >= 100000) }); }
for (const v of VESTS) rows.push({ kind: 'vest', id: v.id, name: v.name, archetype: 'vest', rare: (Number(v.mult) || 1) >= 1.4,
  prompt: line('a 1930s body-armour vest / bulletproof waistcoat, steel plating panels', v, (Number(v.mult) || 1) >= 1.4) });
for (const g of GOODS) rows.push({ kind: 'good', id: g.id, name: g.name, archetype: 'crate', rare: false,
  prompt: line('a stamped wooden shipping crate of contraband goods, a wax shipping seal', g, false) });

mkdirSync('art', { recursive: true });
writeFileSync('art/art-prompts.json', JSON.stringify({ style: STYLE, negative: NEG, count: rows.length, items: rows }, null, 2));
const md = ['# OMERTÀ — AI item-art prompts', '',
  'One prompt per catalog item, matched to the SVG archetype (same id → same form). Every prompt',
  'describes a real 1930s **form**, never a brand/model/logo — the output must carry no badges or text.',
  '', `**Shared style:** ${STYLE}`, '', `**Negative prompt:** ${NEG}`, '',
  '| kind | id | name | form | rare | prompt |', '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.kind} | ${r.id} | ${r.name.replace(/\|/g, '/')} | ${r.archetype} | ${r.rare ? '★' : ''} | ${r.prompt.replace(/\|/g, '/')} |`),
].join('\n');
writeFileSync('art/art-prompts.md', md);
console.log(`wrote art/art-prompts.json + art/art-prompts.md — ${rows.length} prompts (${rows.filter((r) => r.rare).length} rare)`);
