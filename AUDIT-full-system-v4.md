# AUDIT-full-system-v4.md — full-system red-team (post-Futurity / post-Uprising)

**Scope.** A max-effort whole-codebase red-team over everything shipped in the session's racing/world
drops (THE TRACK steps three–four incl. THE FUTURITY, THE STABLE, THE WORLD step six THE UPRISING) and
the systems they touch (casino den-book, stable/racer legend, world frontier, the worker sweeps, the
two-party lock discipline). Six independent lenses in parallel:

1. §10.4 ledger conservation + escrow identities
2. concurrency / lock order / persist-clobber
3. death / estate / PvP shield ordering
4. racing internals (Track/Stable/Futurity/Grand-Prix)
5. World internals (frontier / uprising / raids)
6. cross-system economic exploits

Every reported finding was re-verified against source before any change. A regression test accompanies
each behavioural fix. **Suite 33/33 + sim drift-0** after the batch.

**Result: no CRITICAL. One HIGH (an exploit, not a §10.4 leak). No §10.4 drift.**

---

## Fixed in-commit (regression each)

### HIGH — THE TRACK: the "swap the runner under the bet" exploit (`casino.js:betTrack`/`claimTrack`)
The Track pays **fixed odds LOCKED on the ticket at bet time** (step three, `track_bets.odds`) — a
bookmaker's board. But the WINNER is drawn from the **merged field**, which changes as player racers
`enterTrackRace` into the day's card (the last `PLAYER_SLOTS` posts). The ticket only stored the post
INDEX (`runner`), not *who was standing there*. So:

1. Bet the outside post while it holds a weak NPC → the ticket locks the NPC's **longshot** odds.
2. A confederate (or you, on an alt) `enterTrackRace`s a **maxed** racer, which lands on that same
   outside post — now the short-priced favorite.
3. If the favorite wins (very likely), `claimTrack` pays the stake × the **locked longshot odds** — a
   large, near-guaranteed positive-EV skim off the den book. The odds you were paid never existed for
   the runner that actually won.

**Fix.** The bet now snapshots WHICH runner it backed — `track_bets.bet_racer_id` (a player `racerId`,
or `NULL` for an NPC). `claimTrack` runs a **scratch check** before the hit check: if the identity at
the backed post has changed (`backed !== nowAt` — an NPC replaced by a player entry, or a different
racer), the runner you bet on is *gone*, so the ticket **SCRATCHES** — a 1:1 stake refund
(`casino:win:track`, `bumpProfit(-refund)` so the den book nets 0 on a scratch), never the stale
locked price. NULL `bet_racer_id` (pre-audit tickets) is treated as "an NPC was there" — the common,
correct case. Schema: `track_bets.bet_racer_id TEXT`.
**Regression** (`test/casino.js`): a bettor backs the NPC outside post at longshot odds → a maxed racer
enters that post → the card is rolled to a day the merged outside post WINS → the claim **REFUNDS 500**
(not the ~25:1 longshot payout) and reports `scratched:true`. (The existing "legit NPC bet still pays at
the locked odds" case is covered by the step-three test directly above it.)

### MED — the racer-legend AB-BA (account ⇆ racer lock inversion)
Every **player-side** racer action (`stable.js` train/circuit/match/breed) runs under `withCharacter`,
which holds `account_persistent[owner] FOR UPDATE`, then locks the `racers` row — order **account →
racer**. But two worker/resolve paths locked a `racers` row and *then* bumped the owner's
`account_persistent` (`racer_wins`) — order **racer → account**. Opposite order on the same two rows =
AB-BA, masked only by the standard 40P01 retry.
**Fix** (both sites now lock **account before racer**, mirroring the player order):
- `casino.js:sweepTrackEntries` — added `SELECT … FROM account_persistent … FOR UPDATE` for the entry
  owner before the `SELECT wins FROM racers … FOR UPDATE`.
- `casino.js:resolveFuturity` — same, for `winner.character_id`, before the racers `FOR UPDATE`; the
  function header lock-order comment corrected to state the account→racer bump order.
- `casino.js:nominateFuturity` — reordered to lock `futurity_state` **first** (materialize/find the
  card), then lock the racer row, so nominate and resolve agree on state → card → racer ordering.

### LOW-MED — the racer-legend Sybil floor (`stable.js:matchRace`)
`matchRace` bumped the owner LEGEND (`racer_wins`, the account-level survives-death leaderboard axis)
on **every** PvP win, with no level floor on the loser — so a main+alt could farm the nightlife/stable
leaderboard by beating a fresh throwaway alt over and over (the exact class `races.js` closed with
`WHEEL_MIN_LVL`).
**Fix.** `STABLE.LEGEND_MIN_LVL` (10) — the win banks the legend only if the LOSER is at/above the floor
(the `RACES.WHEEL_MIN_LVL` / `WANTED_MIN_LVL` / npcHit-rookie-floor precedent). A status board can't be
farmed against rookies; a real rival is comfortably past it.
**Regression** (`test/stable.js`): a maxed dog beats a level-9 runt → the match is a WIN but banks **no**
career win.

### LOW — dead code (`stable.js:wipeRacersAtDeath`)
An unwired estate hook (`racers` is already in the `runEstate` wipe list — social.js:1358). Deleted to
avoid a second, divergent wipe path.

---

## Verified CLEAN (no change needed)

- **§10.4 across every racing/world reason.** `casino:*:track`/`casino:futurity:*`/`casino:track:entry`
  ride the existing `casino:` vocabulary; the scratch refund reconciles as `casino:win:track` with the
  matched `bumpProfit(-refund)` (den book nets 0). `world:reinforce`/`world:tribute`/`world:invade`
  reconcile in the gang-treasuries check. The Futurity + Grand-Prix + Stakes escrow identities each hold
  (open == posted; resolved nets 0). Sim: drift-0 over an entirely earned economy.
- **The Futurity worker settle.** Single-writer, idempotent (`status='open'` re-check under the state
  lock), the frozen-field pre-read is stable at window close, dead-owner scratch + dead-bettor burn are
  NULL-character rows (excluded from the per-character check), alt-stuffing is −rake/N per head (−EV).
- **The Uprising reckoning.** `world:reinforce` a correctly-subtracted treasury sink; the reclaim writes
  ZERO ledger rows (garrison is a `world_npcs` number, never a treasury balance); the tribute suspension
  is a 24h-capped deferral (can only reduce emission); `world_uprisings` is single-writer (day PK,
  `FOR UPDATE` latch) — no AB-BA; the schedule is server-authoritative (strength moves down-only via
  raids, so a rival can't inflate a holder's reckoning threshold).
- **Lock order** across the two-party racing paths (matchRace / Grand-Prix enter+settle / Futurity
  nominate+resolve): characters (sorted) → state singleton → card row → then account→racer at the legend
  bump — acyclic after the MED fix.
- **Death/estate.** `racers`/`track_bets`/`fight_bets`/`numbers_tickets` in the wipe; account-level
  legends (`racer_wins`, world `cartel_damage`, boxing `boxing_wins`) survive death; the Futurity/GP
  snapshot rows (`futurity_runners`/`stakes_entries`) survive the estate so a frozen field still resolves.

---

## Flagged for founder sign-off (NOT patched — ground rule #1 / accepted posture)

- **Cosmetic LOWs (behaviour-neutral, left as-is):** `races.js` `raceChallenge`'s identical
  win/lose ternary branches (readability only); an `ownerAlive` dead-branch comment; `port.js`
  `rentBerth`'s `berths = berths + 1` arithmetic UPDATE (the pg-mem quirk applies per-column and this one
  is proven working by the passing berth test — the convoy-fix precedent would convert it to an absolute
  write for consistency, but there is no bug to fix); `chain.js` `assertChainId` could warn louder on an
  RPC-less signing box (the v3 reclaim fix already fails safe); `store.js` `claimPendingWire` heir
  defense-in-depth. None move value or block a player.
- **Racing faucet magnitudes** (already in BALANCE.md, sim-measured this pass): the Stable circuit purse
  (trained ×4 stable ~$420k/day) and the Track/Futurity/Grand-Prix are net SINKS or bounded faucets at
  boxing-exhibition / territory parity — founder sign-off levers, not §10.4 leaks.
- **Carried, previously-accepted:** the market `bidListing` AB-BA (retry-masked, the auction accepted
  class), `VoucherClaim.sweep` lacking OmertaBond's over-sweep guard (Safe = root of trust), the
  purchasable Commission seasonal standing, the shared dividend-pool allocation, and the apex-solo-raid
  floor (now crew-only after the SIGN-OFF ship).
- **`forge test` STILL not run** (Foundry egress-blocked) — the pre-mainnet contract gate stands.

**Bottom line:** the racing pillar's one real exploit (the fixed-odds swap) is closed with a durable
identity check; the account⇆racer AB-BA is normalized to the player-side order at three sites; the
stable legend gained its anti-Sybil floor. §10.4 exact, suite 33/33, sim drift-0.
