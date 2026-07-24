# Design sketch — making the transport loops less repetitive

**Status:** **Tier C BUILT** (founder-directed 2026-07-24; `src/notoriety.js`, the `NOTORIETY` rules
block, `route_notoriety` table, port/convoy integration + tests). Tiers A + B remain proposals /
founder sign-off (see §4–§6). Prompted by tester feedback (odcpw): *"I find the farming of transporting
bonds, watches, etc a bit repetitive … compared to doctor or drug cooking / boat driving."*

**Tier C as built** — ROUTE NOTORIETY (per-`(character, lane)` heat that grows each run and decays lazily:
the port's heat raises interdiction, a convoy lane's heat sheds the shipper's guard defense — emission-safe,
pushing route variety) + THE SMUGGLER'S REPUTATION (the existing Teamster/Smuggler legends grant tiered perks
that MANAGE the heat — faster decay / lower gain — plus a §10.4-neutral docks-toll break). Zero new faucet;
all numbers founder sign-off levers. See CLAUDE.md + BALANCE.md for the full record.

## 1. The problem, diagnosed

Three loops move goods for a living: **trade-goods arbitrage** (buy low here → haul →
sell high), **convoys** (bulk land shipping, player-ambushable), and **port runs**
(offshore contraband, PvE Coast-Guard interdiction). All three share the same shape:

> pick the one optimal action → commit → wait a timer → collect → repeat the *same*
> optimal action.

The player nails the exact gap: the doctor / kitchen / boat loops feel richer because
each iteration has a **moment-to-moment decision** (which line to cook, when to laylow,
which route to gun) and a **stake that can swing**. The transport loops resolve to a
solved optimum you then farm — so the wait dominates and the choices are front-loaded
and identical every time.

**The fix is not more numbers or a new faucet.** It's *a decision per iteration* and
*variance you must read and adapt to* — added the way the codebase already does texture:
the §7.11 seed, the `CITY_EVENTS` track, lazy resolution at the touch, and the
scrutiny/interdiction risk layers.

## 2. Constraints this must respect

- **§10.4.** No unbudgeted faucet. Any value moved is ledgered; anything held is escrowed.
  Interventions should *reroute existing risk/value* (choices that change WHO gets the
  same bounded haul), not mint new value. Where a small bonus is unavoidable it's a
  sign-off lever, sim'd before production.
- **Ground rule #1.** The signed trade/convoy/port curves stay put. New mechanics ride
  new, flagged levers.
- **Lazy accrual (§7.1).** No global ticks. A run's event resolves when the owner
  *touches* it (collect / ambush / arrive), off the seed for the departure block — the
  kitchen-raid / yard-incident precedent.
- **Server-authoritative + verifiable.** Every roll is seed-derived (knowable, auditable)
  or `rng_audit`'d; the choice is the player's, the outcome is the referee's.

## 3. The core idea — **"the run has a story"**

One mechanic, reused across all three loops: **each run carries an EVENT, drawn from the
§7.11 seed + the city-event track, that the player answers with ONE pre-committed choice
at departure and that resolves lazily at collect.**

Concretely, at **launch/depart** the run shows a seed-drawn situation and 2–3 responses,
e.g. a convoy:

- *"A Bureau checkpoint sits on the canal road tonight."*
  - **Gun it** — faster arrival, but +interdiction/ambush exposure.
  - **Grease the checkpoint** — a small cash bribe (a §10.4 SINK → the buyback pool,
    the `pen:commissary` precedent), risk removed.
  - **Take the long way** — safe, but a longer clock (a pacing cost, no value moved).

At **collect**, the outcome resolves against the choice + the seed (the interdiction /
ambush roll already exists — the event just *shifts* it). No new faucet: the bribe is a
sink, the detour is time, gun-it trades safety for speed. The player now makes a real
call each run, reads a situation that varies by day/district, and can be wrong.

Event pools per loop (each event = one seed-drawn card + one choice, all sign-off levers):

| Loop | Example events (seed-drawn) | The choice reroutes… |
|---|---|---|
| **Convoy** | checkpoint · rival tail · washed-out bridge · a friendly toll | ambush/interdiction odds, arrival clock, a bribe sink |
| **Port run** | Coast-Guard sweep forecast · storm · a buyer wants a specific line | interdiction odds, the fence rate, a harbormaster bribe sink |
| **Goods haul** | a fence is hot for one line today · a shakedown at the docks | which line pays the premium, a small toll sink |

This is the **`CITY_EVENTS` + decree pattern** applied at the *run* granularity, and it's
the single highest-leverage change: it turns "commit → wait" into "read → decide → commit
→ see if you called it right."

## 4. Three tiers, light → deep (pick the appetite)

### Tier A — surface the variance you already have (nearly free, no faucet)

The economy *already* varies prices — `regionShockOf` (the mean-neutral daily supply
shock) and turf goods-price perks move every district's spot price. Today the player
can't see it as a signal, so they farm one static route.

- **"Hot markets today" board.** On the Trade Goods / convoy screens, surface the
  biggest cross-district spreads and today's movers ("Gin +18% in Docks · Furs −12% in
  Neon"). The `/v1/opportunities` agent board already computes arbitrage spreads — reuse
  it for humans. Turns "haul the same thing" into "read the board, chase today's edge."
- **Directed orders ("word on the wire").** A daily, seed-drawn DEMAND — *"the Copa wants
  40 units of gin by tonight, pays a premium"* — the existing **daily-contract** pattern
  (`growth.js`) pointed at transport. A directed fetch with a deadline + a bounded bonus
  (sign-off lever, a small ledgered faucet like the mission $OMR precedent, or better:
  the "premium" is just the player selling INTO an already-shocked hot market, so it's
  §10.4-free). Adds a target and a clock.

**Impact:** high (changes the *feel* from farm to chase). **Cost:** low (mostly surfacing
+ one daily draw). **Risk:** minimal — Tier A moves almost no new value.

### Tier B — the per-run EVENT + choice (the core, §3 above)

The "run has a story" mechanic for convoys + port runs (and optionally goods hauls).
Each run: a seed-drawn event, a pre-committed choice at depart, lazy resolution at
collect. Reroutes existing risk/value + adds bribe SINKS; the one flagged surface is any
bonus branch, which should be a redistribution (e.g. the bribe you *didn't* pay stays in
your pocket) rather than a mint.

**Impact:** high (a decision every iteration + variance to adapt to). **Cost:** medium
(a small `TRANSPORT_EVENTS` pool per loop + the resolve hook at the existing collect/
ambush sites). **Risk:** low-medium — needs a sim pass on the bribe-sink / any-bonus math
and a red-team of the choice→outcome resolution (it touches the signed interdiction/
ambush curves as a *modifier*, the decree precedent).

### Tier C — progression that changes HOW you run (meta)

- **Road/route notoriety.** Running the *same* road repeatedly raises a per-route
  notoriety (the business-scrutiny pattern) that draws more ambush/Coast-Guard interest —
  so farming one lane gets riskier and you're pushed to *vary* routes. Pure risk modifier,
  decays lazily, no faucet.
- **Smuggler's reputation unlocks event options.** The convoy/port legends already exist
  (Teamster/Highwayman, the Smuggler's Legend). Tie a *gameplay* perk to them: a higher
  rank unlocks better event responses (a "known face" gets the cheaper bribe, the
  harbormaster looks away once a day). Status→access, the Underworld-tier precedent —
  off §10.4, off the signed curves.

**Impact:** medium (rewards mastery, discourages single-lane farming). **Cost:** medium.
**Risk:** low (status/risk modifiers, no new value).

## 5. Recommended MVP

Ship **Tier A first** (a week's win, near-zero risk): the *hot-markets signal* + *one
daily directed order*. It directly answers "repetitive" by making each session a fresh
read of the board, and it's almost §10.4-free (chase existing shocks; the order premium
is selling into an already-hot market).

Then, if the founder likes the direction, **Tier B for convoys** (the loop the player
named first) as a single vertical slice: a 4–6 card `CONVOY_EVENTS` pool, the depart-time
choice, the collect-time resolve. Measure the bribe-sink flow in `tools/sim.js` and
red-team the choice→interdiction modifier before production.

Tier C is a later polish once the event layer proves out.

## 6. Open questions for sign-off

1. **Bonus vs sink-only.** Do directed orders / good outcomes pay a *bounded new faucet*
   (mission-$OMR precedent, sim'd) or stay strictly redistributive (chase-the-shock +
   bribe-sinks only)? The latter is §10.4-free and my default recommendation.
2. **Timer feel.** Should the event choice also let a player *shorten* the wait (gun it →
   faster arrival) — trading the wait the player is bored by for risk? (Yes, I think — it
   directly attacks the "the wait dominates" half of the complaint.)
3. **Scope of Tier B.** Convoys only, or convoys + port + goods hauls at once? Convoys-only
   is the cleanest slice to validate the pattern.
4. All new numbers (`TRANSPORT_EVENTS` odds/bribes, order premiums, notoriety rates) are
   sim + founder sign-off levers before production, per ground rule #1.
