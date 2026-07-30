#!/usr/bin/env node
// THE ART GENERATOR — every image the game needs, from one manifest.
//
//   node tools/art.js                 generate everything missing
//   node tools/art.js hero-a          generate/regenerate one id
//   node tools/art.js --force <id>    re-roll something that already exists
//   node tools/art.js --list          what is in the manifest and what exists
//
// Needs FAL_KEY (or --key-file). Spend is tracked against a HARD CAP so an
// unattended run cannot drain the account: it stops and says so.
//
// WHY THE PROMPTS LOOK LIKE THIS. Two lessons paid for in real generations:
//
//  1. `no text` is not a negative prompt. Flux has no true negative conditioning,
//     so "no text" is a suggestion it ignores whenever the scene implies signage —
//     the first ultra roll came back with gibberish street signs AND a hallucinated
//     photographer's watermark. The fix is not to ask harder. It is to stop
//     describing things that carry writing: no marquees, no shopfronts, no street
//     signs, no posters. Describe the LIGHT instead of the sign making it.
//
//  2. Composition has to be prompted for the JOB. A landing hero needs the subject
//     low and the top empty, because a headline goes there. A social card needs a
//     quiet middle, because a name and a stat line go there. "A cool noir street"
//     gives you neither.
//
// House palette: teal and amber on charcoal, matching the console. Not decoration —
// it is what makes generated art sit inside the game instead of beside it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node's built-in fetch (undici) does NOT read HTTPS_PROXY by default, so in a sandbox that
// egresses through a proxy every request 403s with "Host not in allowlist" while curl to the SAME
// host at the SAME moment returns 200 — which reads exactly like a network-policy problem and sent
// me chasing one twice. It is a client difference.
//
// Setting process.env.NODE_USE_ENV_PROXY here does NOT work: undici reads it when it initialises,
// which is before any line of this file runs. So re-exec once with it set. (That is the whole
// reason this is a spawn and not an assignment.)
if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1') {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'art');
const LEDGER = path.join(OUT, 'manifest.json');

const CAP_USD = Number(process.env.ART_CAP_USD || 12);
const PRICE = { 'fal-ai/flux-pro/v1.1': 0.04, 'fal-ai/flux-pro/v1.1-ultra': 0.06 };
const ULTRA = 'fal-ai/flux-pro/v1.1-ultra';
const PRO = 'fal-ai/flux-pro/v1.1';

// ── the shared vocabulary ───────────────────────────────────────────────────────
const NOIR = '1940s American noir, hard chiaroscuro, deep shadow, teal and amber light on wet asphalt, '
  + 'film grain, anamorphic haze, muted desaturated palette, cinematic wide lens, unpeopled, '
  + 'no signage, no lettering, no writing anywhere, no watermark';
const WARM = 'warm amber key light against cold teal shadow, the amber dominant';
const COLD = 'cold teal and steel blue dominant, a single small amber source';

// ── the manifest ────────────────────────────────────────────────────────────────
// `job` documents what each image has to survive, which is what I judge it against.
const MANIFEST = [
  // ═══ HEROES — the two directions, both wanted ═══
  { id: 'hero-poster', model: ULTRA, ar: '21:9', job: 'drama; carries itself with no copy over it',
    prompt: `a lone 1940s mafioso in a charcoal double-breasted suit and fedora seen from behind, filling the lower third of frame, walking away down a rain-flooded cobbled street, a single amber streetlamp throwing a long reflection across the wet stones, drifting fog, tenement brickwork either side lit only by window glow, ${WARM}, ${NOIR}` },
  { id: 'hero-backdrop', model: ULTRA, ar: '21:9', job: 'landing backdrop; the top third must stay empty for a headline',
    prompt: `an empty rain-flooded cobbled street at night receding into fog, a small distant figure in a fedora far down the street, the entire upper half of the frame dark empty sky and unlit brick, one amber streetlamp low in frame throwing a long reflection, heavy negative space above, ${COLD}, ${NOIR}` },

  // ═══ BROADCAST CARDS — 1200×630, quiet middle, these unfurl on X ═══
  { id: 'card-legend', model: PRO, ar: '16:9', job: 'a name + rank + stats render over the middle',
    prompt: `a rain-slicked empty street at night in deep one-point perspective, brick tenements either side receding, amber streetlamps down both sides, the centre of frame dark open fog with nothing in it, ${WARM}, ${NOIR}` },
  { id: 'card-wanted', model: PRO, ar: '16:9', job: 'red accent; a bounty figure renders over the middle',
    prompt: `a dark weathered brick wall at night lit hard from the upper left by a single bare bulb, deep shadow filling the right side, rain streaking the brickwork, a faint red glow spilling in low from off-frame, the middle of the wall bare and unlit, charcoal and deep red, ${NOIR}` },
  { id: 'card-whacked', model: PRO, ar: '16:9', job: 'a kill notice; bleak, empty centre',
    prompt: `wet cobblestones at night seen from low angle, a dropped fedora lying in a puddle, amber lamplight reflected in the water, the rest of frame dark and empty, rain, ${COLD}, ${NOIR}` },
  { id: 'card-join', model: PRO, ar: '16:9', job: 'the fallback card; invitational rather than bleak',
    prompt: `a heavy open door in a brick wall at night with warm amber light flooding out across wet cobbles, the doorway centred and small, thick darkness pressing in on all sides, steam rising, rain, ${WARM}, ${NOIR}` },

  // ═══ DISTRICT PLATES — tab backdrops, text lands on them ═══
  { id: 'district-docks', model: PRO, ar: '16:9', job: 'docks tab backdrop',
    prompt: `harbour cargo cranes and stacked wooden crates in heavy fog at night, a freighter silhouette on black oil-slick water, lantern light pooling on wet boards, ${COLD}, ${NOIR}` },
  { id: 'district-neon', model: PRO, ar: '16:9', job: 'the Neon Mile — light without a single legible sign',
    prompt: `a wet boulevard at night lit by rows of glowing coloured bulbs and blank illuminated glass panels, every reflection doubled in the standing water, one black sedan parked at the kerb, ${WARM}, ${NOIR}` },
  { id: 'district-cathedral', model: PRO, ar: '16:9', job: 'cathedral district',
    prompt: `a soot-blackened gothic church looming over an empty rain-wet square at night, one rose window lit from within in amber, pigeons, fog between the buttresses, ${COLD}, ${NOIR}` },
  { id: 'district-foundry', model: PRO, ar: '16:9', job: 'foundry district',
    prompt: `a heavy ironworks at night seen from outside, orange furnace glare blazing through grated windows, chains and catwalks in silhouette, steam, wet ground, ${WARM}, ${NOIR}` },
  { id: 'district-canal', model: PRO, ar: '16:9', job: 'canal district',
    prompt: `a narrow canal between the backs of brick tenements at night, a low stone bridge, mist lying on black water, a single moored skiff, one amber lamp on the bridge, ${COLD}, ${NOIR}` },
  { id: 'district-brick', model: PRO, ar: '16:9', job: 'the Brick — residential, the on-ramp district',
    prompt: `a tight residential street of brick walk-ups at night, iron fire escapes zigzagging up the facades, wet stoops, washing lines strung overhead, warm window light, ${WARM}, ${NOIR}` },

  // THE FREIGHT GAME (task #309, founder: trade goods as a core theme) — the hero for the Streets
  // trade section + the tour/primer card: the whole loop in one frame (buy low, haul, sell high)
  { id: 'interior-trade', model: PRO, ar: '16:9', job: 'the Trade Goods section — the freight game',
    prompt: `a dockside freight warehouse at night, tall stacks of wooden crates and burlap sacks on a loading platform, a hand truck loaded with cases, a clipboard manifest nailed to a post, a truck backed up to the dock with its doors open, one amber loading lamp over black water beyond, ${WARM}, ${NOIR}` },

  // ═══ INTERIORS — one per major system ═══
  { id: 'interior-kitchen', model: PRO, ar: '16:9', job: 'the Kitchen (drug lab)',
    prompt: `a cramped backroom laboratory at night, brass scales and glass flasks on a stained wooden table, one bare hanging bulb, steam curling, a cigarette burning in a tin ashtray, peeling walls, ${WARM}, ${NOIR}` },
  { id: 'interior-speakeasy', model: PRO, ar: '16:9', job: 'the Speakeasy',
    prompt: `a red velvet basement club at night, a brass rail, a roulette wheel mid-spin, cigar smoke layered in the beam of one low pendant lamp, empty chairs pushed back, ${WARM}, ${NOIR}` },
  { id: 'interior-pen', model: PRO, ar: '16:9', job: 'the Pen — cold blue, the one place that breaks palette on purpose',
    prompt: `the interior of a 1930s prison cell block at night, a long row of barred cell doors receding down a tier, riveted iron railings and a steel walkway, harsh light falling in bars through a high window onto a concrete floor, cold blue light against one distant amber bulb, ${NOIR}` },
  { id: 'interior-estate', model: PRO, ar: '16:9', job: 'the Estate — old money, the endgame',
    prompt: `a grand old-money study at night, dark oak panelling, a wall of glass cases, a covered portrait, firelight from a hearth, one empty leather armchair, ${WARM}, ${NOIR}` },
  { id: 'interior-den', model: PRO, ar: '16:9', job: 'the Gambling Den',
    prompt: `a back-room card table under one low hanging lamp, scattered chips and a cut deck, cigar smoke in the light cone, empty chairs pushed back, the room beyond in darkness, ${WARM}, ${NOIR}` },
  { id: 'interior-track', model: PRO, ar: '16:9', job: 'the Track',
    prompt: `an oval greyhound racing track at night seen from the empty grandstand, a curved white running rail sweeping around raked sand, floodlight pylons above, the sand wet and churned, fog over the far bend, ${COLD}, ${NOIR}` },
  { id: 'interior-garage', model: PRO, ar: '16:9', job: 'the Garage',
    prompt: `a 1940s repair garage at night, one black sedan up on blocks, tools on a pegboard, an inspection lamp throwing hard shadows across an oil-stained concrete floor, ${WARM}, ${NOIR}` },
  { id: 'interior-gym', model: PRO, ar: '16:9', job: 'the Fight Circuit',
    prompt: `an empty boxing gym at night, a roped ring under one caged ceiling lamp, heavy bags hanging still in the dark, dust in the light, worn canvas, ${WARM}, ${NOIR}` },
  { id: 'interior-port', model: PRO, ar: '16:9', job: 'the Port (smuggling)',
    prompt: `a small wooden boat tied at a fog-bound jetty at night, crates under a tarpaulin, a lantern on the boards, black water beyond, no horizon, ${COLD}, ${NOIR}` },
  { id: 'interior-market', model: PRO, ar: '16:9', job: 'the Black Market',
    prompt: `a lamplit back-alley at night with goods laid out on crates under a canvas awning, wet cobbles, one hanging bulb, deep shadow either side, ${WARM}, ${NOIR}` },

  // ═══ THE REST OF THE CONSOLE — one plate per remaining tab ═══
  // 14 of the 24 screens had no art, which is what made the console read as a spreadsheet with a
  // theme rather than a place. These are TAB HEADER BANDS: wide, dim, and text lands on them, so
  // every one is composed with an empty lane where the heading goes and nothing that carries writing.
  { id: 'interior-streets', model: PRO, ar: '16:9', job: 'the Streets — the core crime loop, the first screen anyone works',
    prompt: `a rain-wet street corner at night under one amber lamp, a shuttered brick storefront with blank boarded windows, an overflowing bin, a fire escape overhead, deep shadow filling the left of frame, ${WARM}, ${NOIR}` },
  { id: 'interior-life', model: PRO, ar: '16:9', job: 'The Life — skills, the fixers, the Underworld cast',
    prompt: `a 1940s back-room tailor shop at night, a dress form and hanging suit jackets, shears and chalk on a cutting table, one shaded work lamp, a curtained doorway behind, ${WARM}, ${NOIR}` },
  { id: 'interior-empire', model: PRO, ar: '16:9', job: 'the Empire — legitimate fronts that launder money',
    prompt: `a row of small shopfronts at night on a wet street, warm light behind blank frosted glass, striped awnings dripping, a delivery van at the kerb, no signage of any kind, ${WARM}, ${NOIR}` },
  { id: 'interior-scores', model: PRO, ar: '16:9', job: 'Big Scores — crew heists',
    prompt: `the interior of a bank vault at night, a massive circular steel door standing half open, rows of brass safe-deposit boxes, one work lamp on the polished floor throwing a long shadow, ${WARM}, ${NOIR}` },
  { id: 'interior-pvp', model: PRO, ar: '16:9', job: 'Wet Work — contracts, hits, vendettas. The most dangerous screen.',
    prompt: `a revolver, spilled brass cartridges and a fedora lying on a scarred dark wooden table, lit only by a hard shaft of light falling in from a doorway off-frame to the left, venetian blind shadows striping the table, the room behind swallowed in black, a faint red glow low in the corner, ${NOIR}` },
  { id: 'interior-loans', model: PRO, ar: '16:9', job: 'the Shylock — loan sharking',
    prompt: `a cramped back-office at night, a banker lamp with a green glass shade on a scarred desk, a closed leather-bound book, a cash box, a heavy safe in the shadow behind, ${WARM}, ${NOIR}` },
  { id: 'interior-law', model: PRO, ar: '16:9', job: 'the Law — RICO, indictment, the courtroom',
    prompt: `an empty 1940s courtroom at night, a raised judge's bench and a witness box in dark oak, tall arched windows throwing hard bars of cold light across empty benches, dust in the air, ${COLD}, ${NOIR}` },
  { id: 'interior-wire', model: PRO, ar: '16:9', job: 'the Wire — surveillance, taps, informants',
    prompt: `a dim surveillance back-room at night, reel-to-reel tape machines and a patch panel of cables, headphones on a hook, small glowing valve lamps, cigarette smoke, ${COLD}, ${NOIR}` },
  { id: 'interior-family', model: PRO, ar: '16:9', job: 'the Family — gangs, turf, the Commission',
    prompt: `a long dining table in a dim private back room at night, empty chairs down both sides, wine glasses and an ashtray left behind, one low pendant lamp over the centre of the table, heavy drapes, ${WARM}, ${NOIR}` },
  { id: 'interior-legit', model: PRO, ar: '16:9', job: 'Going Legit — the portfolio, the dynasty, the way out',
    prompt: `the marble banking hall of a 1930s financial building at night, tall fluted columns, brass teller cages, a polished stone floor reflecting one distant amber lamp, everything else in shadow, ${WARM}, ${NOIR}` },
  { id: 'interior-races', model: PRO, ar: '16:9', job: 'Street Races',
    prompt: `a black 1940s coupe idling on a rain-flooded street at night seen from low and behind, tail lights burning red on the wet asphalt, headlights cutting into fog ahead, brick warehouses either side, ${WARM}, ${NOIR}` },
  { id: 'interior-stable', model: PRO, ar: '16:9', job: 'the Stable — owning the dogs and the ponies',
    prompt: `the interior of an old timber stable at night, a row of stall doors, straw on a swept floor, tack and leather harness hanging on pegs, one hurricane lantern casting long shadows, ${WARM}, ${NOIR}` },
  { id: 'interior-store', model: PRO, ar: '16:9', job: 'the Store — real-money packages',
    prompt: `a 1940s haberdashery counter at night, folded silk pocket squares and hat boxes stacked behind glass, a brass register, one shaded lamp, deep shadow beyond the counter, ${WARM}, ${NOIR}` },
  { id: 'interior-start', model: PRO, ar: '16:9', job: 'Start Here — the first screen a new player lands on. Invitational.',
    prompt: `looking out through a doorway onto a rain-wet city street at night, the frame of the door dark in the foreground either side, amber lamplight and fog beyond, the way out bright and open in the centre, ${WARM}, ${NOIR}` },

  // ═══ LANDING — the mid-page break, now that hero-poster is promoted to the hero ═══
  { id: 'landing-break', model: ULTRA, ar: '21:9', job: 'full-bleed mid-page break; must carry itself, and must NOT be another lone walker',
    prompt: `a wide elevated view across a 1940s harbour city at night in heavy rain, ranks of tenement rooftops and water towers stretching the full width of frame, amber street light glowing up between the blocks, a dark river and dock cranes on the right, low cloud lit from beneath, ${WARM}, ${NOIR}` },
  // the two pills whose art was doing the wrong job: a card plate and a line-art map
  { id: 'pill-legacy', model: PRO, ar: '16:9', job: 'the "play for keeps" pill — death and inheritance',
    prompt: `a rain-wet cemetery at night, weathered headstones and a stone angel in fog, bare branches overhead, one distant amber lamp beyond the railings, ${COLD}, ${NOIR}` },
  { id: 'pill-agents', model: PRO, ar: '16:9', job: 'the "agents welcome" pill — machines playing the game',
    prompt: `a 1940s manual telephone switchboard at night, a tall polished wooden cabinet face drilled with rows of brass jack sockets, cloth-covered patch cords hanging in loops, a bakelite headset resting on an empty operator's chair, one shaded lamp, nobody present, ${WARM}, ${NOIR}` },

  // ═══ FLAT GRAPHIC — no photographic style words, they fight flat work ═══
  { id: 'crest', model: PRO, ar: '1:1', job: 'family crest; a blank banner for a tag',
    prompt: 'an art-deco heraldic crest engraved in amber ink on flat charcoal, laurel branches, a dagger, and playing-card suits arranged symmetrically in a circular seal, an empty blank banner across the bottom, 1940s letterpress line engraving, no lettering, no writing, no watermark' },
  { id: 'icons', model: PRO, ar: '1:1', job: 'UI icon sheet',
    prompt: `nine distinct objects arranged in a three by three grid on a SOLID BLACK background, drawn as flat amber-orange line art with no fill: a fedora, a revolver, brass knuckles, a banded bundle of banknotes, a single pair of dice, a pocket watch, a sealed envelope, a door key, a cigarette lighter, each object different from the others, dark background, black background, amber on black, no paper, no lettering, no writing, no watermark` },
  { id: 'citymap', model: PRO, ar: '1:1', job: 'the district map',
    prompt: 'an overhead night view of a 1940s harbour city divided into districts by dark canals and rail lines, rivers of amber light running between blocks of black rooftops, rain, drawn as a hand-inked antique map in amber and teal on charcoal, no lettering, no labels, no writing, no watermark' },
];

// ═══ CATALOG ART — one image per catalog item the console renders as bare text ═══
// Cars, guns, vests, drugs, trade goods, boats. Built FROM src/rules.js so the set can never
// drift from the catalogs (a renamed car regenerates under its id; a deleted one just goes
// unused). Each class shares one visual vocabulary so a grid reads as a set, and every SUBJECT
// is hand-mapped from the item's name — an auto-derived prompt is how you get sixty identical
// grey sedans. Same no-lettering discipline as everything above (labels, livery, banknotes and
// certificates all invite gibberish type).
const R = await import('../src/rules.js');
const ITEM = '1940s American noir still life, hard chiaroscuro, one warm amber lamp against teal shadow, '
  + 'film grain, muted desaturated palette, shallow depth of field, no hands, no people, '
  + 'no signage, no lettering, no labels, no writing anywhere, no watermark';
const carCondition = (v) => v < 3000 ? 'battered, rust-bitten, dented, sagging on its springs'
  : v < 8000 ? 'honest and work-worn, faded paint' : v < 15000 ? 'well kept, chrome glinting'
  : v < 40000 ? 'gleaming polished coachwork' : 'immaculate coach-built masterpiece, flawless deep lacquer';
const CAR_SUBJECT = {
  junker: 'a rusted-out farm sedan with mismatched fenders and one missing headlamp',
  errand: 'a small light delivery coupe with a boxy rear compartment',
  garden: 'a small battered pickup truck with wooden side rails and mud on the fenders',
  volara: 'a stubby compact two-door economy car with a sloping rear',
  postal: 'a boxy delivery van with plain stripped panels',
  milk: 'a rounded milk-delivery truck with an open standing cab',
  cabbie: 'a worn four-door taxi-style sedan, roof light removed',
  iceman: 'a heavy ice-delivery truck with an insulated wooden box body, dripping',
  pigeon: 'a plain grey utterly nondescript runabout',
  offduty: 'a checker-pattern-free off-duty taxicab sedan, meter dark',
  cannery: 'a flat-nosed stake-bed fish truck with wet boards',
  conductor: 'a tidy modest small coupe',
  dray: 'a bread-delivery panel van with rear barn doors ajar',
  foreman: 'a dusty light utility coupe with a toolbox strapped to the running board',
  rubicon: 'a long flatbed work truck with chained-down tarps',
  ladder: 'a fire-brigade hook-and-ladder truck carrying a long wooden ladder',
  prefect: 'a modest upright four-door saloon',
  deuce: 'a stripped-down open-wheel hot-rod roadster',
  notary: 'a sober black four-door saloon with drawn window shades',
  stag: 'a plain sturdy working man\'s sedan',
  trolley: 'a stubby high-roofed jitney coach',
  sedanette: 'a fastback sedanette with a long sloping tail',
  clubman: 'a two-door club coupe with a rumble seat open',
  coupe38: 'a late-thirties business coupe with an oversized trunk',
  boulevard: 'a stately straight-eight sedan with an endless louvered hood',
  mercantile: 'a wood-panelled merchant\'s wagon',
  wagoneer: 'a wood-bodied estate wagon',
  consul: 'a long black limousine with a division window and curtains',
  harbor: 'a broad-shouldered luxury coupe with porthole hood vents',
  dockmaster: 'a heavy luxury cruiser sedan on wide whitewall tires',
  brougham: 'a formal town car with an open chauffeur\'s compartment',
  courier: 'a lowered factory-tuned coupe with faired-in headlamps',
  regent: 'a landaulet limousine with the rear quarter roof folded',
  touring: 'a long six-cylinder grand-touring cabriolet',
  sable: 'a funeral-black landau sedan with a leather-covered rear roof',
  cabaret: 'a glamorous cabriolet with the top down and champagne-cork chrome',
  diplomat: 'a stately long-wheelbase town sedan',
  cascade: 'a sweeping two-tone cabriolet, top folded',
  sportsman: 'a sporting convertible with cut-down doors',
  vesper: 'a low sleek fastback grand tourer',
  corsair: 'a boat-tailed speedster with sweeping clamshell fenders',
  monarch: 'a majestic twelve-cylinder saloon with an immense hood',
  regatta: 'a nautically-trimmed convertible with varnished wood decking',
  tempest: 'a low two-seat roadster with a raked chopped windscreen',
  phaeton: 'an open dual-cowl four-door phaeton',
  ambassador: 'an armored sedan with thick green-tinted glass and heavy flared fenders',
  bullion: 'an armored bank truck with riveted steel plating and barred slit windows',
  blackout: 'a phantom limousine murdered out in black, every piece of chrome blacked',
  nocturne: 'a midnight-blue streamlined coupe',
  duchess: 'a drophead coupe with coach doors, top down',
  spectre: 'a low berlinetta with teardrop fenders',
  leviathan: 'an enormous town car, the longest car in the city',
  comet: 'a streamlined competition racer with a vertical tail fin',
  warhawk: 'a one-off aircraft-inspired prototype with a polished bare-aluminum body',
  vulcan: 'a fire chief\'s red command car with siren horn and brass bell',
  sovereign: 'a silver state limousine with a tall chrome grille',
  olympia: 'an open parade car with chrome grab rails behind the front seat',
  meridian: 'a coach-built grand saloon of impossible proportions',
  aurora: 'a land-speed record streamliner with fully enclosed wheels',
  tsarina: 'an imperial pre-war Russian limousine with gilded coach lines and a tiny crest',
};
const GUN_SUBJECT = {
  lastresort: 'a tiny rust-pitted .25 pocket pistol',
  pocket22: 'a small nickel-plated .22 pocket pistol',
  penny: 'a slim long-barrelled .22 target pistol',
  alleycat: 'a snub-nosed .38 revolver',
  badge: 'a service .38 revolver with holster-worn bluing',
  argument: 'a heavy blued .45 semi-automatic pistol',
  rancher: 'a lever-action carbine with a saddle-worn stock',
  whisper: 'a .32 pistol fitted with a long cylindrical suppressor',
  doorbell: 'a short double-barrelled 12-gauge shotgun',
  brothers: 'a matched pair of .45 pistols laid side by side',
  broom: 'a trench shotgun with a perforated heat shield and canvas sling',
  orchestra: 'a drum-magazine submachine gun resting in an open violin case',
  anniversary: 'a presentation pair of ornately engraved pistols in a velvet-lined case',
  chorusline: 'a First World War water-cooled belt-fed machine gun with wooden grips, a coiled canvas ammunition belt beside it',
  undertaker: 'a long scoped rifle in an open felt-lined wooden case',
};
const VEST_SUBJECT = {
  woolv: 'a heavy padded wool overcoat', lightv: 'a slim fabric protective vest',
  medv: 'a reinforced canvas vest with stitched-in plating',
  tailorv: 'an elegant tailored waistcoat with plating hidden in the lining, one corner turned back',
  heavyv: 'a massive riveted blued-steel trench armor vest with thick buckled leather shoulder straps, heavy dark gunmetal plates, on a wooden armory stand',
  vaultv: 'a massive armored vest of overlapping polished steel plates',
};
const DRUG_SUBJECT = { // fictional substances, styled as period apothecary contraband
  vim: 'an open apothecary tin of small bright-orange lozenges beside a wound brass alarm clock',
  moonmilk: 'a stoppered glass bottle of faintly glowing pale-blue liquid',
  lotus: 'dried violet flower petals in an unfolded paper bindle',
  glass: 'jagged clear crystal shards in a cut-glass dish',
  ambrosia: 'honey-gold syrup in an ornate apothecary vial',
  static: 'grey powder in a torn paper fold with a faint electric-blue shimmer',
  halo: 'plain white tablets arranged in a perfect ring on dark velvet',
  nocturne: 'an inky black tincture bottle with a glass dropper laid beside it',
};
const GOOD_SUBJECT = {
  gin: 'unlabeled clear glass bottles packed in a straw-lined wooden crate',
  coffee: 'burlap sacks of green coffee beans, one slit open and spilling',
  cigars: 'an open plain wooden box of unbanded cigars',
  nylons: 'sheer nylon stockings draped from a plain cardboard box',
  shine: 'clay jugs and mason jars of clear moonshine on a bed of straw',
  penicillin: 'small glass medical vials nested in a partitioned carrying case',
  silk: 'bolts of shimmering champagne silk stacked and spilling loose',
  watches: 'gold pocket watches and loose watch movements on a jeweler\'s black cloth',
  ice: 'loose cut diamonds glittering on black velvet beside a loupe',
  bearer: 'a leather document case spilling ribbon-bound papers with red wax seals, papers out of focus',
};
const BOAT_SUBJECT = {
  0: 'a small weathered wooden rowing dinghy',
  1: 'a low fast wooden skiff with a small outboard motor',
  2: 'a converted fishing trawler with boom, winch and hanging nets',
  3: 'a fast motor cutter with a raked bow and low cabin',
  4: 'a small coastal freighter with a single funnel and deck crates',
  5: 'a long sleek varnished-mahogany speedboat',
};
for (const c of R.CARS) MANIFEST.push({
  id: `car-${c.id}`, model: PRO, ar: '4:3', job: `garage card: ${c.name}`,
  prompt: `${CAR_SUBJECT[c.id] || 'a 1940s sedan'}, ${carCondition(c.val)}, a single 1940s automobile in three-quarter front view parked alone on wet cobblestones at night, one amber street lamp, teal fog behind, the car filling most of the frame, ${NOIR}`,
});
for (const g of R.GUNS) MANIFEST.push({
  id: `gun-${g.id}`, model: PRO, ar: '4:3', job: `armory card: ${g.name}`,
  prompt: `${GUN_SUBJECT[g.id] || 'a 1940s revolver'}, laid flat on a dark waxed oak table, ${ITEM}`,
});
for (const v of R.VESTS) MANIFEST.push({
  id: `vest-${v.id}`, model: PRO, ar: '4:3', job: `armory card: ${v.name}`,
  prompt: `${VEST_SUBJECT[v.id] || 'a protective vest'}, fitted on a headless tailor's dress form in a dim fitting room, ${ITEM}`,
});
for (const d of R.DRUGS) MANIFEST.push({
  id: `drug-${d.id}`, model: PRO, ar: '4:3', job: `kitchen card: ${d.name} (fictional substance)`,
  prompt: `${DRUG_SUBJECT[d.id] || 'a small apothecary vial'}, on a stained wooden workbench beside brass scales, ${ITEM}`,
});
for (const g of R.GOODS) MANIFEST.push({
  id: `good-${g.id}`, model: PRO, ar: '4:3', job: `trade-goods card: ${g.name}`,
  prompt: `${GOOD_SUBJECT[g.id] || 'a wooden crate of goods'}, on a warehouse floor under one hanging bulb, ${ITEM}`,
});
// keyed by CATALOG id, not array index — the console looks these up as /art/boat-<id>.jpg and an
// index key would silently re-point every image if the ladder ever gained a rung in the middle
for (const [i, b] of R.PORT.BOATS.entries()) MANIFEST.push({
  id: `boat-${b.id}`, model: PRO, ar: '4:3', job: `boatyard card: ${b.name}`,
  prompt: `${BOAT_SUBJECT[i] || 'a small wooden boat'}, moored at a fog-bound wooden jetty on black water at night, one lantern on the boards, ${NOIR}`,
});

// ═══ ACTION ART — the verbs, not the things ═══════════════════════════════════════
// The catalog pass covered what you OWN; this pass covers what you DO. Each image sits on an
// action card the player taps hundreds of times (a crime, a heist job, a den game), so the brief
// is a SCENE that reads at thumbnail size: one clear subject, no crowd of detail. All 16:9 —
// these ride wide card headers, not the 4:3 item thumbs.
//
// The portrait vocabulary is separate ON PURPOSE: the shared NOIR string says "unpeopled", which
// is exactly wrong for a fixture portrait. Faces are FICTIONAL characters only (the Broadcast
// legal posture) — no lookalikes, no real names, invented mugs.
const SCENE = '1940s American noir, hard chiaroscuro, deep shadow, teal and amber light, film grain, '
  + 'muted desaturated palette, cinematic, unpeopled, no signage, no lettering, no writing anywhere, no watermark';
const PORTRAIT = 'a 1940s American noir character portrait, head and shoulders, hard chiaroscuro, one warm '
  + 'amber key light against deep teal shadow, film grain, muted desaturated palette, painterly photographic, '
  + 'fictional person, no lettering, no writing anywhere, no watermark';

// 29 crimes — the core loop; every player stares at these cards from minute one.
const CRIME_SUBJECT = {
  pick: 'a gloved hand lifting a leather wallet from an overcoat pocket on a crowded rainy street corner, seen close',
  stereo: 'a jimmied sedan door open at night, wires pulled from under a dashboard, a screwdriver on the seat',
  numbers: 'a folded betting slip and a stub pencil passed over a tenement stoop rail at dusk',
  booze: 'a wooden whiskey case being slid off the open tail of a parked delivery truck in an alley',
  shake: "a shopkeeper's counter with the till drawer open and a heavy shadow falling across it",
  highroll: 'a drunk gambler\'s trilby and scattered banknotes on wet cobbles outside a club door',
  truck: 'a box truck stopped on a dark road, headlights blazing into fog, its rear doors swung open',
  furs: 'mink fur coats bundled over an arm in a dim uptown service corridor',
  poker: 'an overturned wooden chair beside a felt-topped table, clay chips spilled across the floor, one swinging overhead lamp',
  cardgame: 'a crooked card sharp\'s workbench: a fanned deck of playing cards, a razor blade and shaved corner scraps under an amber desk lamp',
  torch: 'a warehouse window glowing orange from inside, smoke curling out under the eaves at night',
  alderman: 'a manila envelope of photographs sliding across a polished city-hall desk in lamplight',
  armored: 'an armored bank truck stopped on a bridge at night, one door blown open, smoke drifting',
  jewelry: 'a jeweler\'s display case with the glass lifted away, empty velvet ring slots, a torch beam',
  payroll: 'a payroll office cage window with bundled pay envelopes stacked behind bent bars',
  vaultjob: 'a round bank vault door ajar with drill dust on the marble floor, a work lamp burning',
  railfreight: 'a freight boxcar door rolled open at a night siding, crates in torchlight, steam drifting',
  harbormaster: 'the harbor master\'s ledger and cap on a desk overlooking foggy docks through a window',
  fixfight: 'a boxing corner stool and a cash-stuffed envelope under the ring ropes in a dark arena',
  diamond: 'a briefcase of loose diamonds open on the tarmac of a foggy airfield beside a propeller plane',
  counting: 'a rival\'s counting-room table heaped with banded cash and a tipped-over adding machine',
  museum: 'a museum gallery at night, a gold mask missing from its glass plinth, alarm light sweeping',
  fedtrain: 'a mail train stopped at night, its steel car door cut open, gold cases in lantern light',
  customs: 'a customs bond warehouse aisle of stenciled crates, a bolt cutter left on the floor',
  mint: 'an overturned mint convoy truck spilling coin sacks across a night highway, flares burning',
  grandcasino: 'a casino count-room cage stacked with chips and cash trays, the barred door swung wide',
  clearing: 'a stock-exchange clearing floor after hours, ticker tape drifting across marble in half-light',
  bonds: 'a leather portfolio of engraved bearer bonds open on a mahogany boardroom table at night',
  depository: 'a federal depository corridor of barred gold cages receding into darkness, one flashlight beam',
};
for (const c of R.CRIMES) MANIFEST.push({
  id: `crime-${c.id}`, model: PRO, ar: '16:9', job: `crime card: ${c.name}`,
  prompt: `${CRIME_SUBJECT[c.id] || 'a shadowy street crime scene at night'}, ${SCENE}`,
});

// 12 crew heist jobs — the Big Scores board.
const HEIST_SUBJECT = {
  corner: 'a corner grocery at night, register drawer open, the door bell still swinging',
  payroll: 'a payroll office safe hauled onto a hand truck in a dark stairwell',
  inside: 'a nightclub back office rifled by flashlight, ledger pages scattered',
  jewel: 'a smashed jewelry vitrine spilling pearls under a sweeping alarm light',
  vault: 'a bank vault interior, deposit boxes pried open, drill smoke in the torch beam',
  armored: 'an armored car tipped in a rail underpass, doors blown, cash boxes in headlights',
  casino: 'a casino count room mid-heist, duffel bags gaping on the counting table',
  fedtrain: 'a reserve train car cut open at night, mint pallets in lantern light, steam everywhere',
  diamond: 'a diamond district workshop, loupe and scattered stones under one bench lamp',
  museum: 'a museum rotunda at night, moonlight falling through an open skylight onto an empty display plinth, a coil of climbing rope on the marble floor',
  goldvault: 'a gold depository rack of bullion bars half-emptied, a loaded dolly waiting',
  thefed: 'a federal reserve corridor of vault gates standing open into darkness, red alarm glow',
};
for (const j of R.HEIST_JOBS) MANIFEST.push({
  id: `heist-${j.id}`, model: PRO, ar: '16:9', job: `heist job card: ${j.name}`,
  prompt: `${HEIST_SUBJECT[j.id] || 'a heist scene at night'}, ${SCENE}`,
});

// 6 Underworld fixtures — PORTRAITS (the one pass that wants a face).
const NPC_SUBJECT = {
  doc: 'a weary silver-haired back-alley surgeon in a collarless shirt and worn waistcoat, stethoscope around his neck, kind exhausted eyes',
  fixer: 'a sharp-featured middle-aged fight fixer in a pinstripe suit and loosened silk tie, toothpick in the corner of his mouth, sly grin',
  armorer: 'a hard-eyed woman gunsmith in her forties, sleeves rolled, oil-smudged leather apron over a blouse, red lipstick, unimpressed stare',
  harbor: 'a huge bearded longshoreman boss in a wool watch cap and pea coat, weathered face, pipe smoke curling',
  madame: 'an elegant nightclub madame in her fifties, velvet gown and long gloves, cigarette holder, knowing half-smile',
  cornerman: 'a squat old boxing cornerman with a flattened nose and cauliflower ears, towel over one shoulder, flat cap',
};
for (const n of R.UNDERWORLD.NPCS) MANIFEST.push({
  id: `npc-${n.id}`, model: PRO, ar: '4:3', job: `underworld fixture portrait: ${n.name}`,
  prompt: `${NPC_SUBJECT[n.id] || 'a 1940s underworld character'}, ${PORTRAIT}`,
});

// 5 rival cartel outfits — the World raid cards.
const OUTFIT_SUBJECT = {
  dockrats: 'a gang of silhouettes among stacked cargo crates and rowboats under a pier at night',
  zappa: 'a row of black sedans idling outside a shuttered social club, exhaust in the cold air',
  kryl: 'a fortified warehouse compound behind chain-link, floodlights and guard silhouettes in fog',
  moreau: 'a colonial mansion at night ringed by palm shadows, armed silhouettes on the veranda',
  volkov: 'an ice-crusted freighter deck bristling with crates and fur-coated silhouettes, searchlight sweeping',
};
for (const w of R.WORLD_NPCS) MANIFEST.push({
  id: `outfit-${w.id}`, model: PRO, ar: '16:9', job: `world outfit card: ${w.name}`,
  prompt: `${OUTFIT_SUBJECT[w.id] || 'a rival gang stronghold at night'}, ${SCENE.replace(', unpeopled', '')}`,
});

// 9 den games — the Den's sections were the flashiest room with the barest cards.
const GAME_SUBJECT = {
  dice: 'two red dice mid-tumble over a chalked brick wall corner, crumpled bills on the ground',
  numbers: 'a numbers slip and three brass lottery balls on a cigar-burned counter',
  fight: 'a boxing ring under one cone of smoky light in a packed dark arena, ropes taut',
  blackjack: 'neat stacks of clay chips and a small varnished wooden card box on worn green felt, one cone of warm lamp light',
  poker: 'two facing stacks of clay chips on a green felt table with a brass banker\'s lamp, cigar smoke drifting through the light',
  ring: 'a round felt-topped table in a wood-panelled private room, five whiskey glasses and a full ashtray, one low hanging lamp',
  tournament: 'a silver trophy cup beside stacked poker chips under a single spotlight',
  track: 'greyhounds bursting from a starting trap under floodlights at a night track, sand flying',
  futurity: 'racehorses thundering past a grandstand at night, silks blurred, rail lights streaking',
};
for (const [gid, sub] of Object.entries(GAME_SUBJECT)) MANIFEST.push({
  id: `game-${gid}`, model: PRO, ar: '16:9', job: `den game card: ${gid}`,
  prompt: `${sub}, ${SCENE.replace(', unpeopled', '')}`,
});

// 3 NPC hitman tiers + 3 boxing NPC tiers + 5 business fronts + estate/speakeasy ladders.
const HITMAN_SUBJECT = {
  legbreaker: 'a baseball bat leaning against a brick wall beside a single work glove under a bare bulb',
  journeyman: 'a revolver and a folded fee envelope on a diner table, coffee going cold',
  professional: 'a violin case open on a hotel bed showing a disassembled rifle in velvet',
};
for (const [i, h] of R.NPC_HITMEN.entries()) MANIFEST.push({
  id: `hitman-${h.id}`, model: PRO, ar: '16:9', job: `NPC hitman tier: ${h.name}`,
  prompt: `${HITMAN_SUBJECT[h.id] || 'a hired killer\'s tools'}, ${SCENE}`,
});
const BOXER_SUBJECT = {
  clubfighter: 'a lean young boxer shadowboxing alone in a dim gym, tape on his fists',
  journeyman: 'a scarred veteran boxer leaning on the ropes, gloves down, sizing up the camera',
  gatekeeper: 'a massive heavyweight seated on a corner stool like a throne, arms crossed, in shadow',
};
for (const b of R.BOXING.NPC_TIERS) MANIFEST.push({
  id: `boxer-${b.id}`, model: PRO, ar: '4:3', job: `boxing NPC tier: ${b.name}`,
  prompt: `${BOXER_SUBJECT[b.id] || 'a 1940s boxer'}, ${PORTRAIT.replace('head and shoulders', 'three-quarter figure')}`,
});
const BUSINESS_SUBJECT = {
  laundromat: 'a corner laundromat at night, washers glowing, steam on the glass',
  restaurant: 'a red-checked-tablecloth Italian restaurant, candle bottles, one lit table',
  nightclub: 'a nightclub stage with a lone microphone in a spotlight, empty tables in the dark',
  hotel: 'a grand hotel lobby at night, brass and marble, one bellhop cart abandoned',
  casino: 'a grand gaming hall at closing time, tables covered in white sheets, one glowing wheel of fortune, a chandelier half lit',
};
for (const b of R.BUSINESSES) MANIFEST.push({
  id: `business-${b.kind}`, model: PRO, ar: '16:9', job: `business front card: ${b.name}`,
  prompt: `${BUSINESS_SUBJECT[b.kind] || 'a storefront at night'}, ${SCENE}`,
});
// ladders keyed by TIER NUMBER — a ladder is ordered by definition, so the tier IS the stable id
const ESTATE_SUBJECT = [
  'a bare room over a social club, a cot, a hat on a nail, one window of neon glow',
  'a narrow brick row house at dusk, warm light in one window, iron railings',
  'an uptown brownstone with tall bay windows and a gas lamp, rain-slicked steps',
  'a country estate at the end of a poplar drive at dusk, windows lit gold',
  'a walled compound at night, iron gates, guard lights, a long black car in the court',
  'a marble palazzo above the city at night, colonnaded terrace, fountain lit from below',
];
R.ESTATE.TIERS.forEach((t, i) => MANIFEST.push({
  id: `estate-${t.tier}`, model: PRO, ar: '16:9', job: `estate tier: ${t.name}`,
  prompt: `${ESTATE_SUBJECT[i] || 'a grand house at night'}, ${SCENE}`,
}));
const CLUB_SUBJECT = [
  'a cramped speakeasy backroom, crates for stools, a bottle-lined shelf, one candle',
  'a small velvet lounge with a curved leather bar and low amber lamps',
  'a moody blue-lit jazz room, double bass leaning by the stage, smoke hanging',
  'a glamorous supper club of white tablecloths and a chrome bandstand, chandelier glow',
  'a cathedral-scaled grand club, vaulted ceiling, tiered balconies, a sea of candlelit tables',
];
R.SPEAKEASY.TIERS.forEach((t, i) => MANIFEST.push({
  id: `club-${t.tier}`, model: PRO, ar: '16:9', job: `speakeasy tier: ${t.name}`,
  prompt: `${CLUB_SUBJECT[i] || 'a hidden bar'}, ${SCENE}`,
}));

// ── plumbing ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

if (args.includes('--list')) {
  for (const m of MANIFEST) {
    const f = path.join(OUT, `${m.id}.jpg`);
    console.log(`${fs.existsSync(f) ? '✓' : ' '} ${m.id.padEnd(22)} ${m.ar.padEnd(6)} ${m.job}`);
  }
  process.exit(0);
}

const key = process.env.FAL_KEY
  || (process.env.FAL_KEY_FILE && fs.readFileSync(process.env.FAL_KEY_FILE, 'utf8').trim());
if (!key) { console.error('FAL_KEY or FAL_KEY_FILE required'); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, images: {} };

async function generate(m) {
  const body = { prompt: m.prompt, num_images: 1, output_format: 'jpeg' };
  if (m.model === ULTRA) body.aspect_ratio = m.ar;
  else body.image_size = m.ar === '1:1' ? 'square_hd' : m.ar === '21:9' ? { width: 2560, height: 1097 }
    : m.ar === '4:3' ? 'landscape_4_3' : 'landscape_16_9';

  const r = await fetch(`https://fal.run/${m.model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${m.id}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  const img = j.images?.[0];
  if (!img?.url) throw new Error(`${m.id}: no image in response`);

  const buf = Buffer.from(await (await fetch(img.url)).arrayBuffer());
  fs.writeFileSync(path.join(OUT, `${m.id}.jpg`), buf);

  ledger.spent = Math.round((ledger.spent + PRICE[m.model]) * 100) / 100;
  ledger.images[m.id] = { model: m.model, ar: m.ar, seed: j.seed, w: img.width, h: img.height,
    bytes: buf.length, job: m.job, prompt: m.prompt, at: new Date().toISOString() };
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  return `${m.id.padEnd(22)} ${String(img.width).padStart(4)}×${String(img.height).padEnd(4)} ${(buf.length / 1024).toFixed(0)}KB  seed ${j.seed}`;
}

const todo = MANIFEST.filter((m) => (only.length ? only.includes(m.id) : true))
  .filter((m) => force || only.length || !fs.existsSync(path.join(OUT, `${m.id}.jpg`)));

console.log(`generating ${todo.length}  ·  spent so far $${ledger.spent.toFixed(2)}  ·  cap $${CAP_USD}\n`);

let ok = 0, failed = 0;
const QUEUE = 4; // fal handles this happily; keeps a full run to a couple of minutes
const queue = [...todo];
await Promise.all(Array.from({ length: QUEUE }, async () => {
  while (queue.length) {
    const m = queue.shift();
    if (ledger.spent + PRICE[m.model] > CAP_USD) {
      console.log(`⛔ cap $${CAP_USD} reached — stopping with ${queue.length + 1} left`);
      queue.length = 0; break;
    }
    try { console.log('  ✓ ' + await generate(m)); ok++; }
    catch (e) { console.log(`  ✗ ${e.message}`); failed++; }
  }
}));

console.log(`\n${ok} generated, ${failed} failed  ·  total spent $${ledger.spent.toFixed(2)}`);
if (failed) process.exitCode = 1;
