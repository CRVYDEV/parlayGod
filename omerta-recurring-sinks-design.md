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

## 4. Roadmap (the pattern generalizes — deferred)
The same lazy-owed-debt + pay + cold-penalty pattern extends to:
- **Territory racket upkeep** (gang treasury pays; a gang-level recurring drain on held rackets).
- **Crew wages** (recurring payroll on the kitchen crew — unpaid crews defect/rat).
- **The city pad / bribery** — a heat-scaled weekly protection payment (touches the D-signed heat
  surfaces, so a founder call).
Each is a follow-up drop; step one proves the pattern on the cleanest surface (character-owned
fronts, which already carry lazy income + scrutiny state).
