# AUDIT — Gambling Den step three (blackjack + heads-up hold'em)

A focused three-lens red-team over the two new table games (§10.4 / den-book exactness, the
stateful-hand concurrency, exploit / grief), every claim verified against source. **No
CRITICAL / HIGH.** One MED fixed in-commit (regression added); everything else verified clean.

## Fixed in-commit

**MED — the profit cap under-reserved a LIVE blackjack hand** (`casino.js:openLiability`). The den
tips the street (and pays front rakeback) only out of realized profit *net of open liability* — and
`openLiability` reserved the numbers 600:1 exposure and the fight dog-odds exposure but **NOT** a
live blackjack hand's pending payout. So while a hand sat unresolved (its bet already booked as
profit), a subsequent dice/numbers bet could tip that not-yet-earned money to `street_tax`,
inconsistent with the numbers/fight reservation. **Not a §10.4 drift** — the two den identities
(`profit == PvE bets − wins`, `distributed == takes + rakeback`) hold either way, and the cap is a
documented *soft* cap (a later jackpot can legitimately drive lifetime profit below what was already
tipped). But the reserve should be COMPLETE for parity. **Fix:** `openLiability` now adds each live
hand's max gross payout (`bet × (dbl?2:1) × 2`, computed in JS to dodge the pg-mem SUM-over-
expression quirk). Regression: with a high-stakes hand live, a dice round tips **$0** to the street
(the reserve dwarfs realized profit), then the hand resolves cleanly. §10.4 unaffected.

## Verified CLEAN

**§10.4 / den book.** Every blackjack stake is a `casino:bet:blackjack` sink matched 1:1 with a
`bumpProfit(+)`; every payout a `casino:win:blackjack` faucet matched with `bumpProfit(−)` — so the
`den profit == Σ casino:bet:% − Σ casino:win:%` identity stays exact (both LIKE patterns catch the
new reasons). `ch.cash` mutations equal the ledgered amounts on deal / double / pay, so the per-
character cash check reconciles (proven over a mixed dice+blackjack+poker session). A PUSH refunds
via a `casino:win:blackjack` faucet (net-0, profit unchanged). Poker is the **audited `casino:pvp`
transfer** — the rake carved FROM the winner, half → street tax (a direct pool credit, NOT `casino:take`),
half burns; `casino:pvp` matches neither den LIKE pattern, so PvP correctly never touches the PvE book.
A tie moves no money and takes no rake.

**Concurrency / persist-clobber.** `blackjack_hands` state is mutated by direct SQL under the
`withCharacter` char lock (each action re-`SELECT … FOR UPDATE`s the hand); `persistCharacter` never
touches the table → no clobber. Two concurrent deals serialize on the char lock → the second sees
the row and throws `hand` (the PK-23505 path is unreachable behind the lock). Lock order is a single
class beyond the char (char → `blackjack_hands`, acyclic). The new `poker_limit` is a normal persisted
column (`persistCharacter` $61 + the view) — no clobber. `playPoker` runs under `withTwoCharacters`
(both chars sorted) and bumps `den_volume` BEFORE crediting `street_tax` — the exact PvE lock order
the AUDIT-full-system-v2 B-H1 fix requires — so it can't AB-BA the other den paths.

**Exploit / grief.** Infinite-deck draws (independent, server-side, rng-audited) make card-counting
impossible by construction (no depletion) — the fixed ~0.6% edge is intended (dice-parity). Poker
collusion is −EV: the showdown outcome is random (you can't guarantee the win to funnel money) and
every non-tie hand burns 5% rake — the pvpDice argument. Abandoning a blackjack hand only
self-blocks the player (the `hand` gate) and forfeits the already-booked bet — no advantage, and the
hand dies with the street (`blackjack_hands` joined the runEstate wipe). **No hole-card leak:** deal/
hit/denInfo expose only `dealer[0]` (the up-card); the full dealer hand is returned only after the
hand resolves. NaN/Infinity stakes are rejected by `gateBet`'s comparison gates; double requires the
cash and the first-two-cards state.

## Not changed (by design)

The DEAL's own 1% street tip fires before the hand is inserted (the stake is realized profit at that
instant — the same bet-time 1% dice/numbers take), so it isn't reserved against itself; the
reservation protects only SUBSEQUENT tips, which is the meaningful window and matches numbers/fight.

Suite 32/32 + sim drift-0.
