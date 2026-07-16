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

## 5. Step two (deferred by design)
- **Player-vs-player dice** (`withTwoCharacters`, both stakes escrowed, 5% rake) — the back-room
  game; a pure transfer with a house take, same class as the exchange.
- **Fight fixing** — bet on the weekly NPC bout; city-event tie-in; a family holding neon can
  *fix* it once a season (turf perk with teeth).
- **Casino-business rakeback** — a player who owns the `casino` BUSINESS at the Neon Mile earns
  a % of den volume as business income (ties the Den into the Business Empire layer).
- **High-stakes room** — bigger limits gated on level/seal, visible on the streets feed (whale
  theater).
