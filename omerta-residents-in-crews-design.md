# Residents in crews — the hired hand (NPC families step two, the crew-heist leg)

**Status:** SCOPED, not built (2026-08-03). Motivated by measurement: the progression harness
(`npm run playthrough`) reports *"Pull a crew score"* as the single largest masking rung in a solo
run — **22% of advised play, never cleared** — because a crew heist needs another player to fill a
role and a solo player has nobody. It is the top early-game friction and the only coach rung a solo
street cannot complete. See BALANCE.md § RE-SIM + EARLY-GAME HARNESS PASS (2026-08-03).

This closes the deferral flagged in `omerta-npc-families-design.md` and in BALANCE.md § NPC FAMILIES:
*"residents filling crew-heist roles (the co-op faucet measures 1.46× solo per member, so making it
solo-reachable on demand is an emission change)."* The emission change is the whole risk, and this
doc's central decision is how to make co-op solo-reachable **without** widening the faucet.

## The mechanism — the leader hires a hand

A leader who cannot find a real crewman **hires an NPC resident** to fill an open seat:
`POST /v1/heists/:id/fill {role}` (leader-only, during `planning`). Player-initiated and
deterministic — this is "solo-reachable **on demand**", not a worker that races the plan's TTL.

A hired hand is a **real NPC resident character** (`is_npc`), drawn from the population layer, NOT a
synthetic in-memory row. That is load-bearing: `executeHeist` locks each member's `characters` row
`FOR UPDATE` and reads its role-stat, so a filler with no character row would break the lock,
the gate sweep and the roll. Reusing a resident keeps every one of those paths unchanged.

Add ONE column: `crew_heist_members.hired BOOLEAN DEFAULT false`. Everything downstream keys on it.

### Picking the resident
- A FREE resident: `is_npc AND alive AND jail_until IS NULL AND hospital_until IS NULL AND NOT
  safeHoused` and **not already on a job** (`activeMembership`) — the same readiness gate a real
  crewman must pass at execute, applied at hire time so a hired hand can never be the reason a go
  fails. Prefer one standing in the leader's district (flavour; not required).
- The hire marks the resident **committed** so `residentAct`/turnover skip them for the plan's life
  (see Anti-abuse). Released on disband / stale-sweep / execute (the membership DELETE already does
  this — the `hired` row is an ordinary member row).

## Emission: the hand forfeits its cut — the faucet only ever SHRINKS

The pot for a standard job is `rand(job.takePerLvl) × avgCrewLevel`, split
`pot / (LEADER_WEIGHT + crew−1)` by weight across all heads. Today every head is paid a
`heist:crew` faucet row.

**A hired hand's share is computed into the split but NEVER PAID** — no `heist:crew` ledger row, no
cash to the resident. So:

- **§10.4-neutral by construction.** The forfeited slice is simply not minted (no new reason, no new
  bucket — the `whack:loot`-style "an ownership/status move writes nothing" discipline, here applied
  to a share that just doesn't happen). The sim's `reason vocabulary` and conservation are untouched.
- **A solo-NPC crew nets LESS than a full human crew, not more.** The denominator still counts the
  hand, so the real leader's share is `pot × leaderWeight / totalWeight` and the hand's slice is
  forfeit. Co-op stays a genuine reason to find real people — hiring bodies is the convenient,
  strictly-worse-EV path, which is exactly the incentive the deferral was protecting.

A hired hand also earns **none** of the per-crewman status kickbacks: no RWA `SCORE_CUT`, no
`heists_pulled` legend, no `scores` mastery XP, no respect. It is a warm body, not a made man.

### The success roll stays honest
`executeHeist` reads each member's role-stat (×3) into `avgRoleStat`, which sets `p`. A hired hand is
**stat-matched to the crew's average role-stat** so its presence moves `p` by ~0 — it neither carries
a weak leader nor tanks a strong one. (Implementation: the hire snapshots the crew's current
role-average onto the hand, or the roll simply excludes hired members from `avgRoleStat`. Either keeps
"hiring a body is not a free success bonus" true; prefer excluding them from the average so a
resident's real stats never leak into the roll.)

## The balance lever: `HEIST_FILL_MAX` — keep the marquee jobs multiplayer

Making the ENTIRE crew hireable would let a soloist trivially pull the marquee 4–5-man jobs (the
Federal Reserve tier) that exist as genuinely multiplayer content. So cap fillers per heist at
`HEIST_FILL_MAX` (proposed **1**, a founder sign-off lever):

- 2-man jobs (payroll) → solo-reachable (the entry co-op, which is what the coach rung points a new
  player at). This is the whole point of the drop.
- 3-man (vault) → 1 hand + 1 real crewmate.
- 4–5-man (fedtrain, Federal Reserve) → still need 3–4 real bodies. The top co-op content stays a
  reason to have a crew.

`HEIST_FILL_MAX` is the dial between "solo-reachable co-op" and "the marquee stays multiplayer";
`0` disables the whole feature.

## The hire fee — a small SINK so a body is a real decision

`POST /v1/heists/:id/fill` charges the leader a flat `HEIST_FILL_FEE` cash **SINK** (`heist:hire`,
character_id'd → the per-character cash check reconciles; rides no new vocabulary beyond adding
`heist:hire`). Represents tools + the hand's guaranteed cut up front. Combined with the forfeited
pot share, hiring a hand is unambiguously worse EV than a real crewmate.

*(Flagged alternative, NOT step one: pay the fee TO the resident as a transfer — thematically "hire a
day-labourer", recycle-only in reverse. Rejected for step one only to avoid a new counterparty
accounting leg; the SINK is simpler and the emission story is identical.)*

## Anti-abuse

- **A hired hand never rats.** The rat is the crew-heist grief surface (`ratHeist`); an NPC filler is
  never given the flag, so hiring bodies can't blow your own job and a leader can't launder a rat
  through an NPC.
- **A committed resident must be skipped by `residentAct` and the turnover sweep** for the plan's
  life (a hand pulled out from under a booked job would break the go, and — worse — a committed hand
  is otherwise eligible for the drained-retire). **This is the one population-side change** and it is
  required, not optional: verified this session that `population.js`'s `eligible` picker gates only on
  jail/hosp/safe, NOT on crew membership. Add `AND NOT EXISTS (SELECT 1 FROM crew_heist_members m
  WHERE m.character_id = characters.id)` to the eligible query (and mirror it in `retireResident`'s
  candidate pick), so a hired hand is inert until the job resolves.
- **The readiness gate at execute is unchanged** — a hand jailed/hospitalized between hire and go
  fails `crew_not_ready` exactly like a real crewman, so nothing special-cases the hand there.
- **The RWA/legend/xp exclusions** must ALL check `hired` — a resident banking `heists_pulled` would
  put scenery on the crew leaderboard (the boxing/stable/races `npc_flag` precedent).

## Death / estate

No new handling. A hired resident that dies before the go → `crew_not_ready` (existing). A resident
killed while committed runs the ordinary `runEstate`, which already wipes `crew_heist_members`. The
`hired` flag is a plain column on a row that is already estate-wiped.

## Tests (the guards this must satisfy)

- **§10.4:** a solo-leader-plus-hired-hand SCORE pays the leader a `heist:crew` row and writes **zero**
  ledger rows for the hand → the per-character cash check + conservation stay drift-0 (the hire fee is
  a ledgered `heist:hire` sink). Mutation: pay the hand's share → the emission claim fails by name.
- **The emission claim, asserted directly:** a solo-NPC crew's TOTAL paid cash < a full human crew's
  on the same job (the forfeited slice). Mutation: mint the hand's share → fails.
- **`HEIST_FILL_MAX`:** a 5-man job refuses a 4th hire (`fill_capped`); a 2-man job fills to go.
  Mutation: drop the cap → the marquee-stays-multiplayer assertion fails.
- **Gate matrix (`test/gates.js`):** `fill` is leader-only + `planning`-only; the hired resident
  passes the same readiness gate a real crewman does.
- **Fillers never rat; the roll is filler-neutral** (a hired hand does not change `p`); a committed
  resident is not double-hired and is skipped by `residentAct`.
- **Status exclusions:** the hand earns no RWA cut, no `heists_pulled`, no `scores` XP, no respect
  (mutation on each → fails).

## Console / describe

The open-crew card gains a **"hire a hand — $`HEIST_FILL_FEE`"** button per open seat (only when
`fillers < HEIST_FILL_MAX`), with the "a hired hand takes a cut but earns you nothing extra" note so
the worse-EV tradeoff is legible at the point of decision (the pad/nut terms-ride-with-the-price
discipline — and `test/client.js` check 6 will demand the fee field is read). `describe()` humanizes
the hire.

## Levers (all founder sign-off)

| lever | proposed | what it does |
|---|---|---|
| `HEIST_FILL_MAX` | 1 | fillers per heist. `0` disables the feature; higher makes the marquee jobs solo-reachable |
| `HEIST_FILL_FEE` | (sign-off) | the cash sink to hire a hand — a small real cost on top of the forfeited pot share |

## What this deliberately does NOT do

- **Residents do not JOIN open boards on their own.** Hiring is leader-initiated and on-demand; a
  worker filling seats would race the plan TTL and is unnecessary.
- **Fillers are not real made men.** No legend, no leaderboard, no status — a hired hand is a body.
- **The marquee co-op is not trivialized.** `HEIST_FILL_MAX` keeps the 4–5-man jobs needing real
  bodies; this drop is about the ENTRY co-op the coach points a new player at.

## Open question for the founder before build

`HEIST_FILL_MAX` = 1 makes only the 2-man payroll job fully solo-reachable, which clears the coach
rung and is the conservative choice. If the intent is "any co-op job should be soloable with enough
money", raise it — but that re-opens exactly the marquee-trivialization concern, and the co-op faucet
(1.46× solo per member) then flows to a soloist paying only fees. The forfeited-cut design keeps that
bounded (the soloist's own share shrinks with every hand), but the cap is the real dial.
