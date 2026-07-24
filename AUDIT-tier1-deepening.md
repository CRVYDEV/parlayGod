# AUDIT — the Tier-1 → Tier-4 deepening program (6 systems)

**Date:** 2026-07-24 · **Scope:** the six Tier-1-thin systems expanded to Tier-4 this program —
the Dueling Ladder, Crew Heists, Clue Scrolls, Territory Rackets, Sovereignty, and Soldiers (of the
Marriages/Soldiers/Secrets trio) — plus every file each touched. Design: `omerta-tier1-deepening-design.md`.

**Method:** a focused self-review across four lenses (§10.4/faucets, concurrency/lock-order,
persist-clobber, cross-system) over each drop, backed by: each system's suite green after its drop, the
full 43-suite `npm test` green after every commit, `node tools/sim.js` drift-0 after every commit (the
strongest §10.4 proof — the sim earns the whole economy and asserts the full sweep), and a targeted
persist-clobber grep confirming every new direct-SQL column is absent from the persist positional UPDATEs.

**Result: no CRITICAL, no HIGH. §10.4 drift-0 throughout. Every new faucet bounded + flagged for sim.**

---

## Verified CLEAN

- **§10.4 vocabulary + conservation.** Every new cash reason rides an existing prefix (no invariants
  vocab change needed): `heist:fence` → `'heist'`, the tiered `clue:casket` → `'clue'` (same reason,
  tiered band), `sov:income` → `'sov:'`. The one invariants change is correct: `sov:income` is a
  treasury FAUCET, so it's EXCLUDED from the `sov:%` sink sum and carried as its own `sovIncomeIn` term
  in the gang-treasuries check — proven §10.4-neutral by a before/after drift-delta assertion in
  `test/expansion.js` (the check's drift from the test's SQL-seeded treasuries does not move across a
  collect). Duels/soldiers/territory-syndicate move ZERO currency (status axes).
- **Persist-clobber.** Every new account/character state written by direct SQL — `characters.duel_style`,
  `characters.heist_loot`, `account_persistent.duel_titles`, `.heists_pulled`, `.soldiers_led`,
  `sov_structures.income_at`, `clue_scrolls.tier` — is ABSENT from `persistCharacter`'s 60-param
  positional UPDATE and `persistAccount`'s column list (grep-verified), so a same-turn persisting action
  can't roll them back. The duel_wins/racer_wins/boxing_wins precedent.
- **Lock order.**
  - *Duels:* the belt + grudge reads are UNLOCKED point-in-time reads (the Commission-seats/outfitStrength
    precedent); the season-title crown runs UNDER the champion's own `char FOR UPDATE` in the rollover
    loop (chars→accounts, the SEASON_PRIZE order). No new lock edge.
  - *Heists:* the fence + casing are single-party under `withCharacter` (the actor's char lock serializes);
    hot-loot is written by direct SQL under that lock for every crewman incl. the leader — no second lock.
    The execute lock order (members→heist→business) is unchanged.
  - *Sov:* `collectSov` locks gang → structures (matching `upgradeSov`/`siegeSov`; `buildSov` locks
    gang → district — no sov path ever locks structures-then-gang, so acyclic). Any member may collect
    (the collectTerritory posture), D2 safehouse-gated.
  - *Territory/Clues/Soldiers:* the syndicate is a read; the clue casket/relic run under the digger's char
    lock (relic via SAVEPOINT-guarded `logCollect`, non-fatal); `soldiers_led` bumps under the actor's
    char lock in `soldierResult`.
- **Death/estate.** heist_loot + clue_scrolls + soldiers + sov_structures + duel_style all die with the
  street (character-scoped columns default 0 on the fresh heir, or table rows in the existing estate
  wipe/dissolution). The account-level legends (duel_titles, heists_pulled, soldiers_led, caskets/relics)
  SURVIVE DEATH by construction. The fire-kill hot-loot loot (P1.1 twin) reads victim.heist_loot before
  the wipe (the contraband-loot precedent).
- **Faucets bounded.** heist:fence ≤ the heist pot (the cash faucet is REPLACED, mean fence mult <1.0 —
  never a net increase); the tiered clue casket ≤ 3/day × the master band (still petty vs the signed
  loops); sov:income capped at 24h/collect + overextension-taxed + crumbling-gated; territory hot-type
  income mults ride the existing ledgered faucet. All flagged for the sim in BALANCE.md.

## Flagged for founder sign-off (NOT patched — ground rule #1)

- **Heist fence safehouse gate.** `fenceLoot` is NOT safehouse-gated (parity with the Port
  `fenceContraband` precedent) — a player can take a score HOT, safehouse, and fence from safety, dodging
  the hot-loot fire-kill loot. Self-limiting (the loot was at risk during any non-safehoused moment; the
  fence mult means <1.0) and consistent with Port; a one-line `safeHoused` gate gives D2-parity if wanted.
- **New faucet magnitudes (sim before production).** The master clue-casket band ($55k–120k, ≤$?/day at
  the 3/day cap), the sov:income curve (6 tiers, base-wide bounded by ≤6 districts × overext-taxed
  incomePerDay), and the territory hot-type income mults (loansharking ×1.20 → counterfeiting ×1.45).
- **Status-axis Sybil posture (accepted).** The commander/spymaster-style legends (soldiers_led,
  heists_pulled, duel_titles) are earned by real play but a Sybil farm inflates any status board — the
  hitman-rep/referral accepted posture; no payout attaches.
- **Territory syndicate is pure status** (no income bonus this drop) — the scrutiny-mastery income/defense
  bonus is a documented deferred follow-on; adding it would touch the per-racket resolution path.

## Deferred (design, flagged)

- Duels §C: the bracket duel-tournament + spectator betting (the poker-bracket escrow twin) — the
  escrow machinery exists; a bigger drop.
- Sov §B/§D: the multi-stage windowed siege (declare→rounds→reinforce) + coalition co-defence.
- Marriages (dowries/betrothal arc) + Secrets (types/network/market) — already feature-complete for
  their role; soldiers was the thin sub-system deepened.
