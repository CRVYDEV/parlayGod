# AUDIT — THE HIRED HAND (residents-in-crews, 2026-08-03)

A focused adversarial pass over the hired-hand drop (`omerta-residents-in-crews-design.md`), the crew-heist
leg of NPC families step two. Four lenses: §10.4/emission, concurrency + lock order, the population-side
inert guard, and exploit/grief. Every reported concern re-verified against source before any change.

**No CRITICAL, no HIGH, no §10.4 drift.** One LOW flagged (a pre-existing benign class), one regression added.

## §10.4 / emission — CLEAN (the central claim, verified two ways)

The design's whole premise is that a hired hand's pot share is FORFEITED, never minted, so the co-op
faucet only ever shrinks. Verified:

- `executeHeist` skips every hired member (`hiredIds.has(m.id) continue`) BEFORE any cash write, ledger
  row, `heists_pulled` bump, mastery XP, RWA grant or respect. So a hand receives **zero** `heist:crew`
  rows — asserted directly in `test/heists.js` ("THE EMISSION CLAIM: the hand takes no cut"), plus the
  hand's pocket and legend are pinned unchanged after a scored solo-NPC job.
- The denominator (`unit = pot / (LEADER_WEIGHT + crewRows.length − 1)`) still counts the hand, so the
  real crew's slices shrank around it — the leader's take equals what a real crew would give, minus the
  forfeited slice which is simply never emitted. The pot's caliber (`avgLvl`/`avgRoleStat`) excludes hired
  hands, so a resident's real stats never leak into the roll (hiring a body is not a free success bonus).
- One new reason, `heist:hire` (the fill fee), a cash SINK riding the existing `heist` prefix — zero
  `invariants.js` change; the `reason vocabulary` check stays green and the full sim holds drift-0.

## Concurrency + lock order — CLEAN

- **fillHeist and executeHeist on the same heist never overlap.** Both are leader-only and run inside the
  leader's `withCharacter` (the leader's char row is held), so the same leader's calls serialize. Different
  heists share no row.
- **fillHeist takes no char lock on the resident** — only the heist row `FOR UPDATE` (plus the held leader).
  `executeHeist` later locks each member's char row (the hired resident included) `FOR UPDATE` in sorted id
  order — the same path any member takes, so the hired hand adds NO new lock edge and no AB-BA.
- The pot forfeit is computed under the same locks the paid shares are; no partial-payment window.

## The population-side inert guard — CLEAN, regression added

A resident committed to a live plan must be inert — never retired or acted out from under the job. The
`eligible` picker (residentAct) and both retire-candidate queries (`oldAll`/`drainedAll`) gained
`id NOT IN (SELECT m.character_id FROM crew_heist_members m JOIN crew_heists ch2 ON ch2.id=m.heist_id
WHERE ch2.status='planning')` — a **non-correlated** subquery (the correlated `NOT EXISTS` is exactly what
pg-mem can't parse — the /v1/gangs precedent; a first cut used it and 500'd). Verified on real Postgres
(`pgquery`) and pinned in `test/heists.js` with a direct SQL assertion that a hired hand is excluded from
the free/retire pool. The filter keys on `status='planning'`, so a resident whose heist has since resolved
(`done`/`abandoned`) is free again — a completed job's stale membership row never permanently freezes a body.

## Exploit / grief — CLEAN

- **Fillers never rat** (the flag is never set on a hired row), so hiring bodies can't blow your own job.
- **A hand earns no legend/leaderboard/status**, so scenery can never reach the crew board (the
  boxing/stable/races `npc_flag` precedent, here by the forfeit skip).
- **HEIST_FILL_MAX (1)** keeps the marquee 3–5-man jobs needing real bodies — proven by the `fill_capped`
  gate on the vault; mutation-verified.
- **The fee is a real cost** on top of the forfeited slice, so a hand is the fallback, never the optimum —
  a real crewmate is always at least as good for the leader and better for the crew.

## LOW — FIXED 2026-08-04 (was: flagged, a pre-existing benign class)

**A resident could be hired into two concurrent plans.** `fillHeist`'s free-resident SELECT reads the
NOT-IN pool and INSERTs without locking the chosen resident, so two leaders filling in the same instant can
both pick the same lowest-id free resident (the PK is `heist_id+character_id`, so two different heists are
allowed). Consequence is **benign and §10.4-neutral**: the hand is never paid on either job, both resolve
independently, and it stays protected from retirement throughout. The only wrinkle is that a job busting
jails the shared resident, so the other job's `execute` fails `crew_not_ready` until the jail clears — an
annoyance, not a leak. This is the **same TOCTOU class real players already have** (two concurrent
`joinHeist` calls both pass the `activeMembership` check), so it is not new surface. The clean fix is a
`FOR UPDATE SKIP LOCKED` on the resident pick (so concurrent fills take different bodies), which wants the
`dbCaps` pattern. **FIXED 2026-08-04**: `fillHeist`'s resident pick now appends `FOR UPDATE SKIP LOCKED`
(gated on `dbCaps.skipLocked`, the THE TAKE pattern) — the chosen resident is locked until the fill txn
commits, so a concurrent fill skips it and takes a different body. pg-mem's fallback picks correctly and
just doesn't prevent the race (which a single-caller engine cannot exercise); the SKIP LOCKED form was
verified to parse + execute on real Postgres. Locking the resident LAST cannot cycle: a candidate is by
definition not in any planning heist, so `executeHeist` never holds it. `HEIST_FILL_MAX`/`HEIST_FILL_FEE`
remain founder sign-off levers (BALANCE.md § THE HIRED HAND).

## Measurement loop closed

`tools/playthrough.js` now hires a hand to complete the crew-score rung (plan → fill → execute). The rung
the harness had named as the top masking friction (*"pull a crew score"*, uncompletable solo) now CLEARS in
a solo run — it moved from `not tested` into the obeyed list; level bands hold (2h/12, 5h/21, 10h/34, inside
the recorded noise).
