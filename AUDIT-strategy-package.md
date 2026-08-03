# AUDIT — THE STRATEGY PACKAGE (steps one to seven)

Point-in-time, 2026-08-02. Scope: everything the strategy package shipped —

1. **Scarce holdings** (`OPERATIONS` slots, `DELETE /v1/rackets/:id`) + `SEASON_MODS` armed
2. **THE WATCH** (`districts.watch_hour`, the surprise premium)
3. **THE SEALED BID** (`district_bids`, `stakeClaim`/`resolveContest`/`sweepContests`, the new
   `turf contest escrow` §10.4 check)
4. **THE ROSTER** (`gang_members.post`, the five posts, the live gate)
5. **THE SEASON HAS AN ENDING** (`SEASON_PHASES`, `season_records`, the reckoning)
6. **THE MAP** (`DISTRICT_ADJ`, contiguity + foothold)
7. **FAMILY CHARTERS** (`gangs.charter`, the handicap)

Every drop shipped with mutation-verified tests, and step three introduced a NEW ESCROW SURFACE
(cash sitting in a table rather than a treasury), which is the class this project has repeatedly
found bugs in. None of it had an adversarial pass. This is that pass.

Four lenses: §10.4/escrow, concurrency/locks, exploit/grief, and completeness (what happens to this
state on death, dissolution and every path ground changes hands).

**Result: no CRITICAL. One HIGH, one MED, two LOW-MED — all fixed in-commit, each with a regression
that fails by name under mutation.** One balance item flagged for founder sign-off, not patched.

---

## FIXED

### H1 (HIGH) — a lapsed contest's escrow was deleted, not settled

`stakeClaim` opens a fresh window on a district whose contest has run out. It began by DELETING the
stale bids, with the reasoning stated in the code: *"a resolved contest leaves no bids and a lapsed
one is swept, but never trust the sweep to have run before the next challenger walks in — a stale
row would be free money for its owner."*

The first half of that is right and the conclusion is exactly backwards. A lapsed-and-unresolved
contest is not stale ROWS — it is **other families' escrow**. Deleting it vaporized their money with
no refund row and no burn row, which is two things at once:

- **a silent theft.** Every loser lost their entire stake — not the `CONTEST_LOSS_BPS` forfeit, the
  whole thing — and the family that had actually WON the lapsed contest never took the ground.
- **a permanent §10.4 drift.** `turf contest escrow` reconciles `SUM(district_bids.amount)` against
  `staked − refunded − burned`. Deleting a bid moves the left side and nothing on the right.
  Measured on the reproduction: **drift −120,000, `ok: false`**, and it never comes back.

**The window is real, not theoretical.** A contest expires on its own clock; the sweep runs on the
worker's. Any claim landing between the two hit this. On a busy district with several families
watching a window close, that is not a rare interleaving — it is the obvious moment to act.

**Fix.** The lapsed contest is SETTLED before a new one opens on the same ground, through the
sweep's own implementation. `resolveContest` was split into `settleContest(client, districtId)` —
the settlement inside whatever transaction the caller is already running — and a thin worker wrapper
that owns the connection and the transaction. Two callers, one implementation (the `extortFront`
one-core lesson: a copied block is how the `sackEmpire` rake-cursor drifted).

Three details that make it correct rather than merely different:

- The district row is **already locked** by `stakeClaim`, and `settleContest` takes the same lock —
  re-entrant for the claim path, the mutex for the sweep. Lock order is unchanged: districts →
  gangs in id order, which is what `seizeDistrict` already establishes.
- `d` is **re-read after the settle**, because the settlement may have changed who holds the
  district. Everything downstream — the `not_contested` gate, `turfQuote`, the floor — then runs
  against the ground as it now stands. A challenger whose stake no longer clears the new floor gets
  a clean `floor` refusal (and the whole transaction rolls back, leaving the sweep to settle it, so
  there is no partial state).
- The streets event rides back as **data** and is emitted by whichever caller committed. A feed line
  for a settlement that then rolled back is a lie nobody can retract.

**Not an exploit for the challenger.** Triggering the settlement cannot change its outcome (the bids
were committed before the window closed) and it usually RAISES the price they then have to pay,
since the winner's stake becomes the new garrison. There is no timing edge to buy.

Regression: `test/social.js` — "A LAPSED CONTEST IS SETTLED, NEVER SWEPT OFF THE TABLE". Mutation
(disable the inline settle) fails at *"the family that actually won the lapsed contest holds the
ground"*.

### M1 (MED) — the watch could be moved with somebody already at the door

`setWatch` had no gate on a live contest. The contest is PUBLIC the moment the first stake lands
(the board publishes the family count), so a holder who noticed could flip the hour away from NOW
and make every subsequent stake pay `WATCH_SURPRISE_MULT` (1.5×). Free, instant, repeatable.

That is not what the mechanic is. The watch's whole premise is that the holder **commits** to an
hour their family stands ready, and buys a cheap window by being there for it. A number you can move
the second you are attacked is a reaction, not a commitment — and it converts a strategic declaration
into a reflex.

**Fix:** the watch is frozen while a contest runs on that district (`contested`). The ordinary "our
schedule changed" move is untouched the rest of the time, and no new lever was needed — the gate is
exactly the abuse surface, because a held district can only change hands through a contest.

Regression: *"the holder cannot move the watch with somebody already at the door"*; mutation fails
by name.

### M2 (LOW-MED) — the watch was inherited by whoever took the ground

`resolveContest` clears `watch_hour` when a district changes hands and states the rule three lines
away: *"the new holder declares their own hour."* The other **two** paths ground changes hands did
not apply it:

- **dissolution** released the district with the dead family's hour still on it, and
- **`seizeDistrict`** handed that hour to whoever took it next.

So a family could take ground and inherit a public window their enemy chose, at a time they are
probably not online for — while the board advertised it. Reachable in one move: hold, declare, fold.

**Fix:** both paths clear it, with the reason stated at each site. Dissolution deliberately does NOT
clear `contest_until` — a live contest may hold other families' escrow, and only the sweep (which
selects on `contest_until IS NOT NULL`) can resolve it and give that money back. Clearing it there
would have been H1 again by another route.

Regression: "THE WATCH SURVIVES ITS OWN HOLDER" covers both paths; two mutations, two named failures.

### M3 (LOW-MED) — the roster reassign cooldown was one click from nothing

`ROSTER_REASSIGN_CD_MS` (6h) exists so that a family cannot shuffle one good man between posts to be
everywhere at once — the comment says exactly that. It read `m.post && m.post_at && …`, and
`vacatePost` (free and instant, by design) cleared `post_at` along with the post. So: stand him down,
his stamp goes with the chair, walk him into the next one the same second.

The reactive flip that buys is precise: **Bagman all week for the cheap pad, Enforcer the moment a
contest opens** — the Enforcer bonus is read live at every quote, so the flip lands on the very next
stake. Same shape as M1: a commitment that isn't one.

**Fix:** `post_at` is when the man last CHANGED posting and is never cleared — not when he took up
the chair he is sitting in. `vacatePost` and the displace-the-incumbent UPDATE both keep the stamp,
and `assignPost` checks it regardless of whether he currently holds a post. A man who has never held
one is unstamped and assignable immediately.

Regression: standing him down is refused for the same window, including back into the chair he just
left, and he takes a post again once settled. Mutation (restore `post_at=NULL` on vacate) fails at
*"standing him down is not a way around the cooldown — it is the same shuffle"*.

---

## VERIFIED CLEAN

**The contest escrow identity.** `SUM(district_bids.amount) == staked − refunded − burned` matches
the code term for term. Refund + burn == the stake exactly on every loser (`back = floor(amt ×
(10000 − lossBps) / 10000)`, `burn = amt − back`), the winner's whole stake burns into the garrison,
and a family that dissolved mid-contest burns its whole stake through the same term. The charter's
`contestLossMult` is clamped under 10000, so a stake can never forfeit more than itself.

**The treasury side.** `turf:claim` is an OUT and `turf:claim:refund` an IN, both matched on the
EXACT reason so `turf:claim:burn` (which reaches no treasury) is counted only by the escrow check.
A dissolved family's `gang:dissolved` row zeroes its treasury while its stake is still in escrow —
correct, because the stake left the treasury at claim time and the escrow check holds it until the
sweep.

**`vanity:charter`** rides the existing `vanity:%` burn term and vocabulary, so the charter needed no
`invariants.js` change at all. The two charter SINK multipliers ledger the MODIFIED number (the
decree/amnesty/roster discipline), so the gang-treasuries check reconciles the smaller figure.

**Post assignment.** The gang row is locked first, the target post is cleared before the assign, and
a man's own previous post is replaced by the same UPDATE — so one man one post and one post one man
both hold under concurrency, without needing a UNIQUE constraint the schema does not have.

**`turfQuote` symmetry.** The Enforcer bonus, the coalition discount, the surprise premium,
contiguity, foothold and the charter multiplier are all the ATTACKER's price only and all zero on an
unheld or NPC-occupied district. A defender raising their own stake is never surprised on their own
turf and never coalitions against themselves.

**The outright buy and the contest cannot coexist** on the same district: `seizeDistrict` refuses any
player-held district, and a live contest also freezes an unheld one (so a family that had already
staked cannot be undercut at the base price if the incumbent dissolves mid-window).

---

## RESIDUAL — retry-masked, accepted (pre-existing)

`removeMember`'s dissolution locks the gang row and then UPDATEs `districts`, while
`stakeClaim`/`seizeDistrict`/`settleContest` lock districts and then gangs. That is an AB-BA, and it
**predates the sealed bid** (the turf release and `seizeDistrict` have had this shape since M3). It
lands as 40P01, which both `game.js` wrappers and the headless death paths map to a clean retryable
`contention` — the codebase-standard posture for this class (the market `bidListing` AB-BA is the
recorded precedent).

The inline settle adds one narrow variant: two concurrent claims on DIFFERENT districts, each
settling a lapsed contest with overlapping bidder sets, can take gang rows in different orders.
Same 40P01, same retry. Tightening it would mean locking the actor's gang before the district, which
inverts against `seizeDistrict` — a worse cycle for a rarer one. Left as-is, recorded here.

---

## FLAGGED FOR FOUNDER SIGN-OFF — **RESOLVED 2026-08-03, founder-directed**

**The garrison ratchets DOWN under favourable conquest.** The winning stake becomes the new garrison,
and a stake only has to clear `turfQuote`'s cost — which is the outbid price multiplied by every
discount that applies: coalition (0.5) × foothold (0.85) × reckoning (0.75) × the Outfit charter
(0.85) ≈ **0.46**. So a family conquering under favourable conditions installs a garrison roughly
half what the previous holder paid, and the NEXT attacker's floor is computed from that. A chain of
such conquests walks a district's price down, bounded below only by `M3.SEIZE_BASE`.

Arguments both ways, which is why it is a founder call rather than a fix:

- *For leaving it:* every one of those discounts is a deliberate reward — a coalition against a
  hegemon, a contiguous foothold, the reckoning opening the map in the season's last week, a charter
  that made turf its speciality. Compounding them is the intended payoff for arranging all four, and
  a cheap district is a contested district, which is the package's whole aim.
- *Against:* the discount is meant to price THIS conquest, not to become the district's standing
  value. It also means the discounts apply twice — once when you take it, and again to everyone who
  comes for you afterwards, including your enemies.

**Fixed:** the stored garrison is floored at what the ground was worth before —
`max(winAmt, previous garrison)`. A discount prices the CONQUEST, not the district.

Two numbers in the paragraph above are corrected by the regression that was then built for it, and
both errors were in the direction of overstating the problem. **The 0.46 is the discount PRODUCT**,
but `SEIZE_OUTBID` (1.5) applies first, so the fully-stacked floor is `1.5 × 0.4607 = 0.69×` the
previous garrison — a ~31% fall, not ~54%. And the ×1.5 surprise premium on an undeclared or
off-hours watch **cancels the ratchet by itself**, so it only bites on an attack landing inside the
holder's declared window. Measured at three of the four discounts with the watch open: **$162,562
against a $200,000 garrison**, −19% per conquest, compounding. The other two dials were rejected on
inspection — storing the undiscounted `base` discards the winner's over-commitment and forces
monotone inflation; capping the discount product weakens the rewards, which would be a balance
change rather than a fix. Full record in BALANCE.md.

---

## Method note

Four candidate defects were ruled out by reading source before any of the above was written: there
is no FK cascade on `district_bids` (a deleted gang leaves its bid, which is what lets the settle
burn it correctly); bids are deleted at resolve, not before; an unheld district cannot be
contest-frozen into unavailability; and a holder cannot lower their own garrison to make their turf
cheap for a friend. Each of those would have been a finding if true, and each took less time to
check than to speculate about.

The H1 reproduction was built and run against the shipped code BEFORE the fix, and the drift number
above is measured, not derived. Every fix in this report has a regression that was seen to fail
against the unfixed code.
