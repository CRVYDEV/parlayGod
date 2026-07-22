# AUDIT-redteam-loop.md — autonomous overnight red-team (rounds)

A founder-directed max-effort adversarial loop over the ENTIRE project (game modules + Solidity
contracts). Each round fans out finder agents across the codebase + independent skeptics that default to
REFUTING; survivors are triaged by the main loop, code bugs fixed with a regression each (§10.4 kept
exact), balance/design calls flagged not retuned (ground rule #1), `npm test` + `node tools/sim.js` kept
green, then committed.

---

## Round 1 — whole-project sweep (42 agents, 15 raw → 8 survived)

**No CRITICAL. No §10.4 drift.** 5 code fixes (regression each) + 1 balance flag; 2 accepted/known.

### Fixed in-commit

- **`chain.js:makeChainReader` — wrong-chain reclaim guard (was HIGH-claimed, MED).** `reclaimExpiredVouchers`
  runs OUTSIDE the worker's `assertChainId` gate, and `makeChainReader` built a `usedNonce` reader from
  `CHAIN_RPC_URL`+`VOUCHER_CLAIM_ADDRESS` with no chain-id assertion. On a CHAIN_ID/RPC drift to a chain Y
  with a same-address (colliding-deploy) VoucherClaim that answers `usedNonce=false` for a nonce genuinely
  claimed on chain X, reclaim would refund the burned $OMR (`+withdraw:omr`) — a chain-boundary
  double-spend the in-game ledger can't see (it nets to zero). **Fix:** `makeChainReader` now asserts
  `getChainId()===CHAIN_ID` before returning a reader; a mismatch (or an un-answerable getChainId) returns
  **null**, routing into reclaim's existing "no reader → skip, never refund blind" fail-safe. Dormant-safe
  (no CHAIN_ID in tests → guard skipped, reader null as before). Deploy-misconfig-triggered, not
  attacker-reachable, but a real value-safety gap matching the codebase's own "never refund blind" pattern.

- **`wire.js:sweepStandingWatches` — non-transactional $OMR burn (my step-five code; MED).** The standing-
  watch worker ran on bare `pool.query` autocommits, so its `SELECT omr … FOR UPDATE` lock was inert
  (dropped at statement end). Two gaps: (A) a §10.4 omr-bucket drift if the process died between the
  `omr = omr - cost` decrement and its `intel:watch` ledger row; (B) a same-account TOCTOU where a
  concurrent `withCharacter` $OMR spend commits between the affordability read and the decrement, driving
  omr negative. **Fix:** each renewal now runs in its own `pool.connect()+BEGIN/COMMIT` (the `sweepLoans`/
  `settlePassStipend` convention) — the `FOR UPDATE` lock persists across the affordability check and the
  decrement+ledger+tap-update commit/rollback together; a cheap unlocked pre-filter avoids opening a
  connection for comfortably-live taps, with the authoritative re-check inside the txn. Existing wire tests
  confirm behavior preserved.

- **`social.js:startSearch` — missing rat exception (LOW).** `fire`/`jump`/`npcHit`/`postBounty` all void
  family omertà for a rat, but `startSearch` didn't (it never fetched the rat flag), so a same-family
  hunter was blocked at the search — making the documented fire rat-waiver unreachable for them. **Fix:**
  `startSearch` now joins `account_persistent` for `rat` and excepts it, matching the siblings. Regression
  in `test/social.js` (a same-family rat is searchable; a loyal member isn't).

- **`economy.js:swap` (buy) + `business.js:launderAtBusiness` — missing jail gate (LOW).** Laundering
  (cash→$OMR, an extraction-prep act) was safehouse-gated but not jail-gated, unlike `deal`/`cook`/
  `boostCar`. A jailed (indicted/marked) player could keep washing toward extraction from a cell. §10.4
  unaffected (bounded by the wash caps). **Fix:** both now `throw 'jailed'`. Regression in `test/economy.js`.

- **`server.js:auth` — the §10.2 agent throttle skipped authed GETs (LOW).** The global limiter gated only
  POST/DELETE (`guarded`), so an agent could poll GET /v1/me — a `withCharacter` accrual + ledger-write
  path — at unlimited rate, defeating the 1/3s agent cadence. **Fix:** the route-level `auth` preHandler
  (which already queries the account for the ban check) now also fetches `agent_flag` (LEFT JOIN, no extra
  round-trip) and enforces the agent bucket on authed GETs; **humans are left unthrottled on GETs** so
  multi-tab console loads never 429. Regression in `test/security.js`.

### Flagged (not patched — ground rule #1)

- **`territory.js:raidRivalRacket` — over-cap emission (balance).** The clock-advance is emission-neutral
  only while the owner is below the 24h income cap; a raid on a NEGLECTED (over-cap) racket hands the owner
  fresh re-accruable headroom on top of the raider's cut, so total ledgered emission can reach ~1.3× the
  per-collect ceiling. §10.4 stays exact (all moves ledgered, gang-treasuries reconciles). Recorded in
  BALANCE.md; the dial is clamping `remainMs` to real elapsed-since-collect, or accept as intended.

### Accepted / known (no action)

- **`market.js:bidListing` AB-BA** — the previously-accepted, retry-masked cross-actor char-lock inversion
  (40P01 → clean `contention`, pre-commit abort, no §10.4 drift). One skeptic refuted it outright.

**Suite 33/33 + sim drift-0 after the batch.** `forge test` remains egress-blocked (the standing
pre-mainnet contract gate); the Solidity finder surfaced no reachable mint / replay / reentrancy / access
gap this round.

## Round 2 (in progress) — attack-class + per-contract deep dives (background finders)

- **Solidity contracts (all 6) — NO REAL FINDINGS.** VoucherClaim/OMR/GearVault/OMRStaking/OmertaFees/
  OmertaBond each hold no-mint / bounded-tranche / CEI-nonce-before-transfer / reentrancy-guard / access-
  control / staking pool-vs-principal separation. Two informational notes (not bugs, not patched):
  VoucherClaim.sweep lacks OmertaBond's on-chain over-sweep guard (owner-only; the off-chain full-reserve
  queue already bounds it — the accepted "Safe = root of trust" tranche model), and GearVault.minter is
  settable-by-design (the G-MED-1 fix relies on it; the "immutable" docstring is imprecise). `forge test`
  remains the pre-mainnet gate (egress-blocked here).
- **Estate/death completeness — COMPLETE, no value/ownership/escrow leak.** Every currency crossing death is
  ledgered; every dead-funded escrow (bounty/market/loan/boxing-bet/tourney/grand-prix/stakes/futurity)
  refunds/burns/carries and reconciles its §10.4 check; account-level survivors are account-keyed;
  resolve-snapshot tables correctly excluded. **Fixed (hygiene):** `daily_progress` (character-keyed,
  value-less daily-contract counters/claimed flags) was neither wiped nor account-level → orphan rows on
  death; added to the runEstate wipe list. No §10.4 surface (holds no value; heir gets a fresh id).
- **Escrow-identity integrity (all 10 checks) — CLEAN.** Bounty/market/loan/auction/poker-tourney/futurity/
  grand-prix/stakes/boxing-bet/convoy-insurance all reconcile under every interleaving traced (estate-burn
  vs expiry-sweep, claim-vs-burn, cancel-vs-sweep double-refund, multi-winner split leak) — each closed by
  shared-lock serialization + remainder-into-take. No stray cross-module escrow writer.
- **Two-party transfer rails — CLEAN.** Every settlement rail (bodyguard/round/buyout/standover/table/
  pvpDice/poker/bout/matchRace/challenge/pinkslip/repay/collect/buyPaper/fill/shakedown/inside-job/tribute/
  toll/family-contract) carves its take, uses sorted chars→accounts→leaves→singletons locks, reads consent
  from the locked limit row, and self-guards. The only untaxed path (loan-default disbursement) is the
  ALREADY-SIGNED-OFF collusion rail (one-shot per alt, MAX_ACTIVE=1, welsher+WANTED) — no new exposure.
- **persist-clobber + pg-mem INT-quirk (exhaustive mechanical sweep) — CLEAN.** The quirk was empirically
  pinned to `intcol = intcol − $param` only (163 arithmetic-UPDATE sites; 30 parameterized subtractions,
  all NUMERIC targets; INT columns only ever get addition/literal-`−1`) → zero vulnerable sites. No
  persist-clobber: every direct-SQL write to a persisted column runs in a worker/hand-rolled txn that never
  calls persist; every non-persisted in-memory field has a backing direct-SQL mirror.
- **Worker sweep races — value-moving sweeps SOUND** (per-item transactional, idempotent under a status
  lock, no worker AB-BA, no bare-pool value move besides the R1-fixed wire one). **Fixed (observability
  parity):** six cash-escrow resolvers (`sweepGrandPrix`, `sweepFuturity`, `sweepTournaments`,
  `sweepTrackEntries`, `sweepStakes`, `sweepMainEvents`) had a silent `catch { ROLLBACK }` — a persistently-
  throwing item would retry forever with frozen escrow and NO alarm (the §10.4 check reconciles as
  open==posted, "correctly stuck"). Added `console.error` poison-row logging (the `sweepAuctions`/
  `sweepUprisings` precedent) to all six + the three no-value NPC/raid sweeps for consistency.

**Round 2 verdict: no CRITICAL/HIGH/MED §10.4, lock, auth, or contract defect. 2 small correctness/hygiene
fixes (estate `daily_progress` wipe, worker poison-row logging). Suite 33/33 + sim drift-0.**
