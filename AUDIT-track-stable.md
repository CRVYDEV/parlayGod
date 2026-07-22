# AUDIT — The Track + The Stable (the racing drops)

A focused three-lens red-team over the two racing features shipped this session, run as three
independent parallel adversarial agents, each tracing every finding against source before reporting:

- **Lens A** — §10.4 ledger-conservation / faucet-emission.
- **Lens B** — concurrency / lock-order (AB-BA) / lost-update / persist-clobber.
- **Lens C** — death / estate / PvP correctness + exploit / grief / server-authority.

Scope:
1. **The Track** (`src/casino.js`) — the dogs & ponies daily betting card (`trackFieldOf`/`trackWinnerOf`/
   `trackCardOf`/`betTrack`/`claimTrack`, the `openLiability` track reserve, the den-book plumbing).
2. **The Stable step one** (`src/stable.js`) — buy/train/list/circuit(PvE)/match(PvP)/board/leaderboard.
3. **The Stable step two** — breeding, the Cornerman trainer tie-in, and THE STAKES (the Grand-Prix escrow
   twin: `enterStakes`/`resolveStakes`/`sweepStakes` + the `stakes escrow` §10.4 check).

## Verdict: ALL THREE LENSES CLEAN — no CRITICAL / HIGH / MED / LOW

Every concern traced to a conserving, deadlock-free, death-safe implementation. Both features faithfully
copy the audited `enterGrandPrix`/`resolveGrandPrix` posture; the one template divergence (`enterStakes`
locking the racer row) is benign (a racer is only lockable by its owning, already-serialized character, and
`resolveStakes` never locks racers → no new lock edge).

Independently verified sound:

- **The Track's house edge is positive on every runner.** Posted odds `= round((1/p)(1−EDGE)·100)/100`; at
  `FIELD=6` the top runner's `p ≤ 0.667`, so the half-cent rounding gain (`≤ p·0.005 ≈ 0.003`) can't flip
  the 0.15 edge, the 1.1 floor is unreachable, and the 25 cap only ever *increases* the edge. The seed-drawn
  winner uses the TRUE `p` (the odds carry the vig, the draw doesn't) → fair + verifiable; `p` never leaks
  (`trackCardOf`/`denInfo.myBets` strip it; `MARKET_SEED` is server-only). Payout `floor(stake·odds)` never
  exceeds the `stake·MAX_ODDS` `openLiability` reserve. One-bet-per-race-per-day PK-airtight; claim settles
  `day < today` only, recomputing the winner from the ENTRY day.
- **The Stakes escrow conserves on every terminal path** — full field (`handedOut + take + deadBurn = pool`,
  `handedOut ≤ net` so `take ≥ rake ≥ 0`, no tie-split leak), short-field/all-dead refund, and a mixed
  dead+live field (the dead buyin burned once, excluded from `livePool`, never double-counted). The
  `stakes escrow` invariant (`pool == posted − win − refund − take − death`) is the byte-faithful
  grand-prix twin.
- **Lock order acyclic across every concurrent pair** — bet-vs-claim (den_volume before street_tax, the
  audited PvE-trio order); matchRace/breed/train overlap only via the exclusively-held owning character;
  enterStakes (char → racer → stakes_state → race) vs resolveStakes (chars sorted → stakes_state → race),
  state-before-row so no AB-BA; two-worker settle idempotent behind the `status='open' FOR UPDATE` re-select;
  `clearCurrent` guarded `AND current=$raceId` under the held state lock.
- **Death is safe.** `stakes_entries` is correctly EXCLUDED from the runEstate wipe (like
  `grand_prix_entries`) so a dead entrant's escrow BURNS (`stable:stakes:death`) rather than leaking; `racers`
  ARE wiped but `resolveStakes` reads the self-contained `form` snapshot, so a dead — or a bred-away —
  entrant still settles. The owner LEGEND (`racer_wins`) is direct-SQL (persist-clobber-safe) and survives
  death. matchRace can't touch a dead/hospitalized/unlisted/wrong-kind/family target.
- **No INT-arith or persist-clobber bug** — every racer stat/record UPDATE is JS-absolute; the two arithmetic
  UPDATEs (`racer_wins`, `stakes_races.pool`) are byte-identical to the proven races.js template on the same
  INT columns, both backstopped by escrow/legend checks.

## Hardening applied (not defects — the agents' recommendations)

- **Two regression tests added** (`test/stable.js`): a **dead-entrant-in-a-full-field settle** (four enter,
  one is mod-killed, the field still resolves, the dead stake burns `stable:stakes:death` — never refunds a
  corpse — and the escrow closes with the death term), and a **bred-away entered parent** (its racer is
  DELETEd by breeding mid-race, its stakes entry survives on the form snapshot and still places). These pin
  the load-bearing "stakes_entries is a self-contained snapshot" property against a future regression.
- **A defensive rules comment** on `CASINO.TRACK` noting `FIELD` must stay ≥ 4 — the per-runner edge is only
  guaranteed while the favorite's `p` can't approach the odds floor (informational; sound at the shipped
  FIELD=6).

## Flagged (accepted, no action)
- The circuit purse is the one genuine new faucet (correctly ledgered + bounded by the 6h cooldown × the
  4-racer cap) — already flagged for founder sim sign-off in BALANCE.md (the boxing-exhibition precedent).
- Orphaned den tickets (`track_bets`, like `numbers_tickets`/`fight_bets`) over-reserve `openLiability`
  forever at death — over-conservative (never mints; the stake already burned into den profit), a shared
  pre-existing den-liveness nuisance, not a conservation leak.
- Symmetric-cost, consent-gated grief (a whale farming a listed novice's wager; a deliberate −EV loss to an
  alt) is the accepted `casino:pvp` / consent-by-listing posture; injury-on-loss throttles repeat-farming.

Suite 33/33 + sim drift-0 (18 checks, incl. `stakes escrow`).
