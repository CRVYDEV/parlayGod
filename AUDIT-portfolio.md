# AUDIT — The Portfolio ("Going Legit" / RWA) + all contract interactions

Max-effort five-lens red-team over the R1 Portfolio (RWA stocks) — the personal + family holdings
layer, the step-two earn hooks (big-score cut, season prize, RICO graduation), and the chain
containment — plus a full re-verification of the backend↔contract boundary and the Solidity suite.
Each lens ran independently; every finding was verified against source before any fix.

## Verdict

**No CRITICAL, no HIGH.** The feature is sound by construction: the status/currency split holds
(§10.4 exact), the Portfolio is fully chain-contained (the hard line), death/estate survival is
correct, and the contract interactions are unchanged and sound. Fixed in-commit: **one MED design
hole** (structuring defeated the RICO-graduation intent) and **four LOW** hardenings (a latent
concurrency window, a defensive guard, an actor-gate consistency gap, a heat clamp). Regression per
fix; suite 21/21 + sim drift-0.

## Lens results

| Lens | Result |
|---|---|
| §10.4 ledger conservation | CLEAN — shares are never a reconciled currency; the `rwa:invest` burn is exact on BOTH the account bucket and the gang-reserve bucket; grants/prices are display-only |
| Concurrency / locks / persist-clobber | CLEAN — **no persist path ever writes the portfolio tables**, so clobber is impossible; one latent window (F3/F4 below) |
| Death / estate / cross-system | CLEAN — `portfolios` never wiped (heir inherits); `kept.portfolio` populated on every death path; single dissolution path; **no sell/withdraw/chain payout exists** |
| Internals / input / exploit | The flagged NaN-through-`validAmount` vector is **RULED OUT** (`!Number.isFinite` short-circuits first); no divide-by-zero; one MED (F1 structuring) |
| Chain + all contract interactions | Goal A **CONFIRMED CONTAINED** (zero chain reach, no dormant hook); Goal B **VERIFIED SOUND** (EIP-712 parity, full-reserve queue, fee idempotency, no owner-mint/reentrancy) |

## Fixes applied (verified against source; regression each)

**F1 — MED (design hole): structuring defeated the RICO graduation.** `invest`'s scrutiny/heat +
safehouse gate fired only per-call at `≥ SCRUTINY_MIN_OMR` (1000) with no aggregate — so investing
999 $OMR on repeat converted unlimited $OMR into death-proof status while never drawing a point of
heat and never being safehouse-blocked, making the Law tie-in cosmetic. **Fix:** scrutiny is now
CUMULATIVE over a rolling window — new `characters.rwa_used`/`rwa_at` (the D3 `wash_used` token-bucket
twin, carried by `persistCharacter`); a windowed sum crossing `SCRUTINY_MIN_OMR` trips heat + the
safehouse block, so repeated sub-threshold buys still get caught. `SCRUTINY_WINDOW_MS` (24h) is a new
`PORTFOLIO` sign-off lever. (`portfolio.js:invest`, `rules.js`, `schema.sql`, `game.js:persistCharacter`.)

**F3/F4 — LOW (latent concurrency): the season prize was the only `portfolios` writer holding no
character lock.** In `runSeasonRollover` the prize grant loop wrote `portfolios` before the reset
loop locked each character — a latent lost-update/deadlock vs a concurrent same-ticker `invest`,
guarded today only by `SCORE_TICKER ≠ SEASON_TICKER`. **Fix:** the grant is deferred INTO the reset
loop and runs under the winner's `char FOR UPDATE` lock, restoring the canonical char→portfolios
order (the same order `invest` uses), so no cycle and no lost update regardless of the ticker levers.
(Adding a naive `FOR UPDATE` to `grantShares` would have *introduced* the deadlock — the correct fix
is lock-ordering.) (`worker.js:runSeasonRollover`.)

**F2 — LOW (defensive): `familyInvest` lacked the `if (!g)` gang guard** every sibling has. Unreachable
via `loadOwned` (role truthy ⟹ gangId truthy, and the rank gate rejects a null role first), but added
for parity. (`portfolio.js:familyInvest`.)

**F4b — LOW (consistency): `invest` had no jailed gate.** Unlike `swap`/`shakedown`/every other
extraction-adjacent act, `invest` let a jailed player move money into legit fronts. **Fix:** a `jailed`
gate (you can't work the books from a cell) — forward-safety before R3 opens on-chain extraction.
(`portfolio.js:invest`.)

**F7 — LOW (consistency): the RICO-graduation heat add wasn't clamped.** `ch.heat += SCRUTINY_HEAT`
could exceed 100 (matching the unclamped fire/launder precedent, but the business-raid audit clamps
its equivalent). **Fix:** `Math.min(100, …)` — the accrual meter already reads a clamped value, so this
is cosmetic parity. (`portfolio.js:invest`.)

## Accepted as-is (flagged, not patched)

- **F3 — leaderboard full-scan + un-rate-limited GET** (`portfolioLeaderboard`): alpha-acceptable,
  identical to the hitmen board; small tables. Flag for scale.
- **F5 — free-share grants are farmable but status-only**: the big-score cut is bounded by the heist
  cooldown; the season prize by an expensive respect grind. Neither moves §10.4 value — only the
  status leaderboard — matching the hitman-rep / fight-fix Sybil posture.
- **Chain daily-cap liveness + `OmertaFees` forward-DoS**: previously-accepted, fail-closed, Safe-
  recoverable (no value leak).

## Chain containment (the hard line) — CONFIRMED

The R1 Portfolio has **zero reach into any chain surface**: `portfolio.js`/`heists.js`/`worker.js`
import only game/rules/vanity; the only tables touched are `portfolios`/`gang_portfolios`/
`gangs.omr_reserve` (no wallet, no on-chain flag, no voucher column); `chain.js`/`fees.js`/`watcher.js`
never reference a share; and `POST /v1/withdraw` debits the `account_persistent.omr` *currency*, never
a holding. No sell/redeem/backed/onchain field exists on `PORTFOLIO` — R2/R3 are comments only, with
no half-wired param a future dev could flip. A share is structurally incapable of becoming a voucher.

## Contract interactions (Goal B) — SOUND

EIP-712 domain + typehash field order are in exact parity (`chain.js` ⟷ `VoucherClaim.sol`); the
full-reserve queue counts committed-ever vs `funded_omr` (never freed by a claim) so the tranche can't
be double-spent; `recordFeePayment` is idempotent on the nonce PK and `reconcileFees` is claim-then-
credit atomic; no reachable owner-mint, the gear cap is fail-closed, staking pays only from its funded
pool, `OmertaFees` custodies nothing; `claim`/fee paths are `nonReentrant` + set state before the
external call. The standing pre-mainnet residual is unchanged: `forge test` runs 39/39 green in CI
(GitHub Actions), and a third-party audit of contracts **and** signer remains the mainnet gate.
