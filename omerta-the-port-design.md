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

## Deferred (step two+)
- A **contraband MARKET** — land the goods as a tradeable premium commodity (its own price line + a fence)
  rather than auto-selling, so the Port feeds the market instead of paying cash directly.
- **PvP piracy** — other players intercept your boat at sea (the convoy-ambush analog on water), so the
  Port has a player-risk layer too.
- **Boat upgrades** (engines/holds), harbor **berths** (a slip you rent), a **smuggler's legend**
  (account-level lifetime landed value, survives death — the boxing/wheel precedent), and **Coast Guard
  heat** feeding the Law meter.
