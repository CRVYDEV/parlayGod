# OMERTÀ — The Dueling Ladder (#5) + Clue Scrolls (#4) + Seasonal Modifiers (#6)

The last three of the eight-idea content slate, each stealing a proven retention loop and landing
on audited machinery. Every number is a founder sign-off lever.

---

## Drop 1 — THE DUELING LADDER (League of Legends / chess: the ranked ladder)

The game has deep PvP but zero RATING. A formal dueling circuit gives every fighter a number to
climb and a seasonal race to win — League proved a ranked ladder alone retains players for a decade.

### The duel
- **Consent-by-listing** (the fade/bout/race pattern): `characters.duel_limit` is your open stake
  cap; a challenger picks you off the board and stakes cash ≤ your limit.
- **One atomic two-party txn** (`withTwoCharacters`): the contest is
  `eff(muscle)+eff(cunning)+eff(speed) + rand(0, DUELS.VARIANCE)` each, ties reroll, rng-audited —
  the BUILD decides (stats/gear/assets), the rating tracks results.
- **The money is the audited casino:pvp taxed transfer byte-for-byte** (the boxing `fightBout`
  accounting): loser −stake, winner +stake − rake (`DUELS.RAKE_BPS` 5%), half the rake → the
  street-tax buyback, half burns. **ZERO new emission** — a redistribution with a house take.
- Gates: both ≥ `MIN_LVL` (5), jailed/hospitalized both sides, family omertà, listed limit,
  stake ∈ [`STAKE_MIN` $1k, their limit], both cover it.

### The rating (pure status)
- `characters.duel_elo` (INT, starts `ELO_START` 1000) — a **direct-SQL column** (never in the
  positional persist — clobber-safe; absolute writes under the two char locks).
- Standard ELO: `E = 1/(1+10^((them−me)/400))`, winner `+K·(1−E)`, loser mirrored, floored at
  `ELO_FLOOR` (100). **Anti-Sybil feeding**: `K_eff = K / (1 + duels vs the SAME account-pair
  today)` (the bloodline-diminishing precedent — an alt feeding elo decays to nothing within a
  day, and every feed pays the 5% rake) + the level floor + the seasonal reset.
- **Seasonal**: `runSeasonRollover` resets every elo to 1000 (rides the existing per-char reset
  txn) — a fresh race every 28 days. The elo dies with the street (heir starts at 1000 — no
  death-softening).
- **The legend**: `account_persistent.duel_wins` (lifetime, survives death — the boxing_wins
  precedent), credited only vs a loser ≥ `LEGEND_MIN_LVL` (10, the WHEEL anti-Sybil floor).
- `DUELS.RANKS` ladder (Street Fighter → Il Campione) + `GET /v1/leaderboard/duels`
  (living, agents excluded — the status-board posture).

Routes: `POST /v1/duels/list {limit}` (null unlists), `GET /v1/duels` (the board, nearest-elo
first), `POST /v1/duels/:targetId {amount}`, `GET /v1/leaderboard/duels`.
§10.4: `duel:` joins the cash vocabulary — `duel:wager` is a character_id'd taxed transfer
(check (a) reconciles both sides; the rake is the audited casino:pvp split).

---

## Drop 2 — CLUE SCROLLS (RuneScape: the treasure trail)

RuneScape's most beloved side-system: a rare drop starts a multi-step riddle hunt ending in a
casket. Our deterministic §7.11 seed machinery is literally built for it.

### The hunt
- **The drop**: a successful CRIME rolls `CLUES.DROP_P` (2%) for a scroll — only if you hold no
  active scroll AND your post-casket cooldown (`CLUE_CD_MS` 8h) is clear. One active hunt per
  street; the scroll DIES with the street.
- **The steps**: `STEPS_MIN..MAX` (3–5), each derived from the stored scroll salt via the §7.11
  hash — a DISTRICT (+ sometimes a city-hour window: "when the city sleeps"). Deterministic →
  server-verifiable, no stored answers. The riddle text is district flavor from the `CLUES`
  block.
- **The dig**: `POST /v1/clues/dig` — stand in the right district (inside the window if timed),
  pay `DIG_ENERGY` (5); wrong ground is a cold shovel (energy still spent — brute-forcing 6
  districts is possible but pointless since riddles are legible; the energy is pacing).
- **The casket**: the final dig pays `CASKET_MIN..MAX` ($3k–$12k) cash — **the drop's ONE new
  faucet**, ledgered `clue:casket` (character_id'd), bounded three ways: the 2% drop, one active
  hunt, and the 8h post-casket cooldown (≤ ~3 caskets/day hard ceiling ≈ $36k/day worst case —
  petty next to the signed loops; sim probe P9.19 prints it). Plus `account_persistent.caskets`
  (lifetime legend, survives death) + `CLUES.RANKS` + the board.
- `CLUE_DROP_P` is a TEST-ONLY roll knob (the LAW_BUST_P precedent, boot-guard listed).

§10.4: `clue:` joins the cash vocabulary (one bounded faucet). Rares/cosmetics in caskets are
deliberately deferred (step two) — cash only, no chance-based $OMR ever.

---

## Drop 3 — SEASONAL LEAGUE MODIFIERS (Path of Exile: the league twist)

PoE's core retention engine: every season the RULES twist. Each 28-day season draws ONE modifier
from a small founder-approved pool — deterministically off the season index + `MARKET_SEED`
(knowable in advance to nobody without the seed, verifiable after — the §7.11 ethos; no state,
no cron, read lazily everywhere).

### The pool (`SEASON_MODS` — 100% founder sign-off; each entry lists its exact touchpoints,
### which COMPOSE multiplicatively on EXISTING modifier sites, the decree pattern)
- **dead_quiet** — the control: a vanilla season ("the city holds its breath"). Having a null
  season in the pool keeps the baseline felt.
- **the_crackdown** — the Bureau is everywhere: investigation-meter GAIN ×1.25 (the envelope
  site), laying low ×0.75 (the amnesty site).
- **blood_in_the_streets** — the knives are out: fire-kill loot rates ×1.15 (clamped ≤ 50%),
  safehouse stays cost ×1.25.
- **the_gold_rush** — trade fever: goods SELL ×1.05 (the cityEvent tradeMult site).

**This is the one drop that deliberately touches SIGNED balance levers** — that is its nature
(the pitch said so), which is why the pool ships SMALL, every multiplier is a named lever, one
season in four is vanilla, and the whole pool is a BALANCE.md sign-off block. `SEASON_MOD` is a
TEST-ONLY override knob (the WORLD_UPRISING precedent).

Surfaces: `GET /v1/city` gains `season {idx, daysLeft, mod}`; `/v1/rules.seasonMods`; a console
City-tab banner; the season's modifier is also stamped into the wiki/codex copy.
§10.4: zero — every touchpoint is a rate/cost modifier on already-ledgered flows (the discounted
or amplified number is what's ledgered, the decree discipline).
