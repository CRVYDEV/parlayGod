# OMERTÀ — Crew Heists: THE BIG SCORE (design)

**Status: building step one.** The game's first COOPERATIVE content — everything today is solo or
adversarial, which is absurd for a genre about crews. 2–4 players plan a job, fill the crew,
and execute together: shared take, shared jail, and the option to rat.

## 1. The loop

1. **PLAN** — a leader picks a job from the `HEIST_JOBS` catalog (rules tail — new/tunable) and
   fronts the STAKE (tools & bribes — a §10.4 cash sink `heist:crew:stake`, sunk on execution,
   refunded in full only on a pre-execution disband). One active heist per character, and the
   Score shares the solo heist's `heist_at` cooldown — one big job per window, alone or together.
2. **CREW UP** — others join off the open board (`GET /v1/heists`), gated by the job's level
   floor. Members can leave while planning; the leader disbanding refunds the stake. A plan
   older than `HEIST_PLAN_TTL_MS` (6h) goes stale (join blocked, worker sweeps it, stake
   refunded to a living leader).
3. **EXECUTE** — leader-only, crew must be full and every member alive, un-jailed,
   un-hospitalized. ONE server roll: `P = job.base + (crew avg total stats − 30)/1000`, clamped
   [0.15, 0.92], rng-audited.
   - **Success**: pot = `rand(job.takePerLvl) × avg crew level`, split evenly (the leader's
     share carries a 1.2× weight — they fronted the stake), each share a ledgered faucet
     `heist:crew`; respect per member; the streets feed hears about it.
   - **Failure**: the whole crew eats the job's jail time together + a bruise. The stake is gone.
4. **THE RAT** — any member can secretly `POST /v1/heists/:id/rat` during planning. A ratted
   job auto-fails at execution: the rat walks free with the informant's payout
   (`HEIST_RAT_BPS` = 50% of the stake, faucet `heist:crew:rat`), everyone else eats DOUBLE
   jail, and the streets feed says only **"somebody talked"** — the rat is never named
   (omertà cuts both ways). Ratting your own job is −EV by construction: the payout is half
   the stake you fronted, so a solo-with-alts self-rat burns money and jails the alts.

## 2. Economics (new faucet — founder sign-off levers, BALANCE.md addendum)

Solo heist = `1200×lvl` guaranteed / 8h (the anchor). Crew jobs pay a coordination premium with
real risk: per-member EV ≈ 1.3–2.1× solo, scaling with crew size and danger —

| Job | Crew | Lvl gate | P(success) | Stake | Pot (×avg lvl) | Jail on fail |
|---|---|---|---|---|---|---|
| The Payroll Office | 2 | 8 | .65 | $10k | rand 4,400–7,000 | 120s (×2 ratted) |
| The Bank Vault | 3 | 20 | .50 | $30k | rand 11,000–17,000 | 240s |
| The Reserve Train | 4 | 40 | .38 | $80k | rand 26,000–37,000 | 420s |

Everything is ledgered per character (`heist:crew*` rides the existing `heist` cash-vocabulary
prefix), so §10.4 check (a) reconciles automatically. Alt-dragging is self-defeating: the pot
scales with the AVERAGE crew level, so a low alt shrinks everyone's take.

## 3. Edge discipline
- One active heist per character (join/plan blocked otherwise) — two executes can never contend
  for the same character rows, so the lock order (leader → members sorted → heist row) is acyclic.
- Members are paid/jailed by direct row updates under lock (they are NOT in-memory in the
  leader's transaction — no persistCharacter clobber); the leader's effects are in-memory.
- A dead member voids readiness (`crew_not_ready`); the estate deletes the corpse's memberships
  and abandons heists they led (the stake is sunk — no corpse refunds).
- Step two (deferred): role-specific checks (wheelman needs a fast car, boxman cunning gates),
  timed execution windows, inside-job variants against player businesses, and a fence phase
  (hot goods that need laundering before they're cash).
