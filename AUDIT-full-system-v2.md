# AUDIT-full-system-v2 — overnight max-effort full-system red-team (2026-07-21)

Six parallel red-team lenses over the entire codebase (47 src modules) + all 6 Solidity contracts.
Every CONFIRMED finding verified against source before fixing; a regression per behavioural fix;
suite (32/32) + sim (drift-0) green after each batch. **No CRITICAL found. No §10.4 drift.**

## Lens coverage
- **A — §10.4 ledger / economy: CLEAN** across all ~33 value-moving modules (incl. Port/Races/
  speakeasy-upkeep). Every faucet bounded, every escrow surface reconciles under cancel/expiry/death.
- **B — concurrency / locks:** no CRITICAL. Two reachable retry-masked AB-BAs (H1 casino, H2 bounty),
  three unreachable/fragility inversions, all persist-clobber + pg-mem-quirk classes CLEAN.
- **C — death / estate / PvP:** HIGH-1 fire pen-shield bypass; MED-1 npcHit jailed gate; LOW orphan rows.
  Loot/shields/estate-wipe/killer-mirror/account-survival otherwise verified sound.
- **D — chain / contracts:** no CRITICAL/HIGH. MED-1 assertChainId wrong process, MED-2 unbacked-reserve
  fabrication, MED-3 gear tokenId fragility. Core walls (EIP-712 parity, reserve queue, reentrancy,
  idempotency, minted-gate, no owner-mint) CLEAN.
- **E — auth / infra:** HIGH-1 verifyX no app-audience binding; M1 unthrottled auth; L3 Infinity guards.
  Route-auth coverage, idempotency, Privy JWT, no-SQL-injection, info-leak banding all CLEAN.
- **F — cross-system economic:** no value duplication. MED-1 WHEEL Sybil farm; LOW-2 agent-board leak;
  accepted residuals (speakeasy notoriety Sybil, port fine-dodge). casino:pvp family + all $OMR pools
  verified bounded.

## FIXED (committed)
| id | sev | what | commit |
|---|---|---|---|
| E-H1 | HIGH | verifyX confused-deputy takeover → gated behind X_TRUST_USER_TOKEN (default off) | cdf6db8 |
| C-HIGH-1 | HIGH | fire() ignored penSafe/inHole/jailed victim → assassinate a jailed/protected inmate; gates added | 5e3cee1 |
| C-MED-1 | MED | npcHit() missing jailed(victim) gate | 5e3cee1 |
| C-LOW-1/2 | LOW | runEstate now wipes convoy_ambushes + npc_hits | 5e3cee1 |
| B-H1 | HIGH | casino pvpDice den_volume↔street_tax AB-BA → reordered to den_volume-first | 5e3cee1 |
| B-M1 | MED | refundPot funders unsorted (bounty AB-BA root) → ORDER BY contributor | 5e3cee1 |
| B-L9 | LOW | sweepAuctions swallowed poison lots silently → console.error | 5e3cee1 |
| D-MED2 | HIGH* | mod comp routes fabricated backed vig_revenue (unbacked reserve) → real revenue only from the on-chain watcher; mod txHash stripped unless ALLOW_MOD_REAL_REVENUE=on; fees.js gated on txHash | 1964189 |
| D-MED1 | MED | assertChainId guarded only the worker, not the API voucher-signer → asserted in the API listen path | 1964189 |
| B-L8 | LOW | a CHAIN_ID mismatch crashed the whole worker → now disables chain sync fail-closed, worker survives | 1964189 |
| D-MED3 | MED | gear tokenId append-only pin strengthened with the tail class | 1964189 |
| F-MED1 | MED | WHEEL race status board Sybil-farmable (inert winner cooldown) → level floor on the loser (WHEEL_MIN_LVL) | 854e22d |
| F-LOW2 | LOW | race + boxing-legend leaderboards didn't exclude agent_flag | 854e22d |
| E-L3 | LOW | bank()/swap() numeric guards passed Infinity → Number.isFinite | 854e22d |
| E-M1 | MED | auth endpoints unthrottled (guest-mint Sybil / auth-fetch amplification) → per-IP auth bucket | 854e22d |

\* D-MED2 is mod-key-gated but defeats the extraction≤inflow safety property + blinds runVigInvariants, so ranked HIGH-effort.

## FLAGGED — not patched (retry-masked / unreachable / accepted / founder-call)
- **B-H2** (bounty repost-vs-sweep AB-BA): retry-masked; the repost holds the actor via withCharacter, so
  pre-locking funders could AB-BA with two-party paths — a "fix" risks a worse deadlock. B-M1 mitigates
  the refundPot-vs-refundPot subclass. Left as a documented retry-masked residual.
- **B-M2** (establishRacket/seizeDistrict district↔gang vs dissolution gang↔district): currently unreachable;
  the reorder touches a two-gang seize path — risk > benefit for an unreachable cycle. Fix note: lock the
  actor gang before the district.
- **B-M3** (callOutChamp title-before-fighter): unreachable; the safe fix is a TOCTOU refactor
  (read-title-unlocked → lock fighter → lock title → re-verify, mirroring acceptCallout) — deferred, not
  worth destabilizing a money-adjacent path for an unreachable deadlock.
- **B-L4** (dissolution two-gang war-clear unsorted): no clean zero-risk fix (any `WHERE war_with=$1` locks
  the foreign gang row); rare + retry-masked.
- **F-MED2** (speakeasy notoriety Sybil-flood): the knowingly-accepted per-account-cap-vs-Sybil residual
  (the fight-fix posture); costs the ring real cash per round, one raid per shutter. Founder dial.
- **F-LOW1** (port fine dodged by emptying the wallet before collect): a pure sink, same as every
  collect-triggered raid fine (business/territory); the boat-sink risk still applies. WATCH.
- **D-LOW1/2/3** (VoucherClaim sweep asymmetry, daily-cap liveness drift, vigBps/polBps config drift):
  documented deploy-checklist items; Safe = root of trust.
- **E-M2/M3/L1/L2** (public gang read opens a locking txn; withdraw/plex velocity bucket; mod-route
  idempotency; WS token in query string): infra-hardening backlog, lower priority; mod trust boundary.

## Verified CLEAN (no finding — checked, not assumed)
§10.4 across all modules; EIP-712/replay/reentrancy/full-reserve-queue/minted-gate; persist-clobber &
pg-mem-quirk classes; route-auth coverage & no-SQL-injection; loot/shield-ordering/estate-wipe/
account-survival; casino:pvp taxed-transfer family; the pool-vs-account cross-module lock directions.
