# The Living World (design)

> **STATUS: BUILT (all four phases) — `src/world.js`, `test/world.js` (the 18th suite), the `LIVING`
> + `WORLD` rules-tail blocks.** Phase 2's `world:raid` is the one emission surface (a bounded cash
> faucet — SIM sign-off before production, ground rule #1). Suite 18/18 + sim drift-0. Deferred:
> the NPC-held-district "seizable frontier" (would require NPC turf ownership — invasive; the raid
> loot + rout event stand in) and the cross-process streets-weather emit (surfaced on the board/view
> instead). Implementation summary at the end.

## 1. Why
The city already breathes — faintly. `CITY_EVENTS` (17 events in the rules tail) rotate daily via
`cityEventOf(day)` and are ALREADY wired into every economy loop: crime `jobPay`/`jailMult`/`crimeRep`,
fence `fenceMult`, boost `boostAdd`, bust `bustAdd`, jump `stealAdd`/`jumpRep`, contraband `cbMult`,
trade `tradeMult`, the Kitchen's `mkMult`/`drugHeat`/`drugDemand`, and accrual's `racketMult`/`heatDecay`
(`accrual.js`, `economy.js`, `kitchen.js`, `social.js`, `game.js`). It's a deterministic, server-state-free,
same-for-everyone daily modifier — the §7.11 hash philosophy applied to the whole town. But it's nearly
invisible (`GET /v1/city` returns it and almost nothing surfaces it in the action responses), it's a flat
day-mod-17 rotation (predictable, no texture), and the world it describes is empty of ACTORS — there are
prices and weather but no rival families, no NPC crews, no sense that anything happens that a player didn't
personally do.

The Living World pillar makes the city a place with its own life: events you can SEE and plan around, a
server-wide NPC antagonist that gives the whole player base a common enemy (co-op content that isn't
zero-sum PvP), economic weather that shocks the price hash, and a day/night clock that makes 3am different
from noon. Crucially, it builds ENTIRELY on machinery that already exists — `cityEventOf`, the §7.11
`hash01`/`priceBlock` deterministic markets, and the UTC clock — so most of it is pure functions with
zero new server state and, in Phases 1/3/4, zero §10.4 surface.

## 2. Phase 1 — the city you can see (richer, legible, deterministic events)
The cheapest, highest-leverage slice: make the weather that already drives the economy VISIBLE and
give it texture, without changing a single balance surface.

- **Surface the event everywhere.** Every action response whose math already reads `cityEventOf`
  (`fence`, `boost`, `deal`, `crime`, `jump`, `bust`, trade sells) returns the active event id +
  the multiplier that applied to THAT action (`cityEffect: { id, mult, field }`). The player sees WHY
  the fence paid 25% more today. Zero balance change — it's reporting a number already used.
- **The city board.** `GET /v1/city` grows into a real forecast: today's event, its exact modifiers,
  and — because `cityEventOf` is a pure function of the day number — a **7-day forecast** (the events
  are already knowable; exposing them lets players PLAN, which is the point of deterministic weather).
  "Fence pays extra in 3 days — hold your iron."
- **Layered events (texture without new tables).** Today one event fires per day. Phase 1 layers a
  second, independent track off a different hash slice — a base "economic" event (trade/fence/racket)
  AND a "law" event (jail/bust/heat) can co-occur, drawn from `cityEventOf(day)` and
  `cityEventOf(day + OFFSET)` (or a `hash01`-selected index) so the city has two dials on any given day
  instead of one. Both are still pure, deterministic, same-for-everyone.
- **Streets-feed weather.** The day's event posts to the existing streets feed at UTC rollover (the
  worker already runs nightly) so the town collectively knows "TONIGHT: THE CRACKDOWN" — the prototype
  already wrote this line (`reference-prototype-v24.jsx`: "TONIGHT IN THE CITY…"); this ports it.

§10.4: none. Phase 1 moves no value — it surfaces and layers an existing deterministic modifier.
The only new numbers are the second-track selection offset and any NEW event rows (which are content on
the same multiplier fields, the car-catalog-expansion precedent — content, not a rebalance). All
sign-off levers; the existing 17 events' multipliers are UNTOUCHED.

## 3. Phase 2 — NPC rival families (the server-wide antagonist)
The city's missing actors. A set of server-wide NPC families that exist in the world as a common enemy —
co-op PvE content that gives non-warring players something to fight together, and a faucet-neutral sink
target. This is the one phase with real state and a §10.4 surface, so it's the heavy lift.

- **The NPC families.** A small fixture set (rules tail, the `UNDERWORLD` NPC-fixture precedent) — e.g.
  3–4 rival outfits, each "holding" a district the players don't, each with a standing/strength number
  that the world tends lazily (§7.1 — an NPC family's strength regenerates on read, no cron). They are
  the environmental analogue of turf: territory to take, but from the house.
- **Co-op raids on the NPC.** The crew-heist machinery (`heists.js`) already models "a leader fronts a
  stake, a crew joins off a board, one roll pays everyone" — an NPC-family raid is a heist variant whose
  TARGET is an NPC outfit. Success seizes a slice of the NPC's holdings — cash to the crew (a bounded
  faucet on the heist-pot pattern, `world:raid` — same shape as `heist:crew`, rng-audited, capped by
  the NPC's regenerating strength so it's not an infinite faucet) and, on a district raid, opens that
  district to player seizure. The NPC pushes back: strength regenerates, and a beaten-down NPC family
  can "retaliate" — a server-event that the Phase-1 weather track can surface (an NPC crackdown day).
- **NPC territory as a seizable frontier.** An NPC-held district, once raided down, becomes claimable
  by the normal turf machinery (`seizeDistrict`) — so the Living World literally EXPANDS the map players
  fight over. This turns the fixed district set into a frontier: the house holds land, players take it,
  the house pushes back.
- **Why NPC, not just more PvP.** The audits keep noting the kill economy is negative-EV for careful
  players and the map is zero-sum (every turf gain is another family's loss). A server-wide NPC enemy is
  POSITIVE-sum content — a faucet the whole base can tap by cooperating, bounded by the NPC's strength so
  it can't be farmed dry. It's the EVE "null-sec ratting" / co-op-PvE role the game lacks.

§10.4: the raid payout is a bounded cash FAUCET (`world:raid`, `character_id`'d, on the heist-pot
pattern — the pot is rng-rolled and CAPPED by the NPC family's regenerating strength, so total emission
is bounded by a metered world quantity, not unbounded). This is a NEW faucet, so it wants explicit sim
sign-off (it's the only part of this pillar that adds emission). If the sim says the map can't afford a
new faucet, the fallback ships the raid as a GOODS/gear/turf reward (pure ownership transfers, no §10.4
surface — the convoy-hijack precedent) instead of cash. NPC strength is not a §10.4 currency. All numbers
are founder sign-off levers.

## 4. Phase 3 — economic weather & supply shocks (the price hash comes alive)
The markets are deterministic (§7.11: `goodPriceOf`/`demandOf`/`makingsPriceOf` off `hash01` +
`priceBlock`) but static in character — the same smooth pseudo-random band every block. Phase 3 layers
the city events onto the PRICE machinery so the world has economic seasons.

- **Supply shocks on goods/makings.** The existing `mkMult`/`tradeMult`/`drugDemand` event fields
  already nudge Kitchen and trade prices; Phase 3 extends this to the GOODS price hash — a `drought` /
  `flush` / `strike` event applies a multiplier band to `goodPriceOf` for its day (a pure function of
  the event, no new state — the same `cityEventOf` read the other loops already do). A dock strike
  spikes contraband; a mill payday floods trade demand. The price is still deterministic and
  server-authoritative — the event is just another factor in the hash's output, knowable via the
  Phase-1 forecast so players can run goods AHEAD of the shock (the convoy game gets a reason to exist —
  move bulk to where the weather is about to pay).
- **Regional weather (per-district events).** Today one event covers the whole city. Phase 3 can draw a
  per-DISTRICT event off `hash01('cityevent:' + districtId + ':' + day + SEED)` — the same machinery
  that already gives each district its own goods price. So the docks can be in a strike while the Neon
  Mile is in a race-day boom — geography starts to matter, and the convoy/trade loops get a live
  arbitrage map. Still pure, deterministic, no server state.

§10.4: none — prices are computed, not stored; a multiplier on a deterministic price function moves no
value on its own (the value moves when a player trades, through the EXISTING ledgered trade/deal/fence
paths). The sim must confirm the shock bands don't hand a risk-free arbitrage (the flagged trade-goods
arbitrage item — Phase 3 must not widen it), so this is a sim-gated content layer. Numbers (shock bands,
per-district on/off) are sign-off levers; the base price hash is untouched.

## 5. Phase 4 — the day/night clock (the city has hours)
The cheapest texture of all: the UTC clock the game already runs on. `cityEventOf` keys on the day; Phase
4 adds an intra-day pure function of the HOUR.

- **Time-of-day modifiers.** A `cityHourOf(t)` pure function (the `cityEventOf` shape, keyed on UTC
  hour) gives the world a diurnal rhythm — e.g. night (low patrol) eases boosts/reduces heat-gain,
  daytime (high patrol) the reverse; the Neon Mile den runs hotter at night. Every touchpoint is a
  single multiplier on a surface, read the same way `cityEventOf` is — no new state, deterministic,
  same for everyone at a given UTC instant.
- **Patrol windows for the Law.** Ties into the Law/RICO pillar: an investigation/bust is likelier to
  resolve during "business hours" (the Bureau works 9–5) — so WHEN you surface with heat on you matters.
  A pure read off `cityHourOf`, no new plumbing.
- **Deliberately gentle.** Time-of-day multipliers are small and symmetric (a texture, not a
  balance lever) — the point is flavour and a reason for the world to feel awake at 3am, not to force
  players onto a clock. It must not create a "you must play at hour X to earn" trap (an explicit
  anti-goal — the modifiers average out over a day).

§10.4: none — pure hour-keyed multipliers on existing surfaces, no value movement. All numbers are
sign-off levers and deliberately small.

## 6. §10.4 summary (the whole pillar)
- **Phases 1, 3, 4: zero §10.4 surface.** They surface, layer, and extend the existing deterministic
  `cityEventOf` / §7.11 price machinery — pure functions of (day, hour, district, SEED). Value moves
  only through the EXISTING ledgered loops those multipliers feed; nothing new is minted or transferred.
- **Phase 2 is the only ledgered piece:** the NPC-raid payout, a NEW bounded cash faucet
  (`world:raid`, capped by the NPC family's regenerating strength — a metered world quantity, so
  emission is bounded, not unbounded). It wants its own sim sign-off before production; the faucet-free
  fallback (goods/gear/turf rewards, pure ownership transfers) ships if the sim says the map can't
  afford new cash emission.
- **No signed surface is retuned.** The existing 17 events' multipliers stay exactly as sim-audited;
  the base price hash is untouched. This pillar ADDS texture and actors around the signed economy — it
  does not rebalance it.

## 7. Phasing & sign-off
1. **Phase 1** (visible/layered/forecast events + streets weather) — no §10.4, no balance change,
   ships first; pure UX + content on an existing engine.
2. **Phase 2** (NPC rival families + co-op raids + a seizable frontier) — the heavy lift and the only
   emission surface; sim-gated; co-op PvE that gives the base a common enemy.
3. **Phase 3** (economic weather / supply shocks / regional events) — sim-gated content on the price
   hash; must not widen the flagged trade-goods arbitrage.
4. **Phase 4** (day/night clock) — cheap diurnal texture; deliberately gentle, no earn-trap.

Every number here is a **founder sign-off lever** (ground rule #1). The existing `CITY_EVENTS` values
and the §7.11 price hash are the sim-audited floor this builds ON, never over. `node tools/sim.js` +
`npm test` gate every phase, and Phase 2's faucet specifically requires an extraction-vs-inflow sim pass
before it reaches production.

## 8. As built
- **`src/rules.js` tail** — the `LIVING` block (`FORECAST_DAYS`, `LAW_TRACK_OFFSET`, the mean-neutral
  `REGION_SHOCK_*` band, the `PATROL_*`/`NIGHT_RAID` clock levers) + `cityHourOf`, `cityLawEventOf`,
  `regionShockOf`, `cityForecast`; the `WORLD_NPCS` fixtures + `WORLD` levers. **`goodPriceOf` folds
  the per-district shock in** (one consistent surface for the prices board, buy/sell, and convoy
  value). `bustProbOf` gained the patrol multiplier. CITY_EVENTS itself is untouched (generated).
- **Phase 1** — `GET /v1/city` publishes both event tracks, the intraday clock, per-district weather,
  and a 7-day forecast (pure functions of the day). The character `view` carries a `city` summary.
- **Phase 2** — `src/world.js`: `worldBoard` (level-gated odds, status band) + `raidNpc` (a bounded
  `world:raid` cash faucet + a `world:raid` ammo sink, draining a shared regenerating reservoir;
  rout bonus + streets event; energy/ammo/level/cooldown gates). `world_npcs` table (server-wide,
  lazy regen); `characters.world_raid_at` cooldown. WORLD_RAID_P is a TEST-ONLY roll knob.
- **Phase 3** — `regionShockOf` (deterministic, mean-neutral, band-narrow so it can't widen the
  audited arbitrage) folded into `goodPriceOf`; surfaced as the `weather` map on `GET /v1/city`.
- **Phase 4** — `cityHourOf` (UTC-hour patrol window); the Bureau convicts harder on patrol
  (`bustProbOf`), the small hours ease an NPC raid; surfaced on `/v1/city`, `/v1/law`, and the view.
- **§10.4** — `world:` joins the cash vocabulary (a faucet bounded by the reservoir/regen — enrolled,
  drift-0) and the ammo vocabulary (the raid's rounds sink). No other pillar touches value.
- **`test/world.js`** proves the forecast/clock/weather board, the mean-neutral shock folded into the
  price (deterministic + floor + per-district variance), the raid (bounded loot faucet, ammo sink,
  reservoir drain, regen, rout, all gates), the patrol conviction premium, and the closed vocabulary.
