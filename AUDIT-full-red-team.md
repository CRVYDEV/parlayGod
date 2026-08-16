# AUDIT — full red team, game + contracts (2026-08-16)

Point-in-time, like every report in `docs/AUDITS.md`. Brief: *"run a red team over the entire game &
smart contracts. Max effort search for bugs & exploits."*

Every finding below was **reproduced first-hand against a running engine or the contract source before
it was called one**, and the two that dissolved on checking are recorded here alongside the ones that
survived — because a red team that only publishes its hits is not measuring its own false-positive
rate, and this pass had two.

**No CRITICAL. Two HIGH, four MED, four LOW — all fixed, each with a regression that fails by name
under mutation.** Two candidates were investigated and **rejected**: one on measurement, one because
the code already had two walls I had not looked for.

---

## The two HIGH

### H1 — a StreetDeed voucher could be reclaimed by the VoucherClaim path, bricking a street forever

`vouchers` is one table shared by two contracts with **independent nonce spaces**: VoucherClaim
(`omr`/`gear`/`car`/`boat`) and StreetDeed (`deed`). `reclaimExpiredVouchers` and `markClaimed` did not
filter by kind, so a deed voucher was eligible for a rail that knows nothing about deeds — and the
consequence is not a lost voucher, it is a **permanently bricked street**: the deed sits in state 2
(extraction-pending) with `onchain_token_id` set, so its owner can neither use it nor claim another,
forever, with nothing anywhere reporting a problem.

Reachable on the **ordinary abandoned-extraction path** — a player requests an extraction and never
submits the transaction.

**Fixed** with an allowlist, not a denylist: `VOUCHER_CLAIM_KINDS = ['omr','gear','car','boat']` gates
both functions, and the previously-bare `else` became `else if (v.kind === 'gear')` with an unknown
kind rolling back and counting as skipped. A denylist would have left the same hole open for the third
contract that shares this table; an allowlist means a new kind is invisible to the old rail by default.

### H2 — only the first delivery of each stock allocation ever landed

`stock_allocations.delivered` was a BOOLEAN and `deliveryIdFor` was keyed on the PK alone. But
`allocateStock` **accumulates** into that PK, so the same (epoch, account, ticker) legitimately owes a
second tranche the next day — and the second tranche computed a `deliveryId` StockVault had already
consumed, so it was unsendable, forever. This was the **default operating shape**, not an edge.

**Fixed** by replacing the flag with a running total (`delivered_units`) and adding the delivered-so-far
figure to the id derivation, so each tranche is distinct while a retry of one tranche stays idempotent.
The migration **backfills** `delivered_units = units` for already-delivered rows — without it every
historical delivery would be re-planned in full after deploy, which is a double delivery of real stock.
`runTreasuryInvariants` gained an exact `allocation delivery ledger agrees (<ticker>, units)` identity
so the two sides can never drift again silently.

---

## The four MED

### M1 — the bridge's gear cap outlived the re-import round trip

`GearVault` bounds **live** on-chain supply (`minted - redeemed <= cap`) so a burn vacates exactly one
slot — that is the whole mechanism behind the re-import round trip, and the design doc calls this
"the one place the cap accounting needs care." `VoucherClaim`'s pre-flight still enforced a **lifetime**
counter that never decremented, so once a class had ever reached its cap, a re-imported item could
never be re-extracted, with every one of them burned back and zero live on-chain.

Fail-closed either way — nothing over-mints — which is exactly why it would have gone unnoticed. What
it killed was a shipped feature, and an epic class caps at 10, so the wall is reachable in ordinary
play. **Fixed** by writing the vault's own expression verbatim (`minted <= cap + gear.redeemed(id)`),
so the two layers measure the same quantity rather than merely agreeing today.

### M2 — the allocation builder destroyed every Solana address it touched

`tools/allocate-drop.js` lowercased every wallet. EVM addresses are hex and case-insensitive, so that
is right for them; **base58 is case-sensitive**, so for the $ANSEM-class community it produced strings
no ed25519 key can ever sign for — **an entire community's envelopes orphaned forever, silently**, with
the row count, the $OMR total and the published commitment all reading perfectly correct.

The loader had the rule right and even said so in a comment. The builder sits **upstream of it** and
lowercased first, so the loader's correct rule ran on an already-destroyed address. **Fixed** by
sharing one `normalizeWallet` between the two ends rather than restating it — two implementations of
one rule is precisely how the two ends came to disagree.

### M3 — a player-facing route held a row lock across an RPC

`quoteBond` called the on-chain oracle **between** an `account_persistent FOR UPDATE` and the
`bond_reserve` singleton. That pins an API-pool connection for as long as the node takes *and* blocks
that player's every other authed action behind their own row lock — the pool-exhaustion shape
`bankPosition` and the deed-vault disclosure are both deliberately written to avoid, arriving on a
write path. **Fixed** by hoisting the read above `pool.connect()`; it needs nothing from the database,
and a TWAP moves on the order of its PERIOD, so there was never anything to buy by holding the lock
across it.

### M4 — the documented drop batch size was unreachable

The loader documents and enforces batches of up to 200,000 rows — about 20MB — against fastify's
**1MB default body limit**, so the documented instruction stopped working near 10,000 rows and returned
a payload-too-large with no hint of the real ceiling. It surfaces on launch night, once, under time
pressure, on the one operation that hands a community its envelopes. **Fixed** by raising the limit on
that one mod-gated route rather than lowering the documented batch: an operator splitting a snapshot
into twenty pieces by hand is twenty chances to load nineteen.

---

## The four LOW

- **L1 — a bracket round that killed every survivor stranded its escrow.** Only reachable at round ≥ 1
  (round 0's short-field branch fires first). Now burns the pool and settles the row empty, so the
  tournament-escrow identity closes.
- **L2 — the stock buy keeper had no single-writer lock.** Two overlapping workers could each read the
  whole budget. Now a session advisory lock, distinct from the OWED-side class, released in a `finally`.
- **L3 — `freeMint` defaulted to ON.** It waives the identity mint fee, so a config that forgot the key
  handed a community a free pass through the Sybil bound that gates extraction. Defaulting it the other
  way is no better — that silently withholds a waiver a community was promised. Both answers are wrong
  to guess at, so the config must now state it.
- **L4** — the deed board, the explore copy, a racket vocabulary entry and the crew objective (fixed
  earlier in the session, each with its own regression).

---

## The two that dissolved — and why they are here

**A red team that publishes only its hits cannot be audited.** Both of these were reproduced before
they were dropped, and each cost real time that the write-up should not hide.

### R1 — the track's player-entry economics (measured, false)

Reported as a "+8.0% mean" edge from filling player slots with weak runners. That figure was the mean
**of the subset where the sign had already flipped** — a statistic about the tail, quoted as though it
described the distribution. My own unconditional measurement came back **−7.19%**.

Then my own first correction was also wrong twice over: 730 race-days missed the tail entirely, and
widening to 20,000 produced a 133% edge that turned out to rest on weight 0.2 — a form-0 runner, which
**is not fieldable**. With the real minimums (dog form 15, horse 21) the result is **0 of 20,000
profitable**. Answered with a lever-relation guard rather than a code change, so a future retune that
would make it profitable fails by name.

*The lesson, twice: do not adopt a statistic you did not compute, and check that your own measurement's
inputs are reachable in the game before believing its answer.*

### R2 — the "stale delivery target" (already walled, twice)

The stock keeper stores the vault resolved at staging and a resend can be ten minutes later, so a deed
selling in that window looked like it would send the seller's units into the buyer's vault — against
THE TARGET RULE's own promise. A fair question about real, irreversible stock.

**I wrote the fix before proving the bug.** Probing afterwards showed the plan already drops the
account the moment the deed's on-chain owner stops matching its linked wallet, *and* `stageStockDelivery`
re-resolves and refuses `no_target` even when called directly. Two independent walls, neither of which
I had looked for. My third wall could never fire — and **a wall that cannot fire reads exactly like a
wall that works**, so it was removed rather than kept for comfort.

What was genuinely missing was a test: neither wall had one at the keeper level. The scenario walk
that replaced the fix is labelled as a scenario walk, and it pins the end-to-end shape the unit
assertions each cover only half of — that a delivery caught mid-flight is **held**, not lost or
silently cancelled, and goes out under its own id once a target exists again.

---

## Verified clean (recorded so the sweep is not repeated)

The EIP-712 domains across the four voucher-bearing contracts (distinct names, distinct
`verifyingContract`, independent nonce spaces, TTL backstops); `OmertaFees`' single nonce counter
across all four fee kinds, so its two consumer tables cannot collide on an idempotency key; the mint
graph (one minter, no owner mint, `setMinter(0)` as a one-transaction stop); the comp/`txHash` gates on
every real-value ingest and the posture ladder between them (the desk stocks its shelf; bank, community
and treasury book zero); and the §10.4 sweep, drift-0 throughout.

## Process notes

- Two untracked scratch files were inflating the Foundry count. One was a genuine exploratory probe and
  was deleted; **the other was a live finding I had reproduced and left unresolved** (M1). Scratch files
  named so they sort last are easy to leave behind — and one of them was the most interesting thing in
  the pass.
- A shell `grep -ho 'function test' | wc -l` disagreed with node's `.match(...).length` by one, which
  made me briefly misread a docs-guard pass. The guard and forge agreed all along.
