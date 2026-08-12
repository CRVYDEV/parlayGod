# AUDIT — THE FAMILY BUYBACK (Phase 1) + THE TOKEN-HEALTH BOARD

Adversarial pass over the two surfaces built in the same session as this report: `src/community.js`
(the treasury→family split's community earmark, keeper and real-value invariant) and
`src/tokenhealth.js` (the read-only economy dashboard). The reason for the pass is the first one:
**`runFamilyBuyback` MINTS $OMR** — `yield:buyback` is a new exact reason in `omrMints` — and every
real-value surface in this project gets an adversarial read before it is left alone (the desk, the
bank and the treasury each got one). Phase 1 shipped with mutation-verified tests and no red-team.

**Result: no CRITICAL, no §10.4 drift. Two findings, both fixed with a regression and a
named-failure mutation each. The rest is recorded as verified-clean or accepted-with-reasons.**

A note on how this was run: the parallel five-lens workflow that normally does this died on a
subagent quota with zero results, so the pass was done first-hand. Every claim below was reproduced
against a booted server before it was called a finding, and the two that were reproduced are the two
that got fixed — three other candidates died on checking and are recorded at the bottom, because a
candidate that dissolves is worth as much to the next reader as one that survives.

---

## F1 (MED) — a real buy with nothing to check its price against minted whatever it was told

`runFamilyBuyback`'s price wall was `if (last > 0 && …)`, so the **first real buy in a currency faced
no wall at all**. Reproduced on the unfixed code against a booted server:

```
1 ETH of real community revenue, price 1e9  →  omrBought: 1,000,000,000
runFamilyBuybackInvariants()                →  ok: true
```

**One billion $OMR — ten times the entire genesis supply — into the family pool, with every check
green.** The checks are green because they are *supposed* to be: `credited == bought` compares the
ledger to the books, and both derive from the same wrong number. This is the desk's own lesson in a
new place — *a check on quantity is blind to a bad price by construction* — which is why the wall,
not the invariant, is the thing that has to hold.

The header called `runVigBuyback` its twin, and the twin documents the identical bootstrap as "the
unavoidable bootstrap (Safe = root of trust)". **Inheriting that was the mistake, and the difference
is what the price is FOR.** Every consumer in the game reads the Vig print — the ETH vault, bond
quotes, PLEX, the exit toll — so a wrong first print there is loud and self-correcting through those
consumers. **Nothing reads this keeper's price except its own next wall.** A wrong first print here
is silent, permanent, and lands in real families' reserves.

The treasury — the most recent sibling, and the one built with the most thought about exactly this
question — took the opposite posture: *a first buy on a ticker with no print REFUSES; a first fill
that set its own reference could itself be the absurd one.* That is the right posture here.

**Fixed** with a cheaper answer than a refusal wherever one exists:

- **an ETH buy anchors on the canonical Vig print** — the number the ETH vault, bond quotes and PLEX
  already trust — so the wall covers the *first* family buy rather than starting at the second. No
  new lever, no operator ritual, and it fails closed only when the game has no price at all.
- **a currency with no anchor** (the harvest carve arrives in the market's underlying, which the game
  has no price for) takes the treasury's posture: `price_unanchored`, unless the caller passes
  `bootstrap: true`. The bot's ordinary path never sets it, so a buggy bot cannot establish its own
  reference; the mod route reads it strictly (`=== true`).
- **a bootstrap is one deliberate act, not a standing exemption** — the wall check is independent of
  the flag, so the seeded price walls every buy after it. Asserted directly, because that is the
  property that would make the flag a bypass if it were wrong.
- a **comp** needs no anchor and keeps quoting: it books zeros, so it can mint nothing.

## F2 (LOW) — a stranded budget read exactly like an empty one

`recordHarvestFee` UPPERCASES its asset symbol; the three ETH sources write a lowercase `'eth'`; the
keeper only `.trim()`d. So a bot asking for `usdc` read a zero budget, spent nothing, and returned a
**bare `null`** — indistinguishable from "the budget is genuinely empty". Reproduced: the same money
was spendable as `USDC` and invisible as `usdc`.

It fails closed (no over-spend), which is why it is LOW — but it is the *silence-reads-as-fine* class
this project keeps writing fixes for (the desk's `no_price`-quiet vs `stale_price`-alarm split), and
the cost of not noticing is a budget that sits unspent while the dashboard says the pool is fine.

**Fixed** on both halves: the caller's spelling is canonicalized case-insensitively against what the
ledger actually holds (so the caller never has to track the ingest's normalization), and the
nothing-to-do case now NAMES itself — `no_budget` vs `budget_spent`, plus the list of currencies that
do hold budget, so a typo is obvious at a glance instead of after an hour in the tables. The root cap
was moved above the price wall for the same reason: a caller who typo'd a currency wants to hear
about the *budget*, not about price anchoring. Both refuse before any write, so the order is
legibility, not safety.

---

## F3 (MED) — the same class, one system over, and worse: the bank's buy walled the spend, not the ratio

Found by sweeping every sibling that takes a caller-supplied price, because F1 is a CLASS rather than
an instance. `bank.js:recordBankBuy` takes `spent` and `omrBought` as two **independent** numbers,
caps only the first against arrived revenue, and books the second unconditionally — so the implied
price was unbounded on EVERY fill, not merely the first. Reproduced:

```
1 USDC of real protocol profit, omrBought 1e9  →  bank_city_pool.balance = 1,000,000,000
runBankInvariants()                            →  ok: true   (spend ≤ revenue: ok)
```

Green for the same structural reason as F1: `distributed ≤ bought` compares against the caller's own
`bought`. **The consequence is sharper than F1's.** The family pool exits to gang reserves, which are
burn-only; this pool's exit is `payCityLeg` → a `prize:omr` MINT **to players** plus `fundReserve` —
i.e. it raises the number `signVoucher` reads before signing a real on-chain withdrawal.

Fixed with the family keeper's answer exactly, because the game has no OMR/USDC price to anchor on
(the canonical print is OMR per ETH): continuity against the last real buy **in that asset**, a
deliberate one-time `bootstrap` for an asset with nothing to be continuous with, and the walls are
per-asset so seeding one leaves the others alone. Two mutations, each caught at its own named
assertion.

The sweep's other siblings came back clean and are recorded here so the next reader does not repeat
it: `runStockBuyback` refuses an unreferenced first fill already, `runDeskBuyback` carries a band plus
a fat-finger floor against a fail-closed anchor, and `runVigBuyback`'s documented bootstrap is
defensible precisely because its print is the number every other consumer reads.

## Verified clean (recorded rather than assumed)

- **§10.4 admissibility.** `yield:buyback` is EXACT in `omrMints` (never the `yield:%` prefix —
  `yield:window` and `yield:family` are genuine transfers and are correctly in neither term);
  `family_yield_pool` is in `omrBuckets`; the `yield:` prefix is in the vocabulary.
- **The mint and the credit cannot diverge.** `fundFamilyYield` does no rounding of its own and both
  legs use the same `boughtBooked` in the same transaction, so the pool and the ledger move by the
  identical number — there is no rounding seam of the kind that bit `payFamilyYield`'s 5-4-3-2-1
  split.
- **The pool singleton is seeded in `schema.sql`**, so `SELECT … WHERE id=1 FOR UPDATE` always takes a
  real lock. (A lazily-created singleton would have made the lock a no-op and `fundFamilyYield`'s
  bare `UPDATE … WHERE id=1` a silent zero-row write with the mint row still landing — checked
  precisely because that shape is a §10.4 drift, and it is not present.)
- **Locks.** The keeper takes exactly one lock, so it cannot AB-BA against `payFamilyYield`'s
  gangs→pool order; "the pool is taken last" holds trivially.
- **Idempotency.** `community_revenue` is `PRIMARY KEY (source, ref)`, and every one of the four
  ingests hits its OWN unique key first on a re-delivery (`fee_payments.nonce`, the store nonce,
  `sell_tax_events.ref`, `bank_revenue (source, ref)`), so the community insert is never the one that
  raises. `recordPolFees`'s two-table non-transactional path is ordered vig-first on purpose, and both
  sides are idempotent on ref.
- **Comp gates.** All five ingests carve only inside their `txHash` branch; the keeper books zero
  spend AND zero $OMR on a comp (the bank posture, stricter than the desk's, because the price is
  caller-supplied and this pool's exit reaches real families); the mod route strips a caller txHash
  unless `ALLOW_MOD_REAL_REVENUE=on`. A comp also cannot set the price reference — the wall reads
  `WHERE … AND real`, which is stricter than the Vig twin.
- **Hostile input.** An unknown currency, a negative or NaN `maxSpend`, and a non-positive price all
  fail closed. The board clamps its window to `[1, 90]` days and defaults a NaN.
- **Dissolution.** A family's `omr_reserve` is burned and ledgered `gang:dissolved`, so the more this
  keeper credits, the more is correctly destroyed when a family goes — no orphaned bucket.
- **The board moves nothing.** `tokenhealth.js` is pure aggregation; its two hot queries sit on
  `ix_tx_currency_reason`, and it is mod-gated.

## Accepted, with reasons

- **A bootstrapped currency is still unbounded in $OMR terms** for that one deliberate call: budget ×
  whatever price the operator names. It requires a root-of-trust caller AND an explicit
  acknowledgment flag, and it is the treasury's own posture ("seed it deliberately and small"). The
  ordinary path — every buy after the first, and every ETH buy including the first — is fully walled.
- **The pool can accumulate with nobody to pay.** If no family holds a seat, `payFamilyYield` pays
  nothing and the pot grows. Nothing is lost (it is a counted bucket and it pays out when seats
  exist); it is a distribution-timing property, not a leak.
- **`walletMustHold` is a floor, not an equality.** A dissolving family burns its soft claim while the
  hard $OMR stays in the community-buyback wallet, so the wallet over-holds relative to outstanding
  claims. That is the conservative direction, and an attestation floor is what it should be.

## Candidates that died on checking

Recorded because the check is the useful part:

1. **"`fundFamilyYield` rounds differently from the ledger row"** — it does no rounding at all.
2. **"The pool singleton is created lazily, so the `FOR UPDATE` takes no lock"** — it is seeded in
   `schema.sql`.
3. **"The root cap's `spent` sum omits `WHERE real`, so a comp consumes the budget"** — comps book
   `spent = 0`, so the omission cannot matter; the asymmetry with the invariant is cosmetic.
