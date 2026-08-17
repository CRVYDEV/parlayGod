# AUDIT — the fourth max-effort red team

**Date:** 2026-08-17
**Base:** `72102d1` (PR #66 merged — the third red team's three fixes)
**Method:** first-hand. Every candidate reproduced against a running engine before being called a
finding; nothing fixed before it was reproduced. Two of the three findings needed **real Postgres**,
because pg-mem is single-caller and cannot drive them at all.

**Result: no CRITICAL. One HIGH, two MED. Four mutations, each failing at its own named assertion.**

---

## Why these surfaces

The previous report named `citywire`, `dexbot` and `stockdeliver` as the modules appearing in ZERO
audit report — and then only swept two of them. **`dexbot.js` was still open, and it is the module
that sends real ETH.** A fresh coverage sweep also turned up three more untouched modules
(`chainparams.js`, `dbhealth.js`, `nft.js`).

The second target was a class the earlier passes established and did not sweep to its edge: the
watchers' per-log isolation rule, which had been grown once, for the stream that prompted it.

---

## F1 (HIGH) — two overlapping workers each send real ETH

**`src/dexbot.js`, `src/worker.js`**

Both keepers read an **unlocked** budget and then **send**, and the send is the irreversible half:

```
runDexBuyback:  read unspent Vig revenue  →  swap real ETH on the pool  →  journal  →  book
runPolPairing:  read unpaired POL ETH     →  mint a real LP position    →  journal
```

The worker's `lastDexBotRun` cadence gate is **in-memory**, so it paces one process and nothing
else. Two replicas across a deploy overlap — the threat model that already justified this posture
for the wage epoch, the population, the city leg, the NPC sweeps and the stock keeper — both read
the same budget and both send.

**Reproduced on real Postgres:**

| | budget | sent | booked |
|---|---|---|---|
| buyback | 2 ETH unspent revenue | **2 swaps, 4 ETH** | 2 ETH |
| POL | 1 ETH delivered | **2 pairings, 2 ETH** | — (`paired ≤ booked` tripped) |

So 2 ETH left the bot wallet with no accounting at all: the OMR it bought sits there, never split to
the reserve and prize pool. The invariants catch both the same night — that is the **detector**, and
the money has already gone.

**The worker comment asserted the opposite** — *"a double-run across a deploy overlap is bounded by
the module's own root caps … so the in-memory cadence gate is pacing, not safety."* The root caps
bound the **booking**: `runVigBuyback` re-derives under its own singleton lock and simply books the
second fill SHORT. They were true of the accounting and false of the money, and a wrong claim in a
comment licenses the next reader.

**Fix:** the `runStockBuyback` pattern verbatim — a `pg_try_advisory_lock` taken **before** the
budget read and held across the send, one lock class per bot so neither blocks the other. A losing
caller **skips** rather than queues (a keeper run is a periodic sweep, so the next tick is the
retry). Comment corrected to say what actually protects it.

**Mutation:** neuter the lock → *"F1: both DEX keepers must take a single-writer lock BEFORE reading
the budget they then spend"*.

---

## F2 (MED) — one poison fill wedged both bots, forever

**`src/dexbot.js`, `src/worker.js`**

`bookUnbookedSwaps` runs **first** in `runDexBuyback` (crash recovery: book any fill the last run
journaled but never booked). `runVigBuyback` legitimately **refuses** a fill whose achieved price is
more than `VIG_MAX_PRICE_JUMP` (10×) off the last real print — the fraud/fat-finger wall, doing its
job on a real fill. That refusal escaped.

**Reproduced:** a 25× move between beats (a thin new pool over a 12h beat is enough) threw
`price_sanity` on the run that took the fill **and on every run after it**. Because the recovery pass
runs first, one unbookable fill blocked every FUTURE swap as well as its own.

And the blast radius was bigger than the fill: `runDexBuyback` and `runPolPairing` sit in the worker
with **neither call `safe()`-wrapped**, one line below an `lp depth sync` that is. So the wedge took
the POL pairing down with it every tick — bond-delivered ETH silently stopped reaching the pool.

**Fix, two halves:**
- per-row isolation inside `bookUnbookedSwaps` (the worker's own `safe()` discipline, applied inside
  the loop). The row stays **UNBOOKED on purpose** — booking past the wall would defeat the wall,
  and `no real swap unbooked > 1h` is already the alarm that fetches a human. What changes is that
  the bot keeps working while they come, and the refusal is NAMED (`bookFailed`) rather than escaping.
- `safe()`-wrap both keepers in the worker, and log `bookFailed`/`bookedShort` — a fill the accounting
  refused must be loud there, not first heard of from the nightly invariant.

**Mutation:** remove the per-row isolation → *"F2: the accounting's refusal ESCAPED the bot
('price_sanity'). bookUnbookedSwaps runs FIRST, so a throw here wedges every future swap"*.

---

## F3 (MED) — a malformed log wedged a stream, and the comment promised otherwise

**`src/watcher.js`**

The twelve chain watchers share one isolation rule: a **deterministic** data fault in a log is
skipped so the cursor advances past it, and anything else re-throws so the cursor does **not**
advance past a good event. That rule is only as good as the `POISON` list — and the list had been
grown once, for the fee stream that prompted it.

`recordHarvestFee` throws `ref` / `asset` / `amount`. None were in the set. **`syncHarvestFees`' own
comment already promised the protection**: *"a deterministically poison log is skipped so the cursor
is not stalled forever by one bad row."*

**Reproduced** — three harvest logs, the middle one a dust harvest whose fee rounds to zero:

```
tick 1: THREW amount — cursor stays 0
tick 2: THREW amount — cursor stays 0
tick 3: THREW amount — cursor stays 0
harvest revenue booked: 5   (the two GOOD fees are worth 12)
→ WEDGED: cursor 0, every later harvest fee is permanently stuck
```

The good fee queued behind it never books, and the Bank's revenue — which **is** the city leg's
budget, the pool that pays players — stops permanently, with nothing but a repeating log line.

**Fix:** the set is the CLASS, so it now lists every deterministic data fault any watched recorder
can throw, grouped by recorder. After: both good fees book, the cursor advances, the bad log is
named once.

**And a guard, because this is the third time the same class has surfaced** (R14 F2 originally, R19
F3 for this stream's comment, now the actual gap). `test/gates.js` gained **THE WATCHER POISON
LEDGER**: every `GameError` code a watcher recorder can throw must be either POISON (skip it — it can
never succeed) or **waived here with the reason it must re-throw**. Catalogue-or-declare, so a new
recorder or a new code fails until somebody decides which it is.

**It found two more on its first run** — `recordBond` → `price` and `over_capacity`. Both are guarded
on `!onchain` and the watcher always passes `onchainPayout` (bypassing the backend tranche cap is
deliberately what stops a real bond stalling this very cursor), so they are unreachable from a log
and are waived with that reason. Scope, stated in the guard: it proves each code is **classified**,
not that the classification is right.

**Mutations:** drop the harvest codes → the suite fails *"a malformed log ('amount') re-threw out of
the stream … every good event behind it is stuck FOREVER"*, and the guard independently names all
three.

---

## Lenses that came back clean

### `nft.js` (zero audit mentions)

`upgradeRarity` has no escrow gate where `requestItemWithdraw` does, which looks asymmetric until you
check what rarity is: it is **display-only in-game** — it never enters `carVal` / `carCollateralValue`,
race power, melt, fence or any gameplay number, and appears in exactly four modules. So upgrading a
listed or pledged car cannot mislead a bidder or shortchange a lender, and the tier only goes up.
The extraction path — the one place rarity becomes real, since it selects the tokenId — **does**
carry the gate. Board and mint agree on the tokenId (`itemTokenId` delegates to the same
`nftTokenId`). The `${k.table}` interpolation is a fixed internal map keyed by a validated `kind`.

### Hostile numeric input on the money routes added since the exploit hunt

180 calls over 10 route/field pairs — negatives, zero, fractional, `1e308`, `Infinity`, `NaN`,
`'1e999'`, `'1,000'`, `{}`, `[]`, `null`, `true`, `'0x10'`, `-0`. **Zero 500s, and no §10.4 check's
drift moved.**

**The instrumentation is the part worth keeping.** The first run reported the same clean result — and
printing the refusal codes per route showed **8 of the 10 were vacuous**, every call bouncing at a
precondition (`no_deed`, `no_crew`, `district`, `closed`, `not_mentor`) without ever reaching the
numeric validation. One probe was testing nothing at all: `good: 'booze'` is not a good id, so
`/v1/favors` answered `bad_good` 36 times out of 36. With real preconditions (claim a deed, found a
crew, stand where the shipment lands) the deed, shipment and crew paths reached their validation and
still refused every hostile value cleanly. *A probe where every call refuses at the door reads
exactly like a clean bill of health.*

One thing that looked like a finding and was not: `/v1/crew/target` returned 200 for all 18 hostile
`kind` values. `setCrewTarget` normalizes with `kind === 'hospitalize' ? 'hospitalize' : 'kill'`, so
garbage becomes a valid kind — and the row is a POINTER (the funding rides the audited bounty
escrow), so nothing moves. Benign, and noted: the `BKINDS.has(k)` check below that ternary can never
be false.

### Cursor discipline across all twelve watchers

Every one uses the shared `isolate`, and every one advances its cursor **once, after** the loop. The
store watcher's deliberate hold on an unknown sku is the one intentional exception and is waived by
name. `confirmStockDelivered` handles an unknown `deliveryId` as a clean no-op rather than a throw,
so an out-of-band Safe delivery cannot wedge that stream.

---

## Flagged, not changed

- `runDexBuyback` marks a fill `booked` even when `runVigBuyback` returns **null** (the revenue moved
  under it). It is flagged `bookedShort`, now logged by the worker, and caught by the swaps-vs-buybacks
  reconciliation — but the row is not retried. With F1 fixed, the only remaining way there is a
  concurrent manual mod buyback.
- The bots' RPC reads carry no timeout. A hung RPC hangs that worker tick; `safe()` catches throws,
  not hangs. Shared with every other RPC reader in the tree.

---

## Process

Four `zz*.mjs` probes written and **deleted before committing**; all mutations run on scratchpad
copies (`cp` out, `cp` back), never `git checkout`, with uncommitted work in the same files.

Both mutations for F2 and F3 initially failed as **uncaught throws** rather than at an assertion —
the "a failure that teaches nothing" shape. Both regressions now catch the throw and name the
property, so the next person to break either one is told what broke and why it matters.
