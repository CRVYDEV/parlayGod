# AUDIT — the post-sign-off content drops (vendettas, crew heists, convoys, the Commission)

**Date:** 2026-07-16 · **Scope:** everything shipped after `AUDIT-sim.md` — vendettas & blood
feuds, crew heists (steps 1+2: roles, the Inside Job), smuggling convoys (steps 1+2: tolls,
multi-ambush, insured freight), the Commission (steps 1+2: weighted ballots, the veto) — plus a
cross-system sweep of §10.4 completeness, the estate machinery, the global lock order, rate
limits/idempotency, and the (dormant) chain boundary.

**Method:** five independent red-team agents (one per system + one cross-system), every claim
verified against the code end to end, confirmed bugs fixed in-commit with regressions, design
calls left unpatched and listed for founder sign-off (ground rule #1).

**Chain status:** the Solidity suite is UNCHANGED since its own audit (`AUDIT-contracts.md`) —
every new feature is deliberately off-chain, and the cross-system sweep confirmed zero new code
touches vouchers/reserve/wallet/$OMR mint paths. `forge test` remains un-runnable from this
environment (the network policy 403-blocks the Foundry hosts) — **it must run on a machine with
open egress before the third-party audit**. Nothing in this audit changes contract risk.

**Result:** 6 HIGH, 6 MED, ~15 LOW findings; all confirmed bugs fixed same-day; full suite
13/13 and `tools/sim.js` §10.4 drift-0 after the fixes.

---

## Fixed in-commit (each with a regression where pg-mem can express it)

### The Commission
| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| C1 | HIGH | **Ghost governance**: a dissolved family's ballot still counted (tally has no gangs join) while vanishing from the public board (which joins gangs) — cast max-weight, dissolve, govern invisibly; dissolve→refound even re-voted the same week | Dissolution now deletes the family's ballots (`removeMember`); veto records survive on a LEFT JOIN (the decree it killed was killed while it lived). Test: the 8-7 pax flips to a 7-7 deadlock the moment the fifth family dissolves |
| C2 | HIGH | **Unbounded electorate**: seat membership was checked only at cast — every family that transited the top-5 during a week kept a counted ballot, and leapfrogging standings could stack multiple weight-5 ballots (legit ceiling 15; actual unbounded) | Ballots now stamp the family's **standing** at cast (re-cast refreshes); the tally ranks the week's frozen ballots by the stamp, counts only the top `SEATS`, and derives weights 5..1 from the rank. Bounded at 15 by construction; stale "I was head for a minute" ballots rank where they belong. Tests: transit ballot outranked, six-ballot week counts five, deadlocks preserved |
| C3 | MED | Seat sort had no tiebreaker — tied standings made seating/head/veto rights flap between reads | `ORDER BY standing DESC, id` |
| C4 | LOW | castVote/vetoDecree check-then-insert races 500'd on the PK for the loser | UPDATE-first upsert + caught conflicts → clean `again`/`vetoed` errors |
| C5 | LOW | No lifecycle test — the tally was only ever fed hand-seeded SQL rows | A REAL cast ballot is shifted one week back and read as the governing decree |

### Vendettas
| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| V1 | LOW/MED | The DIRECTED_MIN **waiver applied to hospitalize pots** — a manufactured vendetta (sacrifice a throwaway street) re-opened the $500 directed-hospitalize squat that DIRECTED_MIN priced out (kill pots can't be squatted — they pay any killer; hospitalize pots stay exclusive) | Waiver is now **kill-only** — vengeance means a body. Regression: directed hospitalize at $600 refuses `directed_min` even under a live vendetta |
| V2 | LOW | Sweep race: the hourly expired-row DELETE between runEstate's SELECT and UPDATE silently lost a refreshed vendetta while still notifying the heir | UPDATE-first, INSERT on zero rows — either the row is locked (the sweep's re-check then skips it) or the INSERT writes fresh |

### Crew heists
| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| H1 | HIGH | **No safehouse gate anywhere** — plan/join/execute (including the Inside Job, functionally a bigger shakedown) all worked from the bunker, violating the signed P1.3/D2 principle that every analogous act obeys | `safe` gate on plan/join (gateJoiner), the leader at execute, and the whole crew in readiness. Regression added |
| H2 | HIGH | **The Inside Job skipped the Bureau**: it read pending income without `resolveScrutiny`, so an alt crew could raid the owner's own hot front and spirit 60% of the pending income away from a near-certain raid (and shrink what the raid could seize) | A raid-eligible front (`scrutiny ≥ threshold`) now refuses the job (`feds_watching`) — the owner must touch the front and eat the raid roll before any crew can rob it. Regression added |
| H3 | MED | **Lock-order inversion**: execute locked the heist row BEFORE member characters (the file's own header says the opposite); leave/join lock member-char → heist row → AB-BA deadlock, trivially griefable by spamming leave during the execute window | Execute now reads the heist unlocked, locks member characters sorted, THEN locks the heist row and re-verifies the crew set (`crew_changed` on a race). Order restored: characters → pots |
| H4 | MED | **Residual pairwise deadlock**: withCharacter locks the leader first regardless of id, so a member's own PvP action (fire/jump/shakedown, sorted two-char locks) can AB-BA a concurrent execute | Postgres 40P01 is now mapped to a clean retryable `contention` error in both withCharacter wrappers (nothing commits; pg-mem can't exercise it). Residual risk accepted: transient, self-resolving, no money path |
| H5 | MED | **The rat was trivially de-anonymized**: the public streets feed exposes `jailed`, and the rat was the only crew member walking free after a blown job | The law now hauls the informer in WITH the crew (same double stretch); the pay still lands quietly. The anonymity promise holds against the public roster. Test updated — this also closes the "rat for hire" grief margin a little (jail is now part of the rat's price) |
| H6 | LOW | Board scanned all-time `crew_heist_members`; no UNIQUE on (heist, role); zero-pot inside jobs paid full rep; dead-leader crews stranded silently; member arithmetic UPDATE on BIGINT respect | Board joins `status='planning'`; `UNIQUE (heist_id, role)` defense-in-depth; empty-till success pays 0 rep; estate notifies the stranded crew; member writes are absolute off the locked rows |

### Convoys
| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| K1 | HIGH | **Insurance was a collusion honeypot**: an alt hijack triggers a claim at will while the ring keeps (and resells) the goods — premium 10%, claim 50% of value, pool-capped ⇒ honest premiums skimmed at up to 80% efficiency per 30-min cycle; honest claims always found an empty pool | **The underwriting limit**: a claim is additionally capped at the account's lifetime premiums minus lifetime payouts. Honest shippers (premiums every run, claims rare) never feel it; a colluding ring's net extraction from the pool is **≤ 0 by construction**. Regression: a second shipper's premium is untouchable by the first's claim |
| K2 | HIGH | **Ambush-slot exhaustion**: attempts counted win or lose, so three throwaway alts could deliberately lose and make any convoy provably unambushable (and conversely, sacrificial losses wore the guards down for a real bandit) | Only **hijacks** consume the convoy's `MAX_AMBUSHES` slots and wear the guards; a loss costs only the loser (energy/ammo/hospital + their one play per convoy). Fake losses now do nothing for either side. Regressions both ways |
| K3 | MED | **The toll was 100% dodgeable** by two free bank calls around the collect | The toll reaches pocket **then bank** (the raid-fine precedent; the single ledger row stays exact — check (a) spans cash+bank) |
| K4 | MED | Missing actor gates: load/depart/collect ignored jail; collect (freight + toll + insurance settlement) worked from a safehouse — inconsistent with the signed D2 "collection is an exposed act" | Jail gates on load/depart/collect; safehouse blocks collect. D2 regression added |
| K5 | MED | **Toll drift on a dissolution race**: the treasury credit UPDATE could hit 0 rows (holder dissolved between read and write) while the ledger row and the debit still landed — a permanent §10.4 treasury alert | Credit-checked: no treasury row updated → no charge, no ledger row |
| K6 | LOW | Toll exemption used LIVE membership (join the holder family just before collect to skip it) while family-block/turf used the depart snapshot | The exemption now uses the depart snapshot (`owner_gang`) too — you ship under the flag you left with |

### Cross-system
| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| X1 | HIGH | **The bounty sweep's funder pre-lock was dead code**: `funder_gang IS NULL` on a NOT NULL column matched nothing, so the pots→characters lock inversion the sweep claimed to fix was still live (and its funder-set stability re-check compared `[]` to `[]`) | Predicate fixed to `NOT funder_gang` — character funders are pre-locked in sorted order again, the stability re-check is meaningful |

## Founder design calls (NOT patched — ground rule #1)

Ranked by how much they matter, with the dial if you want it:

1. **Commission standing is purchasable at ~zero net cost.** Tribute credits `lifetime_tribute`
   1:1 while the money lands in **your own treasury**, and standing never decays (not even at
   season rollover). The richest family can hold the head seat — and the veto monopoly —
   permanently. This ladder predates the Commission (it's the buyback split), but the Commission
   gives it its first hard governance power. Dials: a tribute take on standing, standing decay,
   or seasonal standing resets.
2. **Vendetta first-revenge pays 2× base rep** (the docs previously claimed the diminishing rule
   made it exactly 1×; the divisor counts the avenger's own prior kills of that bloodline, which
   is 0 on a first revenge — docs corrected to match the code). Bounded: one 2× per feud
   direction, then 2/k decay; farming is throttled economically (re-grind past the level floor,
   ammo, searches). Dial if you want revenge rep-neutral: divide by `priors + 2` on vendetta
   kills — one line.
3. **Insurance remainder forfeits silently** when the pool (or the new underwriting limit)
   underpays a claim — no pending-claim deferral (unlike stake_pool's precedent). Coherent and
   documented ("insurers only pay what premiums funded"), but a shipper can pay a full premium
   and collect ~nothing. Dial: keep `insured_loss` un-zeroed for the unpaid share + a claim
   route on done convoys.
4. **Omertà gang-churn bypasses** (leave → inside-job a former family front → rejoin; same class
   as every other family check under v24 immediate joining). The real fix is an apply/accept or
   cooldown on joining — the standing v24 design call.
5. **Open-season semantics**: the halved stay applies at ENTRY only, and the decree is perfectly
   predictable from the public votes — pre-buying a full stay before the week flips is free;
   also the decree halves duration at unchanged cost (effectively 2× the hourly price). Inherent
   to lazy design; symmetric; noted.
6. **Leader-rat griefing**: a leader can rat their own job — now costs 50% of their own stake
   PLUS the double jail (H5 made jail part of the rat's price), to put the crew in double jail.
   Expensive grief; acceptable for alpha.
7. **Known buckets, unchanged**: unauthenticated GETs (incl. `GET /v1/commission`) sit outside
   the rate limiter (the per-IP-throttle design call from AUDIT.md); done/lost convoy rows and
   finished-heist member rows accumulate (history, cheap, indexable later); a vendetta settled
   against a below-floor heir burns the 2× grant for 0 rep (anti-farm consistent).

## Verified clean (the load-bearing claims)

- **§10.4**: all nine new ledger reasons enumerated and in exactly the right check terms;
  every cash/treasury/pool mutation in the new systems pairs with a ledger row in the same
  transaction; goods, heist pots, and pending-income redirects are correctly OUTSIDE the money
  ledger (ownership/bounded-faucet moves); nothing new mints or touches $OMR. Sim drift-0.
- **Estate**: every new table is wiped, transferred, or safely orphaned on death; corpse
  refunds impossible (sweep re-checks `alive` under lock); dead marks void plans cleanly.
- **Idempotency/rate limits**: every new mutating route rides the token bucket + the
  reserve-before-execute Idempotency-Key machinery — a replayed execute/ambush returns the
  stored body without re-rolling.
- **pg-mem hygiene**: no new arithmetic UPDATEs on int-family columns (member writes now
  absolute), no correlated subqueries, no ANY(array) binds.
- **Vendetta mechanics**: max-not-stack bonus, append-only diminishing (refresh can't reset it),
  creation gated to real fire-kills (absorbs/tokens/NPC/mod never swear), heir semantics correct
  across double re-heirs, feud endpoint parameterized and leak-free.
