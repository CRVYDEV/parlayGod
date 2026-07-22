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

---

# AUDIT — The Track step four (THE FUTURITY)

A three-lens red-team over the step-four drop (THE FUTURITY — owners nominate player-owned racers into a
scheduled card, the whole town bets CASH parimutuel, a worker races the field and pays out; the
boxing-main-event twin on the racing side). Three parallel adversarial agents, each tracing every finding
against source before reporting.

Scope: `nominateFuturity` / `betFuturity` / `resolveFuturity` / `sweepFuturity` / `futurityInfo`
(`src/casino.js`), the `futurity escrow` §10.4 check (`src/invariants.js`), the four new tables
(`schema.sql`), the estate-wipe exclusion (`src/social.js`), and `CASINO.FUTURITY` (`src/rules.js`) —
compared byte-for-byte against the audited twins (`resolveMainEvent`, `resolveStakes`, `resolveGrandPrix`,
`resolveTournament`).

## Verdict: no CRITICAL / HIGH / MED across any lens. Two LOW hardenings applied.

**Lens A (§10.4 / escrow / faucet) — CLEAN.** The `futurity escrow` identity (`pool == posted − wins −
refunds − purse − take − death`) holds on EVERY terminal path (normal resolve with the last-winner
remainder mop-up, scrapped `<MIN_RUNNERS` card, one-sided book, scratched-runner refund, dead-bettor
burn, mid-window). The nomination fee (`casino:futurity:nom` → the buyback) is correctly OUTSIDE the
escrow yet reconciled by the per-character cash check via its `character_id`. No accidental den-book LIKE
match (`casino:futurity:bet` ≠ `casino:bet:%`, `casino:futurity:take` ≠ exact `casino:take`), so the
`den profit`/`den distributions` identities are untouched. A true redistribution: `purse + houseCut ==
rake`, `distributable == totalLose − rake`, winner payouts + purse + take == the live pool — no mint, no
new faucet.

**Lens B (concurrency / locks) — CLEAN** (no C/H/M). Faithful to the audited GP/tournament/stakes
discipline: nominate `char → account → racer → futurity_state → card` (the whole materialize→COUNT→INSERT
critical section serialized by `futurity_state FOR UPDATE`, so the track-post-collision class is
unreachable and FIELD_MAX can't be breached); resolve `sorted chars → futurity_state → card`
(state-before-card, no AB-BA vs a concurrent nominate); the `racer_wins` legend is an atomic in-DB `+1`
excluded from `persistAccount` (no clobber); `sweepFuturity` is per-card + idempotent behind the
`status='open' FOR UPDATE` re-select. `futurities.pool` is NUMERIC (pg-mem-quirk-exempt) and payouts
recompute from the re-read bet rows, never from `pool`.

**Lens C (death / estate / exploit / grief) — CLEAN** (no C/H/M). Server-authoritative outcome (frozen
`form` snapshot + rng-audited server RNG — re-training after nomination can't move the snapshot; the
client picks only racer ids). The estate-wipe exclusion of `futurity_runners`/`futurity_bets` is correct
and load-bearing (the snapshots must survive so a dead owner's runner scratches + a dead bettor's escrow
burns — no stranded pool). Death vs resolve serialize on the char lock (locked before `alive` is read).
The scratch refund is a safe make-whole, never larger than the bet, and NOT an exploitable option (the
outcome is decided by server RNG *inside* resolve, after betting closes — no oracle to selectively
suicide on). Idempotent single-writer resolution; every gate server-side.

## Hardenings applied (the two LOWs — regression-covered by the existing futurity test + parity with the twins)

- **Lens B LOW — `betFuturity` now locks `futurity_state FOR UPDATE`** (not just the card), so a bet
  fences against resolve exactly like the audited Grand-Prix/Stakes ENTRY paths: once `resolveFuturity`
  holds `futurity_state`, a late bet blocks until resolve commits, then re-reads `status<>'open'` →
  `no_futurity`. Closes the only interlock the Futurity had narrower than its twins (the prior gap was
  value-safe — atomic-increment cash writes + a 40P01 retry — but this restores full parity). Lock order
  `char → state → card` stays acyclic (matches nominate + resolve).
- **Lens C LOW (forward-looking) — a tripwire comment** at `nominateFuturity` documenting the load-bearing
  invariant that `racer_id` is UNIQUE within a card (resolve keys place-updates + bet buckets on it). It
  holds today because racers are non-transferable + one runner per owner; the comment gates a future
  racer-TRADE feature so it can't silently collide two successive owners' entries into one card.

## Flagged (accepted, no action — the casino posture)
- **own_event-via-alt** (an owner betting their own card through a second account): pure parimutuel
  redistribution, form is public (no information asymmetry), nothing minted — the accepted
  consent-by-betting posture.
- **FIELD_MAX flood / forced scrap**: needs 8 Sybil accounts each with a fit racer + a burned $5k fee,
  and a scrap refunds every live bet (bettors unharmed) while burning only the griefer's own fees —
  symmetric-cost + self-defeating.
- **Resolved-row growth**: `futurities`/`futurity_runners`/`futurity_bets` rows accumulate (like every
  other escrow table — `poker_tournaments`/`grand_prix`/`stakes_races`/`boxing_bouts`); an ops/table-bloat
  note, not a correctness issue (each card resolves once).
- The `ownerAlive ? purse : 0` guard at the winner-purse site is defensively dead (the winner is always
  drawn from the live set) — both Lens A and C noted it; harmless, left as a safety guard.

Suite 33/33 + sim drift-0 (19 checks, incl. `futurity escrow`).
