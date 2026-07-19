# The Fight Circuit — design (step one)

Mob boxing. Every gangster fancies himself a fight manager — you sign a **contender**, train them up, and
stake them against other players' fighters in the back-room circuit. It's a new competitive loop distinct
from the casino's spectator FIGHT bet (that's gambling on an NPC card; this is *managing your own fighter*):
a persistent owned asset with stats + a win/loss record, a PvP staking contest, and a status ladder. The
mafia fantasy is the "my guy can beat your guy" wager — the oldest bet there is.

Founder-directed; numbers are proposed defaults (sim + sign-off, ground rule #1). Off-chain, §10.4-clean.

## The model
- **One contender per manager** (`fighters.character_id` PK) — a fighter with `power`/`chin`/`speed`, a
  `wins`/`losses` record, an `injured_until` clock, and a `bout_limit` (consent-by-listing stake). It DIES
  WITH THE STREET (the business/club precedent — `fighters` joins the runEstate wipe): a made man's fighter
  is at stake like everything else.
- **The contest is a pure PvP TRANSFER with a vig** — the audited `casino:pvp` (back-room dice) pattern
  EXACTLY. Both stake the purse; the winner takes it minus the house vig (half → street-tax buyback, half
  burns). NO new cash faucet (no PvE purse minting), NO escrow (instant), so §10.4 stays exact by reusing
  the casino-PvP mechanism. The `boxing:` cash reasons ride check (a) per character.

## The loop
- **Sign a contender** (`recruitFighter`) — a `BOXING.RECRUIT_COST` cash SINK (`boxing:recruit`), level-gated
  (`MANAGER_MIN_LEVEL`); stats rolled `[STAT_MIN, STAT_MAX]`. One per manager (re-sign only when you have none —
  a dead/retired fighter frees the slot). Name it (creation-rules validated).
- **Train** (`trainFighter`) — a `BOXING.TRAIN_COST` cash + `TRAIN_ENERGY` energy SINK (`boxing:train`) that
  adds `TRAIN_GAIN` to one stat, capped at `STAT_CAP`. Progression = you build a better fighter over time.
- **Take bouts** (`listBout`) — set a `bout_limit` (consent-by-listing, the fade/bodyguard pattern; null =
  not taking action). Any challenger stakes up to it.
- **Fight** (`fightBout`, two-party `withTwoCharacters`) — the challenger's fighter vs the listed fighter,
  both stake `amount` (≤ the limit). Score = `power + chin + speed + rand(VARIANCE)` each (rng-audited, ties
  reroll); the winner takes `2×stake − rake` (`RAKE_BPS` vig, half → the buyback pool, half burns — the
  `casino:pvp` split). Records update; the LOSER's fighter is laid up (`INJURY_MS`) so it's not spam. Gates:
  both managers own a fighter, the opponent is listing, neither fighter injured, stake within the limit,
  both cover the stake, not self, not jailed; a fighter's manager can't fight their own family (omertà).
- **The circuit** (`GET /v1/boxing`) — your fighter + every fighter taking bouts, ranked by record;
  `GET /v1/leaderboard/boxing` ranks the whole circuit. `BOXING.RANKS` (Prospect → Hall of Famer, by wins)
  is a status ladder.

## §10.4
Cash: `boxing:` joins the cash `KNOWN_REASONS` — `boxing:recruit`/`boxing:train` (character_id'd SINKS),
`boxing:bout` (a taxed PvP TRANSFER, both sides character_id'd + counterparty — the `casino:pvp` twin: the
half-rake → street_tax via a direct UPDATE, the other half burns implicitly since the winner nets
`stake − rake`; NO NULL take row, NO new faucet, NO escrow). Check (a) reconciles per character exactly like
the back-room dice. Estate: `fighters` wiped on the manager's death.

## Deferred (step two)
A STABLE (multiple fighters), NPC exhibition bouts (a bounded PvE purse — needs sim like the world-raid
faucet), title belts (a server-run championship with a defended belt), betting on other people's bouts
(spectator gambling → the den book), an account-level career-wins LEGEND that survives death (the hitman-rep
precedent), and cornerman/trainer NPCs (the Underworld tie-in). All numbers are founder sign-off levers.
