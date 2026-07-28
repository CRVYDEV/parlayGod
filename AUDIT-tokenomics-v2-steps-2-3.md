# RED-TEAM — tokenomics v2, steps 2 and 3

Point-in-time, 2026-07-28. Scope: everything the pivot changed after step 1 was audited —
the four retirements and what they left behind, the rewritten 12h buyback, the legacy-pool
merge, the DEX sell-tax ingest, the four-way bond split, and the lock order across all of it.
Diff range `09df142..HEAD` over `src/` + `schema.sql`.

Step 1 got its own five-lens pass (`AUDIT-tokenomics-v2.md`). That audit found a lock cycle
**armed by the migration itself** — one that only became reachable when `FUND_BPS` was raised
off zero, which is exactly what step 2 then did. That precedent is why this pass happened
before step 4 goes near `OMR.sol`.

**No CRITICAL. No HIGH. No §10.4 drift.**

---

## The claim that had to hold, and does

The entire pivot rests on one sentence: **nothing turns cash into $OMR any more.** Checked at
the source rather than by inspection of the retired routes — `invariants.js:omrMints` is the
enumerated set of everything that can create $OMR:

```
mission:%   ·   prize:omr   ·   emission:%
```

Mission rewards are gameplay-gated. `prize:omr` is backed by real ETH through the Vig.
`emission:%` is the Street Wage, drawn on the endowment and paid on respect gained. **None of
them takes cash as an input.** There is no path, direct or laundered through a third asset,
by which in-game cash becomes token supply. The thesis holds.

The window itself was re-read for the obvious attacks and is sound: the pool is locked
`FOR UPDATE` before the balance check and the burn happens after it, so the clamp cannot be
raced; a short till refuses and burns nothing; `cash = floor(omr × RATE)` rounds in the
house's favour, so no dust leaks out; the daily bucket decays from an absolute write rather
than accumulating.

---

## Fixed in this pass

### A1 (MED) — a $OMR migration gated on a CASH condition

`mergeLegacyYieldPools` ran **inside** `runBuyback`, after its early return:

```js
if (Number(peek.pool) <= 0 || (!opts.force && dueMs < BUYBACK_PERIOD_MS)) return null;
const merged = await mergeLegacyYieldPools(client);
```

So the merge only happened when the **street-tax cash pool was non-empty** and the 12h timer
was due. Those two conditions have nothing to do with the thing being merged.

What makes it bite is what step 2 removed alongside it. `stake_pool` and `rwa_dividend_pool`
now have **no other drain at all** — `claimDividend` is retired, and `payStakeRewards` went
with individual yield (see A2). This merge is their only exit. On a server whose take happens
to be quiet, it never runs, and real player-earned $OMR sits stranded permanently.

And **nothing would alarm.** Both pools are inside `omrBuckets`, so `$OMR conservation` stays
exact for the entire time the money is unreachable. The invariant is measuring the right
thing and would report perfect health.

**Fixed:** the merge is its own worker step (`mergeLegacyPools`), which is what it always
should have been — it is not the buyback's business. Lock order stake_pool →
rwa_dividend_pool → family_yield_pool; nothing else locks the first two, and every other
family_yield_pool writer takes it last, so it is acyclic against `payFamilyYield`
(gangs → pot) and the toll credit (account → pot).

**Regression** in `test/tokenomics.js`, mutation-verified: re-couple the merge to the cash
pool and it fails by name. The first version of that regression failed with a `TypeError`
rather than an assertion, which is a bad failure message for a real bug, so it now reads
`m?.merged ?? 0`.

### C1 (MED) — the agent board advertised a retired rail

`GET /v1/opportunities` is the surface `AGENTS.md` tells agents to **poll**. Its
`niches.laundering` entry read:

> Cash→$OMR via POST /v1/swap (located: docks/canal or your turf; draws heat). Sell direction ungated.

Every clause of that is now false, and it published an `ammSpot` price for a market that no
longer trades. This is worse than a stale comment: an agent has no way to tell a dead niche
from a live one except by burning calls on it and collecting `retired`.

**Fixed:** replaced with a `redemption` niche describing the window that actually exists,
carrying its live rate and till from `exchangeBoard`. `AGENTS.md`'s earn-loops table and its
niches paragraph updated to match.

**The test that should have caught this asserted the wrong property.** It checked
`typeof opp.niches.laundering.ammSpot === 'number'` — which stayed *true* for a whole release
after the rail was retired, because a stale niche still has a shape. Presence is not the
property that matters. It now asserts that no niche anywhere in the board sends an agent to
`/v1/swap`, which is the thing that would actually go wrong.

### A2 (LOW) — dead code that read as the live drain

`payStakeRewards` in `economy.js` had zero callers after step 2. Ordinarily a shrug — but it
was the only function in the tree that looked like a payout path for `stake_pool`, and A1 is
exactly the bug you get from reasoning that such a path exists. Deleted. `stake:reward` stays
in the §10.4 vocabulary because historical rows are real.

### A3 (LOW) — two orphaned signed levers

`CONSTANTS.STAKE_POOL_BPS` (3000) and `CONSTANTS.AMM_LP_BPS` (2500) have no readers: the
buyback no longer acquires $OMR, so neither carve exists. Both are **pinned** in
`test/levers.js`, and a pin dangling at a deleted constant fails the register — so they are
marked DEAD in place rather than removed, which also preserves the record of what they were.
Tuning either now does nothing.

### A4 (LOW) — a stale comment on a real-value path

`chain.js` documented the exit toll's §10.4 shape as `tax:buyback → stake_pool`.
`creditTollBuckets` was correctly repointed to `family_yield_pool` in step 2; the comment was
not. Corrected. (The parallel comment header in `tax.js` was already right — checked, not
assumed.)

---

## Verified clean

- **Conservation.** The retirements orphaned no ledger reason. `carveExchange` decrements
  `street_tax.pool` by exactly what it credits, and the fractional remainder below the floor
  simply rides to the next cycle. The merge is bucket-to-bucket, no row. The sell-tax ingest
  and the bond RWA slice write zero `transactions` rows — asserted by row count across a full
  re-sourcing cycle, not by argument.
- **`rwa_revenue` cannot be double-fed.** Its PK is `(source, ref)`; the tax path and the bond
  path use distinct sources, and each is idempotent on its own ref/nonce within the
  transaction that writes the parent row.
- **The window's lock discipline.** `redeem` locks the pool singleton LAST under the actor's
  char+account locks — the canonical order. `fundExchange` and `runBuyback` both take
  street_tax → exchange_pool. The pool is never acquired before something else.
- **No cycle around `family_yield_pool`.** Every writer except the merge takes it last. The
  merge takes it after two singletons that nothing else locks.
- **`recordSellTax` idempotency.** SELECT-then-INSERT with a `23505` catch that returns the
  duplicate case rather than raising — correct under a concurrent re-delivery of the same log.

---

## Flagged, not changed

- **`ops.js` still shows the AMM reserves** on the founder dashboard. The `omr_reserve` is
  legitimately still inside `omrBuckets` (the pool row is deliberately left alone rather than
  deleted), so the number is not wrong — it is just no longer a market price. A label change
  at most; the founder's own screen, not a player-facing lie.
- **`/v1/rules` publishes `BUSINESS_EMPIRE.SPECS`** including `accountant` and `fixer`, which
  now throw `retired`. The console never surfaced specs (deck-only), so there is no dead
  button; an agent reading the catalog gets a clean, explained refusal. Left as-is because
  removing them from the catalog would erase the record of what a save-game's existing
  `accountant` front is.
- **The step-5 RE-SIM**, unchanged by this pass and still the largest open item.
