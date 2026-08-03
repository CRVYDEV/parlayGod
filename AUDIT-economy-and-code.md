# AUDIT — the full economic + code pass (2026-08-03)

Founder direction: *"Run a full economic balance & code audit of every function, every button &
task. Apply your recommended fixes."*

That instruction has two halves and they want different tools, so this pass separates them
explicitly rather than pretending one covers both.

---

## 0. What was already machine-checked, and what that leaves

The *"every button & task"* half is not a reading exercise here — it is nine standing guards, and
all of them were green at HEAD before this pass began:

| guard | what it proves | scale at HEAD |
|---|---|---|
| `npm test` | 64 suites | green |
| `test/client.js` | every control the console + /admin can fire resolves to a mounted route, with a body the handler reads, a catalog-backed value, a board field the server sends, and a gate the renderer honours | 550 routes / 179 bodies / 571 board fields / 678 element fields / 69 gated lists |
| `test/routes.js` | every registration is authenticated except 24 declared-public ones, checked BOTH ways | 550 registrations |
| `test/levers.js` | every founder-signed number is pinned AND read by `src/` | 544 pins, 8 declared-inert |
| `test/docs.js` | SPEC's size table, the rules-seam claims, the codex drift detector | — |
| `test/preflight.js` | every env var classified; test-only knobs cannot reach production | — |
| `npm run mobile` | 33 screens × 2 viewports: overflow, fold, tap targets, page errors | 66 checks |
| `npm run pgquery` | every static SQL string PREPAREs on real Postgres | 2234 statements |
| `npm run pgcheck` | the loop, the locks, the ledger on real Postgres | 43/43 |

So a route that does not exist, a button that sends a field nobody reads, a screen that renders
`undefined`, a lever nothing reads, or a `uuid = text` comparison would all have failed the build
already. **What those guards structurally cannot see is whether a NUMBER is sensible** — that is
what `tools/sim.js` measures and what a person has to judge — and whether a code path that no test
drives is sound. Those two are this report.

---

## 1. THE HEADLINE — 36 income assets, none inside a healthy payback band

**Severity: the largest open economic defect in the game. Fixed.**

`tools/sim.js` P9.20b had been printing this every run since 2026-08-01 and it had been recorded in
BALANCE.md as *"NOT retuned (ground rule #1)"* awaiting a founder call. This direction is that call
(the L1/L2 precedent, where *"Balance the economy"* carried the same weight).

Three catalogs do the same job — buy once, drip forever, cost no energy: `RACKETS` (18),
the Legit Fronts half of `ASSETS` (13), `BUSINESSES` (5). Measured:

| | before | after |
|---|---|---|
| payback range | 0.58d — 2.98d | **1.09d — 12.00d** |
| inside the healthy 3–14d band | 0 of 36 | **27 of 36** |
| pay for themselves in under a day | 14 of 36 | **0 of 36** |
| whole racket ladder | $166,039,200/day | **$24,953,760/day** |
| whole Legit Fronts ladder | $94,262,400/day | **$10,854,000/day** |
| the 12 metered seats one player runs | $243,864,000/day | **$33,178,320/day** |
| that against the top-tier crime grind | ~19× | **~2.6–4.4×** |

**The shape was already right; the scale was wrong.** The original curve tapered slightly (0.58d →
1.81d) — it was simply 4–7× too generous end to end, so the taper never became a decision. A
permanent, energy-free asset that pays for itself in under a day is not a purchase.

**Fixed through the machine-owned seam** (ground rule #2 — prototype edit + `node
tools/extract-rules.js`). The regenerated diff was **exactly 62 lines: 31 income values across two
files and nothing else.** Each rung derives from `income/min = cost ÷ (paybackDays × 720)` with
payback swept 2.0d → 12.0d per ladder. The on-ramp stays deliberately generous.

**Progression is unaffected; only the passive cash moved.** `tools/playthrough.js`, both sides, same
day: level 35 → 34 (inside the recorded ±1 noise at 10h), $1,551,736 → $1,065,464 over the 7-day solo
run. §10.4 drift-0 — every rung is still an ordinary ledgered faucet.

**Guarded**, because both catalogs are machine-owned and a bad re-extract would silently undo it:
`test/economy.js` asserts the TAPER as a relation over the live tables (a dearer rung must cost
more, earn more, and pay back no faster; every rung inside a 1.5–14d envelope; the apex ≥ 8d), so
content can be added freely as long as it lands on the curve. Mutation-verified both ways.

---

## 2. THE CODE FINDING — a comp could fund the withdrawal reserve

**Severity: MED. Fixed, with the check that would have caught it.**

`src/desk.js` (economy v3 steps 2–4) is the newest real-value surface in the tree and had shipped
with mutation-verified tests but no adversarial pass. Reading it against the project's own
anti-fabrication discipline found this:

`runDeskBuyback` credited `chain_reserve.funded_omr` **unconditionally**, whether or not the buy
carried a `txHash`. That column is what `signVoucher` checks before signing a REAL on-chain
withdrawal, so crediting it is the assertion *"hard OMR arrived"* — precisely the assertion a mod
call must never be able to make. It is the same class as two findings this project has already
fixed: `mod/bond/simulate` fabricating Vig revenue (AUDIT-full-system-v2 D-MED2) and `mod/rwa/buy`
stamping `real=true` (AUDIT-rwa-float).

**And every check was blind to it.** `runDeskInvariants`' *"buyback backed by a real purchase"*
compares the soft mint to `desk_buys.omr_bought` — both include the comp, so they match. The Vig's
two-sided `reserve fully backed` / `not under-funded` pair summed `desk_buys.omr_bought` with no
`WHERE real`, so the comp appeared on both sides and cancelled.

**Why it was not exploitable today, and why that is not a defence.** `runDeskBuyback` requires
`eth ≤ polBudget.left`, and `recordPolFees` books ZERO for a comp — so with
`ALLOW_MOD_REAL_REVENUE` off the budget is 0 and a pure comp buyback cannot execute at all. That is
a defence **by accident**, from a different constant, and it evaporates the moment that QA flag is
turned on (which is exactly when a mixed real-fees / comp-buy call becomes possible).

**Fixed on both halves, which is what turns the sandwich into a real check:**
- `runDeskBuyback` funds `chain_reserve` only when `real`. The SHELF credit stays unconditional —
  it is soft supply inside `omrBuckets` that can only reach a player through a fill, and QA needs
  inventory to test the sell side (the `mod/desk/fill` precedent, which is documented as
  legitimately real on the $OMR side).
- `vig.js` counts `desk_buys WHERE real` toward `deskToReserve`. Both halves must move together or
  the sandwich fires spuriously — which is the point: with both gated, a comp-funded reserve now
  trips it instead of being absorbed.

Regression in `test/desk.js` (a comp restocks the shelf and funds no reserve, and the sandwich sees
only the real buy). Mutation-verified twice, each caught at its own named assertion.

**Verified CLEAN in the same read** (stated rather than assumed): the Dutch clock cannot descend
below the reserve (`auctionPriceAt` clamps `frac` to [0,1], so the reserve IS the floor); the fill's
three clamps make wall 2 hold by construction and the shelf can only shrink through a clamped fill;
the lock order (accounts → `desk_inventory` → `desk_auctions`) matches the recycle path, so no
AB-BA against any sink; `polBudget` is read under the `desk_inventory` lock so two concurrent buys
cannot each see the whole budget; and the fat-finger price floor is fail-closed rather than clamped.

---

## 3. TWO SMALLER FIXES FROM THE SAME PASS

**The coach quoted a price it could not verify.** *"You can get made for free"* hardcoded
`PLEX_MINT_OMR` (5) as the mint price, but `plexQuote` is `max(floor, feeEth × the latest buyback
oracle × premium)` — so 5 is only the PRE-MARKET floor, and the moment a buyback prints above ~417
$OMR/ETH the real price moves and the hint becomes a lie the player discovers at the till. This is
the first-front hint's lesson (price off the live surface or don't state a price). `vig.js` imports
`game.js`, so the quote can be neither imported nor read without a query on the hot path — the rung
now points at the Store, which quotes it, and reads the MISSION's own $OMR reward from the catalog
so a re-extract cannot leave it firing before the job it names exists.

**A harness warning that was a harness gap.** `tools/playthrough.js` reported
`⚠ "You can get made for free" held 60% of advised play and this player could never act on it`.
Checked FIRST as a possible harness gap, per the recorded corner-rung false alarm — and it was one:
the rung clears on `acct.minted`, reachable by any player via `POST /v1/plex/mint` →
`/v1/character/mint`, which the harness simply never called. Wired (reading the LIVE quote, not the
floor); the warning is gone and the rung is in the obeyed list.

**And one in the sim itself.** P9.20b's verdict hardcoded *"every rung still pays back inside three
days"* and its under-a-day note carried a conclusion sitting beside a figure that had since outgrown
it (`0 of 36` next to *"so the buy decision is … have I clicked it yet"*). Both are derived from the
measurement now. This is the retired-`laundering.ammSpot` class: a claim that stays true-LOOKING
after the thing it described is gone.

---

## 4. FLAGGED, NOT CHANGED (ground rule #1)

**(a) `buyAsset` has no level gate.** 13 Legit Fronts are bounded by price alone. With payback now
stretched to 12d the price genuinely IS the gate (the harness has a solo player at ~$1M by day 7
against a $60M apex), so this is a consistency wart rather than an open door — but it is a gate
nobody chose. The dial is a `lvl` field on those entries.

**(b) The JAILBIRDS bust EV rises monotonically with the sentence.** The §7.8 chance curve is
`max(0.10, 0.7 − remaining/400 + …)`, so **anything over 240s sits on the 10% floor** while the
reward `500 + remaining×15` keeps growing — the two terms never offset inside the `JAILBIRDS`
range (240–1200s), and camping the longest spawn is strictly best. Both dials cost more than they
buy: the reward line is §7.8 spec, and pulling `MAX_S` under 240 would gut the availability the
birds exist to provide (a 4–20 minute window per hourly worker tick is already thin). Left as a
founder call with the mechanism written down rather than silently retuned.

**(c) 4 of 4 recurring family strategic costs are FLAT constants** (P9.20d): declare war $10,000,
siege $50,000, invade $50,000, take an unheld district $30,000, against a maxed family's
$64,506,960/day. Two of those four (invade, seize) already ratchet on the contested thing's own
value and the sim is reporting their FLOOR; the genuinely flat pair are `WAR_COST` and the sov
siege chest. The right fix is to INDEX them (the contest ratchet is the model) rather than raise
them, since raising a constant only moves which week it stops mattering — but that is a new
formula, not a number, so it stays a founder call.

**(d) The five `BUSINESSES` fronts still pay back in 1.09–~3d**, below the band. Their curve was
measured and signed separately by the L1a/L1b package on 2026-07-24; re-cutting a signed number
twice within nine days, unasked, is not an audit finding. Their shape relative to the drip is now
RIGHT, which is the more important property: fronts are the premium layer (level-gated, pad-paying,
Bureau-raidable, Sacking-losable) and should out-earn the safe drip per slot.

---

## 5. AND ONE THE GUARDS FOUND ON THE WAY OUT

CI failed `test/client.js` on *"the PARAM_FIXTURES entry for `/v1/casino/ring/:p` produced no id"*
against ten clean local runs, one of them inside a full `npm test` on the same commit. **The
recorded flake shape, for the third time**: a deterministic assertion resting on a precondition
that is merely likely. The ring fixture needs the character out of lockup, at the Neon Mile, and
holding the buy-in, and only the location was guaranteed — the seed immediately before it ends
with a boost loop that resets `jail_until` per attempt and breaks on success, so a run whose last
attempt busts leaves the fixture JAILED. Reproduced exactly by forcing it. Fixed by GUARANTEEING
the precondition (the den's own gates are what `test/casino.js` exists to check; here they are only
a precondition for reaching a board), and the refusal is now PRINTED, so the next occurrence names
the server's reason instead of leaving it to be guessed. Verified both ways.

This is also ground rule #8 working as written: `npm test` was green locally on that commit, and
the only reason the defect was seen at all is that CI was read after the push.

## Result

Suite 64/64 · sim §10.4 drift-0 · mobile 66/66 · every standing guard green · two fixes with
mutation-verified regressions · four items flagged with their mechanism and their dial.
