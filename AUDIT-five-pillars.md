# AUDIT — The Five Pillars (honor · diplomacy · sovereignty · campaigns · bloodline)

A three-lens max-effort red-team over the five-system content expansion
(`omerta-five-pillars-design.md`; `src/honor.js` `src/diplomacy.js` `src/sov.js` `src/campaigns.js`
`src/bloodline.js` + integration in `social.js`/`game.js`/`loans.js`/`pen.js`/`law.js`/`kitchen.js`).
Each lens ran independently against actual source; every reported finding was re-verified before any
fix. **Result: no CRITICAL. One HIGH, one MED, and correctness LOWs — all fixed in-commit with a
regression each. §10.4 and death/estate completeness verified CLEAN.** Suite 34/34 + sim drift-0.

## Lens A — §10.4 / economy: CLEAN
No defect at any severity. Every cash movement in the five modules writes a matching ledger row with
the correct `characterId`/`counterparty`; the two new reason prefixes are correctly vocabularied and
bucketed; the status axes move no currency; the one faucet is exact and bounded.
- **honor / diplomacy / bloodline** — zero currency surface (status rows + honor NUMERIC column only).
- **sov** — four treasury SINKS (`sov:build/upgrade/upkeep/siege`), each debits EXACTLY the ledgered
  amount, character_id NULL, counterparty = the paying gang; NO faucet; a siege win writes only
  `sov_points` + a tier decrement/DELETE (no currency). `razeSov` is a bare DELETE (the build cost was
  a permanent sink, correctly not refunded).
- **campaigns** — the one faucet `campaign:reward` is character_id'd, exact (credit == the single
  ledger row), and bounded once-per-street (the `claimed` flag under the withCharacter char lock;
  `campaign_progress` is estate-wiped so a fresh street re-walks — a roguelike reset, not unbounded).
- **invariants** — `sov:`/`campaign:` are in `KNOWN_REASONS.cash`; `sov:` is subtracted as a treasury
  OUT term (`sovOut`); `campaign:` reconciles via the per-character cash check automatically.
- The declareWar/seizeDistrict coalition discounts ledger the DISCOUNTED number (not the full price).
- **Doc note (not a defect):** the campaign faucet magnitude was understated in the design doc — actual
  ≈ $9k–22k/chain (base + a ruthless-branch sweetener always paired with a negative honor cost),
  ~$88.5k total once per street. Corrected in the design doc; flagged for sim + BALANCE.md sign-off.

## Lens B — concurrency / locks / persist-clobber: 1 LOW (fixed)
- **Persist-clobber CLEAN** — `characters.honor` is NOT in `persistCharacter`'s positional UPDATE
  (verified 0 matches), so `bumpHonor`'s direct write is the sole writer and is clobber-safe; it also
  sets `ch.honor` in memory. No other new direct-SQL character column exists.
- **honor write-races CLEAN** — every absolute `bumpHonor` call holds the target's `FOR UPDATE` lock
  (withCharacter / withTwoCharacters); the two set-based writers (bodyguard save, overdue sweep) are
  atomic and NUMERIC-safe.
- **Diplomacy CLEAN** — two-gang lockers use sorted-pair order (matching declareWar); coalition ops use
  gang→coalition order; `sweepDiplomacy` uses autocommitted `pool.query` (no hold-across-delete), so it
  cannot cycle with `dissolveDiplomacy`.
- **Sovereignty CLEAN** except the LOW below — char → own gang → sov row, defender gang never locked;
  `seizeDistrict`+`razeSov` acyclic vs sov ops (no sov path locks a district).
- **Campaigns / Bloodline CLEAN** — `advanceCampaignsInline` touches only the actor's `campaign_progress`
  (transitively locked); `step`/`done` written absolute (pg-mem-safe); `recordDeath` idempotent per
  generation under the victim lock.
- **LOW-B1 (FIXED)** — `buildSov` read the district holder UNLOCKED while `seizeDistrict` locks it FOR
  UPDATE, so a build could race a seizure and orphan a stronghold on turf that just changed hands
  (benign, self-limiting — the next seize razes it — no deadlock/§10.4 impact). **Fix:** `buildSov` now
  locks the district row FOR UPDATE and re-verifies the holder under the lock. Lock order stays acyclic
  (no sov path ever locks district-then-gang).

## Lens C — exploit / grief / death-estate + gate matrix: 1 HIGH, 1 MED, LOWs (all fixed)
- **Estate/death completeness CLEAN** — `campaign_progress` is in the runEstate wipe AND the migrate
  DISPOSITION map; honor heir echo = round(victim.honor × 0.25); bloodline is account-keyed, written
  before the wipe, idempotent, and correctly NOT wiped (survives); dissolution cleans diplomacy + sov
  with no orphans; a seized district razes its structure.
- **Gate matrix CLEAN** except the siege gap (MED-C1) — all mutating routes go through withCharacter +
  canCommand where required; campaign start is standing-gated; build/upgrade require district-held.

- **HIGH-C1 (FIXED)** — the siege cooldown was per-STRUCTURE (shared across all attackers), set win or
  lose. With a 2h daily window and a 24h cooldown, exactly ONE siege attempt per structure was possible
  per day, server-wide. A friendly ally / throwaway alt boss could throw one (likely-losing) siege at
  window-open each day for ~$50k and thereby SHIELD a Citadel from every real attacker for 24h — and
  legitimate multi-attacker contests were broken (first family in blocks all others). This inverted the
  pillar's anti-snowball intent. **Fix:** a new `sov_siege_cooldowns(district_id, gang_id, cd_until)`
  table scopes the cooldown PER (attacker gang, district). Each family is still throttled 24h, but one
  family/alt can no longer deny the slot to everyone — a hated hegemon now faces many families' sieges.
  Cleared on raze (a rebuild isn't pre-shielded) and on dissolution; the retired `siege_cd_until`
  structure column is left in place, unread. `sovBoard.siegeCdSeconds` now reflects the VIEWER's own
  per-attacker cooldown.

- **MED-C1 (FIXED)** — `siegeSov` lacked the jailed / hospitalized / safehoused actor gates its direct
  sibling `raidRivalRacket` enforces (P1.3 "shield, not bunker"), so a safehoused/jailed/hospitalized
  boss could lead a siege while immune/incapacitated (grief + free sov-point accrual; no §10.4 gain
  since the chest burns). **Fix:** added the three gates (`jailed`/`hospitalized`/`safeHoused`).

- **LOW-C1 (FIXED)** — the Mad Dog political lockout (`isMadDog`) gated `proposePact`/`formCoalition`
  but NOT `acceptPact`/`joinCoalition`, so a Mad Dog family could still enter pacts/coalitions by having
  the other side propose or by joining. **Fix:** added `isMadDog` to both.

- **LOW-C2 (FIXED, hardening)** — `claimCampaign`'s branch-cash sweetener was looked up by a global
  branch-id scan across all steps; safe today (each chain has one choice step with unique ids) but a
  future multi-choice chain reusing a branch id could pay the wrong sweetener. **Fix:** the lookup is
  now keyed to the choice STEP that actually offered the branch.

### Accepted / flagged (NOT patched — ground rule #1 / Sybil posture, in BALANCE.md)
- **LOW-C3** — Man-of-Honor laylow discount is farmable via ~30 alt loan-repay cycles (+2 honor each).
  Sybil-gated (needs an alt per cycle, burns the 5% vig, honor dies with the street) for a ×0.9
  discount; the founder dial is a per-day honor-from-repay cap.
- **LOW-C4** — a Sybil ring can make an alt family "dominant" and coalition against it for the war/seize
  discount. §10.4-neutral, needs 2 families + a dominant alt, minor treasury savings — the same Sybil
  posture as every status system.

## Regressions added (test/expansion.js)
- per-attacker siege cooldown: the same family is throttled 24h; a DIFFERENT family is NOT shielded by
  it (razes the hold) — proving HIGH-C1.
- no siege from a safehouse (`safe`) — MED-C1.
- a Mad Dog can't accept a pact nor join a coalition (`mad_dog`) — LOW-C1.

Suite 34/34 + sim drift-0 after all fixes.
