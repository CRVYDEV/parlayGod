# AUDIT — The Law / RICO and The Living World (five-lens red-team)

A full-effort red-team over the two pillars shipped this session (THE LAW / RICO / informants and
THE LIVING WORLD) and their interactions with the existing systems. Five independent lenses ran in
parallel: (1) §10.4 ledger conservation, (2) concurrency / locks / persist-clobber, (3)
death / estate / PvP interactions, (4) Law internals, (5) Living World internals. Every finding
below was independently re-verified against the code before fixing. All fixes are in-commit with a
regression per fix; **suite 18/18 + sim drift-0** after.

## Fixed (verified defects)

**HIGH — the NPC-raid rout bonus re-farms while the reservoir is pinned below the floor**
(`world.js` `raidNpc`; found by 4 of 5 lenses). The rout branch fired on `after <= floor` with no
check that the reservoir was ABOVE the floor before the raid — so once the shared server-wide
reservoir sits pinned at its floor (the feature's intended steady state), EVERY landed raid re-paid
the flat `routBonus` (moreau 200k), an unbounded cash mint not backed by regen (invalidating the
pillar's "bounded by REGEN" premise; §10.4 check (a) stayed exact so the nightly sweep was blind to
it). **Fix:** pay only on the CROSSING — `strength > floorVal && after <= floorVal`. Regression:
a raid on an already-floored outfit pays loot but zero bonus.

**HIGH — the investigation meter instant-indicts an OFFLINE kitchen dealer** (`accrual.js`; Law
lens). The exposure GAIN multiplied heat by the UNCAPPED `dtMin`, unlike every other accrual faucet
(bank/racket income cap the time factor at the offline window). A kitchen crew re-adds heat DURING
the same accrual (clamped to 100), so `hv=100` fed the meter over an entire multi-day gap — a
returning dealer got indicted the instant they logged in, at max conviction odds (the opposite of
"~8h of reckless ACTIVE play"). **Fix:** cap the gain time factor at `cappedMin` (the offline
window); leave the BLEED uncapped (player-favourable, no exploit — a long absence bleeds a case off).
Regression (direct `accrue()`): a 2-day gap builds no more than an 8h one, and a 30-day AFK bleeds
to zero.

**MED — killing the witness who named YOU does nothing** (`social.js` `runEstate` informant
collapse; found by 3 lenses). Two defects in the marquee "kill the witness → the case collapses"
mechanic: (a) the collapse only subtracted exposure, never clearing the `indicted_at` LATCH the
testimony caused, so a seeded-and-indicted target stayed indicted and got force-busted anyway; and
(b) when the killer IS the named target (the rat-waiver revenge — the whole point), the blind SQL
decrement to the killer's row was clobbered by `persistCharacter(killerCh)`. **Fix:** the collapse
UPDATE now clears `indicted_at`/`jury_bought` via a `CASE` when the seed was load-bearing (a
self-earned indictment survives), AND mirrors the relief onto the in-memory killer (the
`refundPot`/`guarded_by` precedent). Regression: a seeded indictment is cleared when the witness dies.

**MED — a rat did not actually forfeit family protection** (`social.js` fire/npcHit/postBounty;
Law lens). The `rat` badge is meant to make an informant a contract magnet, but `flip` never touched
gang membership, so a rat hiding in a strong family kept omertà and defeated the waived-directed-floor
magnet. **Fix (surgical, no gang mutation):** family omertà is VOIDED for a rat target in `fire`,
`npcHit`, and `postBounty` (`&& !victimRat`) — their own family, and the whole town via the waiver,
can hunt them. Schema `rat` comment corrected to describe the actual mechanic. Regression: a family
contract on a rat is allowed while a loyal member keeps omertà.

**LOW — `raidNpc` missing the hospitalized-actor gate** (`world.js`; 2 lenses). Every comparable
armed op (`convoy` ambush, `heists`, business `shakedown`) blocks a hospitalized actor; the raid
didn't. **Fix:** added the gate. Regression: a hospitalized raider is turned away.

**LOW — forfeiture / plea could push `bank` fractionally negative** (`law.js`; §10.4 lens). With
NUMERIC (sub-cent) balances, `fromBank = total - fromPocket` could exceed the floored bank. §10.4
was unaffected (the row spans cash+bank), purely cosmetic. **Fix:** clamp `fromBank` to the floored
bank and ledger the actual seized total.

**LOW — first-touch `world_npcs` INSERT race → 500** (`world.js` `currentStrength`; 3 lenses). Two
concurrent first-ever raids on the same never-touched NPC both `INSERT` → the loser hit the PK and
23505'd into a raw 500 (not mapped by `deadlockToRetry`). **Fix:** swallow the dup and re-SELECT
under lock.

**LOW — informant collapse notified dead targets** (`social.js`; death lens). The `AND alive`
UPDATE could touch nothing while the notify loop still fired. **Fix:** notify only the rows the
UPDATE actually touched (`RETURNING`).

## Verified CLEAN (negative results on record)

- **The `goodPriceOf` → `regionShockOf` ripple** (the flagged "biggest risk"): §10.4-safe. Goods
  are ownership not currency; convoy toll debit/credit are atomic on the same `collectedValue`;
  convoy insurance uses a FROZEN `insured_loss` snapshot + the underwriting-limit cap, so a shock
  across a day boundary drifts nothing; `market.js` never calls `goodPriceOf`. `floor(blk/6) ==
  dayOf()` holds exactly (board weather == the price paid). Band is mean-neutral (0.9–1.1), floor
  holds, per-district variance real.
- **Forfeiture vs a racing fire-kill:** no double-spend — `sweepLaw` and `fire` serialize on the
  victim `FOR UPDATE`; whichever commits first, the other reads post-state (`AND alive` re-check).
- **witpro / respawn / bodyguard ordering:** the witpro guard is on the target, before any mutation
  or absorb branch; a witpro'd player is still jumpable (non-lethal, intended); mod-kill bypasses all
  three (intended). Heir freshness + `rat`-badge bloodline survival verified.
- **`flip`, `sweepLaw`, `bribe/retainer/plea/buyJury`:** no persist-clobber; `sweepLaw`'s focused
  UPDATE columns exactly match `resolveBust`'s mutations; lock order correct.
- **Law meter/courtroom math:** exposure non-negative; the indictment latch can't double-fire; the
  `dt<1000ms` early-return doesn't starve it; `bustProbOf` clamps (patrol mult applied before the
  cap); retainer stacking / jury single-buy / plea-trial gating all correct; the online player can't
  dodge the sweep.
- **Vocabulary:** `law:` + `world:` (cash), `world:` (ammo), `law:jury` (omrBurns) all complete.

## Flagged for founder sign-off (NOT patched — ground rule #1)

- **`demandTrial` at the indictment threshold** convicts at the 0.15 floor (85% acquittal → cheap
  meter reset to `ACQUIT_TO`). Intended agency, but makes indictment toothless at the instant it
  fires — a `BUST_P_MIN` / demand-trial-cooldown balance lever.
- **The NPC-raid loot $/day magnitude** (reservoir max / regen / GRAB_BPS) — the commit already
  requested a sim sign-off on the faucet; the loot slice is genuinely regen-bounded (the rout bonus
  was the unbounded part, now fixed).
- **The informant-collapse out-of-order character lock** — self-heals via `contention` (mapped
  40P01) and is the same class as the estate's existing `guarded_by`/`searches` updates; accepted as
  consistent with the established estate pattern.

Net: no §10.4 drift, no auth/persist gap, no reserve/escrow leak. Two HIGH correctness defects
(rout re-farm, offline-dealer instant-indict) and four MED/LOW hardening items closed with
regressions. `node tools/sim.js` + `npm test` green (18/18, drift-0).
