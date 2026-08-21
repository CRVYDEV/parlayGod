// OMERTÀ — launch hype video builder. See HYPE.md.
//
//   FAL_KEY=… node tools/hype.js --fal       → generate the Seedance 2.5 motion library (parallel,
//                                              capped, per-clip aspect) then build ALL cuts
//   …--bespoke                               → generate the BESPOKE text-to-video action clips
//                                              (the mm-* footage the money cut runs on)
//   node tools/hype.js --all                 → rebuild all 5 from the library (no spend)
//   node tools/hype.js --cut streets         → rebuild one
//   …--music track.mp3                       → use a real track instead of the synth bed
//   node tools/hype.js                       → free Ken-Burns montage from the stills (no key)
//   …--vo                                    → narrate a cut that has a NARRATION script (fal TTS,
//                                              MiniMax deep voice — needs a FUNDED key)
//   …--vo-local                              → the same narration via local piper (placeholder
//                                              voice, timing-true; swap with --vo when topped up)
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

// ── BESPOKE text-to-video clips (Seedance 2.5 t2v — no source still needed) ───────────────────────
// The v1 explainer reused the library's slow atmospheric push-ins and the founder's verdict was
// "not alive or captivating enough" — so the money cut now leads with footage written for ACTION:
// people, hands, motion verbs, dynamic cameras. Generated by --bespoke, ledgered like everything
// else, cached in the LIB so a rebuild never re-spends. Only clips a cut actually REFERENCES are
// generated (the 2026-08-21 $30-budget trim kept 12 of the 23 written here; the rest are future
// options that cost nothing until a shot table names them).
const ACTION = 'cinematic film-noir, 1940s, moody amber and teal lighting, volumetric haze, deep '
  + 'shadows, 35mm film grain, dynamic camera, no on-screen text, no added logos, no watermark';
const BESPOKE = {
  'mm-chase':     `a man in a long coat sprints through pouring rain down a neon-lit alley clutching a leather briefcase, splashing through puddles, coat flying, fast tracking camera racing alongside him, ${ACTION}`,
  'mm-slam':      `a hand slams a massive leather ledger onto a desk, dust bursts up, loose banknotes and gold coins scatter and roll toward the camera, hard desk-lamp light, punchy push-in, ${ACTION}`,
  'mm-made':      `an initiation at a candle-lit table: a boss grips a new man's hand as a playing card burns in a dish between them, flame flaring, the family watching from shadow, camera orbiting the table, ${ACTION}`,
  'mm-store':     `a 1940s back-room shopkeeper spins and tosses a paper-wrapped package across the counter to a customer, shelves of contraband behind him, cash slapped on the counter, quick dolly-in, ${ACTION}`,
  'mm-bonds':     `hands sign bearer bonds in fast confident strokes, a brass seal pressed into hot red wax with a hiss of smoke, stacks of certificates, over-the-shoulder camera pushing in, ${ACTION}`,
  'mm-tax':       `a frantic 1940s trading floor, runners shouting and waving paper slips, a brass ticker machine spinning, papers thrown into the air, camera whipping through the crowd, ${ACTION}`,
  'mm-auction':   `an auctioneer's gavel slams down hard, hands shoot up bidding across a smoky auction room, numbered paddles waving, camera swinging from the gavel to the crowd, ${ACTION}`,
  'mm-pol':       `a torrent of gold coins pours down a steel chute into a vault bin, coins bouncing and spinning toward the low camera lens, glittering in lamplight, ${ACTION}`,
  'mm-bankcut':   `a banker's gloved hands riffle rapidly through tall stacks of banknotes, snapping one bill off the top of each stack into a separate tray, overhead camera slowly descending, ${ACTION}`,
  'mm-toll':      `a night tollgate on a rain-swept bridge: a black 1940s sedan stops, a hand pays the booth guard, the gate arm lifts and the car roars through spraying water, ${ACTION}`,
  'mm-four':      `a mechanical money-sorting machine splits a river of banknotes into four brass trays, gears and belts whirring fast, overhead camera pulling back to reveal all four trays filling, ${ACTION}`,
  'mm-buyback':   `a trader's arm sweeps a heap of gold tokens off a market table into a steel case and slams it shut, latches snapping, camera punching in on the case, ${ACTION}`,
  'mm-reserve':   `behind a barred teller window a clerk stacks gleaming gold-stamped tokens into perfect columns, hands moving fast, camera dollying in through the bars, ${ACTION}`,
  'mm-noprint':   `an underground money-printing press grinds to a halt: a hand throws a heavy lever, steam vents, the rollers stop and the work lights die one by one, dramatic push-in, ${ACTION}`,
  'mm-severance': `a man shoves a bulging cash bag toward a teller window and the barred shutter slams down in his face, the CLOSED sign swinging, camera punching in on the bars, ${ACTION}`,
  'mm-vaultdrop': `a brass street-name plaque set in a wet stone wall swings open to reveal a small hidden vault, a gloved hand places engraved certificates and gold coins inside onto dark velvet, warm lamplight, slow cinematic push-in, ${ACTION}`,
  'mm-desk':      `a dealer in shirtsleeves fans a river of gold tokens across green felt then sweeps them back with a rake, chips tumbling, fast overhead orbit, smoky lamplight, ${ACTION}`,
  'mm-crew':      `three figures clasp hands over a barrel fire in a rain-soaked alley, then turn and walk abreast toward camera, coats flaring in the wind, low tracking shot, ${ACTION}`,
  'mm-family':    `a long candle-lit dining table, the family rising to raise glasses as a new made man stands at the head, the boss clapping his shoulder, camera orbiting the toast, ${ACTION}`,
  'mm-pot':       `a mountain of banknotes and gold tokens piled at the center of a council table, five bosses seated around it in shadow, one pushes more into the pile, slow orbit accelerating, ${ACTION}`,
  'mm-seats':     `five high-backed chairs at a commission table, bosses in coats sitting down one after another, a gavel strikes, camera pushing down the table's centerline through cigar smoke, ${ACTION}`,
  'mm-tickervote':`hands drop folded ballots into a brass ballot box, the teller cranks the wheel, then a ticker-tape machine bursts to life spitting tape into the air, camera punch-in, ${ACTION}`,
  'mm-stockbuy':  `ticker tape streams over a 1940s exchange floor, a broker snatches the tape, reads it and thrusts his arm up to buy, the floor erupting around him, handheld energy, ${ACTION}`,
  'mm-vaultdrop': `hands place embossed stock certificates into a small private deposit box, shut the brass door and turn two keys, a wall of numbered boxes gleaming, macro camera pull-back, ${ACTION}`,
  // the `life` cut's action four (2026-08-21, $10 budget): the loops the library had no ACTION footage for.
  'mm-streetrace': `two 1940s hot rods drag-race side by side down a rain-slick neon boulevard at night, engines flaring, one drifts across the finish line inches ahead, low fast tracking camera at wheel height, spray flying, ${ACTION}`,
  'mm-knockout':  `a smoky 1940s boxing arena, a fighter ducks a swing and lands a hard cross, his opponent crashing to the canvas as the crowd surges up with flashing camera bulbs, dynamic ringside camera whip, ${ACTION}`,
  'mm-jailbreak': `a prisoner scrambles over a high stone prison wall on a knotted rope at night, a searchlight beam sweeping just past him, he drops and sprints into the fog, urgent handheld tracking, ${ACTION}`,
  'mm-boatchase': `a small smuggler's speedboat slams across black harbour swells at night, crates strapped down under tarps, a cutter's searchlight beam sweeping after it, spray exploding over the bow, low chase camera, ${ACTION}`,
  // the launch TRAILER's story-arc footage (2026-08-21, the masterpiece budget): arrive → rise.
  'mm-arrival':   `a young man in a worn coat steps off a night bus into pouring rain, one battered suitcase in hand, the vast neon city looming beyond the wet street, he looks up at it, slow push-in from behind, ${ACTION}`,
  'mm-alleyjob':  `a figure snatches a leather billfold from a drunk businessman in a narrow rain-slick alley and sprints away vaulting a fallen crate, urgent handheld chase camera, ${ACTION}`,
  'mm-induction': `a candlelit back-room ceremony, a young man's cupped hands holding a burning card, stern faces of suited men watching around a table, the flame lighting them from below, slow orbit, ${ACTION}`,
  'mm-tommygun':  `muzzle flashes strobe from the windows of a speeding 1940s sedan on a rain-slick street at night, shell casings bouncing, storefront glass shattering, low fast tracking alongside, ${ACTION}`,
  'mm-respect':   `a busy 1940s restaurant falls silent as a man in a tailored coat walks through, patrons rising, waiters stepping back, men tipping their hats as he passes, slow steadicam follow, ${ACTION}`,
  'mm-penthouse': `a man in a tailored suit stands silhouetted at a floor-to-ceiling penthouse window, whiskey glass in hand, the endless neon city glittering far below in the rain, slow push-in past his shoulder, ${ACTION}`,
  'mm-toast':     `a mafia family around a long candlelit dinner table raise their glasses in a toast, laughter and cigar smoke, warm lamplight on dark wood panelling, slow push down the table, ${ACTION}`,
  // the SHORTS pack's two portrait-composed hook shots (2026-08-21): t2v honors a 9:16 request —
  // no source still to pin the aspect — so these render NATIVELY vertical for the phone cuts.
  'mm-mark':      `looking straight down from a high fire escape at night, a lone man in a suit walks a narrow rain-slick alley far below counting a fold of banknotes, a shadowed figure steps out of a doorway behind him, tall vertical composition, slow descending camera, ${ACTION}`,
  'mm-fortune':   `a pair of dice tumbling in slow motion high above a green felt craps table, stacked chips and reaching hands below in lamplight, the dice falling toward the camera, tall vertical composition, low dramatic angle, ${ACTION}`,
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
  // loop, the crews & families act, then the RWA arc. The one declared source deliberately OMITTED
  // is `trade` — it is RETIRED (the sell tax is the one hook), and marketing a dead flow would be
  // the empty-state honesty rule broken on film. Copy is mechanism-true + number-free (the HYPE.md
  // rule): no bps, no prices, no value-per-$OMR figure; the closer states extraction opens at
  // launch (the rail is not open yet).
  // v2 (founder verdict on v1: "not alive or captivating enough"): the cut now leads with BESPOKE
  // action footage (the mm-* t2v clips — people, hands, motion), varied shot lengths, a mini
  // impact at every act boundary, and a NEW ACT on the crews & the families competing for the
  // community pot. Every live inflow is still here (the "miss no flows" constraint stands).
  money: { w: 1920, h: 1080, ar: '16:9', shots: [
    // ═══ COLD OPEN ═══
    { p: 'mm-chase',         use: 2.6, off: 0.3, sub: 'EVERY DOLLAR IN THIS CITY IS ON THE BOOKS' },
    { p: 'mm-slam',          use: 2.2, off: 0.4, sub: 'NOTHING MOVES OFF THE LEDGER' },
    // ═══ ACT I — the eight live inflows (router waterfall order) ═══
    { p: 'citymap',          use: 2.0, off: 0.6, kicker: 'I · WHERE REAL MONEY COMES IN' },
    { p: 'mm-made',          use: 2.8, off: 0.4, sub: 'GETTING MADE COSTS REAL ETH',
      sub2: 'identity fees on a published schedule — nobody skips the toll' },
    { p: 'mm-store',         use: 2.5, off: 0.4, sub: 'THE STORE SELLS FOR ETH',
      sub2: 'cosmetics · access · consumables — never power' },
    { p: 'crime-bonds',      use: 2.6, off: 0.5, sub: 'RESERVE BONDS RAISE ETH',
      sub2: 'discounted $OMR, vested — the only spigot that mints supply' },
    { p: 'mm-tax',           use: 2.5, off: 0.4, sub: 'EVERY $OMR SELL PAYS THE TAX',
      sub2: 'taken inside the swap — collected in ETH' },
    { p: 'mm-auction',       use: 2.6, off: 0.4, sub: 'THE DESK AUCTIONS $OMR DAILY',
      sub2: 'a falling-price auction over recycled supply — paid in ETH' },
    { p: 'district-canal',   use: 2.4, off: 0.6, sub: 'THE HOUSE POOL EARNS TRADING FEES',
      sub2: 'protocol-owned liquidity — depth the game itself provides' },
    { p: 'crime-depository', use: 2.4, off: 0.5, sub: 'THE BANK TAKES A CUT OF YIELD',
      sub2: 'a performance fee on protocol profit' },
    { p: 'mm-toll',          use: 2.6, off: 0.4, sub: 'CASHING OUT PAYS AN EXIT TOLL',
      sub2: 'and fresh tokens pay a surcharge to leave early' },
    // ═══ ACT II — where it goes: the four destinations + the $OMR demand loop ═══
    { p: 'heist-goldvault',  use: 2.0, off: 0.5, kicker: 'II · WHERE IT GOES' },
    { p: 'interior-empire',  use: 2.6, off: 0.5, sub: 'FOUR DESTINATIONS, ALL DECLARED',
      sub2: 'the vig · the treasury · liquidity · operations — every split published' },
    { p: 'crime-counting',   use: 2.6, off: 0.5, sub: 'THE VIG BUYS $OMR OFF THE MARKET',
      sub2: 'real revenue → the withdrawal reserve + the prize pool' },
    { p: 'interior-law',     use: 2.6, off: 0.5, sub: 'EXTRACTION NEVER EXCEEDS INFLOW',
      sub2: 'a full-reserve queue — it signs only what revenue backed' },
    { p: 'mm-noprint',       use: 2.6, off: 0.4, sub: 'THE MONEY PRINTER IS RETIRED',
      sub2: 'no wage, no emission schedule — supply enters by being bought' },
    { p: 'crime-laundry',    use: 2.6, off: 0.5, sub: 'CASH CAN NEVER BUY $OMR',
      sub2: 'the one conversion runs the other way — grinding can’t inflate the token' },
    { p: 'interior-den',     use: 2.6, off: 0.7, sub: 'EVERY SINK LANDS BACK ON THE DESK',
      sub2: 'dues · the compound · seals · intel · vanity — resold at tomorrow’s auction' },
    { p: 'cine-payday',      use: 2.6, off: 0.5, sub: 'BANK PROFIT PAYS THE PLAYERS WHO PLAY',
      sub2: 'bought $OMR, split by real activity — money alone takes nothing' },
    { p: 'estate-4',         use: 2.6, off: 0.5, sub: 'POWER KEYS ON HELD $OMR',
      sub2: 'stake it for rank — and staked wealth is lootable. risk is the point' },
    // ═══ ACT III — the crews & the families: the community pot (founder ask 2026-08-21) ═══
    { p: 'outfit-volkov',    use: 2.0, off: 0.5, kicker: 'III · THE CREWS & THE FAMILIES' },
    { p: 'mm-crew',          use: 2.7, off: 0.4, sub: 'NOBODY CLIMBS ALONE — START AS A CREW',
      sub2: 'a small pact of players — shared marks, watched backs' },
    { p: 'mm-family',        use: 2.7, off: 0.4, sub: 'GROW INTO A FAMILY',
      sub2: 'recruit made men · pool tribute · take turf' },
    { p: 'cine-war',         use: 2.7, off: 0.5, sub: 'FAMILIES GO TO WAR',
      sub2: 'tribute and wars won set the season’s standing' },
    { p: 'mm-pot',           use: 2.8, off: 0.4, sub: 'REAL REVENUE FUNDS THE COMMUNITY POT',
      sub2: 'a declared cut of the city’s own fees buys $OMR for the families' },
    { p: 'mm-seats',         use: 2.8, off: 0.4, sub: 'THE TOP FAMILIES SPLIT THE POT',
      sub2: 'seasonal standing decides — every seat is re-fought' },
    // ═══ ACT IV — the RWA arc: play accumulates real-world assets ═══
    { p: 'estate-6',         use: 2.0, off: 0.5, kicker: 'IV · REAL-WORLD ASSETS' },
    { p: 'interior-legit',   use: 2.6, off: 0.5, sub: 'THE TREASURY STACKS ETH',
      sub2: 'its slice of every fee, bond, sell and yield' },
    { p: 'crime-ballot',     use: 2.6, off: 0.5, sub: 'THE FAMILIES VOTE THE TICKER',
      sub2: 'the commission picks the day’s stock' },
    { p: 'crime-ticker',     use: 2.6, off: 0.5, sub: 'THE TREASURY BUYS TOKENIZED STOCK',
      sub2: 'real fills only, behind hard price walls' },
    { p: 'interior-streets', use: 2.6, off: 0.5, sub: 'YOUR SHARE IS EARNED BY PLAYING',
      sub2: 'activated brokers split every buy by activity — idle money takes nothing' },
    { p: 'district-brick',   use: 2.6, off: 0.5, sub: 'DELIVERED INTO YOUR STREET’S VAULT',
      sub2: 'the deed is an NFT — sell the street, the book travels with it' },
    { p: 'heist-vault',      use: 2.6, off: 0.5, sub: 'OR BURN $OMR FOR TREASURY ETH',
      sub2: 'the vault only ever owes what it already holds' },
    { p: 'hero-backdrop',    use: 3.4, off: 0.5, title: 'OMERTÀ',
      cta: 'the ledger is public · extraction opens at launch · omerta.fun' },
  ] },
  // 7 — THE LIFE: every activity, path and loop in the game (founder-directed 2026-08-21, $10 of
  // new footage). A hype-paced TOUR rather than an explainer: six act cards mirroring the game's
  // own journey groups (Streets → Rackets → Vice → Blood → Family → Legit), each caption's detail
  // line ENUMERATING the loops it stands for, so nothing shippable is missed while the cut stays
  // watchable. Four new bespoke action clips (street race, knockout, jailbreak, boat chase) cover
  // the loops the library had no ACTION footage for; everything else is a free edit of the library.
  // Copy rules as ever: mechanism-true, number-free, the closer states extraction opens at launch.
  life: { w: 1920, h: 1080, ar: '16:9', overline: 'THE LIFE', shots: [
    // ═══ COLD OPEN ═══
    { p: 'hero-poster',      use: 2.2, off: 0.3, sub: 'ONE CITY. A THOUSAND WAYS TO RUN IT.' },
    { p: 'mm-chase',         use: 2.0, off: 0.3, sub: 'PICK YOUR PATH — OR WALK THEM ALL' },
    // ═══ ACT I — the street loops ═══
    { p: 'district-neon',    use: 1.8, off: 0.6, kicker: 'I · THE STREETS' },
    { p: 'crime-armored',    use: 2.2, off: 0.5, sub: 'PULL JOBS',
      sub2: 'forty-three crimes — case it, do it, or go loud' },
    { p: 'car-spectre',      use: 2.2, off: 0.6, sub: 'BOOST CARS',
      sub2: 'build the fleet · tune it · race it · steal theirs' },
    { p: 'interior-gym',     use: 2.2, off: 0.5, sub: 'TRAIN YOUR BUILD',
      sub2: 'three stats · five disciplines · ten trades · a skill tree' },
    { p: 'hitman-legbreaker', use: 2.2, off: 0.5, sub: 'ARM UP',
      sub2: 'iron, vests and ammo — then go collect' },
    { p: 'interior-trade',   use: 2.2, off: 0.5, sub: 'WORK THE FREIGHT',
      sub2: 'buy cheap across town — sell where it’s rich' },
    // ═══ ACT II — the earner loops ═══
    { p: 'interior-empire',  use: 1.8, off: 0.5, kicker: 'II · THE RACKETS' },
    { p: 'interior-kitchen', use: 2.2, off: 0.5, sub: 'COOK AND DEAL',
      sub2: 'run the lab · work the corner · hire a crew' },
    { p: 'business-casino',  use: 2.2, off: 0.4, sub: 'BUY THE FRONTS',
      sub2: 'laundromat to casino — pay the pad, dodge the Bureau' },
    { p: 'heist-goldvault',  use: 2.2, off: 0.5, sub: 'PULL A CREW SCORE',
      sub2: 'five-man jobs — and maybe a rat in the crew' },
    { p: 'crime-truck',      use: 2.2, off: 0.5, sub: 'RUN THE CONVOYS',
      sub2: 'bulk freight, armed guards — bandits on the road' },
    { p: 'mm-boatchase',     use: 2.4, off: 2.6, sub: 'SMUGGLE BY SEA',
      sub2: 'boats, routes, piracy — outrun the Coast Guard' },
    { p: 'interior-market',  use: 2.2, off: 0.5, sub: 'PLAY THE BLACK MARKET',
      sub2: 'car auctions · buy orders · loan paper · the exchange' },
    // ═══ ACT III — the vice loops ═══
    { p: 'interior-den',     use: 1.8, off: 0.7, kicker: 'III · THE VICE' },
    { p: 'game-dice',        use: 2.2, off: 0.5, sub: 'PLAY THE HOUSE',
      sub2: 'craps · blackjack · the numbers · hold’em · the ring' },
    { p: 'game-track',       use: 2.2, off: 0.5, sub: 'BET THE TRACK',
      sub2: 'dogs and ponies — or enter your own runner' },
    { p: 'interior-stable',  use: 2.2, off: 0.5, sub: 'OWN THE ANIMALS',
      sub2: 'buy · train · breed · race the town’s best' },
    // The first mm-knockout render (job 01a0235e-9eb9-7373-833d-7a8dba02818e) was stranded behind
    // a stale TOP_UP lock on its result fetch even after the account came back — re-rendered fresh.
    { p: 'mm-knockout',      use: 2.4, off: 0.3, sub: 'RUN A FIGHT STABLE',
      sub2: 'sign fighters, take the belt — or fix the odds' },
    { p: 'mm-streetrace',    use: 2.4, off: 0.3, sub: 'RACE FOR PINK SLIPS',
      sub2: 'tune it, arm the nitrous — winner keeps the car' },
    { p: 'interior-speakeasy', use: 2.2, off: 0.5, sub: 'OPEN A SPEAKEASY',
      sub2: 'be seen, buy rounds — or stand over a rival’s club' },
    // ═══ ACT IV — the blood loops ═══
    { p: 'cine-funeral',     use: 1.8, off: 0.5, kicker: 'IV · THE BLOOD' },
    { p: 'hitman-professional', use: 2.2, off: 0.5, sub: 'TAKE CONTRACTS',
      sub2: 'open bounties · named hits · guns for hire' },
    { p: 'cine-whacked',     use: 2.2, off: 0.5, sub: 'SETTLE VENDETTAS',
      sub2: 'one life each — the ledger remembers the blood' },
    { p: 'interior-wire',    use: 2.2, off: 0.5, sub: 'WORK THE WIRES',
      sub2: 'taps · dossiers · blackmail · disinformation' },
    { p: 'interior-loans',   use: 2.2, off: 0.5, sub: 'BE THE SHYLOCK',
      sub2: 'lend it, collect it, seize the collateral' },
    { p: 'interior-law',     use: 2.2, off: 0.5, sub: 'BEAT THE RICO CASE',
      sub2: 'bribes, lawyers, juries — or flip and wear the wire' },
    { p: 'mm-jailbreak',     use: 2.4, off: 0.3, sub: 'GO OVER THE WALL',
      sub2: 'work the yard, run the crews — or break out' },
    // ═══ ACT V — the family loops ═══
    { p: 'mm-crew',          use: 1.8, off: 0.4, kicker: 'V · THE FAMILY' },
    { p: 'mm-family',        use: 2.2, off: 0.4, sub: 'RISE — CREW TO FAMILY',
      sub2: 'get made · pool tribute · claim turf' },
    { p: 'cine-war',         use: 2.2, off: 0.5, sub: 'GO TO WAR',
      sub2: 'seize districts, sack empires, crown the season' },
    { p: 'outfit-volkov',    use: 2.2, off: 0.5, sub: 'BREAK THE CARTELS',
      sub2: 'raid the outfits — take their turf and their tribute' },
    { p: 'mm-seats',         use: 2.2, off: 0.4, sub: 'SIT ON THE COMMISSION',
      sub2: 'decrees and vetoes — the five seats run the city' },
    { p: 'crest',            use: 2.2, off: 0.6, sub: 'RAISE MONUMENTS',
      sub2: 'seals, charters, a skyline with your name on it' },
    // ═══ ACT VI — going legit ═══
    { p: 'interior-legit',   use: 1.8, off: 0.5, kicker: 'VI · GOING LEGIT' },
    { p: 'interior-estate',  use: 2.2, off: 0.5, sub: 'BUY THE COMPOUND',
      sub2: 'staff it, name it, throw the gala' },
    { p: 'district-brick',   use: 2.2, off: 0.5, sub: 'OWN YOUR STREET',
      sub2: 'name it, run its corner — the deed is an NFT' },
    { p: 'crime-ticker',     use: 2.4, off: 0.5, sub: 'PLAY YOUR WAY TO A REAL BOOK',
      sub2: 'the treasury buys stock — split by play, into your street’s vault' },
    { p: 'hero-backdrop',    use: 3.2, off: 0.5, title: 'OMERTÀ',
      cta: 'every path is open · extraction opens at launch · omerta.fun' },
  ] },
  // 8 — THE TRAILER: the flagship ~31s cinematic (2026-08-21, the masterpiece budget). A STORY
  // ARC, not a tour: arrive with nothing → first jobs → crew up → get made → war → the name →
  // the seat → the city at your feet. Seven new hero-grade t2v shots carry the arc; the strongest
  // existing bespoke footage fills between. No mechanism copy here — the trailer sells the
  // FANTASY; the money/life cuts carry the mechanics. Closer states extraction opens at launch.
  trailer: { w: 1920, h: 1080, ar: '16:9', overline: 'THE RISE', shots: [
    { p: 'mm-arrival',    use: 3.0, off: 0.4, sub: 'YOU ARRIVE WITH NOTHING' },
    { p: 'mm-alleyjob',   use: 2.4, off: 0.4, sub: 'TAKE WHAT’S YOURS' },
    { p: 'mm-chase',      use: 2.2, off: 0.4 },
    { p: 'mm-crew',       use: 2.4, off: 0.4, sub: 'FIND YOUR PEOPLE' },
    { p: 'mm-induction',  use: 3.0, off: 0.4, sub: 'GET MADE' },
    // mm-tommygun was rendered for this slot and Seedance softened the gunfire out of it (a clean
    // cruising sedan, no muzzle flash on any frame) — the hit that starts the war is told with the
    // library's falling-fedora shot instead, and the sedan clip stays in the library as b-roll.
    { p: 'cine-whacked',  use: 2.2, off: 1.2 },
    { p: 'cine-war',      use: 2.4, off: 0.5, sub: 'GO TO WAR' },
    { p: 'mm-respect',    use: 2.6, off: 0.4, sub: 'EARN THE NAME' },
    { p: 'mm-seats',      use: 2.2, off: 0.5, sub: 'TAKE THE SEAT' },
    { p: 'mm-penthouse',  use: 3.0, off: 0.4, sub: 'THE CITY AT YOUR FEET' },
    { p: 'mm-toast',      use: 2.4, off: 0.4, sub: 'ONE FAMILY. ONE CODE.' },
    { p: 'hero-backdrop', use: 3.6, off: 0.5, title: 'OMERTÀ',
      cta: 'one life · no respawns · extraction opens at launch · omerta.fun' },
  ] },
  // 9 — THE SHORTS PACK (2026-08-21, the masterpiece budget): three native 9:16 per-hook cuts for
  // X/TikTok/Reels — one hook each (the kill economy · the vice · the rise), ~13s, built to be
  // watched MUTED: the subtitles carry the pitch, no narration. The two portrait-composed hook
  // shots generate natively (t2v honors 9:16); everything else reuses the library free through
  // shotClip's centre cover-crop. Copy stays mechanism-true + number-free (the HYPE.md rules).
  'short-blood': { w: 1080, h: 1920, ar: '9:16', shots: [
    { p: 'mm-mark',             use: 2.6, off: 0.4, sub: 'EVERY PLAYER IS A MARK' },
    { p: 'hitman-professional', use: 2.0, off: 0.5, sub: 'TAKE THE CONTRACT' },
    { p: 'cine-whacked',        use: 2.2, off: 1.2, sub: 'ONE LIFE. NO RESPAWNS.' },
    { p: 'cine-payday',         use: 2.0, off: 2.8, sub: 'THEY DROP WHAT THEY HOLD' }, // off 2.8: the cash lands at ~3.0s — 0.4s is still the empty desk lamp (frame-read)
    { p: 'hero-backdrop',       use: 3.2, off: 0.5, title: 'OMERTÀ', cta: 'the city pays the bold · omerta.fun' },
  ] },
  'short-vice': { w: 1080, h: 1920, ar: '9:16', shots: [
    { p: 'mm-fortune',    use: 2.6, off: 0.4, sub: 'THE HOUSE IS OPEN' },
    { p: 'crime-highroll', use: 2.0, off: 0.5, sub: 'HIGH STAKES' },
    { p: 'mm-knockout',   use: 2.2, off: 0.3, sub: 'RUN THE FIGHTS' },
    { p: 'mm-streetrace', use: 2.2, off: 0.4, sub: 'RACE FOR PINKS' },
    { p: 'hero-backdrop', use: 3.2, off: 0.5, title: 'OMERTÀ', cta: 'every table is open · omerta.fun' },
  ] },
  'short-rise': { w: 1080, h: 1920, ar: '9:16', shots: [
    { p: 'mm-arrival',    use: 2.4, off: 0.4, sub: 'ARRIVE WITH NOTHING' },
    { p: 'mm-induction',  use: 2.4, off: 0.4, sub: 'GET MADE' },
    { p: 'mm-respect',    use: 2.2, off: 0.4, sub: 'EARN THE NAME' },
    { p: 'mm-penthouse',  use: 2.6, off: 0.4, sub: 'TAKE THE CITY' },
    { p: 'hero-backdrop', use: 3.2, off: 0.5, title: 'OMERTÀ', cta: 'one life · no respawns · omerta.fun' },
  ] },
  // 10 — THE RWA ARC (2026-08-21, the masterpiece budget): the ~48s narrated explainer for the ONE
  // claim no other game can make — play accumulates a real book. Standalone telling of the money
  // cut's Act IV: the treasury's declared slice → the families vote the ticker → real tokenized
  // stock → split by PLAY → delivered into your street deed's vault. One new hero shot
  // (mm-vaultdrop); everything else is a free edit of the library. Copy rules as ever:
  // mechanism-true, number-free, the closer states extraction opens at launch.
  rwa: { w: 1920, h: 1080, ar: '16:9', overline: 'GOING LEGIT', shots: [
    // ═══ COLD OPEN ═══
    { p: 'hero-poster',      use: 2.6, off: 0.3, sub: 'EVERY EMPIRE DREAMS OF GOING LEGIT' },
    { p: 'interior-legit',   use: 2.6, off: 0.5, sub: 'THIS ONE CAN' },
    // ═══ ACT I — the treasury ═══
    { p: 'citymap',          use: 2.0, off: 0.6, kicker: 'I · THE TREASURY' },
    { p: 'mm-four',          use: 2.8, off: 0.4, sub: 'A DECLARED SLICE OF EVERY REAL FEE',
      sub2: 'identity · the store · bonds · the sell tax · yield' },
    { p: 'crime-depository', use: 2.6, off: 0.5, sub: 'THE TREASURY STACKS ETH',
      sub2: 'real revenue — never player deposits' },
    { p: 'mm-tax',           use: 2.8, off: 0.4, sub: 'COLLECTED INSIDE THE SWAP',
      sub2: 'the tax arrives as ETH — nothing to unwind' },
    // ═══ ACT II — the vote & the buy ═══
    { p: 'mm-seats',         use: 2.0, off: 0.5, kicker: 'II · THE VOTE' },
    { p: 'crime-ballot',     use: 2.8, off: 0.5, sub: 'THE FAMILIES VOTE THE TICKER',
      sub2: 'the commission picks the day’s stock' },
    { p: 'crime-alderman',   use: 2.4, off: 0.5, sub: 'EVERY SEAT IS RE-FOUGHT',
      sub2: 'seasonal standing decides who votes' },
    { p: 'crime-ticker',     use: 2.8, off: 0.5, sub: 'THE TREASURY BUYS TOKENIZED STOCK',
      sub2: 'real fills only — behind hard price walls' },
    // ═══ ACT III — your share ═══
    { p: 'estate-6',         use: 2.0, off: 0.5, kicker: 'III · YOUR SHARE' },
    { p: 'cine-payday',      use: 2.8, off: 2.8, sub: 'EARNED BY PLAYING',
      sub2: 'activated brokers split every buy by activity' },
    { p: 'interior-streets', use: 2.6, off: 0.5, sub: 'IDLE MONEY TAKES NOTHING',
      sub2: 'money alone buys no share — play does' },
    { p: 'district-brick',   use: 2.6, off: 0.5, sub: 'YOUR STREET ON THE MAP',
      sub2: 'claim it, name it — the deed is an NFT' },
    { p: 'mm-vaultdrop',     use: 3.0, off: 0.4, sub: 'DELIVERED INTO THE DEED’S VAULT',
      sub2: 'sell the street — the book travels with it' },
    // ═══ ACT IV — the exit ═══
    { p: 'heist-vault',      use: 2.8, off: 0.5, sub: 'OR BURN $OMR FOR TREASURY ETH',
      sub2: 'the vault only ever owes what it already holds' },
    { p: 'mm-noprint',       use: 2.8, off: 0.4, sub: 'NOTHING HERE IS PRINTED',
      sub2: 'no emission, no promises — a ledger anyone can audit' },
    { p: 'hero-backdrop',    use: 3.8, off: 0.5, title: 'OMERTÀ',
      cta: 'play your way to a real book · extraction opens at launch · omerta.fun' },
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

// ── narration — the explainer SPEAKS (founder ask 2026-08-21: "a strong voice narrating") ─────────
// Segments are timed to the money cut's ACT boundaries rather than per shot: 28 shots at ~2.8s
// cannot each carry a spoken sentence, and a trailer VO that chases every caption reads as a
// caption reader. Each segment states its window; synthesis is FIT-CHECKED against it (a segment
// that overruns is tempo-compressed up to a cap, and a segment that would still overrun fails the
// build rather than talking over the next act). Copy rules are the file's own: mechanism-true,
// number-free, founder signs the wording before anything goes public.
const NARRATION = {
  money: [
    { at: 0.4, window: 26.6, text:
      'Every dollar in this city is on the books. Real money comes in eight ways. '
      + 'Getting made costs real ETH. The store sells for ETH. Bonds raise it. '
      + 'Every token sold pays the tax. The desk auctions supply, daily. '
      + 'The house pool earns its trading fees. The bank takes its cut of yield. '
      + 'And leaving? Leaving pays the toll.' },
    { at: 27.6, window: 21.6, text:
      'Where does it go? Four declared destinations. '
      + 'The vig buys the token off the open market and fills the reserve — '
      + 'extraction never exceeds what came in. Nothing is printed. Cash can never buy it. '
      + 'Every sink lands back on the desk and sells again tomorrow. '
      + 'And everything you hold? Someone can take.' },
    { at: 50.4, window: 15.0, text:
      'Nobody climbs alone. A crew becomes a family. Tribute. Turf. War. '
      + 'Because a cut of the city\u2019s real revenue buys the token for the families — '
      + 'and the top families split the pot. Every seat is re-fought.' },
    { at: 66.0, window: 17.0, text:
      'The city goes legit. The treasury stacks ETH. The families vote the ticker. '
      + 'It buys tokenized stock — split among the players who played — '
      + 'delivered to your street\u2019s vault. Own the street, and the street holds your book.' },
    { at: 83.6, window: 2.9, text: 'Omert\u00e0. The ledger is public.' },
  ],
  life: [
    { at: 0.4, window: 16.2, text:
      'A thousand ways to run one city. Pull jobs. Boost cars. Train your build. '
      + 'Arm up, and work the freight. And that\u2019s just the street.' },
    { at: 17.2, window: 14.6, text:
      'Go bigger. Cook and deal. Buy the fronts. Pull a crew score. '
      + 'Run convoys. Smuggle by sea. Play the black market.' },
    { at: 32.4, window: 14.8, text:
      'Or play the vice. The house. The track. The animals. '
      + 'Run a fight stable. Race for pink slips. Open a speakeasy of your own.' },
    { at: 47.8, window: 14.6, text:
      'And when it turns bloody \u2014 take contracts. Settle vendettas. Work the wires. '
      + 'Lend hard money. Beat the case. Or go over the wall.' },
    { at: 63.0, window: 12.4, text:
      'Nobody climbs alone. Crews become families. Families take turf, '
      + 'break cartels, and sit on the commission.' },
    { at: 75.8, window: 8.2, text:
      'Then the city goes legit. The compound. Your street\u2019s deed. '
      + 'A real book \u2014 earned by playing.' },
    { at: 83.4, window: 3.8, text: 'Omert\u00e0. Every path is open.' },
  ],
  // the TRAILER: sparse, punchy \u2014 the fantasy, not the mechanics.
  trailer: [
    { at: 0.4,  window: 9.4, text:
      'You arrive with nothing. In this city \u2014 that\u2019s all you need.' },
    { at: 10.2, window: 7.0, text:
      'Run with a crew. Get made. And when it comes to blood \u2014 answer.' },
    { at: 17.8, window: 7.0, text:
      'Earn the name \u2014 until the whole city answers to you.' },
    { at: 24.6, window: 3.4, text: 'One family. One code.' },
    { at: 28.0, window: 3.4, text: 'Omert\u00e0. One life. Make it count.' },
  ],
  // the RWA explainer: the one claim, told slowly. Segments ride the act boundaries.
  rwa: [
    { at: 0.4, window: 14.6, text:
      'Every empire dreams of going legit. This one can. '
      + 'The treasury takes a declared slice of every real fee in the city \u2014 and stacks it, in ETH.' },
    { at: 15.6, window: 9.4, text:
      'The families vote the ticker. And the treasury buys the stock \u2014 '
      + 'real fills, behind hard price walls.' },
    { at: 25.6, window: 12.6, text:
      'Your share is earned by playing \u2014 by what you did, not what you hold. '
      + 'And it lands in your street\u2019s vault. Sell the street? The book travels.' },
    { at: 38.6, window: 5.4, text:
      'Or burn the token for ETH. Nothing is printed here.' },
    { at: 44.2, window: 3.4, text: 'Omert\u00e0. The book is real.' },
  ],
};
// fal TTS (the real voice): MiniMax speech-02-hd, a deep trailer read. Cached in the LIB beside the
// clips + ledgered like them, so a rebuild never re-spends. Needs a FUNDED key — a locked account
// answers "Exhausted balance", and the error is surfaced verbatim so the fix is legible.
const FAL_TTS_MODEL = process.env.FAL_TTS_MODEL || 'fal-ai/minimax/speech-02-hd';
const FAL_TTS_VOICE = process.env.FAL_TTS_VOICE || 'Deep_Voice_Man';
// local placeholder (piper, en_US-ryan-high): TIMING-true so the edit can be judged today, clearly
// second-choice on delivery — swapped for the fal voice by re-running with --vo once topped up.
const PIPER_MODEL = process.env.PIPER_MODEL || '/tmp/en_US-ryan-high.onnx';

function audioDur(file) {
  try { execFileSync(FF, ['-i', file], { stdio: 'pipe' }); } catch (e) {
    const m = String(e.stderr).match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  throw new Error(`could not read duration of ${file}`);
}

async function synthSegment(text, outBase, mode) {
  if (mode === 'local') {
    const out = `${outBase}.wav`;
    execFileSync('piper', ['-m', PIPER_MODEL, '-f', out, '--length-scale', '1.22'],
      { input: text, stdio: ['pipe', 'ignore', 'inherit'] });
    return out;
  }
  // fal — cached: a segment already synthesized (same text) is never re-bought.
  const out = `${outBase}.mp3`, meta = `${outBase}.json`;
  if (fs.existsSync(out) && fs.existsSync(meta) && JSON.parse(fs.readFileSync(meta, 'utf8')).text === text) return out;
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set — --vo needs a funded fal.ai key (or use --vo-local for the placeholder voice).');
  const r = await fetch(`https://fal.run/${FAL_TTS_MODEL}`, {
    method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_setting: { voice_id: FAL_TTS_VOICE, speed: 0.92 } }),
  });
  const j = await r.json().catch(() => ({}));
  const url = j?.audio?.url || j?.audio_url || j?.url;
  if (!r.ok || !url) throw new Error(`fal TTS: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  fs.writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
  fs.writeFileSync(meta, JSON.stringify({ text, model: FAL_TTS_MODEL, voice: FAL_TTS_VOICE }));
  return out;
}

// one VO master track: each segment placed at its act boundary, fit-checked against its window,
// polished once (highpass + compression + loudnorm hotter than the bed, which ducks under it).
async function buildVoMaster(cutId, mode) {
  const segs = NARRATION[cutId];
  if (!segs) throw new Error(`no narration written for cut '${cutId}'`);
  fs.mkdirSync(TMP, { recursive: true });
  const inputs = [], chains = [], mix = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const base = mode === 'local' ? path.join(TMP, `vo-${cutId}-${i}`) : path.join(LIB, `vo-${cutId}-${i}`);
    const f = await synthSegment(seg.text, base, mode);
    const dur = audioDur(f);
    // tempo-fit: compress up to 1.25× to make the window; past that the SCRIPT is too long — fail
    // loudly rather than ship a voice that talks over the next act.
    const tempo = dur > seg.window ? dur / seg.window : 1;
    if (tempo > 1.25) throw new Error(`narration segment ${i} runs ${dur.toFixed(1)}s against a ${seg.window}s window — trim the script.`);
    inputs.push('-i', f);
    const at = Math.round(seg.at * 1000);
    chains.push(`[${i}:a]${tempo > 1.01 ? `atempo=${tempo.toFixed(3)},` : ''}aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${at}|${at}[s${i}]`);
    mix.push(`[s${i}]`);
    console.log(`  vo ${i}: ${dur.toFixed(1)}s${tempo > 1.01 ? ` → ×${tempo.toFixed(2)} fit` : ''} @ ${seg.at}s (window ${seg.window}s)`);
  }
  const out = path.join(TMP, `vo-${cutId}.wav`);
  execFileSync(FF, ['-y', ...inputs, '-filter_complex',
    `${chains.join(';')};${mix.join('')}amix=inputs=${segs.length}:normalize=0,`
    + 'highpass=f=75,acompressor=threshold=0.3:ratio=3:attack=8:release=180,loudnorm=I=-14:TP=-1.5:LRA=9[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  return out;
}

// ── title cards (SVG → PNG, transparent, display font), scaled to the cut ─────────────────────────
function titlePng(shot, i, w, h, overline) {
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
    body += line(w / 2, h / 2 - kSize * 0.55, ctaSize, ctaSize * 0.3, '#c9a24b', overline || 'THE MONEY MAP');
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
  // a portrait cut prefers a native 9:16 render, but any landscape clip in the library serves it
  // through the same centre cover-crop (the noir plates are centre-weighted — HYPE.md) — motion
  // always beats the Ken-Burns still fallback, and the bespoke t2v clips HAVE no still to fall to.
  let src = clipFile(shot.p, v.ar);
  if (!fs.existsSync(src) && fs.existsSync(clipFile(shot.p, '16:9'))) src = clipFile(shot.p, '16:9');
  const w = v.w, h = v.h;
  const out = path.join(TMP, `fx-${String(i).padStart(2, '0')}.mp4`);
  const title = titlePng(shot, i, w, h, v.overline);
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
function assembleCut(clips, out, music, vo, hits = []) {
  // the VO tail: with a voice track the music graph lands on [mus] and the voice side-chain DUCKS
  // it (the bed dips under every spoken line and swells back between them — the trailer mix),
  // then the cut's own compressor/limiter runs over the sum exactly as before. Without one, [mus]
  // takes the same tail untouched, so a narration-less build is byte-shape identical to the old.
  const voTail = (idx, tail) => (vo
    ? `[${idx}:a]asplit=2[vk][vm];[mus][vk]sidechaincompress=threshold=0.05:ratio=8:attack=15:release=450[md];[md][vm]amix=inputs=2:normalize=0,${tail}[a]`
    : `[mus]${tail}[a]`);
  const total = clips.reduce((a, c) => a + c.sec, 0);
  const listFile = path.join(TMP, `list-${path.basename(out, '.mp4')}.txt`);
  fs.writeFileSync(listFile, clips.map((c) => `file '${c.clip}'`).join('\n'));
  const D = total.toFixed(3), titleAt = total - clips[clips.length - 1].sec;
  // the impact track is ONE absolute-time expression carrying the title BRAAAM plus a smaller
  // punctuation hit at every act boundary (the explainer's chapter cards), so the long cut keeps a
  // pulse instead of one payoff 80 seconds in. if() evaluates lazily, so the decaying exp() can
  // never overflow before its gate.
  const boom = (T, amp, f, k) => `if(gte(t,${T}),${amp}*sin(2*PI*${f}*(t-${T}))*exp(-${k}*(t-${T})),0)`;
  const hitExpr = [boom(titleAt.toFixed(3), 0.95, 44, 2.0), boom(titleAt.toFixed(3), 0.6, 88, 3.2),
    ...hits.map((t) => boom(t.toFixed(3), 0.55, 52, 3.5))].join('+');
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
      '-f', 'lavfi', '-i', `aevalsrc='${hitExpr}':d=${D}:s=44100`];
    fc = `[1:a]loudnorm=I=-15:TP=-1.2:LRA=11,afade=in:st=0:d=0.5,afade=out:st=${(total - 1.2).toFixed(3)}:d=1.2,atrim=0:${D},asetpts=N/SR/TB[bed];`
      + `[2]highpass=f=700,volume='0.02+0.6*clip((t-${riseStart})/2.2,0,1)':eval=frame,afade=out:st=${titleAt.toFixed(3)}:d=0.25[riser];`
      + `[3]lowpass=f=220,volume=1.15[hit];`
      + `[bed][riser][hit]amix=inputs=3:normalize=0[mus];`
      + voTail('4', 'acompressor=threshold=0.12:ratio=5:attack=6:release=140,alimiter=limit=0.96');
    amap = '[a]';
  } else {
    // input 0 is the concat VIDEO; the lavfi audio sources are inputs 1..4.
    ain = ['-f', 'lavfi', '-i', `aevalsrc='0.9*sin(2*PI*55*t)*exp(-11*mod(t,0.5))':d=${D}:s=44100`,
      '-f', 'lavfi', '-i', `sine=frequency=41:duration=${D}`,
      '-f', 'lavfi', '-i', `anoisesrc=d=${D}:color=pink:amplitude=1`,
      '-f', 'lavfi', '-i', `aevalsrc='${hitExpr}':d=${D}:s=44100`];
    fc = `[1]volume=0.55[k];`
      + `[2]volume=0.12,tremolo=f=2:d=0.4[sub];`
      + `[3]highpass=f=900,volume='0.03+0.5*clip((t-(${D}-4))/4,0,1)':eval=frame[riser];`
      + `[4]lowpass=f=200,volume=1.1[hit];`
      + `[k][sub][riser][hit]amix=inputs=4:normalize=0,`
      + `afade=in:st=0:d=0.3,afade=out:st=${(total - 1.2).toFixed(3)}:d=1.2[mus];`
      + voTail('5', 'acompressor=threshold=0.15:ratio=6:attack=5:release=120,alimiter=limit=0.95');
    amap = '[a]';
  }
  if (vo) ain.push('-i', vo);
  execFileSync(FF, ['-y', ...vin, ...ain, '-filter_complex', fc, '-map', '0:v', '-map', amap,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', D, out],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  return total;
}

async function buildCut(id, music, voMode) {
  const v = VIDEOS[id];
  if (!v) throw new Error(`unknown cut '${id}' — one of: ${Object.keys(VIDEOS).join(', ')}`);
  fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
  let vo = null;
  if (voMode) {
    if (NARRATION[id]) vo = await buildVoMaster(id, voMode);
    else console.log(`  (no narration written for '${id}' — building without a voice)`);
  }
  let missing = 0;
  const clips = v.shots.map((s, i) => { if (!fs.existsSync(clipFile(s.p, v.ar)) && !fs.existsSync(clipFile(s.p, '16:9'))) missing++; return shotClip(s, i, v); });
  // act boundaries (the kicker cards) each land a small impact — computed here where the shot
  // metadata still exists, since assembleCut only sees the rendered clips.
  const hits = []; let t = 0;
  for (const s of v.shots) { if (s.kicker) hits.push(t); t += s.use; }
  const out = path.join(ART, id === 'hype' ? 'hype.mp4' : `hype-${id}.mp4`);
  const total = assembleCut(clips, out, music, vo, hits);
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
  // BESPOKE plates have no source still — they are text-to-video (falBespoke), never i2v.
  const need = neededClips().filter((c) => !BESPOKE[c.plate] && !fs.existsSync(clipFile(c.plate, c.ar)));
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

// ── the bespoke library (Seedance 2.5 TEXT-to-video — the action footage; needs FAL_KEY) ──────────
// Same discipline as falRun: parallel submits, one shared ledger, a hard --cap, cached forever.
// t2v needs no source still, so it depends on neither the production deploy nor the $12 art cap.
const FAL_T2V_MODEL = process.env.FAL_T2V_MODEL || 'bytedance/seedance-2.5/text-to-video';
async function falBespoke() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set — --bespoke needs a funded fal.ai key.');
  const cap = Number(opt('--cap', '150'));
  const H = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  fs.mkdirSync(LIB, { recursive: true });
  const ledger = path.join(LIB, 'hype-manifest.json');
  const man = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { model: FAL_VIDEO_MODEL, spentUsd: 0, clips: [] };
  // only clips a cut actually REFERENCES are generated — the unreferenced BESPOKE prompts are
  // future options that cost nothing (the 2026-08-21 $30-budget trim).
  // (plate, ar) pairs — t2v has no source still, so Seedance genuinely honors a 9:16 request and a
  // portrait cut gets a NATIVE vertical render (i2v keeps the source aspect; t2v does not have one).
  // A portrait plate whose 16:9 sibling already exists still renders — the two are distinct files.
  // …but a plate whose 16:9 render is already in hand is SERVED by shotClip's cover-crop fallback —
  // only a plate with no render at all is worth new money (the shorts reuse the trailer's footage
  // for free; only their portrait-composed hook shots generate).
  const need = neededClips().filter((c) => BESPOKE[c.plate] && !fs.existsSync(clipFile(c.plate, c.ar)) && !fs.existsSync(clipFile(c.plate, '16:9')));
  const todo = [];
  for (const c of need) {
    if (man.spentUsd + (todo.length + 1) * EST_PER > cap) { console.log(`cap $${cap} would be exceeded — stopping at ${c.plate}`); break; }
    todo.push(c);
  }
  console.log(`bespoke: queueing ${todo.length} of ${need.length} needed on ${FAL_T2V_MODEL} @ ${FAL_RES} (est +$${(todo.length * EST_PER).toFixed(2)}, cap $${cap})`);
  const jobs = [];
  for (const c of todo) {
    const p = c.plate;
    const body = { prompt: BESPOKE[p], resolution: FAL_RES, aspect_ratio: c.ar, duration: '5', generate_audio: false };
    // fal's balance gate is FLAKY under a queue of reserving jobs — a 403 "Exhausted balance" can be
    // followed seconds later by a clean accept (measured live 2026-08-21). Retry with backoff; only
    // a submit that stays locked through the whole ladder is a real out-of-money stop.
    let accepted = false;
    for (let a = 0; a < 8 && !accepted; a++) {
      const r = await fetch(`https://queue.fal.run/${FAL_T2V_MODEL}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.ok && j.request_id) {
        jobs.push({ p, ar: c.ar, id: j.request_id, done: false });
        console.log(`  queued ${p} @ ${c.ar} (${j.request_id})`);
        accepted = true;
      } else if (r.status === 403 && a < 7) {
        console.log(`  … ${p} bounced (${r.status}, attempt ${a + 1}) — retrying`);
        await sleep(20000 + a * 15000);
      } else throw new Error(`fal t2v submit ${p}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    }
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
          fs.writeFileSync(clipFile(job.p, job.ar), Buffer.from(await (await fetch(url)).arrayBuffer()));
          man.spentUsd += EST_PER; man.clips.push({ plate: job.p, ar: job.ar, t2v: true, url, est: EST_PER });
          fs.writeFileSync(ledger, JSON.stringify(man, null, 2));
          job.done = true; pending--;
          console.log(`  ✓ ${job.p}  (${pending} left, ~$${man.spentUsd.toFixed(2)})`);
        }
      }
    }
    if (pending) process.stdout.write(`  … ${pending} still rendering (round ${round + 1})\n`);
  }
  if (pending) console.log(`⚠ ${pending} bespoke clip(s) never finished — those shots have NO still fallback. Re-run --bespoke.`);
  console.log(`spent ~$${man.spentUsd.toFixed(2)} of $${cap}.\n`);
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const music = opt('--music', null);
  const voMode = flag('--vo') ? 'fal' : (flag('--vo-local') ? 'local' : null);
  if (flag('--fal')) await falRun();
  if (flag('--bespoke')) await falBespoke();
  const which = opt('--cut', null);
  if (which) { await buildCut(which, music, voMode); return; }
  if (flag('--fal') || flag('--all')) {
    console.log('building cuts from the library:');
    for (const id of Object.keys(VIDEOS)) await buildCut(id, music, voMode);
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
