# AUDIT — full-system max-effort red-team (M1 → M8 + Risk-to-Earn + chain)

**Date:** 2026-07-17 · **Scope:** the entire OMERTÀ backend and contracts. Six independent
red-team agents, one per lens, each reading its subsystem end to end and verifying every claim
against the code before reporting. Deepest sweep to date.

| Lens | Files | Verdict |
|------|-------|---------|
| §10.4 ledger + economy core | invariants, economy, accrual, vig, worker + every ledger path | **No conservation drift.** 1 balance flag |
| PvP / death / lock order | social, game + all two-party callers | 1 HIGH (zombie gang), 1 MED, 1 LOW |
| Income loops + casino | kitchen, growth, business, territory, casino, accrual | No mint/leak. 1 design call, warts |
| Chain layer + contracts | chain, fees, watcher, vig, `omerta-contracts/` | **No CRITICAL.** 2 MED (recovery), LOWs |
| Auth / infra / limits / mod | auth, ratelimit, server, worker | **No auth bypass, no injection.** 3 MED |
| Cross-system exploit chains | all modules × each other | No mint/extraction breach. 1 LOW drift, design calls |

**Bottom line:** the money backbone (§10.4), the chain reserve queue (extraction ≤ inflow), the
signer/typehash parity, and the auth/idempotency perimeter all hold. The confirmed bugs were
correctness gaps — a concurrency hole that orphans a family, two chain recovery gaps, three mod/
infra hardening gaps, and one reintroduced sub-dollar drift — all fixed in-commit with regressions.
Full suite 13/13 + `tools/sim.js` §10.4 drift-0 after the fixes.

`forge test` **still has not run in any session** (Foundry hosts are egress-blocked here). The
Solidity suite reads correct — no owner-mint, gear fail-closed behind the per-`gearId` cap,
CEI+reentrancy on the fee tollbooth, no hardcoded chainId — but it must actually pass on a machine
with open egress before the third-party audit.

---

## Fixed in-commit (each with a regression where pg-mem can express it)

### HIGH
| # | Finding | Fix |
|---|---------|-----|
| P-HIGH | **Zombie gang.** `removeMember` deleted the caller's membership then ran a NON-locking "last member?" check; two simultaneous departures from a 2-member family each saw the other still present (READ COMMITTED) → neither ran dissolution → a memberless family that never self-heals: treasury/reserve/armory stranded (never `gang:dissolved`-ledgered = permanent §10.4 treasury drift), turf + territory held by a ghost, war/decree pointers dangling. | `SELECT 1 FROM gangs WHERE id=$1 FOR UPDATE` at the top of `removeMember` (mirrors `joinGang`), serializing the count check. In-order (the txn already holds the actor's character/account locks). |

### MED
| # | Finding | Fix |
|---|---------|-----|
| Chain-1 | **Gear withdrawal is unrecoverable.** `minted_onchain` flips at sign time (removing gear from play), but the backend has no mirror of the on-chain per-`gearId` cap and no re-sign path — a claim that reverts (cap) or the voucher expiring (24h) loses the gear with no trace. | `reclaimExpiredVouchers` (worker sweep): a signed gear voucher past `deadline + grace` restores `minted_onchain=false` (back into play). Converts permanent loss → auto-restore after the window. |
| Chain-2 | **Expired OMR vouchers strand funds + reserve.** A signed-unclaimed voucher past its 24h deadline can never be claimed (contract requires `block.timestamp ≤ deadline`), yet its $OMR stays burned AND its amount permanently consumes `committedOutstanding` (funded_omr never decrements) — locking honest withdrawers' room. | Same sweep: refund the burned $OMR (a `+withdraw:omr` row exactly reverses the burn — net 0, §10.4 exact) and `status='expired'` drops it from `committedOutstanding`, freeing the reserve. Grace window (1h default, > watcher confirmation lag) makes a double-pay-vs-claim race impossible; `markClaimed` guards `status<>'expired'`. |
| Auth-1 | **Post-commit referral masks a committed action as an error.** `maybeQualifyReferral` ran unguarded AFTER commit; if it threw (a 40P01 on `street_tax` under load, any DB error) the route returned non-2xx though the action committed → the idempotency hook released the key → a retry re-executed (double-spend). | Wrapped in its own try/catch — it's idempotent (`ref_paid`-guarded, re-checks every gate), so a post-commit failure is swallowed, never fails the request. |
| Auth-2 | **`mod/confiscate` mints on a negative amount.** `Number(-100)` was truthy, so `cash - (-100)` credited the player and drove `street_tax.pool` below zero — a §10.4-invisible mint into an unaudited buffer. | Clamp to `[0, pocket]`; a missing amount keeps "confiscate all", an explicit invalid/negative confiscates nothing. Regression added. |
| Auth-3 | **Worker jobs shared one try/catch.** A poison row in any early job (buyback, a sweep) aborted the whole tick every time → the nightly §10.4 drift monitor and later sweeps went dark, silently, with no alarm (the founder relies on that alarm). | Per-job isolation (`safe(label, fn)`): each job runs in its own catch; a failure logs and the rest — above all the invariant sweep — still run. |
| PvP-MED | **Mod-kill 500s on a war-partner deadlock.** `runEstate → removeMember`'s dissolution clears the war partner then deletes itself (unsorted) → AB-BA vs `resolveWarIfDue`; every player path is `deadlockToRetry`-wrapped except the hand-rolled mod-kill txn. | `deadlockToRetry` exported and applied to the mod-kill catch (40P01 → clean `contention` retry). |

### LOW
| # | Finding | Fix |
|---|---------|-----|
| Auth-L1 | `MOD_KEY` compared with `!==` (not constant-time) | `crypto.timingSafeEqual`, length-guarded |
| Auth-L2 | `sweepExpiredBounties` rethrew on one poison pot, aborting the batch | Per-pot isolation (log-and-continue) |
| Chain-L1 | `walletVerify` uniqueness TOCTOU → raw 500 for the racing loser | Catch `23505` → clean `wallet_taken` |
| Income-L2 | `launder`/`shakedown` heat not clamped to 100 (fed the raid roll harder than intended; never in the player's favour) | `Math.min(100, …)` on both |

## Founder design calls — NOT patched (ground rule #1), ranked

1. **Purchasable Commission standing × family-contract cashout (the strongest chain).** Standing
   = lifetime tribute, purchasable 1:1 into your own treasury and never-decaying; the family-contract
   funder-lockout is defeated by any non-member alt (or leave→kill→rejoin, immediate join). Net: a
   boss recovers tributed cash to a personal pocket at ~2% cost while keeping the standing — so
   head-seat + veto power costs ~2% of the tribute, not the locked tribute. §10.4 stays exact
   (nothing mints). Dials: exclude recent leavers / a rejoin-after-collect cooldown; decay
   `lifetime_tribute` or subtract family-contract outflows from standing.
2. **Casino faucets are unbacked** (two independent lenses). House games mint the 1% street-tax
   cut on top of the burned edge rather than carving it from the stake (`casino.js` playDice/
   playNumbers/betFight — invisible to §10.4 because `street_tax.pool` is unaudited); and
   `casino:rakeback` (1% of server-wide den volume) is a separate faucet with no offsetting sink.
   Both are bounded (self-farming is −EV) but inflate the RTE cash→buyback→reserve loop with
   activity, not risk. Dial: source both from the collected edge (cap at edge), and carve the
   street cut from the stake like every other `takeHouse` caller.
3. **The fight FIX is Sybil-scalable +EV.** A neon-holding boss sets the result; every conspirator
   who bet the fixed side wins deterministically (~$8k/bettor/week, one bet/char/week, not
   agent-gated) → ~$347k/week at 50 alts. Documented turf perk; dial: cap total fixed-side payout/
   week or gate fight betting behind level/anti-alt.
4. **Cross-env replay surface**: SIWE is EIP-191 personal_sign (not EIP-4361 domain/chain-bound);
   X sign-in trusts any app's user token (no `aud` pin). Both bounded (per-account nonce + expiry;
   inherent to the token-userinfo pattern). Consider EIP-4361 + OIDC `id_token` if these become
   hard trust anchors.
5. **Accepted-as-designed / known:** insurance remainder forfeiture (documented "insurers pay what
   premiums funded"); lazy raid resolution lets wash-and-abandon dodge the fine (forfeits the
   abandoned front's own income only); season rollover is one big txn (batching/availability, not
   correctness); multi-use invite double-consume race (wastage, no dup account); per-IP throttle
   still absent (the standing AUDIT.md call); third-character estate row-locks after accounts
   (degrades to `contention`, not corruption). PvP-LOW.

## Verified clean (the load-bearing claims, confirmed by ≥1 lens)

- **§10.4 conservation holds** across every faucet/sink; the AUDIT-content-drops fixes
  (convoy underwriting-limit, toll credit-check, stake-pool, whack:loot, estate) are
  mathematically sound; the reason vocabulary is complete; `transactions.amount` NUMERIC so
  fractional $OMR ledgers exactly.
- **Chain**: signer/typehash parity exact (not forgeable/unspendable); full-reserve queue
  conserves (no reserve double-spend, nonce monotonic, debit⇄voucher atomic); mint gate on both
  withdrawal paths; fee idempotency + atomic reconcile; reorg-safe watcher; Vig extraction ≤ inflow;
  contracts mint nothing.
- **Locks/estate**: heist execute (members-sorted→heist→business), convoy (owner char never locked
  by an ambush), buyback (amm→gangs→street_tax), war-score single `WHERE id IN` — all acyclic;
  persistCharacter clobber guards all correct (killer-as-funder/guard threaded, members SQL-only);
  runEstate wipes/transfers every owned table and ledgers every currency out.
- **Perimeter**: every mutating route auth'd + rate-limited + idempotent (reserve-before-execute,
  body-bound, 2xx-only); no unparameterized SQL anywhere; Privy JWT hardened; value inputs
  floored + positivity-guarded.
- **Casino**: no den path touches $OMR (the regulatory line); no +EV house game; seed draws not
  manipulable/early/double-claimable; income-clock aliasing telescopes to ≤ one window; token
  buckets leak correctly.
