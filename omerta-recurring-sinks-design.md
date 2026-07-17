# Recurring sinks — "The Pad" (design)

## 1. Why
The economy is faucet-rich and sink-medium: deep earning loops, good ONE-TIME sinks (vanity,
seals, gear, penance), but thin RECURRING, wealth-scaling drains — the classic late-game problem
where the rich pool cash faster than they can burn it (the sim audit flagged the safehoused-landlord
passive stack as ~25× the riskiest loop). The cleanest fix is upkeep: passive income that costs
something to keep passive.

## 2. Step one — business upkeep ("the pad")
Every business FRONT owes weekly protection + wages, proportional to its income. The bagman comes
whether or not you're collecting.

- **Rate**: `BUSINESS_UPKEEP_BPS` (2000 = 20%) of the tier's `incomePerHr`. A daily-tending owner
  pays ~20% of gross income as upkeep — a flat recurring tax that scales with the empire.
- **Lazy accrual (§7.1, no ticks)**: upkeep owed = `upkeepPerHr × min(elapsed since upkeep_at,
  BUSINESS_UPKEEP_CAP_MS)` — its OWN clock, distinct from the income clock. Income caps at 24h
  (`BUSINESS_CAP_MS`); upkeep accrues up to `BUSINESS_UPKEEP_CAP_MS` (7 days). So an absent owner
  earns at most 24h of income but owes up to a week of upkeep — neglect BLEEDS. Active owners break
  ~even on the tax; over-expanders run at a loss.
- **Pay it**: `POST /v1/business/upkeep` pays the pad on every front you can afford (greedy —
  a cash-strapped owner reactivates what they can), a §10.4 cash SINK `business:upkeep` (rides the
  existing `business:` prefix — zero invariant changes; `character_id` reconciles check (a)).
- **The cold penalty**: a front unpaid past `BUSINESS_UPKEEP_COLD_MS` (3 days) goes **cold** —
  it produces NO income (collect skips it), and launder/upgrade refuse it — until the pad is paid.
  Income still caps at 24h while cold, so neglect costs the withheld income too (a real loss, not
  a claimable backlog). Paying the pad thaws it.
- Upgrading a front resets its upkeep clock (the upgrade squares the books — it's already a big
  sink, and this avoids a retroactive rate bump on the accrued debt).

§10.4: one new cash sink reason (`business:upkeep`), already inside the `business:` vocabulary —
nothing else changes. Numbers are founder sign-off levers (ground rule #1). Suite + sim gate.

## 3. Why this shape
- **Wealth-scaling by construction** — more/higher-tier fronts = more upkeep. The sink grows with
  exactly the wealth it needs to drain.
- **Rewards attention, punishes hoarding** — the passive-income stack now demands active tending;
  a safehoused landlord who never surfaces watches fronts go cold.
- **Clean** — separate clock from income, one sink reason, a boolean cold gate; no netting math,
  no negative-cash surprise, no §10.4 surface beyond the ledgered sink.

## 4. Step two — territory-racket upkeep (BUILT)
The same pattern at the GANG level: every territory racket owes a pad = `TERRITORY_UPKEEP_BPS`
(2000 = 20%) of its `incomePerHr`, accrued lazily on its own clock (`territory_rackets.upkeep_at`)
up to `TERRITORY_UPKEEP_CAP_MS` (7d). A boss/underboss pays it from the **treasury**
(`POST /v1/territory/upkeep`, greedy per-operation) — a §10.4 treasury cash SINK
`territory:upkeep` (character_id NULL, counterparty = the gang; the invariant treasury check
subtracts it alongside `territory:establish`; `territory:` prefix already vocabularied — no
change). Unpaid past `TERRITORY_UPKEEP_COLD_MS` (3d) an operation goes COLD:
`collectTerritory` skips it (the take is lost, not banked), `upgradeRacket` throws `cold`, until
the pad thaws it. Upgrade squares the clock; **seizure hands the victor a fresh clock** (a seized
racket is never born cold, and the old owner's arrears don't follow the turf). View
(`territoryOf`) surfaces `upkeepPerHr`/`upkeepOwed`/`cold`. `test/social.js`: rank gate, the
view fields, a ledgered treasury pay resetting the clock, the cold gate (no income / no upgrade)
+ thaw, and the treasury §10.4 reconcile with `territory:upkeep` in the mix. Suite 16/16 + sim
drift-0. Numbers are founder sign-off levers.

## 5. Step three — crew wages ("the nut") — BUILT
The pattern applied to the KITCHEN crew — the offline drug-selling workforce (each member moves
~1 unit/min from the stash via §7.1 accrual). Each corner man draws `CREW_WAGE_PER_HR` ($1,200)
whether the stash moves or not (you pay them to stand the corner), accrued on the crew's own clock
(`characters.crew_paid_at`, stamped/reset on each hire and each payment) up to `CREW_WAGE_CAP_MS`
(7d). `payCrewWages` (`POST /v1/kitchen/crew/wages`) covers the nut — a §10.4 cash SINK
`crew:wages` (added to the cash vocabulary beside `crew:hire`/`crew:sales`) — all-or-nothing (a
single crew is a single obligation). Unpaid past `CREW_WAGE_COLD_MS` (3d) the crew goes COLD:
the accrual crew-sales block skips them (`crewCold(ch)` gate) — the stash just sits, nothing
minted or lost but the sales — until the nut is paid. The view surfaces `crewWagePerHr`/
`crewWageOwed`/`crewCold`. This is the only recurring sink that gates an OFFLINE (accrual) faucet
rather than an on-demand collect. `test/growth.js`: the view fields, a ledgered pay resetting the
clock, the cold gate (a cold crew moves NOTHING across a big accrual window) + thaw. Suite 16/16 +
sim drift-0. Numbers are founder sign-off levers.

## 6. Roadmap (the pattern generalizes — deferred)
One recurring-sink candidate remains flagged:
- **The city pad / bribery** — a heat-scaled weekly protection payment (touches the D-signed heat
  surfaces, so a founder design call, not just a lever).
Steps one (business fronts / character cash), two (territory rackets / gang treasury), and three
(crew wages / offline kitchen faucet) now cover the personal, family, and passive-labor economies.
