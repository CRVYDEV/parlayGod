# The Pen — a prison meta-game (design)

## 1. Why
Jail is the game's most common punishment and its deadest content: `jail_until` is a timer you wait
out, and almost every action throws `jailed`. The RICO bust (the Law), failed crimes, failed busts,
Bureau raids, pleas and flips all send players to lockup — and then nothing happens there. The Pen
turns being inside into a *place* with its own loop: an honest grind to work your sentence down, a
contraband economy, a way to buy protection, and — the marquee — the **jailhouse shank**: you can
reach and kill an enemy who is *also* inside, bypassing the street defenses (safehouse, bodyguard)
that would stop you on the outside. It gives the Law's conviction a destination, and it turns "my
rival got locked up" from a shrug into an opportunity.

Grounded in what exists: `jail_until`/`jailed(ch)`, `runEstate` (a shank is a real death → the full
estate), the two-party lock discipline (`withTwoCharacters`), the fire/npcHit family + witpro +
respawn-token precedents, and the recurring-sink/faucet ledger patterns. All numbers are founder
sign-off levers (ground rule #1).

## 2. Step one — the yard, the commissary, and the shank
Every Pen action REQUIRES being jailed (they're the only things you *can* do inside); a lapsed
sentence means you've walked and the Pen is closed to you.

- **`GET /v1/pen`** — the yard: your remaining sentence, the roster of other inmates (level, family),
  your contraband, your protection window, and the commissary prices.
- **Work the yard** (`POST /v1/pen/work`) — laundry / kitchen duty. Costs `PEN.WORK_ENERGY`, pays a
  small bounded cash faucet (`pen:work`, like a low crime), and shaves `PEN.WORK_CUT_S` off your
  sentence for good behaviour. Energy-gated (no cash), so it's the slow honest path out. A §10.4 cash
  FAUCET (character_id'd, bounded by energy).
- **The commissary** (`POST /v1/pen/buy/:item`) — buy contraband from a corrupt guard (a cash SINK,
  `pen:commissary`): a **shiv** (the price of admission to a shank) is step one's item.
- **Protection** (`POST /v1/pen/protection`) — pay the yard boss `PEN.PROTECTION_COST` for a
  `PEN.PROTECTION_MS` window you can't be shanked (`pen_safe_until` — the in-jail analogue of the
  street safehouse; distinct from `safe_until`). A cash SINK (`pen:protection`).
- **Bribe the guard** (`POST /v1/pen/bribe`) — pay `PEN.BRIBE_PER_S` per second to cut your remaining
  sentence (the fast, expensive way out). A cash SINK (`pen:bribe`).
- **The jailhouse shank** (`POST /v1/pen/shank/:targetId`, `withTwoCharacters`) — the marquee. BOTH
  must be jailed (you're in the same yard); the killer spends a **shiv** + energy in a muscle
  contest. Bypasses the street defenses (safehouse can't be entered from jail anyway; a street
  bodyguard isn't inside) — but RESPECTS the paid **respawn token** (real-ETH revive insurance works
  anywhere) and **witness protection** (a witpro'd rat is in protective custody, segregated from
  general population — `witpro` throws). Family **omertà** holds (unless the target is a rat, the
  audit precedent). **Protection is shield-not-bunker** (P1.3): a `penSafe(ch)` ACTOR guard blocks a
  protected inmate from shanking (take cover OR hunt, not both — mirrors the street `safeHoused(ch)`
  guards). On a landed shank: it FULFILS open kill contracts on the mark (`claimBounty`, like `fire` —
  a shank is a DIRECT player kill, so a contract killer who gets their mark jailed and shanks them
  collects; audit — else a $5k shiv burned the funder's escrow), then `runEstate({ killerCh,
  vendetta: true })` — a real death (heir, prestige, a sworn bloodline) but NO loot/chop (you can't
  strip a fleet from a cell) and NO feared-rep (a shanking is dishonorable — the npcHit precedent);
  the killer's sentence EXTENDS by `PEN.KILL_ADD_S` (a body means more time). On a miss: the shiv is
  gone, the killer eats health damage + `PEN.CAUGHT_ADD_S` more time (caught fumbling). Streets feed:
  "shanked in the yard."

§10.4: `pen:` joins the cash vocabulary — `pen:work` a bounded faucet, `pen:commissary`/`pen:protection`/
`pen:bribe` sinks, all character_id'd (check (a) reconciles). The shank moves no currency (contraband
is ownership, the death runs the existing ledgered estate). `pen_contraband` joins the `runEstate`
wipe (it dies with the man).

## 3. Why this shape
- **Answers "jail is dead time"** — four things to do inside, one of them (the shank) genuinely
  high-stakes.
- **Gives the Law a destination** — a RICO conviction now sends you somewhere with rules, and a
  convicted whale is briefly reachable by the shank (a soft counter to the safehoused hoarder the
  economy keeps flagging — they have to surface, or get convicted, to be touched).
- **Emergent** — you can get yourself pinched on purpose to reach a rival inside; protection money vs
  the shiv is a real inside arms race; the bribe is a wealth sink that scales with how badly you want
  out.
- **Clean** — one new table, one new character column, one new cash vocabulary prefix; the shank
  reuses `runEstate`/`withTwoCharacters` wholesale.

## 4. Step two — the hole, yard incidents, the burner phone (BUILT)
- **THE HOLE** — solitary. A CAUGHT shank (the fumble branch) now throws the killer in the hole
  (`hole_until`, `PEN.HOLE_MS`) on top of the health + sentence hit: while `inHole`, ALL Pen actions
  throw `hole` (no yard, no commissary, no calls) AND you can't be shanked (`segregated` — the hole is
  isolation both ways). Gives the caught-shank real teeth. Board surfaces `holeSeconds`.
- **YARD INCIDENTS** — a deterministic, block-wide daily draw (`yardEventOf`, the §7.11 seed / the
  cityEventOf shape; `PEN_YARD_EVENT` is a TEST-ONLY override): **lockdown** (no shanks — `shankBlock`),
  **riot** (shank odds +0.2, protection cost halved — blood's cheap, cover's on sale), **visit** (bribe
  rate halved — the guard takes less), **toss** (commissary closed). Each is ONE touchpoint; the
  discounted number is what's ledgered (the decree precedent). Surfaced as `incident` on the board.
  Ties the Pen into the Living World's weather layer.
- **THE BURNER PHONE** — a contraband item (`burner`, a `pen:commissary` sink) that is the ONE way to
  reach the outside from a cell: `POST /v1/pen/burner/:targetId` consumes it to call in an NPC hit
  (`npcHit` is jail-gated everywhere else — the burner threads `opts.fromBurner` to waive JUST the
  actor jail gate; every other npcHit gate stands). The NPC-hit fee still burns win or lose; the burner
  is spent only if the call goes through (a bad target throws → the txn rolls back). "One call, then you
  eat the SIM."

`schema`: `characters.hole_until`. §10.4: no new reasons (the burner rides `pen:commissary`; the burner
hit rides the existing `npchit:hire` sink). `test/pen.js` covers the hole (caught → solitary, all
actions blocked, untouchable), every incident touchpoint (lockdown/toss/riot/visit, discounted charges
ledgered), and the burner (jail-gated npcHit refused without it, one call consumes it, the fee burns).

## 5. Step three — THE BREAKOUT (BUILT)
`attemptBreak` (`POST /v1/pen/break`) — a solo, high-risk escape. Buy a **cutkit** (Hacksaw & Rope,
$50k, a normal `pen:commissary` cash sink → the pool); burn it win or lose on a break attempt. A
LOCKDOWN yard event blocks it; a riot's chaos (`shankAdd`) helps. Roll `PEN.BREAK_P` (0.35 base;
`PEN_BREAK_P` is a TEST-ONLY knob, the SHANK_P precedent).
- **Over the wall (win):** the sentence CLEARS (`jail_until = null`) — but you walk out a **WANTED
  fugitive** (`characters.wanted_until = now + FUGITIVE_MS` 2d), which the existing loan-WANTED
  machinery already enforces: omertà stripped (`isWanted` in fire/jump/npcHit/postBounty) + NPC bounty
  hunters (`huntWanted` worker sweep). A heat spike raises the alarm. You trade a cell for a manhunt —
  so it never trivialises the RICO sink. To clear it: lie low for `FUGITIVE_MS`, or pay the existing
  `POST /v1/loans/square` ($50k → the pool) which handles a bounty-less fugitive cleanly.
- **Caught at the fence (loss):** the hole (`hole_until`, capped at the sentence), a long added stretch
  (`BREAK_CAUGHT_ADD_S` 15min), a beating (`BREAK_FAIL_DMG`), the kit spent — no fugitive mark.

§10.4: **clean** — `attemptBreak` moves no currency (the cutkit was the ledgered sink; wanted/heat/
jail are not §10.4). NO schema change (cutkit is a `pen_contraband` row; `wanted_until` already
exists). No pool bounty is posted (kept §10.4-clean); players may still post their own on a wanted man.
Console: an "Over the Wall" card in the Pen tab (with the fugitive warning). `test/pen.js` covers the
free/no-kit/lockdown gates, the cutkit sink → pool, a forced fail (the hole + longer stretch + beating +
kit spent + NOT wanted) and a forced win (sentence cleared + WANTED + heat spike + the sheet reads wanted).

## 6. Step four — THE CO-OP BREAKOUT (BUILT)
The crew-heist pattern, INSIDE (`pen.js` `planBreak`/`joinBreak`/`leaveBreak`/`executeBreak`/
`breakBoard`/`sweepStaleBreaks`; `pen_breaks` + `pen_break_members` tables). A jailed **leader stakes a
cutkit** (`POST /v1/pen/break/plan`); jailed inmates **join** off the board (`GET /v1/pen/breaks`,
`POST /v1/pen/break/:id/join`); the leader **calls the go** (`POST /v1/pen/break/:id/go`) — ONE roll for
the whole crew, `p = COOP_BASE 0.4 + (crew−1)×COOP_PER_EXTRA 0.12 + riot`, clamped `[.05, COOP_MAX_P .9]`
(`PEN_BREAK_P` still pins it for tests). Crew `COOP_MIN 2` … `COOP_MAX 4`.
- **Win** → EVERYONE's sentence clears + EVERYONE walks out **WANTED** (the solo-break bound, applied
  crew-wide) + a heat spike each.
- **Loss** → the WHOLE crew eats the hole + `BREAK_CAUGHT_ADD_S` + a beating (per-member).

Lock discipline mirrors `executeHeist` exactly: leader (withCharacter) → member char rows **sorted** →
the break row; one-active-break (`UNIQUE character_id`) makes concurrent executes disjoint (acyclic);
the residual leader-vs-PvP `40P01` maps to a clean `contention` retry; members are written by absolute
`UPDATE`s under lock (never in-memory — no persistCharacter clobber). The cutkit is **contraband, not
currency** — staked at plan, spent win or lose at go, **refunded to a LIVING leader** on disband/stale
(a dead leader's kit stays sunk — the heist-stake rule); a member's membership dies with the estate
(`pen_break_members` joined the runEstate wipe). The worker sweeps stale plans (`sweepStaleBreaks`,
`COOP_TTL_MS` 1h, leader-before-break lock order). §10.4-clean (no currency moves — the only ledgered
event was buying the cutkit). Console: a "Crew Break" section in the Pen tab (plan/join/leave/go).
`test/pen.js` covers the free/no-kit/crew_short/not_leader gates, the staked-kit lifecycle, a forced win
(whole crew out + WANTED + heat), a forced fail (whole crew in the hole + longer stretch), and the
disband + stale-sweep kit refund.

## 7. Step five (deferred — the roadmap)
- **Prison factions / shot-callers** — your family's rep sets the pecking order; a yard boss taxes
  new fish; controlling the yard is a mini-turf game.
- **Richer yard incidents** — a hostage, a snitch, a work-strike; incident-specific rewards.
- **The break RAT** — a crew informer (the heist-rat twin): tips the guards, the break auto-blows,
  the rat walks while the crew eats the hole.

All numbers are founder sign-off levers — sim + sign-off into BALANCE.md before production.
