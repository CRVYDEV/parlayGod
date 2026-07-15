# OMERTÀ Risk-to-Earn — Phase 4: Backed Emission (detailed design)

**Status: DRAFT → building.** Parent: `omerta-risk-to-earn-design.md`. This is the tokenomics
capstone — it closes the audit's **#1 finding**: the fixed 14% staking APY is the *only unbounded
$OMR mint*, and it structurally out-runs every sink, so net supply grows for any realistic
population. Phase 2 (the Vig) explicitly flagged that this must "land close behind, so in-game
emission can't outrun the Vig and bloat the withdrawal queue." Phase 4 does exactly that.

Off-chain, no new extraction, no chain work — so no new regulatory surface. Numbers are proposed
defaults (founder sim + sign-off, ground rule #1).

---

## 1. The problem, precisely

Today (verified in source): staking rewards accrue lazily at `staked × APY × dt` into
`account_persistent.rewards` (an un-ledgered pending IOU, `accrual.js:119-122`), and at
`claimRewards`/`unstake` they are **minted** into circulation — `acct.omr += rewards` with a
`stake:reward` ledger row that §10.4 counts in the **mint** term (`economy.js:326,334`;
`invariants.js` omrMints). So every claimed reward is brand-new $OMR from nothing, at 14%/yr,
forever, with no matching sink. The economy audit quantified: no combination of the M8 sinks
absorbs this; supply grows, the in-game AMM price of $OMR decays, and the withdrawal queue bloats.

## 2. The fix: pay rewards from a funded pool, don't mint them

Mirror the on-chain `OMRStaking` contract, which pays rewards **only from a pre-funded pool**
(principal always withdrawable, APY ceiling). Bring the in-game staking into the same shape:

- A new soft-$OMR bucket **`stake_pool`** (a singleton), added to the §10.4 $OMR total.
- Staking reward **payout** (at claim/unstake) is paid **from `stake_pool`**, capped by its
  balance — `stake:reward` becomes a **TRANSFER** (pool → account), removed from the §10.4 mint
  term. **No new $OMR is ever minted by staking.**
- The pool is **funded by the existing buyback** (a slice of what the 12h buyback buys off the
  AMM with accumulated street-tax cash). So the economy's **cash sinks fund staking yield** — a
  pure redistribution of the genesis pool, not new emission. When cash-sink activity is high the
  pool fills and yield is full (up to the target APY); when it's low the pool thins and yield
  throttles. Emission is now **bounded by economic activity, by construction.**

### 2.1 What changes, mechanically
- **Accrual** (`accrual.js`): unchanged — the computed reward still accrues into `acct.rewards` as
  a pending figure. (It's the *upper bound* on what you can claim; the pool decides what actually
  pays.)
- **Payout** (`economy.js` `claimRewards` + `unstake`): `paid = min(acct.rewards, stake_pool)`;
  `stake_pool -= paid`; `acct.omr += paid`; `acct.rewards -= paid` (the unpaid remainder STAYS
  pending — no forfeit — claimable once the pool refills); ledger `stake:reward` `+paid` as a
  transfer. If the pool is dry, `paid = 0` and nothing claims (try again later). `unstake` always
  returns **principal in full** (never pool-gated — principal is the player's own $OMR, a bucket
  move); only the reward portion is pool-backed.
- **Funding** (`worker.js` buyback): after the buyback buys `bought` $OMR off the AMM, a
  `STAKE_POOL_BPS` slice goes to `stake_pool` (before/alongside the family + fund split). This is a
  bucket transfer within the §10.4 $OMR set (amm reserve → stake_pool) — conserves, no mint.
- **View**: expose `stakeClaimable = min(rewards, poolShare)` alongside the accrued `rewards`, so
  players see what's actually payable now, plus a pool-health gauge.

### 2.2 §10.4 (walked)
- `omrBuckets` gains `SUM(balance) FROM stake_pool`.
- `stake:reward` moves OUT of the omr **mint** term (it's now a transfer, in neither mint nor burn).
- Payout: account `+paid` (in buckets) / pool `-paid` (in buckets) → nets zero; the ledger row is
  the account side, the pool side is a bucket UPDATE (like the buyback's other distributions).
- Buyback funding: amm `omr_reserve -slice` / stake_pool `+slice` → nets zero, no ledger (internal
  redistribution, exactly like the existing gang/fund buyback split).
- **Result:** staking contributes **zero** to net $OMR supply. The total stays `20000 + capped
  missions + backed prizes − burns` — staking is pure redistribution. This is the fix.

## 3. Recurring sink pairing (P4.2, lighter): territory rent

To further tilt the sink/faucet balance (the audit wanted more recurring sinks), a territory
racket costs a small **$OMR rent per collect** (`TERRITORY_RENT_OMR`, paid from the family reserve;
a §10.4 burn `territory:rent`). It makes the productive asset cost something to run (a family needs
$OMR from tribute/buyback to keep its cash operations turning), and it's a recurring drain that
scales with how much territory exists. Non-payment doesn't seize the racket (that stays a war
mechanic) — it just means you can't collect until the reserve can cover the rent. *Optional in this
phase; include if the emission fix alone doesn't balance in sim.* Built behind its own constant so
it can ship at 0.

## 4. Build plan
1. **schema**: `stake_pool` singleton (soft $OMR), seeded 0.
2. **invariants.js**: add the `stake_pool` bucket; drop `stake:reward` from the mint term (it's a
   transfer now); `territory:rent` into the omr burn term + vocabulary if P4.2 ships.
3. **economy.js**: `claimRewards`/`unstake` pay from the pool (capped, no-forfeit remainder,
   principal always whole).
4. **worker.js**: buyback funds `stake_pool` with the `STAKE_POOL_BPS` slice.
5. **rules.js**: `STAKE_POOL_BPS` (buyback slice → pool), keep `APY` as the *cap* (you never earn
   MORE than the target rate; the pool only ever throttles it down); `TERRITORY_RENT_OMR` (P4.2).
6. **routes**: `GET /v1/mod/emission` (pool balance, effective-APY gauge, runway); `POST
   /v1/mod/emission/fund` (ops/test top-up, like reserve/fund). View exposes `stakeClaimable`.
7. **tests**: `test/economy.js` — a claim pays only what the pool holds (throttle), the buyback
   funds the pool, principal always returns whole, and §10.4 holds with `stake:reward` as a
   transfer (staking no longer inflates the total). Full suite green.

## 5. What this delivers
Staking stops being an inflation engine and becomes a **redistribution** engine: cash sinks (street
tax → buyback) fund staker yield, capped by real economic activity. Combined with Phase 2 (hard
extraction ≤ real revenue) and Phase 1 (staking as the safe harbour for lootable $OMR), the token
now has: bounded soft supply, revenue-backed hard extraction, and a reason to stake that doesn't
print money. That's a durable Risk-to-Earn economy rather than a season-one bull that inflates to
death. Every number stays a founder sign-off lever; the deepest one (the target APY itself) is now
a *ceiling* on a backed rate, not an unbounded promise.
