# OMERTÀ — The Value-Creation Pivot ("The Street Wage")

**Founder directive (2026-07-23):** *"We want the game to create value as well, to the point where
2nd and 3rd world nations play this as a side hustle. Redesign all economic principles based upon
this new info."*

This document is the new economic constitution. It replaces the old main rule and explains, in
plain language, what changes, what stays, why each piece is shaped the way it is, and where the
honest limits are.

---

## 1. The old rule, and what it actually was

The old rule was: **"the game moves value; the game never creates value."**

That sentence bundled two different things:

1. **The accounting layer (§10.4).** Every unit of every currency is written to a ledger, and a
   nightly job proves every balance reconciles against enumerated faucets and sinks. This is an
   anti-fraud tool. It does not care whether value is created — it cares that nothing moves
   *unaccounted*.
2. **The policy layer ("extraction ≤ inflow").** Real-money extraction was bounded by real-money
   inflow: the full-reserve withdrawal queue could only sign what spender revenue (the Vig) had
   funded. This is what made the game "never create value" in the real sense.

**The pivot changes the policy layer. The accounting layer stays exactly as it is** — it is the
thing that lets us pay strangers in developing nations and prove, to them and to ourselves, that
the books are honest.

## 2. The new constitution

> **The game creates value on a fixed, transparent, decaying schedule — and real revenue
> amplifies it. Every created unit is ledgered, capped by a hard endowment, and earned by
> measurable play, never by chance.**

Five principles:

**P1 — The Endowment.** A fixed tranche of the (already fixed-supply) $OMR token is set aside as
the **Emission Endowment** (`EMISSION.ENDOWMENT_OMR`). This is the total the game may ever create
for players. On-chain it is a real token tranche held by the Safe; in-game it is enforced by a
§10.4 invariant (`emission within endowment`). Like Bitcoin's block rewards: fixed total,
scheduled release, no discretion.

**P2 — The Schedule.** Each day (an *epoch*) releases at most `epochBudget(epoch)` $OMR — a
day-one budget that **halves** every `DECAY_EVERY` epochs. Early players earn the most (the growth
subsidy); the printer provably winds down, so the economy MUST transition to revenue-carried
payouts — by design, not by crisis. The budget is a **ceiling, not an obligation**: what isn't
earned isn't minted, and the endowment lasts longer.

**P3 — Earned, never given.** The wage pays **measured play**: respect gained during the epoch,
pro-rata from the epoch budget, with a per-account cap. Respect gain costs energy (regen-limited),
requires a level floor, and a minimum score — so a login-bot earns nothing, a Sybil farm pays a
real grind cost per account, and agents (who have their own economy) are excluded like every other
anti-Sybil faucet. **No chance, no lottery** — this keeps the "never distribute value by chance"
posture that protects the RWA/legal architecture.

**P4 — Revenue amplifies.** The existing Vig machinery is unchanged and now sits ON TOP of the
endowment: spender revenue (Store, fees, bonds) still buys hard $OMR into the reserve and prize
pools. The endowment is the wage **floor**; revenue is the **upside**. The generalized invariant:
`extraction ≤ endowment released + revenue inflow`. The old invariant is a special case of the new
one, and every existing check keeps running.

**P5 — Ledgered, always.** The wage is an enumerated §10.4 mint (`emission:wage` — in the reason
vocabulary and in the $OMR mint term), so the conservation sweep stays drift-0 and any unbudgeted
emission is the loudest possible alarm. Two new invariant checks: lifetime emission ≤ the
endowment; and per-epoch emission ≤ the epoch budget (enforced at pay time, checked in tests).

## 3. Why this shape (the Axie lesson)

Axie Infinity paid players from an **unbacked, uncapped printed token** (SLP). Supply grew with
players; demand didn't; the token collapsed and the Filipino players it was a side hustle for were
hurt worst. The failure was not "play-to-earn" — it was **elastic supply with no schedule and no
cap**.

EVE, OSRS, and Tibia run durable earn-economies because value is scarce and demand is real. The
Street Wage copies the durable parts:

- **Fixed endowment + halvings** → supply is inelastic and known in advance by everyone.
- **Budget is a ceiling** → player growth dilutes the per-player wage instead of inflating supply
  (more players ≠ more printing — the opposite of Axie).
- **Revenue-carried endgame** → as halvings shrink the subsidy, the Vig (real spender money)
  becomes the dominant payout source. The schedule forces the transition while the endowment funds
  the runway.

**The honest limit (must be said plainly):** a game cannot pay out more *real* money than real
money coming in, forever. The endowment creates real earning power only while there is demand for
$OMR — from spenders (Store/fees/PLEX), from the buyback, and from the market. The wage
manufactures the SUPPLY side of a player economy; the business must keep building the DEMAND side
(revenue surfaces, liquidity, players who buy). The design makes the runway long and the wind-down
graceful; it does not repeal arithmetic.

## 4. What ships in each phase

**E1 — BUILT (this drop, off-chain):** the `EMISSION` rules block, the `wage_snapshots` table, the
worker's daily `runWageEpoch` (per-character txn discipline, idempotent per epoch, crash-resumable
with pre-computed shares), `GET /v1/wage` (the public board: epoch, budget, your progress, gates),
the `/v1/rules` emission block (the schedule is public — transparency is the product), the §10.4
vocabulary/mint/endowment-check wiring, the console card on Going Legit, and `test/emission.js`.

**E2 — chain wiring (mainnet-gated, with the rest of the chain track):** the endowment as a real
Safe-held tranche; a scheduled release that calls `fundReserve` for exactly the $OMR emitted
in-game, so wages are extractable 1:1 through the existing full-reserve queue; the Vig invariant
gains an `endowment_funded` term so backed-by-endowment reserve is recognized as legitimate.
Nothing here needs new contracts — it is operations on the existing rails.

**E3 — the side-hustle surface (product work, ranked):** low minimum withdrawal (small earners
must be able to cash out); fee-sponsored (or batched) claims so gas never eats a day's wage —
Robinhood Chain/Arbitrum Orbit fees are already cents; localization of the console + wiki;
regional payment/liquidity partners; and a "wage history" statement view (people budgeting on this
need records). KYC/geo posture unchanged from the RWA rules — counsel-gated where required.

## 5. The numbers (ALL founder sign-off levers, sim before production)

| Lever | Default | Meaning |
|---|---|---|
| `ENDOWMENT_OMR` | 1,000,000 | lifetime emission ceiling (mirror it as the on-chain tranche in E2) |
| `EPOCH_OMR` | 500 | day-one daily budget (a ceiling) |
| `DECAY` / `DECAY_EVERY` | 0.5 / 180 | halve the budget every ~6 months |
| `WAGE_CAP_OMR` | 5 | max wage per account per epoch (spreads the budget; anti-concentration) |
| `WAGE_MIN_LVL` | 5 | level floor (the npcHit/WANTED anti-Sybil precedent) |
| `WAGE_MIN_SCORE` | 25 | respect gained in the epoch must clear this — real play, not a login |

Sizing note: 500/day at the cap of 5 supports ≥100 earners/day at the full cap on day one; at
$OMR's eventual market price the founder should re-derive "what a day's grind pays" per region and
retune `EPOCH_OMR`/`WAGE_CAP_OMR` before launch marketing ever mentions earning. Lifetime at the
day-one rate: 1,000,000 ÷ 500 ≈ 2,000 epochs ≈ 5.5 years of runway *minimum* (halvings + unspent
ceilings extend it).

## 6. What explicitly does NOT change

- §10.4 accounting, the sim, every escrow check — untouched (three new terms, zero removed).
- The full-reserve withdrawal queue and "no unbacked signing" — untouched (E2 *feeds* it).
- Cash-economy balance (BALANCE.md signed levers) — untouched; the wage pays $OMR, not cash.
- No-chance distribution, agent exclusions, level floors — extended to the wage, not weakened.
- **Marketing discipline (legal):** no earnings promises, no income claims, no price talk. The
  schedule may be described factually ("a fixed, public emission schedule pays active players in
  $OMR"). "Side hustle" language stays OUT of official copy until counsel clears it — payments to
  players at scale can trigger money-transmission/employment/securities questions by jurisdiction.
  Recorded here as a Sensitive flag, per the standing counsel-approval directive.

## 7. Open design options (deferred, founder-ranked)

- **Contribution mix:** v1 scores respect-gain only (simple, energy-bounded, unfakeable-cheaply).
  Later: blend in ledgered economic activity (taxes paid, den volume, tribute) with per-source
  caps — richer, but every added source is a new farming surface to red-team.
- **Regional boost pools:** a per-region multiplier is deliberately NOT designed — region signals
  (IP/geo) are trivially spoofed and would turn the wage into a VPN arbitrage. If regional equity
  is wanted, do it on the DEMAND side (regional pricing on Store SKUs), not the wage.
- **Streak bonuses / wage ranks:** a status ladder over lifetime wages (the legend precedent) —
  pure status, cheap to add, drives retention.
- **The family wage:** a cut of member wages to the treasury (the tribute pattern) — makes
  families recruit active players in earn-regions. Needs sim for treasury-inflation interplay.

---

## 8. The tax map (founder-directed addendum, 2026-07-23)

Every layer of the economy carries a toll, and every toll routes to the dev wallet, the buybacks,
or both. The complete map:

| Boundary | Tax | Where it goes |
|---|---|---|
| In-game P2P transfers (bodyguard, speakeasy, casino PvP, market, boxing, races, loans…) | ~2% takes | half → the street-tax pool → **the 12h buyback**; half burns (deflation) |
| ETH Store purchases | 100% of the price | **40% dev / 40% buyback (Vig) / 20% RWA reserve** (`STORE.SPLIT_BPS`) |
| ETH gameplay fees (mint / respawn / re-roll) | 100% of the fee | dev wallet in-tx; the Vig share routes to **buybacks** |
| Bonds | the discount is the cost | **50% POL (liquidity) / 20% dev wallet / 30% Vig (buybacks)** — the three-way split is immutable in the contract |
| **Early exits (NEW — the anti-dump surcharge)** | $OMR younger than 48h | an extra toll at BOTH exits (AMM sell + withdrawal): **50% at age 0, linear to 0% at 48h, no exemptions**, split 50% dev / 50% buybacks |
| **$OMR withdrawal (NEW — the Exit Toll)** | `WITHDRAW_TAX_BPS` 2% of the gross | **50% → the dev fund** (`tax:dev`, claimable by the founder) / **50% → the buyback/yield pool** (`tax:buyback` → stake_pool — the pool the 12h buyback funds) |

Exit-toll mechanics: the player is debited the gross; the voucher signs the NET; both toll shares
are ledgered §10.4 TRANSFERS into audited buckets (dev_fund + stake_pool — conservation nets 0);
the toll is non-refundable (a cancelled queued withdrawal refunds the net only). The founder claims
the dev fund with `POST /v1/mod/dev/claim` (a bucket transfer, never a mint) and then withdraws
like any player — paying the toll like anyone. Deliberately NOT a fee-on-transfer token: taxing
inside the ERC-20 breaks DEXes and composability; taxing at the GAME boundary catches every earner
exactly once, with none of that damage.

**Early-exit mechanics (the anti-dump surcharge):** the ledger is the lot table — every $OMR credit
already carries a timestamp, so token age is derived by an exact FIFO replay of the account's ledger
window (credits append lots; debits consume oldest-first; the opening balance is an aged lot). No new
tables, and nothing a player can forge. An on-chain wallet version was rejected deliberately: it is
dodged by wallet-hopping or requires a fee-on-transfer token (breaks DEXes, reads as a honeypot). At
the game boundary every token passes exactly once. Accepted seam: stake→unstake is bucket-internal
(no ledger rows), so a round-trip re-enters as aged — throttled by its own 6h loot-exposed unbonding;
the dials are UNSTAKE_CD_MS or ledgering the release if the alpha shows dump-washing through staking.
