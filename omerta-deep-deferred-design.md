# OMERTÀ — the deep-system deferred four (design)

**Founder directive (2026-07-24):** integrate the four deferred items sitting on otherwise-deep
systems — casino ring poker + multi-table tournaments, NPC lenders for the Shylock (the backed
`loan_house` pool), Estate step two (staff wages + the gala), and the Commission's
proposals-with-deposits + tax. All numbers are founder sign-off levers (ground rule #1); every design
below rides an already-audited pattern rather than inventing a new money surface.

---

## A. Estate step two — THE STAFF & THE GALA (+ the estate leaderboard)

The Estate is the deep personal $OMR sink, but every burn is one-time. Step two adds the **recurring**
$OMR drain the founder asked for, plus the social event that makes the compound a place, not a menu.

**The staff** (`ESTATE.STAFF` catalog — Groundskeeper / Butler / Sommelier / Curator / Capo of the
House; each `{ id, name, wageOmrDay, minTier, blurb }`). Hire a staff member (`estate:staff:hire`,
one-time $OMR burn, tier-gated); from then on the household owes wages — `wageOmrDay` per staffer,
accrued LAZILY on the estate's own clock (`estates.staff_paid_at`, the business-pad/crew-nut pattern)
up to `STAFF_WALK_MS` (7d — the walk window bounds arrears). `payStaffWages` (POST /v1/estate/wages) settles the whole household
ALL-OR-NOTHING (`estate:staff` burn — rides the existing `estate:%` omr vocabulary, ZERO invariant
change). Unpaid past `STAFF_WALK_MS` (7d of arrears), the staff WALK (rows deleted — rehire from
scratch, the hire fee again). Staff are PURE STATUS (household prestige on the board; the Butler is
the gala prerequisite) — zero gameplay power, the vanity/seal posture. Account-level
(`estate_staff (account_id, staff_id)` PK) → survives death with the compound; wages keep accruing
(the heir inherits the payroll; arrears are bounded by the 7d walk window like everyone's).

**The gala** (`throwGala`, POST /v1/estate/gala): tier ≥ `GALA_MIN_TIER` (2) + a hired Butler; burns
`ESTATE.GALA_OMR × tier` (`estate:gala`) and opens a `GALA_MS` (4h) window announced on the streets.
Anyone alive and not in lockup may `attendGala` (POST /v1/estate/gala/attend {host}) ONCE per gala
(`gala_guests` rows) — attendance is free and PURE STATUS (your name on the guest list, the speakeasy
"be seen" fantasy at the estate). The board shows the live guest list; the host banks `galas_hosted`
and `gala_best` (biggest turnout — account cols, survive death). Zero money beyond the host's burn.

**The estate leaderboard** (`GET /v1/leaderboard/estates`): the city's great houses by lifetime $OMR
sunk (`spent_omr`), with tier/name/staff count/best gala. Agents excluded (status-board posture).

§10.4: `estate:staff:hire` / `estate:staff` / `estate:gala` all ride the existing `estate:%` omr burn
term — zero invariants.js change. Levers: wage rates, caps, walk window, gala price.

## B. Commission step three — PROPOSALS WITH DEPOSITS + THE LEVY

**Proposals** put skin in the game. A seated family's boss/underboss may PROPOSE a decree for the
week being voted (`commission_proposals (week, gang_id)` PK, one per family per week) with a
`COMMISSION.PROPOSAL_DEPOSIT` ($100k) CASH deposit from the TREASURY (`commission:proposal`, a
treasury→escrow transfer — the family-contract pattern). **When any proposals exist for a week, the
tally counts only votes for PROPOSED decrees** (votes for unproposed decrees are discarded); with no
proposals the chamber votes freely (backward compatible — every existing test/board flow unchanged).
Settlement is a worker sweep (`settleProposals`) once the voted week has FROZEN and its governed week
begun: the proposal matching the ENACTED decree refunds to its treasury (`commission:refund`); every
other proposal FORFEITS to the street-tax pool (`commission:forfeit`, NULL rows — the confiscation
pattern). A deadlock/veto forfeits all (you moved the chamber and it hung — the deposit was the bet).
A dissolved family's pending deposit forfeits (dead-funder precedent, handled at settle via the LEFT
JOIN). §10.4: `commission:` joins the cash vocabulary; the gang-treasuries check gains
`commission:proposal` (out) + `commission:refund` (in); a NEW **commission escrow** check: live
deposits == posted − refunded − forfeited.

**The levy** — the Commission tax, the chamber's first decree with financial teeth, built as a PURE
REDIRECT (zero new money): a fifth decree `the_levy` — while in force, the 12h buyback's existing
family split (50% of bought $OMR, normally pro-rata to the top-25 by LIFETIME standing) pays **the
seated chamber instead** — the five seated families, weighted 5..1 (the seat-weight formula). ONE
touchpoint (`worker.js runBuyback` reads `activeDecree`); the flow, amounts, and §10.4 posture are
byte-identical to the signed split — only WHO collects changes, and only for the decree's week.
Politics finally pays — and the chamber seats are the seasonal (econ-pass) formula, so the levy
can't be parked on with lifetime wealth.

## C. THE LOAN HOUSE — the backed NPC lender (Shylock step five)

The audits' standing rule: an always-available house lender that MINTS cash to lend is a net
inflation faucet on default. So the house lends **only what it holds** — the stake-pool/full-reserve
pattern on the cash side:

**The pool** (`loan_house` singleton): sink-fed — `LOAN.HOUSE_VIG_BPS` (5000 = half) of every loan
vig now routes to the house window instead of the buyback pool (`loan:house:vig`, NULL row), plus a
mod route (`POST /v1/mod/loanhouse/fund`) moves confiscation-pool cash in (`loan:house:fund`, NULL —
the bucket-transfer pattern). Interest on repaid house loans stays in the pool — good loans GROW the
window. **The house can never lend more than the pool holds** (`pool` gate at take) — a default's
shortfall is bounded by what sinks already funded, never a mint.

**Borrowing** (`takeHouseLoan`, POST /v1/loans/house {amount}): the lender of last resort — always
open, no counterparty needed. Fixed terms, deliberately WORSE than the P2P market (the house takes
no risk it can't price): rate `HOUSE_RATE` (0.35), term `HOUSE_TERM_H` (24h), cap
`HOUSE_MAX_PER_LVL` ($2k) × level up to `HOUSE_MAX` ($50k). Gates: welsher-blocked, one active house
loan, jailed, level ≥ `HOUSE_MIN_LVL` (3), pool coverage. The row is a normal `loans` row with
`is_house=true, lender_character=NULL`. Cash: pool → borrower, ledgered `loan:house:take`
(character_id'd — check (a) reconciles the borrower).

**Repay** (`repayHouseLoan`, POST /v1/loans/house/repay): borrower pays `owed = principal×(1+rate)`
→ the POOL (`loan:house:repay`, character_id'd) — no vig carve (the interest IS the house's take).

**Default**: the worker sweep auto-collects overdue house loans — seize pocket + in-transit up to
owed → the pool (`loan:house:seize`), the standard welsher + WANTED machinery (the house is the one
lender that always enforces), shortfall eaten by the pool. No leg-breaking hospitalization (no
collector character) — the WANTED pursuit is the teeth.

§10.4: all four reasons ride the existing `loan:` cash prefix (zero vocab change); a NEW
**loan house pool** check: `pool == fund + vig + repay + seize − take` (every flow ledgered). The
house is extraction-safe by construction: lends ≤ pool, pool fed only by sinks.

## D. Casino step five — RING POKER + THE BRACKET

**Ring poker** — true multi-way hold'em with betting streets, built on the `blackjack_hands`
stateful precedent + one structural idea that makes it atomic-architecture-native: **the table is an
escrow. Cash moves ONLY at sit-down and cash-out.** Stacks, bets, and pots live in table/seat rows —
so no action ever locks another player's character row (no multi-party lock graph at all; the pot
pays the winner's SEAT STACK, realized as cash when they leave).

- `poker_tables` (id, stakes `bb`, status, hand state: street/deck/board/pot/current_bet,
  acting_seat, act_deadline) + `poker_ring_seats` (table_id, seat, character_id, stack, hole,
  in_hand, bet_street, acted). A player OPENS a table at the den (picks the big blind from
  `RING.BLINDS`), others SIT with a buy-in `[RING.BUYIN_MIN_BB, BUYIN_MAX_BB] × bb` —
  `casino:ring:sit`, a cash sink into escrow. LEAVE cashes the stack out (`casino:ring:leave`,
  faucet from escrow); leaving mid-hand folds you first (your street bets stay in the pot).
- A HAND deals when ≥2 seated stacks and no hand live (any seated player pokes `deal`): blinds post,
  hole cards deal (each seat sees ONLY its own — the board endpoint redacts), then streets
  (preflop → flop → turn → river) of check/call/bet/raise/fold in seat order. **Raises are capped at
  the smallest live stack** (table-stakes simplified — everyone can always call, so NO SIDE POTS; the
  one honest simplification that keeps the state machine exact). `act_deadline` (RING.TURN_MS 90s)
  bounds every turn: a stalled actor is AUTO-FOLDED by the next player's action or the worker sweep —
  the table never wedges.
- Showdown: best-5-of-7 (the audited evaluator), ties split. RAKE (`RING.RAKE_BPS` 3%, capped
  `RAKE_CAP_BB`) carved from the pot — half → street tax, half burns (`casino:ring:take`, NULL) —
  the audited casino:pvp split; the rest to the winner's STACK.
- Death: a dead player's seat folds + their stack BURNS (`casino:ring:death`, NULL — the dead-funder
  precedent, in runEstate). Idle tables (empty or stale past `RING.IDLE_MS`) are swept — remaining
  stacks cash out to their owners (`casino:ring:leave`).
- §10.4: `casino:ring:*` rides the `casino:` prefix (zero vocab change; NOT under the den-book
  `casino:bet:%`/`casino:win:%` LIKE patterns, so the PvE house book never sees ring money). A NEW
  **ring poker escrow** check: Σ live stacks + live pots == sit − leave − take − death.

**The bracket** — the multi-table elimination tournament, on the EXISTING `poker_tournaments`
machinery (same buy-in escrow, same `casino:tourney:*` reasons → the escrow check is UNTOUCHED):
`POST /v1/casino/tournament {bracket:true}` materializes the open tournament in bracket format
(one-open-at-a-time preserved; the format locks at materialization). After registration closes the
worker runs it in ROUNDS: entrants shuffle into HEATS of `BRACKET.HEAT_SIZE` (6); each heat deals
every live runner an independent 7-card hand (the audited draw), ranks, and the top
`BRACKET.ADVANCE` (2) advance; `BRACKET.ROUND_MS` (10min) between rounds (the spectacle — the board
shows the bracket live); the FINAL heat's ranking pays `TOURNEY.PAYOUTS` renormalized net of the
same 5% rake. Dead runners scratch (stake burns, the existing rule). Eliminated ≠ refunded — the
buy-in bought the seat (the pooled-lottery posture, now with rounds you can sweat). Still
chance-based (server-dealt hands — the den's honest note applies); the SKILL game is the ring table.

Levers: `CASINO.RING.*` (blinds, buy-in bounds, rake, turn/idle clocks), `CASINO.BRACKET.*`
(heat size, advance, round pacing). `RING_TURN_MS`/`BRACKET_ROUND_MS` env are TEST-ONLY knobs.

---

**Build order:** A (self-contained) → B → C → D. Each drop: schema → rules tail → module →
routes/console → tests → suite + sim. One combined red-team over all four at the end
(AUDIT-deep-deferred.md), BALANCE.md lever tables, codex sections.
