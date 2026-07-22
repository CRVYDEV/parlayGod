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

---

# AUDIT — The Track step three (RUN IN THE CARD)

A follow-up three-lens red-team over the step-three drop (player-owned racers entered into the daily
betting card, with fixed-odds locking) — same three parallel adversarial agents, each tracing findings
against source.

Scope: `enterTrackRace` / `sweepTrackEntries` (the new player-entry path), the merged-field draw
(`trackFieldOf`/`trackWinnerOf` with `entries`), the fixed-odds lock on `betTrack`/`claimTrack`, the
`casino:track:entry` fee, and the `track_entries` schema + estate handling.

## Verdict: two defects confirmed and FIXED (1 MED, 1 LOW); everything else CLEAN

**Lens A (§10.4 / fixed-odds)** and **Lens C (death / estate / exploit)** returned CLEAN:
- the `casino:track:entry` nomination fee is a character_id'd `casino:` cash SINK → the buyback pool (the
  `pen:commissary` precedent); the per-character cash check reconciles it and the den-book identity is
  untouched (the fee never enters the PvE book);
- **fixed odds are bounded** — a ticket locks `track_bets.odds` at bet time and `claimTrack` pays the
  LOCKED odds; a player runner's `p` at `FIELD=6` peaks at 0.667 (a maxed favorite), well under the
  0.909 threshold where the 1.1 odds floor would flip a runner +EV, so every ticket stays −EV and
  `openLiability` (which reserves `stake × MAX_ODDS`) always covers the locked payout;
- `track_entries` is correctly EXCLUDED from the runEstate wipe (the snapshot survives so a dead owner's
  entry still settles as status-only — no money moves at settle); `p` / `MARKET_SEED` never leak
  (`trackCard` strips `p`); self-betting on your own runner is −EV like any other ticket.

**Lens B (concurrency)** confirmed two real, real-Postgres-only defects (pg-mem is single-threaded):

- **MED — concurrent-entry post collision** (`enterTrackRace`): the `SELECT COUNT(*) FROM track_entries`
  that computes the outside post was taken with no shared lock held, so two different owners entering the
  same `(day,race)` could both read `n=0` → both compute `post=5` → both INSERT (the PK is
  `(day,race,character_id)`, which does NOT catch a post collision). Harm: `trackFieldOf`'s
  `byPost[post]=e` silently overwrites one runner (the other owner paid the fee for a phantom entry), a
  `PLAYER_SLOTS` breach, and a double win-credit in the sweep. **No §10.4 drift** (the fee is ledgered;
  `racer_wins`/`wins` are status). **FIXED**: lock the `street_tax` singleton (`SELECT 1 … FOR UPDATE`)
  BEFORE the COUNT — the count→post→INSERT window is now serialized. The `street_tax` row is the one this
  path credits anyway, and locking it last preserves the canonical `char → racer → singletons-last`
  order (no new lock edge, no AB-BA).

- **LOW — `racers.wins` non-atomic lost-update** (`sweepTrackEntries`): the win-credit read
  `SELECT wins FROM racers WHERE id=$1` (no `FOR UPDATE`) then wrote an absolute value, so a concurrent
  `raceCircuit`/`matchRace` win on the same racer could lose a `+1`. Status-only, no §10.4 surface.
  **FIXED**: `SELECT wins … FOR UPDATE` serializes it. (The account-legend increment already used the
  concurrency-safe atomic `racer_wins = racer_wins + 1` under the UPDATE's own row lock — SOUND, left.)

## Regression added (`test/casino.js`)

A **distinct-posts + slot-cap** test: two owners entering the same fresh card get DISTINCT posts (6 then
5 — the serialized count→post→INSERT), a third → `full` at `PLAYER_SLOTS=2`. pg-mem can't reproduce the
race, so the test pins the CORRECTNESS the `street_tax` lock guarantees under real concurrency (no two
entries share a post).

## Flagged (accepted, no action)
- Orphaned `track_bets` over-reserving `openLiability` at death is the shared pre-existing den-liveness
  nuisance (never mints — the stake already burned into den profit), not a leak.
- A `UNIQUE(day,race,post)` schema backstop was considered redundant given the `street_tax` serialization
  and left out to avoid a 23505 surface on the hot path (the lock is the primary guard, the correctness
  test the proof).

Suite 33/33 + sim drift-0 (18 checks).
