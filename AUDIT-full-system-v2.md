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

---

## WAVE 2 — four deeper targeted lenses (2026-07-21)

Emphasis: "check all contract interactions" + adversarially re-verify Wave-1's own fixes.

- **G — deep Solidity contract re-audit (all 6 + cross-contract web): no CRITICAL/HIGH.** One new
  finding a single pass missed → **G-MED-1**: the per-gearId LIFETIME cap lived only in VoucherClaim
  (the swappable bridge); a Safe `setMinter(VC-v2)` reset the count → 2×+ circulating gear supply.
  **FIXED** — moved the authoritative cap to GearVault (`cap`/`minted`/`setGearCap`, fail-closed;
  survives a minter swap); VoucherClaim keeps a pre-flight; Foundry minter-swap regressions added;
  contracts compile clean. Accepted trust-model items (LOW, not patched): VoucherClaim.sweep asymmetry
  (Safe = root of trust), bond signer-controlled price (blast radius = daily cap, as designed),
  staking APY retroactivity (pool-bounded). All core walls (EIP-712/replay/reentrancy incl. the 1155
  receiver hook/CEI/access-control/init/pool-separation/daily-caps) re-verified sound.
- **H — adversarial re-verification of Wave-1's fixes: all 4 commits VERDICT SOUND.** No reintroduced
  exploit, no second unguarded revenue path, no side-effect-then-throw, no new lock cycle. Two
  deploy notes: refundPot's contributor-sort is the already-flagged B-H2 (no new cycle); the per-IP
  auth throttle needs `trustProxy` behind a proxy → **FIXED** with a `TRUST_PROXY=on` env knob
  (default off — XFF is spoofable without a trusted proxy).
- **I — lazy-accrual engine + every worker sweep: exceptionally clean, no CRITICAL/HIGH/MED.** The
  §7.1 invariant (cap offline gain, re-anchor the marker, ledger every faucet, resolve idempotently)
  holds across all ~25 touchpoints; every prior scar (Law dtMin, rout re-mint, season-prize lock,
  pacing-neutral raid windows, token buckets) verified intact. One LOW → **FIXED**: sweepStaleHeists +
  sweepStaleBreaks re-threw per-row (aborting the tick) → now `continue`+log like every other sweep.
- **J — deep mid/late-game economic exploits: NO new CONFIRMED unbounded $OMR-extraction exploit.**
  The extraction cap is airtight — `chain_reserve.funded_omr` is fed ONLY by Vig real-revenue paths
  (buyback/prize-backing/pass) + the flagged legacy `mod/reserve/fund`; no player path funds the
  withdrawal reserve without real ETH, so every in-game $OMR faucet (mission/daily/referral/dividend/
  stake/prize/pass) is queue-bounded. Two CONFIRMED IN-GAME-CASH findings, both defeating a SIGNED
  balance lever via Sybil-split → **FLAGGED for founder sign-off (not patched, ground rule #1 — signed
  levers + no §10.4 leak + extraction-capped):** **(J-1)** the D5 bank-interest whale-taper is
  per-character, so splitting capital across alts earns the full 2%/day on unlimited principal (~5.3×
  the intended; bank balances are also loot-safe — `whack:loot` takes pocket/in-transit only); **(J-2)**
  `pen:work` cash faucet has no level floor + no per-account daily cap unlike its siblings (self-limiting
  per sim P9.11, but the structural inconsistency stands — rec: `WORK_MIN_LVL` + a daily cap). Recorded
  in BALANCE.md. Everything else (treasury/family-contract laundering, dividend/loan/world/territory/
  business/casino/referral/commission/estate/auction/wire/stake) verified as accepted bounded
  redistribution or clean. **Coverage note:** heists/convoy/market got the §10.4 (lens A) + lock (lens B)
  passes but J's dedicated economic-exploit read of those three did not complete → closed by Wave 3.

## WAVE 3 — the one coverage gap (2026-07-21)
- **K — heists/convoy/market dedicated economic-exploit + escrow lock-race read** (J's acknowledged gap):
  (running)

Wave-2 fixes committed d44472a. Suite 32/32 + sim drift-0; contracts compile clean (0 warnings).
`forge test` remains the pre-mainnet gate (Foundry egress-blocked).
