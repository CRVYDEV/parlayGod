# AUDIT — full-surface red-team (2026-07-20)

A max-effort, whole-project audit run as **five independent red-team lenses** in parallel, each
grounding every finding in `file:line` with a concrete exploit/failure scenario. Every reported
finding was then **re-verified against source** before any fix. Scope: the entire codebase — the
newest surfaces (referral funnel expansion, the Agent Gateway + Agent Economy) with fresh eyes, plus
a broad sweep of the economy, concurrency, chain/contracts, auth, and documentation.

**Result: no CRITICAL. Two HIGH (same root, fixed), one MED chain hole (fixed), plus MED/LOW fixes
and a ranked set of design/balance calls flagged for founder sign-off.** Suite 30/30 + sim drift-0
after all fixes.

---

## Lenses

1. **§10.4 economy / ledger** — mint holes, drift, double-pays across the referral funnel + agent economy.
2. **Concurrency / locks** — deadlock cycles, persist-clobber, double-spend seams.
3. **Smart contracts + chain** — EIP-712 parity, reserve accounting, extraction gate, reentrancy over the whole Solidity + chain layer.
4. **Auth / infra / agent surface** — OpenAPI leaks, the new agent routes, rate-limit/injection.
5. **Wiki gaps + missing/half-built features** — undocumented systems, dead ends, "doesn't feel right".

---

## FIXED (confirmed, regression-tested)

### HIGH-1 — two-party post-commit double-spend seam *(lenses 1 + 2, independently)*
`src/game.js:443` — in the `withTwoCharacters` post-commit hook, `maybeQualifyReferral` was a **bare
`await`** while the `withCharacter` path wraps all three referral hooks in try/catch. A 40P01 on the
char/`street_tax` locks (or any DB error) **after** a two-party action already COMMITTED would surface
a non-2xx → idempotency-key release → client retry **re-executes the whole two-party action** (double
transfer/repay/bout-payout/etc.). This is exactly the seam the code's own comment (`game.js:364-369`)
and the "post-commit referral masking" audit warned about — the solo path was hardened, the two-party
path was not. **Fix:** wrap it identically (swallow, non-fatal). Behavior-preserving. *(commit `ed86f3a`)*

### MED (auth) — public OpenAPI enumerated the moderator surface + declared the mod header
`src/agentgateway.js` — the public `/openapi.json` listed every `/v1/mod/*` route and declared the
`x-mod-key` header via a `modKey` scheme: a machine-readable map of the admin surface to any anonymous
caller. Enforcement always held (timing-safe `modAuth`), but agents have no use for mod routes. **Fix:**
the spec now excludes the entire moderator surface and no longer declares the mod header (249 paths,
down from 271). *(commit `23e0bda`)*

### MED (auth) — OpenAPI security was a URL heuristic, not real enforcement
`src/server.js` onRoute hook — security was reconstructed from `PUBLIC_PATHS` + the `/v1/mod/` prefix,
so it could silently diverge from actual `preHandler` enforcement (mask a route shipped without auth, or
401 a genuinely public one). **Fix:** the onRoute hook now captures each route's real `preHandler`
(`auth`/`modAuth` by name), and `buildOpenApi` derives security + the mod-exclusion from those flags.
A hardening-test regression asserts no `/v1/mod` path appears and security is derived correctly.
*(commit `23e0bda`)*

### MED (chain) — `mod/bond/simulate` fabricated unbacked Vig revenue → unbacked the withdrawal reserve
`src/bonds.js:recordBond` — unconditionally injected `vig_revenue(source='bond')`, which
`runVigBuyback` (no source filter) spends → funds `chain_reserve` → enables real $OMR withdrawals. The
Store fixed this exact class by gating its revenue split on a real `txHash` (`store.js:121`); the bond
comp/QA route did not, so a mod bond simulation on a live DB fabricated buyback basis with **zero real
ETH behind it**, defeating *extraction ≤ inflow* — and `runVigInvariants` was blind to it. **Fix:** a
`tx_hash` column + a `real` gate — a comp bond (no txHash) books the OMR tranche for QA but injects
**zero** pol/vig; `runBondInvariants` reconciles the ETH split over real bonds only. `test/bonds.js`
proves a comp moves no Vig headroom.

### LOW (chain) — a queued withdrawal burned $OMR with no cancel path
`src/chain.js` — a `queued` (reserve-insufficient) withdrawal debits $OMR but had no reclaim:
`reclaimExpiredVouchers` only reverses SIGNED-past-deadline vouchers, so if the reserve never funds to
the FIFO position the player's $OMR is stuck. **Fix:** `POST /v1/withdraw/:id/cancel` +
`cancelQueuedWithdraw` — reverses the burn net-0 (safe: a queued voucher was never signed → no on-chain
claim can exist); locks account → reserve (serializes with `drainQueue`). `test/chain.js` regression.

### Documentation + client-coverage gaps *(lens 5)*
- **Spread the Word** (daily social tasks) and the **referral-funnel expansion** (spark, tier-2 family
  tree, recruitment drive, Recruiters boards) were **undocumented in both codices** — a live cash
  faucet + payouts a player sees with no rulebook entry. Now documented in `docs/WIKI.md` **and**
  `public/wiki.html`.
- The **Agent Gateway** (agents / opportunities / OpenAPI / MCP) was in the served `wiki.html` but
  missing from the "canonical" `docs/WIKI.md` — now in both, with a "For agents" section.
- `GET /v1/leaderboard/foundation` was **built with no console surface** — added to the Family tab
  (a "philanthropy leaderboard" view).

---

## FLAGGED — ALL ADDRESSED (founder-directed 2026-07-20)

Every item below was subsequently built + tested (see the CLAUDE.md "AUDIT FLAGGED-ITEMS — ALL ADDRESSED" note): OmertaBond per-day cap (compiles clean; forge test is the pre-mainnet gate), the CHAIN_ID-vs-RPC boot assert, the parked-wire grant, tier-2 requiring a qualified middle link, agent-leaderboard wealth banding, and a codex drift-detector test. Original list retained for the record:


Ranked; each is bounded and non-urgent. Founder sign-off before changing.

1. **(chain LOW) OmertaBond has no per-day cap** — VoucherClaim meters a leaked signer with
   `dailyCapOMR`; OmertaBond bounds a leaked signer only by the whole tranche. Defense-in-depth gap;
   the fix is a Solidity change (a per-UTC-day OMR cap mirroring VoucherClaim) that needs Foundry to
   test — folded into the **pre-mainnet contract pass** (where `forge test` must run anyway). Keep the
   launch tranche small.
2. **(chain INFO) `CHAIN_ID` unvalidated against the RPC** — a wrong-but-nonzero `CHAIN_ID` signs every
   voucher under the wrong EIP-712 domain (all `claim()` revert; $OMR refundable via reclaim, but a
   withdrawal outage). Recommend a boot-time assert `CHAIN_ID === publicClient.getChainId()` and
   `DAILY_CAP_OMR` == on-chain `dailyCapOMR` — a deploy-hardening item.
3. **(chain LOW) `wire_month` grant dropped if the buyer has no living character** (`store.js`) — the
   character-level `wire_until` is skipped while `store_grants`/`granted` are set, so a purchase
   credited in the death→heir gap loses the wire window (account-level grants survive). Narrow; fix is
   to park a pending wire on the account.
4. **(economy LOW) tier-2 pays the grandrecruiter even if the middle link never qualified** — bounded
   ($5k, once ever, agent-excluded, gated behind R2's full qualification), ledgered, no §10.4 drift.
   Add `&& r.ref_paid` if the middle link must itself be a qualified recruit — a semantics call with
   MLM sensitivity, so flagged rather than silently tightened.
5. **(auth LOW) the agent leaderboard discloses exact liquid net worth / $OMR / extracted** per named
   agent — more granular than any human board; under P1.1 a hunter reads exact kill-EV. Opt-in +
   by-design as the "earned a living" signal; band it (like the convoy value bands) if abused.
6. **(chain INFO, pre-existing/known)** — the backend doesn't track `claimedOnDay` (many small claims
   can collectively bust the on-chain daily cap → those claims revert → reclaim refunds; liveness only);
   mod primitives (`reserve/claimed`, `reserve/fund`) are trusted footguns (the vig invariant flags an
   unbacked fund by design); the SIWE message lacks EIP-4361 domain/chainId binding (already on the
   founder's flagged replay-surface list; account+nonce+TTL prevent cross-account replay).
7. **(product) two drifting codices** — `GET /wiki` serves `public/wiki.html`; CLAUDE.md calls
   `docs/WIKI.md` canonical, with no generation step tying them. Both were brought back in sync in this
   pass; longer-term, one should generate the other (or the served one be declared canonical).

---

## Verified SOUND (no finding)

- **Chain core walls hold:** EIP-712 voucher parity exact (types, field order, `uint8 kind`, domain,
  checksummed `verifyingContract`); the OmertaBond `BondQuote` snippet matches `QUOTE_TYPEHASH`; the
  full-reserve queue serializes all signing on `chain_reserve FOR UPDATE` (no over-sign, no
  double-nonce); `markClaimed` vs `reclaimExpiredVouchers` double-resolution is guarded (on-chain
  `usedNonce` consult, per-voucher re-lock, `status<>'expired'`, loud §10.4 alarm); no owner-mint in any
  contract; OmertaBond/OmertaFees ETH forwarding is CEI + `nonReentrant`; tranche caps + `sweep`-can't-
  touch-committed correct; the `minted`-only extraction gate has no bypass (agent-key accounts pay fees
  like anyone). fees/store idempotency: 23505-only swallow, non-dup rethrow keeps the watcher cursor
  from advancing past an unrecorded payment.
- **Referral funnel:** the once-ever latches (`ref_spark`/`ref_paid`/`ref_l2_paid`) are airtight under
  `FOR UPDATE`; the tier-2 atomic claim (`WHERE … AND NOT ref_l2_paid`, `rowCount!==1` rollback) can't
  double-pay; the push multiplier can't mint (credited == ledgered, `mult` clamped `[1,5]`, $OMR
  untouched); cycle/agent guards at all three levels; the `maybeGrandReferral` lock order composes
  acyclically with qualify/spark (characters→accounts, sorted).
- **Agent surface:** opportunities + both leaderboards are read-only (no BEGIN/FOR UPDATE/writes); the
  opportunity board leaks nothing beyond the existing per-system boards (directed-exclusive contracts
  skipped, directed loans filtered by the caller's own id); `mod/referral/push` is `modAuth`-gated +
  input-clamped; no SQL string-interpolation on any new path; agent faucet exclusions intact everywhere.
- **§10.4:** the `referral:`/`social:` vocabularies are closed; all cash rows carry `character_id`;
  the sim sweeps drift-0 over an entirely earned economy.
