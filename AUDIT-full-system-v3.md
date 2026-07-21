# AUDIT — full-system red-team v3

A max-effort whole-codebase audit, **five independent lenses in parallel** (§10.4/economy,
concurrency/locks/persist-clobber, death/estate/PvP, chain+contracts+auth+infra, cross-system
economic exploits). Every reported finding was re-verified against source by the synthesizer before
any fix; a regression accompanies each behavioural change. Suite 32/32 + sim drift-0 after the batch.

**No CRITICAL. No §10.4 drift.** Fixed in-commit:

## HIGH (config-gated)

**Chain F1 — reclaim-vs-claim double-spend on a signing-enabled-but-RPC-less box** (`chain.js`).
Voucher *signing* is gated on `{VOUCHER_SIGNER_PK, CHAIN_ID, VOUCHER_CLAIM_ADDRESS}` (never the RPC),
but the on-chain double-spend guard (`makeChainReader`) needs `CHAIN_RPC_URL`. `reclaimExpiredVouchers`
ran every worker tick and, with a null reader, took the wall-clock `deadline+grace` branch and
**refunded the burned $OMR** — treating "no reader" as "chain dormant". But a `signed` voucher only
exists because the chain was configured enough to sign it, so "no reader" can instead mean a
signing-enabled box whose RPC is unset/down, where the voucher may ALREADY be claimed on-chain →
refunding double-spends (tokens on-chain AND $OMR back), invisibly to §10.4 (the two rows net to zero).
The module's own comment flagged exactly this as CRITICAL and named the reader as the defense, but the
defense silently disabled itself in that config. **Fix:** without a reader the sweep now NEVER
refunds — it logs and skips (retry), matching the code's own "a delayed refund is recoverable, a
double-spend is not" principle already used for the RPC-error branch. A refund proceeds only when a
reader confirms `usedNonce === false`. `test/chain.js` now asserts the no-reader skip AND the
reader-confirmed refund (the previous no-reader-blind-refund assertions were the exact unsafe config).

## MED

**Death lens — `jump` was missing the jailed / witpro / penSafe / inHole victim gates** (`social.js`).
`fire`/`npcHit`/`shank`/`huntWanted` all refuse an unreachable target, but `jump` gated only
`hospitalized` + omertà — so a JAILED (or witness-protected, or yard-boss-protected, or hole'd) rival
could be robbed (`jump:steal`) and stacked with hospital time while locked in a cell, unable to flee or
safehouse. Jail was strictly more dangerous than the street — the exact class the v2 audit closed on
fire/npcHit, left un-applied to the one value-moving PvP path. §10.4 stayed exact (the steal is
ledgered), so it was a reachability-consistency hole, not a drift. **Fix:** added `jailed`/`witproActive`/
`penSafe`/`inHole` victim gates (safehouse stays intentionally omitted — a safe-housed man is still
jumpable, non-lethally, by design). Regression: a jailed target now returns `jailed`.

**Concurrency #2 — `store.js:grantPackage` lost-update on `wire_until` (a persist-list column)**.
The ETH Street-Wire grant read `wire_until` with a bare `SELECT` and wrote it ABSOLUTE, WITHOUT holding
the character `FOR UPDATE` lock, while running headless (`reconcileStore`/`sweepUncreditedStore`/the mod
grant). A concurrent `subscribeWire` (which mutates `wire_until` under the withCharacter char lock)
committing in the read→write gap was silently clobbered by the stale-read value — shortening a paid
window. It was the ONE persist-list column written headlessly by absolute SQL (every other direct-SQL
column is kept OUT of the persist list). **Fix:** the grant now `SELECT … FOR UPDATE`s the character row
(grantPackage locks no account row — its account updates are relative — so char-first adds no lock-order
inversion), serializing with `subscribeWire`.

## LOW

**Cross-system #1 — `nightlifeLeaderboard` omitted the agent-flag exclusion** (`speakeasy.js`). Unlike
`boxing`/`port`/`races` leaderboards, the renown board didn't filter `agent_flag` — and renown GATES
cosmetic decor unlocks, so an agent could top a "human" board and reach the renown-gated cosmetics.
**Fix:** both subqueries now `JOIN account_persistent … AND NOT a.agent_flag`, matching the precedent.

**Chain F4 — Privy `aud` compared as a scalar** (`auth.js`). A valid Privy JWT whose `aud` is `[appId]`
(OIDC permits an array audience) was rejected — fail-CLOSED (never accepts an invalid token), a
compatibility bug, not a bypass, but it would break real sign-ins on some app configs. **Fix:**
`Array.isArray(aud) ? aud.includes(appId) : aud === appId`, still fail-closed on absence/mismatch.

**Death lens F2 — `port_intercepts` orphaned a dead RUNNER's rows** (`social.js`). runEstate wiped a
dead PIRATE's intercept attempts (`character_id`) but not rows keyed on a dead runner's `boat_id` (the
boats being deleted). Pure row-hygiene (boat_id never re-collides). **Fix:** sweep them by the runner's
boats BEFORE the wipe loop removes the boats (the npc_hits both-sides precedent).

## Verified CLEAN (no defect — the §10.4 & death lenses returned effectively clean)

- **§10.4 economy:** an independent trace of ~260 ledger call-sites vs the four currency vocabularies +
  the gang-treasuries check + every escrow (bounty/market/order/loan/boxing-bet/auction/poker-tourney/
  convoy-insurance) found NO mis-vocabularied reason, NO unledgered value move, NO mint-on-top (the den
  book carves the take from realized profit), and confirmed the two new dividend pools + referral $OMR
  are within-bucket transfers, not mints. Drift-0.
- **Death/estate:** the 27-table wipe + all separate death handlers are complete; account-level
  survivors (portfolio/estate/auction/gear/prestige/$OMR/legends) never wiped; loot/refund killer-mirror
  discipline and shield ordering (bodyguard before the respawn token) sound; heir freshness clean.
- **Concurrency (verified sound):** boxing belt paths, territory lock order, casino takeHouse/tournament,
  vig/portfolio pool ordering, loan sweeps, speakeasy/convoy/world gang-before-singleton, and
  mint/reroll char→account are all consistent. The market bidListing/buyListing cross-refund AB-BA is a
  genuine cycle but **retry-mitigated** by `deadlockToRetry` (the documented auction accepted class) —
  flagged, not patched (the structural fix is a `withTwoCharacters` refactor).
- **Chain/contracts/auth/infra:** EIP-712 parity, the full-reserve queue (no double-sign past funded),
  fee/store/bond nonce idempotency + the txHash-gated real-revenue booking, the Solidity invariants
  (no owner mint, caps, CEI/reentrancy, OmertaBond sweep-guard), OpenAPI /v1/mod exclusion, timing-safe
  MOD_KEY, and the new `reroll` fee kind end-to-end — all sound. `X_TRUST_USER_TOKEN` (verifyX
  confused-deputy) is correctly default-off. `forge test` remains the pre-mainnet gate (egress-blocked).

## Flagged for founder sign-off (NOT patched, ground rule #1)

- **Market bidListing AB-BA** — retry-masked on a hot path; the structural fix is `withTwoCharacters`.
- **VoucherClaim.sweep** has no on-chain over-sweep guard (unlike OmertaBond) — accepted (Safe = root of
  trust), but the primary extraction rail's reserve invariant is weaker than the bond rail's.
- **Port warehouse→fence** self-selects high fence-mult days for ~+25% over the auto-fence margin — a
  §10.4-clean higher-variance faucet already flagged "sim before production".
- **Purchasable Commission seasonal standing** (tribute into your own treasury) grants real decree power
  — a known/accepted lever; the seasonal reset + loot-risk is the mitigation, not elimination.
- **Shared personal dividend pool** has no per-account allocation (a whale drains it first) — §10.4-clean
  redistribution, the accepted A1 flag.

Suite 32/32 + sim drift-0.
