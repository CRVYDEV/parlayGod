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

## 4. Step two (deferred — the roadmap)
- **Prison factions / shot-callers** — your family's rep sets the pecking order; a yard boss taxes
  new fish; controlling the yard is a mini-turf game.
- **The burner phone** — a contraband item that lets you run ONE outside action from inside (a
  tethered move — collect a racket, order a hit) at a heat premium.
- **The riot / the break-out** — a rare, co-op Pen event (the crew-heist pattern) to spring the yard.
- **Yard incidents** — random events while you serve (a shakedown, a hostage, a snitch) drawn off the
  §7.11 seed, tying the Pen into the Living World.
- **Segregation & the hole** — solitary as a harsher sentence tier; protective custody as the witpro
  home.

All step-one numbers are founder sign-off levers — sim + sign-off into BALANCE.md before production.
