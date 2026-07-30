# AUDIT — STREET WAR step two + STREET LIFE (task #319)

**Scope:** the two drops shipped back-to-back without an adversarial pass — STREET WAR step two
(#317: trunk robbery, boat theft, sabotage, residents-as-marks, revenge teeth, rival-aware surfaces)
and STREET LIFE (#318: the corner boards, the black book, contact calls, broadcast removal).
**Method:** four independent red-team lenses in parallel (A §10.4/emission, B correctness/locks/
retirement, C death/estate/info-leak, D exploit/grief/Sybil), every reported finding re-verified
against source before any change, a regression per fix, each fix mutation-verified on a scratchpad
copy (the fix removed → the suite fails at a NAMED assertion). Suite + sim drift-0 after the batch.

**Verdict: one HIGH (identity leak), one HIGH-severity correctness strand (unpayable debt), no
§10.4 drift, no unbounded emission, no CRITICAL.** The headline exploit candidates — the
REVENGE_HONOR infinite drip, marks-chain seed-pool inflation, corner MAX_DAY bypass, half-price
tap fabrication — were all definitively refuted at the source (lens D mapped every
`bumpHonor(REVENGE_HONOR)` site against its `recordRival` site: all six pay-and-record at the same
branch, one line apart, so net-owed converges after exactly one revenge strike).

---

## FIXED (regression + mutation-verified each)

**C-HIGH-1 — the black book leaked the identity behind DELIBERATELY-ANONYMOUS actions.**
`withTwoCharacters` recorded a mutual MEETING after *any* completed two-party fn — including
`npcHit`/`burnerHit` (the victim is told only "a hired gun") and `exposeSecret` (the mark is told
only "the wire"). The victim's book gained a fresh `met` line from an account they never openly
interacted with — unambiguously the anonymous actor, now DM-able and tracked. Exactly the class the
house rule forbids ("the book never reveals what the game hides"), defeating two paid anonymity
mechanics. **Fix:** the meeting grant is now opt-out — `withTwoCharacters(…, { meet = true })`; the
three covert routes pass `{ meet: false }`. Regressions: test/social.js (an anonymous NPC hire
leaves NO contacts pair), test/intrigue.js (the mark does not learn the exposer's number; the
earlier hush payment IS a legitimate meeting, so the test clears the pair's book first).

**B-F1 (HIGH, also lens A cross-system) — a resident lender's retirement stranded a TAKEN loan.**
`retireResident` reclaimed only `status='open'` offers. Retirement is not a death — `runEstate`/
`voidLoansAtDeath` never run and there is no heir — so an ACTIVE loan survived pointing at a dead
lender: the borrower could not repay (the two-party repay needs a living lender → `gone`), yet
`sweepLoans` would brand them WELSHER + WANTED for the unpayable debt, and the pledged car would
grace-forfeit into a dead heirless fleet (black-holed; car conservation unaffected but the player is
punished for a debt that was IMPOSSIBLE to settle). **Fix:** retirement voids active loans — pledge
unlocked, loan deleted, borrower notified `loan_voided {reason:'lender_gone'}`. §10.4-neutral (the
principal moved at take-time; zero ledger rows). Regression: test/population.js (4b).

**B-F2 (MED) — the recordContact SAVEPOINT cache silently lost the sendDm 'called' grant on real
Postgres.** The probe-once module cache was set by whichever CONTEXT ran first; `recordContact`
rides both an in-transaction client (withTwoCharacters, the wire) and a bare pool connection
(sendDm, autocommit). Real Postgres refuses SAVEPOINT in autocommit (25P01) — so in-txn-first meant
every subsequent sendDm 'called' grant vanished into the outer catch, forever. Invisible to the
suite (pg-mem can't parse SAVEPOINT in either context). **Fix:** the savepoint is attempted PER
CALL; a context that refuses it falls back to the bare insert (safe exactly there — autocommit
can't be txn-poisoned). **Verified against a REAL Postgres 16** (scratchpad probe): the OLD code
reproduces the loss (in-txn row 1, autocommit row 0), the NEW records in both contexts, both
orders, and a savepoint still protects an enclosing txn.

**B-F3 (MED) — the broke-void resurrected the dead call.** `fulfillCall`'s robbed-blind branch
DELETEd the call then THREW `broke` — and a GameError rolls the whole withTwoCharacters txn back,
so the delete never committed and the dead call jammed the one-open-call slot until the 24h TTL
sweep. **Fix:** the void is a 200 RETURN (`{voided:true}` — the burner precedent: a side-effect
that must survive the refusal has to commit). Client `describe()` renders it. Regression asserts
the slot is FREE immediately after the void.

**B-F4 (MED) — trunk robbery reached a mark in lockup.** `assertStreetCrime` (shared by
trunk/boat/sabotage) lacked the `jailed`/`penSafe`/`inHole` victim gates v2/v3 added to
fire/npcHit/jump — and trunk freight rides ON the man, so a jailed mark could be mugged for it
while unable to respond (the exact "jail must never be MORE dangerous than the street" class).
**Fix:** the person-crime gates added to `robTrunk` specifically. PROPERTY crimes (car/boat/
sabotage/front) deliberately stay reachable while the owner is away — the garage doesn't go to
lockup with you (`stealCar` has never gated `jailed(victim)`, and that consistency is kept).

**B-F5 (LOW) — a dead/retired resident's pending call jammed the slot.** The estate wipe deletes
`contact_calls` by `character_id` only; a call keyed `npc_character` to the dead street dangled
(fulfilment finds `gone`) until the TTL sweep. **Fix:** both `runEstate` and `retireResident` now
delete `contact_calls WHERE npc_character = <the dead one>`.

**A-F1 / D-LOW-1 (both lenses independently) — one action cashed every same-kind corner envelope
on the map.** The claim's delta gate reads the *shared, cumulative* daily counter, and the same
kind sits in several districts' pools — so accepting the crime/jump slot in 5 districts, doing ONE
action, and walking the map claimed the full `MAX_DAY` ($2k + 75 respect for one job). The cash
ceiling was never breached (MAX_DAY holds under the char lock), but the "the work proves the claim"
friction was defeated. **Fix:** one envelope per KIND per day (`done_kind`) — a second same-kind
envelope needs tomorrow's draw; MAX_DAY stays reachable via distinct kinds (≥5 are drawn across the
map daily). Regression is deterministic by PIGEONHOLE: 18 draws over ~11 kinds guarantees some kind
is drawn in two districts every day — the test finds that pair and proves the second claim refuses.

**D-LOW-2 — the frozen freight pay was a free price option.** `call.pay` froze at generation;
`goodPriceOf` drifts daily and the 24h TTL spans a day boundary, so a held call could be fulfilled
only on a day the good ran cheaper than the frozen basis (netting > the 15% premium, sourced at the
cheapest district). **Fix:** fulfilment re-clamps to `min(frozen, live × premium, npc pocket)` —
the 15% premium is the deal whichever day you deliver. Regression inflates the stored quote and
asserts the live price pays.

**C-LOW-1 — retired residents left permanent dead lines in every black book.** Retirement leaves no
heir, so a kept `contacts` row rendered `street: null` FOREVER (no sweep, one row per retired
resident a long-lived player ever met). A PLAYER's number surviving death is the design (the heir
answers); a retired resident's is a disconnected line. **Fix:** `retireResident` deletes the
account's contacts rows both directions.

**C-LOW-2 — a visit call's pay disclosed a broke NPC's exact pocket.** `min(VISIT_TIP, pocket)`
encoded the exact balance whenever pocket < tip (NPC-only, weak — but free to close). **Fix:** the
tip is FIXED; a contact who can't cover it doesn't call (fulfilment still re-clamps — the
broke-void handles a post-generation robbery).

## ACCEPTED (recorded decisions, not to-dos)

- **C-LOW-3 — the book shows a contact's current `loc`.** Mostly refuted by lens C itself:
  `/v1/streets` already publishes loc for the top-100, taps/dossiers already expose it, and loc is
  a weak lever (jump/fire/npcHit are location-independent). The residual (a sub-top-100 mark's loc
  outliving a paid tap via the free book) is accepted — the book showing where your contacts hang
  out is the product; the Wire stays the deep-intel rail.
- **D — REVENGE_HONOR pair-trading** (+1 honor per 2 alt-actions, capped at 100, see-saw only):
  the accepted honor-farm posture (the loan-repay precedent, BALANCE.md).
- **D — corner/contact-call Sybil**: $2k/day/alt each claim requiring its own counted action —
  inside the accepted petty-faucet posture (smaller than the clue casket).
- **A (framing, → BALANCE.md) — the resident-extraction ceiling is ADDITIVE**: `TURNOVER.PER_DAY`
  meters `npc:seed` only (~$499k/day); the marks-layer front redirect (~$342k/day, sim P9.25) and
  boat/car realizations ride their own bounded curves on top. All ledgered, no drift — but the
  honest total is the sum, now stated in BALANCE.md § THE STREET WAR step two.
- **A (note) — `death:legacy` heir stakes** top up the drainable seed pool outside the turnover
  ceiling: bounded by `RETIRE_GENERATIONS` (6) per line + kill cadence, not player-extractable
  directly (the stake goes to the NEW resident), §10.4-clean.

## VERIFIED CLEAN (the attacks that died, with the killing line)

Lens D: every revenge-paying WIN branch records itself one line away (jump combat.js:120-121, car
740-741, trunk 819-820, boat 868-869, sabotage 909-910, shakedown/rob business.js:376-377) and
`rival_events` has no UNIQUE constraint to silently swallow a repeat — convergence holds;
`WIRE_RIVAL_MULT` needs a rival row only THEY can create by attacking you; grief is bounded by the
per-victim shields (one landed hit per window however many attackers rotate); contact-call
generation is ≤4/hour game-wide from the resident's own pocket. Lens A: no §10.4 drift, no
unenumerated reason, no unbounded emission — the marks accounting reconciles to the −$500 identity
exactly, `npc:car` grant/retire rows keep car conservation exact on every theft/kill/retire path,
`contact:*` legs net to zero even against a drained NPC, and `sackEmpire` refuses an NPC victim (no
free catalog front on a kill). Lens C: `payHush`/`flip` disclosures are by design (already named),
the `no_number`/`blocked` gate order probes no hidden state, and the estate wipe + account-keyed
survivals are complete. Locks: all street-war verbs under withTwoCharacters' sorted char locks;
corner claims serialize under the char lock; `fulfillCall` locks the pair before the goods move.

*(Point-in-time report — indexed in docs/AUDITS.md.)*
