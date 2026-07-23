# AUDIT — The Value-Creation Drops (max-effort red-team, 2026-07-23)

Scope: the five money drops shipped for the founder's value-creation pivot — **THE STREET WAGE**
(`src/emission.js`), **THE EXIT TOLL** (`src/chain.js` + `src/tax.js`), **THE EARLY-EXIT
SURCHARGE** (`src/tax.js` + `src/economy.js`), **THE BOND DEV CUT** (`src/bonds.js` +
`src/watcher.js`), and the **OMR.sol DEX SELL TAX** + **OmertaBond three-way split**
(`omerta-contracts/`). Four independent lenses ran in parallel — §10.4/emission conservation,
concurrency/locks/persist-clobber, exploit/grief/economic gaming, and Solidity — every finding
re-verified against source before any fix; a regression per behavioural change; suite + sim green
after the batch.

**Headline: no CRITICAL, no HIGH code defect, no §10.4 drift, no conservation leak.** One MED
correctness defect fixed in-commit (the wage's crash-resume budget breach). The exploit lens
surfaced two coupled DESIGN calls on the new (unsigned) levers — the wage's Sybil economics and
the surcharge's FIFO semantics — flagged for founder sign-off, not patched (ground rule #1).
Both contracts verified clean.

---

## FIXED IN-COMMIT

### F1 (MED) — Street Wage: a mid-epoch worker crash re-granted the full per-epoch budget
`src/emission.js` — confirmed independently by the §10.4 lens and the concurrency lens.

`runWageEpoch` pre-computed shares per-invocation and stamped each paid character, which makes any
one character single-pay airtight. But `payable = min(budget, endowment room)` re-derived the FULL
epoch budget on every invocation, and the candidate set excludes already-stamped characters — so a
process death mid-loop (deploy / OOM / SIGKILL, not a caught JS error) followed by the next worker
tick re-split the whole budget among the unpaid remainder. Concrete: budget 500, run 1 pays 300
characters ~150 $OMR then dies → the resume pays the 700 survivors up to another 500 → the epoch
mints 650 > 500. Endowment-bounded (never an unbounded mint — `room` shrinks and the
`emission within endowment` invariant still hard-caps lifetime), but it silently breached the
signed per-epoch halving schedule — the headline anti-Axie property — with no alarm, and the
code's own comment claimed a resume-safety the in-memory pre-compute could not provide across a
restart. The same seam covered the (dormant, single-worker-today) concurrent-invocation case.

**Fix:** a new `emittedThisEpoch(pool, epoch)` sums the epoch window's ledgered `emission:wage`
rows (`at ∈ [epoch·86400000, (epoch+1)·86400000)`) — the ledger, not process memory, is the
resume state — and `payable = min(max(0, budget − consumed), room)`. A resumed run now TOPS UP
toward the budget (reproducing the survivors' original shares) instead of restarting it.
**Regression** (`test/emission.js`): a simulated run-1 (one character paid 4 $OMR + stamped, the
wage row dated inside the epoch window) followed by a resume at budget 8 — the survivor draws
exactly `budget − already-minted` (4, not the full-budget share of 5), the epoch total never
exceeds the budget, and $OMR conservation stays exact across the resume.

---

## VERIFIED CLEAN (the load-bearing surfaces)

**Exit Toll — conservation exact to 6-dp.** `devCut + buyCut == tax` (the buyback share is a
difference of two 6-dp numbers, no crumb); `net == amt − tax` exactly (round-not-floor is what
prevents the 1e-6 leak); the account's three ledger rows sum to exactly the balance debit;
`tax:dev`/`tax:buyback` are transfers (vocabulary yes, mint/burn no) into audited buckets
(`dev_fund` + `stake_pool`, both in `omrBuckets`). Cancel and reclaim refund NET only via a
second `withdraw:omr` row that nets the first to zero — the toll is genuinely non-refundable and
nothing is created or destroyed. Cancel-vs-drainQueue serializes on the `chain_reserve` lock with
status re-checks (`queued`/`signed`/`claimed` are disjoint states — no double-refund path); the
daily-cap/reserve gates correctly use net. The dev claim (`tax:dev:claim`) is a pure
bucket-to-account transfer, mod-gated, pays exactly what the fund holds; its account→dev_fund lock
order has no inverse anywhere → no cycle.

**Early-Exit Surcharge — pricing exact, race-free.** `earlySurcharge` is a pure pricing function
(moves nothing itself); both callers split and ledger it exactly (swap sell:
`−poolIn −devCut −buyCut == −amt` with the matching bucket credits netting to zero; withdrawal:
folded into the flat toll's exact split). It always runs on the caller's txn client UNDER the
already-held `account_persistent FOR UPDATE` — and every $OMR ledger insert in the codebase pairs
with a balance change under that same lock — so no concurrent credit/debit can slip between the
FIFO replay and the debit. `surcharge < amt` by construction; both callers guard the net positive.

**Street Wage — everything except F1.** The wage credit runs under char lock → account
`FOR UPDATE` (canonical characters→accounts), fully serializing against `withCharacter`'s absolute
`persistAccount` write in either order — no clobber. Concurrent workers can't double-pay any
character (the stamp re-check under the char lock). The estate race is clean in both orders
(`FOR UPDATE … AND alive` re-check; the account-level wage survives death correctly; the heir
enrolls fresh with a zero-gain first epoch — no double-claim, no free wage on death). Agents and
banned accounts are excluded; one living character per account bounds the cap; no login-idle
payout (MIN_SCORE requires real respect gain).

**Bond dev cut — split exact on every path.** Comp/QA (no txHash): zero pol/dev/vig booked, zero
`vig_revenue` — a comp cannot fabricate backed revenue (the invariant sums real bonds only).
Real off-chain: `vigEth` is the exact remainder → the three-way sum equals the principal, zero
dust. On-chain: the watcher's `Bonded(…, toPol, toDev, toVig)` ABI matches the contract event
byte-for-byte (names, order, wei→18-dp units), `recordBond` is nonce-idempotent under the
`bond_reserve` lock, and `runBondInvariants` check (4) reconciles POL+Dev+Vig == principal.

**OMR.sol — the crown jewel's new ~60 lines are clean.** Every edge of the `_update` tax branch
verified: the supply mint (from==0) is never taxed; buys, wallet→wallet, and unregistered venues
are structurally untaxed (the gate is on the RECEIVER being a registered pair); `address(0)` can
never be registered (setPair zero-guard). Conservation is exact — `dev = tax/2`,
`buyback = tax − dev` absorbs the odd wei, `pool + dev + buyback == value`, nothing minted or
burned, the sender debited exactly the amount. No external call exists anywhere in the transfer
path (pure ERC20 bookkeeping) → the in-transfer split cannot re-enter. The anti-rug posture is
enforced in code, not just documented: 10% compile-time cap, default-off, recipients required to
arm, can't zero a recipient while armed, everything evented — and because the split is a pure
balance credit it can never revert, so no configuration can brick a sell. No V2/V3 assumption in
the contract (the V2-compatible-pool requirement stays a CHAIN-DEPLOY.md deploy gate, proven
on-chain by `tools/check-dex.js`).

**OmertaBond — the three-way split is a faithful extension.** `polBps + devBps ≤ 10000` validated;
`toPol + toDev + toVig == msg.value` exactly (remainder-to-vig absorbs both floor dusts); all
state written before the three forwards + `nonReentrant` (the reentrant-recipient test proves
full rollback); the event matches the backend parity exactly. The untouched walls — tranche cap
(never mints), EIP-712 nonce/replay/`MAX_QUOTE_TTL`, per-day cap, `sweep` over-sweep guard — are
all intact; the quote typehash carries no split fields, so the change added zero signer surface.

---

## FLAGGED FOR FOUNDER SIGN-OFF (design calls on the NEW, unsigned levers)

> **RESOLUTION (2026-07-23, founder-directed "apply your recommended fixes"): BOTH BUILT.**
> D1 → the wage now pays only MINTED accounts (`wageRequireMinted()`, env `WAGE_REQUIRE_MINTED`
> default on; surfaced on the board, `/v1/rules.emission`, and the console card) — every
> wage-drawing identity costs the 0.01-ETH mint fee (or its PLEX price), so a Sybil farm funds the
> house per alt instead of draining the budget. D2 → `earlySurcharge` prices exits (and replays
> historical debits) NEWEST-first, so every fresh token pays on its first exit exactly once and an
> aged buffer can't shield a fresh dump. Regressions in test/emission.js + test/chain.js; the
> codices and design doc updated. The original findings are preserved below as the record.

These were the two decisions to make before the wage faucet goes live with real-money value. They
are coupled: together they meant a determined bot farm could capture most of the daily wage budget
and extract it near-toll-free after a 48-hour ramp.

**D1 — The wage's Sybil economics: the agent flag is the wrong humanity gate.** The exploit lens
measured the "respect gain costs energy" premise: level 5 ≈ a one-time ~7-crime grind, and the
daily +25 respect ≈ 3 crimes ≈ under a minute of automation per alt (nerve regen is effectively
unconstraining at that scale). Agent exclusion only catches accounts that VOLUNTEER the flag via
`POST /v1/auth/agent-key`; an undeclared bot uses free guest tokens (INVITE_MODE off). ~100 capped
alts drain the entire 500 $OMR/day budget and pro-rata-starve every honest earner. Dials, in
rough order of bite: run production with `INVITE_MODE=on` (the closed-alpha posture already
built); gate the wage on a real uniqueness signal (linked+minted wallet — the 0.01-ETH mint fee
is a per-alt cost that changes the arithmetic entirely); raise `WAGE_MIN_SCORE`/`WAGE_MIN_LVL`;
diminishing per-account shares. The mechanic itself is §10.4-sound — this is who-gets-paid
policy, and it is THE launch-gating decision for the side-hustle vision.

**D2 — The surcharge's FIFO semantics make it anti-INSTANT-dump only.** Because the replay drains
oldest lots first, a holder's tax-free daily exit allowance equals their balance of 48 hours ago —
so a steady earner who holds through a 2-day ramp dumps each day's wage fully surcharge-free
forever (the fresh lot is never reached), and anyone can zero the toll by simply waiting one
window. If the intent is "every fresh token pays on its first exit," the semantics need to price
the FRESH end (LIFO, or proportional-across-lots) — a design change to an unsigned lever, one
line of ordering in `src/tax.js`. If the intent is only to punish panic-dumps (a defensible,
milder posture), the current build is correct and this row just needs the honest label. Related:
the doc's stake→unstake seam was RE-MEASURED and is weaker than documented — washing FRESH tokens
through staking does NOT dodge (the original credit row stays in the window and the replay still
prices it); the un-ledgered unbond release only "ages" tokens that were already aged. D2's
48h-hold is the real seam; the doc note is corrected by this report.

**Accepted (recorded, no action):** pro-rata concentration fairness (the whale/ring face of D1 —
capped per-account, budget-bounded); the wage paying into loot-able liquid $OMR (intended
Make-Risk-Pay exposure); OMR.sol's owner-power to register an arbitrary address as a "pair"
(bounded by the 10% cap + renounce — the Safe-as-root-of-trust class); OmertaBond's ≤2-wei dust
burn in a non-canonical zero-vig deploy (unreachable in the production config) and the
reverting-recipient DoS (pre-existing, owner-fixable, the OmertaFees posture).

**Standing gate, restated:** `forge test` has still never executed (Foundry egress-blocked here;
contracts compile clean via solc-js). With OMR.sol now carrying logic, running the Foundry suite —
including `OMRTax.t.sol`'s conservation fuzz — in a Foundry-capable environment is the hard
pre-audit, pre-mainnet gate.
