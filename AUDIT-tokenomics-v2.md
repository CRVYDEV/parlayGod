# AUDIT — Tokenomics v2 step 1 (THE EXCHANGE + THE FAMILY YIELD)

Red team over `src/exchange.js`, its wiring (`worker.js`, `server.js`, `invariants.js`,
`rules.tail.js`), and `test/tokenomics.js`. Five lenses: §10.4/economy, concurrency & locks,
exploit/abuse, cross-system, and **the tests themselves**. Point-in-time, as of commit `b53a020`.

**No CRITICAL. No HIGH. No §10.4 drift.** Two MED, two LOW-MED, two LOW/hardening, and one finding
against my own test. All fixed in-commit, each mutation-verified.

---

## Verified sound (the things that would have been expensive)

| property | how it was checked |
|---|---|
| the burn cannot go negative or mint | `spendOmr` guards `Number.isFinite(cost) && cost > 0` and `acct.omr >= cost`, and runs BEFORE the pool decrement — a short account throws with nothing moved |
| the window's cash side is bounded | `exchange pool backed` (paid ≤ funded) + `exchange pool balance` (balance == funded − paid); every path that moves `balance` also moves a lifetime counter |
| `window:payout` reconciles per character | character_id'd, in the cash vocabulary; the test asserts the walker's cash == 500 + his own ledger sum, to the penny |
| `yield:family` is a transfer, not a mint | pool and `gangs.omr_reserve` are both inside `omrBuckets`; the reason is in NEITHER the mint nor burn term |
| no jail/safehouse gate is CORRECT here | `economy.js:swap` documents the sell direction ($OMR → cash) as deliberately ungated — "bringing money back in-game… only extraction prep carries risk". The window IS that direction. Adding a gate would have diverged from a signed decision |
| the interlock holds | window ships shut; `EXCHANGE_OPEN` is TEST_ONLY in preflight so it cannot boot in production; the test fails the suite if the window opens while the swap buy side still answers |
| amounts are validated | `MIN_OMR` floor rejects 0/negative/NaN/Infinity; the daily bucket rejects oversized asks |
| exchange_pool is a terminal singleton | both `redeem` (chars→accounts→pool) and `runBuyback` (gangs→street_tax→pool) end there; neither holds it and wants the other's earlier locks |

---

## Findings

### F1 — MED — `payFamilyYield` locked the pool BEFORE the gangs (AB-BA vs the buyback)
`runBuyback` holds gang locks and then writes `family_yield_pool`; `payFamilyYield` held the pool and
then wanted gang locks. A textbook AB-BA between two functions that run **on the same worker tick**.

What makes it worth more than its blast radius: it is **armed by the migration itself.** With
`FAMILY_YIELD.FUND_BPS` at 0 the buyback skips the pool write entirely, so no cycle exists today — the
cycle appears the moment the founder raises the exact dial the design instructs them to raise.

**Fixed:** rank unlocked → lock gangs in id order → lock the pool LAST, matching the codebase's global
`characters → accounts → gangs → singletons` order and `runBuyback`'s own documented gangs-before-
street_tax fix. Weights still come from rank across the whole ranked set, so a family that dissolves
between the read and the lock drops out and its share stays in the pot.

### F2 — LOW-MED — the pot could pay out more than it held
Per-share `round2` across the 5-4-3-2-1 weights can sum to a cent MORE than the balance. Measured:
**53 of the first 400 cent-values**, e.g. a pot of 0.23 pays 0.24 and the balance goes to **−0.01**.

**Fixed:** each share clamps to `bal − paid`. Head seat takes its full share; the tail seat absorbs
the rounding. Regression drives a 0.23 pot across five seats and asserts the pot never goes negative.

### F7 — LOW-MED — and the invariant could not see F2
`family yield backed` (paid ≤ funded) carries a `+0.01` tolerance — **exactly the size of the overpay
it would have to catch** — so a pot driven negative reported `ok: true`. The exchange pool has a
second check (`balance == funded − paid`); the yield pot had no equivalent.

**Fixed:** added `family yield balance` (identity + never-negative). Verified by dump: `ok:false`
under the unclamped code, `ok:true` with the clamp.

### F3 — MED — `/v1/window` handed the connection POOL to code inside a held transaction
The route ran `G.withCharacter(pool, …, (ch, client, h) => exchangeBoard(pool, h))` — passing `pool`,
not `client`. That checks out a **second** connection while the first is still held; with every
connection in flight doing the same, the pool deadlocks against itself. It also read outside the
caller's snapshot, and took an exclusive character lock for a pure read on a board the console polls
on every Going Legit render — the D1 contention class.

**Fixed:** `G.readCharacter` (the lock-free read path) and `exchangeBoard(client, h)`, matching every
sibling board (`wage`, `portfolio`).

### F5 — LOW — two implementations of the family-yield funding
`runBuyback` had its own inline `UPDATE family_yield_pool …` alongside the exported `fundFamilyYield`
— the exact drift hazard I had deliberately avoided for the exchange carve (`carveExchange`) and then
reintroduced next to it. Two copies in two transaction contexts is how `balance` and `lifetime_funded`
come apart, and `family yield backed` is what fires afterwards.

**Fixed:** the buyback calls `fundFamilyYield(client, …)`. One implementation.

### F6 — hardening, NOT a live bug — sort comparator
`payFamilyYield` was the only place in the tree using `localeCompare` to order ids before `FOR UPDATE`;
everything else uses codepoint order. Two lock paths ordering the same rows by different comparators is
how a deadlock hides. **Tested rather than assumed: for canonical lowercase UUIDs the two agree in
200,000/200,000 pairs**, so this was never reachable — they only diverge on case or `_` vs `-`.
Unified to one comparator for consistency; reported as hardening, not a find.

### F4 — against MY OWN TEST — the conservation assertion could not see bucket membership
`family_yield_pool` IS in the production `omrBuckets` — but the test could not prove it. The §10.4
assertion ran AFTER distribution, when the $OMR had already moved to `gangs.omr_reserve`, which is
also counted. **Mutation-verified: deleting `family_yield_pool` from `invariants.js` left the entire
file GREEN.** Had that line been forgotten, the suite would have passed while every funded pot read as
$OMR vanishing from supply, and the §10.4 alarm would have fired in production the day FUND_BPS moved.

**Fixed:** conservation is now asserted with the $OMR parked in the pot and nowhere else — the only
moment membership is observable. The mutation now fails with a diagnostic naming the cause.

**A second self-inflicted one, worth recording:** the ad-hoc probe I used to verify F7 reported the
wrong result, because `sed 's/a/b/'` without `/g` replaced only the first of two occurrences on a
line — the printed label said `family yield balance` while the code still read `family yield backed`.
The label lied and the check looked fine. Only an explicit dump of the full check objects caught it.
And the first F2 regression I wrote was **vacuous** — it seeded one family, and the overpay needs five,
so it passed under the mutation. Both are the same lesson the harnesses keep teaching: a check that
cannot fail reads exactly like a clean bill of health.

---

## Not changed (flagged, ground rule #1)

- **`payFamilyYield` runs every hourly tick, not on the 12h buyback cadence.** Harmless (a no-op on an
  empty pot) but it means ~12 small distributions a day rather than one, and on a very small pot the
  tail seats fall under `MIN_PAYOUT` and are skipped while the head seat re-takes 1/3 each hour. Not
  starvation — the pot refills — but if the founder wants one clean daily payout, gate it on the
  buyback's return.
- **`EXCHANGE.RATE` is fixed while cash inflates.** Already recorded in BALANCE.md; self-limiting, but
  wants a look each season.
- **The 30% buyback diversion when the window opens** reduces stake-pool funding, the family split and
  the event fund by the same 30%. Correct per design §2, and it is why the re-sim is sequenced.
