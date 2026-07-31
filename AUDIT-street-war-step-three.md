# AUDIT — Street War step three (2026-07-31)

Point-in-time. Four lenses over `c661da2` (THE TAKE, revenge with teeth, resident stables) and the
systems it reaches into — boxing, the population layer, the crime loop. Steps one and two had their
own passes (`AUDIT-street-life.md`); step three shipped without one, which is why this exists.

**No CRITICAL. No HIGH. No §10.4 drift.** Five findings: one MED, three LOW-MED, one accepted with
its claim corrected. Every finding was verified against source before it was written, every fix has a
regression, and every regression was mutation-verified to fail at its own named assertion.

Suite green. `node tools/sim.js` drift-0.

---

## Scope

Step three is three mechanics, and they touch very different surfaces:

| | what it changed | where the risk lives |
|---|---|---|
| **THE TAKE** | a job's cash is partly funded by the drawn NPC mark | §10.4 (a second character's row, debited from inside `withCharacter`), locks |
| **Revenge teeth** | `REVENGE_ATK_MULT` on seven verbs; a revenge rob takes 1.5× the cut | emission-neutrality of the venue-clock redirect; signed ceilings |
| **Resident stables** | residents field fighters and racers | status privileges, consent listings, retirement cleanup |

Lens A §10.4 and emission · Lens B locks, concurrency and persist-clobber · Lens C death, estate and
retirement · Lens D exploit, grief and Sybil.

---

## Verified sound (the load-bearing claims, checked rather than assumed)

**THE TAKE's accounting is exact.** Both legs are ledgered `crime:take` with a `character_id` and each
other as counterparty, so the per-character cash check reconciles them and they net to zero. `crime:`
was already a cash-vocabulary prefix, so no invariant changed. The debit is guarded `alive AND is_npc
AND cash >= $2`, so it cannot reach a player, cannot drive a mark negative, and cannot fire on a failed
job (it sits inside the `roll < chance` branch). `want` is clamped to `POCKET_BPS` of pocket and floored
at `TAKE.MIN`, and the mark's row was read unlocked — but the UPDATE's own `cash >= $2` predicate is what
authorises the debit, so a stale read can only ever make the take smaller.

**The lock argument holds.** `withCharacter` already holds the actor's row, so any second character lock
would invert against every two-party path that locks its pair sorted. `FOR UPDATE SKIP LOCKED` means the
statement never waits: a contended mark is skipped and the faucet pays the whole take, which is
independently correct. There is no deadlock and no `lock_timeout` on this path.

**The revenge redirect stays emission-neutral.** `effRate` is used for BOTH the cut and the venue-clock
advance (`last_collect_at = now − elapsed × (1 − effRate)`), so the owner keeps exactly `pending ×
(1 − effRate)` and total realisation is unchanged. The 1.5× is rob-only — applying it to a shakedown
would push past that verb's signed 30% ceiling. `revM` multiplies the whole attack ternary, so both the
rob and shakedown branches get it, and only the ATTACK: the owner's defence is untouched.

**Residents cannot be farmed for revenge.** `recordRival`'s aggressor is always the acting player, and
residents never initiate, so `revengeOwed` against a resident is always false — there is no free +10%
against scenery.

**A retired resident's booked main event does not strand escrow.** `resolveMainEvent` already handles a
missing fighter row (`if (!fa || !fb) cancelBout(...)`), which refunds living bettors and burns dead
ones. Checked because retirement deletes the fighter without running the estate hook; the resolve path
covers it.

**Beating an NPC fighter for a legend win is shipped design, not a new hole.** `exhibitionBout` has
banked `boxing_wins` against NPC tiers since boxing step two. Resident fighters are consistent with
that. Flagged below only for the cooldown difference.

---

## Findings

### F1 (MED) — a resident's fighter could take the #1 contender slot and kill the callout mechanic

`contenderOf` selects the top-ranked non-champ fighter whose manager is alive, and its `rows` query
joined `characters` with no `is_npc` filter. Since step three a resident fields fighters, and **one lost
bout** gives their fighter the `wins >= 1` the slot requires.

`callOutChamp` gates on `top.character_id === ch.id` — only the owner of the #1 contender may call the
champion out. A resident never calls anybody out. So while scenery held the slot, **no player could use
the step-five callout at all**, and the only way out was for a human to out-win the NPC. Reachable
immediately: resident fighters roll stats in the same band as a fresh player's, and every player loss
feeds their record.

**Fixed** — `contenderOf` filters `!f.is_npc`, with `is_npc` added to the two queries that feed it. The
board and the circuit are untouched: residents must stay visible there, because they are the opponents.
This is the same argument the step-three leaderboards already make for the legend boards.

*Regression:* `test/population.js` — an NPC fighter on 9 wins does not displace a human on 3.
*Mutation:* drop `!f.is_npc` → fails at `the #1 contender is the top HUMAN fighter`.

### F2 (LOW) — retirement left a phantom champion on the belt

`applyBeltResult` keys the belt on the FIGHTER, so a resident's fighter can win it. `retireResident`
deleted fighters with a bare `DELETE`, and retirement is **not a death** — the estate hooks never run —
so `boxing_title` was left pointing at a deleted row and a character no longer alive. Self-healing in
≤7 days via the mandatory-defense clock (or ≤48h if a player called the phantom out and the worker
forfeited the belt), but a phantom champion showed on every board until then.

The same retirement-is-not-a-death class as the step-two stranded-loan finding.

**Fixed** — `retireResident` calls `wipeFighterAtDeath`, which deletes the fighters AND vacates the belt
and any pending callout, in the canonical fighter→title lock order.

*Regression:* retiring a belt-holding resident leaves `holder_fighter` and `holder_char` NULL.
*Mutation:* restore the bare DELETE → fails at `retiring the champion vacates the belt`.

### F3 (LOW-MED) — the two new consent listings were never re-checked against live cash

The step-two audit closed exactly this: *"a drained resident's stale stake now triggers a relist instead
of standing on the board answering only `their_cash`."* That fix covered the three columns on
`characters`. Step three added **two more consent listings** — `fighters.bout_limit` and
`racers.race_limit` — and nothing ever re-checked them. They are written once at spawn from the
resident's starting cash and never touched again.

THE TAKE drains residents by design, so this is the ordinary case rather than a corner: the circuit and
the strip advertised purses the resident could no longer cover, and a player who picked the match got a
`their_cash` refusal. A dead board is precisely what the step-two fix exists to prevent.

**Fixed** — `residentAct` now rewrites any listing bigger than the pocket, using the same `uncoverable`
predicate as the three character columns (so a healthy listing never churns) and delisting outright when
the resident can no longer reach the system's own `MIN_STAKE`.

*Regression:* a resident drained to $500 with a $90,000 bout limit is off the circuit after one turn.
*Mutation:* drop the sweep → fails at `a drained resident's fighter is off the circuit … (got 90000)`.

### F4 (LOW-MED) — THE TAKE's victim was chosen by the success die

The mark index was `Math.floor(roll * r.length)`, and `roll` is the same value the branch tests as
`roll < chance`. On a **success** the index could therefore only land in `[0, chance × 8)`, and the
query is `ORDER BY id LIMIT 8` — a stable prefix. So the same two or three residents in a district
funded every job forever while the rest were never touched once.

§10.4 is unaffected (the unfunded remainder is simply paid by the faucet), but it concentrated the drain
onto a handful of marks, picked them clean early, and left the realised emission reduction well below
what the sim's P9.27 models across a district.

**Fixed** — the mark gets its own `Math.random()`.

*Regression:* `test/economy.js` — with a crime whose chance is under 0.5, an upper-half debit is
*impossible* under the bug and ~1 − 0.5^N under the fix; both halves are asserted.
*Mutation:* restore `roll` → fails with the exact predicted signature,
`[true,true,true,true,false,false,false,false]`.

### F5 (accepted; the claim corrected) — `takeFromMark`'s catch cannot do what its comment claimed

The comment said *"the mark is never allowed to fail the job."* In real Postgres a failed statement
aborts the **enclosing** transaction (25P02), so swallowing the error does not keep the job alive: the
next `h.ledger` dies with 25P02 and `withCharacter` rolls the whole action back.

Making it literally true needs a SAVEPOINT, which pg-mem cannot parse — so it would ship a code path no
suite can reach (the `recordRival` lesson, where a savepoint-first version silently recorded nothing
under the entire suite). Left as-is deliberately: with SKIP LOCKED this statement does not wait, so it
has no deadlock and no lock-timeout to hit, and the only realistic error is a `statement_timeout` on a
request already 15s deep and failing anyway.

**The comment now says what the catch actually buys**, and warns against copying it to a path that can
genuinely error. A guard whose comment overstates it is how the next reader builds on a property that
was never there.

---

## Flagged, not changed (ground rule #1)

- **Resident fighters are an uncooldowned legend route.** `exhibitionBout` banks `boxing_wins` against
  NPC tiers behind a 6h per-fighter cooldown; `fightBout` against a resident's fighter banks the same
  win with only the loser's injury clock throttling it. Bounded by how many resident fighters exist and
  by the 5% rake, and the status axis carries no payout — the accepted hitman-rep posture. The dial is a
  cooldown on bouts against `is_npc` managers.
- **`boxingLeaderboard.fighters` and `stableLeaderboard.racers` still list resident animals.** Step three
  excluded residents from the account-level LEGEND halves but not from the per-fighter ranking. Weaker
  than the legend case (that list doubles as discovery), but inconsistent — decide whether "top fighters
  in the city" is a status board or a directory.
- **The drain reroll.** Picking a district clean retires those residents and replaces them from the full
  band distribution, so cheap drains convert into richer marks. Already accepted for cars and boats in
  the step-three round-two pass; THE TAKE is the same mechanism at a faster cadence. Bounded by
  `TURNOVER.PER_DAY`.

---

## Process notes

- The F4 mutation printed the bug's signature rather than just failing, which is what made it worth
  keeping: `[true,true,true,true,false,false,false,false]` is the finding, stated as data.
- A **pre-existing date-dependent flake** surfaced mid-audit when the UTC day rolled over: the Doc's
  drill is a per-day seed draw, and on any day it lands on `train`, `test/regimen.js` had already met it
  before asserting the pre-work refusal. Same class as the population duel-ladder flake fixed earlier the
  same day, and as the recorded `growth.js` kitchen-raid one — a deterministic assertion resting on a
  probabilistic precondition. Fixed by clearing the day's counters so the precondition is guaranteed
  whatever the draw, and mutation-verified not to have gone vacuous (dropping the server's `not_done`
  gate still fails it).
