# AUDIT — Territory step four (fortification + rival raids)

A focused three-lens red-team over the racket-wars layer (§10.4 / emission-neutrality, the
attacker-gang→racket lock order, exploit / grief), every claim verified against source. **No
CRITICAL / HIGH.** One MED fixed in-commit (regression added); everything else verified clean.

## Fixed in-commit

**MED — the rival raid had no LOCATION gate.** The console UI states "you must be at their district"
and the whole aggression family (convoy ambush, business shakedown) is location-pinned, but
`raidRivalRacket` never checked `ch.loc` — a raid could be launched from anywhere in the city,
contradicting the client and removing the intended counterplay (the raider must TRAVEL to and expose
themselves at the target's district). **Fix:** an early `if (ch.loc !== districtId) throw 'district'`
gate (before the gang/racket locks, matching the convoy/business precedent). Regression: a raid from
the wrong district now throws `district`; the test travels the raider to the target first.

## Verified CLEAN

**§10.4 / emission-neutrality.** The win branch sets `last_income_at = now − (pending−cut)/rate ×
3600000`, so the owner keeps exactly `pending − cut` accrued — total `territory:income +
territory:muscle` over the operation's life is bounded by `rate × time`, the SAME sim-signed income
curve (no new emission, a contestable split). The `territory:muscle` credit equals the attacker
treasury UPDATE (ledgered, counterparty = the raider's gang → the new `territoryMuscleIn` IN term); the
defender's clock-advance is NOT a ledgered event (the un-accrued income never was), so the defender
treasury reconciles unchanged. `territory:fortify` is a plain treasury SINK (joined `territoryOut`).
The gang-treasuries §10.4 check reconciles with both new reasons (proven in test/social.js). Both ride
the existing `territory:` vocabulary — no vocab change.

**Concurrency / locks.** `raidRivalRacket` locks attacker-char (withCharacter) → attacker-gang → the
contested racket row — the territory gang-before-racket convention. The DEFENDER gang is never locked
(only the racket), so a concurrent `collectTerritory` (defender-gang → its rackets), `seizeDistrict`
(district → war-gangs → racket), `establishRacket` (district → gang → new racket), `fortifyRacket`, and
`upgradeRacket` all serialize with the raid on the racket row WITHOUT a cycle — every path acquires its
gang(s) before the racket, and no path holds the racket while waiting for the raider's gang. Seizure
mid-raid resolves cleanly (a transferred racket reads `owner_gang = raider` → `own`). Two raids on one
op serialize on the racket → the second sees `raid_cd_until` → `cooldown`.

**Exploit / grief.** The per-racket `raid_cd_until` (8h, set win OR lose) bounds grief to one raid per
op per 8h TOTAL (any raider sets it), so a rival can strip at most 30% of ≤8h of income at a time — the
owner collecting regularly keeps most of it, and a maxed-fortitude op resists. A failed raid costs the
raider health + energy (attacking is not free). Sybil "self-raid" (an alt in a puppet gang raiding your
main's op) gains NOTHING — it's a §10.4-neutral redirect between your own two families, no new money.
The level-8 floor + energy + P1.3 safehouse block + the new location gate bound the raider. `cut =
floor(pending × 0.3)` with `pending` capped at 24h → no overflow; `rate > 0` whenever `pending > 0`.

## Design notes (not defects, flagged)

Raiding a COLD (upkeep-unpaid) operation is allowed — `accrued(r)` is non-zero even when
`collectTerritory` would skip it, so a neglected op's pending is stealable (the owner recovers less
after they thaw). This is intended (a neglected op is vulnerable) and §10.4-neutral. The muscle cut has
NO house take (unlike casino/market) — deliberate: it's not a transfer to tax but a contest over
already-accruing income; a take would just shrink the redistribution. `TERRITORY_RIVAL_*` numbers are
founder sign-off levers.

Suite 32/32 + sim drift-0.
