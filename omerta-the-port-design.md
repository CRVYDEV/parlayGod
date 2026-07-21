# THE PORT — maritime smuggling (design)

## The fantasy & why it's distinct

Convoys already own **"move goods you own across town"** — road freight, *player* hijackers, internal
arbitrage between districts. The Port owns a different axis: **"bring contraband in from overseas."** It is
the sea counterpart to the land game, deliberately non-overlapping:

| | Convoys (land) | The Port (sea) |
|---|---|---|
| Asset | your existing trunk/cars | **BOATS — a new ownable class, bought like cars** |
| Cargo | goods you already bought | **contraband sourced from an offshore supplier** |
| Risk | *player* ambushers (PvP) | **the COAST GUARD (PvE) — the sea's Bureau** |
| Reward | delivery + arbitrage | the **smuggling margin** (buy cheap offshore, land dear) |
| Where | any district | **the Docks** (the Port) |

So a player who runs convoys and a player who runs the Port are doing genuinely different things, against
different opponents, with different iron. Boats also give the car catalog a sibling — a reason to spend on
vessels, and a new thing to lose (a boat can be **impounded/sunk**, unlike a car).

## Boats — the new asset class (bought like cars)

A `BOATS` catalog (the `CARS` precedent), each with:
- **cost** — a cash sink to buy (`port:boat`), at the Docks.
- **hold** — cargo capacity = the SCALE of a run (bigger hold ⇒ bigger cargo ⇒ bigger margin AND bigger loss).
- **speed** — EVASION: subtracts from the Coast Guard's interdiction chance (and the sink chance).
- Resale: sell back at the Docks for a fraction (`port:sell`, ~60% — boats depreciate; the car sell-back
  precedent).

The tradeoff space is the point: a **Coastal Freighter** (huge hold, slow) is high-scale/high-risk; a
**Cigarette Boat** (small hold, very fast) is low-scale/near-untouchable. You own a FLEET (up to `FLEET_MAX`),
even of the same kind. Boats **die with the street** (the estate wipes them, like cars).

Catalog (step one, all sign-off levers): Harbor Dinghy · Runner's Skiff · Converted Trawler · Fast Cutter ·
Coastal Freighter · Cigarette Boat.

## The Run — the core loop

Three actions, the convoy/business lazy-timer pattern:

1. **`launchRun(boatId, route, {escort})`** — at the Docks, a docked boat. Pick a **route** (a risk tier):
   the boat fills its hold with contraband bought from the offshore supplier at `route.buyPerUnit`
   (`hold × buyPerUnit`, a cash SINK `port:buy`), optionally hires an **escort** (`port:escort`, subtracts
   from interdiction), draws a little heat, and puts to sea for a real-clock run (`route.ms`). Gated:
   level, at-Docks, jailed/hospitalized, **safehouse-blocked** (an op, P1.3), the boat must be docked, and
   the **daily supply cap** (below).
2. **arrival is lazy** (`boat.run_until`) — the boat is at sea until then; the board shows the ETA + a
   value band.
3. **`collectRun(boatId)`** — at/after arrival, at the Docks, **safehouse-blocked** (an exposed collection,
   D2). Roll the **Coast Guard** (below):
   - **Clean:** the contraband lands and is fenced for `hold × route.sellPerUnit` — a cash FAUCET
     `port:sale`. The margin = `hold × (sell − buy)` is the smuggling profit.
   - **Interdicted:** the cargo is **SEIZED** (no sale — the buy cost is a total loss, never ledgered as a
     refund), the boat is **FINED** `FINE_RATE` of the cargo cost (`port:fine`, a cash sink, pocket→bank), a
     **heat spike**, and a `SINK_P` chance the **boat is impounded** (the row deleted — a real asset loss).
   - Either way the boat returns to dock (run state cleared) unless sunk.

## The Coast Guard — the PvE antagonist (the sea's Bureau)

`interdictChance = clamp((route.patrol + patrolMod − boat.speed − escortDef) / 100, MIN, MAX)`.
- **route.patrol** rises with the route tier (Coastal low, Deep Run high).
- **patrolMod** ties into the Living World day/night clock (`cityHourOf`): the Coast Guard works patrol
  hours (harder to slip past) and eases in the small hours (smuggle at night). Reuses the existing clock —
  no new signed surface.
- **boat.speed** + a hired **escort** cut the chance — so a fast boat / escort on a low route is near-safe,
  and a slow freighter on the Deep Run is a real gamble. `PORT_INTERDICT_P` is a TEST-ONLY roll knob (the
  `WORLD_RAID_P` precedent).

## §10.4 & the bound

All cash flows are ledgered, character-tagged, under a new `port:` prefix (joins the cash vocabulary):
- Sinks: `port:boat` (buy a boat), `port:buy` (source contraband), `port:escort` (escort), `port:fine`
  (Coast Guard fine).
- Faucets: `port:sale` (landed contraband — the smuggling profit), `port:sell` (boat resale, < cost).
The only real FAUCET is `port:sale`. It's bounded three ways: **(1)** the per-boat run clock (one run per
boat at a time), **(2)** interdiction eating a fraction of runs, and **(3) the daily SUPPLY CAP** — a
per-character rolling-24h token bucket on contraband bought (`port_used`/`port_at`, the D3 wash-cap /
bank-cap pattern), so an always-online whale can't run a fleet 24/7 into an unbounded printer. The cap is
sized (sim-measured) to boxing-exhibition / territory parity (~a few hundred k/day for a maxed active
smuggler). Every number is a founder sign-off lever; the faucet is sim-measured before production (the
races/exhibition precedent).

## Step two — BUILT (naval upgrades + PIRACY + the offshore rendezvous)

- **NAVAL UPGRADES** (the car-`tune` twin): a boat carries a **hull** and **engine** level (each capped at
  `UPGRADE_MAX` 5, a `port:upgrade` cash SINK, cost climbs with the level and the boat's tier).
  `effHold = hold + hull×HULL_STEP` (+15 cargo/level) and `effSpeed = speed + engine×ENGINE_STEP` (+8
  knots/level) fold into every run (cost/hold, the `minSpeed` gate, interdiction) and the board. Upgrades
  buy efficiency toward the daily `SUPPLY_CAP_DAY`, **not a higher ceiling** — the cap still bounds total
  daily sourcing, so this is progression, not inflation.
- **PIRACY** (`interceptRun`, `POST /v1/port/intercept/:boatId` — the convoy-ambush twin at sea): a pirate
  with their **own fast docked boat** + guns runs down a rival's run that's genuinely at sea. The board's
  new **THE SEAS** section lists at-sea runs as a route + **value BAND** (never the manifest — the
  convoy-board rule). Energy + ammo (`port:piracy` ammo SINK) + heat; a muscle/speed + pursuit-boat-speed
  contest vs the runner's `effSpeed` + escort. A **WIN** seizes the cargo: the pirate lands a **CUT**
  (`PIRATE_TAKE_BPS` 60%) of what it would have fenced for (`port:piracy` cash FAUCET) and the runner's run
  is **voided**. Because the take is < 100% and the run is voided, piracy is a **§10.4-safe REDIRECT of the
  existing `port:sale` faucet — total port emission can only FALL**. A **LOSS** hospitalizes the pirate.
  One attempt per pirate per live run (`port_intercepts`, cleared when a boat's run starts/ends/moves);
  family omertà holds; the pirate needs their own boat, so piracy is a Port-native PvP loop (and a use for
  fast boats). Lock order: pirate char → the target boat row `FOR UPDATE` (all run-mutating paths now lock
  the boat, so piracy and the owner's collect serialize — no double-realize).
- **The offshore RENDEZVOUS** (`rendezvous`, `POST /v1/port/rendezvous/:boatId {to}`): a consensual mid-sea
  handoff — a runner hands an active run to a **partner's docked, rendezvous-flagged boat**
  (`POST /v1/port/boat/:boatId/rendezvous` is consent-by-listing). The run (route/hold/cost/escort/timer)
  moves vessel-to-vessel; the runner's boat is freed; the flag is consumed. Use it to hand a hot cargo to a
  fast/clean captain for the final approach, or to shake a pirate tracking your specific boat.
  **§10.4-neutral** — no currency moves; `port:sale` fires for whoever finally collects. Both boat rows lock
  `FOR UPDATE` in sorted order (deadlock-safe vs a concurrent rendezvous/piracy).

`test/port.js` covers the upgrade ladder + the effective hold/speed on the board, piracy (the seas value
band, the level + once gates, a WIN's redirected cut + voided run, a LOSS's hospitalization), and the
rendezvous (the closed-boat gate + the handoff moving the run + consuming the flag). All step-two numbers
(`STEP2.*`) are founder sign-off levers — sim the piracy faucet before production (it can only reduce
emission, but the ammo cost + PvP gate should keep it a skill play, not a farm).

## Step three — BUILT (the Smuggler's Legend + the Harbormaster)

- **THE SMUGGLER'S LEGEND** — `account_persistent.smuggled` (lifetime contraband value landed: every clean
  collect + every piracy take, bumped by direct SQL, NUMERIC so the arithmetic UPDATE is pg-mem-safe;
  account-level → **SURVIVES DEATH**, the boxing-wins / wheel / war-effort precedent) + `PORT.STEP3.LEGEND_RANKS`
  (Deckhand → Runner → Smuggler → Blockade Runner → The Baron of the Bay → The Kingpin of the Coast,
  `portRankOf`) + `GET /v1/leaderboard/port` (`portLeaderboard` — the biggest lifetime haulers; agents
  excluded, the hitman-rep precedent). PURE STATUS — **zero §10.4 surface** (landed value isn't a currency;
  the cash still rides `port:sale`/`port:piracy`, so the test proves `legend.smuggled == the account's
  lifetime port:sale + port:piracy`). Surfaced on `GET /v1/port` (`legend {smuggled, rank}`) + the console.
- **THE HARBORMASTER** — the family that **HOLDS the docks** (the Port's home district) tolls every clean
  landing there: `port:toll` = `TOLL_BPS` (5%) of the sale, a §10.4 **TRANSFER** (shipper pocket→bank →
  holder treasury — the convoy-toll twin: clamped to pocket+bank, never gates the freight, charged only if
  the treasury credit lands, and NPC-held / your own family = free). The gang-treasuries §10.4 check gained
  `portTollIn`. This ties the solo Port into the turf/family layer AND synergizes with the World-occupation
  loop — the docks start NPC-occupied (dockrats), so a family **liberates** it (World step five) and then
  earns Port tolls from every other shipper. Surfaced on `GET /v1/port` (`harbormaster {holder, tollBps,
  tolled}`) + a console warning chip.

`test/port.js` covers the legend (the `port:sale + port:piracy` identity, the rank, the leaderboard, DEATH
survival) and the harbormaster (a held-docks toll credits the treasury 5%, the net reflects it, the
gang-treasuries §10.4 reconcile). `PORT.STEP3.*` (TOLL_BPS, LEGEND_RANKS) are founder sign-off levers.

## Deferred (step four+)
- A **contraband MARKET** — land the goods as a tradeable premium commodity (its own price line + a fence)
  rather than auto-selling, so the Port feeds the market instead of paying cash directly.
- Harbor **berths** (a rented slip that expands the fleet cap), and **Coast Guard heat** feeding the Law
  meter (a dedicated federal-report exposure on a bust, distinct from the street-heat spike).
