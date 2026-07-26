import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// OMERTÀ v24 — GRASSROOTS: incentivized onboarding & recruiting
//  · THE FIRST WEEK — Firecrawl-style one-time checklist on the
//    Today tab: six in-game firsts (auto-detected) + three
//    social tasks + a completion capstone. All rewards are
//    in-game cash/crates/energy — NEVER $OMR for social actions
//    (token-for-follows is touting territory; we don't go there).
//    Social verification is honor-claim in demo; production
//    verifies via OAuth server-side.
//  · RECRUITER LADDER — lifetime qualified-recruit milestones
//    (1/3/5/10/25) with cash, event-fund $OMR, and two titles
//    (THE RAINMAKER, PILLAR OF THE CITY). 🤝 count shows on the
//    Streets. Recruiter reputation SURVIVES death — relationships
//    are yours, not the character's.
//  · MADE YOUR BONES — the recruit is also paid ($5,000) at
//    qualification, so joining under someone beats joining raw.
//  · RECRUITMENT DRIVE — new family weekly (qualified recruits
//    count for the family), wired like every other weekly.
//  · Behavior gating unchanged: recruits qualify at level 8 /
//    40 jobs / 3 check-ins / $25k net worth. Empty accounts pay
//    nothing, same as always. Agents remain excluded.
// ─────────────────────────────────────────────────────────────
// v23 — content expansion + full rewrite/audit pass
// CONTENT: products 5 → 8 (STATIC, HALO, NOCTURNE — one line
//   per trade rank now, all 8 rungs earn something), kitchens
//   3 → 5 (Cellar Still at $80k, The Cathedral at $10M+200 OMR),
//   3-mission trade arc (m26–m28 → the KING OF APPETITES title),
//   2 events (SUPPLY DROUGHT, OPEN CITY), 2 heat-cooling
//   consumables, 3 trade-flavored gear pieces, 2 dailies.
// AUDIT FINDINGS FIXED (all tagged AUDIT R# inline):
//   R1 save migration → single forward-compatible default-merge
//   R2 inbox delivery → one pushInbox() (was 7 hand copies)
//   R3/R4 randomness hoisted out of two setP updaters
//   R5 KILL LOOT MINT CLOSED — whacks now chop the victim's
//      REAL fleet value for cash (40%); no cars generated
//   R6 corner crews now sell offline (8h cap) incl. heat and
//      raid-on-return; offline heat decays properly
//   R7 event fields heatDecay/mkMult wired
//   R8 consumable fx gained 'cool' (heat reduction)
//   R9 crimes drop Kitchen makings (15%, unlocked lines only)
// SIMS RE-RUN: crime EV curve, racket paybacks, melt/boost,
//   gear $/pt, drug margins, kill cost-vs-loot (now provably
//   value-conserving). All green.
// ─────────────────────────────────────────────────────────────
// v22 — THE KITCHEN: the product economy & the Paths
// A full second career, plugged into every existing system.
//  · FIVE PRODUCTS (all fictional, period-noir): VIM, MOONMILK,
//    LOTUS, GLASS, AMBROSIA — unlocked by Trade rank.
//  · THE CHAIN OF PRODUCTION: buy makings from The Supplier
//    (prices rotate on the same 4h blocks as trade goods) →
//    cook batches in a Kitchen (3 tiers, real-time timers,
//    fire risk, quality rolls) → deal on the street at
//    per-district demand (same hash windows) or consign to a
//    corner crew for passive sales.
//  · HEAT & THE BUREAU: every deal raises heat; heat decays
//    slowly, crews generate it constantly; past 60 the Bureau
//    raid odds climb every tick — raids take stash and freedom.
//    Lay Low (cash+energy) or Clean Papers (10 $OMR, full wipe).
//  · TRADE RANKS: 8-rung second ladder (Corner Boy → The
//    Apothecary King) from lifetime product moved; shows on
//    the Streets beside your name; gates the stronger product.
//  · PATHS: at level 5 pick a career — THE GUN (+10% fight
//    power, +15% hit effectiveness), THE LEDGER (+10% racket &
//    front income, +5% trade-good sales), THE KITCHEN (+15%
//    cook quality, −25% heat). First pick $10k; switching
//    costs 25 $OMR. A real build choice, not a cosmetic.
//  · INTEGRATION: 2 new city events (BUREAU SWEEP, THE THIRST),
//    3 new dailies, 1 family weekly (units moved), 2 missions
//    gated on trade rep, agent actions, Estate handling (the
//    whole operation is street — it dies with you), crates
//    consumed as packaging (1 per 20 units cooked).
//  · The Exchange does NOT touch product — too hot for the
//    order book. Street demand only. (Deliberate: keeps the
//    escrowed economy clean and the product loop risky.)
// ─────────────────────────────────────────────────────────────
// v21 — the 10× content build
// Two kinds of scale: much deeper hand-written ladders, and
// variant systems that multiply them without adding balance
// surface. All existing ids preserved — saves migrate clean.
//  · TRIM SYSTEM: every boosted car rolls one of 6 trims
//    (Rusted → Coachbuilt) with melt/value modifiers weighted
//    to a ~1.0 expected multiplier. 40 models × 6 trims =
//    240 distinct vehicles.
//  · CRIMES 11 → 29 (levels 1–110) · GUNS 7 → 15 · VESTS 3 → 6
//  · NFT GEAR 15 → 48 · RACKETS 9 → 18 (payback curve kept
//    monotone) · MISSIONS 9 → 25 with 3 new titles
//  · ASSETS 17 → 30 · WORKSHOP 7 → 12 (effects now data-driven)
//  · TRADE GOODS 5 → 10 · CITY EVENTS 6 → 12 (modifiers now
//    data-driven: any event can touch pay, jail, crates,
//    rackets, jumps, boosts, fences, trade, busts)
//  · DAILIES 14 → 26 · FAMILY WEEKLIES 5 → 10
//  · Balance sims re-run: expected melt/boost and crime/racket
//    curves verified against v19/v20 baselines.
// ─────────────────────────────────────────────────────────────
// v20 — the content expansion (longevity build)
// No new systems; a lot more city. All additions are appends
// keyed by new ids, so existing saves migrate untouched.
//  · CARS 7 → 14, incl. two near-mythic "legend" chassis
//    (~1.8% odds). Weights re-tuned so expected melt/boost is
//    unchanged (52.4 vs 51.4 rounds — sim-verified): more
//    variety, same kill economy.
//  · CRIMES +2 late-game tiers (lvl 48, lvl 70)
//  · MISSIONS +4 (m6–m9), two new earned titles
//  · RACKETS +3 (lvl 45/60/80), payback windows kept on the
//    same rising curve as the existing ladder
//  · ASSETS +7: two haulers (cargo now data-driven on the
//    asset, not hardcoded), two properties, three fronts
//  · NFT GEAR +8 across all rarities (more $OMR sinks)
//  · GUNS +2: a concealment king and a top-end rifle
//  · WORKSHOP +3 heavy consumables
//  · TRADE GOODS +2 high-base lines for late-game runs
//  · CITY EVENTS +2: BLACKOUT (+15% boost success) and
//    RACE DAY (fences pay +25%)
//  · DAILIES +5 and FAMILY WEEKLIES +2, wired to the Garage,
//    busting, and goods loops so every system feeds a contract
// ─────────────────────────────────────────────────────────────
// v19 — "the bullet economy" (Infamous Gangsters study)
// New systems, modeled on the classic text-mafia loop:
//  · THE GARAGE — boost cars on a 5-min cooldown, repair them,
//    fence them, or MELT them into rounds. Melting is the real
//    ammo firehose; 25% of every melt tithes to the family
//    treasury (crew bullet bank, converted at $30/round).
//  · HIT CONTRACTS — search a target (10 min demo / 3 h prod),
//    travel to where they were found, and open fire with a
//    chosen number of rounds. Too few = failed attempt, they
//    get warned, and your trigger cools for 5 min (2 h prod).
//    Witness statements go to random players on every kill.
//  · MIDDLE-PATH DEATH ("The Estate") — getting whacked kills
//    the character, not the account. ON-CHAIN SURVIVES: wallet,
//    $OMR, staked, rewards, NFT gear, prestige (+ half your
//    level converts to legacy prestige). STREET DIES: cash,
//    bank, cars, guns, rank, rackets, assets, cargo, family.
//    The heir starts with $500 + $100 per prestige star.
//  · JAIL BUSTING — jailed players are visible on the Streets;
//    bust them for cash + rep, fail and do 180 s yourself.
//    Success odds improve with your lifetime bust count.
//  · VESTS — $OMR-priced protection that multiplies the rounds
//    needed to finish you (pure utility sink, lost on death).
// Timers are demo-scaled; production values noted inline.
// ─────────────────────────────────────────────────────────────
// v18 — security hardening build
// Pentest findings patched (see omerta-pentest-v18.md for the
// full report). The systemic defect: actions guarded against the
// render-scope snapshot (p.x) but mutated via functional update,
// so a rapid double-fire — trivial for an agent or fast clicker —
// passed the stale guard twice and double-collected. Fixes:
//  · CRIT-1 double check-in / double heist / double contract
//    claim: validation moved INSIDE the state updater (self-
//    guarding — always sees live state).
//  · CRIT-2 Exchange listing dupe: an async lock (busyRef) now
//    serializes every storage-mutating action, and listings
//    re-verify inventory before escrow.
//  · HIGH-1 negative-inventory injection: all goods/cargo/ammo
//    writes clamped to >= 0.
//  · HIGH-2 self-bounty funnel and MED fixes (see report).
//  · Deterministic trade pricing (client-predictable) and the
//    pub/AMM write races are documented as server-authoritative
//    requirements — not fully fixable client-side.
// Chain activity remains SIMULATED (Phase 3: points-only).
// ─────────────────────────────────────────────────────────────

const SAVE_KEY = "omerta_save_v2";
const TICK_MS = 3000;
const SWAP_RATE = 500;
const APY = 0.14;

const CRIMES = [
  { id: "pick", name: "Pickpocket a tourist", lvl: 1, nerve: 2, cash: [40, 120], respect: 2, base: 0.9, jail: 0 },
  { id: "stereo", name: "Boost a car stereo", lvl: 1, nerve: 3, cash: [90, 260], respect: 4, base: 0.78, jail: 8 },
  { id: "numbers", name: "Run numbers for the family", lvl: 2, nerve: 4, cash: [180, 420], respect: 7, base: 0.7, jail: 10 },
  { id: "booze", name: "Lift a case off a delivery truck", lvl: 3, nerve: 3, cash: [120, 320], respect: 5, base: 0.82, jail: 9 },
  { id: "shake", name: "Shake down a shopkeeper", lvl: 4, nerve: 5, cash: [300, 700], respect: 9, base: 0.64, jail: 12 },
  { id: "highroll", name: "Roll a drunk high-roller", lvl: 5, nerve: 5, cash: [320, 780], respect: 10, base: 0.68, jail: 11 },
  { id: "truck", name: "Hijack a delivery truck", lvl: 7, nerve: 6, cash: [400, 950], respect: 12, base: 0.58, jail: 14 },
  { id: "furs", name: "Fence stolen furs uptown", lvl: 9, nerve: 7, cash: [550, 1300], respect: 15, base: 0.6, jail: 15 },
  { id: "poker", name: "Rob a back-room poker game", lvl: 11, nerve: 8, cash: [800, 2100], respect: 20, base: 0.46, jail: 18 },
  { id: "cardgame", name: "Rig the neighborhood card game", lvl: 13, nerve: 9, cash: [1000, 2600], respect: 24, base: 0.5, jail: 19 },
  { id: "torch", name: "Torch a rival's warehouse", lvl: 16, nerve: 10, cash: [1500, 4000], respect: 32, base: 0.4, jail: 22 },
  { id: "alderman", name: "Blackmail a crooked alderman", lvl: 19, nerve: 11, cash: [1800, 5200], respect: 38, base: 0.42, jail: 24 },
  { id: "armored", name: "Hit an armored car", lvl: 22, nerve: 12, cash: [2200, 6500], respect: 45, base: 0.32, jail: 26 },
  { id: "jewelry", name: "Empty a jewelry exchange after hours", lvl: 26, nerve: 13, cash: [3000, 9000], respect: 55, base: 0.3, jail: 28 },
  { id: "payroll", name: "Hold up the union payroll office", lvl: 30, nerve: 14, cash: [5000, 14000], respect: 70, base: 0.27, jail: 31 },
  { id: "vaultjob", name: "Crack the bank vault uptown", lvl: 35, nerve: 16, cash: [8000, 22000], respect: 90, base: 0.24, jail: 35 },
  { id: "railfreight", name: "Hijack a rail freight shipment", lvl: 40, nerve: 17, cash: [10000, 28000], respect: 115, base: 0.22, jail: 38 },
  { id: "harbormaster", name: "Shake down the harbor master", lvl: 44, nerve: 18, cash: [12000, 34000], respect: 135, base: 0.21, jail: 41 },
  { id: "fixfight", name: "Fix the championship fight", lvl: 48, nerve: 20, cash: [15000, 45000], respect: 160, base: 0.2, jail: 45 },
  { id: "diamond", name: "Rob the diamond courier at the airfield", lvl: 53, nerve: 21, cash: [18000, 52000], respect: 190, base: 0.19, jail: 48 },
  { id: "counting", name: "Clean out a rival's counting room", lvl: 58, nerve: 22, cash: [22000, 64000], respect: 225, base: 0.18, jail: 52 },
  { id: "museum", name: "Take the museum's gold room", lvl: 64, nerve: 24, cash: [30000, 85000], respect: 275, base: 0.16, jail: 56 },
  { id: "fedtrain", name: "Rob the federal reserve train", lvl: 70, nerve: 26, cash: [40000, 110000], respect: 320, base: 0.15, jail: 60 },
  { id: "customs", name: "Empty the customs bond warehouse", lvl: 76, nerve: 27, cash: [48000, 130000], respect: 380, base: 0.14, jail: 64 },
  { id: "mint", name: "Hit the mint's transfer convoy", lvl: 82, nerve: 28, cash: [60000, 160000], respect: 450, base: 0.13, jail: 68 },
  { id: "grandcasino", name: "Take down the Grand Casino vault", lvl: 90, nerve: 30, cash: [80000, 210000], respect: 560, base: 0.12, jail: 72 },
  { id: "clearing", name: "Rob the Exchange clearing house", lvl: 98, nerve: 32, cash: [100000, 260000], respect: 680, base: 0.11, jail: 76 },
  { id: "bonds", name: "Steal the Sovereign Bond portfolio", lvl: 106, nerve: 34, cash: [130000, 330000], respect: 820, base: 0.1, jail: 80 },
  { id: "depository", name: "Empty the Federal Depository", lvl: 110, nerve: 35, cash: [160000, 400000], respect: 950, base: 0.1, jail: 85 },
];

const MARKET = [
  { id: "brasspin", name: "Union Lapel Pin", rarity: "Common", price: 6, stat: "cunning", boost: 2, desc: "Opens doors on the docks. And mouths." },
  { id: "newscap", name: "Newsboy Cap", rarity: "Common", price: 6, stat: "speed", boost: 2, desc: "Nobody chases a paperboy." },
  { id: "knuckles", name: "Brass Knuckles", rarity: "Common", price: 8, stat: "muscle", boost: 3, desc: "Standard issue for standard problems." },
  { id: "dice", name: "Weighted Dice", rarity: "Common", price: 8, stat: "cunning", boost: 3, desc: "The odds were never even." },
  { id: "matchbook", name: "Every Club's Matchbook", rarity: "Common", price: 8, stat: "cunning", boost: 3, desc: "Proof you belong anywhere." },
  { id: "gloves", name: "Driving Gloves", rarity: "Common", price: 8, stat: "speed", boost: 3, desc: "No prints on the wheel." },
  { id: "laces", name: "Waxed Laces", rarity: "Common", price: 8, stat: "speed", boost: 3, desc: "Never trip on a getaway again." },
  { id: "pipe", name: "Lead Pipe Section", rarity: "Common", price: 8, stat: "muscle", boost: 3, desc: "Plumbing-grade persuasion." },
  { id: "blade", name: "Pearl Switchblade", rarity: "Common", price: 12, stat: "speed", boost: 4, desc: "Opens faster than a bad alibi." },
  { id: "hook", name: "Dockworker's Hook", rarity: "Common", price: 10, stat: "muscle", boost: 4, desc: "Moves cargo. Moves people." },
  { id: "cosh", name: "Leather Cosh", rarity: "Common", price: 11, stat: "muscle", boost: 4, desc: "Soft on the outside only." },
  { id: "deck", name: "Marked Deck", rarity: "Common", price: 11, stat: "cunning", boost: 4, desc: "Fifty-two friends in every hand." },
  { id: "plimsolls", name: "Canvas Plimsolls", rarity: "Common", price: 11, stat: "speed", boost: 4, desc: "Silent on a fire escape." },
  { id: "hshoe", name: "Horseshoe Ring", rarity: "Common", price: 13, stat: "muscle", boost: 5, desc: "Lucky for you. Not for them." },
  { id: "loupe", name: "Appraiser's Loupe", rarity: "Common", price: 13, stat: "cunning", boost: 5, desc: "Knows real from paste at ten feet." },
  { id: "sap", name: "Blackjack Sap", rarity: "Rare", price: 26, stat: "muscle", boost: 7, desc: "Goodnight, sweet prince." },
  { id: "bookpad", name: "Bookmaker's Pad", rarity: "Rare", price: 26, stat: "cunning", boost: 7, desc: "Every debt in the district, alphabetized." },
  { id: "crepesoles", name: "Crepe-Soled Oxfords", rarity: "Rare", price: 26, stat: "speed", boost: 7, desc: "Formalwear for second-story work." },
  { id: "vest", name: "Tailored Kevlar Vest", rarity: "Rare", price: 30, stat: "muscle", boost: 8, desc: "Fits under a three-piece suit." },
  { id: "lockpick", name: "Locksmith's Roll", rarity: "Rare", price: 26, stat: "cunning", boost: 8, desc: "Every door is a suggestion." },
  { id: "barchain", name: "Bar-Room Chain", rarity: "Rare", price: 30, stat: "muscle", boost: 8, desc: "Wraps around a fist or a doorknob." },
  { id: "cipher", name: "Cipher Wheel", rarity: "Rare", price: 30, stat: "cunning", boost: 8, desc: "The wire taps you now." },
  { id: "stopwatch", name: "Pacer's Stopwatch", rarity: "Rare", price: 30, stat: "speed", boost: 8, desc: "Knows exactly how long the guard's round takes." },
  { id: "suit", name: "Chalk-Striped Suit", rarity: "Rare", price: 32, stat: "cunning", boost: 9, desc: "Doors open for the right tailoring." },
  { id: "wingtips", name: "Wingtip Runners", rarity: "Rare", price: 34, stat: "speed", boost: 9, desc: "Dress shoes with a getaway sole." },
  { id: "wraps", name: "Champion's Wraps", rarity: "Rare", price: 34, stat: "muscle", boost: 9, desc: "Retired undefeated. The wraps didn't." },
  { id: "harness", name: "Docker's Harness", rarity: "Rare", price: 37, stat: "muscle", boost: 10, desc: "Lift a crate. Lift a safe. Lift a man." },
  { id: "blackbook", name: "The Black Book", rarity: "Rare", price: 37, stat: "cunning", boost: 10, desc: "Names, dates, amounts. Mostly names." },
  { id: "silks", name: "Jockey's Silks", rarity: "Rare", price: 37, stat: "speed", boost: 10, desc: "Won the Derby twice. Both times fixed." },
  { id: "maul", name: "Foundry Maul", rarity: "Epic", price: 55, stat: "muscle", boost: 13, desc: "Built to shape iron. Adapts." },
  { id: "wirekey", name: "The Wire Room Key", rarity: "Epic", price: 55, stat: "cunning", boost: 13, desc: "Every race result, four minutes early." },
  { id: "supercharger", name: "Supercharger Kit", rarity: "Epic", price: 55, stat: "speed", boost: 13, desc: "The sirens fade politely behind you." },
  { id: "wheels", name: "Blacked-Out Coupe", rarity: "Epic", price: 60, stat: "speed", boost: 15, desc: "Gone before the sirens start." },
  { id: "ironcorset", name: "Iron Corset", rarity: "Epic", price: 67, stat: "muscle", boost: 16, desc: "Victorian engineering, modern applications." },
  { id: "forgebench", name: "Forger's Bench", rarity: "Epic", price: 67, stat: "cunning", boost: 16, desc: "Signatures, deeds, passports, alibis." },
  { id: "railpass", name: "Every Conductor Owes You", rarity: "Epic", price: 67, stat: "speed", boost: 16, desc: "The 11:40 waits if you're late." },
  { id: "sawed", name: "Sawed-Off 'Persuader'", rarity: "Epic", price: 75, stat: "muscle", boost: 18, desc: "Negotiations end quickly." },
  { id: "shovel", name: "Gravedigger's Shovel", rarity: "Epic", price: 80, stat: "muscle", boost: 19, desc: "Every job ends the same way." },
  { id: "anvilfists", name: "Anvil Fists", rarity: "Epic", price: 92, stat: "muscle", boost: 22, desc: "The doctor said they'd never heal right. Right." },
  { id: "switchboard", name: "The Switchboard Girls", rarity: "Epic", price: 92, stat: "cunning", boost: 22, desc: "Every call in the city passes through friends of yours." },
  { id: "ironcrown", name: "The Iron Crown", rarity: "Legendary", price: 175, stat: "muscle", boost: 32, desc: "Worn by three kings of the underworld. Buried with none of them." },
  { id: "cityshadow", name: "The City's Shadow", rarity: "Legendary", price: 175, stat: "speed", boost: 32, desc: "Witnesses describe someone who wasn't there." },
  { id: "confessor", name: "The Confessor's Seal", rarity: "Legendary", price: 195, stat: "cunning", boost: 36, desc: "Everyone tells you everything. They can't help it." },
  { id: "ledger", name: "The Accountant's Ledger", rarity: "Legendary", price: 200, stat: "cunning", boost: 40, desc: "Knows where every body — and dollar — is buried." },
  { id: "signet", name: "Don's Signet Ring", rarity: "Legendary", price: 220, stat: "muscle", boost: 40, desc: "A kiss on this ring has ended wars." },
  { id: "midnight", name: "The Midnight Special", rarity: "Legendary", price: 220, stat: "speed", boost: 40, desc: "Leaves before the echo does." },
  { id: "colossus", name: "Colossus Frame", rarity: "Legendary", price: 245, stat: "muscle", boost: 45, desc: "They built one statue of a man like this. It was smaller." },
  { id: "zephyr", name: "The Zephyr Engine", rarity: "Legendary", price: 245, stat: "speed", boost: 45, desc: "The west wind, invoiced and delivered." },
  { id: "apocase", name: "Apothecary's Case", rarity: "Rare", price: 33, stat: "cunning", boost: 9, desc: "Forty labeled bottles. Thirty-nine true labels." },
  { id: "chemscales", name: "Chemist's Scales", rarity: "Epic", price: 59, stat: "cunning", boost: 14, desc: "Weighs to the grain. Judges to the ounce." },
  { id: "supledger", name: "The Supplier's Ledger", rarity: "Legendary", price: 205, stat: "cunning", boost: 38, desc: "Who buys, who sells, who talks. Especially who talks." },
];

// Racket income is stated PER MINUTE (applied fractionally each tick).
// Tuned for 7–15 hour payback so passive income supplements play, never replaces it.
const RACKETS = [
  { id: "laundro", name: "24hr Laundromat", lvl: 3, cost: 12500, income: 30, desc: "Cleans more than clothes." },
  { id: "pawn", name: "Pawn Shop", lvl: 6, cost: 40000, income: 80, desc: "No questions asked, ever." },
  { id: "parlor", name: "Numbers Parlor", lvl: 10, cost: 100000, income: 180, desc: "The neighborhood's favorite tax." },
  { id: "wire", name: "Backroom Betting Wire", lvl: 13, cost: 160000, income: 270, desc: "The results arrive early. The money never leaves." },
  { id: "chop", name: "Chop Shop", lvl: 16, cost: 250000, income: 360, desc: "Parts move faster than cars." },
  { id: "route", name: "Protection Route", lvl: 20, cost: 420000, income: 600, desc: "Thirty storefronts sleep safe. You've seen to it." },
  { id: "speak", name: "Speakeasy", lvl: 24, cost: 600000, income: 760, desc: "Members only. You decide who's a member." },
  { id: "loans", name: "Loan Office 'Fair Terms'", lvl: 28, cost: 900000, income: 1130, desc: "Everyone qualifies. Nobody finishes paying." },
  { id: "fightgym", name: "The Fight Gym", lvl: 32, cost: 1400000, income: 1750, desc: "Champions made upstairs. Results made downstairs." },
  { id: "floor", name: "The Casino Floor", lvl: 35, cost: 2000000, income: 2200, desc: "The house always wins. You are the house." },
  { id: "wharf", name: "Smuggler's Wharf", lvl: 40, cost: 3200000, income: 3450, desc: "Pier 13 doesn't appear on the harbor charts." },
  { id: "union77", name: "Union Local 77", lvl: 45, cost: 5000000, income: 5200, desc: "Every crane in the city asks your permission." },
  { id: "laundrybank", name: "The Laundry Bank", lvl: 50, cost: 7500000, income: 7600, desc: "Deposits dirty. Withdrawals spotless." },
  { id: "shipline", name: "The Shipping Line", lvl: 60, cost: 12000000, income: 11500, desc: "Manifests say olive oil. Manifests lie." },
  { id: "municipal", name: "Municipal Contracts Desk", lvl: 70, cost: 20000000, income: 18500, desc: "Every road the city paves, you pave twice on paper." },
  { id: "commission", name: "The Commission Seat", lvl: 80, cost: 40000000, income: 35000, desc: "You don't run a racket anymore. You run the rackets." },
  { id: "portauth", name: "The Port Authority", lvl: 90, cost: 60000000, income: 50000, desc: "Nothing floats in, rolls in, or flies in without your stamp." },
  { id: "invisible", name: "The Invisible Hand", lvl: 100, cost: 120000000, income: 92000, desc: "Economists have a name for you. They just don't know it's a person." },
];

const MISSIONS = [
  { id: "m1", name: "Prove Yourself", req: { lvl: 2, muscle: 10 }, reward: { cash: 1000, respect: 25 }, brief: "A local crew is skimming from the family's corner. Remind them whose corner it is." },
  { id: "m10", name: "The Message", req: { lvl: 3, speed: 12 }, reward: { cash: 2000, respect: 45 }, brief: "An envelope crosses four districts tonight. It cannot be opened, stopped, or late." },
  { id: "m2", name: "The Collection Run", req: { lvl: 4, cunning: 15 }, reward: { cash: 3500, respect: 60 }, brief: "Twelve envelopes, twelve addresses, one night. Nothing gets lost." },
  { id: "m11", name: "The Witness Problem", req: { lvl: 6, cunning: 18 }, reward: { cash: 6000, respect: 100 }, brief: "A shopkeeper saw something Tuesday. By Friday he remembers a quiet evening at home." },
  { id: "m3", name: "Silence the Rat", req: { lvl: 8, muscle: 20, speed: 20, fp: 10 }, reward: { cash: 10000, respect: 150 }, brief: "Someone's been talking to the wrong people. Persuade him a long vacation is healthier. Bring iron — persuasion needs punctuation." },
  { id: "m12", name: "The Warehouse Ledger", req: { lvl: 10, cunning: 24 }, reward: { cash: 15000, respect: 220 }, brief: "Somewhere in pier 4's office is a book with the family's name in it. By dawn there is no book and no office." },
  { id: "m13", name: "Debt of Honor", req: { lvl: 12, muscle: 28 }, reward: { cash: 22000, respect: 300 }, brief: "The old tailor on Canal Row is being squeezed by freelancers. He hemmed the Don's first suit. Make it right." },
  { id: "m4", name: "The Dockside Heist", req: { lvl: 14, cunning: 35, fp: 18 }, reward: { cash: 30000, respect: 400, omr: 5 }, brief: "A container of 'olive oil' lands at pier 9 at 3am. It's not olive oil. It's ours now. The night crew won't hand it over politely." },
  { id: "m14", name: "The Long Drive", req: { lvl: 16, speed: 40 }, reward: { cash: 45000, respect: 550 }, brief: "A passenger who doesn't exist needs to reach a town that isn't on maps, before a train that isn't scheduled." },
  { id: "m15", name: "Squeeze the Squeeze", req: { lvl: 20, muscle: 45, cunning: 40 }, reward: { cash: 70000, respect: 850 }, brief: "A precinct captain has been taxing our corners. Buy his debts, then call them in — all of them, the same afternoon." },
  { id: "m5", name: "Sit at the Table", req: { lvl: 25, muscle: 50, cunning: 50, speed: 50, fp: 30 }, reward: { cash: 100000, respect: 1200 }, brief: "The Don is watching. Run the whole southside operation for a week without a single arrest.", title: "MADE IN BLOOD" },
  { id: "m16", name: "The Insurance Job", req: { lvl: 28, cunning: 55, fp: 22 }, reward: { cash: 140000, respect: 1500, omr: 5 }, brief: "A furrier wants his own warehouse robbed Thursday. Rob it Wednesday, then sell him back his furs Friday." },
  { id: "m6", name: "The Long Con", req: { lvl: 32, cunning: 60 }, reward: { cash: 200000, respect: 2000, omr: 10 }, brief: "A nightclub burns. The insurance pays twice — once to the owner, once to whoever wrote the policy. You wrote the policy." },
  { id: "m17", name: "The Motor Pool", req: { lvl: 35, speed: 65 }, reward: { cash: 260000, respect: 2600 }, brief: "The family needs eleven clean cars by Sunday and the paperwork to match. The city has plenty of both, loosely attended." },
  { id: "m18", name: "Break the Blockade", req: { lvl: 38, muscle: 70, fp: 26 }, reward: { cash: 320000, respect: 3000 }, brief: "Someone's checkpoint is strangling Canal Row's trade. Open the road. Leave the checkpoint as a story people tell." },
  { id: "m7", name: "Ghost the Convoy", req: { lvl: 45, speed: 80, fp: 30 }, reward: { cash: 450000, respect: 4000 }, brief: "A federal evidence convoy crosses the Canal at 4am. Everything in truck two used to be ours. Take it back without a shot heard." },
  { id: "m19", name: "The Judge's Calendar", req: { lvl: 50, cunning: 85 }, reward: { cash: 600000, respect: 5000, omr: 15 }, brief: "Fourteen family cases sit on the autumn docket. By September the docket has other priorities." },
  { id: "m20", name: "The Counterfeit Summer", req: { lvl: 52, cunning: 88, speed: 75 }, reward: { cash: 700000, respect: 5500 }, brief: "Someone is printing our territory's money badly. Find the plates, keep the plates, retire the printer." },
  { id: "m8", name: "The Velvet Coup", req: { lvl: 60, muscle: 90, cunning: 90, fp: 45 }, reward: { cash: 1000000, respect: 8000, omr: 25 }, brief: "The police commissioner retires Friday. His replacement is decided Thursday. Make sure the right name is on the desk.", title: "KINGMAKER" },
  { id: "m21", name: "The Silent Partner", req: { lvl: 68, cunning: 100, fp: 48 }, reward: { cash: 1500000, respect: 11000 }, brief: "The Grand Casino needs a new investor. Its current owner needs a new continent. Arrange both by the gala." },
  { id: "m22", name: "One Perfect Season", req: { lvl: 75, muscle: 105, speed: 105 }, reward: { cash: 2000000, respect: 14000, omr: 30 }, brief: "Every fight, every race, every series — called in advance for four months, and not one bookmaker sees the pattern.", title: "THE UNTOUCHED" },
  { id: "m9", name: "Empire of Ash", req: { lvl: 85, muscle: 120, cunning: 120, speed: 120, fp: 60 }, reward: { cash: 3000000, respect: 20000 }, brief: "The old order meets at midnight, all five tables, one roof. By morning there is no old order. There is only you.", title: "THE QUIET KING" },
  { id: "m23", name: "The Foreign Delegation", req: { lvl: 92, cunning: 130, fp: 52 }, reward: { cash: 4000000, respect: 26000 }, brief: "Three families from across the water want the port. Host them, feast them, and send them home understanding it will never be theirs." },
  { id: "m24", name: "The Hundred-Year Deed", req: { lvl: 100, muscle: 140, cunning: 140, speed: 140 }, reward: { cash: 6000000, respect: 36000, omr: 50 }, brief: "Beneath City Hall is the deed to the land the city stands on. Legend says it's blank after the word 'Belongs to'. Fill it in.", title: "CAPO DI TUTTI" },
  { id: "m25", name: "The Last Word", req: { lvl: 110, muscle: 155, cunning: 155, speed: 155, fp: 60 }, reward: { cash: 10000000, respect: 60000 }, brief: "Write the rules the next fifty years of this city will pretend were always there.", title: "THE LAST WORD" },
  { id: "m26", name: "The Taste Test", req: { lvl: 15, trade: 100000, cunning: 30 }, reward: { cash: 60000, respect: 700 }, brief: "A buyer uptown wants proof your product is what the street says it is. One dinner, one demonstration, no second chances." },
  { id: "m27", name: "Pure", req: { lvl: 40, trade: 5000000, cunning: 75 }, reward: { cash: 800000, respect: 6000, omr: 20 }, brief: "Every batch in the city gets measured against yours now. Cook the one they'll still be talking about when you're gone.", title: "PURE" },
  { id: "m28", name: "The King of Appetites", req: { lvl: 70, trade: 100000000, cunning: 120 }, reward: { cash: 5000000, respect: 30000, omr: 60 }, brief: "Every den, every corner, every appetite in the city clears its ledger through you now. The Bureau has a wall with your face on it. The face is smiling.", title: "KING OF APPETITES" },
];

const RARITY_COLOR = { Common: "#8B8578", Rare: "#7A9BAB", Epic: "#9B6FA3", Legendary: "#C9A227" };

const dayOf = (t = Date.now()) => Math.floor(t / 86400000);

const DAILY_POOL = [
  { id: "crime5", name: "Pull off 5 clean jobs", k: "crime", n: 5 },
  { id: "crime10", name: "Pull off 10 clean jobs", k: "crime", n: 10 },
  { id: "crime20", name: "Pull off 20 clean jobs", k: "crime", n: 20 },
  { id: "dice3", name: "Win 3 rolls in the Back Room", k: "dice", n: 3 },
  { id: "dice6", name: "Win 6 rolls in the Back Room", k: "dice", n: 6 },
  { id: "train4", name: "Put in 4 gym sessions", k: "train", n: 4 },
  { id: "train8", name: "Put in 8 gym sessions", k: "train", n: 8 },
  { id: "jump1", name: "Jump a player on the Streets", k: "jump", n: 1 },
  { id: "jump3", name: "Win 3 street fights", k: "jump", n: 3 },
  { id: "jump5", name: "Win 5 street fights", k: "jump", n: 5 },
  { id: "tribute1", name: "Pay tribute to your family", k: "tribute", n: 1 },
  { id: "tribute2", name: "Pay tribute twice today", k: "tribute", n: 2 },
  { id: "craft1", name: "Craft something at the Workshop", k: "craft", n: 1 },
  { id: "craft3", name: "Craft 3 items at the Workshop", k: "craft", n: 3 },
  { id: "trade1", name: "Buy a lot on the Exchange", k: "trade", n: 1 },
  { id: "trade3", name: "Buy 3 lots on the Exchange", k: "trade", n: 3 },
  { id: "heist1", name: "Run the Daily Score", k: "heist", n: 1 },
  { id: "gta1", name: "Boost a car off the street", k: "gta", n: 1 },
  { id: "gta3", name: "Boost 3 cars off the street", k: "gta", n: 3 },
  { id: "gta5", name: "Boost 5 cars off the street", k: "gta", n: 5 },
  { id: "melt2", name: "Melt 2 cars at the Garage", k: "melt", n: 2 },
  { id: "melt5", name: "Melt 5 cars at the Garage", k: "melt", n: 5 },
  { id: "bust1", name: "Bust a player out of lockup", k: "bust", n: 1 },
  { id: "bust2", name: "Bust 2 players out of lockup", k: "bust", n: 2 },
  { id: "goods2", name: "Sell 2 lots of trade goods", k: "goods", n: 2 },
  { id: "goods5", name: "Sell 5 lots of trade goods", k: "goods", n: 5 },
  { id: "cook1", name: "Pull a batch off the burner", k: "cook", n: 1 },
  { id: "cook2", name: "Pull 2 batches off the burner", k: "cook", n: 2 },
  { id: "deal3", name: "Close 3 street deals", k: "deal", n: 3 },
  { id: "deal10", name: "Close 10 street deals", k: "deal", n: 10 },
  { id: "cook3", name: "Pull 3 batches off the burner", k: "cook", n: 3 },
];
const dailyJobs = (day) => [0, 1, 2].map((i) => DAILY_POOL[(day + i * 2) % DAILY_POOL.length]);

const ASSETS = [
  { id: "beater", name: "Beater Sedan", cat: "Wheels", price: 5000, stat: "speed", boost: 2, cargo: 15, desc: "Runs. Mostly." },
  { id: "wasp", name: "Motorcycle 'Wasp'", cat: "Wheels", price: 15000, stat: "speed", boost: 4, cargo: 5, desc: "Fits through anything, including excuses." },
  { id: "muscle71", name: "'71 Muscle Car", cat: "Wheels", price: 40000, stat: "speed", boost: 6, cargo: 30, desc: "You hear it before you see it." },
  { id: "hearse", name: "Converted Hearse", cat: "Wheels", price: 70000, stat: "speed", boost: 3, cargo: 55, desc: "Room in the back for anything that fits a coffin." },
  { id: "tourista", name: "Armored Van 'Tourista'", cat: "Wheels", price: 200000, stat: "speed", boost: 2, cargo: 100, desc: "Sightseeing brochures in the cab. Anything you want in the back." },
  { id: "super", name: "Italian Supercar", cat: "Wheels", price: 350000, stat: "speed", boost: 15, cargo: 60, desc: "Paid in cash. The dealer didn't blink." },
  { id: "tanker", name: "Fuel Tanker 'Bootlegger'", cat: "Wheels", price: 500000, stat: "speed", boost: 1, cargo: 160, desc: "Reads FUEL on the side. The side lies." },
  { id: "speedster", name: "Salt-Flat Speedster", cat: "Wheels", price: 900000, stat: "speed", boost: 22, cargo: 10, desc: "Holds two records and one passenger." },
  { id: "studio", name: "Studio Walk-Up", cat: "Property", price: 15000, energyCap: 5, desc: "A door that locks and a bed that doesn't fold." },
  { id: "flop", name: "Dockside Flophouse", cat: "Property", price: 40000, energyCap: 8, desc: "Twelve beds, one name on the register, none of them real." },
  { id: "brown", name: "Brownstone", cat: "Property", price: 90000, energyCap: 15, desc: "Respectable street. Disrespectable owner." },
  { id: "loft", name: "Warehouse Loft", cat: "Property", price: 140000, energyCap: 18, desc: "Exposed brick, exposed beams, concealed everything else." },
  { id: "safeh", name: "Safehouse Row", cat: "Property", price: 250000, energyCap: 25, desc: "Four doors, four names, none of them yours." },
  { id: "pent", name: "The Penthouse", cat: "Property", price: 600000, energyCap: 40, desc: "The whole city under your window." },
  { id: "hillcrest", name: "The Hillcrest Estate", cat: "Property", price: 2000000, energyCap: 70, desc: "Old money gates. New money behind them." },
  { id: "manor", name: "The Old Manor", cat: "Property", price: 5000000, energyCap: 100, desc: "The previous family lasted two hundred years. Beat that." },
  { id: "island", name: "Private Island 'Nowhere'", cat: "Property", price: 20000000, energyCap: 150, desc: "Charted on exactly one map, and you're holding it." },
  { id: "grocery", name: "Corner Grocery", cat: "Legit Fronts", price: 60000, income: 120, desc: "Fresh produce. Cleaner books." },
  { id: "diner", name: "All-Night Diner", cat: "Legit Fronts", price: 150000, income: 280, desc: "Coffee's always on. So is the back booth." },
  { id: "dealer", name: "Used Car Dealership", cat: "Legit Fronts", price: 300000, income: 520, desc: "Every car has a story. None of them are true." },
  { id: "barber", name: "Barbershop Row", cat: "Legit Fronts", price: 400000, income: 700, desc: "Four chairs of haircuts. One chair of appointments." },
  { id: "funeral", name: "Funeral Parlor", cat: "Legit Fronts", price: 800000, income: 1300, desc: "Business is steady. You make sure of it." },
  { id: "club", name: "Nightclub", cat: "Legit Fronts", price: 1250000, income: 1900, desc: "The velvet rope pays for itself." },
  { id: "taxi", name: "Checker Cab Fleet", cat: "Legit Fronts", price: 1800000, income: 2800, desc: "Two hundred drivers who see everything and testify to nothing." },
  { id: "radio", name: "WKRX Radio Station", cat: "Legit Fronts", price: 3000000, income: 4400, desc: "The news the city hears is the news you clear." },
  { id: "import", name: "Import/Export Co.", cat: "Legit Fronts", price: 5000000, income: 6600, desc: "Ships come in. Questions don't." },
  { id: "pictures", name: "Palace Picture House", cat: "Legit Fronts", price: 6000000, income: 7800, desc: "A thousand seats in the dark. Perfect for meetings." },
  { id: "tower", name: "Meridian Tower", cat: "Legit Fronts", price: 12000000, income: 14500, desc: "Forty floors of legitimate tenants above one very interesting basement." },
  { id: "bank", name: "First Meridian Savings", cat: "Legit Fronts", price: 25000000, income: 28000, desc: "Federally insured. Personally guaranteed." },
  { id: "airline", name: "Coastal Air Charter", cat: "Legit Fronts", price: 60000000, income: 62000, desc: "No manifests above ten thousand feet." },
];
const assetIncome = (assets = []) => assets.reduce((a, id) => { const it = ASSETS.find((x) => x.id === id); return a + (it?.income || 0); }, 0);
const assetEnergyCap = (assets = []) => assets.reduce((a, id) => { const it = ASSETS.find((x) => x.id === id); return a + (it?.energyCap || 0); }, 0);
const assetStat = (assets = [], st) => assets.reduce((a, id) => { const it = ASSETS.find((x) => x.id === id); return a + (it?.stat === st ? it.boost : 0); }, 0);
const assetsValue = (assets = []) => assets.reduce((a, id) => { const it = ASSETS.find((x) => x.id === id); return a + (it?.price || 0); }, 0);

// Craftables — consumed on use, which is what keeps the economy circular
const CONSUMABLES = [
  { id: "espresso", name: "Corner-Stand Espresso", cb: 1, cost: 200, fx: { en: 10 }, effect: "+10 energy", desc: "Tastes like tar. Works like lightning." },
  { id: "flaskitem", name: "Hip Flask", cb: 1, cost: 250, fx: { nv: 3 }, effect: "+3 nerve", desc: "Courage by the ounce." },
  { id: "cornerkit", name: "Boxer's Corner Kit", cb: 1, cost: 250, fx: { hp: 20 }, effect: "Heal 20 HP", desc: "Grease, gauze, and get back out there." },
  { id: "medkit", name: "Doc's Field Kit", cb: 2, cost: 500, fx: { hp: 50 }, effect: "Heal 50 HP", desc: "Stitches, gauze, and no paperwork." },
  { id: "courage", name: "Liquid Courage", cb: 2, cost: 600, fx: { nv: 6 }, effect: "+6 nerve", desc: "Bottled bravery, aged three days." },
  { id: "shot", name: "Adrenaline Shot", cb: 3, cost: 800, fx: { en: 25 }, effect: "+25 energy", desc: "Your heart will forgive you eventually." },
  { id: "blueplate", name: "Blue Plate at Rosa's", cb: 2, cost: 900, fx: { hp: 30, en: 15 }, effect: "Heal 30 HP, +15 energy", desc: "Rosa asks how you got hurt. Rosa doesn't listen to the answer." },
  { id: "ration", name: "War Ration", cb: 3, cost: 1000, fx: { nv: 10 }, effect: "+10 nerve", desc: "Tastes like tin and bad decisions." },
  { id: "getaway", name: "Getaway Kit", cb: 4, cost: 1500, fx: { jail0: true }, effect: "Walk out of lockup instantly", desc: "A hacksaw, a suit, and a friend at the gate." },
  { id: "fieldbag", name: "Field Surgeon's Bag", cb: 5, cost: 2000, fx: { hp: 100 }, effect: "Heal to full", desc: "Everything the hospital has, minus the questions." },
  { id: "benz", name: "Benzedrine Tin", cb: 5, cost: 2500, fx: { en: 50 }, effect: "+50 energy", desc: "Sleep is for people with alibis." },
  { id: "confession", name: "The Full Confession", cb: 6, cost: 4000, fx: { hp: 100, en: 30, nv: 8 }, effect: "Full heal, +30 energy, +8 nerve", desc: "One night at the church kitchen. You leave a new man with old habits." },
  { id: "burnershoes", name: "Burner Shoes", cb: 2, cost: 800, fx: { cool: 15 }, effect: "−15 heat", desc: "Walk away from who you were an hour ago." },
  { id: "priestalibi", name: "The Priest's Alibi", cb: 5, cost: 3000, fx: { cool: 40 }, effect: "−40 heat", desc: "Father Mancini remembers you at every mass this month. Every single one." },
];
const invCount = (inv = {}, id) => inv[id] || 0;

// The Armory — one equipped at a time. fp = firepower, cc = concealment, rel = reliability
const GUNS = [
  { id: "lastresort", name: "Rusty .25 'Last Resort'", cash: 800, crates: 1, fp: 3, cc: 10, rel: 0.75, desc: "Found in a drawer. Stays in a pocket." },
  { id: "pocket22", name: "Pocket .22", cash: 2000, crates: 1, fp: 5, cc: 9, rel: 0.85, desc: "Fits in a sock. Insults nobody's tailor." },
  { id: "penny", name: "Target .22 'Penny'", cash: 3500, crates: 1, fp: 7, cc: 9, rel: 0.93, desc: "Wins prizes at the fair. Wins arguments elsewhere." },
  { id: "alleycat", name: "Snub .38 'Alley Cat'", cash: 6000, crates: 2, fp: 10, cc: 8, rel: 0.9, desc: "Quick out of the coat, quicker back in." },
  { id: "badge", name: "Service .38 'Badge'", cash: 9000, crates: 2, fp: 13, cc: 7, rel: 0.94, desc: "Retired from the force. Not from the work." },
  { id: "argument", name: "Heavy .45 'The Argument'", cash: 18000, crates: 3, fp: 18, cc: 6, rel: 0.92, desc: "Ends most discussions before they start." },
  { id: "rancher", name: "Lever-Gun 'Rancher'", cash: 24000, crates: 3, fp: 20, cc: 4, rel: 0.96, desc: "Never jams. Never hurries. Never misses twice." },
  { id: "whisper", name: "Silenced .32 'Whisper'", cash: 30000, crates: 4, fp: 22, cc: 10, rel: 0.95, desc: "The room finds out one person at a time." },
  { id: "doorbell", name: "Street-Sweeper 12g 'Doorbell'", cash: 45000, crates: 5, fp: 30, cc: 3, rel: 0.88, desc: "Everyone hears you coming. That's the point." },
  { id: "brothers", name: "Twin .45s 'The Brothers'", cash: 60000, crates: 6, fp: 34, cc: 5, rel: 0.86, desc: "They finish each other's sentences." },
  { id: "broom", name: "Trench Gun 'Broom'", cash: 80000, crates: 6, fp: 38, cc: 2, rel: 0.9, desc: "Sweeps a hallway clean in one pass." },
  { id: "orchestra", name: "Drum-Fed 'Orchestra'", cash: 120000, crates: 8, fp: 45, cc: 2, rel: 0.9, desc: "Plays one song. Whole block listens." },
  { id: "anniversary", name: "Presentation Pair 'Anniversary'", cash: 300000, crates: 8, fp: 48, cc: 6, rel: 0.97, desc: "Engraved, oiled, and utterly sincere." },
  { id: "chorusline", name: "Belt-Fed 'Chorus Line'", cash: 200000, crates: 10, fp: 52, cc: 1, rel: 0.88, desc: "High kicks all the way down the street." },
  { id: "undertaker", name: "Long-Case 'Undertaker'", cash: 400000, crates: 12, fp: 60, cc: 1, rel: 0.93, desc: "Arrives in a violin case. Plays no music." },
];
const gunsValue = (guns = []) => guns.reduce((a, id) => { const g = GUNS.find((x) => x.id === id); return a + (g?.cash || 0); }, 0);

// ── The Garage — boostable cars. melt = base rounds when clean; damage cuts the yield.
// Rare iron melts hot but repairs badly, exactly like the classics.
const CARS = [
  { id: "junker", name: "County Auction Junker", w: 10, melt: 28, val: 900, desc: "Sold as-is. 'Is' was generous." },
  { id: "errand", name: "Errand Boy Coupe", w: 16, melt: 30, val: 1000, desc: "Ten thousand deliveries, zero questions." },
  { id: "garden", name: "Gardener's Pickup", w: 9, melt: 33, val: 1100, desc: "Smells like mulch and opportunity." },
  { id: "volara", name: "Volara Hatch", w: 22, melt: 35, val: 1200, desc: "Four wheels, three of them honest." },
  { id: "postal", name: "Decommissioned Postal Van", w: 9, melt: 38, val: 1400, desc: "Neither snow nor rain nor roadblocks." },
  { id: "milk", name: "Milk Route Truck", w: 12, melt: 40, val: 1500, desc: "On every street by 5am, suspected by no one." },
  { id: "cabbie", name: "Retired Cabbie Sedan", w: 3, melt: 42, val: 1700, desc: "Knows every shortcut and one very long one." },
  { id: "iceman", name: "Ice Delivery Truck", w: 3, melt: 44, val: 1900, desc: "Keeps the cargo cold and the driver colder." },
  { id: "pigeon", name: "Pigeon Runabout", w: 18, melt: 45, val: 2000, desc: "Nobody looks twice. That's the feature." },
  { id: "offduty", name: "Off-Duty Checker", w: 10, melt: 50, val: 2400, desc: "The meter's broken. So is the registration." },
  { id: "cannery", name: "Cannery Row Hauler", w: 3, melt: 52, val: 2600, desc: "Smells of fish and pays like it doesn't." },
  { id: "conductor", name: "Conductor's Coupe", w: 2.5, melt: 53, val: 2800, desc: "Punches tickets and the occasional passenger." },
  { id: "dray", name: "Dray Panel Van", w: 10, melt: 55, val: 3000, desc: "Delivers bread by day. Delivers by night." },
  { id: "foreman", name: "Foreman's Runabout", w: 2.5, melt: 57, val: 3200, desc: "Runs the site by day, the shipment by night." },
  { id: "rubicon", name: "Rubicon Flatbed", w: 8, melt: 60, val: 3400, desc: "Hauls anything that fits and several things that don't." },
  { id: "ladder", name: "Hook & Ladder Rig", w: 2, melt: 62, val: 3600, desc: "Clears traffic and questions alike." },
  { id: "prefect", name: "Prefect Saloon", w: 8, melt: 65, val: 3800, desc: "A schoolteacher's car. The schoolteacher disagrees." },
  { id: "deuce", name: "Deuce Roadster", w: 2.5, melt: 67, val: 4000, desc: "Cheap, quick, and gone before the whistle." },
  { id: "notary", name: "Notary's Saloon", w: 2, melt: 68, val: 4200, desc: "Every document it carries is a forgery." },
  { id: "stag", name: "Stag Sedan", w: 9, melt: 70, val: 4500, desc: "A working man's car for working men's work." },
  { id: "trolley", name: "Trolley Jumper", w: 2, melt: 72, val: 4800, desc: "Off the rails on purpose." },
  { id: "sedanette", name: "Sedanette Eight", w: 6, melt: 75, val: 5200, desc: "Eight cylinders, six payments behind." },
  { id: "clubman", name: "Clubman Coupe", w: 2, melt: 77, val: 5500, desc: "Members only. The lock disagreed." },
  { id: "coupe38", name: "'38 Business Coupe", w: 7, melt: 80, val: 5800, desc: "The business is nobody's business." },
  { id: "boulevard", name: "Boulevard Eight", w: 6, melt: 90, val: 6500, desc: "Eight cylinders of plausible respectability." },
  { id: "mercantile", name: "Mercantile Wagon", w: 1.8, melt: 95, val: 7000, desc: "Dry goods by receipt, wet work by moonlight." },
  { id: "wagoneer", name: "Estate Wagon", w: 5, melt: 100, val: 7800, desc: "Room for the family. Either meaning." },
  { id: "consul", name: "Consul Limousine", w: 1.5, melt: 105, val: 8400, desc: "Diplomatic plates, undiplomatic cargo." },
  { id: "harbor", name: "Harbor King Coupe", w: 5, melt: 110, val: 9000, desc: "Smells like cigars and hush money." },
  { id: "dockmaster", name: "Dockmaster Cruiser", w: 1.2, melt: 112, val: 9800, desc: "Owns the pier and rents the silence." },
  { id: "brougham", name: "Brougham Town Car", w: 4, melt: 115, val: 10500, desc: "The chauffeur ran. Smart chauffeur." },
  { id: "courier", name: "Courier Special", w: 4, melt: 120, val: 11000, desc: "Factory-tuned for schedules that don't exist." },
  { id: "regent", name: "Regent Landaulet", w: 3, melt: 130, val: 12000, desc: "Half a roof for twice the price." },
  { id: "touring", name: "Grand Touring Six", w: 3, melt: 135, val: 12500, desc: "Built for the coast road and the fast exit." },
  { id: "sable", name: "Sable Landau", w: 3, melt: 140, val: 13000, desc: "Funeral black. Ready either way." },
  { id: "cabaret", name: "Cabaret Cabriolet", w: 1, melt: 148, val: 14000, desc: "Arrives at midnight, leaves before the raid." },
  { id: "diplomat", name: "Diplomat Town Sedan", w: 0.9, melt: 152, val: 14800, desc: "Immune to everything but envy." },
  { id: "cascade", name: "Cascade Cabriolet", w: 2.5, melt: 155, val: 15500, desc: "Top down, heat up, gone." },
  { id: "sportsman", name: "Sportsman Convertible", w: 2, melt: 165, val: 17000, desc: "Won at cards. Twice. By different people." },
  { id: "vesper", name: "Vesper GT", w: 2.5, melt: 170, val: 18000, rare: true, desc: "Fast enough to outrun most consequences." },
  { id: "corsair", name: "Corsair Speedster", w: 0.9, melt: 180, val: 20000, rare: true, desc: "Named for pirates. It earns the name." },
  { id: "monarch", name: "Monarch V12", w: 2, melt: 190, val: 22000, rare: true, desc: "Twelve cylinders of divine right." },
  { id: "regatta", name: "Regatta Convertible", w: 0.8, melt: 200, val: 24000, rare: true, desc: "Won at the marina, lost at the docks." },
  { id: "tempest", name: "Tempest Roadster", w: 2, melt: 210, val: 26000, rare: true, desc: "Two seats: you, and whatever you took." },
  { id: "phaeton", name: "Skyline Phaeton", w: 1.5, melt: 220, val: 28000, rare: true, desc: "Open to the sky and closed to inquiry." },
  { id: "ambassador", name: "Ambassador Armored Sedan", w: 0.7, melt: 230, val: 30000, rare: true, desc: "Bulletproof glass, glass-jaw owner." },
  { id: "bullion", name: "Bullion Armored Truck", w: 1.5, melt: 240, val: 32000, rare: true, desc: "Someone left the depot in it. Someone was you." },
  { id: "blackout", name: "Blackout Phantom", w: 1.6, melt: 260, val: 40000, rare: true, desc: "The last thing several people never saw." },
  { id: "nocturne", name: "Nocturne Coupe", w: 0.6, melt: 280, val: 45000, rare: true, desc: "Only ever seen leaving." },
  { id: "duchess", name: "Duchess Drophead", w: 1.2, melt: 300, val: 52000, rare: true, desc: "Titled, entitled, and extremely stolen." },
  { id: "spectre", name: "Spectre Berlinetta", w: 1.0, melt: 350, val: 65000, rare: true, desc: "Registered to a man who died in 1931." },
  { id: "leviathan", name: "Leviathan Town Car", w: 0.4, melt: 375, val: 75000, rare: true, desc: "Displaces its own weight in trouble." },
  { id: "comet", name: "Corsa Comet", w: 1.0, melt: 400, val: 90000, rare: true, desc: "Melts into a small war." },
  { id: "warhawk", name: "Warhawk Prototype", w: 0.7, melt: 450, val: 110000, rare: true, desc: "The factory built one. The factory misplaced one." },
  { id: "vulcan", name: "Vulcan Fire Chief", w: 0.35, melt: 500, val: 130000, rare: true, desc: "Every road clears for it. Every single one." },
  { id: "sovereign", name: "Silver Sovereign", w: 0.5, melt: 550, val: 160000, rare: true, desc: "A head of state died in one. It buffed right out." },
  { id: "olympia", name: "Olympia Parade Car", w: 0.3, melt: 600, val: 190000, rare: true, desc: "Waved at by a million people who'd testify they never saw it." },
  { id: "meridian", name: "Meridian Mk.II", w: 0.4, melt: 700, val: 250000, rare: true, desc: "There are nine in the world. The city believes this is the tenth." },
  { id: "aurora", name: "Aurora Land-Speed Car", w: 0.25, melt: 800, val: 320000, rare: true, desc: "Holds the record for the mile and for the getaway." },
  { id: "tsarina", name: "The Tsarina's Ghost", w: 0.15, melt: 900, val: 400000, rare: true, desc: "Smuggled out of a revolution in a hay wagon. Still smells faintly of empire." },
];
const carOf = (id) => CARS.find((c) => c.id === id);
// Trims — cosmetic-plus variants rolled per boosted car. Weighted so the
// expected melt multiplier stays ~1.0; verified in the balance sim.
const TRIMS = [
  { id: "rusted", name: "Rusted", w: 16, melt: 0.8, val: 0.7 },
  { id: "stock", name: "", w: 45, melt: 1.0, val: 1.0 },
  { id: "tuned", name: "Street-Tuned", w: 20, melt: 1.1, val: 1.15 },
  { id: "chopped", name: "Chopped", w: 10, melt: 1.25, val: 0.9 },
  { id: "armored", name: "Armored", w: 6, melt: 1.4, val: 1.5 },
  { id: "bespoke", name: "Coachbuilt", w: 3, melt: 1.6, val: 2.2 },
];
const trimOf = (id) => TRIMS.find((t) => t.id === id) || TRIMS[1]; // legacy cars read as stock
const rollTrim = () => {
  const total = TRIMS.reduce((a, t) => a + t.w, 0);
  let r = Math.random() * total;
  for (const t of TRIMS) { r -= t.w; if (r <= 0) return t; }
  return TRIMS[1];
};
const carName = (c) => { const t = trimOf(c.trim); const m = carOf(c.id); return (t.name ? t.name + " " : "") + (m?.name || "?"); };
const carMelt = (c) => { const m = carOf(c.id); return Math.max(5, Math.round((m?.melt || 0) * trimOf(c.trim).melt * (1 - (c.dmg || 0) / 150))); };
const carVal = (c) => Math.floor((carOf(c.id)?.val || 0) * trimOf(c.trim).val);

// ── THE KITCHEN — fictional period product lines. Nothing here maps to a
// real substance or process; it's an economy of risk, not a recipe.
const DRUGS = [
  { id: "vim", name: "VIM", tag: "the salesman's tonic", base: 90, mk: 30, heat: 0.6, unlock: 0 },
  { id: "moonmilk", name: "MOONMILK", tag: "sleep in a bottle", base: 160, mk: 55, heat: 0.9, unlock: 1 },
  { id: "lotus", name: "LOTUS", tag: "the dreaming resin", base: 300, mk: 110, heat: 1.4, unlock: 2 },
  { id: "glass", name: "GLASS", tag: "bottled lightning", base: 600, mk: 230, heat: 2.2, unlock: 3 },
  { id: "ambrosia", name: "AMBROSIA", tag: "what the orchestra plays for", base: 1400, mk: 560, heat: 3.5, unlock: 4 },
  { id: "static", name: "STATIC", tag: "the radio between stations", base: 2600, mk: 1100, heat: 4.5, unlock: 5 },
  { id: "halo", name: "HALO", tag: "borrowed grace", base: 4800, mk: 2100, heat: 6, unlock: 6 },
  { id: "nocturne", name: "NOCTURNE", tag: "the last song of the evening", base: 9000, mk: 4200, heat: 8, unlock: 7 },
];
const drugOf = (id) => DRUGS.find((d) => d.id === id);
// Demand per district rotates on the same 4h blocks as trade goods: 0.7–1.5×
const demandOf = (drugId, districtId) => 0.7 + hash01(drugId + "@" + districtId + ":" + priceBlock() + ":" + MARKET_SEED) * 0.8;
// The Supplier's makings prices drift ±25% on the same clock
const makingsPriceOf = (drugId) => Math.max(5, Math.round((drugOf(drugId)?.mk || 0) * (0.75 + hash01("mk:" + drugId + ":" + priceBlock() + ":" + MARKET_SEED) * 0.5)));

const KITCHENS = [
  { id: "bathtub", name: "Bathtub Rig", cost: 20000, omr: 0, cap: 20, mins: 10, q: 0, fire: 0.08, desc: "One tub, one burner, one prayer." },
  { id: "cellar", name: "Cellar Still", cost: 80000, omr: 0, cap: 35, mins: 15, q: 0.05, fire: 0.065, desc: "Under the florist's. The flowers hide a lot." },
  { id: "basement", name: "Basement Lab", cost: 250000, omr: 0, cap: 60, mins: 20, q: 0.1, fire: 0.05, desc: "Proper glassware. Improper everything else." },
  { id: "facility", name: "The Facility", cost: 2000000, omr: 50, cap: 150, mins: 30, q: 0.2, fire: 0.03, desc: "White coats, clipboards, and no address." },
  { id: "cathedral", name: "The Cathedral", cost: 10000000, omr: 200, cap: 400, mins: 45, q: 0.3, fire: 0.02, desc: "Built under an actual church. God forgives; chemistry doesn't." },
];
const kitchenOf = (id) => KITCHENS.find((k) => k.id === id);
// Demo-scaled cook timers; production: ×12 (2h/4h/6h), server-enforced.

const TRADE_RANKS = [
  { at: 0, name: "Corner Boy", bonus: 0 },
  { at: 25000, name: "Runner", bonus: 0.02 },
  { at: 100000, name: "The Connect", bonus: 0.04 },
  { at: 400000, name: "Distributor", bonus: 0.06 },
  { at: 1500000, name: "Wholesaler", bonus: 0.08 },
  { at: 6000000, name: "Street Chemist", bonus: 0.1 },
  { at: 25000000, name: "Baron", bonus: 0.13 },
  { at: 100000000, name: "The Apothecary King", bonus: 0.16 },
];
const tradeRankIdx = (rep) => { let i = 0; TRADE_RANKS.forEach((r, j) => { if ((rep || 0) >= r.at) i = j; }); return i; };

// ── PATHS — a career choice at level 5. One active at a time.
const PATHS = [
  { id: "gun", name: "The Gun", desc: "+10% power in street fights · +15% effectiveness on hit contracts. You are the argument.", },
  { id: "ledger", name: "The Ledger", desc: "+10% racket & front income · +5% on trade-good sales. Money never sleeps; neither do you.", },
  { id: "kitchen", name: "The Kitchen", desc: "+15% cook quality · −25% heat from dealing. The city has an appetite. Feed it.", },
];
const PATH_FIRST_COST = 10000;
const PATH_SWITCH_OMR = 25;
const stashTotal = (stash = {}) => Object.values(stash).reduce((a, s) => a + (s?.n || 0), 0);

// ── GRASSROOTS — The First Week checklist + Recruiter ladder ──
// In-game firsts are auto-detected from player state; social tasks open a
// link and are honor-claimed in the demo (production: OAuth-verified).
// Rewards deliberately exclude $OMR: social actions never earn token.
const ONBOARD_TASKS = [
  { id: "ob_crime", name: "Pull your first job", desc: "Any crime, any district.", reward: { cash: 500, en: 10 }, check: (pl) => ((pl.lc || {}).crime || 0) >= 1 },
  { id: "ob_boost", name: "Boost your first car", desc: "The Garage is where bullets come from.", reward: { cash: 750, cb: 1 }, check: (pl) => (pl.gtaAt || 0) > 0 },
  { id: "ob_bank", name: "Open a bank account", desc: "Banked cash can't be jumped.", reward: { cash: 1000 }, check: (pl) => (pl.bank || 0) > 0 },
  { id: "ob_path", name: "Declare your Path", desc: "The Gun, The Ledger, or The Kitchen — at level 5.", reward: { cash: 2000, cb: 2 }, check: (pl) => !!pl.path },
  { id: "ob_family", name: "Join a family", desc: "Nobody survives this city alone.", reward: { cash: 2500, cb: 2 }, check: (pl) => !!pl.gangId },
  { id: "ob_wallet", name: "Connect a wallet", desc: "The wallet is what survives you.", reward: { cash: 2000 }, check: (pl) => !!pl.wallet },
  { id: "ob_x", name: "Follow OMERTÀ on X", desc: "Launches, events, and season news.", reward: { cash: 1500 }, social: "https://x.com/", check: () => true },
  { id: "ob_discord", name: "Join the community", desc: "The other families are in there too.", reward: { cash: 1500 }, social: "https://discord.com/", check: () => true },
];
const ONBOARD_CAPSTONE = { cash: 5000, cb: 3, en: 25 }; // all nine claimed

const RECRUIT_MILESTONES = [
  { n: 1, name: "First Blood Brought In", cash: 5000 },
  { n: 3, name: "A Reputation for People", cash: 15000 },
  { n: 5, name: "The Talent Scout", cash: 25000, omr: 5 }, // event-fund $OMR
  { n: 10, name: "THE RAINMAKER", cash: 75000, omr: 10, title: "THE RAINMAKER" },
  { n: 25, name: "PILLAR OF THE CITY", cash: 250000, omr: 25, title: "PILLAR OF THE CITY" },
];
const rollCar = () => {
  const total = CARS.reduce((a, c) => a + c.w, 0);
  let r = Math.random() * total;
  for (const c of CARS) { r -= c.w; if (r <= 0) return c; }
  return CARS[0];
};
const carsValue = (cars = []) => cars.reduce((a, c) => a + Math.floor(carVal(c) * (1 - (c.dmg || 0) / 100)), 0);
const GARAGE_CAP = 12;
const GTA_CD_MS = 300 * 1000; // same 300 s the classics used
const MELT_TITHE = 0.25; // crew bullet bank share
const TITHE_ROUND_VALUE = 30; // treasury credit per tithed round

// ── Vests — $OMR utility sink. Multiplies the rounds needed to finish you. Lost on death.
const VESTS = [
  { id: "woolv", name: "Padded Overcoat", mult: 1.1, omr: 4, desc: "Better than a suit. Barely." },
  { id: "lightv", name: "Light Vest", mult: 1.25, omr: 10, desc: "Turns a sure thing into a maybe." },
  { id: "medv", name: "Reinforced Vest", mult: 1.5, omr: 25, desc: "The tailor asks no questions." },
  { id: "tailorv", name: "Tailored Plate", mult: 1.75, omr: 40, desc: "Fitted twice: once for the suit, once for survival." },
  { id: "heavyv", name: "Heavy Plate Rig", mult: 2.0, omr: 60, desc: "You'll hear the shots. That's the point — you'll HEAR them." },
  { id: "vaultv", name: "The Walking Vault", mult: 2.5, omr: 120, desc: "Bank-door steel, cut for shoulders. Walk slow. Outlive everyone." },
];
const vestMultOf = (vestId) => VESTS.find((v) => v.id === vestId)?.mult || 1;

// ── Hit contracts — rounds needed to put a player down for good.
// Demo timers; production: search 3 h, re-fire cooldown 2 h (server-enforced).
const SEARCH_MS = 10 * 60 * 1000;
const SHOOT_CD_MS = 5 * 60 * 1000;
const MIN_FIRE = 50;
const btkOf = (lvl = 1, muscle = 5, vestMult = 1) => Math.round((250 + lvl * 80 + muscle * 12) * vestMult);

// City events — daily rotating economic weather, deterministic from the date
const CITY_EVENTS = [
  { id: "heat", name: "HEAT WAVE", jobPay: 1.5, jailMult: 2, desc: "Tempers are up all over town — jobs pay 1.5×, but lockup stints run twice as long." },
  { id: "strike", name: "DOCK STRIKE", cbMult: 2, desc: "Cargo is sitting unguarded on the piers — contraband drop chance is doubled today." },
  { id: "union", name: "UNION TROUBLE", racketMult: 0.5, crimeRep: 2, desc: "Pickets outside every front — racket and front income is halved, but street work earns double respect." },
  { id: "fight", name: "FIGHT NIGHT", stealAdd: 0.10, jumpRep: 1.5, desc: "The whole city wants blood — jumps steal an extra 10% of pocket cash and pay 1.5× respect." },
  { id: "blackout", name: "BLACKOUT", boostAdd: 0.15, desc: "The grid is down and nobody reads a plate — boosts succeed 15% more often tonight." },
  { id: "visit", name: "THE COMMISSIONER'S VISIT", jailMult: 0.5, desc: "Brass in town shaking hands — the county empties its cells to look civilized. Jail stints halved." },
  { id: "raceday", name: "RACE DAY", fenceMult: 1.25, desc: "The whole city is at the track and buyers are flush — fences pay 25% more for iron." },
  { id: "flush", name: "PAYDAY AT THE MILLS", tradeMult: 1.2, desc: "Every mill in the city paid out today — trade goods sell 20% higher." },
  { id: "amnesty", name: "THE WARDEN'S CARD GAME", bustAdd: 0.15, desc: "The warden is hosting his annual game and the guards are all watching it — busts succeed 15% more often." },
  { id: "fog", name: "RIVER FOG", boostAdd: 0.10, cbMult: 1.5, desc: "Can't see the docks from the docks — boosts and contraband both come easier tonight." },
  { id: "gala", name: "THE MAYOR'S GALA", jobPay: 1.25, crimeRep: 1.5, desc: "Half the city's money is in one ballroom and its guards are with it — jobs pay 1.25× and earn 1.5× respect." },
  { id: "crackdown", name: "THE CRACKDOWN", jobPay: 1.75, jailMult: 1.5, cbMult: 0.5, desc: "Task force in the streets. Jobs pay 1.75× because nobody else dares — but stints run 1.5× and crates are scarce." },
  { id: "sweep", name: "BUREAU SWEEP", drugHeat: 2, desc: "Unmarked sedans on every block — dealing generates double heat today. Cook, don't sell." },
  { id: "thirst", name: "THE THIRST", drugDemand: 1.3, drugHeat: 1.25, desc: "The city's appetite is up and so is the risk — product sells 30% higher, but deals run 25% hotter." },
  { id: "drought", name: "SUPPLY DROUGHT", mkMult: 1.4, drugDemand: 1.15, desc: "The Supplier's shelves are thin — makings cost 40% more, but scarce product sells 15% higher." },
  { id: "opencity", name: "OPEN CITY", heatDecay: 2, desc: "The Bureau's budget hearing is today and every agent is in a suit downtown — heat decays twice as fast." },
];
const cityEventOf = (day) => CITY_EVENTS[day % CITY_EVENTS.length];

// Turf — six districts, each with a family-wide perk for the holder
const DISTRICTS = [
  { id: "docks", name: "The Docks", perk: "+50% contraband drop chance" },
  { id: "neon", name: "The Neon Mile", perk: "+15% racket & front income" },
  { id: "foundry", name: "Old Foundry", perk: "Workshop crafts cost 25% less cash" },
  { id: "brick", name: "Brick Yards", perk: "+2% crime success for all members" },
  { id: "canal", name: "Canal Row", perk: "+10% crime payouts" },
  { id: "cathedral", name: "Cathedral Hill", perk: "Double nerve regeneration" },
];

// Seasons — 28-day competitive cycles; level converts to permanent prestige
const SEASON_EPOCH = 20628; // day-number anchor
const SEASON_LEN = 28;
const seasonOf = (day) => Math.max(1, Math.floor((day - SEASON_EPOCH) / SEASON_LEN) + 1);
const seasonDaysLeft = (day) => SEASON_LEN - (((day - SEASON_EPOCH) % SEASON_LEN) + SEASON_LEN) % SEASON_LEN;

// Trade goods — prices differ per district and reshuffle every 4 hours
const GOODS = [
  { id: "gin", name: "Bathtub Gin", base: 120 },
  { id: "coffee", name: "Green Coffee Sacks", base: 180 },
  { id: "cigars", name: "Smuggled Cigars", base: 260 },
  { id: "nylons", name: "Black-Market Nylons", base: 380 },
  { id: "shine", name: "Mountain Shine", base: 520 },
  { id: "penicillin", name: "Clinic Penicillin", base: 700 },
  { id: "silk", name: "Counterfeit Silk", base: 900 },
  { id: "watches", name: "Swiss Movement Watches", base: 1200 },
  { id: "ice", name: "Hot Ice", base: 1600 },
  { id: "bearer", name: "Bearer Bonds", base: 2400 },
];
const TRAVEL_COST = 250;
const hash01 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
};
const priceBlock = () => Math.floor(Date.now() / (4 * 3600 * 1000));
// In production the per-cycle seed is an unpredictable server value published
// only once the cycle is live, so prices can't be precomputed from the client.
// Here it's derived (still deterministic — a documented demo limitation) but
// isolated so the production swap is a one-line change.
let MARKET_SEED = "seed0";
const priceOf = (goodId, districtId) => {
  const g = GOODS.find((x) => x.id === goodId);
  if (!g) return 0;
  return Math.max(10, Math.round(g.base * (0.6 + hash01(goodId + ":" + districtId + ":" + priceBlock() + ":" + MARKET_SEED))));
};
const cargoCapacity = (assets = []) => 10 + assets.reduce((a, id) => { const it = ASSETS.find((x) => x.id === id); return a + (it?.cargo || 0); }, 0);
const cargoCount = (cargo = {}) => Object.values(cargo).reduce((a, n) => a + (n || 0), 0);

// Career ladder — ten ranks spanning 125 levels, each held for 10–15 levels
const RANKS = [
  { lvl: 1, name: "STREET THUG", perk: "Everyone starts at the bottom" },
  { lvl: 10, name: "HUSTLER", perk: "+5% crime payouts" },
  { lvl: 22, name: "RUNNER", perk: "+1 energy regen per tick" },
  { lvl: 35, name: "ENFORCER", perk: "+5 to attack rolls" },
  { lvl: 50, name: "ASSOCIATE", perk: "The Doc charges 10% less" },
  { lvl: 65, name: "SOLDIER", perk: "Made man — jail stints 20% shorter" },
  { lvl: 80, name: "CAPO", perk: "+1 nerve regen per tick" },
  { lvl: 95, name: "UNDERBOSS", perk: "+10% racket & front income" },
  { lvl: 110, name: "MOB BOSS", perk: "+10% crime payouts (stacks)" },
  { lvl: 125, name: "DON OF THE CITY", perk: "+2% crime success — the city moves for you" },
];
const rankIdxOf = (lvl) => { let i = 0; for (let x = 0; x < RANKS.length; x++) if (lvl >= RANKS[x].lvl) i = x; return i; };
const rankOf = (lvl) => RANKS[rankIdxOf(lvl)];

// Weekly family contracts — collective goals, rotating by week
const FAMILY_TASKS = [
  { id: "tribute", key: "tribute", name: "Tribute Drive — pay $75,000 in family tribute", goal: 75000 },
  { id: "blood", key: "jump", name: "Blood Week — win 40 street fights", goal: 40 },
  { id: "spree", key: "crime", name: "Crime Spree — pull 150 clean jobs", goal: 150 },
  { id: "forge", key: "melt", name: "Forge Week — melt 2,000 rounds for the armory", goal: 2000 },
  { id: "boostwk", key: "gta", name: "Boost Week — take 60 cars off the street", goal: 60 },
  { id: "warchest", key: "tribute", name: "War Chest Week — pay $200,000 in tribute", goal: 200000 },
  { id: "ironweek", key: "jump", name: "Iron Week — win 100 street fights", goal: 100 },
  { id: "longgrind", key: "crime", name: "The Long Grind — pull 400 clean jobs", goal: 400 },
  { id: "arsenal", key: "melt", name: "Arsenal Week — melt 5,000 rounds for the armory", goal: 5000 },
  { id: "motorpool", key: "gta", name: "Motor Pool Week — take 150 cars off the street", goal: 150 },
  { id: "product", key: "deal", name: "Product Week — move 1,500 units on the street", goal: 1500 },
  { id: "recruitdrive", key: "recruit", name: "Recruitment Drive — bring 5 recruits to qualification", goal: 5 },
];
const weekOf = (day = dayOf()) => Math.floor(day / 7);
const familyTaskOf = (wk = weekOf()) => FAMILY_TASKS[wk % FAMILY_TASKS.length];

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const fmt = (n) => Math.floor(n).toLocaleString("en-US");
const fmtT = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const fakeAddr = () => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let s = "";
  for (let i = 0; i < 44; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
};
const short = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "");

const NEW_PLAYER = () => ({
  id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  name: "",
  title: "",
  cash: 500,
  bank: 0,
  omr: 0,
  staked: 0,
  rewards: 0,
  energy: 50,
  nerve: 10,
  health: 100,
  respect: 0,
  stats: { muscle: 5, cunning: 5, speed: 5 },
  owned: [],
  rackets: [],
  assets: [],
  missions: [],
  jail: 0,
  hosp: 0,
  streak: 0,
  checkinDay: 0,
  heistAt: 0,
  daily: null,
  cb: 0,
  inv: {},
  guns: [],
  gun: null,
  devFees: 0,
  season: seasonOf(dayOf()),
  prestige: 0,
  lc: { crime: 0 },
  checkins: 0,
  referredBy: null,
  refPaid: false,
  auth: null,
  agentUsed: false,
  loc: "docks",
  cargo: {},
  ammo: 25,
  path: null,
  onboard: {}, // { taskId: true } — one-time First Week claims
  recruits: 0, // lifetime QUALIFIED recruits (survives death)
  heat: 0,
  lab: null, // kitchen tier id
  batch: null, // { drug, qty, doneAt }
  makings: {}, // { drugId: units }
  stash: {}, // { drugId: { n, q } } — q is the weighted avg quality
  crew: 0,
  tradeRep: 0,
  cars: [],
  gtaAt: 0,
  search: null, // { tid, tn, at } — one active contract at a time
  shootCdAt: 0,
  busts: 0,
  vest: null,
  deaths: 0,
  gangId: null,
  gangTag: null,
  gangName: null,
  wallet: null,
  lastSeen: Date.now(),
});

export default function Omerta() {
  const [p, setP] = useState(null); // player state (null = loading)
  const [screen, setScreen] = useState("loading"); // loading | create | game
  const [nameInput, setNameInput] = useState("");
  const [authMethod, setAuthMethod] = useState(null); // 'x' | 'privy' | 'guest'
  const [agentOn, setAgentOn] = useState(false);
  const [agentTurns, setAgentTurns] = useState(0);
  const [agentThought, setAgentThought] = useState("");
  const agentOnRef = useRef(false);
  const apiRef = useRef({});
  const [tab, setTab] = useState("daily");
  const [log, setLog] = useState([]);
  const [wager, setWager] = useState(100);
  const [swapAmt, setSwapAmt] = useState(1000);
  const [stakeAmt, setStakeAmt] = useState(5);
  const [bankAmt, setBankAmt] = useState(500);
  const [lb, setLb] = useState(null); // leaderboard rows
  const [gangs, setGangs] = useState(null); // gang directory
  const [myGang, setMyGang] = useState(null); // my gang doc
  const [wars, setWars] = useState([]); // active/recent wars
  const [listings, setListings] = useState(null); // Exchange order book
  const [devWallet, setDevWallet] = useState(0); // global 1% cut tally
  const [streetTax, setStreetTax] = useState({ pool: 0, lastRun: 0, distributed: 0, fund: 0 }); // 12h buyback cycle state
  const [bounties, setBounties] = useState({}); // targetId -> bounty doc
  const [bountyAmt, setBountyAmt] = useState(1000);
  const [tradeQty, setTradeQty] = useState(5);
  const [terrs, setTerrs] = useState([]); // district docs
  const [recruits, setRecruits] = useState(null); // my recruits
  const [refInput, setRefInput] = useState("");
  const terrHeldRef = useRef([]); // district ids my family holds (for the tick)
  const crimeTaskRef = useRef(0); // batched clean-job count for the weekly family contract
  const busyRef = useRef(false); // serializes storage-mutating actions against double-fire races
  useEffect(() => { MARKET_SEED = "s" + priceBlock(); }, []);
  const AMM_SEED = { c: 10000000, o: 20000 }; // virtual pool: $10M / 20,000 $OMR ≈ $500 each
  const [amm, setAmm] = useState(AMM_SEED); // live swap market
  const ammRef = useRef(AMM_SEED);
  useEffect(() => { ammRef.current = amm; }, [amm]);
  const ammPrice = amm.o > 0 ? amm.c / amm.o : SWAP_RATE;
  const [sellItem, setSellItem] = useState("cb");
  const [sellQty, setSellQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(300);
  const [gName, setGName] = useState("");
  const [gTag, setGTag] = useState("");
  const [donateAmt, setDonateAmt] = useState(1000);
  const [fireAmt, setFireAmt] = useState(500); // rounds per hit attempt
  const [cookAmt, setCookAmt] = useState(20); // units per batch
  const [dealAmt, setDealAmt] = useState(10); // units per street deal
  const [estate, setEstate] = useState(null); // death report overlay
  const leaveGangRef = useRef(null); // lets the inbox death handler leave the old family
  const addLogRef = useRef(null); // lets the tick loop log Bureau raids
  const [saveState, setSaveState] = useState("");
  const logRef = useRef(null);
  const saveTimer = useRef(null);

  const addLog = useCallback((t, msg, amt = null) => setLog((l) => [...l.slice(-50), { t, msg, amt }]), []);

  // ── Load save on mount, apply offline progress ──
  useEffect(() => {
    (async () => {
      let loaded = null;
      try {
        const r = await window.storage.get(SAVE_KEY);
        if (r?.value) loaded = JSON.parse(r.value);
      } catch (e) { /* no save yet */ }
      if (loaded && loaded.name) {
        // normalize fields from older saves
        loaded.assets = loaded.assets || [];
        loaded.streak = loaded.streak || 0;
        loaded.checkinDay = loaded.checkinDay || 0;
        loaded.heistAt = loaded.heistAt || 0;
        loaded.cb = loaded.cb || 0;
        loaded.inv = loaded.inv || {};
        loaded.guns = loaded.guns || [];
        loaded.gun = loaded.gun || null;
        loaded.devFees = loaded.devFees || 0;
        loaded.prestige = loaded.prestige || 0;
        loaded.lc = loaded.lc || { crime: 0 };
        loaded.checkins = loaded.checkins || 0;
        loaded.referredBy = loaded.referredBy || null;
        loaded.refPaid = loaded.refPaid || false;
        loaded.auth = loaded.auth || { method: "guest", id: loaded.name };
        loaded.agentUsed = loaded.agentUsed || false;
        loaded.loc = loaded.loc || "docks";
        // AUDIT R1 — forward-compatible normalization: any field missing from
        // an older save takes its NEW_PLAYER default. No more per-version chains.
        for (const [k, v] of Object.entries(NEW_PLAYER())) if (loaded[k] === undefined) loaded[k] = v;
        // rank is now the primary title; legacy honorifics migrate
        if (loaded.title === "ASSOCIATE") loaded.title = "";
        if (loaded.title === "CAPO") loaded.title = (loaded.missions || []).includes("m5") ? "MADE IN BLOOD" : "";
        // season rollover: level converts to permanent prestige, respect resets
        const curSeason = seasonOf(dayOf());
        if (!loaded.season) loaded.season = curSeason;
        if (loaded.season < curSeason) {
          const careerLvl = Math.floor(Math.sqrt(loaded.respect / 4)) + 1;
          loaded.prestige += careerLvl;
          loaded.respect = 0;
          loaded.season = curSeason;
          loaded._seasonEnded = careerLvl;
        }
        if (!loaded.daily || loaded.daily.day !== dayOf()) loaded.daily = { day: dayOf(), c: {}, claimed: [] };
        // offline progress: regen + racket/front income, capped at 8h
        const away = Math.min(Date.now() - (loaded.lastSeen || Date.now()), 8 * 3600 * 1000);
        const ticks = Math.floor(away / TICK_MS);
        const lvl = Math.floor(Math.sqrt(loaded.respect / 4)) + 1;
        const income = ((loaded.rackets || []).reduce((a, id) => a + (RACKETS.find(r => r.id === id)?.income || 0), 0) + assetIncome(loaded.assets)) * (loaded.path === "ledger" ? 1.1 : 1) * (TICK_MS / 60000);
        loaded.energy = Math.min(50 + lvl * 2 + assetEnergyCap(loaded.assets), loaded.energy + ticks * 2);
        loaded.nerve = Math.min(10 + lvl, loaded.nerve + ticks);
        loaded.health = Math.min(100, loaded.health + ticks);
        loaded.jail = Math.max(0, (loaded.jail || 0) - ticks * (TICK_MS / 1000));
        const earned = income * ticks;
        if (earned > 0) loaded.cash += earned;
        // AUDIT R6 — the corner never sleeps: offline crew sales (same 8h cap),
        // heat rises with them and decays ~1/min; a hot return can mean a raid.
        const awayMin = Math.floor(away / 60000);
        let crewNote = "";
        if ((loaded.crew || 0) > 0 && stashTotal(loaded.stash) > 0) {
          let toSell = Math.min(stashTotal(loaded.stash), loaded.crew * awayMin);
          let crewCash = 0, heatAdd = 0;
          loaded.stash = { ...loaded.stash };
          for (const d of DRUGS) {
            if (toSell <= 0) break;
            const s = loaded.stash[d.id];
            if (!s || !s.n) continue;
            const n = Math.min(s.n, toSell);
            toSell -= n;
            crewCash += Math.floor(n * d.base * (s.q || 1) * 0.8);
            heatAdd += d.heat * n * 0.1;
            loaded.stash[d.id] = { ...s, n: s.n - n };
          }
          loaded.cash += crewCash;
          loaded.tradeRep = (loaded.tradeRep || 0) + crewCash;
          loaded.heat = Math.max(0, Math.min(100, (loaded.heat || 0) + heatAdd - awayMin));
          crewNote = crewCash > 0 ? ` The corner crew moved product for $${fmt(crewCash)}.` : "";
          if (loaded.heat > 60 && Math.random() < 0.5) {
            loaded.stash = Object.fromEntries(Object.entries(loaded.stash).map(([k, s]) => [k, { ...s, n: Math.floor((s?.n || 0) * 0.4) }]));
            loaded.jail = Math.max(loaded.jail || 0, rand(60, 120));
            loaded.heat = Math.max(0, loaded.heat - 40);
            crewNote += " 🚨 The Bureau hit the operation while you were away — most of the stash is gone.";
          }
        } else {
          loaded.heat = Math.max(0, (loaded.heat || 0) - awayMin);
        }
        loaded._crewNote = crewNote;
        loaded.lastSeen = Date.now();
        setP(loaded);
        setScreen("game");
        setLog([{ t: "SYS", msg: `Welcome back, ${loaded.name}.` + (earned > 0 ? ` Your rackets earned $${fmt(earned)} while you were gone.` : "") + (loaded._crewNote || "") + (loaded._seasonEnded ? ` 🏁 The season ended while you were away — career prestige +${loaded._seasonEnded} ⭐, respect resets, everything you own stays.` : ""), amt: null }]);
      } else {
        setScreen("create");
      }
    })();
  }, []);

  // ── Debounced auto-save + leaderboard publish ──
  useEffect(() => {
    if (!p || screen !== "game") return;
    setSaveState("…");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const snap = { ...p, lastSeen: Date.now() };
        await window.storage.set(SAVE_KEY, JSON.stringify(snap));
        const ib = (st) => p.owned.reduce((a, id) => { const it = MARKET.find((m) => m.id === id); return a + (it && it.stat === st ? it.boost : 0); }, 0);
        await window.storage.set("pub_" + p.id, JSON.stringify({
          id: p.id, n: p.name, r: Math.floor(p.respect), ti: rankOf(Math.floor(Math.sqrt(p.respect / 4)) + 1).name,
          m: p.stats.muscle + ib("muscle"), c: p.stats.cunning + ib("cunning"), s: p.stats.speed + ib("speed") + assetStat(p.assets, "speed"),
          cash: Math.floor(p.cash), hosp: p.hosp || 0, g: p.gangTag || null, gid: p.gangId || null,
          cb: p.cb || 0,
          pr: p.prestige || 0,
          ag: p.agentUsed || false,
          fp: (GUNS.find((g) => g.id === p.gun)?.fp) || 0,
          lvl: Math.floor(Math.sqrt(p.respect / 4)) + 1,
          loc: p.loc || "docks",
          jailU: p.jail > 0 ? Date.now() + p.jail * 1000 : 0,
          vest: p.vest || null,
          fleet: (p.cars || []).length,
          fleetV: carsValue(p.cars || []),
          dth: p.deaths || 0,
          tr: tradeRankIdx(p.tradeRep),
          pth: p.path || null,
          rc: p.recruits || 0,
          nw: Math.floor(p.cash + p.bank + assetsValue(p.assets) + gunsValue(p.guns) + carsValue(p.cars) + p.rackets.reduce((a, id) => a + (RACKETS.find((r) => r.id === id)?.cost || 0), 0) + (p.omr + p.staked + p.rewards) * (ammRef.current.o > 0 ? ammRef.current.c / ammRef.current.o : SWAP_RATE)),
          t: Date.now(),
        }), true);
        setSaveState("saved");
      } catch (e) {
        setSaveState("save failed");
      }
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [p, screen]);

  // ── Game tick ──
  useEffect(() => {
    if (screen !== "game") return;
    const iv = setInterval(() => {
      const raidRoll = Math.random(); // AUDIT R3 — rolled outside the updater (double-invoke safety)
      const lossRoll = 0.3 + Math.random() * 0.3; // raid stash-loss %, also pre-rolled
      setP((pl) => {
        if (!pl) return pl;
        const lvl = Math.floor(Math.sqrt(pl.respect / 4)) + 1;
        const ri = rankIdxOf(lvl);
        const held = terrHeldRef.current || [];
        const incomePerMin = (pl.rackets.reduce((a, id) => a + (RACKETS.find(r => r.id === id)?.income || 0), 0) + assetIncome(pl.assets)) * (cityEventOf(dayOf()).racketMult || 1) * (held.includes("neon") ? 1.15 : 1) * (ri >= 7 ? 1.10 : 1);
        const income = incomePerMin * (TICK_MS / 60000) * (pl.path === "ledger" ? 1.1 : 1);
        const stakeGain = pl.staked > 0 ? pl.staked * (APY / (365 * 24 * 3600)) * (TICK_MS / 1000) * 2000 : 0;
        // ── The Kitchen's slow machinery ──
        let heat = Math.max(0, (pl.heat || 0) - 0.05 * (cityEventOf(dayOf()).heatDecay || 1)); // ~1 heat/min baseline decay
        let stash = pl.stash || {};
        let crewCash = 0, crewMoved = 0;
        if ((pl.crew || 0) > 0 && stashTotal(stash) > 0) {
          // each crew member moves ~1 unit/min at 80% of local demand
          let toSell = Math.min(stashTotal(stash), Math.max(1, Math.round(pl.crew * (TICK_MS / 60000))));
          stash = { ...stash };
          for (const d of DRUGS) {
            if (toSell <= 0) break;
            const s = stash[d.id];
            if (!s || !s.n) continue;
            const n = Math.min(s.n, toSell);
            toSell -= n;
            crewMoved += n;
            crewCash += Math.floor(n * d.base * demandOf(d.id, pl.loc) * (s.q || 1) * 0.8);
            stash[d.id] = { ...s, n: s.n - n };
            heat += d.heat * n * 0.1 * (cityEventOf(dayOf()).drugHeat || 1) * (pl.path === "kitchen" ? 0.75 : 1);
          }
        }
        // The Bureau notices sustained heat — raids are a per-tick roll past 60
        let raided = false;
        if (heat > 60 && raidRoll < (heat - 60) / 20000) {
          raided = true;
          stash = Object.fromEntries(Object.entries(stash).map(([k, s]) => [k, { ...s, n: Math.floor((s?.n || 0) * lossRoll) }]));
          heat = Math.max(0, heat - 40);
        }
        if (raided) setTimeout(() => addLogRef.current?.("HEAT", "🚨 THE BUREAU KICKED THE DOOR. They took most of the stash and you're doing a stint. The corner crew scattered — they'll be back."), 0);
        return {
          ...pl,
          heat: Math.min(100, heat),
          stash,
          tradeRep: (pl.tradeRep || 0) + crewCash,
          jail: raided ? rand(60, 120) : Math.max(0, pl.jail - TICK_MS / 1000),
          energy: Math.min(50 + lvl * 2 + assetEnergyCap(pl.assets), pl.energy + 2 + (ri >= 2 ? 1 : 0)),
          nerve: Math.min(10 + lvl, pl.nerve + (held.includes("cathedral") ? 2 : 1) + (ri >= 6 ? 1 : 0)),
          health: Math.min(100, pl.health + 1),
          cash: pl.cash + income + crewCash,
          rewards: pl.rewards + stakeGain,
          daily: pl.daily && pl.daily.day === dayOf() ? pl.daily : { day: dayOf(), c: {}, claimed: [] },
        };
      });
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [screen]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // ── Leaderboard fetch ──
  const loadLb = async () => {
    setLb(null);
    try {
      const res = await window.storage.list("pub_", true);
      const keys = (res?.keys || []).slice(0, 30);
      const rows = [];
      for (const k of keys) {
        try {
          const r = await window.storage.get(k, true);
          if (r?.value) rows.push(JSON.parse(r.value));
        } catch (e) { /* skip */ }
      }
      rows.sort((a, b) => b.r - a.r);
      setLb(rows.slice(0, 20));
    } catch (e) {
      setLb([]);
    }
    // load open bounties (stale ones expire after 7 days)
    try {
      const res = await window.storage.list("bty_", true);
      const keys = (res?.keys || []).slice(0, 30);
      const map = {};
      for (const k of keys) {
        try {
          const r = await window.storage.get(k, true);
          if (r?.value) {
            const d = JSON.parse(r.value);
            if (Date.now() - (d.t || 0) > 7 * 24 * 3600 * 1000) {
              try { await window.storage.delete(k, true); } catch (e) {}
              continue;
            }
            map[d.tid] = d;
          }
        } catch (e) { /* skip */ }
      }
      setBounties(map);
    } catch (e) { /* keep previous bounties */ }
  };
  useEffect(() => { if (tab === "board") { loadLb(); loadWars(); } }, [tab]);

  // ── Damage reports: check the inbox for attacks that happened while away ──
  useEffect(() => {
    if (screen !== "game" || !p?.id) return;
    const pid = p.id;
    const check = async () => {
      try {
        const r = await window.storage.get("inbox_" + pid, true);
        if (r?.value) {
          const events = JSON.parse(r.value);
          if (Array.isArray(events) && events.length) {
            const attacks = events.filter((e) => !e.type || e.type === "attack");
            const sales = events.filter((e) => e.type === "sale");
            const refs = events.filter((e) => e.type === "ref");
            const attempts = events.filter((e) => e.type === "attempt");
            const busted = events.filter((e) => e.type === "busted");
            const witnessed = events.filter((e) => e.type === "witness");
            const whacked = events.find((e) => e.type === "whacked");
            const stolen = attacks.reduce((a, e) => a + (e.stolen || 0), 0);
            const dmg = attacks.reduce((a, e) => a + (e.dmg || 0), 0);
            const cbTaken = attacks.reduce((a, e) => a + (e.cb || 0), 0);
            const proceeds = sales.reduce((a, e) => a + (e.amt || 0), 0);
            const refCash = refs.reduce((a, e) => a + (e.amt || 0), 0);
            const refOmr = refs.reduce((a, e) => a + (e.omr || 0), 0);
            setP((pl) => pl ? {
              ...pl,
              cash: Math.max(0, pl.cash - stolen) + proceeds + refCash,
              omr: pl.omr + refOmr,
              cb: Math.max(0, (pl.cb || 0) - cbTaken),
              health: attacks.length ? Math.max(1, pl.health - dmg) : pl.health,
              hosp: attacks.length ? Date.now() + 3 * 60 * 1000 : pl.hosp,
            } : pl);
            attacks.forEach((e) => addLog("PVP", `${e.from || "A rival"} jumped you on the street${e.cb ? ` and lifted ${e.cb} crate${e.cb > 1 ? "s" : ""} of contraband` : ""}. The Doc is keeping rivals off you for 3 minutes.`, `−$${fmt(e.stolen || 0)} · −${e.dmg || 0} HP`));
            sales.forEach((e) => addLog("MKT", `Your Exchange listing sold: ${e.what || "goods"} to ${e.to || "a buyer"} (house take already deducted).`, `+$${fmt(e.amt || 0)}`));
            refs.forEach((e) => addLog("FAM", `🤝 Your recruit ${e.from || "someone"} made their bones — recruitment bonus paid${e.omr ? " with $OMR from the event fund" : ""}.`, `+$${fmt(e.amt || 0)}${e.omr ? ` · +${e.omr} $OMR` : ""}`));
            if (refs.length) {
              // GRASSROOTS — lifetime recruiter ladder + family Recruitment Drive
              let hitMilestones = [];
              setP((pl) => {
                if (!pl) return pl;
                const before = pl.recruits || 0;
                const after = before + refs.length;
                hitMilestones = RECRUIT_MILESTONES.filter((m) => m.n > before && m.n <= after);
                let cash = pl.cash, omr = pl.omr, title = pl.title;
                for (const m of hitMilestones) { cash += m.cash || 0; omr += m.omr || 0; if (m.title) title = m.title; }
                return { ...pl, recruits: after, cash, omr, title };
              });
              refs.forEach(() => bumpFamilyTask("recruit", 1));
              setTimeout(() => hitMilestones.forEach((m) => addLogRef.current?.("FAM", `🏆 RECRUITER MILESTONE — ${m.name} (${m.n} made). ${m.title ? `The city has a new name for you: ${m.title}.` : ""}${m.omr ? " $OMR paid from the event fund." : ""}`, `+$${fmt(m.cash)}${m.omr ? ` · +${m.omr} $OMR` : ""}`)), 0);
            }
            if (attempts.length) {
              const aDmg = attempts.reduce((a, e) => a + (e.dmg || 0), 0);
              setP((pl) => pl ? { ...pl, health: Math.max(1, pl.health - aDmg) } : pl);
              attempts.forEach((e) => addLog("HEAT", `🔫 ${e.from || "Someone"} OPENED FIRE ON YOU and didn't finish the job. They'll be back — get a vest, get scarce, or get them first.`, `−${e.dmg || 0} HP`));
            }
            if (busted.length) {
              setP((pl) => pl ? { ...pl, jail: 0 } : pl);
              busted.forEach((e) => addLog("SYS", `⛓ ${e.from || "A stranger"} busted you out of lockup. You owe them one.`));
            }
            witnessed.forEach((e) => addLog("HEAT", `👁 You witnessed ${e.killer || "someone"} whack ${e.victim || "someone"}. What you do with that is your business.`));
            if (whacked) {
              // ── THE ESTATE — middle-path death. On-chain survives; the street dies.
              let estateDoc = null; // captured from the updater, applied after (same pattern as the self-guards)
              setP((pl) => {
                if (!pl) return pl;
                const lvl = Math.floor(Math.sqrt(pl.respect / 4)) + 1;
                const legacy = Math.floor(lvl / 2);
                const newPrestige = (pl.prestige || 0) + legacy;
                estateDoc = {
                  by: whacked.from || "an unknown shooter",
                  legacy,
                  kept: { omr: pl.omr, staked: pl.staked, rewards: pl.rewards, gear: (pl.owned || []).length, prestige: newPrestige, wallet: pl.wallet },
                  lost: { cash: Math.floor(pl.cash + pl.bank), cars: (pl.cars || []).length, guns: (pl.guns || []).length, lvl, rank: rankOf(lvl).name, product: stashTotal(pl.stash), tradeRank: TRADE_RANKS[tradeRankIdx(pl.tradeRep)].name },
                };
                return {
                  ...NEW_PLAYER(),
                  id: pl.id, name: pl.name, auth: pl.auth,
                  wallet: pl.wallet, omr: pl.omr, staked: pl.staked, rewards: pl.rewards,
                  owned: pl.owned || [], // NFT gear lives in the wallet — it survives you
                  prestige: newPrestige,
                  referredBy: pl.referredBy, refPaid: true, // a rebirth is not a new recruit
                  agentUsed: pl.agentUsed, checkins: pl.checkins || 0,
                  recruits: pl.recruits || 0, // relationships survive the character
                  onboard: pl.onboard || {}, // the heir doesn't redo the First Week
                  deaths: (pl.deaths || 0) + 1,
                  season: seasonOf(dayOf()),
                  cash: 500 + newPrestige * 100, // the legacy stake
                };
              });
              if (estateDoc) setEstate(estateDoc);
              try { await leaveGangRef.current?.(true); } catch (e2) { /* family notified later */ }
              addLog("HEAT", `☠ ${whacked.from || "Someone"} WHACKED YOU. The character is gone — the wallet, the gear, and the name live on.`);
            }
          }
          await window.storage.delete("inbox_" + pid, true);
        }
      } catch (e) { /* no inbox — nobody's touched you */ }
    };
    check();
    const iv = setInterval(check, 20000);
    return () => clearInterval(iv);
  }, [screen, p?.id, addLog]);

  // ── Gangs: directory + my family ──
  const loadGangs = async () => {
    setGangs(null);
    try {
      const res = await window.storage.list("gang_", true);
      const keys = (res?.keys || []).slice(0, 25);
      const rows = [];
      for (const k of keys) {
        try {
          const r = await window.storage.get(k, true);
          if (r?.value) rows.push(JSON.parse(r.value));
        } catch (e) { /* skip */ }
      }
      rows.sort((a, b) => (b.treasury || 0) - (a.treasury || 0));
      setGangs(rows);
    } catch (e) { setGangs([]); }
  };

  const loadMyGang = async () => {
    if (!p?.gangId) { setMyGang(null); return; }
    try {
      const r = await window.storage.get("gang_" + p.gangId, true);
      if (!r?.value) throw new Error("gone");
      setMyGang(JSON.parse(r.value));
    } catch (e) {
      setMyGang(null);
      setP((pl) => (pl ? { ...pl, gangId: null, gangTag: null, gangName: null } : pl));
      addLog("FAM", "Your family has been disbanded. You're a free agent now.");
    }
  };

  // Load wars; resolve any that have expired (winner takes 20% of loser's treasury)
  const loadWars = async () => {
    try {
      const res = await window.storage.list("war_", true);
      const keys = (res?.keys || []).slice(0, 25);
      const out = [];
      for (const k of keys) {
        let doc = null;
        try {
          const r = await window.storage.get(k, true);
          if (r?.value) doc = JSON.parse(r.value);
        } catch (e) { continue; }
        if (!doc) continue;
        const now = Date.now();
        if (!doc.resolved && now > doc.ends) {
          doc.resolved = true;
          doc.winner = (doc.scoreA || 0) > (doc.scoreB || 0) ? "a" : (doc.scoreB || 0) > (doc.scoreA || 0) ? "b" : null;
          try {
            await window.storage.set(k, JSON.stringify(doc), true); // claim resolution first
            if (doc.winner) {
              const w = doc[doc.winner];
              const l = doc[doc.winner === "a" ? "b" : "a"];
              let spoils = 0;
              try {
                const lr = await window.storage.get("gang_" + l.id, true);
                if (lr?.value) {
                  const ld = JSON.parse(lr.value);
                  spoils = Math.floor((ld.treasury || 0) * 0.2);
                  ld.treasury = Math.max(0, (ld.treasury || 0) - spoils);
                  await window.storage.set("gang_" + l.id, JSON.stringify(ld), true);
                }
              } catch (e) { /* loser gang gone */ }
              try {
                const wr = await window.storage.get("gang_" + w.id, true);
                if (wr?.value) {
                  const wd = JSON.parse(wr.value);
                  wd.treasury = (wd.treasury || 0) + spoils;
                  wd.won = (wd.won || 0) + 1; // war wins raise standing for buyback payouts
                  await window.storage.set("gang_" + w.id, JSON.stringify(wd), true);
                }
              } catch (e) { /* winner gang gone */ }
              doc.spoils = spoils;
              try { await window.storage.set(k, JSON.stringify(doc), true); } catch (e) {}
            }
            if (p?.gangId && (doc.a.id === p.gangId || doc.b.id === p.gangId)) {
              const won = doc.winner && doc[doc.winner].id === p.gangId;
              addLog("WAR", doc.winner
                ? `The war between [${doc.a.tag}] and [${doc.b.tag}] is over. ${won ? "Your family won and took the spoils." : "Your family lost and paid 20% of the treasury."}`
                : `The war between [${doc.a.tag}] and [${doc.b.tag}] ends in a stalemate. Nobody eats.`);
              loadMyGang();
            }
          } catch (e) { /* someone else resolved it */ }
        }
        if (doc.resolved && Date.now() > doc.ends + 24 * 3600 * 1000) {
          try { await window.storage.delete(k, true); } catch (e) {}
          continue;
        }
        if (!doc.resolved || Date.now() < doc.ends + 3600 * 1000) out.push(doc);
      }
      out.sort((x, y) => (y.started || 0) - (x.started || 0));
      setWars(out);
    } catch (e) { /* keep previous wars */ }
  };

  useEffect(() => { if (tab === "gang" && screen === "game") { loadGangs(); loadMyGang(); loadWars(); } }, [tab, screen]);
  useEffect(() => { if (screen === "game") { loadMyGang(); loadWars(); loadDevWallet(); } }, [screen]);

  // ── The Exchange: player-run order book ──
  const loadMarket = async () => {
    setListings(null);
    try {
      const res = await window.storage.list("mkt_", true);
      const keys = (res?.keys || []).slice(0, 30);
      const rows = [];
      for (const k of keys) {
        try {
          const r = await window.storage.get(k, true);
          if (r?.value) {
            const doc = JSON.parse(r.value);
            if (Date.now() - (doc.t || 0) > 7 * 24 * 3600 * 1000) {
              try { await window.storage.delete(k, true); } catch (e) {}
              continue;
            }
            rows.push(doc);
          }
        } catch (e) { /* skip */ }
      }
      rows.sort((a, b) => (a.price || 0) - (b.price || 0));
      setListings(rows);
    } catch (e) { setListings([]); }
  };

  const loadDevWallet = async () => {
    try {
      const r = await window.storage.get("dev_wallet", true);
      if (r?.value) setDevWallet(JSON.parse(r.value).total || 0);
    } catch (e) { /* no fees collected yet */ }
    try {
      const r = await window.storage.get("street_tax", true);
      if (r?.value) setStreetTax((s) => ({ ...s, ...JSON.parse(r.value) }));
    } catch (e) { /* no tax collected yet */ }
    loadAmm();
    runBuyback();
  };

  // Virtual constant-product pool (x·y=k). Shared across all players so the
  // $OMR price is one market: buys push it up, sells push it down, and the
  // 12-hour buyback executes through it. Demo-grade last-write-wins; the
  // production version is a real on-chain AMM pool.
  const loadAmm = async () => {
    try {
      const r = await window.storage.get("amm", true);
      if (r?.value) { setAmm(JSON.parse(r.value)); return; }
    } catch (e) { /* not seeded yet */ }
    try { await window.storage.set("amm", JSON.stringify(AMM_SEED), true); setAmm(AMM_SEED); } catch (e) {}
  };

  // Executes a swap against the shared pool. dir "buy": cashIn → omrOut.
  // dir "sell": omrIn → cashOut. Returns the output amount or null on failure.
  const ammSwap = async (dir, amountIn) => {
    try {
      let pool = { ...AMM_SEED };
      try {
        const r = await window.storage.get("amm", true);
        if (r?.value) pool = JSON.parse(r.value);
      } catch (e) { /* use seed */ }
      const k = pool.c * pool.o;
      let out;
      if (dir === "buy") {
        out = pool.o - k / (pool.c + amountIn);
        pool.c += amountIn;
        pool.o -= out;
      } else {
        out = pool.c - k / (pool.o + amountIn);
        pool.o += amountIn;
        pool.c -= out;
      }
      if (out <= 0) return null;
      await window.storage.set("amm", JSON.stringify(pool), true);
      setAmm(pool);
      return out;
    } catch (e) { return null; }
  };

  // Executes the 12-hour buyback if it's due. First player to load after the
  // cycle triggers it (demo-grade; production uses a scheduled treasury job).
  const runBuyback = async () => {
    try {
      const r = await window.storage.get("street_tax", true);
      if (!r?.value) return;
      const d = JSON.parse(r.value);
      const pool = d.pool || 0;
      if (pool <= 0 || Date.now() - (d.lastRun || 0) < 12 * 3600 * 1000) return;
      // claim the cycle first so parallel loaders don't double-distribute
      const claimed = { ...d, pool: 0, lastRun: Date.now() };
      await window.storage.set("street_tax", JSON.stringify(claimed), true);
      // the buyback is a real market buy: it moves the pool price
      const bought = await ammSwap("buy", pool);
      if (bought === null || bought <= 0) return;
      const clanShare = bought / 2;
      let fundAdd = bought / 2;
      // rank families by standing = lifetime tribute + 10,000 per war won
      let ranked = [];
      try {
        const res = await window.storage.list("gang_", true);
        const keys = (res?.keys || []).slice(0, 40);
        for (const k of keys) {
          try {
            const gr = await window.storage.get(k, true);
            if (gr?.value) {
              const g = JSON.parse(gr.value);
              g._standing = (g.lifetime || 0) + 10000 * (g.won || 0);
              if (g._standing > 0) ranked.push(g);
            }
          } catch (e) { /* skip */ }
        }
      } catch (e) { /* no families */ }
      ranked.sort((a, b) => b._standing - a._standing);
      ranked = ranked.slice(0, 25);
      const totalStanding = ranked.reduce((a, g) => a + g._standing, 0);
      let distributed = 0;
      if (totalStanding > 0) {
        for (const g of ranked) {
          const share = clanShare * (g._standing / totalStanding);
          try {
            const gr = await window.storage.get("gang_" + g.id, true);
            if (gr?.value) {
              const gd = JSON.parse(gr.value);
              gd.omr = (gd.omr || 0) + share;
              await window.storage.set("gang_" + g.id, JSON.stringify(gd), true);
              distributed += share;
              if (p?.gangId === g.id) {
                addLog("FAM", `🏆 Buyback payout: your family ranked top-25 by standing and received ${fmtT(share)} $OMR to the family reserve.`);
                loadMyGang();
              }
            }
          } catch (e) { /* family gone */ }
        }
        fundAdd += clanShare - distributed; // undistributed remainder rolls to the fund
      } else {
        fundAdd = bought; // no eligible families yet: whole buyback to the event fund
      }
      const finalDoc = {
        ...claimed,
        distributed: (claimed.distributed || 0) + distributed,
        fund: (claimed.fund || 0) + fundAdd,
      };
      await window.storage.set("street_tax", JSON.stringify(finalDoc), true);
      setStreetTax(finalDoc);
      addLog("SOL", `🔁 12-hour buyback executed: $${fmt(pool)} bought ${fmtT(bought)} $OMR — half to the top families by standing, half to the event fund.`);
    } catch (e) { /* another player likely ran it first */ }
  };

  useEffect(() => { if (tab === "exchange" && screen === "game") loadMarket(); }, [tab, screen]);
  useEffect(() => { if (tab === "vault" && screen === "game") loadDevWallet(); }, [tab, screen]);

  // ── Turf: district holders ──
  const loadTerrs = async () => {
    try {
      const out = [];
      for (const d of DISTRICTS) {
        try {
          const r = await window.storage.get("terr_" + d.id, true);
          out.push(r?.value ? { ...d, ...JSON.parse(r.value) } : { ...d });
        } catch (e) { out.push({ ...d }); }
      }
      setTerrs(out);
    } catch (e) { /* keep previous */ }
  };
  useEffect(() => { if (tab === "turf" && screen === "game") loadTerrs(); }, [tab, screen]);
  useEffect(() => { if (screen === "game") loadTerrs(); }, [screen]);
  useEffect(() => {
    terrHeldRef.current = terrs.filter((t) => t.holder?.gid && p?.gangId && t.holder.gid === p.gangId).map((t) => t.id);
  }, [terrs, p?.gangId]);

  // ── Recruits: my referral roster ──
  const loadRecruits = async () => {
    if (!p?.id) return;
    setRecruits(null);
    try {
      const res = await window.storage.list("ref_" + p.id + "_", true);
      const keys = (res?.keys || []).slice(0, 25);
      const rows = [];
      for (const k of keys) {
        try {
          const r = await window.storage.get(k, true);
          if (r?.value) rows.push(JSON.parse(r.value));
        } catch (e) { /* skip */ }
      }
      rows.sort((a, b) => (b.t || 0) - (a.t || 0));
      setRecruits(rows);
    } catch (e) { setRecruits([]); }
  };
  useEffect(() => { if (tab === "daily" && screen === "game") loadRecruits(); }, [tab, screen]);

  // window.omerta — programmatic API so external agents/scripts can play.
  // Same dispatcher and guards as the built-in agent and human play.
  useEffect(() => {
    window.omerta = {
      getState: () => (apiRef.current.snapshot ? apiRef.current.snapshot() : null),
      act: (name, params) => (apiRef.current.act ? apiRef.current.act(name, params) : "game not ready"),
      actions: ["crime", "train", "heist", "checkin", "claim", "craft", "use", "bank", "buyRacket", "buyGun", "equipGun", "attack", "travel", "buyGood", "sellGood", "buyAmmo", "rest"],
    };
    return () => { try { delete window.omerta; } catch (e) {} };
  }, []);

  // ── Season rollover check while playing ──
  useEffect(() => {
    if (screen !== "game") return;
    const iv = setInterval(() => {
      setP((pl) => {
        if (!pl || (pl.season || 0) >= seasonOf(dayOf())) return pl;
        const careerLvl = Math.floor(Math.sqrt(pl.respect / 4)) + 1;
        setTimeout(() => addLog("FAM", `🏁 Season ${pl.season} has ended. Career prestige +${careerLvl} ⭐ — respect resets, everything you own stays. New season starts now.`), 0);
        return { ...pl, prestige: (pl.prestige || 0) + careerLvl, respect: 0, season: seasonOf(dayOf()) };
      });
    }, 60000);
    return () => clearInterval(iv);
  }, [screen, addLog]);

  if (screen === "loading") return <div style={{ background: "#14110E", color: "#8B8578", minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "monospace" }}>opening the books…</div>;

  // ── Sign-in / character creation ──
  if (screen === "create") {
    const createPlayer = () => {
      const val = nameInput.trim();
      let name = "";
      if (authMethod === "x") {
        if (!/^@?\w{2,15}$/.test(val)) return;
        name = val.replace(/^@/, "");
      } else if (authMethod === "privy") {
        if (!val.includes("@") || val.length < 5) return;
        name = val.split("@")[0].slice(0, 16);
      } else {
        if (val.length < 2) return;
        name = val.slice(0, 16);
      }
      const np = { ...NEW_PLAYER(), name, auth: { method: authMethod || "guest", id: val } };
      const msgs = [{ t: "SYS", msg: "Welcome to the family. Keep your mouth shut and the books balanced.", amt: null }];
      if (authMethod === "privy") {
        np.wallet = fakeAddr();
        msgs.push({ t: "SOL", msg: `Privy embedded wallet created and connected (simulated): ${short(np.wallet)}. No seed phrase for you to lose.`, amt: null });
      }
      if (authMethod === "x") msgs.push({ t: "SYS", msg: `Signed in as @${name} (simulated 𝕏 login).`, amt: null });
      setP(np);
      setScreen("game");
      setLog(msgs);
    };
    return (
      <div style={{ background: "#14110E", minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&family=IBM+Plex+Mono&display=swap');`}</style>
        <div style={{ maxWidth: 440, textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", color: "#E6DCC8" }}>
          <div style={{ fontFamily: "'Big Shoulders Display',sans-serif", fontSize: 56, fontWeight: 800 }}>OMERTÀ<span style={{ color: "#D4453C" }}>.</span></div>
          {!authMethod ? (
            <div>
              <p style={{ color: "#8B8578", fontSize: 13 }}>The family is taking new blood. How do you want to walk in?</p>
              {[["x", "Continue with 𝕏"], ["privy", "Continue with Privy (email + wallet)"], ["guest", "Play as a guest"]].map(([m, label]) => (
                <button key={m} onClick={() => setAuthMethod(m)}
                  style={{ display: "block", width: "100%", margin: "10px 0", background: "#241E17", border: "1px solid #4A3F32", color: "#E6DCC8", padding: "12px", borderRadius: 4, cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14 }}>
                  {label}
                </button>
              ))}
              <p style={{ color: "#8B8578", fontSize: 10, marginTop: 12 }}>
                Sign-in is SIMULATED in this prototype. Production uses the Privy SDK — 𝕏 as a social login and an
                embedded Solana wallet created automatically, so players never handle a seed phrase.
              </p>
            </div>
          ) : (
            <div>
              <p style={{ color: "#8B8578", fontSize: 13 }}>
                {authMethod === "x" ? "Your 𝕏 handle becomes your street name." : authMethod === "privy" ? "Your email — a wallet is created for you, no seed phrase." : "What do they call you on the street?"}
                {" "}(Your name, stats, and pocket cash are visible to every other player — and they can jump you for it.)
              </p>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value.slice(0, 40))}
                placeholder={authMethod === "x" ? "@handle" : authMethod === "privy" ? "you@example.com" : "Street name"}
                style={{ background: "#0D0B09", border: "1px solid #3A3128", color: "#E6DCC8", padding: 12, borderRadius: 4, fontFamily: "inherit", width: "100%", textAlign: "center", fontSize: 16 }}
              />
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => { setAuthMethod(null); setNameInput(""); }}
                  style={{ marginTop: 14, background: "#241E17", border: "1px solid #4A3F32", color: "#8B8578", padding: "12px 18px", borderRadius: 4, cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace" }}>Back</button>
                <button onClick={createPlayer}
                  style={{ marginTop: 14, background: "#5A1E1A", border: "1px solid #9E2B25", color: "#E6DCC8", padding: "12px 28px", borderRadius: 4, cursor: "pointer", fontFamily: "'Big Shoulders Display',sans-serif", fontSize: 20, letterSpacing: ".08em" }}>TAKE THE OATH</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Derived values ──
  const level = Math.floor(Math.sqrt(p.respect / 4)) + 1;
  const maxEnergy = 50 + level * 2 + assetEnergyCap(p.assets);
  const maxNerve = 10 + level;
  const nextLvlRespect = Math.pow(level, 2) * 4;
  const itemBoost = (stat) => p.owned.reduce((a, id) => { const it = MARKET.find(m => m.id === id); return a + (it && it.stat === stat ? it.boost : 0); }, 0);
  const eff = (s) => p.stats[s] + itemBoost(s) + assetStat(p.assets, s);
  const gunObj = GUNS.find((g) => g.id === p.gun) || null;
  const gunFp = gunObj ? gunObj.fp : 0;
  const held = terrs.filter((t) => t.holder?.gid && p.gangId && t.holder.gid === p.gangId).map((t) => t.id);
  const netWorth = Math.floor(p.cash + p.bank + assetsValue(p.assets) + gunsValue(p.guns) + carsValue(p.cars) + p.rackets.reduce((a, id) => a + (RACKETS.find((r) => r.id === id)?.cost || 0), 0) + (p.omr + p.staked + p.rewards) * ammPrice);
  const up = (patch) => setP((pl) => ({ ...pl, ...(typeof patch === "function" ? patch(pl) : patch) }));
  const gangLevel = myGang ? Math.min(5, Math.floor((myGang.treasury || 0) / 50000)) : 0;
  const rIdx = rankIdxOf(level);
  const rank = RANKS[rIdx];
  const rankPayoutMult = (rIdx >= 1 ? 1.05 : 1) * (rIdx >= 8 ? 1.10 : 1);
  const rankAtkBonus = rIdx >= 3 ? 5 : 0;
  const rankDocMult = rIdx >= 4 ? 0.9 : 1;
  const rankJailMult = rIdx >= 5 ? 0.8 : 1;
  const rankSuccessBonus = rIdx >= 9 ? 0.02 : 0;
  const myRole = myGang ? (myGang.bossId === p.id ? "boss" : (myGang.members || []).find((m) => m.id === p.id)?.role || "soldier") : null;
  const canCommand = myRole === "boss" || myRole === "under";
  const roleMult = myRole === "boss" || myRole === "under" ? 1.10 : myRole === "capo" ? 1.05 : 1;

  const bumpDaily = (k) => up((pl) => {
    const day = dayOf();
    const d = pl.daily && pl.daily.day === day ? pl.daily : { day, c: {}, claimed: [] };
    return { daily: { ...d, c: { ...d.c, [k]: (d.c[k] || 0) + 1 } } };
  });

  // 1% developer cut — tracked per player and tallied in a public counter.
  // In production this is an on-chain fee routed to the multisig treasury wallet.
  const recordFee = (fee) => {
    if (fee <= 0) return;
    up((pl) => ({ devFees: (pl.devFees || 0) + fee }));
    (async () => {
      try {
        let cur = 0;
        try {
          const r = await window.storage.get("dev_wallet", true);
          if (r?.value) cur = JSON.parse(r.value).total || 0;
        } catch (e) { /* first fee ever */ }
        await window.storage.set("dev_wallet", JSON.stringify({ total: cur + fee, t: Date.now() }), true);
        setDevWallet(cur + fee);
      } catch (e) { /* tally may lag; fine for demo */ }
    })();
  };

  // 1% street tax — pooled, then every 12 hours the pool buys $OMR on the
  // open market: half is distributed pro-rata to the top 25 families by
  // standing, half goes to the event fund. Simulated here; in production a
  // scheduled treasury program executes the buyback and split on-chain.
  const recordTax = (tax) => {
    if (tax <= 0) return;
    (async () => {
      try {
        let d = { pool: 0, lastRun: 0, distributed: 0, fund: 0 };
        try {
          const r = await window.storage.get("street_tax", true);
          if (r?.value) d = { ...d, ...JSON.parse(r.value) };
        } catch (e) { /* first tax ever */ }
        d.pool = (d.pool || 0) + tax;
        d.t = Date.now();
        await window.storage.set("street_tax", JSON.stringify(d), true);
        setStreetTax(d);
      } catch (e) { /* tally may lag; fine for demo */ }
    })();
  };

  // ── Actions ──
  const doCrime = (c) => {
    if (p.jail > 0) return addLog("SYS", "You're in the county lockup. Sit tight.");
    if (p.health < 20) return addLog("SYS", "You're in no shape for work. See the Doc.");
    if (p.nerve < c.nerve) return addLog("SYS", "Not enough nerve.");
    up((pl) => ({ nerve: pl.nerve - c.nerve }));
    let chance = Math.min(0.97, c.base + eff("cunning") * 0.004 + eff("speed") * 0.002 + gangLevel * 0.02 + (held.includes("brick") ? 0.02 : 0) + rankSuccessBonus);
    if (gunObj) {
      chance += c.nerve >= 6
        ? gunObj.fp * 0.003 // heavy jobs: iron talks
        : -Math.max(0, gunObj.fp - gunObj.cc) * 0.002; // quiet work: a cannon under your coat draws eyes
      chance = Math.min(0.97, Math.max(0.05, chance));
    }
    if (Math.random() < chance) {
      const ev = cityEventOf(dayOf());
      let take = rand(c.cash[0], c.cash[1]);
      take = Math.floor(take * (ev.jobPay || 1));
      if (held.includes("canal")) take = Math.floor(take * 1.1);
      take = Math.floor(take * rankPayoutMult * roleMult);
      let bonusMsg = "";
      if (Math.random() < 0.1) { const bonus = Math.floor(take * 0.5); take += bonus; bonusMsg = " Found an extra stash."; }
      let crates = 0;
      if (Math.random() < (0.25 + c.nerve * 0.02) * (ev.cbMult || 1) * (held.includes("docks") ? 1.5 : 1)) crates = 1 + Math.floor(c.nerve / 8);
      // AUDIT R9 — crimes can shake loose makings for the Kitchen (unlocked lines only)
      let mkDrop = null;
      if (Math.random() < 0.15) {
        const pool = DRUGS.filter((d) => tradeRankIdx(p.tradeRep) >= d.unlock);
        if (pool.length) mkDrop = { id: pool[Math.floor(Math.random() * pool.length)].id, n: 1 + Math.floor(c.nerve / 6) };
      }
      const repGain = Math.round(c.respect * (ev.crimeRep || 1));
      up((pl) => ({ cash: pl.cash + take, respect: pl.respect + repGain, cb: (pl.cb || 0) + crates, makings: mkDrop ? { ...pl.makings, [mkDrop.id]: ((pl.makings || {})[mkDrop.id] || 0) + mkDrop.n } : pl.makings, lc: { ...(pl.lc || {}), crime: ((pl.lc || {}).crime || 0) + 1 } }));
      bumpDaily("crime");
      checkRef();
      crimeTaskRef.current += 1;
      if (crimeTaskRef.current >= 10) { const n = crimeTaskRef.current; crimeTaskRef.current = 0; bumpFamilyTask("crime", n); }
      addLog("JOB", `${c.name} — clean job.${bonusMsg}${crates ? ` Came away with ${crates} crate${crates > 1 ? "s" : ""} of contraband.` : ""}${mkDrop ? ` A case of ${drugOf(mkDrop.id)?.name} makings fell off the back (×${mkDrop.n}).` : ""}`, `+$${fmt(take)}${crates ? ` · +${crates} 📦` : ""}`);
    } else if (Math.random() < 0.5 && c.jail > 0) {
      const jailT = Math.max(4, Math.round(c.jail * (cityEventOf(dayOf()).jailMult || 1) * rankJailMult));
      let confMsg = "";
      if (gunObj && Math.random() > gunObj.rel) {
        up((pl) => ({ jail: jailT, guns: pl.guns.filter((id) => id !== pl.gun), gun: null }));
        confMsg = ` They confiscated your ${gunObj.name} — it's gone for good.`;
      } else {
        up({ jail: jailT });
      }
      addLog("HEAT", `${c.name} — made by a beat cop. ${jailT}s in lockup.${confMsg}`);
    } else {
      const dmg = rand(5, 15);
      const mugged = Math.random() < 0.15 && p.cash > 500;
      up((pl) => ({
        health: Math.max(1, pl.health - dmg),
        cash: mugged ? Math.floor(pl.cash * 0.9) : pl.cash,
      }));
      addLog("HEAT", `${c.name} — went sideways.${mugged ? " A rival crew lifted 10% of your pocket cash. Banked money was safe." : ""}`, `−${dmg} HP`);
    }
  };

  const doMission = (m) => {
    const meets = level >= m.req.lvl && Object.entries(m.req).every(([k, v]) => k === "lvl" ? true : k === "fp" ? gunFp >= v : k === "trade" ? (p.tradeRep || 0) >= v : eff(k) >= v);
    if (!meets) return addLog("SYS", m.req.fp && gunFp < m.req.fp ? `You're not ready — this job needs iron (firepower ${m.req.fp}+). Visit the Armory.` : "You're not ready. The family doesn't hand out second chances.");
    if (p.jail > 0 || p.health < 20) return addLog("SYS", "Not in your condition.");
    up((pl) => ({
      cash: pl.cash + m.reward.cash,
      respect: pl.respect + m.reward.respect,
      omr: pl.omr + (m.reward.omr || 0),
      missions: [...pl.missions, m.id],
      title: m.title || pl.title,
    }));
    addLog("FAM", `"${m.name}" complete. The family remembers.${m.title ? ` You've been made ${m.title}.` : ""}`, `+$${fmt(m.reward.cash)} · +${m.reward.respect} rep${m.reward.omr ? ` · +${m.reward.omr} $OMR` : ""}`);
  };

  const buyRacket = (r) => {
    if (level < r.lvl) return addLog("SYS", `Need level ${r.lvl}.`);
    if (p.cash < r.cost) return addLog("SYS", "Not enough pocket cash.");
    let ok = false;
    setP((pl) => {
      if (!pl || pl.cash < r.cost || pl.rackets.includes(r.id)) return pl; // self-guard: funds + no dupe
      ok = true;
      return { ...pl, cash: pl.cash - r.cost, rackets: [...pl.rackets, r.id] };
    });
    if (!ok) return;
    addLog("FAM", `Acquired ${r.name}. Earns $${fmt(r.income)}/min — even while you're away.`, `−$${fmt(r.cost)}`);
  };

  const train = (s) => {
    if (p.jail > 0) return addLog("SYS", "No gym in lockup.");
    if (p.energy < 10) return addLog("SYS", "Too tired to train.");
    // diminishing returns: gains scale by 200/(200+stat) so veterans plateau
    const gain = Math.max(1, Math.round(rand(1, 3) * (200 / (200 + p.stats[s]))));
    up((pl) => ({ energy: pl.energy - 10, stats: { ...pl.stats, [s]: pl.stats[s] + gain } }));
    bumpDaily("train");
    addLog("GYM", `Trained ${s}.${p.stats[s] > 200 ? " The gains come slower at your level." : ""}`, `+${gain}`);
  };

  const heal = () => {
    const cost = Math.floor((100 - Math.floor(p.health)) * 15 * rankDocMult);
    if (cost <= 0) return addLog("SYS", "You're already healthy.");
    if (p.cash < cost) return addLog("SYS", `The Doc wants $${fmt(cost)}. Cash only.`);
    let ok = false;
    setP((pl) => {
      if (!pl) return pl;
      const c = Math.floor((100 - Math.floor(pl.health)) * 15 * rankDocMult); // recompute on live health
      if (c <= 0 || pl.cash < c) return pl;
      ok = { c };
      return { ...pl, cash: pl.cash - c, health: 100 };
    });
    if (!ok) return;
    addLog("DOC", `Patched up, no questions asked.${rankDocMult < 1 ? " Rank discount applied." : ""}`, `−$${fmt(ok.c)}`);
  };

  const bank = (dir, amtOverride) => {
    const amt = Math.max(0, Math.floor(amtOverride ?? bankAmt));
    if (amt <= 0) return;
    if (dir === "in") {
      let done = false;
      setP((pl) => {
        if (!pl) return pl;
        const a = Math.min(amt, pl.cash); // self-guard: clamped to live cash
        if (a <= 0) return pl;
        const fee = Math.ceil(a * 0.01);
        const tax = Math.ceil(a * 0.01);
        done = { a, fee, tax };
        return { ...pl, cash: pl.cash - a, bank: pl.bank + a - fee - tax };
      });
      if (!done) return;
      recordFee(done.fee); recordTax(done.tax);
      addLog("BANK", `Deposited $${fmt(done.a - done.fee - done.tax)} (2% house take: $${fmt(done.fee + done.tax)}). Banked cash can't be lifted by rivals.`);
    } else {
      let done = false;
      setP((pl) => {
        if (!pl) return pl;
        const a = Math.min(amt, pl.bank); // self-guard: clamped to live bank balance
        if (a <= 0) return pl;
        done = { a };
        return { ...pl, bank: pl.bank - a, cash: pl.cash + a };
      });
      if (!done) return;
      addLog("BANK", `Withdrew $${fmt(done.a)}.`);
    }
  };

  const connect = () => {
    if (p.wallet) return up({ wallet: null });
    const a = fakeAddr();
    up({ wallet: a });
    addLog("SOL", `Wallet connected (simulated Phantom · devnet): ${short(a)}`);
  };

  const swap = async (dir) => {
    if (!p.wallet) return addLog("SOL", "Connect a wallet first.");
    if (dir === "buy") {
      const amt = Math.min(swapAmt, p.cash);
      if (amt < 500) return addLog("SOL", "Minimum swap is $500.");
      const fee = Math.ceil(amt * 0.01);
      const tax = Math.ceil(amt * 0.01);
      const out = await ammSwap("buy", amt - fee - tax);
      if (out === null) return addLog("SOL", "The pool didn't fill that order (storage error). Try again.");
      let paid = false;
      setP((pl) => { if (!pl || pl.cash < amt) return pl; paid = true; return { ...pl, cash: pl.cash - amt, omr: pl.omr + out }; });
      if (!paid) return addLog("SOL", "Swap aborted — insufficient cash after all.");
      recordFee(fee); recordTax(tax);
      addLog("SOL", `Swapped $${fmt(amt)} → ${fmtT(out)} $OMR at market (1% dev cut $${fmt(fee)} + 1% street tax $${fmt(tax)}). Pool price is now $${fmt(ammRef.current.o > 0 ? (ammRef.current.c / ammRef.current.o) : 0)}.`);
    } else {
      const amt = Math.min(swapAmt / Math.max(1, ammPrice), p.omr);
      if (amt <= 0) return addLog("SOL", "Nothing to sell.");
      const gross = await ammSwap("sell", amt);
      if (gross === null) return addLog("SOL", "The pool didn't fill that order (storage error). Try again.");
      const fee = Math.ceil(gross * 0.01);
      const tax = Math.ceil(gross * 0.01);
      let sold = false;
      setP((pl) => { if (!pl || pl.omr < amt) return pl; sold = true; return { ...pl, omr: pl.omr - amt, cash: pl.cash + gross - fee - tax }; });
      if (!sold) return addLog("SOL", "Swap aborted — insufficient $OMR after all.");
      recordFee(fee); recordTax(tax);
      addLog("SOL", `Swapped ${fmtT(amt)} $OMR → $${fmt(gross - fee - tax)} at market (2% house take $${fmt(fee + tax)}).`);
    }
  };

  const buyItem = (it) => {
    if (!p.wallet) return addLog("SOL", "NFT gear requires a connected wallet.");
    if (p.owned.includes(it.id)) return addLog("SYS", "You already own that piece.");
    if (p.omr < it.price) return addLog("SYS", "Not enough $OMR. Hit the swap desk.");
    let ok = false;
    setP((pl) => {
      if (!pl || pl.owned.includes(it.id) || pl.omr < it.price) return pl; // self-guard
      ok = true;
      return { ...pl, omr: pl.omr - it.price, owned: [...pl.owned, it.id] };
    });
    if (!ok) return;
    addLog("NFT", `Minted "${it.name}" → ${short(fakeAddr())} (simulated cNFT)`, `−${it.price} $OMR`);
  };

  const stake = () => {
    if (!p.wallet) return addLog("SOL", "Connect a wallet first.");
    const amt = Math.min(stakeAmt, p.omr);
    if (amt <= 0) return addLog("SYS", "Nothing to stake.");
    let done = false;
    setP((pl) => {
      if (!pl) return pl;
      const a = Math.min(stakeAmt, pl.omr); // self-guard: clamp to live $OMR
      if (a <= 0) return pl;
      done = { a };
      return { ...pl, omr: pl.omr - a, staked: pl.staked + a };
    });
    if (!done) return;
    addLog("SOL", `Staked ${fmtT(done.a)} $OMR in The Vault (demo-accelerated rewards)`);
  };
  const unstake = () => {
    if (p.staked <= 0) return;
    addLog("SOL", `Unstaked ${fmtT(p.staked)} $OMR + ${fmtT(p.rewards)} rewards`);
    up((pl) => ({ omr: pl.omr + pl.staked + pl.rewards, staked: 0, rewards: 0 }));
  };

  const dice = (side) => {
    if (p.jail > 0) return addLog("SYS", "The house doesn't come to lockup.");
    const w = Math.min(wager, p.cash);
    if (w < 10) return addLog("SYS", "Table minimum is $10.");
    const roll = rand(1, 6) + rand(1, 6);
    if (roll === 7) {
      addLog("DICE", "Rolled 7 — push. The table returns your stake.");
      return;
    }
    const win = (side === "over" && roll > 7) || (side === "under" && roll < 7);
    let placed = false;
    setP((pl) => {
      if (!pl) return pl;
      const stake = Math.min(w, pl.cash); // self-guard: clamp to live cash
      if (stake < 10) return pl;
      const rake = win ? Math.ceil(stake * 0.01) : 0;
      const tax = win ? Math.ceil(stake * 0.01) : 0;
      placed = { stake, rake, tax };
      return { ...pl, cash: pl.cash - stake + (win ? stake * 2 - rake - tax : 0) };
    });
    if (!placed) return;
    if (win) { bumpDaily("dice"); recordFee(placed.rake); recordTax(placed.tax); }
    addLog("DICE", `Rolled ${roll} — ${win ? side.toUpperCase() + ` hits (house take: $${fmt(placed.rake + placed.tax)}).` : "house takes it."}`, win ? `+$${fmt(placed.stake - placed.rake - placed.tax)}` : `−$${fmt(placed.stake)}`);
  };

  const postBounty = async (t) => {
    if (t.id === p.id) return addLog("SYS", "Putting a price on your own head? See the Doc about that.");
    if (busyRef.current) return;
    const amt = Math.max(500, Math.floor(bountyAmt));
    const fee = Math.ceil(amt * 0.01);
    const tax = Math.ceil(amt * 0.01);
    if (p.cash < amt + fee + tax) return addLog("SYS", `A bounty costs the amount plus the 2% house take ($${fmt(amt + fee + tax)} total).`);
    busyRef.current = true;
    try {
      let cur = null;
      try {
        const r = await window.storage.get("bty_" + t.id, true);
        if (r?.value) cur = JSON.parse(r.value);
      } catch (e) { /* no existing bounty */ }
      let paid = false;
      setP((pl) => { if (!pl || pl.cash < amt + fee + tax) return pl; paid = true; return { ...pl, cash: pl.cash - amt - fee - tax }; });
      if (!paid) return addLog("SYS", "Bounty aborted — insufficient cash.");
      const doc = { tid: t.id, tn: t.n, amt: (cur?.amt || 0) + amt, by: p.id, t: Date.now() };
      await window.storage.set("bty_" + t.id, JSON.stringify(doc), true);
      recordFee(fee); recordTax(tax);
      setBounties((b) => ({ ...b, [t.id]: doc }));
      addLog("PVP", `💰 Bounty posted on ${t.n}: $${fmt(doc.amt)} total to whoever puts them in the hospital. The whole city can see it.`, `−$${fmt(amt + fee + tax)}`);
    } catch (e) { addLog("SYS", "Bounty didn't post (storage error)."); }
    finally { busyRef.current = false; }
  };

  const attack = async (t) => {
    if (t.id === p.id) return addLog("SYS", "Jumping yourself? See the Doc about your head instead.");
    if (p.jail > 0) return addLog("SYS", "No street work from lockup.");
    if (p.health < 20) return addLog("SYS", "You're in no shape for a fight.");
    if (p.energy < 25) return addLog("SYS", "Need 25 energy to jump someone.");
    if (t.hosp && t.hosp > Date.now()) return addLog("SYS", `${t.n} is under the Doc's care. Even we have rules.`);
    if (t.gid && p.gangId && t.gid === p.gangId) return addLog("SYS", "They're family. Omertà — we don't touch our own.");
    if ((p.ammo || 0) < 5) return addLog("SYS", "A jump takes 5 rounds. The Armory sells boxes; the Workshop rolls them cheaper.");
    let engaged = false;
    setP((pl) => {
      if (!pl || pl.energy < 25 || (pl.ammo || 0) < 5 || pl.jail > 0 || pl.health < 20) return pl; // self-guard
      engaged = true;
      return { ...pl, energy: pl.energy - 25, ammo: (pl.ammo || 0) - 5 };
    });
    if (!engaged) return;
    const ev = cityEventOf(dayOf());
    const war = wars.find((w) => !w.resolved && Date.now() < w.ends && ((w.a.id === p.gangId && w.b.id === t.gid) || (w.b.id === p.gangId && w.a.id === t.gid)));
    const atk = (eff("muscle") + eff("speed") * 0.5 + gunFp * 0.4 + rankAtkBonus) * (p.path === "gun" ? 1.1 : 1) + rand(0, 25);
    const def = (t.m || 5) + (t.s || 5) * 0.5 + (t.fp || 0) * 0.4 + rand(0, 25);
    if (atk > def) {
      const stealPct = (war ? 0.25 : 0.15) + (ev.stealAdd || 0);
      const stolen = Math.min(Math.floor((t.cash || 0) * stealPct), 25000);
      const crates = Math.min(t.cb || 0, rand(1, 3));
      const rival = t.gid && p.gangId && t.gid !== p.gangId;
      let rep = Math.max(3, Math.floor((t.r || 0) * 0.01 * (rival ? 1.5 : 1))) + (rival ? 2 : 0);
      if (war) rep = rep * 2;
      rep = Math.floor(rep * (ev.jumpRep || 1));
      up((pl) => ({ cash: pl.cash + stolen, respect: pl.respect + rep, cb: (pl.cb || 0) + crates }));
      bumpDaily("jump");
      bumpFamilyTask("jump", 1);
      addLog("PVP", war
        ? `⚔ WAR HIT — you jumped ${t.n} of the enemy [${t.g}] family${crates ? ` and took ${crates} crate${crates > 1 ? "s" : ""} off them` : ""}. A hit goes on the board.`
        : `You jumped ${t.n}${rival ? ` of the rival [${t.g}] family` : ""} and emptied their pockets${crates ? `, plus ${crates} crate${crates > 1 ? "s" : ""} of contraband` : ""}. They'll wake up in the hospital.`,
        `+$${fmt(stolen)}${crates ? ` · +${crates} 📦` : ""} · +${rep} rep`);
      if (war) {
        try {
          const r = await window.storage.get("war_" + war.id, true);
          if (r?.value) {
            const wd = JSON.parse(r.value);
            if (wd.a.id === p.gangId) wd.scoreA = (wd.scoreA || 0) + 1; else wd.scoreB = (wd.scoreB || 0) + 1;
            await window.storage.set("war_" + war.id, JSON.stringify(wd), true);
            setWars((ws) => ws.map((x) => (x.id === wd.id ? wd : x)));
          }
        } catch (e) { /* score may not register */ }
      }
      const b = bounties[t.id];
      if (b && b.amt) {
        try {
          // re-read the canonical bounty and refuse to pay if the attacker posted it
          const br = await window.storage.get("bty_" + t.id, true);
          const canon = br?.value ? JSON.parse(br.value) : null;
          if (canon && canon.amt && canon.by !== p.id) {
            await window.storage.delete("bty_" + t.id, true);
            up((pl) => ({ cash: pl.cash + canon.amt }));
            setBounties((prev) => { const n = { ...prev }; delete n[t.id]; return n; });
            addLog("PVP", `💰 Bounty collected — the city paid out on ${t.n}'s head.`, `+$${fmt(canon.amt)}`);
          } else if (canon && canon.by === p.id) {
            addLog("PVP", "The city doesn't pay a bounty you posted yourself. The contract stands for others.");
          }
        } catch (e) { /* someone beat you to the claim */ }
      }
      try {
        const hospUntil = Date.now() + 3 * 60 * 1000;
        // re-read the victim's canonical record so two attackers can't both
        // loot the same stale snapshot; steal a share of CURRENT cash/crates
        let vic = t;
        try {
          const vr = await window.storage.get("pub_" + t.id, true);
          if (vr?.value) vic = JSON.parse(vr.value);
        } catch (e) { /* use snapshot */ }
        const realStolen = Math.min(Math.floor((vic.cash || 0) * stealPct), 25000);
        const realCrates = Math.min(vic.cb || 0, crates);
        // reconcile the attacker's gain to what was actually available
        if (realStolen !== stolen || realCrates !== crates) {
          up((pl) => ({ cash: pl.cash + (realStolen - stolen), cb: Math.max(0, (pl.cb || 0) + (realCrates - crates)) }));
        }
        await window.storage.set("pub_" + t.id, JSON.stringify({ ...vic, cash: Math.max(0, (vic.cash || 0) - realStolen), cb: Math.max(0, (vic.cb || 0) - realCrates), hosp: hospUntil }), true);
        await pushInbox(t.id, { type: "attack", from: p.name, stolen: realStolen, cb: realCrates, dmg: rand(20, 40) });
      } catch (e) { addLog("SYS", "Word of the jump may not have reached them (storage error)."); }
      loadLb();
    } else {
      const dmg = rand(10, 25);
      up((pl) => ({ health: Math.max(1, pl.health - dmg) }));
      addLog("PVP", `${t.n}'s crew saw you coming. You limped away.`, `−${dmg} HP`);
    }
  };

  const createGang = async () => {
    if (p.gangId) return addLog("SYS", "You already have a family.");
    if (level < 5) return addLog("SYS", "Make a name for yourself first — level 5 required to found a family.");
    const name = gName.trim();
    const tag = gTag.trim().toUpperCase();
    if (name.length < 3 || name.length > 24) return addLog("SYS", "Family name must be 3–24 characters.");
    if (!/^[A-Z0-9]{2,4}$/.test(tag)) return addLog("SYS", "Tag must be 2–4 letters or numbers.");
    if (p.cash < 25000) return addLog("SYS", "Founding a family costs $25,000 in pocket cash.");
    if (busyRef.current) return;
    busyRef.current = true;
    const id = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const doc = { id, name, tag, bossId: p.id, bossName: p.name, members: [{ id: p.id, n: p.name }], treasury: 0, created: Date.now() };
    try {
      let paid = false;
      setP((pl) => { if (!pl || pl.gangId || pl.cash < 25000) return pl; paid = true; return { ...pl, cash: pl.cash - 25000, gangId: id, gangTag: tag, gangName: name }; });
      if (!paid) return addLog("SYS", "Couldn't found the family — insufficient cash or already in one.");
      await window.storage.set("gang_" + id, JSON.stringify(doc), true);
      setMyGang(doc);
      setGName(""); setGTag("");
      addLog("FAM", `The ${name} family is founded. Your word is law now.`, "−$25,000");
    } catch (e) { addLog("SYS", "Couldn't register the family (storage error). Try again."); }
    finally { busyRef.current = false; }
  };

  const joinGang = async (g) => {
    if (p.gangId) return addLog("SYS", "Leave your current family first.");
    try {
      const r = await window.storage.get("gang_" + g.id, true);
      if (!r?.value) return addLog("SYS", "That family no longer exists.");
      const doc = JSON.parse(r.value);
      if ((doc.members || []).length >= 20) return addLog("SYS", "That family is full (20 made members max).");
      if (!doc.members.some((m) => m.id === p.id)) doc.members.push({ id: p.id, n: p.name, role: "soldier" });
      await window.storage.set("gang_" + doc.id, JSON.stringify(doc), true);
      up({ gangId: doc.id, gangTag: doc.tag, gangName: doc.name });
      setMyGang(doc);
      addLog("FAM", `You kissed the ring. Welcome to the ${doc.name} family.`);
    } catch (e) { addLog("SYS", "Couldn't join (storage error). Try again."); }
  };

  const leaveGang = async (silent = false) => {
    if (!p.gangId) return;
    try {
      const r = await window.storage.get("gang_" + p.gangId, true);
      if (r?.value) {
        const doc = JSON.parse(r.value);
        doc.members = (doc.members || []).filter((m) => m.id !== p.id);
        if (doc.members.length === 0) {
          await window.storage.delete("gang_" + doc.id, true);
          if (!silent) addLog("FAM", `The ${doc.name} family dies with your departure.`);
        } else {
          if (doc.bossId === p.id) {
            const heir = doc.members.find((m) => m.role === "under") || doc.members[0];
            doc.bossId = heir.id;
            doc.bossName = heir.n;
            doc.members = doc.members.map((m) => (m.id === heir.id ? { ...m, role: undefined } : m));
            if (!silent) addLog("FAM", `${doc.bossName} takes over as boss of ${doc.name}${doc.members.length > 1 ? " — the underboss inherits first, then seniority" : ""}.`);
          }
          await window.storage.set("gang_" + doc.id, JSON.stringify(doc), true);
        }
      }
    } catch (e) { /* best effort */ }
    up({ gangId: null, gangTag: null, gangName: null });
    setMyGang(null);
    if (!silent) addLog("FAM", "You walked away from the family. Some doors don't reopen.");
  };
  leaveGangRef.current = leaveGang;
  addLogRef.current = addLog;

  // AUDIT R2 — single inbox delivery path (was 7 copies of read-modify-write)
  const pushInbox = async (targetId, event) => {
    let inbox = [];
    try { const r = await window.storage.get("inbox_" + targetId, true); if (r?.value) inbox = JSON.parse(r.value); } catch (e) { /* empty inbox */ }
    inbox.push({ ...event, t: Date.now() });
    await window.storage.set("inbox_" + targetId, JSON.stringify(inbox.slice(-20)), true);
  };

  const donate = async () => {
    if (!p.gangId) return;
    if (busyRef.current) return;
    const amt = Math.min(Math.max(0, Math.floor(donateAmt)), Math.floor(p.cash));
    if (amt < 100) return addLog("SYS", "Minimum tribute is $100.");
    busyRef.current = true;
    try {
      const r = await window.storage.get("gang_" + p.gangId, true);
      if (!r?.value) return loadMyGang();
      let paid = false;
      setP((pl) => { if (!pl || pl.cash < amt) return pl; paid = true; return { ...pl, cash: pl.cash - amt }; });
      if (!paid) return addLog("SYS", "Tribute aborted — insufficient cash.");
      const doc = JSON.parse(r.value);
      doc.treasury = (doc.treasury || 0) + amt;
      doc.lifetime = (doc.lifetime || 0) + amt;
      await window.storage.set("gang_" + doc.id, JSON.stringify(doc), true);
      setMyGang(doc);
      bumpDaily("tribute");
      bumpFamilyTask("tribute", amt);
      addLog("FAM", `Tribute paid to the ${doc.name} treasury. It also raises the family's standing for the 12-hour buyback payouts.`, `−$${fmt(amt)}`);
    } catch (e) { addLog("SYS", "Tribute didn't go through (storage error)."); }
    finally { busyRef.current = false; }
  };

  const declareWar = async (g) => {
    if (!myGang || !canCommand) return addLog("SYS", "Only the boss or underboss declares war.");
    if (g.id === p.gangId) return;
    if (wars.some((w) => !w.resolved && Date.now() < w.ends && ((w.a.id === p.gangId && w.b.id === g.id) || (w.b.id === p.gangId && w.a.id === g.id)))) {
      return addLog("SYS", "You're already at war with that family.");
    }
    try {
      const r = await window.storage.get("gang_" + p.gangId, true);
      if (!r?.value) return loadMyGang();
      const doc = JSON.parse(r.value);
      if ((doc.treasury || 0) < 10000) return addLog("SYS", "War takes a $10,000 war chest in the family treasury.");
      doc.treasury -= 10000;
      await window.storage.set("gang_" + doc.id, JSON.stringify(doc), true);
      setMyGang(doc);
      const id = "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const war = {
        id,
        a: { id: doc.id, tag: doc.tag, name: doc.name },
        b: { id: g.id, tag: g.tag, name: g.name },
        scoreA: 0, scoreB: 0,
        started: Date.now(), ends: Date.now() + 30 * 60 * 1000,
        resolved: false,
      };
      await window.storage.set("war_" + id, JSON.stringify(war), true);
      setWars((ws) => [war, ...ws]);
      addLog("WAR", `⚔ War declared on the ${g.name} family. 30 minutes on the clock — every jump on their people is a hit on the board. Winner takes 20% of the loser's treasury.`, "−$10,000 treasury");
    } catch (e) { addLog("SYS", "Couldn't declare war (storage error)."); }
  };

  const claimCheckin = () => {
    let done = false;
    setP((pl) => {
      if (!pl) return pl;
      const day = dayOf();
      if (pl.checkinDay === day) return pl; // self-guard: re-checked against live state
      const newStreak = pl.checkinDay === day - 1 ? (pl.streak || 0) + 1 : Math.max(1, Math.floor((pl.streak || 0) / 2));
      const tier = Math.min(newStreak, 7);
      const lvl = Math.floor(Math.sqrt(pl.respect / 4)) + 1;
      const payout = 250 * lvl + 100 * lvl * tier;
      done = { newStreak };
      return { ...pl, cash: pl.cash + payout, energy: Math.min(50 + lvl * 2 + assetEnergyCap(pl.assets), pl.energy + 20), checkinDay: day, streak: newStreak, checkins: (pl.checkins || 0) + 1 };
    });
    if (!done) return addLog("SYS", "Already checked in today. Come back tomorrow.");
    checkRef();
    addLog("FAM", `Checked in with the family. Streak: ${done.newStreak} day${done.newStreak === 1 ? "" : "s"}${done.newStreak > 7 ? " (bonus caps at 7)" : ""}.`, `+20 energy`);
  };

  const claimJob = (job) => {
    const day = dayOf();
    const preCheck = p.daily && p.daily.day === day ? p.daily : { day, c: {}, claimed: [] };
    if (preCheck.claimed.includes(job.id)) return;
    if ((preCheck.c[job.k] || 0) < job.n) return addLog("SYS", "Contract's not finished yet.");
    let result = false;
    setP((pl) => {
      if (!pl) return pl;
      const d = pl.daily && pl.daily.day === day ? pl.daily : { day, c: {}, claimed: [] };
      if (d.claimed.includes(job.id)) return pl; // self-guard: no double-claim
      if ((d.c[job.k] || 0) < job.n) return pl;
      const claimed = [...d.claimed, job.id];
      const all = dailyJobs(day).every((j) => claimed.includes(j.id));
      const lvl = Math.floor(Math.sqrt(pl.respect / 4)) + 1;
      const payout = 200 * lvl + (all ? 500 * lvl : 0);
      const rep = 5 * lvl + (all ? 15 * lvl : 0);
      result = { all, payout, rep };
      return {
        ...pl,
        cash: pl.cash + payout,
        respect: pl.respect + rep,
        energy: all ? 50 + lvl * 2 + assetEnergyCap(pl.assets) : pl.energy,
        daily: { ...d, claimed },
      };
    });
    if (!result) return;
    if (result.all) {
      (async () => {
        try {
          const r = await window.storage.get("street_tax", true);
          if (r?.value) {
            const doc = JSON.parse(r.value);
            if ((doc.fund || 0) >= 0.5) {
              doc.fund -= 0.5;
              await window.storage.set("street_tax", JSON.stringify(doc), true);
              setStreetTax(doc);
              up((pl) => ({ omr: pl.omr + 0.5 }));
              addLog("FAM", "The event fund covers a little extra in the envelope.", "+0.5 $OMR");
            }
          }
        } catch (e) { /* fund empty or busy */ }
      })();
    }
    addLog("FAM", result.all
      ? `All contracts done — the Don sends a full envelope and a night off. Energy refilled.`
      : `Contract "${job.name}" paid out.`,
      `+$${fmt(result.payout)} · +${result.rep} rep`);
  };

  const doHeist = () => {
    if (p.jail > 0) return addLog("SYS", "The Score doesn't wait for jailbirds.");
    if (p.health < 20) return addLog("SYS", "Not in your condition. See the Doc.");
    let ok = false;
    setP((pl) => {
      if (!pl) return pl;
      if (Date.now() < (pl.heistAt || 0) || pl.jail > 0 || pl.health < 20) return pl; // self-guard
      const lvl = Math.floor(Math.sqrt(pl.respect / 4)) + 1;
      const take = 1200 * lvl + rand(0, 400 * lvl);
      const rep = 8 * lvl;
      ok = { take, rep };
      return { ...pl, cash: pl.cash + take, respect: pl.respect + rep, heistAt: Date.now() + 8 * 3600 * 1000 };
    });
    if (!ok) return;
    bumpDaily("heist");
    addLog("JOB", "THE DAILY SCORE — the family's big job of the day, executed clean. Next one lines up in 8 hours.", `+$${fmt(ok.take)} · +${ok.rep} rep`);
  };

  const buyAsset = (a) => {
    if (p.assets.includes(a.id)) return addLog("SYS", "You already own that.");
    const fee = Math.ceil(a.price * 0.01);
    const tax = Math.ceil(a.price * 0.01);
    if (p.cash < a.price + fee + tax) return addLog("SYS", "Not enough pocket cash (price + 2% house take). The seller doesn't take IOUs.");
    let ok = false;
    setP((pl) => {
      if (!pl || pl.assets.includes(a.id) || pl.cash < a.price + fee + tax) return pl; // self-guard
      ok = true;
      return { ...pl, cash: pl.cash - a.price - fee - tax, assets: [...pl.assets, a.id] };
    });
    if (!ok) return;
    recordFee(fee); recordTax(tax);
    const perk = a.stat ? `+${a.boost} ${a.stat}` : a.energyCap ? `+${a.energyCap} max energy` : a.income ? `$${fmt(a.income)}/min` : "";
    addLog("FAM", `Acquired ${a.name}. ${perk ? `Perk: ${perk}. ` : ""}Net worth is climbing.`, `−$${fmt(a.price + fee + tax)}`);
  };

  const sellAsset = (a) => {
    if (!p.assets.includes(a.id)) return;
    const back = Math.floor(a.price * 0.8);
    const fee = Math.ceil(back * 0.01);
    const tax = Math.ceil(back * 0.01);
    let ok = false;
    setP((pl) => {
      if (!pl || !pl.assets.includes(a.id)) return pl; // self-guard: only pay once
      ok = true;
      return { ...pl, cash: pl.cash + back - fee - tax, assets: pl.assets.filter((id) => id !== a.id) };
    });
    if (!ok) return;
    recordFee(fee); recordTax(tax);
    addLog("FAM", `Sold ${a.name} — quick liquidation, 80 cents on the dollar minus the 2% house take.`, `+$${fmt(back - fee - tax)}`);
  };

  const buyGun = (g) => {
    if (p.guns.includes(g.id)) return addLog("SYS", "You already own that piece.");
    if (p.cash < g.cash) return addLog("SYS", "Not enough pocket cash. The dealer doesn't extend credit.");
    if ((p.cb || 0) < g.crates) return addLog("SYS", `The dealer wants ${g.crates} 📦 of contraband on top of the cash.`);
    let ok = false;
    setP((pl) => {
      if (!pl || pl.guns.includes(g.id) || pl.cash < g.cash || (pl.cb || 0) < g.crates) return pl; // self-guard
      ok = true;
      return { ...pl, cash: pl.cash - g.cash, cb: pl.cb - g.crates, guns: [...pl.guns, g.id], gun: pl.gun || g.id };
    });
    if (!ok) return;
    addLog("FAM", `Bought the ${g.name} off the back of a truck.${!p.gun ? " Equipped." : ""}`, `−$${fmt(g.cash)} · −${g.crates} 📦`);
  };

  const equipGun = (id) => {
    if (id && !p.guns.includes(id)) return;
    up({ gun: id });
    addLog("FAM", id ? `Equipped the ${GUNS.find((g) => g.id === id)?.name}.` : "Going in unarmed. Bold.");
  };

  const craft = (c) => {
    const cost = held.includes("foundry") ? Math.floor(c.cost * 0.75) : c.cost;
    if ((p.cb || 0) < c.cb) return addLog("SYS", `Need ${c.cb} crates of contraband. Jobs and jumps are how you get them.`);
    if (p.cash < cost) return addLog("SYS", "Not enough pocket cash for materials.");
    let ok = false;
    setP((pl) => {
      if (!pl || (pl.cb || 0) < c.cb || pl.cash < cost) return pl; // self-guard
      ok = true;
      return { ...pl, cb: pl.cb - c.cb, cash: pl.cash - cost, inv: { ...pl.inv, [c.id]: (pl.inv[c.id] || 0) + 1 } };
    });
    if (!ok) return;
    bumpDaily("craft");
    addLog("WRK", `Crafted ${c.name} at the Workshop.${held.includes("foundry") ? " Old Foundry discount applied." : ""}`, `−${c.cb} 📦 · −$${fmt(cost)}`);
  };

  const useItem = (c) => {
    if (invCount(p.inv, c.id) <= 0) return;
    up((pl) => {
      const inv = { ...pl.inv, [c.id]: pl.inv[c.id] - 1 };
      const fx = c.fx || {};
      return {
        inv,
        health: fx.hp ? Math.min(100, pl.health + fx.hp) : pl.health,
        energy: fx.en ? Math.min(maxEnergy, pl.energy + fx.en) : pl.energy,
        nerve: fx.nv ? Math.min(maxNerve, pl.nerve + fx.nv) : pl.nerve,
        heat: fx.cool ? Math.max(0, (pl.heat || 0) - fx.cool) : pl.heat,
        jail: fx.jail0 ? 0 : pl.jail,
      };
    });
    addLog("WRK", `Used ${c.name} — ${c.effect}. It's gone now; that's the economy working.`);
  };

  const createListing = async (silentRefresh = true) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const item = sellItem;
      const qty = Math.max(1, Math.floor(sellQty));
      const price = Math.max(1, Math.floor(sellPrice));
      const have = item === "cb" ? (p.cb || 0) : item === "ammo" ? (p.ammo || 0) : invCount(p.inv, item);
      if (have < qty) return addLog("SYS", "You can't sell what you don't have.");
      const itName = item === "cb" ? "Contraband crate" : item === "ammo" ? "Rounds" : CONSUMABLES.find((c) => c.id === item)?.name || item;
      const id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const doc = { id, sid: p.id, sn: p.name, item, name: itName, qty, price, t: Date.now() };
      // escrow inside the updater: abort the whole listing if inventory fell short
      let escrowed = false;
      setP((pl) => {
        if (!pl) return pl;
        const cur = item === "cb" ? (pl.cb || 0) : item === "ammo" ? (pl.ammo || 0) : (pl.inv[item] || 0);
        if (cur < qty) return pl; // self-guard against a concurrent second listing
        escrowed = true;
        if (item === "cb") return { ...pl, cb: pl.cb - qty };
        if (item === "ammo") return { ...pl, ammo: (pl.ammo || 0) - qty };
        return { ...pl, inv: { ...pl.inv, [item]: pl.inv[item] - qty } };
      });
      if (!escrowed) return addLog("SYS", "You can't sell what you don't have.");
      try {
        await window.storage.set("mkt_" + id, JSON.stringify(doc), true);
        addLog("MKT", `Listed ${qty}× ${itName} on the Exchange at $${fmt(price)} each. Goods are held in escrow until sold or cancelled.`);
        if (silentRefresh) loadMarket();
      } catch (e) {
        // storage failed after escrow — refund so goods aren't destroyed
        setP((pl) => pl ? (item === "cb" ? { ...pl, cb: (pl.cb || 0) + qty } : item === "ammo" ? { ...pl, ammo: (pl.ammo || 0) + qty } : { ...pl, inv: { ...pl.inv, [item]: (pl.inv[item] || 0) + qty } }) : pl);
        addLog("SYS", "Listing didn't post (storage error) — goods returned.");
      }
    } finally {
      busyRef.current = false;
    }
  };

  const cancelListing = async (l) => {
    if (l.sid !== p.id) return;
    try {
      await window.storage.delete("mkt_" + l.id, true);
      up((pl) => l.item === "cb"
        ? { cb: (pl.cb || 0) + l.qty }
        : l.item === "ammo"
          ? { ammo: (pl.ammo || 0) + l.qty }
          : { inv: { ...pl.inv, [l.item]: (pl.inv[l.item] || 0) + l.qty } });
      addLog("MKT", `Cancelled your listing — ${l.qty}× ${l.name} returned from escrow.`);
      loadMarket();
    } catch (e) { addLog("SYS", "Couldn't cancel (storage error)."); }
  };

  const buyListing = async (l) => {
    if (l.sid === p.id) return cancelListing(l);
    if (busyRef.current) return;
    const total = l.price * l.qty;
    if (p.cash < total) return addLog("SYS", `That lot costs $${fmt(total)}. Your pockets disagree.`);
    busyRef.current = true;
    try {
      // confirm the listing still exists before paying
      const r = await window.storage.get("mkt_" + l.id, true);
      if (!r?.value) { loadMarket(); return addLog("MKT", "Too slow — someone else took that lot."); }
      await window.storage.delete("mkt_" + l.id, true);
      const fee = Math.ceil(total * 0.01);
      const tax = Math.ceil(total * 0.01);
      let paid = false;
      setP((pl) => {
        if (!pl || pl.cash < total) return pl; // self-guard: don't overspend on a double-fire
        paid = true;
        return {
          ...pl,
          cash: pl.cash - total,
          ...(l.item === "cb"
            ? { cb: (pl.cb || 0) + l.qty }
            : l.item === "ammo"
              ? { ammo: (pl.ammo || 0) + l.qty }
              : { inv: { ...pl.inv, [l.item]: (pl.inv[l.item] || 0) + l.qty } }),
        };
      });
      if (!paid) {
        // couldn't afford after all — put the listing back
        try { await window.storage.set("mkt_" + l.id, JSON.stringify(l), true); } catch (e) {}
        loadMarket();
        return addLog("SYS", "Trade aborted — insufficient cash.");
      }
      recordFee(fee); recordTax(tax);
      bumpDaily("trade");
      // pay the seller through their inbox (minus the 2% house take)
      try {
        await pushInbox(l.sid, { type: "sale", amt: total - fee - tax, what: `${l.qty}× ${l.name}`, to: p.name });
      } catch (e) { /* seller payout may lag */ }
      addLog("MKT", `Bought ${l.qty}× ${l.name} from ${l.sn} for $${fmt(total)} (house take $${fmt(fee + tax)}, paid by the seller).`);
      loadMarket();
    } catch (e) { addLog("SYS", "Trade failed (storage error)."); }
    finally { busyRef.current = false; }
  };

  const seizeDistrict = async (d) => {
    if (!myGang || !canCommand) return addLog("SYS", "Only the boss or underboss seizes turf.");
    if (d.holder?.gid === p.gangId) return addLog("SYS", "You already hold that district.");
    const cost = d.holder ? Math.max(30000, Math.floor((d.garrison || 0) * 1.5)) : 30000;
    try {
      const r = await window.storage.get("gang_" + p.gangId, true);
      if (!r?.value) return loadMyGang();
      const gd = JSON.parse(r.value);
      if ((gd.treasury || 0) < cost) return addLog("SYS", `Seizing ${d.name} takes $${fmt(cost)} from the family treasury. Collect more tribute.`);
      gd.treasury -= cost;
      await window.storage.set("gang_" + p.gangId, JSON.stringify(gd), true);
      setMyGang(gd);
      await window.storage.set("terr_" + d.id, JSON.stringify({ holder: { gid: gd.id, tag: gd.tag, name: gd.name }, garrison: cost, t: Date.now() }), true);
      addLog("WAR", `🏙 ${d.name} seized for the ${gd.name} family — garrison posted at $${fmt(cost)}. Perk live for all members: ${d.perk}. Rivals must outbid at 1.5×.`, `−$${fmt(cost)} treasury`);
      loadTerrs();
    } catch (e) { addLog("SYS", "Seizure failed (storage error)."); }
  };

  const setReferrer = async () => {
    const code = refInput.trim();
    if (!code) return;
    if (p.referredBy) return addLog("SYS", "You already have a mentor. Loyalty matters here.");
    if (level >= 3) return addLog("SYS", "Recruit codes only work for fresh blood — below level 3.");
    if (code === p.id) return addLog("SYS", "Recruiting yourself? The Don already checked.");
    if (!code.startsWith("p") || code.length < 10) return addLog("SYS", "That code doesn't look right. Ask your mentor to copy it exactly.");
    try {
      await window.storage.set("ref_" + code + "_" + p.id, JSON.stringify({ mid: code, rid: p.id, rn: p.name, q: false, t: Date.now() }), true);
      up({ referredBy: code });
      setRefInput("");
      addLog("FAM", "🤝 Mentor registered. Make your bones — level 8, 40 clean jobs, 3 check-in days, $25k net worth — and you both get paid from the event fund.");
    } catch (e) { addLog("SYS", "Couldn't register the code (storage error)."); }
  };

  // Referral qualification: multi-day, multi-system play — behavioral gates,
  // not geographic ones. Production adds device fingerprinting, velocity and
  // referral-graph analysis on the server before any payout.
  const checkRef = () => {
    if (!p.referredBy || p.refPaid) return;
    if (p.agentUsed) return; // agent-driven accounts never trigger recruitment payouts
    const qualified = level >= 8 && ((p.lc || {}).crime || 0) >= 40 && (p.checkins || 0) >= 3 && netWorth >= 25000;
    if (!qualified) return;
    // GRASSROOTS — the recruit is paid too: qualifying should feel like a graduation
    up((pl) => ({ refPaid: true, cash: pl.cash + 5000 }));
    addLog("FAM", "🤝 You made your bones — your recruiter just heard the good news, and the family stipend cleared.", "+$5,000");
    (async () => {
      let funded = false;
      try {
        const r = await window.storage.get("street_tax", true);
        if (r?.value) {
          const d = JSON.parse(r.value);
          if ((d.fund || 0) >= 4) {
            d.fund -= 4;
            await window.storage.set("street_tax", JSON.stringify(d), true);
            setStreetTax(d);
            funded = true;
          }
        }
      } catch (e) { /* fund busy */ }
      up((pl) => ({ cash: pl.cash + 5000, omr: pl.omr + (funded ? 1 : 0) }));
      addLog("FAM", `🤝 You've made your bones as a recruit — signing bonus paid${funded ? " (event fund covered the $OMR)" : ""}.`, `+$5,000${funded ? " · +1 $OMR" : ""}`);
      try {
        const rk = "ref_" + p.referredBy + "_" + p.id;
        const rr = await window.storage.get(rk, true);
        if (rr?.value) { const doc = JSON.parse(rr.value); doc.q = true; await window.storage.set(rk, JSON.stringify(doc), true); }
      } catch (e) { /* roster may lag */ }
      try {
        await pushInbox(p.referredBy, { type: "ref", from: p.name, amt: 10000, omr: funded ? 3 : 0 });
      } catch (e) { /* mentor payout may lag */ }
    })();
  };

  const bumpFamilyTask = async (kind, amount) => {
    if (!p.gangId || amount <= 0) return;
    const wk = weekOf();
    const t = familyTaskOf(wk);
    if (t.key !== kind) return;
    try {
      const r = await window.storage.get("gang_" + p.gangId, true);
      if (!r?.value) return;
      const doc = JSON.parse(r.value);
      if (!doc.task || doc.task.week !== wk) doc.task = { week: wk, prog: 0, done: false };
      if (doc.task.done) return;
      const effGoal = t.goal * Math.max(1, Math.ceil((doc.members || []).length / 4));
      doc.task.prog += amount;
      if (doc.task.prog >= effGoal) {
        doc.task.done = true;
        doc.lifetime = (doc.lifetime || 0) + 15000;
        let funded = false;
        try {
          const fr = await window.storage.get("street_tax", true);
          if (fr?.value) {
            const fd = JSON.parse(fr.value);
            if ((fd.fund || 0) >= 5) { fd.fund -= 5; await window.storage.set("street_tax", JSON.stringify(fd), true); doc.omr = (doc.omr || 0) + 5; setStreetTax(fd); funded = true; }
          }
        } catch (e) { /* fund busy */ }
        await window.storage.set("gang_" + p.gangId, JSON.stringify(doc), true);
        setMyGang(doc);
        addLog("FAM", `📜 Weekly family contract complete: "${t.name}" — +15,000 standing${funded ? " and +5 $OMR to the family reserve from the event fund" : ""}. New contract Monday.`);
      } else {
        await window.storage.set("gang_" + p.gangId, JSON.stringify(doc), true);
        setMyGang(doc);
      }
    } catch (e) { /* progress may lag */ }
  };

  const setRole = async (mid, role) => {
    if (!myGang || myGang.bossId !== p.id) return addLog("SYS", "Only the boss hands out buttons.");
    if (mid === p.id) return;
    try {
      const r = await window.storage.get("gang_" + p.gangId, true);
      if (!r?.value) return;
      const doc = JSON.parse(r.value);
      if (role === "under" && (doc.members || []).some((m) => m.role === "under" && m.id !== mid)) return addLog("SYS", "A family has exactly one underboss.");
      doc.members = (doc.members || []).map((m) => (m.id === mid ? { ...m, role } : m));
      await window.storage.set("gang_" + doc.id, JSON.stringify(doc), true);
      setMyGang(doc);
      const nm = doc.members.find((m) => m.id === mid)?.n;
      addLog("FAM", role === "soldier" ? `${nm} has been demoted to SOLDIER. The family notices these things.` : `${nm} is now ${role === "under" ? "UNDERBOSS — they can declare wars and seize turf" : "CAPO — +5% personal payouts"}.`);
    } catch (e) { addLog("SYS", "Couldn't change the role (storage error)."); }
  };

  // ── AI agent layer ──
  // snapshot(): compact machine-readable game state for agents.
  const snapshot = () => ({
    name: p.name, level, rank: rank.name, prestige: p.prestige || 0,
    cash: Math.floor(p.cash), bank: Math.floor(p.bank), omr: +(+p.omr).toFixed(3),
    energy: Math.floor(p.energy), maxEnergy, nerve: Math.floor(p.nerve), maxNerve,
    health: Math.floor(p.health), jailSeconds: Math.ceil(p.jail),
    contraband: p.cb || 0, inventory: p.inv || {},
    stats: { muscle: eff("muscle"), cunning: eff("cunning"), speed: eff("speed") },
    gunEquipped: gunObj?.id || null, gunsOwned: p.guns, racketsOwned: p.rackets, assetsOwned: p.assets,
    heistReady: Date.now() >= (p.heistAt || 0), checkinDone: p.checkinDay === dayOf(),
    dailyContracts: dailyJobs(dayOf()).map((j) => {
      const d = p.daily && p.daily.day === dayOf() ? p.daily : { c: {}, claimed: [] };
      return { id: j.id, name: j.name, progress: Math.min(d.c[j.k] || 0, j.n), needed: j.n, claimed: d.claimed.includes(j.id) };
    }),
    omrPrice: Math.floor(ammPrice), cityEvent: cityEventOf(dayOf()).id,
    ammo: p.ammo || 0, location: p.loc, cargo: p.cargo || {}, cargoCapacity: cargoCapacity(p.assets),
    cityPrices: Object.fromEntries(DISTRICTS.map((d) => [d.id, Object.fromEntries(GOODS.map((g) => [g.id, priceOf(g.id, d.id)]))])),
    targets: (lb || []).filter((r) => r.id !== p.id && !(r.hosp > Date.now()) && !(r.gid && p.gangId && r.gid === p.gangId)).slice(0, 5)
      .map((r) => ({ id: r.id, name: r.n, pocketCash: r.cash || 0, muscle: r.m || 5, speed: r.s || 5, firepower: r.fp || 0 })),
  });

  // act(): the single dispatcher agents use. Same rules as human play —
  // every action runs through the exact same functions and guards.
  const agentAct = (nm, params = {}) => {
    switch (nm) {
      case "crime": { const c = CRIMES.find((x) => x.id === params.id); if (c) doCrime(c); return c ? `crime:${c.id}` : "unknown crime"; }
      case "train": { const s = ["muscle", "cunning", "speed"].includes(params.stat) ? params.stat : "muscle"; train(s); return `train:${s}`; }
      case "heist": doHeist(); return "heist";
      case "checkin": claimCheckin(); return "checkin";
      case "claim": { const j = dailyJobs(dayOf()).find((x) => x.id === params.id); if (j) claimJob(j); return `claim:${params.id}`; }
      case "craft": { const c = CONSUMABLES.find((x) => x.id === params.id); if (c) craft(c); return `craft:${params.id}`; }
      case "use": { const c = CONSUMABLES.find((x) => x.id === params.id); if (c) useItem(c); return `use:${params.id}`; }
      case "bank": bank(params.dir === "out" ? "out" : "in", Math.max(0, +params.amount || 0)); return "bank";
      case "buyRacket": { const r = RACKETS.find((x) => x.id === params.id); if (r) buyRacket(r); return `buyRacket:${params.id}`; }
      case "buyGun": { const g = GUNS.find((x) => x.id === params.id); if (g) buyGun(g); return `buyGun:${params.id}`; }
      case "equipGun": equipGun(params.id || null); return "equipGun";
      case "attack": { const t = (lb || []).find((r) => r.id === params.id); if (t) attack(t); return `attack:${params.id}`; }
      case "travel": { travel(params.district); return `travel:${params.district}`; }
      case "buyGood": { buyGood(params.id, Math.max(1, +params.qty || 1)); return `buyGood:${params.id}`; }
      case "sellGood": { sellGood(params.id, Math.max(1, +params.qty || 1)); return `sellGood:${params.id}`; }
      case "buyAmmo": buyAmmo(); return "buyAmmo";
      case "gta": boostCar(); return "gta";
      case "melt": { const i = Math.max(0, Math.floor(+params.index || 0)); meltCar(i); return `melt:${i}`; }
      case "cook": { const d = drugOf(params.drug) || DRUGS[0]; if (p.batch && Date.now() >= p.batch.doneAt) { collectBatch(); return "collect"; } startBatch(d, Math.max(1, +params.qty || 10)); return `cook:${d.id}`; }
      case "deal": { const d = drugOf(params.drug) || DRUGS.find((x) => ((p.stash || {})[x.id]?.n || 0) > 0); if (!d) return "deal:none"; dealProduct(d, Math.max(1, +params.qty || 10)); return `deal:${d.id}`; }
      case "layLow": layLow(); return "layLow";
      case "rest": return "rest";
      default: return "unknown action";
    }
  };

  const AGENT_ACTIONS_DOC = `Actions (respond with EXACTLY one):
{"action":"crime","params":{"id":"pick|stereo|numbers|shake|truck|poker|torch|armored|vaultjob"}} — needs nerve & health>=20 & not jailed; higher ids need higher level
{"action":"train","params":{"stat":"muscle|cunning|speed"}} — 10 energy
{"action":"heist"} — only if heistReady
{"action":"checkin"} — only if !checkinDone
{"action":"claim","params":{"id":"<contract id>"}} — only if progress>=needed & !claimed
{"action":"craft","params":{"id":"medkit|shot|courage|getaway"}} — costs contraband+cash
{"action":"use","params":{"id":"medkit|shot|courage|getaway"}} — medkit heals 50, shot +25 energy, courage +6 nerve, getaway leaves jail
{"action":"bank","params":{"dir":"in|out","amount":N}} — banked cash is safe from PvP (2% deposit take)
{"action":"buyRacket","params":{"id":"laundro|pawn|parlor|chop|speak|floor"}} — passive income
{"action":"buyGun","params":{"id":"pocket22|alleycat|argument|doorbell|orchestra"}} / {"action":"equipGun","params":{"id":...}}
{"action":"attack","params":{"id":"<target id>"}} — 25 energy + 5 rounds, steals pocket cash
{"action":"travel","params":{"district":"docks|neon|foundry|brick|canal|cathedral"}} — $250 a ride
{"action":"buyGood","params":{"id":"gin|cigars|shine","qty":N}} — buy trade goods at your location (trunk capacity applies)
{"action":"sellGood","params":{"id":"gin|cigars|shine","qty":N}} — sell trade goods at your location; check cityPrices for spreads
{"action":"buyAmmo"} — box of 50 rounds, $2,000
{"action":"rest"} — do nothing this turn`;

  const agentTurn = async () => {
    try {
      // read state and dispatch through apiRef — refreshed every render —
      // so each turn sees CURRENT state, not the closure from turn one
      const state = apiRef.current.snapshot();
      const prompt = `You are THE CONSIGLIERE, an autonomous agent playing the mafia RPG OMERTÀ. Play one turn well: build cash safely, complete daily contracts, keep health up, bank surplus cash, and only fight targets you can beat (your muscle+speed+firepower vs theirs). Current state:\n${JSON.stringify(state)}\n\n${AGENT_ACTIONS_DOC}\n\nRespond ONLY with JSON: {"action":"...","params":{...},"reason":"<8 words max>"} — no other text.`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await resp.json();
      const text = (data.content || []).filter((i) => i.type === "text").map((i) => i.text).join("\n");
      const clean = text.replace(/```json|```/g, "").trim();
      const d = JSON.parse(clean);
      setAgentThought(`${d.action}${d.params?.id ? " → " + d.params.id : ""} — ${d.reason || ""}`);
      addLog("AGT", `🤖 Consigliere: ${d.action}${d.params?.id ? " (" + d.params.id + ")" : ""}${d.reason ? " — " + d.reason : ""}`);
      apiRef.current.act(d.action, d.params || {});
      return true;
    } catch (e) {
      addLog("AGT", "🤖 Consigliere lost the thread (parse/API error). Stopping.");
      return false;
    }
  };

  const startAgent = () => {
    if (agentOn) { agentOnRef.current = false; setAgentOn(false); addLog("AGT", "🤖 Consigliere dismissed. You're driving."); return; }
    up({ agentUsed: true });
    agentOnRef.current = true;
    setAgentOn(true);
    setAgentTurns(0);
    addLog("AGT", "🤖 The Consigliere takes the wheel — one decision every ~8 seconds, 25 turns max. Your account is now flagged as agent-driven.");
    loadLb(); // make sure the agent can see attackable targets from turn one
    (async () => {
      for (let i = 0; i < 25; i++) {
        if (!agentOnRef.current) break;
        const ok = await agentTurn();
        setAgentTurns(i + 1);
        if (!ok) break;
        await new Promise((res) => setTimeout(res, 8000));
      }
      agentOnRef.current = false;
      setAgentOn(false);
    })();
  };

  // ── Trade runs & ammo ──
  const districtPriceMult = (districtId, side) => {
    const heldByUs = terrs.some((t) => t.id === districtId && t.holder?.gid && p.gangId && t.holder.gid === p.gangId);
    if (!heldByUs) return 1;
    return side === "buy" ? 0.95 : 1.05; // family turf: better prices both ways
  };

  const travel = (districtId) => {
    const d = DISTRICTS.find((x) => x.id === districtId);
    if (!d) return;
    if (p.loc === districtId) return addLog("SYS", "You're already standing there.");
    if (p.jail > 0) return addLog("SYS", "The county provides no transportation.");
    if (p.cash < TRAVEL_COST) return addLog("SYS", `A ride across town runs $${fmt(TRAVEL_COST)}.`);
    let ok = false;
    setP((pl) => {
      if (!pl || pl.loc === districtId || pl.jail > 0 || pl.cash < TRAVEL_COST) return pl; // self-guard
      ok = true;
      return { ...pl, cash: pl.cash - TRAVEL_COST, loc: districtId };
    });
    if (!ok) return;
    addLog("JOB", `Rode over to ${d.name}. Different streets, different prices.`, `−$${fmt(TRAVEL_COST)}`);
  };

  const buyGood = (goodId, qty) => {
    const g = GOODS.find((x) => x.id === goodId);
    if (!g) return;
    const n = Math.max(1, Math.floor(qty));
    const cap = cargoCapacity(p.assets);
    if (cargoCount(p.cargo) + n > cap) return addLog("SYS", `The trunk holds ${cap} units total. Better Wheels carry more.`);
    const unit = Math.round(priceOf(goodId, p.loc) * districtPriceMult(p.loc, "buy"));
    const cost = unit * n;
    const fee = Math.ceil(cost * 0.01);
    const tax = Math.ceil(cost * 0.01);
    let ok = false;
    setP((pl) => {
      if (!pl) return pl;
      if (cargoCount(pl.cargo) + n > cargoCapacity(pl.assets)) return pl; // self-guard: trunk cap
      if (pl.cash < cost + fee + tax) return pl; // self-guard: funds
      ok = true;
      return { ...pl, cash: pl.cash - cost - fee - tax, cargo: { ...pl.cargo, [goodId]: (pl.cargo[goodId] || 0) + n } };
    });
    if (!ok) return addLog("SYS", `${n}× ${g.name} won't fit or you're short the $${fmt(cost + fee + tax)}.`);
    recordFee(fee); recordTax(tax);
    addLog("MKT", `Bought ${n}× ${g.name} at $${fmt(unit)} in ${DISTRICTS.find((d) => d.id === p.loc)?.name}.`, `−$${fmt(cost + fee + tax)}`);
  };

  const sellGood = (goodId, qty) => {
    const g = GOODS.find((x) => x.id === goodId);
    if (!g) return;
    const unit = Math.round(priceOf(goodId, p.loc) * districtPriceMult(p.loc, "sell") * (cityEventOf(dayOf()).tradeMult || 1) * (p.path === "ledger" ? 1.05 : 1));
    let sold = 0;
    setP((pl) => {
      if (!pl) return pl;
      const have = pl.cargo[goodId] || 0;
      const n = Math.min(Math.max(1, Math.floor(qty)), have); // self-guard: can't oversell live stock
      if (n <= 0) return pl;
      sold = n;
      const gross = unit * n;
      const fee = Math.ceil(gross * 0.01);
      const tax = Math.ceil(gross * 0.01);
      sold = { n, net: gross - fee - tax, fee, tax };
      return { ...pl, cash: pl.cash + gross - fee - tax, cargo: { ...pl.cargo, [goodId]: Math.max(0, have - n) } };
    });
    if (!sold || !sold.n) return addLog("SYS", "Nothing of that in the trunk.");
    bumpDaily("goods");
    recordFee(sold.fee); recordTax(sold.tax);
    addLog("MKT", `Moved ${sold.n}× ${g.name} at $${fmt(unit)} in ${DISTRICTS.find((d) => d.id === p.loc)?.name}.`, `+$${fmt(sold.net)}`);
  };

  const buyAmmo = () => {
    if (p.cash < 2000) return addLog("SYS", "A box of 50 rounds runs $2,000 cash.");
    let ok = false;
    setP((pl) => { if (!pl || pl.cash < 2000) return pl; ok = true; return { ...pl, cash: pl.cash - 2000, ammo: (pl.ammo || 0) + 50 }; });
    if (!ok) return;
    addLog("FAM", "Bought a box of rounds off the Armory counter.", "−$2,000 · +50 🔸");
  };

  const craftAmmo = () => {
    if ((p.cb || 0) < 1) return addLog("SYS", "Rolling rounds takes 1 crate of contraband.");
    if (p.cash < 400) return addLog("SYS", "Rolling rounds takes $400 in materials.");
    let ok = false;
    setP((pl) => { if (!pl || (pl.cb || 0) < 1 || pl.cash < 400) return pl; ok = true; return { ...pl, cb: pl.cb - 1, cash: pl.cash - 400, ammo: (pl.ammo || 0) + 30 }; });
    if (!ok) return;
    addLog("WRK", "Rolled 30 rounds at the Workshop bench.", "−1 📦 · −$400 · +30 🔸");
  };

  // ── THE GARAGE — boost, repair, fence, melt ──
  const boostCar = () => {
    if (p.jail > 0) return addLog("SYS", "No boosting from lockup.");
    if (Date.now() < (p.gtaAt || 0) + GTA_CD_MS) return addLog("SYS", `The heat's still on — wait ${Math.ceil(((p.gtaAt || 0) + GTA_CD_MS - Date.now()) / 1000)}s between boosts.`);
    if ((p.cars || []).length >= GARAGE_CAP) return addLog("SYS", `The garage holds ${GARAGE_CAP}. Melt or fence something first.`);
    if (p.energy < 10) return addLog("SYS", "Boosting takes 10 energy.");
    const chance = Math.min(0.9, 0.35 + eff("speed") * 0.01 + eff("cunning") * 0.005 + (cityEventOf(dayOf()).boostAdd || 0));
    const success = Math.random() < chance;
    const model = success ? rollCar() : null;
    const trim = success ? rollTrim() : null;
    const dmg = success ? rand(0, 60) : 0;
    const stint = success ? 0 : rand(15, 30);
    let ok = false;
    setP((pl) => {
      if (!pl || pl.energy < 10 || pl.jail > 0 || Date.now() < (pl.gtaAt || 0) + GTA_CD_MS || (pl.cars || []).length >= GARAGE_CAP) return pl; // self-guard
      ok = true;
      return success
        ? { ...pl, energy: pl.energy - 10, gtaAt: Date.now(), cars: [...(pl.cars || []), { id: model.id, dmg, trim: trim.id }] }
        : { ...pl, energy: pl.energy - 10, gtaAt: Date.now(), jail: stint };
    });
    if (!ok) return;
    if (success) {
      bumpDaily("gta");
      bumpFamilyTask("gta", 1);
      addLog("JOB", `🚗 Boosted a ${(trim.name ? trim.name + " " : "")}${model.name} (${dmg}% damage).${model.rare ? " That's rare iron — melts hot, repairs badly." : ""}${trim.id === "bespoke" ? " Coachbuilt — one of one." : ""}`);
    } else addLog("HEAT", `A prowl car rolled up mid-boost. ${stint} seconds in county.`);
  };

  const meltCar = (idx) => {
    const car = (p.cars || [])[idx];
    const model = car && carOf(car.id);
    if (!model) return;
    const yieldRounds = carMelt(car);
    const tithe = p.gangId ? Math.floor(yieldRounds * MELT_TITHE) : 0;
    const keep = yieldRounds - tithe;
    let ok = false;
    setP((pl) => {
      if (!pl || !(pl.cars || [])[idx]) return pl;
      ok = true;
      return { ...pl, cars: pl.cars.filter((_, i) => i !== idx), ammo: (pl.ammo || 0) + keep };
    });
    if (!ok) return;
    bumpDaily("melt");
    bumpFamilyTask("melt", yieldRounds);
    addLog("WRK", `🔥 Melted the ${carName(car)} down to ${keep} rounds${tithe ? ` — ${tithe} rounds tithed to the family armory` : ""}.`, `+${keep} 🔸`);
    if (tithe && p.gangId) {
      (async () => {
        try {
          const r = await window.storage.get("gang_" + p.gangId, true);
          if (r?.value) {
            const gd = JSON.parse(r.value);
            gd.treasury = (gd.treasury || 0) + tithe * TITHE_ROUND_VALUE;
            await window.storage.set("gang_" + p.gangId, JSON.stringify(gd), true);
          }
        } catch (e) { /* tithe may not register */ }
      })();
    }
  };

  const repairCar = (idx) => {
    const car = (p.cars || [])[idx];
    const model = car && carOf(car.id);
    if (!model) return;
    if ((car.dmg || 0) <= 0) return addLog("SYS", "Not a scratch on it.");
    const cost = Math.max(50, Math.floor((car.dmg / 100) * carVal(car) * 0.2));
    if (p.cash < cost) return addLog("SYS", `The shop wants $${fmt(cost)} for that job.`);
    const chance = Math.max(0.05, ((model.rare ? 50 : 100) - car.dmg) / 100); // rare iron repairs badly
    const fixed = Math.random() < chance; // AUDIT R4 — rolled outside the updater
    let res = null;
    setP((pl) => {
      if (!pl || pl.cash < cost || !(pl.cars || [])[idx]) return pl;
      res = fixed;
      return { ...pl, cash: pl.cash - cost, cars: pl.cars.map((c, i) => (i === idx && fixed ? { ...c, dmg: 0 } : c)) };
    });
    if (res === null) return;
    addLog(res ? "WRK" : "SYS", res ? `🔧 The ${carName(car)} rolls out clean.` : `The shop took your $${fmt(cost)} and made it worse. ${model.rare ? "Rare iron is like that." : "Some mechanics."}`, `−$${fmt(cost)}`);
  };

  const fenceCar = (idx) => {
    const car = (p.cars || [])[idx];
    const model = car && carOf(car.id);
    if (!model) return;
    const gross = Math.floor(carVal(car) * 0.5 * (1 - (car.dmg || 0) / 100) * (cityEventOf(dayOf()).fenceMult || 1));
    const fee = Math.ceil(gross * 0.01);
    const tax = Math.ceil(gross * 0.01);
    let ok = false;
    setP((pl) => {
      if (!pl || !(pl.cars || [])[idx]) return pl;
      ok = true;
      return { ...pl, cash: pl.cash + gross - fee - tax, cars: pl.cars.filter((_, i) => i !== idx) };
    });
    if (!ok) return;
    recordFee(fee); recordTax(tax);
    addLog("MKT", `Fenced the ${carName(car)}, no questions either direction.`, `+$${fmt(gross - fee - tax)}`);
  };

  const buyVest = (v) => {
    if (p.vest === v.id) return addLog("SYS", "You're already wearing it.");
    if (p.omr < v.omr) return addLog("SYS", `The ${v.name} runs ${v.omr} $OMR — swap desk is in the Vault.`);
    let ok = false;
    setP((pl) => { if (!pl || pl.omr < v.omr) return pl; ok = true; return { ...pl, omr: pl.omr - v.omr, vest: v.id }; });
    if (!ok) return;
    addLog("FAM", `🦺 Fitted for a ${v.name}. It'll now take ${v.mult}× the rounds to finish you. Doesn't survive you, though.`, `−${v.omr} $OMR`);
  };

  // ── HIT CONTRACTS — search, travel, open fire ──
  const startSearch = (t) => {
    if (t.id === p.id) return addLog("SYS", "You know where you are.");
    if (t.gid && p.gangId && t.gid === p.gangId) return addLog("SYS", "They're family. Omertà.");
    if (p.search && Date.now() < p.search.at + SEARCH_MS) return addLog("SYS", `Your people are already out looking for ${p.search.tn}.`);
    up({ search: { tid: t.id, tn: t.n, at: Date.now() } });
    addLog("HEAT", `🔍 Put the word out on ${t.n}. Your people need ${Math.round(SEARCH_MS / 60000)} minutes to place them (production: 3 hours).`);
  };

  const callOffSearch = () => { up({ search: null }); addLog("SYS", "Called the boys home. The contract is off."); };

  const whack = async () => {
    const s = p.search;
    if (!s) return;
    if (Date.now() < s.at + SEARCH_MS) return addLog("SYS", "They haven't been placed yet. Patience is a caliber.");
    if (p.jail > 0) return addLog("SYS", "No wet work from lockup.");
    if (Date.now() < (p.shootCdAt || 0)) return addLog("SYS", `Your trigger's still hot — ${Math.ceil(((p.shootCdAt || 0) - Date.now()) / 60000)} min before you can fire again.`);
    if (!gunObj) return addLog("SYS", "You need iron equipped for this kind of work — the Armory is in the Market.");
    if (p.energy < 40) return addLog("SYS", "A hit takes 40 energy.");
    const fired = Math.max(MIN_FIRE, Math.floor(fireAmt));
    if ((p.ammo || 0) < fired) return addLog("SYS", `You're calling for ${fmt(fired)} rounds with ${fmt(p.ammo || 0)} on hand. The Garage melts cars into rounds.`);
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      let vic = null;
      try {
        const r = await window.storage.get("pub_" + s.tid, true);
        if (r?.value) vic = JSON.parse(r.value);
      } catch (e) { /* gone quiet */ }
      if (!vic) { addLog("SYS", `${s.tn} has gone to ground — nobody can place them.`); return; }
      if (vic.hosp && vic.hosp > Date.now()) { addLog("SYS", `${s.tn} is under the Doc's care. Even we have rules.`); return; }
      if (vic.gid && p.gangId && vic.gid === p.gangId) { up({ search: null }); addLog("SYS", "They've been made family since you took the contract. It's off."); return; }
      if (vic.loc !== p.loc) {
        addLog("SYS", `${s.tn} was placed in ${DISTRICTS.find((d) => d.id === vic.loc)?.name || "another district"} — you're standing in ${DISTRICTS.find((d) => d.id === p.loc)?.name}. Travel there (City tab), then fire.`);
        return;
      }
      // spend the rounds and the energy — self-guarded against double-fire
      let engaged = false;
      setP((pl) => {
        if (!pl || pl.energy < 40 || (pl.ammo || 0) < fired || pl.jail > 0 || Date.now() < (pl.shootCdAt || 0)) return pl;
        engaged = true;
        return { ...pl, energy: pl.energy - 40, ammo: pl.ammo - fired };
      });
      if (!engaged) return;
      const btk = btkOf(vic.lvl || 1, vic.m || 5, vestMultOf(vic.vest));
      const jammed = Math.random() > (gunObj.rel || 0.9);
      const effective = Math.floor(fired * (0.7 + (gunObj.fp || 0) / 50) * (jammed ? 0.75 : 1) * (p.path === "gun" ? 1.15 : 1));
      if (effective >= btk) {
        // ── THE KILL ──
        const rep = Math.max(10, (vic.lvl || 1) * 2);
        // AUDIT R5 — the victim's real fleet is chopped for cash (40% of its value).
        // No car generation: value transfers, it is never minted.
        const chop = Math.floor((vic.fleetV || 0) * 0.4);
        up((pl) => ({ respect: pl.respect + rep, cash: pl.cash + chop, search: null }));
        // bounty on their head pays out — but never to its own poster
        try {
          const br = await window.storage.get("bty_" + s.tid, true);
          const canon = br?.value ? JSON.parse(br.value) : null;
          if (canon && canon.amt && canon.by !== p.id) {
            await window.storage.delete("bty_" + s.tid, true);
            up((pl) => ({ cash: pl.cash + canon.amt }));
            setBounties((prev) => { const n = { ...prev }; delete n[s.tid]; return n; });
            addLog("PVP", `💰 The city paid out on ${s.tn}'s head.`, `+$${fmt(canon.amt)}`);
          }
        } catch (e) { /* someone beat you to the claim */ }
        // the victim finds out the hard way
        try {
          await pushInbox(s.tid, { type: "whacked", from: p.name });
          await window.storage.set("pub_" + s.tid, JSON.stringify({ ...vic, cash: 0, cb: 0, fleet: 0, fleetV: 0, hosp: Date.now() + 5 * 60 * 1000, t: Date.now() }), true);
        } catch (e) { /* word travels anyway */ }
        // witness statements — up to 3 random players saw something
        try {
          const pool = (lb || []).filter((r) => r.id !== p.id && r.id !== s.tid);
          const picks = pool.sort(() => Math.random() - 0.5).slice(0, 3);
          for (const w of picks) await pushInbox(w.id, { type: "witness", killer: p.name, victim: s.tn });
        } catch (e) { /* no witnesses — cleaner that way */ }
        addLog("HEAT", `☠ ${s.tn.toUpperCase()} SLEEPS WITH THE FISHES. ${fmt(fired)} rounds${jammed ? " (the piece jammed mid-burst — barely enough)" : ""}, ${chop ? `their fleet chopped out for $${fmt(chop)}, ` : ""}and the witnesses saw what they saw. Their wallet and gear survive them — the street didn't.`, `+${rep} rep`);
        loadLb();
      } else {
        // ── THE MISS ──
        up({ shootCdAt: Date.now() + SHOOT_CD_MS });
        try {
          await pushInbox(s.tid, { type: "attempt", from: p.name, dmg: rand(5, 15) });
        } catch (e) { /* they may never know */ }
        addLog("HEAT", `${fmt(fired)} rounds${jammed ? " — and the piece JAMMED —" : ""} and ${s.tn} is still breathing (they were wearing more than a suit). They know your name now. ${Math.round(SHOOT_CD_MS / 60000)} min before you can fire again (production: 2 h).`, `−${fmt(fired)} 🔸`);
      }
    } finally { busyRef.current = false; }
  };

  // ── JAIL BUSTING — spring a stranger, build a reputation ──
  const bust = async (t) => {
    if (t.id === p.id) return addLog("SYS", "Nobody busts themselves out. That's what the Getaway Kit is for.");
    if (p.jail > 0) return addLog("SYS", "You're in the same cage.");
    const remaining = Math.max(0, ((t.jailU || 0) - Date.now()) / 1000);
    if (remaining <= 0) return addLog("SYS", "They already walked.");
    const chance = Math.max(0.1, Math.min(0.9, 0.7 - remaining / 400 + (p.busts || 0) * 0.03 + (cityEventOf(dayOf()).bustAdd || 0)));
    if (Math.random() < chance) {
      const reward = Math.floor(500 + remaining * 15);
      up((pl) => ({ cash: pl.cash + reward, busts: (pl.busts || 0) + 1, respect: pl.respect + 3 }));
      bumpDaily("bust");
      try {
        await pushInbox(t.id, { type: "busted", from: p.name });
        await window.storage.set("pub_" + t.id, JSON.stringify({ ...t, jailU: 0, t: Date.now() }), true);
      } catch (e) { /* the county's paperwork is slow */ }
      addLog("JOB", `⛓ Busted ${t.n} out of lockup — bust #${(p.busts || 0) + 1}. Every bust makes the next one easier.`, `+$${fmt(reward)} · +3 rep`);
      loadLb();
    } else {
      up({ jail: 180 });
      addLog("HEAT", `The bust on ${t.n} went sideways. 180 seconds in county to think it over.`);
    }
  };

  // ── THE KITCHEN — paths, makings, cooking, dealing, heat ──
  const choosePath = (pathId) => {
    const pt = PATHS.find((x) => x.id === pathId);
    if (!pt) return;
    if (p.path === pathId) return addLog("SYS", "That's already your trade.");
    if (level < 5) return addLog("SYS", "Pick a career at level 5. Until then you're everybody's errand boy.");
    if (!p.path) {
      if (p.cash < PATH_FIRST_COST) return addLog("SYS", `Declaring a path costs $${fmt(PATH_FIRST_COST)} — dues, introductions, a suit that fits.`);
      let ok = false;
      setP((pl) => { if (!pl || pl.cash < PATH_FIRST_COST || pl.path) return pl; ok = true; return { ...pl, cash: pl.cash - PATH_FIRST_COST, path: pathId }; });
      if (ok) addLog("FAM", `You've chosen ${pt.name}. ${pt.desc}`, `−$${fmt(PATH_FIRST_COST)}`);
    } else {
      if (p.omr < PATH_SWITCH_OMR) return addLog("SYS", `Changing careers mid-life costs ${PATH_SWITCH_OMR} $OMR. Old reputations are expensive to bury.`);
      let ok = false;
      setP((pl) => { if (!pl || pl.omr < PATH_SWITCH_OMR) return pl; ok = true; return { ...pl, omr: pl.omr - PATH_SWITCH_OMR, path: pathId }; });
      if (ok) addLog("FAM", `New life: ${pt.name}. The old one is somebody else's story now.`, `−${PATH_SWITCH_OMR} $OMR`);
    }
  };

  const buyMakings = (d, n) => {
    const unit = Math.round(makingsPriceOf(d.id) * (cityEventOf(dayOf()).mkMult || 1));
    const cost = unit * n;
    if (tradeRankIdx(p.tradeRep) < d.unlock) return addLog("SYS", `The Supplier doesn't show ${d.name} to a ${TRADE_RANKS[tradeRankIdx(p.tradeRep)].name}. Move more product first.`);
    if (p.cash < cost) return addLog("SYS", `${n} units of ${d.name} makings run $${fmt(cost)} right now.`);
    let ok = false;
    setP((pl) => { if (!pl || pl.cash < cost) return pl; ok = true; return { ...pl, cash: pl.cash - cost, makings: { ...pl.makings, [d.id]: ((pl.makings || {})[d.id] || 0) + n } }; });
    if (ok) addLog("MKT", `The Supplier hands over makings for ${n} units of ${d.name}. Prices drift every 4 hours — buy the dips.`, `−$${fmt(cost)}`);
  };

  const buyKitchen = (k) => {
    const idx = KITCHENS.findIndex((x) => x.id === k.id);
    const curIdx = p.lab ? KITCHENS.findIndex((x) => x.id === p.lab) : -1;
    if (idx !== curIdx + 1) return addLog("SYS", "Kitchens upgrade one tier at a time.");
    if (p.cash < k.cost || p.omr < (k.omr || 0)) return addLog("SYS", `The ${k.name} runs $${fmt(k.cost)}${k.omr ? ` + ${k.omr} $OMR` : ""}.`);
    let ok = false;
    setP((pl) => { if (!pl || pl.cash < k.cost || pl.omr < (k.omr || 0)) return pl; ok = true; return { ...pl, cash: pl.cash - k.cost, omr: pl.omr - (k.omr || 0), lab: k.id }; });
    if (ok) addLog("WRK", `🧪 ${k.name} is operational. ${k.desc}`, `−$${fmt(k.cost)}${k.omr ? ` · −${k.omr} $OMR` : ""}`);
  };

  const startBatch = (d, qty) => {
    const k = kitchenOf(p.lab);
    if (!k) return addLog("SYS", "You need a Kitchen first — even a bathtub.");
    if (p.batch) return addLog("SYS", "The Kitchen's already working. One batch at a time.");
    if (p.jail > 0) return addLog("SYS", "Nothing cooks while you're in county.");
    if (tradeRankIdx(p.tradeRep) < d.unlock) return addLog("SYS", `You don't have the standing to move ${d.name} yet.`);
    const n = Math.max(1, Math.min(qty, k.cap, (p.makings || {})[d.id] || 0));
    if (((p.makings || {})[d.id] || 0) < 1) return addLog("SYS", `No ${d.name} makings on the shelf. See The Supplier.`);
    const crates = Math.ceil(n / 20);
    if ((p.cb || 0) < crates) return addLog("SYS", `Packaging a batch of ${n} takes ${crates} 📦 — product moves in crates like everything else.`);
    let ok = false;
    setP((pl) => {
      if (!pl || pl.batch || ((pl.makings || {})[d.id] || 0) < n || (pl.cb || 0) < crates) return pl;
      ok = true;
      return { ...pl, cb: pl.cb - crates, makings: { ...pl.makings, [d.id]: pl.makings[d.id] - n }, batch: { drug: d.id, qty: n, doneAt: Date.now() + k.mins * 60 * 1000 } };
    });
    if (ok) addLog("WRK", `🧪 ${n} units of ${d.name} on the burner — ready in ${k.mins} min (production: ${(k.mins * 12) / 60} h). Don't let it scorch.`, `−${crates} 📦`);
  };

  const collectBatch = () => {
    const b = p.batch;
    const k = kitchenOf(p.lab);
    const d = b && drugOf(b.drug);
    if (!b || !d || !k) return;
    if (Date.now() < b.doneAt) return addLog("SYS", `Not done. Chemistry doesn't negotiate — ${Math.ceil((b.doneAt - Date.now()) / 60000)} min.`);
    if (Math.random() < k.fire) {
      let ok = false;
      setP((pl) => { if (!pl || !pl.batch) return pl; ok = true; return { ...pl, batch: null, health: Math.max(1, pl.health - 20), heat: Math.min(100, (pl.heat || 0) + 5) }; });
      if (ok) addLog("HEAT", `🔥 THE BATCH CAUGHT. The ${k.name} filled with smoke, you got out with singed cuffs, and the whole block smelled it. Batch lost.`, "−20 HP · +5 heat");
      return;
    }
    const q = Math.min(1.6, Math.max(0.6, 0.7 + eff("cunning") * 0.004 + k.q + (p.path === "kitchen" ? 0.15 : 0) + (Math.random() * 0.2 - 0.1)));
    let ok = false;
    setP((pl) => {
      if (!pl || !pl.batch) return pl;
      ok = true;
      const cur = (pl.stash || {})[b.drug] || { n: 0, q: 1 };
      const nq = (cur.n * cur.q + b.qty * q) / (cur.n + b.qty);
      return { ...pl, batch: null, stash: { ...pl.stash, [b.drug]: { n: cur.n + b.qty, q: nq } } };
    });
    if (!ok) return;
    bumpDaily("cook");
    addLog("WRK", `🧪 ${b.qty} units of ${d.name} off the burner at ${Math.round(q * 100)}% purity${q > 1.3 ? " — the good stuff; the street will talk" : q < 0.8 ? " — a muddy batch; price it accordingly" : ""}.`, `+${b.qty} ${d.name}`);
  };

  const dealProduct = (d, qty) => {
    const s = (p.stash || {})[d.id];
    if (!s || s.n < 1) return addLog("SYS", `No ${d.name} in the stash.`);
    if (p.jail > 0) return addLog("SYS", "No dealing from a cell.");
    const n = Math.max(1, Math.min(qty, s.n));
    const nerveCost = Math.max(1, Math.ceil(n / 10));
    if (p.nerve < nerveCost) return addLog("SYS", `Moving ${n} units takes ${nerveCost} nerve — hand-to-hand is looking strangers in the eye.`);
    const ev = cityEventOf(dayOf());
    const unit = d.base * demandOf(d.id, p.loc) * (s.q || 1) * (ev.drugDemand || 1) * (1 + TRADE_RANKS[tradeRankIdx(p.tradeRep)].bonus);
    const gross = Math.floor(unit * n);
    const fee = Math.ceil(gross * 0.01);
    const tax = Math.ceil(gross * 0.01);
    const heatGain = d.heat * n * 0.1 * (ev.drugHeat || 1) * (p.path === "kitchen" ? 0.75 : 1);
    let ok = false;
    setP((pl) => {
      const ps = (pl.stash || {})[d.id];
      if (!pl || !ps || ps.n < n || pl.nerve < nerveCost) return pl;
      ok = true;
      return { ...pl, nerve: pl.nerve - nerveCost, cash: pl.cash + gross - fee - tax, tradeRep: (pl.tradeRep || 0) + gross, heat: Math.min(100, (pl.heat || 0) + heatGain), stash: { ...pl.stash, [d.id]: { ...ps, n: ps.n - n } } };
    });
    if (!ok) return;
    recordFee(fee); recordTax(tax);
    bumpDaily("deal");
    bumpFamilyTask("deal", n);
    const before = tradeRankIdx(p.tradeRep), after = tradeRankIdx((p.tradeRep || 0) + gross);
    addLog("MKT", `Moved ${n} units of ${d.name} at ${Math.round(demandOf(d.id, p.loc) * 100)}% demand${(s.q || 1) > 1.2 ? ", premium purity" : ""}. Heat +${heatGain.toFixed(1)}.`, `+$${fmt(gross - fee - tax)}`);
    if (after > before) addLog("FAM", `📈 The street has a new name for you: ${TRADE_RANKS[after].name.toUpperCase()}. ${TRADE_RANKS[after].bonus ? `Deals now close ${Math.round(TRADE_RANKS[after].bonus * 100)}% richer,` : ""} and stronger product is on the table.`);
  };

  const layLow = () => {
    if ((p.heat || 0) < 5) return addLog("SYS", "You're already a ghost.");
    if (p.cash < 5000 || p.energy < 25) return addLog("SYS", "Laying low takes $5,000 and 25 energy — motels, favors, and silence.");
    let ok = false;
    setP((pl) => { if (!pl || pl.cash < 5000 || pl.energy < 25) return pl; ok = true; return { ...pl, cash: pl.cash - 5000, energy: pl.energy - 25, heat: Math.max(0, (pl.heat || 0) - 25) }; });
    if (ok) addLog("SYS", "Three days in a motel that doesn't take names. The Bureau's file gets colder.", "−25 heat");
  };

  const cleanPapers = () => {
    if ((p.heat || 0) < 1) return addLog("SYS", "Your papers are already spotless.");
    if (p.omr < 10) return addLog("SYS", "Clean Papers cost 10 $OMR — a man downtown retypes your whole life.");
    let ok = false;
    setP((pl) => { if (!pl || pl.omr < 10) return pl; ok = true; return { ...pl, omr: pl.omr - 10, heat: 0 }; });
    if (ok) addLog("FAM", "📄 A man downtown retypes your life. As far as the Bureau's files go, you were never here.", "−10 $OMR · heat wiped");
  };

  const hireCrew = () => {
    if ((p.crew || 0) >= 5) return addLog("SYS", "Five corners is all one person can keep honest.");
    const cost = 50000 * ((p.crew || 0) + 1);
    if (p.cash < cost) return addLog("SYS", `The next crew member wants $${fmt(cost)} up front.`);
    let ok = false;
    setP((pl) => { if (!pl || pl.cash < cost || (pl.crew || 0) >= 5) return pl; ok = true; return { ...pl, cash: pl.cash - cost, crew: (pl.crew || 0) + 1 }; });
    if (ok) addLog("FAM", `Corner crew is ${(p.crew || 0) + 1} strong. They move ~1 unit/min each from your stash at 80% of local demand — and they generate heat around the clock.`, `−$${fmt(cost)}`);
  };

  // ── GRASSROOTS — claim a First Week task ──
  const claimOnboard = (t) => {
    if ((p.onboard || {})[t.id]) return;
    if (!t.social && !t.check(p)) return addLog("SYS", "Not done yet — the checklist pays on completion.");
    if (t.social) { try { window.open(t.social, "_blank"); } catch (e) { /* popup blocked */ } }
    let ok = false;
    setP((pl) => {
      if (!pl || (pl.onboard || {})[t.id]) return pl;
      ok = true;
      const onboard = { ...(pl.onboard || {}), [t.id]: true };
      const allDone = ONBOARD_TASKS.every((x) => onboard[x.id]);
      return {
        ...pl,
        onboard,
        cash: pl.cash + (t.reward.cash || 0) + (allDone ? ONBOARD_CAPSTONE.cash : 0),
        cb: (pl.cb || 0) + (t.reward.cb || 0) + (allDone ? ONBOARD_CAPSTONE.cb : 0),
        energy: Math.min(maxEnergy, pl.energy + (t.reward.en || 0) + (allDone ? ONBOARD_CAPSTONE.en : 0)),
      };
    });
    if (!ok) return;
    const allNow = ONBOARD_TASKS.every((x) => x.id === t.id || (p.onboard || {})[x.id]);
    addLog("SYS", `✓ First Week: ${t.name}.${t.social ? " (Demo: honor system — production verifies via OAuth.)" : ""}`, `+$${fmt(t.reward.cash || 0)}${t.reward.cb ? ` · +${t.reward.cb} 📦` : ""}${t.reward.en ? ` · +${t.reward.en}⚡` : ""}`);
    if (allNow) addLog("FAM", `🏁 THE FIRST WEEK IS DONE. The city knows your face now. Capstone paid.`, `+$${fmt(ONBOARD_CAPSTONE.cash)} · +${ONBOARD_CAPSTONE.cb} 📦 · +${ONBOARD_CAPSTONE.en}⚡`);
  };

  const resetGame = async () => {
    if (!window.confirm("Burn the books and start over? Your save, leaderboard entry, and family membership are erased — and any goods sitting in Exchange escrow are forfeited.")) return;
    try { if (p.gangId) await leaveGang(true); } catch (e) {}
    try { await window.storage.delete(SAVE_KEY); } catch (e) {}
    try { await window.storage.delete("pub_" + p.id, true); } catch (e) {}
    try { await window.storage.delete("inbox_" + p.id, true); } catch (e) {}
    setP(null); setLog([]); setNameInput(""); setScreen("create");
  };

  const Bar = ({ v, max, color }) => (
    <div style={{ background: "#0D0B09", borderRadius: 2, height: 6, width: "100%" }}>
      <div style={{ width: `${Math.min(100, (v / max) * 100)}%`, background: color, height: 6, borderRadius: 2, transition: "width .4s" }} />
    </div>
  );

  apiRef.current = { snapshot, act: agentAct };

  const tabs = [
    ["daily", "Today"], ["crimes", "Crimes"], ["missions", "Missions"], ["rackets", "Rackets"],
    ["assets", "Assets"], ["garage", "Garage"], ["kitchen", "The Kitchen"], ["shop", "Workshop"], ["exchange", "Exchange"], ["train", "Gym"],
    ["market", "Market"], ["casino", "Back Room"], ["vault", "Vault"], ["board", "Streets"], ["gang", "Family"], ["turf", "City"], ["agent", "Consigliere"],
  ];
  const racketIncome = p.rackets.reduce((a, id) => a + (RACKETS.find(r => r.id === id)?.income || 0), 0) + assetIncome(p.assets);

  return (
    <div className="root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800&family=IBM+Plex+Mono:wght@400;600&display=swap');
        .root{min-height:100vh;background:#14110E;color:#E6DCC8;font-family:'IBM Plex Mono',monospace;padding:16px;max-width:960px;margin:0 auto}
        h1,h2,.disp{font-family:'Big Shoulders Display',sans-serif;letter-spacing:.04em}
        .panel{background:#1C1712;border:1px solid #3A3128;border-radius:6px;padding:14px}
        .btn{background:#241E17;border:1px solid #4A3F32;color:#E6DCC8;padding:8px 14px;border-radius:4px;cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:12px}
        .btn:hover{border-color:#C9A227;color:#C9A227}
        .btn:disabled{opacity:.35;cursor:not-allowed}
        .btn.hot{background:#5A1E1A;border-color:#9E2B25}
        .btn.hot:hover{border-color:#D4453C;color:#fff}
        .tab{background:none;border:none;border-bottom:2px solid transparent;color:#8B8578;padding:8px 2px;cursor:pointer;font-family:'Big Shoulders Display',sans-serif;font-size:16px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
        .tab.on{color:#C9A227;border-bottom-color:#9E2B25}
        .mut{color:#8B8578;font-size:11px}
        .gold{color:#C9A227}.red{color:#D4453C}.grn{color:#8FAE87}
        input{background:#0D0B09;border:1px solid #3A3128;color:#E6DCC8;padding:8px;border-radius:4px;font-family:'IBM Plex Mono',monospace;width:110px}
        .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .lrow{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #2A241D;padding:8px 0;gap:8px;flex-wrap:wrap}
        .ledger{background:#0D0B09;border:1px solid #3A3128;border-radius:6px;height:150px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.7}
        @media (prefers-reduced-motion: reduce){*{transition:none!important}}
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #9E2B25", paddingBottom: 10, marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 800 }}>OMERTÀ<span className="red">.</span></h1>
          <div className="mut">{p.name.toUpperCase()} · <span className="gold">{rank.name}</span>{p.title ? ` · 🩸 ${p.title}` : ""} · LVL {level} · {fmt(p.respect)}/{fmt(nextLvlRespect)} RESPECT · 🔥 {p.streak || 0} · ⭐ {p.prestige || 0} · <span className="gold">{saveState}</span></div>
          <div className="mut">SEASON {seasonOf(dayOf())} · {seasonDaysLeft(dayOf())}D LEFT · NET WORTH: <span className="grn">${fmt(netWorth)}</span></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14 }}>
            <span className="grn">${fmt(p.cash)}</span><span className="mut"> pocket · </span>
            <span className="grn">${fmt(p.bank)}</span><span className="mut"> banked · </span>
            <span className="gold">{fmtT(p.omr)} $OMR</span>
          </div>
          <div className="mut">{racketIncome > 0 ? `rackets pay $${fmt(racketIncome)}/min` : "no rackets yet"}</div>
          <button className="btn" style={{ marginTop: 6 }} onClick={connect}>
            {p.wallet ? `⛓ ${short(p.wallet)} · disconnect` : "⛓ Connect Wallet"}
          </button>
        </div>
      </div>

      {/* Vitals */}
      <div className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 14 }}>
        {[["Health", p.health, 100, "#9E2B25"], ["Energy", p.energy, maxEnergy, "#C9A227"], ["Nerve", p.nerve, maxNerve, "#7A9BAB"]].map(([n, v, m, c]) => (
          <div key={n}>
            <div className="mut" style={{ display: "flex", justifyContent: "space-between" }}><span>{n}</span><span>{Math.floor(v)}/{m}</span></div>
            <Bar v={v} max={m} color={c} />
          </div>
        ))}
        <div>
          <div className="mut">M {eff("muscle")} · C {eff("cunning")} · S {eff("speed")} · 📦 {p.cb || 0} · 🔸 {fmt(p.ammo || 0)} · 🚗 {(p.cars || []).length} · 🔫 {gunObj ? `${gunObj.name} (fp ${gunObj.fp})` : "unarmed"}{p.vest ? ` · 🦺 ${VESTS.find((v) => v.id === p.vest)?.name}` : ""}{p.deaths ? ` · ☠×${p.deaths}` : ""} · 📍 {DISTRICTS.find((d) => d.id === p.loc)?.name}{(p.heat || 0) >= 1 ? <span className={p.heat > 60 ? "red" : "mut"}> · 🌡 heat {Math.round(p.heat)}</span> : null}{stashTotal(p.stash) > 0 ? <span className="mut"> · 🧪 {fmt(stashTotal(p.stash))}</span> : null}</div>
          {p.jail > 0 && <div className="red disp" style={{ fontSize: 18 }}>⛓ LOCKUP — {Math.ceil(p.jail)}s</div>}
          {p.hosp > Date.now() && <div className="gold disp" style={{ fontSize: 14 }}>🏥 UNDER THE DOC'S CARE — rivals can't touch you</div>}
          {p.health < 20 && p.jail <= 0 && <button className="btn hot" style={{ marginTop: 4 }} onClick={heal}>See the Doc (${fmt(Math.floor((100 - Math.floor(p.health)) * 15 * rankDocMult))})</button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="row" style={{ marginBottom: 12, gap: 14 }}>
        {tabs.map(([id, name]) => (
          <button key={id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>{name}</button>
        ))}
      </div>

      {tab === "daily" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Today's business</h2>

          {/* GRASSROOTS — The First Week checklist (hidden once completed) */}
          {!ONBOARD_TASKS.every((t) => (p.onboard || {})[t.id]) && (() => {
            const done = ONBOARD_TASKS.filter((t) => (p.onboard || {})[t.id]).length;
            return (
              <div style={{ border: "1px solid #C9A227", borderRadius: 6, padding: 10, marginBottom: 16 }}>
                <div className="disp gold" style={{ fontSize: 18 }}>THE FIRST WEEK — {done}/{ONBOARD_TASKS.length}</div>
                <div className="mut" style={{ marginBottom: 6 }}>
                  One-time jobs that pay you to learn the city. Finish all nine and the capstone pays ${fmt(ONBOARD_CAPSTONE.cash)} + {ONBOARD_CAPSTONE.cb} 📦 + {ONBOARD_CAPSTONE.en}⚡.
                </div>
                <div style={{ height: 6, background: "#0D0B09", borderRadius: 3, marginBottom: 10 }}>
                  <div style={{ height: 6, width: `${Math.round((done / ONBOARD_TASKS.length) * 100)}%`, background: "#C9A227", borderRadius: 3 }} />
                </div>
                {ONBOARD_TASKS.map((t) => {
                  const claimed = (p.onboard || {})[t.id];
                  const ready = t.social || t.check(p);
                  if (claimed) return null;
                  return (
                    <div key={t.id} className="lrow">
                      <div>
                        <div>{t.name}{t.social && <span className="mut"> · opens link</span>}</div>
                        <div className="mut">{t.desc}</div>
                      </div>
                      <button className={ready ? "btn hot" : "btn"} disabled={!ready} onClick={() => claimOnboard(t)}>
                        {ready ? "Claim" : "Locked"} · ${fmt(t.reward.cash || 0)}{t.reward.cb ? ` + ${t.reward.cb}📦` : ""}{t.reward.en ? ` + ${t.reward.en}⚡` : ""}
                      </button>
                    </div>
                  );
                })}
                <div className="mut" style={{ fontSize: 11, marginTop: 4 }}>Social tasks pay in-game cash only — never $OMR — and are honor-claimed in this build (production verifies).</div>
              </div>
            );
          })()}

          {/* GRASSROOTS — Recruitment desk */}
          <div style={{ border: "1px solid #3A3128", borderRadius: 6, padding: 10, marginBottom: 16 }}>
            <div className="disp gold" style={{ fontSize: 18 }}>THE RECRUITMENT DESK — 🤝×{p.recruits || 0}</div>
            <div className="mut">
              Your recruitment code is <span className="gold">{p.name}</span> — new players enter it at sign-up.
              A recruit counts when they <em>qualify</em>: level 8, 40 clean jobs, 3 check-ins, $25k net worth. You're paid $10,000
              (+3 $OMR when the event fund covers it), they're paid $5,000 for making their bones, and your lifetime count survives death —
              relationships are yours, not the character's.
              {(() => { const next = RECRUIT_MILESTONES.find((m) => m.n > (p.recruits || 0)); return next ? <> Next milestone at <span className="gold">{next.n}</span>: {next.name} (${fmt(next.cash)}{next.omr ? ` + ${next.omr} $OMR` : ""}{next.title ? " + title" : ""}).</> : <> The ladder ends with you — PILLAR OF THE CITY.</>; })()}
            </div>
          </div>

          <div style={{ border: "1px solid #9E2B25", borderRadius: 6, padding: 10, marginBottom: 16, background: "#221410" }}>
            <div className="disp red" style={{ fontSize: 18 }}>TONIGHT IN THE CITY: {cityEventOf(dayOf()).name}</div>
            <div className="mut">{cityEventOf(dayOf()).desc} Rotates daily — the Exchange notices before you do.</div>
          </div>

          <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>CHECK-IN</div>
          <div className="mut" style={{ margin: "4px 0 8px" }}>
            🔥 Streak: {p.streak || 0} day{(p.streak || 0) === 1 ? "" : "s"} · bonus grows to day 7 · miss a day and the streak halves — it never resets to zero.
          </div>
          {p.checkinDay === dayOf() ? (
            <div className="mut">✓ Checked in. Next check-in in {Math.floor(((dayOf() + 1) * 86400000 - Date.now()) / 3600000)}h {Math.floor((((dayOf() + 1) * 86400000 - Date.now()) % 3600000) / 60000)}m.</div>
          ) : (
            <button className="btn hot" onClick={claimCheckin}>Check in with the family</button>
          )}

          <div className="disp" style={{ fontSize: 18, color: "#C9A227", marginTop: 18 }}>THE DAILY SCORE</div>
          <div className="mut" style={{ margin: "4px 0 8px" }}>The family's one big job — guaranteed clean, every 8 hours.</div>
          {Date.now() >= (p.heistAt || 0) ? (
            <button className="btn hot" disabled={p.jail > 0 || p.health < 20} onClick={doHeist}>Run the Score</button>
          ) : (
            <div className="mut">Next job lines up in {Math.floor((p.heistAt - Date.now()) / 3600000)}h {Math.floor(((p.heistAt - Date.now()) % 3600000) / 60000)}m.</div>
          )}

          <div className="disp" style={{ fontSize: 18, color: "#C9A227", marginTop: 18 }}>RECRUITMENT</div>
          <div className="mut" style={{ margin: "4px 0 8px" }}>
            Your recruit code: <span className="gold" style={{ wordBreak: "break-all" }}>{p.id}</span> — share it with new players.
            When a recruit makes their bones (level 8 · 40 clean jobs · 3 check-in days · $25k net worth), you get
            $10,000 + 3 $OMR and they get $5,000 + 1 $OMR, paid from the event fund. The bar is deliberately
            multi-day, real-play behavior — throwaway accounts and bot farms don't qualify, wherever they're from.
          </div>
          {!p.referredBy && level < 3 && (
            <div className="row" style={{ marginBottom: 8 }}>
              <input style={{ width: 220 }} value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="Enter a mentor's code" />
              <button className="btn" onClick={setReferrer}>Register mentor</button>
            </div>
          )}
          {p.referredBy && (
            <div className="mut" style={{ marginBottom: 8 }}>
              Mentor registered. {p.refPaid ? "✓ You've made your bones — bonuses paid." : "Make your bones to trigger both payouts."}
            </div>
          )}
          <div className="mut" style={{ marginBottom: 4 }}>YOUR RECRUITS</div>
          {recruits === null && <div className="mut">checking the books…</div>}
          {recruits && recruits.length === 0 && <div className="mut">No recruits yet. Every made man started as someone's associate.</div>}
          {recruits && recruits.map((r) => (
            <div key={r.rid} className="lrow">
              <div>{r.rn} <span className={r.q ? "grn" : "mut"}>· {r.q ? "✓ made their bones — bonus paid" : "still proving themselves"}</span></div>
            </div>
          ))}

          <div className="disp" style={{ fontSize: 18, color: "#C9A227", marginTop: 18 }}>TODAY'S CONTRACTS</div>
          <div className="mut" style={{ margin: "4px 0 4px" }}>
            Three contracts, fresh every day. Finish all three and the Don sends a bonus envelope plus a full energy refill.
            Resets in {Math.floor(((dayOf() + 1) * 86400000 - Date.now()) / 3600000)}h.
          </div>
          {dailyJobs(dayOf()).map((j) => {
            const d = p.daily && p.daily.day === dayOf() ? p.daily : { c: {}, claimed: [] };
            const prog = Math.min(d.c[j.k] || 0, j.n);
            const done = d.claimed.includes(j.id);
            return (
              <div key={j.id} className="lrow">
                <div>
                  <div>{done ? "✓ " : ""}{j.name}</div>
                  <div className="mut">{prog}/{j.n} · pays ${fmt(200 * level)} · +{5 * level} rep</div>
                </div>
                <button className="btn" disabled={done || prog < j.n} onClick={() => claimJob(j)}>
                  {done ? "Paid" : prog < j.n ? "In progress" : "Collect"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "crimes" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Jobs on the board</h2>
          {CRIMES.map((c) => {
            const locked = level < c.lvl;
            return (
              <div key={c.id} className="lrow">
                <div>
                  <div style={{ opacity: locked ? 0.4 : 1 }}>{c.name}</div>
                  <div className="mut">{locked ? `unlocks at level ${c.lvl}` : `nerve ${c.nerve} · pays $${fmt(c.cash[0])}–$${fmt(c.cash[1])} · rep +${c.respect}`}</div>
                </div>
                <button className="btn hot" disabled={locked || p.jail > 0 || p.nerve < c.nerve || p.health < 20} onClick={() => doCrime(c)}>Do it</button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "missions" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Career Ladder</h2>
          <p className="mut">Ten ranks from the gutter to the throne. Each rank's perk is permanent while you hold it or anything above it. Respect resets each season, so the climb itself is the game.</p>
          {RANKS.map((rk) => (
            <div key={rk.name} className="lrow" style={{ opacity: level >= rk.lvl ? 1 : 0.45 }}>
              <div>
                <div>
                  {level >= rk.lvl ? "✓ " : ""}{rk.name}
                  {rank.name === rk.name && <span className="red"> ← you</span>}
                </div>
                <div className="mut">level {rk.lvl}{rk.lvl > 1 ? "+" : ""} · {rk.perk}</div>
              </div>
              {level < rk.lvl && <div className="mut">{fmt(Math.max(0, Math.pow(rk.lvl - 1, 2) * 4 - p.respect))} rep to go</div>}
            </div>
          ))}

          <h2 style={{ marginTop: 20 }}>Make your bones</h2>
          <p className="mut">One-time jobs from the family. Finish all five and you sit at the table.</p>
          {MISSIONS.map((m, i) => {
            const done = p.missions.includes(m.id);
            const prevDone = i === 0 || p.missions.includes(MISSIONS[i - 1].id);
            const reqStr = Object.entries(m.req).map(([k, v]) => `${k === "lvl" ? "level" : k === "fp" ? "firepower" : k} ${v}`).join(" · ");
            return (
              <div key={m.id} className="lrow" style={{ opacity: prevDone ? 1 : 0.35 }}>
                <div style={{ maxWidth: 560 }}>
                  <div>{done ? "✓ " : ""}{m.name} {m.title && <span className="gold">→ {m.title}</span>}</div>
                  <div className="mut">{prevDone ? m.brief : "Complete the previous job first."}</div>
                  <div className="mut">needs {reqStr} · pays ${fmt(m.reward.cash)} · +{m.reward.respect} rep{m.reward.omr ? ` · +${m.reward.omr} $OMR` : ""}</div>
                </div>
                <button className="btn hot" disabled={done || !prevDone} onClick={() => doMission(m)}>{done ? "Done" : "Take the job"}</button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "rackets" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Rackets — the family's real money</h2>
          <p className="mut">Businesses pay out every few seconds, even while you're away (up to 8 hours). Bought with pocket cash.</p>
          {RACKETS.map((r) => {
            const ownedR = p.rackets.includes(r.id);
            const locked = level < r.lvl;
            return (
              <div key={r.id} className="lrow">
                <div>
                  <div style={{ opacity: locked && !ownedR ? 0.4 : 1 }}>{ownedR ? "✓ " : ""}{r.name}</div>
                  <div className="mut">{r.desc} · ${fmt(r.income)}/min {locked && !ownedR ? `· unlocks at level ${r.lvl}` : ""}</div>
                </div>
                <button className="btn" disabled={ownedR || locked || p.cash < r.cost} onClick={() => buyRacket(r)}>
                  {ownedR ? "Owned" : `Buy · $${fmt(r.cost)}`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "assets" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Assets — build your net worth</h2>
          <p className="mut">
            Cars sharpen your speed, property raises your energy ceiling, and legit fronts pay steady income.
            Everything you own counts toward your net worth (currently <span className="grn">${fmt(netWorth)}</span>),
            visible to every player on the Streets. Sell anytime at 80 cents on the dollar.
          </p>
          {["Wheels", "Property", "Legit Fronts"].map((cat) => (
            <div key={cat}>
              <div className="disp" style={{ fontSize: 18, color: "#C9A227", marginTop: 14 }}>{cat.toUpperCase()}</div>
              {ASSETS.filter((a) => a.cat === cat).map((a) => {
                const has = p.assets.includes(a.id);
                const perk = a.stat ? `+${a.boost} ${a.stat}` : a.energyCap ? `+${a.energyCap} max energy` : `$${fmt(a.income)}/min`;
                return (
                  <div key={a.id} className="lrow">
                    <div>
                      <div>{has ? "✓ " : ""}{a.name}</div>
                      <div className="mut">{a.desc} · {perk}</div>
                    </div>
                    <div className="row">
                      {has ? (
                        <button className="btn" onClick={() => sellAsset(a)}>Sell · ${fmt(Math.floor(a.price * 0.8))}</button>
                      ) : (
                        <button className="btn" disabled={p.cash < a.price} onClick={() => buyAsset(a)}>Buy · ${fmt(a.price)}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {tab === "garage" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Garage — where cars become bullets</h2>
          <p className="mut">
            Boost a car every {GTA_CD_MS / 1000}s (10 energy — fail and you do a short county stint). Then choose:
            <span className="gold"> MELT</span> it into rounds for the heavy work — damage cuts the yield, and 25% of
            every melt tithes to your family's armory —
            <span className="gold"> FENCE</span> it for quick cash, or <span className="gold">REPAIR</span> it first
            (rare iron melts hot but repairs badly). Rounds are what hit contracts run on. Garage holds {GARAGE_CAP}.
          </p>
          <div className="row" style={{ marginBottom: 12 }}>
            <button
              className="btn hot"
              disabled={p.jail > 0 || p.energy < 10 || Date.now() < (p.gtaAt || 0) + GTA_CD_MS || (p.cars || []).length >= GARAGE_CAP}
              onClick={boostCar}
            >
              🚗 Boost a car
            </button>
            {Date.now() < (p.gtaAt || 0) + GTA_CD_MS && <span className="mut">heat dies down in {Math.ceil(((p.gtaAt || 0) + GTA_CD_MS - Date.now()) / 1000)}s</span>}
            <span className="mut">· {(p.cars || []).length}/{GARAGE_CAP} in the garage · fleet value ${fmt(carsValue(p.cars))} · 🔸 {fmt(p.ammo || 0)} rounds on hand</span>
          </div>
          {(p.cars || []).length === 0 && <div className="mut">Empty bays. The city is full of cars that aren't yours yet.</div>}
          {(p.cars || []).map((c, i) => {
            const m = carOf(c.id);
            if (!m) return null;
            const t = trimOf(c.trim);
            const yieldRounds = carMelt(c);
            const fenceVal = Math.floor(carVal(c) * 0.5 * (1 - (c.dmg || 0) / 100));
            const repCost = Math.max(50, Math.floor(((c.dmg || 0) / 100) * carVal(c) * 0.2));
            const repChance = Math.max(5, (m.rare ? 50 : 100) - (c.dmg || 0));
            return (
              <div key={i} className="lrow">
                <div>
                  <div>{carName(c)}{m.rare && <span className="gold"> · RARE</span>}{t.id === "bespoke" && <span className="gold"> · ONE OF ONE</span>} <span className={c.dmg > 30 ? "red" : "mut"}>· {c.dmg || 0}% damaged</span></div>
                  <div className="mut">{m.desc}</div>
                </div>
                <div className="row">
                  <button className="btn hot" onClick={() => meltCar(i)}>🔥 Melt · {yieldRounds} 🔸</button>
                  {(c.dmg || 0) > 0 && (
                    <button className="btn" disabled={p.cash < repCost} onClick={() => repairCar(i)}>🔧 Repair · ${fmt(repCost)} ({repChance}%)</button>
                  )}
                  <button className="btn" onClick={() => fenceCar(i)}>Fence · ${fmt(fenceVal)}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "kitchen" && (() => {
        const trIdx = tradeRankIdx(p.tradeRep);
        const nextTr = TRADE_RANKS[trIdx + 1];
        const kIdx = p.lab ? KITCHENS.findIndex((x) => x.id === p.lab) : -1;
        const nextK = KITCHENS[kIdx + 1];
        const curK = kitchenOf(p.lab);
        const batchDrug = p.batch && drugOf(p.batch.drug);
        return (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>The Kitchen — the other way up</h2>
            <p className="mut">
              A second career: buy <span className="gold">makings</span> from The Supplier, <span className="gold">cook</span> them
              into product, and <span className="gold">deal</span> at street demand — or consign to a corner crew and let it move
              itself. Every deal adds <span className="red">heat</span>; past 60 the Bureau starts kicking doors. Lifetime product
              moved builds your <span className="gold">Trade rank</span>, a second ladder the whole city can see. All of it —
              stash, Kitchen, rank — is street. It dies with you.
            </p>

            {/* Career path */}
            <div style={{ border: "1px solid #3A3128", borderRadius: 6, padding: 10, marginBottom: 14 }}>
              <div className="disp gold" style={{ fontSize: 16 }}>YOUR PATH{p.path ? `: ${PATHS.find((x) => x.id === p.path)?.name?.toUpperCase()}` : ""}</div>
              <div className="mut" style={{ marginBottom: 6 }}>
                {p.path ? PATHS.find((x) => x.id === p.path)?.desc : level < 5 ? "At level 5 you pick a career: The Gun, The Ledger, or The Kitchen. Choose what kind of story this is." : `Declare a career for $${fmt(PATH_FIRST_COST)}. Switching later costs ${PATH_SWITCH_OMR} $OMR.`}
              </div>
              <div className="row">
                {PATHS.map((pt) => (
                  <button key={pt.id} className={p.path === pt.id ? "btn hot" : "btn"} disabled={p.path === pt.id || level < 5} onClick={() => choosePath(pt.id)} title={pt.desc}>
                    {p.path === pt.id ? "✓ " : ""}{pt.name}{!p.path ? "" : p.path === pt.id ? "" : ` · ${PATH_SWITCH_OMR} $OMR`}
                  </button>
                ))}
              </div>
            </div>

            {/* Heat */}
            <div style={{ border: "1px solid " + ((p.heat || 0) > 60 ? "#9E2B25" : "#3A3128"), borderRadius: 6, padding: 10, marginBottom: 14, background: (p.heat || 0) > 60 ? "#221410" : undefined }}>
              <div className="disp" style={{ fontSize: 16 }}><span className={(p.heat || 0) > 60 ? "red" : "gold"}>🌡 HEAT: {Math.round(p.heat || 0)}/100</span>{(p.heat || 0) > 60 && <span className="red"> — THE BUREAU IS BUILDING A FILE</span>}</div>
              <div className="mut">Heat decays ~1/min. Past 60, every passing minute risks a raid — raids take most of the stash and 60–120s of your freedom. Corner crews generate heat around the clock.</div>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn" disabled={(p.heat || 0) < 5 || p.cash < 5000 || p.energy < 25} onClick={layLow}>Lay low · $5,000 + 25⚡ (−25 heat)</button>
                <button className="btn" disabled={(p.heat || 0) < 1 || p.omr < 10} onClick={cleanPapers}>📄 Clean Papers · 10 $OMR (wipe)</button>
              </div>
            </div>

            {/* Trade rank */}
            <div className="mut" style={{ marginBottom: 14 }}>
              Trade rank: <span className="gold">{TRADE_RANKS[trIdx].name.toUpperCase()}</span> · ${fmt(p.tradeRep || 0)} lifetime product moved
              {TRADE_RANKS[trIdx].bonus ? ` · deals +${Math.round(TRADE_RANKS[trIdx].bonus * 100)}%` : ""}
              {nextTr ? ` · ${TRADE_RANKS[trIdx + 1].name} at $${fmt(nextTr.at)}` : " · the ladder ends with you"}
            </div>

            {/* The Lab */}
            <h3 className="disp gold" style={{ fontSize: 18, margin: "12px 0 4px" }}>THE LAB{curK ? ` — ${curK.name.toUpperCase()}` : ""}</h3>
            {!curK && <div className="mut" style={{ marginBottom: 6 }}>No Kitchen yet. Everyone starts with a bathtub.</div>}
            {curK && <div className="mut" style={{ marginBottom: 6 }}>{curK.desc} Batch cap {curK.cap} units · {curK.mins} min cooks · {Math.round(curK.fire * 100)}% fire risk at collection.</div>}
            {nextK && (
              <button className="btn" style={{ marginBottom: 8 }} disabled={p.cash < nextK.cost || p.omr < (nextK.omr || 0)} onClick={() => buyKitchen(nextK)}>
                {kIdx < 0 ? "Set up" : "Upgrade to"} {nextK.name} · ${fmt(nextK.cost)}{nextK.omr ? ` + ${nextK.omr} $OMR` : ""}
              </button>
            )}
            {p.batch && batchDrug && (
              <div className="lrow">
                <div>
                  <div>🧪 {p.batch.qty} units of {batchDrug.name} on the burner</div>
                  <div className="mut">{Date.now() >= p.batch.doneAt ? "Done — pull it before it scorches." : `Ready in ${Math.ceil((p.batch.doneAt - Date.now()) / 60000)} min.`}</div>
                </div>
                <button className="btn hot" disabled={Date.now() < p.batch.doneAt} onClick={collectBatch}>Pull the batch</button>
              </div>
            )}
            {curK && !p.batch && (
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="mut">Batch size:</span>
                <input type="number" min={1} max={curK.cap} value={cookAmt} onChange={(e) => setCookAmt(Math.max(1, +e.target.value))} />
                <span className="mut">(uses 1 📦 per 20 units · you hold {p.cb || 0})</span>
              </div>
            )}

            {/* Product lines: supplier + cook + deal per drug */}
            {DRUGS.map((d) => {
              const locked = trIdx < d.unlock;
              const mk = (p.makings || {})[d.id] || 0;
              const s = (p.stash || {})[d.id];
              const dem = demandOf(d.id, p.loc);
              const ev = cityEventOf(dayOf());
              const unitNow = Math.floor(d.base * dem * (s?.q || 1) * (ev.drugDemand || 1) * (1 + TRADE_RANKS[trIdx].bonus));
              return (
                <div key={d.id} className="lrow" style={locked ? { opacity: 0.5 } : undefined}>
                  <div>
                    <div><span className="gold">{d.name}</span> <span className="mut">— {d.tag}</span>{locked && <span className="red"> · unlocks at {TRADE_RANKS[d.unlock].name}</span>}</div>
                    <div className="mut">
                      makings ${fmt(Math.round(makingsPriceOf(d.id) * (ev.mkMult || 1)))}/unit (you hold {mk}) · demand here {Math.round(dem * 100)}%
                      {s?.n ? <> · stash <span className="gold">{fmt(s.n)}</span> @ {Math.round((s.q || 1) * 100)}% purity → <span className="grn">${fmt(unitNow)}/unit</span></> : ""}
                      {" "}· heat {d.heat}/10 units
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn" disabled={locked || p.cash < Math.round(makingsPriceOf(d.id) * (ev.mkMult || 1)) * 10} onClick={() => buyMakings(d, 10)}>Makings ×10</button>
                    {curK && !p.batch && <button className="btn" disabled={locked || mk < 1 || p.jail > 0} onClick={() => startBatch(d, cookAmt)}>🧪 Cook</button>}
                    {s?.n > 0 && <button className="btn hot" disabled={p.jail > 0 || p.nerve < 1} onClick={() => dealProduct(d, dealAmt)}>Deal ×{Math.min(dealAmt, s.n)}</button>}
                  </div>
                </div>
              );
            })}
            <div className="row" style={{ marginTop: 6 }}>
              <span className="mut">Deal size:</span>
              <input type="number" min={1} value={dealAmt} onChange={(e) => setDealAmt(Math.max(1, +e.target.value))} />
              <span className="mut">costs 1 nerve per 10 units · demand reshuffles per district every 4 h — travel to sell high</span>
            </div>

            {/* Corner crew */}
            <h3 className="disp gold" style={{ fontSize: 18, margin: "14px 0 4px" }}>THE CORNER CREW — {p.crew || 0}/5</h3>
            <div className="mut" style={{ marginBottom: 6 }}>Each member moves ~1 unit/min from your stash at 80% of local demand, around the clock, and generates heat doing it. Passive income with a temperature.</div>
            <button className="btn" disabled={(p.crew || 0) >= 5 || p.cash < 50000 * ((p.crew || 0) + 1)} onClick={hireCrew}>
              Hire · ${fmt(50000 * ((p.crew || 0) + 1))}
            </button>
          </div>
        );
      })()}

      {tab === "shop" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Workshop — make it, use it, lose it</h2>
          <p className="mut">
            Contraband (📦 you have {p.cb || 0}) drops from clean jobs and jumps. Craft it into consumables here —
            every one is destroyed on use, so the city always needs more. Craft cheap, sell dear on the Exchange.
          </p>
          {CONSUMABLES.map((c) => (
            <div key={c.id} className="lrow">
              <div>
                <div>{c.name} <span className="mut">× {invCount(p.inv, c.id)} owned</span></div>
                <div className="mut">{c.desc} · {c.effect} · costs {c.cb} 📦 + ${fmt(c.cost)}</div>
              </div>
              <div className="row">
                <button className="btn" disabled={(p.cb || 0) < c.cb || p.cash < c.cost} onClick={() => craft(c)}>Craft</button>
                <button className="btn hot" disabled={invCount(p.inv, c.id) <= 0} onClick={() => useItem(c)}>Use</button>
              </div>
            </div>
          ))}
          <div className="lrow">
            <div>
              <div>Rounds <span className="mut">× {p.ammo || 0} owned</span></div>
              <div className="mut">Every jump burns 5. Rolled here: 1 📦 + $400 → 30 rounds. Tradeable on the Exchange.</div>
            </div>
            <button className="btn" disabled={(p.cb || 0) < 1 || p.cash < 400} onClick={craftAmmo}>Roll 30</button>
          </div>
        </div>
      )}

      {tab === "exchange" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Exchange — player-run market</h2>
          <p className="mut">
            Every listing here was posted by a real player at their own price. Goods sit in escrow until sold or
            cancelled; sellers are paid through their ledger, minus the 2% house take. Listings are public shared data.
          </p>
          <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>POST A LISTING</div>
          <div className="row" style={{ margin: "8px 0 4px" }}>
            <select value={sellItem} onChange={(e) => setSellItem(e.target.value)}
              style={{ background: "#0D0B09", border: "1px solid #3A3128", color: "#E6DCC8", padding: 8, borderRadius: 4, fontFamily: "'IBM Plex Mono',monospace" }}>
              <option value="cb">Contraband crate ({p.cb || 0})</option>
              <option value="ammo">Rounds ({p.ammo || 0})</option>
              {CONSUMABLES.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({invCount(p.inv, c.id)})</option>
              ))}
            </select>
            <input type="number" min="1" value={sellQty} onChange={(e) => setSellQty(Math.max(1, +e.target.value))} style={{ width: 70 }} />
            <input type="number" min="1" value={sellPrice} onChange={(e) => setSellPrice(Math.max(1, +e.target.value))} />
            <button className="btn hot" onClick={() => createListing(true)}>List for sale</button>
          </div>
          <div className="mut" style={{ marginBottom: 16 }}>item · qty · price each</div>
          <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>OPEN ORDERS</div>
          {listings === null && <div className="mut">reading the board…</div>}
          {listings && listings.length === 0 && <div className="mut">The board is empty. First to list sets the price.</div>}
          {listings && listings.map((l) => (
            <div key={l.id} className="lrow">
              <div>
                <div>{l.qty}× {l.name} <span className="mut">· ${fmt(l.price)} each</span></div>
                <div className="mut">seller: {l.sn}{l.sid === p.id ? " (you)" : ""} · total ${fmt(l.price * l.qty)}</div>
              </div>
              {l.sid === p.id ? (
                <button className="btn" onClick={() => cancelListing(l)}>Cancel</button>
              ) : (
                <button className="btn hot" disabled={p.cash < l.price * l.qty} onClick={() => buyListing(l)}>Buy lot</button>
              )}
            </div>
          ))}
          <button className="btn" style={{ marginTop: 10 }} onClick={loadMarket}>Refresh the board</button>
        </div>
      )}

      {tab === "train" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Sweat now, collect later</h2>
          <p className="mut">Each session costs 10 energy. Gear from the Market stacks on top.</p>
          <div className="row">
            {["muscle", "cunning", "speed"].map((s) => (
              <button key={s} className="btn" disabled={p.energy < 10 || p.jail > 0} onClick={() => train(s)}>
                Train {s} ({p.stats[s]}{itemBoost(s) > 0 ? ` +${itemBoost(s)}` : ""})
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "market" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Black Market — NFT gear</h2>
          <p className="mut">Gear mints as a compressed NFT to your wallet (simulated). Priced in $OMR — swap desk is in the Vault.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
            {MARKET.map((it) => (
              <div key={it.id} style={{ border: `1px solid ${p.owned.includes(it.id) ? "#C9A227" : "#3A3128"}`, borderRadius: 6, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{it.name}</strong>
                  <span style={{ color: RARITY_COLOR[it.rarity], fontSize: 11 }}>{it.rarity}</span>
                </div>
                <div className="mut" style={{ margin: "4px 0" }}>{it.desc}</div>
                <div style={{ fontSize: 12 }}>+{it.boost} {it.stat}</div>
                <button className="btn" style={{ marginTop: 8, width: "100%" }} disabled={p.owned.includes(it.id)} onClick={() => buyItem(it)}>
                  {p.owned.includes(it.id) ? "✓ In your wallet" : `Mint · ${it.price} $OMR`}
                </button>
              </div>
            ))}
          </div>

          <div className="disp" style={{ fontSize: 18, color: "#C9A227", marginTop: 20 }}>THE ARMORY — iron for the work</div>
          <p className="mut">
            Bought with cash + contraband. One equipped at a time. Firepower carries heavy jobs (nerve 6+), fights,
            and the later missions — but big iron with poor concealment hurts quiet work, and unreliable pieces get
            confiscated for good if you land in lockup. Currently carrying: <span className="gold">{gunObj ? gunObj.name : "nothing"}</span> · 🔸 {p.ammo || 0} rounds.
          </p>
          <div className="lrow">
            <div>
              <div>Box of Rounds (50)</div>
              <div className="mut">Cash and carry. Jumps burn 5 apiece; the Workshop rolls them cheaper if you have crates.</div>
            </div>
            <button className="btn" disabled={p.cash < 2000} onClick={buyAmmo}>Buy · $2,000</button>
          </div>
          {VESTS.map((v) => (
            <div key={v.id} className="lrow">
              <div>
                <div>{p.vest === v.id ? "🦺 " : ""}{v.name}{p.vest === v.id && <span className="gold"> · WEARING IT</span>}</div>
                <div className="mut">{v.desc}</div>
                <div className="mut">×{v.mult} the rounds needed to finish you · priced in $OMR (pure utility burn) · does not survive death</div>
              </div>
              <button className="btn" disabled={p.vest === v.id || p.omr < v.omr} onClick={() => buyVest(v)}>
                {p.vest === v.id ? "✓ Fitted" : `Fit · ${v.omr} $OMR`}
              </button>
            </div>
          ))}
          {GUNS.map((g) => {
            const has = p.guns.includes(g.id);
            const equipped = p.gun === g.id;
            return (
              <div key={g.id} className="lrow">
                <div>
                  <div>{has ? "✓ " : ""}{g.name}{equipped && <span className="gold"> · EQUIPPED</span>}</div>
                  <div className="mut">{g.desc}</div>
                  <div className="mut">firepower {g.fp} · concealment {g.cc} · reliability {Math.round(g.rel * 100)}%</div>
                </div>
                <div className="row">
                  {!has && (
                    <button className="btn" disabled={p.cash < g.cash || (p.cb || 0) < g.crates} onClick={() => buyGun(g)}>
                      Buy · ${fmt(g.cash)} + {g.crates} 📦
                    </button>
                  )}
                  {has && !equipped && <button className="btn hot" onClick={() => equipGun(g.id)}>Equip</button>}
                  {has && equipped && <button className="btn" onClick={() => equipGun(null)}>Holster</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "casino" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Back Room — street dice</h2>
          <p className="mut">Two dice. Call OVER or UNDER seven. Sevens push — your stake comes back. Pays even money minus the 2% house take on wins. Pocket cash only — the table doesn't take $OMR.</p>
          <div className="row">
            <input type="number" min="10" value={wager} onChange={(e) => setWager(Math.max(0, +e.target.value))} />
            <button className="btn hot" onClick={() => dice("under")}>Under 7</button>
            <button className="btn hot" onClick={() => dice("over")}>Over 7</button>
          </div>
        </div>
      )}

      {tab === "vault" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Vault — bank, swap & stake</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
            <div>
              <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>THE BANK</div>
              <div className="mut" style={{ margin: "4px 0 8px" }}>Banked cash is safe from rival crews. 1% deposit fee.</div>
              <div className="row">
                <input type="number" value={bankAmt} onChange={(e) => setBankAmt(Math.max(0, +e.target.value))} />
                <button className="btn" onClick={() => bank("in")}>Deposit</button>
                <button className="btn" onClick={() => bank("out")}>Withdraw</button>
              </div>
            </div>
            <div>
              <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>SWAP DESK — LIVE MARKET</div>
              <div className="mut" style={{ margin: "4px 0 8px" }}>
                1 $OMR ≈ <span className="gold">${fmt(ammPrice)}</span> right now. This is a shared pool — every buy
                pushes the price up, every sell pushes it down, and the 12-hour buyback buys through it. 2% house take.
              </div>
              <div className="row">
                <input type="number" value={swapAmt} onChange={(e) => setSwapAmt(Math.max(0, +e.target.value))} />
                <button className="btn" onClick={() => swap("buy")}>$ → $OMR</button>
                <button className="btn" onClick={() => swap("sell")}>$OMR → $</button>
              </div>
              <div className="mut" style={{ marginTop: 4 }}>amount in $ for both directions · min $500</div>
            </div>
            <div>
              <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>STAKING</div>
              <div className="mut" style={{ margin: "4px 0 8px" }}>
                Staked: <span className="gold">{fmtT(p.staked)}</span> · Rewards: <span className="grn">{fmtT(p.rewards)}</span> (accelerated demo)
              </div>
              <div className="row">
                <input type="number" value={stakeAmt} onChange={(e) => setStakeAmt(Math.max(0, +e.target.value))} />
                <button className="btn" onClick={stake}>Stake</button>
                <button className="btn" onClick={unstake} disabled={p.staked <= 0}>Unstake all</button>
              </div>
            </div>
            <div>
              <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>THE DEVELOPER'S CUT</div>
              <div className="mut" style={{ margin: "4px 0 8px" }}>
                1% on every transaction — swaps, Exchange trades, assets, bank deposits, and casino winnings.
                You've contributed <span className="gold">${fmt(p.devFees || 0)}</span> lifetime.
                All players combined: <span className="gold">${fmt(devWallet)}</span>.
                In production this fee routes on-chain to the multisig treasury wallet, verifiable by anyone.
              </div>
              <button className="btn" onClick={loadDevWallet}>Refresh tally</button>
            </div>
            <div>
              <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>STREET TAX — 12-HOUR BUYBACK</div>
              <div className="mut" style={{ margin: "4px 0 8px" }}>
                1% on every transaction pools up; every 12 hours the pool buys $OMR on the open market and splits it —
                half to the top 25 families by standing (paid to family reserves), half to the event fund that pays
                live rewards like the daily contracts bonus.
                Pool right now: <span className="gold">${fmt(streetTax.pool || 0)}</span> ·
                Next buyback: <span className="gold">{streetTax.lastRun ? `${Math.max(0, Math.ceil((streetTax.lastRun + 12 * 3600 * 1000 - Date.now()) / 3600000))}h` : "on first pool"}</span> ·
                Distributed to families so far: <span className="gold">{fmtT(streetTax.distributed || 0)} $OMR</span> ·
                Event fund: <span className="gold">{fmtT(streetTax.fund || 0)} $OMR</span>.
                In production: a scheduled on-chain treasury job, every split publicly verifiable. This redistributes
                supply to active players — it is not a promise about price.
              </div>
              <button className="btn" onClick={loadDevWallet}>Refresh / run due buyback</button>
            </div>
          </div>
        </div>
      )}

      {tab === "board" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Streets — every player in the city</h2>
          <p className="mut">
            Ranked by respect, shared across everyone playing this game. <span className="gold">Jump</span> a player
            to steal up to 15% of their pocket cash and hospitalize them for 3 minutes.{" "}
            <span className="red">Search</span> a player to start a hit contract — when your people place them,
            travel to their district and open fire with enough rounds to beat their level, muscle, and vest.
            A kill chops their fleet for cash and pays any bounty; what's on-chain survives them. Players sitting in{" "}
            <span className="gold">lockup</span> can be busted out for cash and rep — fail and you do 180s yourself.
          </p>

          {p.search && (() => {
            const found = Date.now() >= p.search.at + SEARCH_MS;
            const target = (lb || []).find((r) => r.id === p.search.tid);
            const targetLoc = target?.loc ? DISTRICTS.find((d) => d.id === target.loc)?.name : "unknown";
            const btk = target ? btkOf(target.lvl || 1, target.m || 5, vestMultOf(target.vest)) : null;
            const cdLeft = Math.max(0, ((p.shootCdAt || 0) - Date.now()) / 1000);
            return (
              <div style={{ border: "1px solid #9E2B25", borderRadius: 6, padding: 10, marginBottom: 14, background: "#221410" }}>
                <div className="disp red" style={{ fontSize: 18 }}>OPEN CONTRACT: {p.search.tn.toUpperCase()}</div>
                {!found && <div className="mut">Your people are asking around — placed in {Math.ceil((p.search.at + SEARCH_MS - Date.now()) / 60000)} min (production: 3 h).</div>}
                {found && (
                  <>
                    <div className="mut">
                      📍 Last placed in <span className="gold">{targetLoc}</span>
                      {target?.loc && target.loc !== p.loc && " — travel there from the City tab, then fire."}
                      {target?.loc && target.loc === p.loc && <span className="grn"> — you're standing in the same district.</span>}
                      {btk && <> · takes roughly <span className="red">{fmt(btk)} rounds</span> to finish them{target?.vest ? " (they're wearing a vest)" : ""}.</>}
                      {" "}You're holding <span className="gold">{fmt(p.ammo || 0)} 🔸</span>{gunObj ? ` with the ${gunObj.name} (fp ${gunObj.fp} boosts every round; rel ${Math.round((gunObj.rel || 0) * 100)}%)` : " and NO IRON — equip a gun first"}.
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <input type="number" min={MIN_FIRE} value={fireAmt} onChange={(e) => setFireAmt(Math.max(0, +e.target.value))} />
                      <button
                        className="btn hot"
                        disabled={p.jail > 0 || p.energy < 40 || !gunObj || (p.ammo || 0) < Math.max(MIN_FIRE, fireAmt) || cdLeft > 0}
                        onClick={whack}
                      >🔫 Open fire ({fmt(Math.max(MIN_FIRE, Math.floor(fireAmt)))} rounds · 40 energy)</button>
                      {cdLeft > 0 && <span className="red">trigger cools in {Math.ceil(cdLeft / 60)} min</span>}
                    </div>
                  </>
                )}
                <button className="btn" style={{ marginTop: 8 }} onClick={callOffSearch}>Call it off</button>
              </div>
            );
          })()}
          {lb === null && <div className="mut">pulling the files…</div>}
          {lb && lb.length === 0 && <div className="mut">The streets are quiet. Be the first name on the wall.</div>}
          {lb && lb.length > 0 && (
            <div className="row" style={{ margin: "4px 0 10px" }}>
              <span className="mut">💰 Bounty amount:</span>
              <input type="number" min="500" value={bountyAmt} onChange={(e) => setBountyAmt(Math.max(0, +e.target.value))} />
              <span className="mut">min $500 · +2% house take · paid to whoever hospitalizes them</span>
            </div>
          )}
          {lb && lb.map((r, i) => {
            const isMe = r.id === p.id;
            const inHosp = r.hosp && r.hosp > Date.now();
            const inJail = r.jailU && r.jailU > Date.now();
            const sameFam = r.gid && p.gangId && r.gid === p.gangId;
            const atWar = !isMe && r.gid && p.gangId && wars.some((w) => !w.resolved && Date.now() < w.ends && ((w.a.id === p.gangId && w.b.id === r.gid) || (w.b.id === p.gangId && w.a.id === r.gid)));
            const bty = bounties[r.id];
            return (
              <div key={r.id || i} className="lrow">
                <div>
                  <span className="gold">#{i + 1}</span> {r.g && <span className="gold">[{r.g}] </span>}{r.n} <span className="mut">· {r.ti || "STREET THUG"}</span>
                  {isMe && <span className="red"> ← you</span>}
                  {r.ag && <span className="mut"> · 🤖</span>}
                  {inHosp && <span className="mut"> · 🏥 hospitalized</span>}
                  {atWar && <span className="red"> · ⚔ AT WAR</span>}
                  {bty && <span className="gold"> · 💰 ${fmt(bty.amt)} on their head</span>}
                  {!isMe && sameFam && <span className="grn"> · your family</span>}
                  {inJail && <span className="red"> · ⛓ IN LOCKUP {Math.ceil((r.jailU - Date.now()) / 1000)}s</span>}
                  {r.dth ? <span className="mut"> · ☠×{r.dth}</span> : null}
                  {r.tr > 0 && <span className="gold"> · {TRADE_RANKS[r.tr]?.name?.toUpperCase()}</span>}
                  {r.rc > 0 && <span className="grn"> · 🤝×{r.rc}</span>}
                  <div className="mut">
                    M {r.m || "?"} · S {r.s || "?"} · ${fmt(r.cash || 0)} in pocket · {fmt(r.r)} rep{r.pr ? ` · ⭐${fmt(r.pr)}` : ""}{r.nw ? ` · net worth $${fmt(r.nw)}` : ""}
                    {!isMe && <> · <span className="red">~{fmt(btkOf(r.lvl || 1, r.m || 5, vestMultOf(r.vest)))} 🔸 to finish</span>{r.vest ? " 🦺" : ""}{r.fleet ? ` · 🚗×${r.fleet}` : ""}</>}
                  </div>
                </div>
                {!isMe && (
                  <div className="row">
                    {inJail && (
                      <button className="btn" disabled={p.jail > 0} onClick={() => bust(r)}>
                        ⛓ Bust out ({Math.round(Math.max(0.1, Math.min(0.9, 0.7 - ((r.jailU - Date.now()) / 1000) / 400 + (p.busts || 0) * 0.03)) * 100)}%)
                      </button>
                    )}
                    <button
                      className="btn"
                      disabled={p.cash < Math.max(500, bountyAmt) * 1.02}
                      onClick={() => postBounty(r)}
                    >💰 Bounty</button>
                    <button
                      className="btn"
                      disabled={sameFam || !!(p.search && Date.now() < p.search.at + SEARCH_MS)}
                      onClick={() => startSearch(r)}
                    >🔍 Search</button>
                    <button
                      className="btn hot"
                      disabled={inHosp || p.energy < 25 || p.jail > 0 || p.health < 20 || sameFam}
                      onClick={() => attack(r)}
                    >Jump them</button>
                  </div>
                )}
              </div>
            );
          })}
          <button className="btn" style={{ marginTop: 10 }} onClick={loadLb}>Refresh the streets</button>
        </div>
      )}

      {tab === "gang" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Family — gangs</h2>
          {myGang ? (
            <div>
              <div className="disp" style={{ fontSize: 24, color: "#C9A227" }}>[{myGang.tag}] {myGang.name}</div>
              <div className="mut">
                Boss: {myGang.bossName}{myGang.bossId === p.id ? " (you)" : ""} · {(myGang.members || []).length}/20 made members · Treasury ${fmt(myGang.treasury || 0)} · Reserve <span className="gold">{fmtT(myGang.omr || 0)} $OMR</span>
              </div>
              <div className="mut" style={{ margin: "4px 0 0" }}>
                Family standing: <span className="gold">{fmt((myGang.lifetime || 0) + 10000 * (myGang.won || 0))}</span> (lifetime tribute + 10,000 per war won) —
                the top 25 families by standing split half of every 12-hour buyback, paid in $OMR to the family reserve.
              </div>
              <div className="mut" style={{ margin: "6px 0" }}>
                Family level <span className="gold">{gangLevel}</span> — every level gives all members +2% crime success.
                {gangLevel < 5 ? ` Next level at $${fmt((gangLevel + 1) * 50000)} treasury.` : " Maxed out."}
              </div>
              <div className="row" style={{ margin: "12px 0" }}>
                <input type="number" value={donateAmt} onChange={(e) => setDonateAmt(Math.max(0, +e.target.value))} />
                <button className="btn" onClick={donate}>Pay tribute</button>
                <button className="btn hot" onClick={() => leaveGang(false)}>
                  {(myGang.members || []).length <= 1 ? "Disband the family" : "Walk away"}
                </button>
                <button className="btn" onClick={loadMyGang}>Refresh</button>
              </div>
              <div className="mut" style={{ margin: "14px 0 4px" }}>THIS WEEK'S FAMILY CONTRACT</div>
              <div className="lrow">
                <div>
                  <div>📜 {familyTaskOf().name}</div>
                  <div className="mut">
                    {(() => {
                      const effGoal = familyTaskOf().goal * Math.max(1, Math.ceil((myGang.members || []).length / 4));
                      return myGang.task && myGang.task.week === weekOf()
                        ? (myGang.task.done
                          ? "✓ Complete — +15,000 standing banked. New contract Monday."
                          : `progress: ${fmt(myGang.task.prog || 0)} / ${fmt(effGoal)} — goal scales with roster size; every member's work counts`)
                        : `progress: 0 / ${fmt(effGoal)} — goal scales with roster size; every member's work counts`;
                    })()}
                    {" · pays +15,000 standing and +5 $OMR to the reserve"}
                  </div>
                </div>
              </div>

              <div className="mut" style={{ margin: "14px 0 4px" }}>MADE MEMBERS — THE HIERARCHY</div>
              <div className="mut" style={{ marginBottom: 6 }}>
                Soldiers do the work. Capos earn +5% personal payouts. The one underboss earns +10% and can declare wars
                and seize turf. The boss hands out the buttons.
              </div>
              {(myGang.members || []).map((m) => {
                const roleName = m.id === myGang.bossId ? "BOSS" : m.role === "under" ? "UNDERBOSS" : m.role === "capo" ? "CAPO" : "SOLDIER";
                const isBossView = myGang.bossId === p.id && m.id !== p.id;
                return (
                  <div key={m.id} className="lrow">
                    <div>
                      {m.n}
                      <span className={roleName === "BOSS" ? "gold" : roleName === "UNDERBOSS" ? "red" : "mut"}> · {roleName}</span>
                      {m.id === p.id && <span className="red"> ← you</span>}
                    </div>
                    {isBossView && (
                      <div className="row">
                        {m.role !== "capo" && <button className="btn" onClick={() => setRole(m.id, "capo")}>Make Capo</button>}
                        {m.role !== "under" && <button className="btn" onClick={() => setRole(m.id, "under")}>Make Underboss</button>}
                        {(m.role === "capo" || m.role === "under") && <button className="btn hot" onClick={() => setRole(m.id, "soldier")}>Demote</button>}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="mut" style={{ margin: "16px 0 4px" }}>WARS</div>
              {wars.filter((w) => w.a.id === p.gangId || w.b.id === p.gangId).length === 0 && (
                <div className="mut">No wars. Peace is just an intermission.</div>
              )}
              {wars.filter((w) => w.a.id === p.gangId || w.b.id === p.gangId).map((w) => {
                const minsLeft = Math.max(0, Math.ceil((w.ends - Date.now()) / 60000));
                return (
                  <div key={w.id} className="lrow">
                    <div>
                      <span className="red">⚔</span>{" "}
                      <span className="disp" style={{ fontSize: 16 }}>[{w.a.tag}] {w.scoreA || 0} — {w.scoreB || 0} [{w.b.tag}]</span>
                      <div className="mut">
                        {w.resolved
                          ? (w.winner ? `over — [${w[w.winner].tag}] won and took $${fmt(w.spoils || 0)} in spoils` : "over — stalemate, nobody eats")
                          : `${minsLeft} min left · jump their members on the Streets to score hits · winner takes 20% of the loser's treasury`}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="mut" style={{ margin: "16px 0 4px" }}>OTHER FAMILIES</div>
              {gangs === null && <div className="mut">asking around…</div>}
              {gangs && gangs.filter((g) => g.id !== p.gangId).length === 0 && <div className="mut">No rival families in the city yet.</div>}
              {gangs && gangs.filter((g) => g.id !== p.gangId).map((g) => (
                <div key={g.id} className="lrow">
                  <div>
                    <span className="gold">[{g.tag}]</span> {g.name}
                    <div className="mut">boss {g.bossName} · {(g.members || []).length} members · treasury ${fmt(g.treasury || 0)}</div>
                  </div>
                  {canCommand && (
                    <button className="btn hot" onClick={() => declareWar(g)}>Declare war · $10k</button>
                  )}
                </div>
              ))}
              <button className="btn" style={{ marginTop: 8 }} onClick={() => { loadGangs(); loadMyGang(); loadWars(); }}>Refresh</button>
            </div>
          ) : (
            <div>
              <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>FOUND A FAMILY — $25,000 · LEVEL 5+</div>
              <div className="row" style={{ margin: "8px 0 16px" }}>
                <input style={{ width: 180 }} value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Family name" />
                <input style={{ width: 70 }} value={gTag} onChange={(e) => setGTag(e.target.value.toUpperCase().slice(0, 4))} placeholder="TAG" />
                <button className="btn hot" onClick={createGang}>Found it</button>
              </div>
              <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>OR KISS THE RING</div>
              {gangs === null && <div className="mut">asking around…</div>}
              {gangs && gangs.length === 0 && <div className="mut">No families in this city yet. Found the first and run it.</div>}
              {gangs && gangs.map((g) => (
                <div key={g.id} className="lrow">
                  <div>
                    <span className="gold">[{g.tag}]</span> {g.name}
                    <div className="mut">boss {g.bossName} · {(g.members || []).length}/20 members · treasury ${fmt(g.treasury || 0)}</div>
                  </div>
                  <button className="btn" disabled={(g.members || []).length >= 20} onClick={() => joinGang(g)}>Join</button>
                </div>
              ))}
              <button className="btn" style={{ marginTop: 10 }} onClick={loadGangs}>Refresh</button>
            </div>
          )}
          <p className="mut" style={{ marginTop: 12 }}>
            Family names, rosters, and treasuries are shared data visible to all players. You can't jump your own family —
            omertà — and jumping members of rival families pays +50% respect.
          </p>
        </div>
      )}

      {tab === "turf" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The City — turf & trade runs</h2>
          <p className="mut">
            Prices differ by district and reshuffle every 4 hours (next shuffle in{" "}
            {Math.max(0, Math.ceil(((priceBlock() + 1) * 4 * 3600 * 1000 - Date.now()) / 60000))} min). Buy low, ride
            across town for ${fmt(TRAVEL_COST)}, sell high. Your Wheels set the trunk:{" "}
            <span className="gold">{cargoCount(p.cargo)}/{cargoCapacity(p.assets)}</span> units loaded. Families get
            5% better prices on turf they hold. Only the boss or underboss can seize districts.
          </p>

          <div className="disp" style={{ fontSize: 18, color: "#C9A227" }}>
            YOU'RE IN: {DISTRICTS.find((d) => d.id === p.loc)?.name?.toUpperCase()}
          </div>
          <div className="row" style={{ margin: "6px 0 4px" }}>
            <span className="mut">qty:</span>
            <input type="number" min="1" value={tradeQty} onChange={(e) => setTradeQty(Math.max(1, +e.target.value))} style={{ width: 70 }} />
          </div>
          {GOODS.map((g) => {
            const buyP = Math.round(priceOf(g.id, p.loc) * districtPriceMult(p.loc, "buy"));
            const sellP = Math.round(priceOf(g.id, p.loc) * districtPriceMult(p.loc, "sell"));
            return (
              <div key={g.id} className="lrow">
                <div>
                  <div>{g.name} <span className="mut">· {p.cargo[g.id] || 0} in trunk</span></div>
                  <div className="mut">buy ${fmt(buyP)} · sell ${fmt(sellP)} here (+2% house take both ways)</div>
                </div>
                <div className="row">
                  <button className="btn" onClick={() => buyGood(g.id, tradeQty)}>Buy</button>
                  <button className="btn hot" disabled={(p.cargo[g.id] || 0) <= 0} onClick={() => sellGood(g.id, tradeQty)}>Sell</button>
                </div>
              </div>
            );
          })}

          <div className="disp" style={{ fontSize: 18, color: "#C9A227", marginTop: 16 }}>THE MAP — PRICES & TURF</div>
          {terrs.map((d) => {
            const mine = d.holder?.gid === p.gangId;
            const here = p.loc === d.id;
            const cost = d.holder ? Math.max(30000, Math.floor((d.garrison || 0) * 1.5)) : 30000;
            return (
              <div key={d.id} className="lrow">
                <div>
                  <div>
                    {d.name} {here && <span className="red">· 📍 HERE</span>} {mine && <span className="grn">· YOUR TURF</span>}
                  </div>
                  <div className="mut">{d.perk}</div>
                  <div className="mut">
                    {GOODS.map((g) => `${g.name.split(" ")[1] || g.name}: $${fmt(priceOf(g.id, d.id))}`).join(" · ")}
                  </div>
                  <div className="mut">
                    {d.holder ? <>held by <span className="gold">[{d.holder.tag}] {d.holder.name}</span> · garrison ${fmt(d.garrison || 0)}</> : "unclaimed — the block is up for grabs"}
                  </div>
                </div>
                <div className="row">
                  {!here && <button className="btn" disabled={p.cash < TRAVEL_COST || p.jail > 0} onClick={() => travel(d.id)}>Ride · ${fmt(TRAVEL_COST)}</button>}
                  {!mine && myGang && canCommand && (
                    <button className="btn hot" disabled={(myGang.treasury || 0) < cost} onClick={() => seizeDistrict(d)}>
                      Seize · ${fmt(cost)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <button className="btn" style={{ marginTop: 10 }} onClick={loadTerrs}>Refresh the map</button>
        </div>
      )}

      {tab === "agent" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>The Consigliere — AI agent play</h2>
          <p className="mut">
            OMERTÀ is agent-playable. The Consigliere is a built-in autonomous agent: each turn it reads your full
            game state, asks Claude for exactly one action as strict JSON, and executes it through the same rules
            and guards as human play — no special powers, no hidden throttle exemptions.
          </p>
          <div className="row" style={{ margin: "10px 0" }}>
            <button className={agentOn ? "btn hot" : "btn"} onClick={startAgent}>
              {agentOn ? `■ Dismiss the Consigliere (turn ${agentTurns}/25)` : "▶ Let the Consigliere drive"}
            </button>
            {agentOn && <span className="gold">thinking every ~8s…</span>}
          </div>
          {agentThought && (
            <div className="mut" style={{ marginBottom: 10 }}>Last decision: <span className="gold">{agentThought}</span></div>
          )}
          <div className="disp" style={{ fontSize: 18, color: "#C9A227", marginTop: 8 }}>FOR EXTERNAL AGENTS</div>
          <p className="mut">
            Any script or agent can drive this game through <span className="gold">window.omerta</span> —
            call <span className="gold">window.omerta.getState()</span> for a compact JSON snapshot and{" "}
            <span className="gold">window.omerta.act(name, params)</span> to act, e.g.{" "}
            <span className="gold">omerta.act("crime", {"{"}id: "poker"{"}"})</span>. In production this becomes an
            authenticated REST API with per-key rate limits, hitting the same server-authoritative endpoints as the UI.
          </p>
          <div className="disp" style={{ fontSize: 18, color: "#C9A227", marginTop: 8 }}>THE HOUSE RULES FOR MACHINES</div>
          <p className="mut">
            Agents are welcome, labeled, and fenced: agent-driven accounts carry a 🤖 badge on the Streets so humans
            know who they're fighting, they're permanently excluded from recruitment payouts, and they play by exactly
            the human ruleset. Transparency is what keeps agent play a feature instead of a botting problem.
          </p>
        </div>
      )}

      {/* The Estate — death report overlay */}
      {estate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(13,11,9,.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div className="panel" style={{ maxWidth: 560, border: "1px solid #9E2B25" }}>
            <h2 className="red" style={{ marginTop: 0, fontSize: 32 }}>☠ YOU GOT WHACKED</h2>
            <p className="mut">{estate.by} finished the job. The character is dead. The account is not — this is the middle path.</p>
            <div className="disp gold" style={{ fontSize: 16 }}>THE ESTATE — WHAT'S ON-CHAIN SURVIVES YOU</div>
            <div className="mut" style={{ margin: "6px 0 12px" }}>
              {fmtT(estate.kept.omr)} $OMR in the wallet · {fmtT(estate.kept.staked)} staked (+{fmtT(estate.kept.rewards)} rewards) ·{" "}
              {estate.kept.gear} piece{estate.kept.gear === 1 ? "" : "s"} of NFT gear · ⭐ {fmt(estate.kept.prestige)} prestige
              {estate.legacy ? <span className="grn"> (+{estate.legacy} legacy — half your level, converted)</span> : null}
              {estate.kept.wallet ? ` · wallet ${short(estate.kept.wallet)} untouched` : ""}
            </div>
            <div className="disp red" style={{ fontSize: 16 }}>BURIED WITH YOU</div>
            <div className="mut" style={{ margin: "6px 0 12px" }}>
              ${fmt(estate.lost.cash)} in cash and bank · {estate.lost.cars} car{estate.lost.cars === 1 ? "" : "s"} ·{" "}
              {estate.lost.guns} gun{estate.lost.guns === 1 ? "" : "s"} · rank {estate.lost.rank} (level {estate.lost.lvl}){estate.lost.product ? ` · ${fmt(estate.lost.product)} units of product, the Kitchen, and the name "${estate.lost.tradeRank}"` : ""} · the family, the rackets, the cargo — all of it.
            </div>
            <p className="mut">A cousin steps off the train carrying the family name and a legacy stake of <span className="grn">${fmt(500 + estate.kept.prestige * 100)}</span> — $100 per prestige star.</p>
            <button className="btn hot" style={{ width: "100%" }} onClick={() => setEstate(null)}>Continue the bloodline</button>
          </div>
        </div>
      )}

      {/* Ledger */}
      <div style={{ marginTop: 14 }}>
        <div className="mut" style={{ marginBottom: 4 }}>THE FAMILY LEDGER</div>
        <div className="ledger" ref={logRef}>
          {log.map((l, i) => (
            <div key={i}>
              <span className={l.t === "HEAT" ? "red" : ["SOL", "NFT", "FAM", "AGT"].includes(l.t) ? "gold" : "mut"}>[{l.t}]</span>{" "}
              {l.msg} {l.amt && <span className={String(l.amt).startsWith("−") ? "red" : "grn"}>{l.amt}</span>}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
          <div className="mut" style={{ fontSize: 10 }}>
            Progress auto-saves. Chain actions simulated — see architecture doc for production design.
          </div>
          <button className="btn" style={{ fontSize: 10 }} onClick={resetGame}>Burn the books (reset)</button>
        </div>
      </div>
    </div>
  );
}
