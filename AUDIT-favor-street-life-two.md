# AUDIT — THE FAVOR + Street Life step two (2026-07-31)

Point-in-time. Four lenses over THE FAVOR (#320, the player-posted escrowed call) and Street Life
step two (#321 — corner chains, the contacts ladder, standing-scaled resident requests). The
step-one pass (`AUDIT-street-life.md`) predates both: `grep -ci favor` against it returns 0.

**No CRITICAL. No HIGH. No §10.4 drift.** Five findings — three MED, two LOW-MED — all fixed. Every
finding was verified against source before it was written, every fix has a regression, and every
regression was mutation-verified to fail at its own named assertion.

Suite green. `node tools/sim.js` drift-0.

---

## Scope

| | what it added | where the risk lives |
|---|---|---|
| **THE FAVOR** | a player posts a freight request; pay ESCROWS at post; a contact runs it | escrow §10.4, the goods transfer, the second party who is never locked |
| **The corner chain** | a district's standing job — three days of showing up pays a bonus | faucet cadence vs the documented bound |
| **The contacts ladder** | a derived rank over how many numbers you hold | none (a COUNT, read-derived) |
| **Standing tiers** | a contact who knows you asks for more and tips better | the recycle-only rule |

Lens A §10.4 and escrow · Lens B locks, concurrency and persist-clobber · Lens C death, estate and
completeness · Lens D exploit, grief and cross-system.

---

## Verified sound (checked rather than assumed)

**The `favor escrow` identity is exact and matches the code term for term.** `invariants.js:346-353`
reconciles `posted − paid − takes − refunded − death − loot` against the sum of live `favors.pay`,
and every one of those six reasons exists in exactly one place in `favors.js`. The 2% take is carved
FROM the pay as one NULL-character row (the `market:take` shape), so posting to your own alt is
strictly lossy and the take is never minted on top. Asserted mid-flight, after a fill, a cancel, a
sweep and a looted death.

**The loot-proof-vault rule is honoured.** Posting is safehouse-blocked, and `voidFavorsAtDeath` puts
a dead poster's open escrow on the loot surface at `CASH_LOOT_RATE` with the remainder burned — the
`market:loot` / `loan:loot` shape, killer credited in memory (the persist-clobber rule), NPC and mod
kills passing `lootRate` 0.

**The single-party lock posture is correct, not an oversight.** The pay is out of the poster's pocket
before any runner sees the favor, so the poster's character row genuinely does not need locking; the
favor row's `FOR UPDATE` is the mutex that serialises two runners racing the same request. There is no
AB-BA surface because there is no second character lock. (The one thing that DID need the missing
lock — the poster's cargo write — is F3.)

**The sweep's lock order is the tree's standard.** `sweepFavors` locks the poster's character row
before the favor row (characters → pots), per-favor transaction, with the status re-read under the
lock so a death that already resolved the escrow cannot be double-refunded.

**Standing-scaled requests scale the ASK, never the source.** `contactStandingOf` multiplies qty and
tip, but generation still skips a contact who cannot cover the request and `fulfillCall` still clamps
`pay = min(call.pay, live, npc.cash)` — so the recycle-only rule that keeps the resident-extraction
ceiling honest is untouched at every tier. The `jobs` bump is an atomic `jobs + 1`.

**The contacts ladder is read-derived from a COUNT.** No stored axis, nothing to farm, no §10.4
surface.

---

## Findings

### F1 (MED) — the freight teleported across the city

`runFavor` gated the RUNNER's location and never the POSTER's. Cargo travels with the player, so the
goods appeared wherever the poster happened to be standing.

Neither party had to move: post from the Neon Mile for the docks, let anyone already at the docks buy
cheap and hand over, and the freight crosses the city instantly — past the convoy game, and past the
market's district-pinned pickup, which exists for *exactly* this reason (the market design says in
terms: "the market must NOT teleport freight past the convoy game"). It also made the favor a strictly
better courier than a convoy, since a convoy has a clock, a guard bill and an ambush window.

**Fixed** — the poster must be at the district too. The handoff is face to face.

*Regression:* `test/favors.js` — the existing happy path had the poster at the docks posting for the
canal, so it now asserts `poster_away` and moves them before the run.
*Mutation:* drop the gate → fails at `the poster must be THERE to take it`.

### F2 (MED) — the trunk cap was bypassed entirely

`trunkCap` was imported into `favors.js` and used nowhere. `FAVOR.MAX_QTY` is 20 against a base trunk
of 10 and `MAX_OPEN` is 3, so a favor book could put six trunkfuls into a trunk.

The cap is the bound the whole freight game rests on — bulk needs a convoy — and every other path that
puts goods in a player's trunk enforces it (the market claim, the convoy collect, the goods buy). This
one didn't, at either end.

**Fixed** — two gates. At POST, `qty` must fit the free trunk space **counting the outstanding book**
(three favors that each fit an empty trunk cannot all be delivered into it, and the poster would eat
two TTLs of parked escrow to discover that). At DELIVERY, re-checked against the poster's live load,
because the post-time check goes stale. The delivery gate is the authority; the post gate is the
courtesy. The poster's capacity is computed by the canonical `trunkCap` rather than restated — a
hand-rolled mirror is how the character view once lost the `road_boss` bonus.

*Regression:* a `room` refusal at post (both the raw `MAX_QTY` case and the book-counting case) and a
`poster_full` refusal at delivery against a filled trunk.
*Mutation:* drop the delivery gate → fails at `a full trunk can't take delivery`; drop the post gate →
fails at `no asking for 20 into a 10-unit trunk`; drop just the outstanding-book term → fails at `the 3
units already on the book count against the room`.

### F3 (MED) — a lost update on the poster's cargo

The poster's side of the handoff was a read-modify-write (`SELECT qty` → `DELETE` → `INSERT had+qty`),
lifted from `fulfillCall` — where `withTwoCharacters` holds the second party's row and makes the
pattern safe.

THE FAVOR deliberately drops that lock (correctly — see above) but kept the pattern. Two runners
filling two different favors from the SAME poster could both read the old total, and one delivery
would simply vanish: the runner is paid, the escrow closes, the goods are gone. §10.4 stays exact
throughout, because goods are not a §10.4 currency — the loss is silent by construction.

**Fixed** — an atomic `UPDATE character_cargo SET qty = qty + $3`, which is row-locked by Postgres and
is the pg-mem-safe direction (addition with a bound parameter; it is SUBTRACTION that sign-flips). A
first delivery has no row to update, so an INSERT falls through, and two racing first-INSERTs resolve
via the 23505 → `contention` retry the auction materialize race already established.

*Regression:* a second delivery of the same good ADDS to what is already in the trunk (the end state
the fix must preserve), plus a source-level tripwire for the shape the race needs — **honestly
labelled as one**, because pg-mem has no MVCC and cannot exercise the race (the `db.js`
`pool.on('error')` precedent).
*Mutation:* restore the read-modify-write → fails at `the poster's cargo is written by an atomic
increment`. The accumulation assertion legitimately still passes, exactly as documented: sequential
RMW is correct.

### F4 (LOW-MED) — the death-disposition guard could not see sixteen character-scoped tables

`test/migrate.js`'s MED-2 guard exists to **fail CI closed** when a new character-scoped table has no
documented death disposition, because "a FUTURE table a developer forgets to wipe orphans SILENTLY —
invisible to Postgres AND pg-mem". It matched `^\s*character_id\b` and nothing else.

Sixteen tables scope themselves by a named role instead: `favors.poster_character`,
`crew_heists.leader_character`, `convoys.owner_character`, `loans.lender_character`,
`market_listings.seller_character`, `secrets.holder_character`, the three wire tables, `bounties`,
`listings`, `speakeasies`, `informants`, `pen_breaks`, `world_raids`. **Every one is handled today** —
which is precisely the problem: nothing was ENFORCING it, and the guard's own summary line claimed
completeness. This is the same lesson four other guards in this repo have already taught, in a
sixteenth costume: *a check that cannot fail reads exactly like a clean bill of health.*

**Fixed** — any `%_character` column counts (61 → 77 tables), and all sixteen are classified with
their real handler named. Check (c) was widened with them: it recognised only a `DELETE FROM`, but
death cleanup takes three shapes in this tree, and a **resolving status UPDATE** is one of them (a
convoy is `'lost'`, a plan `'abandoned'`, a favor `'cancelled'` — the row stays as the record of what
happened). `favors` tripped that; the four tables already relying on a status UPDATE passed only
because their names happened to appear quoted somewhere else in `src/`.

*Mutation:* remove `favors` from the map → fails naming it unclassified; revert the regex → fails
naming all sixteen as stale classifications, which is what proves the widening is load-bearing rather
than decorative.

### F5 (LOW-MED) — a finished corner chain restarted the same day

`advanceChain` DELETEd the row on completion. A second claim in that district the same day then found
no row, skipped the once-a-day check, and took step 1 immediately.

So after the first chain the bonus arrived every **two** days rather than the three the design states.
The hard ceiling is unaffected — the bonus is folded into the claim's own ledger row and `MAX_DAY`
caps claims at 5/day, so the stated worst case of `5 × (CASH + CHAIN_BONUS)` still holds — but the
realistic cadence was 50% faster than documented, which is the kind of quiet drift that makes a
BALANCE.md figure stop meaning anything.

The BALANCE.md figure was already stating the intended cadence — `completions/day ≤ 5 ÷ CHAIN_STEPS
= 1.67` — so the bug made that number optimistic by 50% (the real steady-state bound was 5 ÷ 2 = 2.5).
The fix makes the code match the published figure rather than the other way round; BALANCE.md now
records the correction.

**Fixed** — the chain RESETS IN PLACE, stamped with today. `step: 0` renders on the board exactly as a
fresh chain does, and `advancedToday` stays true, which is also the honest answer: you did show up on
this block today.

*Regression:* `test/growth.js` — the finished chain leaves a step-0 row stamped with today, and the
board says so.
*Mutation:* restore the DELETE → fails at `the finished chain leaves a fresh row behind, not a hole a
same-day claim can start in`.

---

## Flagged, not changed (ground rule #1)

- **The post-time `room` gate can still go stale.** A poster who fills their trunk after posting hits
  `poster_full` at delivery and eats a TTL of parked escrow. Deliberate: the alternative is reserving
  trunk space against an open book, which would mean a favor could block a convoy load. The delivery
  gate refuses cleanly and the sweep refunds; the poster is never out of pocket.
- **`FAVOR.MAX_QTY` 20 now exceeds what any base trunk can take.** With F2 in place a 20-unit request
  needs `pack_mule` + `road_boss` + garage assets, so the constant is a ceiling on the strongest
  possible poster rather than a number most players can reach. That is defensible (it scales with
  build) but if the intent was "20 is a normal ask", the lever is `MAX_QTY`, not the cap.

---

## Process notes

- The F1 fix broke the suite's own happy path, and that failure IS the finding: the test had the
  poster standing at the docks while the goods were delivered at the canal, and passed.
- F4's fix needed a second widening one layer down. Classifying the sixteen tables made `favors` fail
  check (c) — the check tested for a shape (`DELETE FROM`) that four of the sixteen never use, and had
  been passing them on an accident of string matching. Widening one half of a guard is how you find
  out the other half was narrow too.
