# OMERTÀ — The Commission (design)

**Status: building step one.** The endgame political layer: the FIVE most powerful families
(by standing — lifetime tribute + 10,000 per war won, the same ladder the buyback pays) hold
seats on the Commission and vote, once a week, on a DECREE that governs the whole city the
following week. Wars finally have a *why* beyond spoils: standing buys a seat, and a seat sets
the rules everyone else lives under.

## 1. Mechanics (all lazy — no ticks)

- **Seats**: the top `COMMISSION.SEATS` (5) families by standing, computed live. Lose the
  standing, lose the seat.
- **Voting**: during week W, the boss/underboss of a seated family casts (and may change) ONE
  family vote for a decree (`POST /v1/commission/vote`). Votes are PUBLIC — the politics is the
  content ("the Morettis voted Open Season — remember that").
- **Resolution**: the decree active in week W is the majority of week W−1's votes, tallied
  lazily whenever something reads it. A tie or an empty book = a deadlocked Commission — no
  decree (thematic, and the safe default).
- One family one vote (seat-weighting is a future lever).

## 2. The decree book (step one — four, each ONE touchpoint, all founder levers)

| Decree | Effect while active | Touchpoint |
|---|---|---|
| **OPEN SEASON** | safehouse stays are HALVED (`OPEN_SEASON_MULT` 0.5) — the knives come out | `enterSafehouse` |
| **THE PAX** | no NEW war declarations (running wars still resolve) — consolidation week | `declareWar` |
| **AMNESTY** | laying low costs HALF (`AMNESTY_MULT` 0.5) — the Commission paid the judges | `layLow` |
| **LOCKDOWN** | every convoy fights with +`LOCKDOWN_DEF` (20) guard defense — the freight is protected | `ambushConvoy` |

Effects are bounded, temporary (one week), and enumerated — they MODIFY signed levers rather
than change them, and the modifiers are themselves sign-off levers (BALANCE.md addendum). No
decree moves money: §10.4 is untouched by construction (AMNESTY changes a sink's price, which
the ledger records as always).

## 3. Surface
`GET /v1/commission` — the seats (live standing), this week's public votes, the decree in force
(and when it lapses), and the decree book. Votes notify the family channel; the active decree is
visible to everyone (it governs them).

## 4. Step two — BUILT (weighted seats + the veto)
- **Seat-weighted ballots**: a vote carries the family's CURRENT seat weight (head of the
  table = SEATS points … last seat = 1), stamped at CAST time — re-casting refreshes it, and
  the tally freezes when the week does (no mid-week decree flips; timing games are just
  politics, on the public record). Weighted ties still deadlock.
- **The veto**: the head seat's BOSS (and nobody else — not the underboss) may kill the decree
  in force, once per week (`commission_vetoes`, week PK). The veto is public (board `veto`
  field + a streets-feed event) and the dead decree's touchpoints go inert immediately. Pure
  politics — no money, no §10.4 surface.
- Deferred: decree proposals with treasury deposits, city-event interactions, and the
  Commission tax (would need §10.4 terms).
