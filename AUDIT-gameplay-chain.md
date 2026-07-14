# OMERTÀ Full Audit — gameplay loops, chain service, contracts, UX (2026-07-14)

A five-lens parallel audit of the whole system after M6-B/C landed: economy & loop
cohesion, social/PvP/death, onboarding/UX, off-chain chain-service security, and the
Solidity suite. Method: independent auditors, each verifying findings line-by-line against
source (no speculation), plus by-hand re-derivation of the §10.4 conservation math and the
D2b token-bucket. This doc records what was **fixed** in this pass, what is **flagged for
founder sign-off** (balance — ground rule #1), and the **UX roadmap**.

## Headline

The system is fundamentally sound. **No §10.4 leak exists** — every faucet/sink is ledgered
in the reason vocabulary. The D2b racket cap is **mathematically correct and non-gameable**.
The revive insurance is **concurrency-safe** and death/revive conservation was proven exact.
The contracts **mint nothing** and all prior audit fixes held. The withdrawal full-reserve
queue and EIP-712 parity are sound.

One real money bug was found and fixed (concurrent fee double-credit), along with a
free-reward exploit left by the Solana→EVM migration, a PvP griefing vector, and a batch of
contract/UX hardening. Two balance items and a set of pre-mainnet ops gates remain as
explicit decisions.

---

## Fixed in this pass (with regression tests)

| # | Sev | Area | Issue | Fix |
|---|-----|------|-------|-----|
| 1 | **HIGH** | chain (`fees.js`) | `reconcileFees` double-credited: pay one fee from an unlinked wallet, fire 5 concurrent `/wallet/verify` (burst=5, no idempotency key) → 5 tokens from one payment, repeatable. | Atomic claim-then-credit: `UPDATE … WHERE NOT credited RETURNING` so exactly one txn wins each row. Regression: concurrent double-reconcile nets exactly +1 (`test/chain.js`). |
| 2 | **HIGH** | UX (`growth.js`) | The dead Solana `POST /v1/wallet` still validated base58 and set `wallet_address` with **no proof**, satisfying the First-Week `ob_wallet` reward for free — and wrote a wrong-chain address the EVM withdraw path can't use. | Retired the base58 path (route now redirects to SIWE); `ob_wallet` gates on `wallet_address`, which only a proven 0x SIWE link sets. Tests updated (`growth.js`, `security.js`). |
| 3 | **MED** | social (`social.js`) | A revive wiped **all** hunters' searches — a target could bait the weakest hunter, burn one cheap token, and reset the entire manhunt (each search = 3h). | Revive no longer wipes target-wide searches (the shooter's was already spent). Regression: a second hunter's search survives a revive (`social.js`). |
| 4 | **MED** | UX (`fees.js`) | Paying real ETH (mint/respawn) credited silently — no notification, poll-only. Worst feedback moment in the funnel. | `notify('fee_credited')` on every credit + `notify('made')` on mint — offline-durable row + live push. |
| 5 | **LOW→**‑ | contract (`OmertaFees.sol`) | A zero/underpriced fee (Safe misconfig) → free entitlements + nonce spam. | `ZeroFee` revert in constructor + `setFees`; backend also skips crediting a zero-value payment (belt-and-suspenders). |
| 6 | LOW | economy (`game.js`) | Weekly family-contract $OMR moved fund→gang reserve **unledgered** (violates ground rule #4, invisible to the audit trail). | Ledgered as `family:weekly` (a recognized transfer reason, not a mint) at parity with `daily:all`/`referral`. |
| 7 | NIT | contract (`OmertaFees.sol`) | `sweep` routed rescued ETH to `feeRecipient` (could be the same misconfigured address). Fee-forward DoS assumption undocumented. | `sweep` → `owner()` (the Safe); NatSpec documents the recipient-must-accept-ETH invariant. |
| 8 | — | contract tests | `OmertaFees` had no revert/edge coverage. | Added: `ZeroFee`/`ZeroAddress` (ctor + setters), `ForwardFailed` (reverting receiver), `sweep`-to-owner, reentrant-recipient blocked, `setFeeRecipient` owner-gate. **`forge test` still unrun here — must pass locally before audit.** |
| 9 | — | UX (`server.js`) | Freshly-authed clients ate a `no_character` 400 from `/v1/me`; no pre-character probe. | Added `GET /v1/session` → `{authed, hasCharacter, minted, mintCredits, respawnTokens, wallet, canWithdraw}`. |

All 7 backend suites green after the changes.

---

## Verified sound (checked, no action)

- **§10.4 conservation** across every faucet/sink incl. death and revive (re-derived by hand:
  a dead row's ledger sum exactly offsets its baseline; heir legacy is ledgered).
- **D2b racket cap** — 12h/day steady state, 8h offline burst; can't be gamed via clock reset,
  season rollover, or the estate; does not throttle bank interest / crew / staking.
- **Withdrawal reserve integrity** — `requestWithdraw`/`drainQueue`/`fundReserve` all lock
  `chain_reserve FOR UPDATE`; no over-sign race; nonce `UNIQUE`; debit-before-sign; `markClaimed`
  idempotent.
- **`mint_credits`/`respawn_tokens` lost-update** — safe: every reader-modifier either holds the
  account row lock or uses an atomic in-DB `+1`; a fee `UPDATE` blocks on the game txn's lock and
  re-applies against the committed value.
- **Mint gate** — no path sets `minted` without a paid credit; both withdraw paths gate on it.
- **EIP-712 parity** — field order, domain, chainId, amount precision all match the contract.
- **Contracts** — nothing mints; `OmertaFees` custodies nothing (no `receive`/`fallback`); CEI +
  `nonReentrant` sufficient; prior fixes (gear cap, Safe-owned GearVault, TTL, chainId) intact.
- **Lock discipline** — global order (characters→accounts→gangs→singletons) respected; the fee
  watcher holds no character locks and can't deadlock.
- **Loop cohesion** — crime/kitchen/rackets/garage/staking/buyback all connect to live routes;
  no orphaned mechanics; the paywall is correctly **non-blocking** for free-to-play (only
  withdraw + gear-withdraw gate on `minted`).

---

## Flagged for founder sign-off (balance — no code change per ground rule #1)

1. **Bank interest is uncapped for online play.** `BANK_RATE` 2%/12h with only a per-gap
   offline cap means an always-online/bot account compounds ~4%/day vs a casual's ~1.33% —
   the single biggest cash faucet and a 3× active-vs-casual asymmetry. D2b deliberately
   excludes interest (it's time-proportional, not per-gap), so this is a **balance number**,
   not a bug. Options: a daily interest budget mirroring D2b, or a balance-tiered rate.
   *Needs re-sim + your number.*
2. **Deterministic trade-goods arbitrage.** `/market/prices` discloses every district's prices;
   a bot buys the cheapest, sells the dearest (~2.67× max spread), bounded only by cargo, $250
   travel, and 4% tax. Correctly ledgered (no leak), but a risk-free bot faucet. Was flagged in
   the original AUDIT.md as a design call; still open. Option: per-district slippage. *Needs
   sign-off.*
3. **Respawn insurance tuning** (design, not a bug): an insured target absorbs a hit and is
   instantly back at 100 HP; the shooter gets nothing. Consider a brief post-revive stagger/hosp
   window and/or a "drew blood" rep consolation so hits don't feel pointless. *Design call.*

---

## Pre-mainnet gates (chain not yet deployed; captured at the code site)

- **Fee/Claimed watcher backfill + confirmation depth** (worker.js — audit F2/F3). The watchers
  start at chain head with no cursor and no confirmations: a fee paid during worker downtime is
  never credited (player loses real ETH), and a reorged `Claimed` frees reserve the backend then
  over-signs against. `recordFeePayment`/`markClaimed` are idempotent, so the fix is safe:
  persist last-processed block, `getLogs({fromBlock})` on startup, wait N confirmations before
  freeing reserve. **Required before mainnet.** Documented in `worker.js`.
- **`forge test`** must pass locally on the full suite incl. the new `OmertaFees` tests.
- **Withdrawal-to-arbitrary-address** (chain.js): withdraw signs to any `body.address`, not
  necessarily the SIWE-linked wallet. Defensible (debits own balance, requires `minted`), but if
  policy is "withdraw only to your linked wallet," enforce `to === wallet_address`. *Policy call.*
- **SIWE message isn't EIP-4361** (no domain/URI/chainId binding). Cross-account replay is
  already prevented; adopting the full 4361 format adds phishing resistance. *Low, hardening.*
- **`gearNumId` maps gear→tokenId by live `MARKET` array index** — a future `rules.js` regen that
  reorders `MARKET` would remap minted tokenIds. Pin an explicit append-only gear→id map.

---

## UX roadmap (ranked by impact)

1. **(done) Notify on fee credit + "made"; add `/v1/session`.** Turns the paywall's silent
   moment into a payoff and gives clients a clean pre-character probe.
2. **(done) Kill the Solana wallet path.** Removes the most confusing dead-end in the cash-out
   funnel and a free-reward exploit.
3. **Persist offline-durable notifications for war-declared / tributed / turf-seized / weekly-done**
   — today these are ephemeral `bus` emits only, so offline gang members miss high-stakes events.
4. **Decide bounty-target notification policy** — currently only a public ticker emit; either
   alert the target or document it as intentionally silent.
5. **Surface the racket-income budget and effective bank APY in `/v1/me`** — the D2b cap silently
   reduces continuous collections; a readout stops it reading as a bug.
6. **Rename the overloaded "mint" routes** (`/gear/:id/mint` → `/craft`) — four surfaces, three
   meanings of "mint" is illegible to humans and agents.
7. **Agent self-state** — expose `agent`/rate-limit status in the session/me view; disclose the
   permanent trade-off at `agent-key` issuance.
8. **Net faucet/sink dashboard** — expose the per-reason ledger sums the invariant job already
   computes as a daily inflation gauge.

---

*Auditors verified against source; the balance items and pre-mainnet gates are decisions, not
defects. This pass fixed every confirmed correctness/security/UX bug it could without touching
sim-audited numbers.*
