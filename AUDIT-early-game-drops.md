# AUDIT — the early-game batch (F1 work board, F6 trades strip, F4 level-up, F3 catalog, the crew door)

Point-in-time, 2026-08-01, over `1522f9f..6a164fc`. Five drops shipped without an adversarial pass:
the coach's work board, the Trades strip on Streets, the level-up moment, the crimes/missions catalog
expansion, and the crew's door out of the nut (plus the `act()` active-board re-render that shipped
with it).

**Result: no CRITICAL, no HIGH, no §10.4 drift. Two findings, both fixed with mutation-verified
regressions.** The rest of this file is what was attacked and survived, because an audit that lists
only its hits tells you nothing about its coverage.

## F1 (LOW-MED, fixed) — a false "you must do this by hand" claim, live in two places

`CLAUDE.md` and the `PACING` block in `src/rules.tail.js` both said `levelOf` lives in the
AUTO-GENERATED half and that "a future `tools/extract-rules.js` run must re-apply that one-line
reference". **Neither is true.** `levelOf` is defined in `src/rules.tail.js` — the hand-written half,
which the extractor never opens — so a regeneration cannot clobber it and there is nothing to
re-apply.

This is the worst class of stale doc: it makes a reader take an action, on the most dangerous file in
the tree, and F3 ran the extractor this session. A reader following it goes hunting
`rules.generated.js` for a line that is not there, and either concludes the extract broke something
or adds one — which the next run silently clobbers back to the prototype's `/4`, undoing the entire
pacing pass. `CLAUDE.md` is loaded into every session, so every future reader was being told this.

`test/docs.js` already had a guard for exactly this warning — and it matched **one exact phrase**
(`RE-APPLY THIS LINE`), which appears in neither copy. Fixed both texts, and rewrote the guard to
test the CLAIM rather than the phrasing: `levelOf` must be defined in the tail and absent from the
generated file, and no text within 220 chars of `levelOf` in `rules.tail.js` / `CLAUDE.md` / `SPEC.md`
may call it AUTO-GENERATED. The corrective wording ("lives in the HAND-WRITTEN half") is deliberately
not caught — it says the opposite. Mutation-verified: restoring the claim in CLAUDE.md's *new*
wording fails by name.

## F2 (MED, fixed) — the coach led at work the server would not pay for

The work board's `cornerOpen` selected every `NOT claimed` corner job for today. But `claimCorner`
refuses on two counts it knew nothing about:

- **`capped`** — `CORNER.MAX_DAY` (5) envelopes a day, against up to 18 acceptable slots (6 districts
  × `PER_DAY` 3);
- **`done_kind`** — one envelope per KIND of work per day, and the same kind sits in several
  districts' pools.

So the rung said *"The corner has an envelope for you — finish it and collect"*, the player did the
work, and the claim was refused. It sits at the **head of the tail**, so for the rest of the day it
masked every live rung under it — violating the tail's own documented rule (*a rung that never clears
must never sit above a rung that does*), for exactly the players who engage most with the system,
since only an engaged player reaches the cap at all.

Confirmed empirically before fixing: the regression was written first and failed against the shipped
code with the right message. `cornerOpen` now mirrors both gates. The rules are RESTATED in
`loadOwned` rather than imported — `corner.js` imports `game.js`, so the dependency runs one way (the
`advanceCampaignsInline` precedent, and the same call `coachLadder` makes for `skills.js:pointsOf`) —
and `test/growth.js` pins the two against each other. Both halves have their own regression and each
was mutation-verified independently; the `done_kind` case finds its district pair at runtime and
asserts one exists, because the draw is per-day (18 slots over ~9 kinds collide by pigeonhole).

## Attacked and clean

**§10.4.** The five drops move no value that is not already ledgered. F4's refill is energy and
nerve — regen resources, the `adrenaline` precedent, no currency, no faucet, no row. F3's crimes ride
the existing `crime:<id>` faucet and its missions pay cash+respect only (the suite pins
`MISSIONS.filter(m => m.reward.omr).length === 9`). The crew settle rides the **existing**
`crew:wages` sink and a cold walk-off writes **no ledger row at all** (the `BUSINESS_SHUTTER_BPS=0`
argument). F1/F6 are reads. Sim drift-0.

**The extractor seam (ground rule #2).** The re-extract added 22 lines and deleted nothing —
`git diff` on `rules.generated.js` has no `-` lines. The hand-written half is untouched by it, which
is what F1 above is about.

**F4's refill on the wrong row.** The sharpest attack: `gainRespect` is called at ten sites, and if
any passed the ACTOR's `h` while mutating an OPPONENT's row, the refill would read the wrong
assets/disciplines and write to a row that is persisted by absolute UPDATE. Every site passes the
actor's own row, and `heists.js` explicitly guards `m.id === ch.id`. Crew members paid by direct
UPDATE correctly get no refill — the documented, deliberate asymmetry.

**The `act()` re-render, which now fires after every successful action.** Two ways it could have been
wrong, both checked: (1) rate budget — reads ride a **separate** bucket (`rd:`, burst 60) from
mutations (`human`, 1/s burst 5), so the extra board fetch cannot eat the action allowance; (2) side
effects — a brace-bounded scan of all 25 tab renderers found two mutating calls, and both
(`/v1/wire/trace`, a 15-$OMR burn, and `/v1/bond/quote`) are inside `onclick` handlers. No renderer
performs a side effect at render time.

**The work board's other four branches.** `clue_scrolls` is DELETE-on-complete with a one-at-a-time
guard, so the branch needs no liveness filter. `hustles` keeps its row at the terminal step 3, which
is what suppresses the rung — the row is never deleted, so "waiting" and "done" are distinguishable.
`daily_progress` and `npc_drills` are counts.

**Query cost.** The work board added five branches to `loadOwned`, which runs on every authed
request — the one place in the codebase where a seq scan would matter. All five ride primary keys
leading with `character_id` (four of them `(character_id, day)`), matching the access pattern exactly.

**Catalog integrity.** All 43 crimes share ONE field-set — the 14 new ones are shape-identical to the
29 legacy entries, so no consumer can read an undefined field off a new job.

**Crew gates.** `layOffCrew` has no jail/safehouse gate, and neither do `hireCrew` or `payCrewWages`
— it is consistent with its own family. (`shutterBusiness` IS jail-gated, but that is a different
system's precedent. Whether crew management should be jail-gated at all is pre-existing and outside
this batch.)

**Death/estate.** Nothing here adds character-scoped state: the work board only reads tables already
in the DISPOSITION map, `crew`/`crew_paid_at` are character columns that die with the street, and
`_leveled` is transient.

## Flagged, not changed (ground rule #1)

**The level-up refill has not been MEASURED.** It converts nerve into energy at every level boundary,
and levels come fastest exactly when caps are smallest. The reasoning that it is self-limiting (every
energy-spending action carries its own cooldown, and the harness already found energy is not the
binding resource) is reasoning, not a measurement. `tools/playthrough.js` is the tool that would
settle it, and it has not been re-run since these drops — which remains the largest open item on
this batch.

## Verification

Full suite green, sim drift-0, `test/docs.js` + `test/levers.js` + `test/client.js` + `test/routes.js`
green, and on real Postgres `npm run pgquery` (every static SQL string parses and type-resolves — the
`uuid = text` outage class, over a changed UNION) + `npm run pgcheck` 43/43.
