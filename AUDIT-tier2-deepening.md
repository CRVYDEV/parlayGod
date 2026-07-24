# AUDIT — the Tier-2 → Tier-4 deepening program (4 systems)

**Date:** 2026-07-24 · **Scope:** the four Tier-2-thin systems expanded to Tier-4 this program —
THE KITCHEN, ASSETS & RACKETS, THE MEGAPROJECT, and THE FIVE PILLARS (the honor pillar) — plus every
file each touched. Design: `omerta-tier2-deepening-design.md`.

**Method:** a focused self-review across four lenses (§10.4/faucets, concurrency/lock-order,
persist-clobber, cross-system) over each drop, backed by: each system's suite green after its drop,
the full 43-suite `npm test` green after every commit, `node tools/sim.js` drift-0 after every commit
(the strongest §10.4 proof — the sim earns the whole economy through the public API and asserts the
full sweep), and a targeted persist-clobber grep confirming every new direct-SQL column is absent from
the persist positional UPDATEs.

**Result: no CRITICAL, no HIGH. §10.4 drift-0 throughout. Every new faucet bounded + flagged for sim.**

---

## Verified CLEAN

- **§10.4 vocabulary + conservation.** New cash/omr reasons ride sensible vocab entries:
  `kitchen:module` (cash SINK + omr BURN), `kitchen:cut` (cash SINK) → the new `'kitchen:'` prefix in
  BOTH the cash + omr `KNOWN_REASONS` + the omr burn term; `racket:upgrade` (cash SINK) → added to the
  cash vocab. The megaproject + honor status axes (`monument_built`, `honor_peak/low`, `product_moved`,
  `tycoon_earned`, per-racket `level`) move ZERO §10.4 currency — the contribution cash/goods/$OMR still
  rides the pre-existing `megaproject:`/`racket:income` reasons. The sim asserts drift-0 across every
  check with all four drops live.
- **Persist-clobber.** Every new state written by direct SQL — `characters.lab_purity/lab_yield/
  lab_stealth`, `character_rackets.level`, `account_persistent.product_moved/tycoon_earned/monument_built/
  honor_peak/honor_low`, `gangs.monument_built` — is ABSENT from `persistCharacter`'s positional UPDATE
  and `persistAccount`'s column list (grep-verified — both returned empty). The account-level bumps
  (`tycoon_earned` in accrueAndLedger, `product_moved` in deal + crew-sales, `monument_built` in credit,
  `honor_peak/low` in bumpHonor) all write the caller's OWN account, already `FOR UPDATE`-locked by
  withCharacter/withTwoCharacters — no new lock edge and no clobber. The duel_wins/racer_wins/boxing_wins
  precedent.
- **Lock order.**
  - *Kitchen:* module upgrade + cut run single-party under `withCharacter` (the actor's char + account
    lock serialize everything); the module column write is direct SQL under that lock, the $OMR burn is
    the audited `spendOmr`. The accrual racket-level read is read-only (`owned.racketLevels`).
  - *Rackets:* `upgradeRacket` is single-party under `withCharacter`; the `character_rackets.level` write
    is a leaf-table UPDATE under the char lock. `tycoon_earned` bumps the own (locked) account at the
    racket:income ledger site.
  - *Megaproject:* `credit` bumps the own (locked) account, then the contributor's gang via a plain
    UPDATE row-lock WHILE holding the `megaprojects` singleton FOR UPDATE. **No cycle exists** — nothing
    in the codebase locks a gang row THEN the megaprojects singleton (only megaproject.js touches
    megaprojects, and it acquires the singleton FIRST every time; gang dissolution locks gangs but never
    megaprojects), so a megaproject txn waiting on a gang row can only block behind a holder that never
    needs the singleton. Same-gang concurrent contributions are serialized by the singleton anyway. The
    ARCHITECT CROWN is READ-DERIVED (`architectTally`) — **no cross-account write under the singleton**,
    deliberately avoiding the enter-vs-settle AB-BA class the auction/tournament audits closed.
  - *Honor:* `bumpHonor` writes the caller's own char + account, both held by the caller's lock (single-
    or two-party). The reputation boards are reads.
- **Death/estate.** The account-level legends (product_moved, tycoon_earned, monument_built, honor_peak/
  low) SURVIVE DEATH by construction (account_persistent, outside the estate wipe); per-racket `level`
  and `lab_*` modules die with the street (character-scoped columns default 0 on the fresh heir);
  `gangs.monument_built` dies with a dissolved family (no orphan — it's a status column, not a treasury
  bucket, so `gang:dissolved` doesn't need to ledger it). Honor itself dies with the street + echoes 25%
  to the heir (unchanged); the LEGEND is the bloodline's permanent record.
- **Faucets bounded.** `kitchen:module`/`kitchen:cut`/`racket:upgrade` are all cash SINKS (deflationary).
  The mechanics they buy widen existing faucets modestly + boundedly (flagged below).

## Flagged for founder sign-off (NOT patched — ground rule #1)

- **Racket upgrades widen the `racket:income` faucet** (+12%/level, cap 5 → +60% on that racket). Bounded
  by the per-character daily income token bucket (`racket_credit_ms`) + the level cap + the upgrade cash
  SINK; the business/territory-upgrade precedent. Sim the net per-racket EV before production.
- **Kitchen lab modules** — the Yield Manifold raises the batch cap (more product per cook → more deal
  faucet headroom, still bounded by nerve/stash/demand), the Purity Rig lifts quality (higher deal
  price), Ghost Vents cut offline raid odds (less product LOST to the Bureau → a mild effective-income
  raise). All bounded by the module cap (5) + the cash/$OMR SINK to buy them. Sim the kitchen curve with
  a maxed lab.
- **Cutting agents** stretch a stash line (+40% units at −15% quality, floored). The deal price scales on
  quality, so a cut is roughly volume-vs-quality-neutral at the margin; the cost is a cash SINK. Net a
  mild faucet-shape change, not a magnitude one. Flagged.
- **Status-axis Sybil posture (accepted).** The kingpin/tycoon/builder/honor legends + the reputation
  boards are earned by real play but a Sybil farm inflates any status board — the hitman-rep/referral
  accepted posture; no payout attaches.

## Deferred (design, flagged)

- Kitchen: a distribution/corner network (territory-based demand) — deferred (touches turf).
- Rackets: a per-racket PvP risk/shakedown — deferred (the personal rackets feed the GLOBAL lazy accrual,
  not a per-instance income clock, so a clean shakedown would need a rearchitecture; PvP risk is via
  death/loot today).
- Megaproject: monument WINGS/phases (post-completion sub-goals) + district perks on completion (the
  perk touches signed turf — founder-gated).
- Five Pillars: honor decay-toward-neutral, deeper diplomacy (vassalage/tribute pacts), campaign chains —
  the honor pillar was the thinnest and got the Tier-4 treatment; Bloodline was already Tier-4-deep.
