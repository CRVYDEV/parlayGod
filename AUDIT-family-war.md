# AUDIT — THE FAMILY WAR (formal declaration) — 2026-08-05

A focused adversarial pass over the new `npc_wars` surface (`src/npcwar.js`: `declareNpcWar`, the raid
scoring hook, `sweepNpcWars`, `warBoard`, `releaseFamilyHolds`) — a scored, worker-resolved system, the
class this codebase red-teams by convention. Five lenses; every concern re-verified against source.
**No CRITICAL, no HIGH, no §10.4 drift. One LOW fixed in-commit (regression + mutation-verified).**

## §10.4 / economy — CLEAN

- **The only value flow is the EXISTING `gang:war` treasury sink** at declaration (no spoils, no
  NPC-treasury seed, no new faucet, no new reason). The score and the win trophy move ZERO currency
  (status). The whole declaration is one transaction, so a failed INSERT rolls the sink back.
- The test proves the gang-treasuries check reconciles the `gang:war` sink for an NPC-family war (funded
  through ledgered tribute, not a direct treasury seed), and the sim holds drift-0 with the feature live.
- **THE SEVERANCE is by construction:** the score/win are status, NEVER `season_wars`, so the
  Commission-standing faucet the player-war system feeds stays severed (the test asserts `season_wars`
  stays 0 on a declaration) — the design's constraint #1.

## Concurrency / locks / persist-clobber — CLEAN

- **Lock order is acyclic.** `declareNpcWar` locks the attacker gang (`us`) FOR UPDATE then the
  `npc_wars` leaf. `raidFamily`'s scoring hook locks the target gang, then the `npc_wars` leaf, then
  bumps accounts by direct SQL. `sweepNpcWars` locks `npc_wars` then an account by direct SQL. No path
  locks a second gang after `npc_wars`, and the account bumps are unlocked direct-SQL increments — so
  there is no gang↔gang or gang↔npc_wars cycle across the three writers.
- **No double-win.** The scoring hook holds the war row `FOR UPDATE` from its SELECT, and the win is
  resolved with `SET resolved=true … AND NOT resolved`; a concurrent raid's `SELECT … AND NOT resolved
  FOR UPDATE` re-checks the predicate after the first commits and returns nothing, so exactly one raid
  crosses the line. The declare race is serialized on the attacker-gang lock, with the active-war set
  re-read AFTER the lock, so `MAX_PER_FAMILY` holds under a race.
- **Persist-clobber SAFE.** The trophy grant is `family_wars_won = family_wars_won + 1` by direct SQL,
  and `family_wars_won` is NOT in `persistAccount`'s positional column list (verified) — the same
  survives-death-legend discipline as the sibling `family_war` blood-war legend. A concurrent action by
  the declarer cannot clobber the trophy.
- The score increment is `score = score + $n` (addition — pg-mem-safe; the codebase's INT-arithmetic
  quirk is subtraction-with-a-bound-param only), with `RETURNING` for the crossing check.

## Death / dissolution / estate — CLEAN

- **The war belongs to the FAMILY, not the declarer.** `npc_wars` is gang-keyed; `declared_by` is a
  record, so the war correctly persists past the declarer's death (the heir/other members finish it) and
  is NOT estate-wiped. On a win the trophy resolves `SELECT account_id FROM characters WHERE
  id=declared_by` — the dead declarer's row still exists (alive=false), so it lands on the account
  (survives death). The migrate guard does not flag `npc_wars` (no `character_id`/`%_character` column).
- **Dissolution clears both directions.** `releaseFamilyHolds` (called from `removeMember`'s full-
  dissolution branch, for player AND NPC families) now `DELETE`s `npc_wars WHERE attacker_gang=$1 OR
  npc_gang=$1`, so a dissolving attacker drops its campaign and a dissolving NPC family drops any war
  fought against it — and the one-war cap never counts a war whose party is gone.

## Exploit / grief / Sybil — CLEAN (design flags below)

- **No player is ever the target** of a family war (the target is an NPC family), so there is no
  third-party grief vector, no forced-loss, no fixed-price standing purchase.
- Only a member of the ATTACKER family scores (the hook gates `myGang == attacker_gang`); a stranger
  raiding the same NPC family does not touch the war.
- The trophy is STATUS with NO payout, so it is Sybil-farmable but pointless (the hitman-rep posture),
  and winning costs a real campaign (a $25k chest + `WIN_SCORE` raids, each energy+ammo+DEFENCE risk).

## The one fix (LOW) — CONQUEST NOW WINS THE WAR

A war-raid drains the family's `war_pool`, so a sequence of scoring raids naturally routs the outfit —
and routing it CONQUERS it (it becomes your vassal), after which every future raid throws `own_vassal`.
So the war could never reach `WIN_SCORE` and the $25k war chest was **silently wasted** — a good outcome
(conquest) blocked the goal (the campaign). No §10.4/exploit/crash, but a real trap. **Fixed:** the
scoring/conquest interaction was refactored to a single unified win-resolution, and **conquering an
outfit you're at war with WINS the campaign** (total domination supersedes the score). Regression added
(declare → rout below `WIN_SCORE` → the war is won + the trophy banked), mutation-verified by name.

## Flagged (design notes, NOT defects)

- **A full family wins a campaign in one salvo** — the raid cooldown is per-character, so five made men
  each raid once and reach `WIN_SCORE` in a round, not the ~10h a soloist needs. By design (bigger
  families win wars faster); status-only, so no exploit. The `WIN_SCORE`/`COST` are the pacing dials.
- **The trophy goes to the DECLARER even if they later leave the family** (they started it). Minor
  oddity, acceptable — account-level, survives death.
- All `FAMILY_WAR.WAR.*` are PROPOSED DEFAULTS (BALANCE.md § THE FAMILY WAR) — sim + sign-off before
  production; §10.4-neutral, so nothing here widens a faucet.

## Verdict

The Family War is a faithful, §10.4-neutral status/pacing layer over the audited Blood War raid loop and
inherits its safety. One LOW (the conquest-blocks-war trap) fixed with a regression; nothing else required.
