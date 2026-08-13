# OMERTÀ Risk-to-Earn — Phase 2: The Vig (detailed design)

**Status: DRAFT / proposal. Nothing built.** Parent: `omerta-risk-to-earn-design.md`.
This is the sustainability engine — the piece that makes "a player can earn a small living"
both *real* and *incapable of collapsing like Axie*. If Phase 1 makes risk *feel* rewarded,
Phase 2 is where earned $OMR becomes real money, safely.

Read this in one sentence first: **real money comes in as ETH from spenders → a fixed share
buys $OMR on the open market → that bought $OMR is the only thing players can ever withdraw →
so total extraction can never exceed the money that came in.** Everything below is the detail of
that sentence and how we enforce the last clause in code.

---

## 1. The single invariant everything serves

> **Cumulative $OMR that players can withdraw ≤ cumulative $OMR the Vig bought with real revenue.**

This is the anti-death-spiral rule, and Phase 2's whole job is to make it *structurally true* —
not a policy we promise, but a thing the code cannot violate. We already have the enforcement
primitive: OMERTÀ's withdrawal rail (`src/chain.js`) is a **full-reserve queue** — a voucher is
signed only if `signedOutstanding + amount ≤ funded_omr`, else it's queued (debited in-game,
unsigned, no double-spend). Today `funded_omr` is topped up by a **team charity** endpoint
(`POST /v1/mod/reserve/fund`). Phase 2 changes exactly one thing: **`funded_omr` is topped up
*only* by the Vig's revenue-funded buybacks.** Once the only source of the reserve is
revenue-bought $OMR, "extraction ≤ inflow" holds by construction — you cannot withdraw $OMR the
Vig never bought, because the queue won't sign it.

That is the elegant core: we don't build a new safety mechanism, we **re-source the existing
one from real revenue instead of the team's pocket.**

---

## 2. The value flow (plain language)

```
                         REAL ETH (from spenders)
        mint 0.01 · respawn 0.10 · cosmetics · battle-pass · rent · convenience
                                    │
                          OmertaFees splits on-chain
                          ┌─────────┴─────────┐
                     dev share            Vig share            (e.g. 40% / 60%, tunable)
                   (the business)      (the Vig wallet, a Safe)
                                             │
                                   Buyback bot (periodic)
                                   swaps ETH → $OMR on the real DEX (TWAP, slippage-capped)
                                             │  real buy pressure on the token
                              ┌──────────────┴──────────────┐
                    Withdrawal reserve                 Season prize pool        (e.g. 50% / 50%, tunable)
              (tops funded_omr in VoucherClaim)   (paid to leaderboards at rollover)
                              │                                │
                    baseline extraction:              competitive extraction:
                    anyone who earned $OMR             top families / hitmen / traders
                    can withdraw up to the cap         (steep curve — risk & skill only)
                              │                                │
                              └──────────────┬─────────────────┘
                                   Players hold hard $OMR (ERC-20)
                                             │
                                   sell on the DEX for ETH/USDC  ← sell pressure
                                             │
                                        A LIVING (bounded, skill-gated)
```

Net token-price effect = buy pressure (Vig buybacks) − sell pressure (extractors cashing out).
When spend > extraction the token is supported; when extraction > spend it softens **and the
withdrawal queue lengthens**, which is the honest market signal (see §6). We enforce the safety
math; we do **not** promise appreciation (that stays out of all messaging — legal, §9).

---

## 3. The Vig mechanism, component by component

### 3.1 On-chain: fee splitting
Today `OmertaFees.sol` forwards 100% of each fee straight to the dev wallet. Phase 2 changes it
to **split on-chain, trustlessly**: `payMintFee()` / `payRespawnFee()` (and the new fee
functions) send `vigBps` to the Vig wallet and the remainder to the dev wallet, in the same tx,
emitting both legs with the monotonic nonce it already has. The contract still custodies nothing
and mints nothing — it's a metered splitter now instead of a metered forwarder. `vigBps` is
Safe-owned and settable. The Vig wallet is its own Safe.

### 3.2 The buyback bot (the piece M6 already has pending)
A periodic job (the "buyback bot" listed as pending in M6-B) that, per run:
1. Reads the Vig wallet's uncommitted ETH balance.
2. Swaps a bounded slice ETH → $OMR on the real EVM DEX — **TWAP-priced, slippage-capped, small
   per-run** (anti-manipulation, §6).
3. Sends the bought $OMR to two sinks by the reserve/prize split: `fundReserve()` on
   `VoucherClaim` (raising `funded_omr`) and the prize-pool address.
4. Records the execution (ETH spent, $OMR bought, price) to the Vig ledger (§4).

This is the **exact same pattern as the in-game buyback** (`worker.js:runBuyback`: street-tax
cash → buys $OMR off the in-game AMM → splits to families + event fund). Phase 2 mirrors it one
layer up: real ETH → buys $OMR off the *real* DEX → splits to *reserve + prizes*. Same shape,
proven, just sourced from real revenue.

### 3.3 Backend accounting — `src/vig.js` (new, isolated like `chain.js`)
The Vig service's only job is **accounting and enforcing the invariant.** Its DB writes are
confined to new tables: `vig_revenue` (every fee split leg, from the fee watcher), `vig_buyback`
(every bot execution), `vig_prize_pool` (accrual + payouts). It does **not** touch the §10.4
in-game ledger — real ETH is out-of-band value, exactly as `fees.js` established (zero
`transactions` rows for ETH). It exposes read models for the withdrawal gate and the invariant
job, and the season prize distribution.

### 3.4 Retire the team-charity funding
`POST /v1/mod/reserve/fund` is **repurposed**: it becomes the buyback-bot's authenticated deposit
path (or is replaced by the bot calling `fundReserve()` on-chain and the watcher recording it).
Either way, **no path tops the reserve except revenue.** That deletion is what makes the
invariant airtight.

---

## 4. Enforcing "extraction ≤ inflow" — the second §10.4

We add a **real-value invariant job**, sibling to the ledger invariants, run nightly by the
worker and on demand via a mod route. It reconciles three cumulative quantities from the Vig
tables + chain state:

- `revenueIn` = Σ Vig-share ETH received (from `vig_revenue`).
- `omrBought` = Σ $OMR the bot bought (from `vig_buyback`), and `ethSpentBuying` ≤ `revenueIn`
  (the bot can never deploy more than came in — a hard check, not a target).
- `reserveFunded` = Σ $OMR ever added to `funded_omr` (from chain events) — must equal the
  reserve-split portion of `omrBought`.
- `extracted` = Σ $OMR ever signed out as withdrawal vouchers (`Claimed` events) +
  prize payouts.

**The invariant:** `extracted ≤ reserveFunded + prizePaid ≤ omrBought`, and `ethSpentBuying ≤
revenueIn`. Any drift is the loudest possible alarm — a real-money leak, not a game-balance one.
Because the withdrawal queue already refuses to sign beyond `funded_omr`, the *first* inequality
holds live, per transaction; the nightly job proves the whole chain end-to-end and catches a
buggy bot or a mis-set split before it matters.

This is the same discipline as §10.4, applied to real value: **value transfers, it is never
minted — now at the ETH↔$OMR boundary too.**

---

## 5. The PLEX bridge — pay in ETH *or* $OMR

EVE's masterstroke, and the thing that lets a skilled player fund their play from earnings.

> **AS BUILT (2026-08-11), two corrections to this section.** (1) **Not every cost** — the MINT is
> ETH only. It is the Sybil bound and the extraction gate, and a fee payable two ways is always
> priced by the cheaper rail, so the bound gets one price. The respawn and every Store package do
> take $OMR. **The line is the BOUND, not the denomination.** (2) **The $OMR does not BURN, it
> RECYCLES** — since economy-v3 step 2 `plex:%` is in `DESK.SINK_REASONS`, so a PLEX payment lands
> on the desk shelf and is sold for ETH at the daily auction (the founder's revenue-over-deflation
> decision). So the deflation claim below is history; the revenue claim replaces it, and it is the
> stronger one. (3) The *fantasy* in this section's first line is measured and does not currently
> hold — sim **P9.35**: the whole earn surface is 1,320 lifetime + 3/day against a 4,118 cheapest
> purchase, so the rail is reached by PREDATION or PURCHASE rather than by grinding. On-theme for
> this game, but it is not EVE's economics and should not be described as if it were.

Every real-money cost except the mint — respawn, cosmetics, rent, convenience — is payable
**either way**:

- **Pay in ETH** → the OmertaFees split (§3.1): part to the Vig (funds everyone's extraction),
  part to dev. This is the whale / newcomer path — real money in.
- **Pay in $OMR** → the $OMR is **burned** (a sink; ledgered `plex:*`, added to `invariants.js`).
  This is the skilled-player path: you cover your own costs from what you earned instead of
  cashing out, and every such payment *removes supply* (deflationary, offsets emission).

Why both directions are healthy for the token:
- ETH payers create **buy pressure** (Vig buyback).
- $OMR payers create **burn** (supply reduction).
- A player who earns more $OMR than their costs **nets positive and extracts the surplus**; one
  who earns less **spends ETH to keep playing.** Both fund the system. This is precisely how a
  top EVE player pays their subscription in ISK while a casual pays cash — *the spender subsidizes
  the earner*, and the bridge is what connects them.

Implementation: each fee route gains a `pay: 'eth' | 'omr'` branch. The ETH branch is the
existing on-chain flow (now split); the $OMR branch is an in-game burn through the existing
`spendOmr` till pattern, gated on balance, ledgered.

---

## 6. Who earns, and how much — the prize pool + the curve

The Vig funds **two kinds of extraction**, and the split between them is the main "feel" lever:

- **Baseline (the withdrawal reserve).** Anyone who earned in-game $OMR can withdraw up to the
  live cap. This is the floor — steady, available to all, funded by the reserve share. It answers
  "can I cash out what I earned?" → yes, as fast as revenue backs it.
- **Competitive (the season prize pool).** Paid at season rollover to the **leaderboards** — top
  families by standing/territory, top hitmen by rep, top traders by volume, war victors. This is
  where the *living* is made, and its curve is deliberately **steep**: the top slice earns real
  money, the median earns little. This is the EVE reality — the dedicated, skilled, risk-taking
  fraction earns; the many play for fun and spend. **The "small living" must stay small and
  skill-gated or the math doesn't close** (parent doc §5).

Distribution runs in the existing **season rollover** job (`worker.js`), extended to read the
prize pool and pay the ranked leaderboards as withdrawal-reserve credits (so prizes flow through
the same audited rail, never a side-channel).

---

## 7. New revenue sources (what whales buy — and the rule they obey)

The Vig is only as big as real spend, so Phase 2 wants more things worth buying — **for status,
convenience, or PLEX-fair power, never sim-breaking power.** Candidates (each its own sign-off):

- **Cosmetics for ETH** — the M8 vanity/seal catalog gains an ETH path (the $OMR path still burns).
  Pure status; already built, just add the rail.
- **Season battle-pass** — a cosmetic + convenience track, ETH or $OMR.
- **Territory rent** — families pay to hold premium districts (ETH to Vig *or* $OMR burn); non-
  payment risks the turf. A revenue source *and* a recurring sink *and* a risk (Pillar 4 overlap).
- **Convenience** — extra character slots, cooldown reductions, cosmetic loadout saves.
- **The mint/respawn fees themselves** — already live; now split to the Vig.

**The hard rule (the PLEX principle):** anything that confers gameplay power must *also be
earnable in-game with $OMR/effort*, so a whale buys *time*, not an unbeatable edge. Anything that
can't satisfy that stays cosmetic/convenience. This keeps the sim-audited balance intact and keeps
the game fair — the whale funds the earner, they don't out-gun them.

---

## 8. Build plan (concrete, grafts onto existing code)

Ordered; each step shippable + testable (extend the suite, success + gate paths). Contract work is
isolated behind flags exactly like M6-B was.

1. **Contracts:** modify `OmertaFees.sol` to split fees (dev / Vig) on-chain; add the new fee
   functions (cosmetic/rent/pass) mirroring the metered-tollbooth pattern. Foundry tests for the
   split math, the Vig destination, and the monotonic nonce. *(No new mint authority; still
   custodies nothing.)*
2. **`src/vig.js`** — the accounting service + tables (`vig_revenue`, `vig_buyback`,
   `vig_prize_pool`). Records fee splits from the extended fee watcher; exposes the read models.
3. **Buyback bot** — the periodic ETH→$OMR job (worker or standalone), TWAP + slippage-capped,
   funding the reserve + prize pool; records executions to `vig_buyback`.
4. **Re-source the reserve** — `funded_omr` fed only by the bot; retire/repurpose
   `POST /v1/mod/reserve/fund`.
5. **The real-value invariant** (`src/invariants.js` sibling) — the §4 reconciliation; nightly in
   the worker + `GET /v1/mod/vig`.
6. **PLEX bridge** — `pay: eth|omr` on every fee route; the $OMR branch burns via `spendOmr`,
   ledgered `plex:*`, vocabulary extended.
7. **Prize distribution** — extend season rollover to pay the leaderboards from the prize pool
   through the withdrawal rail.
8. **New revenue routes** — cosmetics-for-ETH, battle-pass, rent (each sign-off-gated).

Everything on-chain stays **dormant unless the chain env is configured** (the M6 pattern), so the
game runs full off-chain in tests and alpha; the Vig activates only when wired to a real DEX +
Safes on mainnet.

---

## 9. Failure modes and controls

| Risk | What happens | Control |
|---|---|---|
| **Bank run** (everyone extracts at once) | Withdrawal queue lengthens; waits grow | By design — the full-reserve queue is FIFO and bounded by `funded_omr`. No insolvency, ever; you wait, you don't lose. |
| **Revenue collapse** (spend stops) | Buyback stops → reserve stops growing → queue freezes | Extraction pauses; **nobody loses their in-game $OMR** (they hold it). Game continues as a game; extraction resumes when revenue does. No team liability. |
| **DEX price manipulation** (crash price to distort buyback) | Bot could over/under-buy | TWAP pricing, per-run slippage + size caps, small frequent runs not one big one. |
| **Sybil / bot extraction farms** | Many fake accounts draining the pool | The **mint gate is the anti-sybil tax** — 0.01 ETH real per extraction-capable account, and that ETH *funds the Vig*. Plus agent-flag exclusions, rate limits, the steep prize curve (bots can't top leaderboards cheaply). |
| **In-game $OMR over-emission** (staking mints faster than revenue backs) | Queue grows pathologically; soft-$OMR loses cash value on the in-game AMM | The queue absorbs it honestly, but this is why **Phase 4 (backed emission) should follow Phase 2** — it reins in the faucet so the queue stays sane. Noted as the key dependency. |
| **A §10.4 or Vig-invariant leak** | Now a *real-money* leak, not just a balance bug | The nightly Vig invariant (§4) + the existing §10.4 job; both must be green before mainnet, and the audit discipline becomes existential (parent §5). |

---

## 10. The numbers (all levers — founder sim + sign-off)

- **Vig share of fees** (`vigBps`) — e.g. 60% Vig / 40% dev. The bigger the Vig, the more players
  earn and the thinner the business; the balance point depends on your cost base.
- **Reserve / prize split** — e.g. 50/50. More to reserve = smoother baseline extraction; more to
  prizes = steeper, more competitive earning.
- **Buyback cadence + per-run size/slippage caps** — frequency vs price impact.
- **Prize curve** — how steep (winner-take-most vs spread). Steep = healthier math, harsher feel.
- **New fee prices** — cosmetics, pass, rent, convenience.
- **Payout ratio headroom** — deploy < 100% of received revenue per period so the reserve carries a
  buffer against a revenue dip mid-season.

---

## 11. What must precede mainnet (non-negotiable)

1. **Launch review** (parent §5) — real-money earning + a token is a regulated-product question spanning
   gambling exposure that varies by jurisdiction and may gate which users you can serve. Highest
   priority; before any real extraction goes live.
2. **Third-party audit** of the modified `OmertaFees`, the buyback bot, and the signer — the M6
   contracts were compiled clean but `forge test` was never run in-session; that plus a real audit.
3. **Phase 4 backed-emission** should land close behind, so in-game emission can't outrun the Vig
   and bloat the queue (§9).
4. **Both invariant jobs green** on real infra — §10.4 and the Vig invariant — as a mainnet gate.

---

## 12. Bottom line

Phase 2 turns earned $OMR into a real, bounded, sustainable living by re-sourcing the existing
withdrawal reserve from **spender revenue instead of team charity**, and enforcing "extraction ≤
inflow" *by construction* through the queue we already have. The PLEX bridge lets skilled players
fund their play from earnings while whales fund the pool with cash — the spender subsidizes the
earner, EVE-style. It cannot Axie-collapse, because it can only pay out money that came in; when
revenue dips, extraction slows, it doesn't default. The costs are real (legal, audit, the
discipline of a real-money economy) and every number is yours to set — but the architecture is
sound and grafts cleanly onto the chain rail OMERTÀ already has.
