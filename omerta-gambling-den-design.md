# OMERTÀ — The Gambling Den (detailed design)

**Status: DRAFT → building step one.** The genre's most glaring absence: we have a casino
*business* but nobody can gamble. The Den adds player-vs-house games — the noir staples — as a
**recurring, voluntary, entertainment-priced cash sink** that feeds the yield loop the economy
already runs on.

## 1. Hard rules (non-negotiable guardrails)

1. **CASH ONLY. Never $OMR.** Gambling with an extractable token is a regulatory line we do not
   cross regardless of counsel posture on the rest of the pivot. The Den's tables take pocket
   cash; no route touches `account_persistent.omr` in any direction. (The PLEX/extraction rail
   stays exactly as boring as a withdrawal should be.)
2. **Server-authoritative randomness, audited.** Every roll is server-side and written to
   `rng_audit` (ground rule #3). The client sends a *choice* (bet size, pick), never an outcome.
3. **Ledgered both ways.** Every stake is a §10.4 cash SINK (`casino:bet:<game>`), every payout a
   FAUCET (`casino:win:<game>`), both with `character_id` — the per-character cash check
   reconciles automatically; the house's margin is simply sink − faucet over volume.
4. **The street gets its cut.** 1% of every stake routes to the street-tax pool via `takeHouse`
   (the same transfer the AMM/exchange/bodyguard hires pay) — so gambling volume feeds the
   buyback → staking-yield → LP-depth loop. The rest of the house edge burns (deflationary).

## 2. The games (step one)

### 2.1 Street craps — `POST /v1/casino/dice { amount }`
The classic pass-line round, resolved in ONE server call (no table state): first roll 7/11 wins,
2/3/12 craps out, anything else sets the point and the server keeps rolling until the point
(win) or a 7 (loss). Pays 1:1. **House edge ≈ 1.41%** — the authentic number, thin enough that
dice are entertainment, not a wealth tax. The full roll sequence returns in the response and the
round is one `rng_audit` row. Costs `DICE_NERVE` (1) nerve — gambling takes nerve, and it's a
gentle natural rate limit on top of §10.2.

### 2.2 The Numbers — `POST /v1/casino/numbers { pick, amount }` + `/claim`
The poor man's lottery the mob actually ran. Pick a number 0–999, stake $10–$1,000, one ticket
per street per day. The day's winning number draws from the server-secret market seed
(`hash01('numbers:' + day + ':' + MARKET_SEED)` — same machinery as §7.11 prices, unpredictable
without the seed, verifiable after the fact). Pays **600:1** on true odds of 999:1 — the
historically accurate ~40% edge; it's a flutter, priced like one. Tickets resolve lazily:
`POST /v1/casino/numbers/claim` settles every matured ticket (wins credit `casino:win:numbers`;
losing tickets just close). `GET /v1/casino` shows yesterday's number, your open tickets, and
the table limits.

## 3. Placement & gates
- **Located at the Neon Mile** (`CASINO_DISTRICT: 'neon'` — the vice district; travel there to
  play). Gives neon a second identity beyond its income perk and keeps vice geographically
  contestable. Family turf does NOT substitute (the den is the den).
- Gates: jailed → no (prison dice comes with the prison update), bets clamped to
  `[CASINO_MIN_BET $100, CASINO_MAX_BET $250k]` per roll (variance ceiling — a whale can't
  swing $10M on one point), numbers `[NUMBERS_MIN $10, NUMBERS_MAX $1k]`.
- Idempotency-Key + the standard rate buckets apply (the routes live under `/v1` like every
  mutating player route).

## 4. Economy notes
- Expected sink at scale: dice volume × 1.41% + numbers volume × 40%, minus the 1% street cut
  (a transfer, not a burn). Both games are strictly −EV; the Den adds no earning loop, so it
  cannot disturb the sim-audited faucet curves — it only drains discretionary cash and feeds
  the buyback. (The audit's endgame problem is too much passive cash: the Den is a voluntary
  drain that scales with exactly the players who have the most.)
- Win streak risk is bounded by the max bet, and the numbers payout is bounded by
  `NUMBERS_MAX × 600 = $600k/street/day` worst-case (an acceptable faucet tail; the EV is
  strongly negative).
- All numbers (`CASINO` block in the rules tail) are founder sign-off levers.

## 5. Step two (BUILT)
- **Back-room dice (PvP)** — consent-by-listing, the bodyguard-market pattern: a fader posts an
  open limit (`POST /v1/casino/fade {limit}`, 0 clears; surfaced on the den board + their view),
  a challenger at the den rolls against them (`POST /v1/casino/dice/:targetId {amount}`, runs
  under `withTwoCharacters` — no escrow, one atomic transaction). One symmetric 2d6 hi-roll,
  ties reroll (a fair 50/50); the winner takes the pot minus `PVP_RAKE_BPS` (5%) — half the rake
  to the street-tax pool, half burns. Ledger: loser −stake / winner +(stake − rake), both
  `casino:pvp` with counterparties — a pure transfer with a house take, §10.4-exact. A jailed,
  hospitalized, or away-from-neon fader is `unavailable`.
- **The fight** — a weekly NPC bout (fighters drawn per week from the seed): one bet per street
  per week, **capped at `FIGHT_MAX` ($5k)** — the cap is the fix's structural abuse bound.
  Favorite wins at `FIGHT_FAV_P` (65%) off the seed draw; payouts `FIGHT_FAV_PAYS` 1.45 /
  `FIGHT_DOG_PAYS` 2.6 (a ~6–9% book edge). Bets settle lazily (`POST /v1/casino/fight/claim`).
  **THE FIX**: the boss/underboss of the family holding the Neon Mile buys the result once a
  week (`POST /v1/casino/fight/fix {winner}`) for `FIGHT_FIX_COST` ($50k) from the TREASURY (a
  §10.4 treasury sink, `casino:fix`, reconciled in the treasury check) — a turf perk with teeth,
  bounded by the bet cap (a fixed bout mints at most stake × payout per conspirator).
- **Casino-front rakeback** — owners of a `casino` BUSINESS split `RAKEBACK_BPS` (1%) of den
  stake volume (dice + numbers + fight + PvP pots), claimed at business collect, cursor-tracked
  per front (`rake_cursor` — a new owner earns against future action, not history; ledgered
  `casino:rakeback`). The Den feeds the Business Empire layer.
- **The high-stakes room** — at level `HIGH_LVL` (30) the PvE table takes up to `HIGH_MAX` ($2M)
  a roll; pots ≥ `HIGH_FEED` ($250k) hit the public streets feed (whale theater).

## Step three — the TABLE GAMES (BUILT)

Real table games at the Neon Mile, on the audited den-book accounting (no new emission — the house
edge is booked as profit and the street is tipped only from realized profit; on average both games
are house-favorable, i.e. a SINK). CASH ONLY (the regulatory line). All numbers are founder sign-off
levers (`CASINO.BJ_*`, `CASINO.POKER_MIN`).

- **Blackjack (stateful PvE)** — a real hand you play out. `POST /v1/casino/blackjack {amount}` deals
  (bet taken + profit-booked at deal, `casino:bet:blackjack`); the hand persists in `blackjack_hands`
  (one live hand per street) across `POST /v1/casino/blackjack/hit|stand|double` — each its own atomic
  txn under `withCharacter` — until it resolves and the payout (if any) credits (`casino:win:blackjack`).
  Infinite deck (independent draws, the same server RNG as dice, rng-audited); dealer stands on
  `BJ_DEALER_MIN` (17) and hits SOFT 17 (`BJ_HIT_SOFT_17` — the authentic ~0.6% edge); a natural pays
  3:2 (`BJ_PAYS_BPS` 15000). Double is a first-two-cards move (stakes a second bet, one card, auto-stand).
  Same book accounting as dice (bumpProfit / profit-capped `takeHouse` / bumpVolume). Dies with the
  street (`blackjack_hands` joined the runEstate wipe).
- **Heads-up Hold'em (PvP showdown)** — consent-by-listing: a dealer posts a `poker_limit`
  (`POST /v1/casino/poker/deal {limit}` — the fade pattern, a new persisted character column). A
  challenger antes an equal stake (`POST /v1/casino/poker/:targetId {amount}`, `withTwoCharacters`);
  both are dealt 2 hole + a shared 5-card board (a real 52-card shuffle), best 5-of-7 wins the pot minus
  `PVP_RAKE_BPS` (5%, half → street tax / half burns — the back-room-dice mechanism, `casino:pvp`,
  §10.4-exact per character). A tie splits (stakes returned, no rake, no money moves). ONE atomic
  showdown — no multi-street betting (turn-based sessions are deferred). Gates: both at neon, dealer
  available, stake ≤ limit, both cover it, not self.

**Deferred (step four candidates):** true multi-way ring poker + a live scheduled TOURNAMENT with a
prize pool (both need turn-based session state this atomic one-call architecture doesn't hold),
blackjack splits/insurance, a poker sit-n-go.
