# RED TEAM — the scarcity package, the poll decoupling, and the contract interaction surface

**Date:** 2026-08-16 · **Scope:** everything shipped today (PRs #59/#60/#61 — THE FIRSTS, LIMITED RUNS,
THE SHIPMENT, the population-scaled cap, the client poll decoupling + `tools/pollcost.js`) **plus** the
18-contract Solidity suite, with the emphasis the request put on it: *the interactions between them all*
rather than each contract in isolation.

Point-in-time, like every report in `docs/AUDITS.md`. Done first-hand (no fan-out agents), every finding
reproduced against a running engine before being called one.

**Result: no CRITICAL. One production bug that destroyed value on every kill, one MED cross-system
mis-routing of real stock, and seven further fixes. Every fix carries a regression that fails by name
under mutation.**

---

## Verification

| Gate | Result |
|---|---|
| `npm test` (109 suites, pg-mem) | green |
| `npm run mobile` | **78** checks (was 77 — check H is new) |
| `npm run pgquery` (real Postgres 16) | **2942** static statements parse + type-resolve |
| `npm run pgcheck` (real Postgres 16) | 43/43 |
| `forge test` (sandboxed runner) | **296/296**, both 512-run fuzzes |

Mutations run: 11. All 11 fail at their own named assertion. Two of them **survived their first cut** and
are written up below, because how a check goes vacuous is worth more than the check.

---

## Part 1 — today's drops

### F2 (the headline) — a fire-kill DESTROYED the shipment instead of looting it
`src/social/combat.js`

The loot block reads:

```js
await client.query('UPDATE characters SET contraband = contraband - $2 …', [victim.id, contraLoot]);
await client.query('UPDATE characters SET contraband = contraband + $2 …', [ch.id,     contraLoot]);
```

…and the shipment block I shipped this morning copied that shape verbatim, with a comment saying *"same
shape as the two above"*. It is not the same shape, on **both** axes that decide how a column may be
written:

1. **`contraband` and `heist_loot` are NUMERIC; `shipment` is INT.** `col = col - $n` on an INT column
   with a bound parameter is the documented pg-mem sign-flip. Reproduced: `INT shipment 8 - 4 = -4`
   against `NUMERIC contraband 8 - 4 = 4`.
2. **`contraband` and `heist_loot` are direct-SQL columns; `shipment` is PERSISTED** (`persistCharacter`
   `$67`). So the SQL credit to the killer is written and then **overwritten** by the persist that ends
   the action, which writes the unchanged in-memory value back on top.

Axis 2 is a real-Postgres production bug, not a test-engine artifact: **on every fire-kill the victim
lost the material and the killer banked nothing.** The scarce, contested, deliberately-lootable resource
was being destroyed at exactly the moment the design says it should change hands — and there was **no
test covering the shipment loot at all**, though the suite header claimed it as proven.

Fixed: the victim's side is an absolute value computed in JS, the killer's is an in-memory bump the
persist carries. The regression asserts **both sides** of the transfer — which is what catches it, since
either half alone still reads plausible. Two mutations, one per axis, each failing by name.

### F1 — a swallowed 23505 turned a retryable contention into a raw 500
`src/economy.js:mintLimitedRun`

The limited-run mint wrapped itself in `catch { return null }` so *"a mint failure can never fail a
boost"*. **That promise cannot be kept inside a transaction.** In real Postgres the failed statement has
already aborted the txn, so returning null only moves the failure one statement later — to the boost's
own car INSERT dying with **25P02**, which `deadlockToRetry` does not map. Reproduced end to end:

```
the 23505 was caught inside mintLimitedRun: 23505
the car INSERT failed: 25P02 — current transaction is aborted
```

So the swallow bought a raw 500 where it was meant to buy silence. Letting the 23505 through reaches
`deadlockToRetry` and becomes a clean retryable `contention` — which is the posture `shipment.js`'s
`dayRow` already takes deliberately, so this also removes an inconsistency between two first-touch sites
written the same week. Regression is engine-independent (a client whose query throws).

### F6 — decoupling the board poll left cooldown buttons stale for up to two minutes
`public/index.html`

Today's capacity fix re-renders boards every 4th tick instead of every tick. The 1s ticker repaints
countdown **text**, but whether the button beside it is disabled — or drawn at all — was decided by the
render that drew it. So the clock would read `READY` next to a dead button for up to `BOARD_EVERY` ticks:
the **control-that-lies** class the wiring guard's checks 5 and 6 exist for, arriving through *time*
instead of through a missing field.

Fixed: a countdown crossing zero re-renders the open screen. It is rare (only when a clock actually
expires), it inherits `renderActive`'s debounce and its don't-nuke-a-half-typed-field guard, and it
leaves the case a player is actually watching **fresher** than the every-tick poll it replaced.

> **The mutation survived its first cut, and that is the finding worth keeping.** The probe asserted "a
> request happened at the crossing" — but a live page always has background traffic, so removing the fix
> still passed. It now compares the quiet window while the clock counts against the window straddling
> zero: **17 requests vs 0 with the fix, 0 vs 0 without.** Promoted into `tools/mobile.js` as **check H**
> so it cannot regress.

### F4 — the "shipment is gone" announcement was computed from a stale read
`src/shipment.js`. The take derived what was left from the row read *before* the claim, not from the
claiming UPDATE's own `RETURNING`. Under contention that read is already stale, so the announcement
either fires while crates remain or is missed entirely. Fixed; source tripwire, labelled as one — the
divergence needs two players inside one claim, which pg-mem (single-caller) cannot stage.

### F5 — an N+1 on a polled board
`src/firsts.js:firstsBoard` looked up each holder's steward one query at a time. This is a board, and
boards sit on the poll — the thing today's other work was about. Folded into one parameterized IN list
(never `= ANY($1::text[])`, which pg-mem returns zero rows for). Raises `pgquery`'s interpolated ceiling
71 → 72, with the reason recorded at the ceiling.

### F3 — a module-wide cached SAVEPOINT probe
`src/firsts.js` cached the probe result. Real Postgres refuses `SAVEPOINT` in autocommit, so a cache set
by whichever context calls first sends every later call in the other context down the wrong branch — and
the direction that costs you is a cached `false` silently dropping every claim forever, invisible to
pg-mem, which cannot parse either branch (AUDIT-street-life F2, same shape). Not reachable today (all
callers are in transactions); fixed anyway, since the file is a day old and the rule is already written
down. `collection.js` and `game.js` carry the same cache and were **left alone** — three hot paths for an
unreachable defect is more risk than the finding warrants, and it is recorded here instead.

---

## Part 2 — the contracts, and the interactions between them

Eighteen contracts. Reviewed as a graph rather than a list: shared keys, token flows, and walls that span
contracts.

### C4 (MED) — a re-imported Street Deed kept its on-chain identity, and mis-routed real stock
`src/chain.js`

`applyDeedReimport` clears `onchain_token_id` when a deed comes back into the game — but leaves
`extracted_by_account`, `extracted_at` and `onchain_owner` set. The voucher-expiry path had the same gap.

That matters because of a contract this file cannot see. The stock-delivery rail resolves a deed's
delivery target from `onchain_owner` first (a secondary buyer who linked that wallet) and
`extracted_by_account` second. So a deed **re-imported and then re-extracted by somebody else** spends its
extract-pending window carrying the *previous* life's owner — and the previous owner's allocations are
delivered into the ERC-6551 vault of a deed the new extractor is about to control. Real third-party
stock, into the wrong person's vault, with every invariant green (the vault's own wall is
`allocated ≤ held` in units; who received them is not a quantity).

Chain-dormant, so nothing is wrong in production today. Fixed at both return-to-game paths: the deed's
on-chain life is over, so every field describing it goes with the token id. The regression asserts it
**through the delivery rail's own predicate**, not just on the columns — the columns are only a defect
through what reads them.

### C2 (MED) — an unconfigured stock ticker delivered uncapped
`omerta-contracts/src/StockVault.sol`

Five contracts read `0 = unlimited` on their daily cap. Four take it as a single constructor argument, so
forgetting it is one visible mistake at deploy. **`StockVault`'s is a mapping, and the ticker set grows:**
the Commission votes a ticker daily off a list the operator extends by adding a token address, and nothing
in that process forces a `setDailyCap` for the new one. The freshly-added stock was therefore the one a
leaked keeper key could drain in a single block — silently, while every configured ticker held.

Added `defaultDailyCap`: a token the Safe has never spoken for inherits it instead of infinity. An
**explicit** `setDailyCap(token, 0)` still means unlimited, so the convention the siblings share survives —
only the never-set case changes. `effectiveDailyCap(token)` is public so an operator can see which tickers
are on the fallback. Three Foundry tests; the mutation fails on two of them with the exact numbers.

The batch has not gone to audit, so a contract change here costs nothing; after the audit it would cost a
re-audit. That is the whole reason to do it now.

### C1 (MED, operational) — one key signs four contracts, and rotating it is four transactions
`VOUCHER_SIGNER_PK` signs for `VoucherClaim`, `OmertaBond`, `StreetDeed` and (when wired) `DynastyNFT`.
The domains are properly separated — four distinct EIP-712 names plus `verifyingContract`, so a signature
for one can never be replayed at another, and the nonce spaces are independent. What is *not* separated is
the key: **each contract stores its own `signer`, and CHAIN-DEPLOY had no rotation runbook at all** — no
mention of `setSigner` anywhere.

A partial rotation leaves a door open with nothing on-chain to say which, and the blast radius of the key
is the **sum** of four daily caps rather than any one of them. Added the ordered runbook (pause all four →
`setSigner` on all four → rotate the backend key → unpause) with that sizing note.

A shared on-chain registry was considered and rejected: one more contract, one more audit surface, one more
single point of failure. The containment is the list — so the list is now **guarded**: `test/docs.js`
asserts every contract carrying a `setSigner` is named in the rotation step.

> **That guard also survived its first mutation**, for an instructive reason: dropping `StreetDeed` from
> the `setSigner` step still passed, because the same name appears one line up in the *pause* step. Pausing
> is not rotating. The check now looks at the `setSigner` line specifically.

### C5 (LOW, but it is the audit artifact) — two contracts claimed to be the stock container
`DynastyNFT`'s header said it was the host for the ERC-6551 account stock is delivered into. The shipped
rail targets the **Street Deed's** account; keeping stock off the identity token is precisely what
preserves its entitlement wall. An auditor reading the batch would have modelled the identity NFT as a
value-bearing bearer container and raised the Sybil-re-derivation concerns against the wrong contract.
Corrected in both headers, with the redirect stated rather than silently patched — **the NatSpec is the
spec** for an audit.

### C3 (LOW-MED) — the honeypot ceiling is per layer; the seller pays the sum
`OMR.sol` taxes a sell inside `_update`; `OmertaHook` taxes the same sale inside the v4 swap. Both cap
themselves at `MAX_SELL_TAX_BPS` (10%) and **neither can see the other**, so registering the v4
PoolManager as an `ammPairs` entry while the hook is armed doubles the rate past the ceiling both
contracts advertise — and taxes protocol flows into the pool (the POL-pairing bot's LP add) unless each is
`taxExempt`.

Not enforceable on-chain without coupling two immutable contracts, which is worse than the problem. Stated
as an operating rule where an auditor and an operator each read it (both contract headers + CHAIN-DEPLOY
§2): **one venue, one layer** — the hook taxes the canonical pool, `_update` stays at zero, and it is armed
only for a venue the hook does not cover, which is exactly what the backstop exists for.

### Verified clean (recorded, not assumed)
- **Domain separation** across all four voucher contracts: distinct EIP-712 names + `verifyingContract`,
  independent nonce spaces, `MAX_*_TTL` deadline backstops on every one.
- **`OmertaFees` uses ONE shared nonce counter across all four fee kinds**, so its two consumer tables
  (`fee_payments`, `store_payments`) can never collide on an idempotency key.
- **The mint graph:** `OMR.mint` is callable only by the single `minter` (OmertaBond); no owner mint;
  `setMinter(0)` is a one-transaction stop. `VoucherClaim`/`OMRStaking`/`GearVault`/`StockVault` transfer
  pre-held balances and mint nothing.
- **The Bank cluster** (`Alchemist`/`Denari`/`Transmuter`/`CollateralEscrow`/`FlashGuard`): trust edges are
  immutable-at-construction, the escrow obeys exactly one controller, and `Denari.burn`'s deliberately
  absent allowance check is safe only because the single burner burns its own balance — stated in NatSpec
  at the site, which is the right place for it.
- **`StreetDeed.redeem` is never pausable** (a pause must not trap a holder's asset) and the burn frees the
  same tokenId for re-extraction, so the deed's bound account is recoverable rather than orphaned.

### Flagged, not changed
- **A burned deed's token-bound account still exists on-chain.** Re-import → in-game sale → the buyer
  extracts → the buyer controls whatever sat in that vault, and the in-game deed market prices a deed with
  no visibility of it. The on-chain half has the `transferLocked` mitigation; the in-game half has none,
  because a database row is not an ERC-721 transfer. The cheap disclosure is that the game already knows
  what it delivered (`stock_deliveries`) without any RPC read — a founder call, and moot until mainnet.
- `collection.js` / `game.js` keep the F3 probe cache (unreachable; noted above).
