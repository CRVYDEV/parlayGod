# AUDIT — the resident scheduled-field fills (2026-08-06)

A focused adversarial pass over **this session's four new escrow-entry surfaces** — the helpers that let
an NPC resident, driven by the worker, pay into a player-facing scheduled-field pool:

- `casino.js:residentEnterTournament` (poker tournament — escrow buy-in)
- `races.js:residentEnterGrandPrix` (Grand Prix — escrow buy-in)
- `stable.js:residentEnterStakes` (The Stakes — escrow buy-in)
- `casino.js:residentNominateFuturity` (The Futurity — a *sink*, not escrow)
- `population.js:residentAct` (the wiring)

This is the class the project keeps finding real bugs in (the deep-deferred casino audit found two HIGH
§10.4 escrow drifts; the population audits found stranded-escrow + reroll issues), and three of the four
shipped on the "it's the proven tournament pattern" argument without an independent pass. Four lenses:
§10.4/escrow accounting, concurrency/locks, cross-system, and exploit/honesty.

## Result: no CRITICAL, no HIGH, no §10.4 drift. One founder-awareness FLAG (F1), one test gap closed.

## F1 (FLAG — a mischaracterised balance surface, NOT a defect) — GP/Stakes are a resident-seed EXTRACTION

The shipped BALANCE note called all four fills "no faucet, a redistribution." That is **exactly right for the
tournament** (random 7-card hands → a player's win chance is `1/field`, so it is a fair redistribution and a
resident is −EV to farm). It **understates the GP and Stakes**, which are SKILL-DOMINATED
(`power/form + rand(±40 / ±22)`): a player who brings a dominant car/racer beats resident BEATERS ~always and
takes the pool. Measured — a field of 1 human + 5 residents at the $25k GP buy-in pays the winner ~$85.5k
(place-1, 60% of net after the 5% rake) → **~+$60.5k/race (GP), ~+$48k/race (Stakes)**.

So the GP/Stakes resident-fill is a **bounded, §10.4-clean extraction of the resident seed pool by an invested
player**, not a redistribution among equals. It is:
- **§10.4-exact** — a transfer, both legs ledgered (`race:gp:buyin`/`stable:stakes:buyin` from residents,
  `…:win` to the player); no drift, proven by the escrow-identity tests.
- **Hard-bounded** — by the resident seed pool (drained residents don't fill) AND the ~24h event cadence (one
  GP/Stakes window a day, one entry each), so ~$108k/day for a whale farming both. Small against the ~$21.6M/day
  passive stack.
- **Consistent with the design** — residents are a *designed* value source (the marks, THE TAKE, robbing a
  resident front all extract from them), and this rewards car/racer investment.

Flagged for AWARENESS, **not retuned** (ground rule #1). Dials if the founder wants it curbed: a resident
car/racer QUALITY floor (field a real contender, not a beater), a lower `GP_FIELD`/`STAKES_FIELD`, or a
per-window entry cap. Recorded in BALANCE.md § RESIDENTS FILL … . The random tournament and the Futurity
(nominator isn't paid) are **not** farmable and need no flag.

## Verified CLEAN

**§10.4 / escrow.** Each buy-in helper debits the resident's own cash, INSERTs the entry, bumps the pool, and
ledgers the buy-in inside one txn — so `open pool == Σ buyin` at every step (tested; the GP mutation
"drop the pool bump" fails the escrow assertion by name). The Futurity nomination is a **sink** to
`street_tax` (`casino:futurity:nom`, a character_id'd cash sink the per-character check reconciles), and
`street_tax` is not a §10.4 bucket, so a nomination cannot perturb the `futurity escrow` (which is the BETS) —
confirmed by the fill-then-drift-0 test.

**Retirement / death — the sharp case, now VERIFIED not assumed.** A resident that retires or is killed
mid-event has its buy-in auto-burned at resolve via the resolver's `LEFT JOIN characters` dead path
(`…:death`, reducing the pool), while `retireResident` / the estate burns only the resident's REMAINING cash
(the buy-in already left into the pool) — so total is conserved and `retireResident` needs no change. Proven
for the tournament AND now for the Grand Prix (a new test retires one of three mid-GP and asserts the
`grand prix escrow` identity holds through the dead-burn + short-field refund). The Stakes resolver is the
byte-faithful twin.

**Futurity empty-bet resolution** (an edge the fill newly makes reachable — a card of all-resident runners
with zero human bets). `resolveFuturity` handles it: `live.length >= MIN_RUNNERS` runs the race,
`totalWin === 0` makes the one-sided-book branch iterate an empty `loseBets`, `purse`/`houseCut` stay 0, and
the card resolves with no crash and no drift. A resident winner bumps a leaderboard-excluded legend only.

**Concurrency / lock order.** Each fill runs inside `runResidentBehaviour`'s per-resident txn, which holds the
resident char `FOR UPDATE`, then the helper locks the state singleton → the event row — so the order is
**char → state → event**. Every resolver locks **entrant-chars-sorted → state → event** (state before the
row, the audited posture). Both lock chars before the state singleton, and a fill's resident is a NEW entrant
the resolver hasn't read/locked, so there is no AB-BA. A fill racing a resolve blocks on the state singleton,
then re-reads `status='open'` → now `resolved` → returns null (graceful no-op); the `resolves_at <= now()`
guard means a fill never lands on an about-to-run event. Resolvers are idempotent (status-gated
`FOR UPDATE`), so two worker replicas can't double-settle. **Honest scope: reasoned + pgcheck's general lock
discipline, NOT exercised under real concurrency** (pg-mem is single-caller and the loadtest harness doesn't
drive the worker fills) — the reasoning is the anti-cycle argument, mirroring the resolveTournament posture
the audits already accepted.

**Cross-system.** THE TAKE (crime robbing a district resident) uses `FOR UPDATE SKIP LOCKED`, so it skips a
resident the worker holds mid-fill, and otherwise only debits the resident's remaining cash (the buy-in is in
the pool) — no double-count. A drained-below-buy-in resident that the turnover retires is the retirement case
above. A resident's car being stolen after GP entry is harmless (the power is snapshotted at entry; the car
isn't escrowed, exactly like the human path).

**Reactive gate / honesty.** Every helper returns null when `!st?.current`, and there is no materialize path
in any of them, so a resident can never OPEN an event — the city never manufactures a scheduled event among
itself and `/v1/online` stays an honest human count. No `bumpStanding` / `track` / streets-emit (residents
emit nothing to the wire). Tested (a resident with no open event opens nothing).

**Gates.** GP checks level ≥ `GP.MIN_LEVEL` + a raceable (not listed/pledged) car it owns; Stakes/Futurity
check an un-injured racer it owns; the Futurity + tournament check the Neon Mile district; all check the
buy-in/fee against the resident's own cash, and the not-already-entered predicate. A resident fills at most
one event per turn.

## What was changed

- `BALANCE.md` — the F1 correction (the GP/Stakes extraction flag).
- `test/population.js` — a GP retirement-safety block (verify the escrow-twin dead-burn, don't assume it).
