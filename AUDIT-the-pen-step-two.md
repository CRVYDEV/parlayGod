# AUDIT — The Pen step two (three-lens red-team)

A max-effort red-team over THE PEN step two (the hole, yard incidents, the burner phone), with focus
on the burner's jail-gate bypass into `npcHit` and the hole's two-way segregation. Three independent
lenses ran in parallel: (1) the burner phone (bypass + two-party + persist/idempotency), (2) the hole
(solitary — both directions, the sentence-clock interaction), (3) yard incidents + §10.4. Every
finding was re-verified against the code before fixing. All fixes are in-commit with a regression per
fix; **suite 19/19 + sim drift-0** after.

## Fixed (verified defects)

**HIGH — a $25k burner defeated the Pen's own defenses** (`social.js` `npcHit`; found by all three
lenses). `burnerHit` reuses the street `npcHit`, whose victim gates knew about the *street* safehouse
(`safeHoused`) and `witpro` but NOT the Pen's in-jail defenses — so a burner-called NPC hit (and a
street hire) killed a mark who had paid the yard boss for a no-shank window (`penSafe`) or was in
**the hole** (`inHole` — advertised "untouchable" in the SAME commit). The shank blocked exactly these;
the burner routed around them. **Fix:** `npcHit` now gates `penSafe(victim)` → `protected` and
`inHole(victim)` → `segregated`, parallel to the existing `safeHoused`/`witpro` victim gates — closing
both the burner route and a street hire. Regression: a burner-hit on a holed/protected inmate is
refused (and the burner isn't spent).

**MED — a protected inmate could hunt from under their shield** (`pen.js` `burnerHit`; burner lens).
The shank enforces P1.3 shield-not-bunker (`penSafe(ch)` throws), but `burnerHit` had no such actor
guard, so a $15k-protected inmate could call in hits while untouchable. **Fix:** `if (penSafe(ch))
throw 'safe'` in `burnerHit` (mirrors the shank).

**LOW-MED — a lockdown didn't stop a burner INSIDE kill** (`pen.js` `burnerHit`; burner + incidents
lenses). A `lockdown` yard event freezes the shank ("no moves on anybody") but the burner never read
the yard event, so a lockdown-day inside kill still went through. **Fix:** `if (jailed(victim) &&
activeYardEvent().shankBlock) throw 'lockdown'` in `burnerHit` — a lockdown freezes an inside kill; an
OUTSIDE call (a phone call about a free target) still goes through. Regression: both cases.

**MED/LOW — `hole_until` leaked into a future sentence** (`pen.js` shank caught branch; hole lens).
The hole stamp (`now + 30min`) was bounded only by wall-clock, but the caught shank extends the
sentence by only `CAUGHT_ADD_S` (5min) — so `hole_until` routinely outlived the sentence and, on a
re-jail within 30 min (a Bureau raid / bust-fail / new crime), reactivated on an unrelated stretch
(blocking legit actions + wrongly marking the player `segregated`). **Fix:** cap it at the sentence —
`hole_until = min(now + HOLE_MS, jail_until)`. Regression: `hole_until <= jail_until` after a caught
shank.

**Also, rollback-independence** (`pen.js` `burnerHit`): the burner was consumed BEFORE `npcHit` and
relied on txn rollback to un-spend it on a gate-throw. Restructured to consume AFTER the call goes
through — a refused call never spends the burner without depending on rollback semantics (the fee
still burns inside `npcHit`, win or lose).

**INFO — `yardEventOf` missing the `% length` guard** its sibling `leadTaskOf` has → added (safe today
since `hash01 < 1`, but the two seed-draw helpers now match).

## Verified CLEAN (negative results on record)

- **Burner atomicity / persist / idempotency:** the burner and `npcHit` share one `withTwoCharacters`
  txn; a bad call throws before the (now post-call) consume; `pen_contraband` is a separate table so
  `persistCharacter` can't clobber it; the landed-kill `runEstate({killerCh})` threads the caller
  identically to a normal npcHit; the route is covered by the global reserve-before-execute
  idempotency hook. No double-spend / free-hit.
- **§10.4 / yard incidents:** the discounted charge ≡ pool credit ≡ ledgered amount in every branch
  (`payProtection`/`bribeGuard` compute the discounted number ONCE and reuse it); `shankAdd` is added
  inside the `[SHANK_MIN, SHANK_MAX]` clamp (can't escape); the seed draw is in-bounds + town-wide +
  deterministic; `PEN_YARD_EVENT` is test-only with no production/sim path; the vocabulary is closed
  (burner rides `pen:commissary` + `npchit:hire`, incidents add no reason); the board's displayed
  cost matches what the action charges.
- **The hole:** persist-clobber clean (`hole_until=$54`); the heir starts NULL; a landed shank leaves
  `hole_until` untouched; the deliberate-fail-for-immunity "exploit" is self-defeating (a shiv + a
  miss + health + a total action lockout — the yard-boss window strictly dominates it).

## Flagged for founder sign-off (NOT patched — ground rule #1)

- **Yard-incident weighting is heavy** — 5 equally-weighted events means ~20% `lockdown` (no shanks
  town-wide) + ~20% `toss` (commissary shut) = ~40% of days hard-block the core Pen loop, only ~20%
  fully `quiet`. A steep default for a marquee loop; consider weighting `quiet` higher or a per-player
  (not town-wide) roll. Numbers are sign-off levers.
- **The hole is toothless for a near-release inmate** — capped at the sentence (the fix), so a
  short-timer who caught-shanks near release barely feels it. A balance asymmetry; a bigger
  `CAUGHT_ADD_S` on a caught shank would restore the teeth if desired.

Net: no §10.4 drift, no double-spend, no persist-clobber. One HIGH (the Pen-defense bypass, closed
across both npcHit routes) + three MED/LOW hardening items closed with regressions. `node tools/sim.js`
+ `npm test` green (19/19, drift-0).
