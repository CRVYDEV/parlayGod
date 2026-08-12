# The hook's buy side — anti-snipe, surge fees, and the liquidity league

**Status:** design, and BUILT (anti-snipe + surge; the liquidity league is deferred with a reason).
Prompted by [hookr.fun](https://hookr.fun/), a token launchpad with a composable v4 hook builder that
shipped on **Robinhood Chain 4663** — our chain — on 2026-08-11. We cannot use their hook (a `PoolKey`
holds exactly one, and ours funds dev/treasury/LP), but their five blocks are a menu of **buy-side**
mechanics, and ours has none:

```solidity
// OmertaHook.sol
if (params.zeroForOne != zeroIsOmr) return (feeCurrency, 0); // BUYS ARE FREE
```

This doc decides what the buy side should do, and why two of their five belong here, two do not, and
one belongs in the backend rather than the contract.

---

## 0. Why this is timely rather than merely interesting

Three facts, each checked against the tree rather than remembered:

1. **`beforeSwap` and the fee-override return slot are already mined into the hook's address.**
   `HOOK_FLAGS` carries `BEFORE_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG` and the header says why:
   *"reserved: the dynamic-fee override slot"*. A dynamic fee therefore needs **no re-mine and no new
   address** — the expensive, irreversible part of this was already paid for.

2. **The permission set is immutable and lives in the address.** A callback we do not mine now can
   never be added — it means a new hook and a full liquidity migration. We mined wide on purpose
   (design §2.2); this is that decision being cashed in.

3. **The hook is written, not deployed, and not audited.** Adding a block now costs its own review
   inside a batch that has to happen anyway. Adding it after costs a re-audit. There is no cheaper
   moment than this one and there will not be another.

## 1. The split that decides where each idea lives

The hook has an `observer` seam (fail-safe, gas-stipended) and the backend already runs a chain
watcher. So:

| lives in | can do | costs |
|---|---|---|
| the **hook** | fees, caps, on-chain payouts | audit surface, gas on every swap, immutable forever |
| the **backend** | status, leagues, city events, in-game rewards | nothing — no contract change at all |

Anything whose output is a *status* or a *game event* should not be in the contract. That single
line disposes of more of the menu than any economic argument does.

## 2. The five blocks, decided

### 2.1 Anti-Snipe — ADOPT (BUILT). It closes a real hole.

The launch sequence argues that nobody can dump at the bell because the 120h bond vest outlasts the
72h window. **That is an argument about bonders.** It says nothing about someone who buys the pool in
block 0 and sits on it. Genesis price equals LP init price by design (no arb gap), so the first buyer
captures the entire early move and our only defence is the 9% sell tax — which they will happily pay
on a fill nobody else could get.

Three teeth, all bounded to a window of `antiSnipeBlocks` after pool initialization:

- **a size cap** on each buy (`antiSnipeMaxBuy`, in quote terms),
- **an extra fee** on buys (`antiSnipeBuyBps`), lands in the same three-way sweep book as the tax,
- **exact-output buys refused outright** (`SnipeExactOutput`) — the detail worth stealing, because
  otherwise the cap is circumvented by specifying the output and letting the router compute the input.

**This is the only thing in this document that can REVERT a swap**, and the hook's header is
explicit that *"a hook that can revert `beforeSwap` can halt a public market"* and *"there is no
pause, and there must not be"*. That objection is answered by construction rather than by promise:

> `MAX_ANTISNIPE_BLOCKS` is a **compile-time constant** (200), so the longest halt this contract can
> express is fixed at deploy and a compromised Safe cannot extend it. The window is counted from
> `openedAt` (written once in `afterInitialize`, never updated), which is in the past and cannot be
> moved. The rule is therefore self-disabling: after N blocks the branch is dead for the life of the
> pool. Pinned by `test_arming_the_window_late_cannot_rearm_an_already_open_pool`.

That is a materially different object from a pause. A pause is *"the owner may stop the market"*;
this is *"for N blocks after birth, buys above a size are refused."* Bounded, non-renewable, and it
expires without anyone acting. **Sells are never refused** (a window that blocks exits is a honeypot —
the thing `MAX_SELL_TAX_BPS` exists to forbid; `test_sells_are_NEVER_refused_by_the_window`).

**Build note worth keeping:** the exact-output refusal is load-bearing ONLY when no size cap is set.
With a cap, `uint256(-amountSpecified)` for an exact-output amount underflows to a huge number and
`SnipeTooLarge` catches it anyway — so a mutation removing the refusal still reverts in that regime,
and the regression MUST test cap==0 or it cannot tell the refusal is doing anything. The first cut
tested the wrong regime and a mutation survived.

### 2.2 Surge Fees — ADOPT (BUILT). Best value-per-risk.

Their version scales the LP fee with how much of in-range depth a trade consumes. **We scale with
PRICE IMPACT instead**, and the reason is that our own harness already identified impact as the damage
metric:

> `tools/bond-dials.js`: the daily bond cap is *"sized so a full day at the cap moves the price by at
> most ~10% if it is all dumped — the damage metric that matters, since a griefer need not profit"* …
> *"'% of supply' is the WRONG anchor and would have suggested a cap ~4x too large."*

The entire bond safety wall (`dailyCapOMR`) is sized on price impact against depth. A fee that scales
with impact therefore taxes **exactly the behaviour the wall exists to bound**, and it does so
automatically as depth changes — which matters because the harness's own instruction is to
*"re-derive it whenever POL materially deepens"*, i.e. the static number goes stale and this does not.

**Impact is measured, not modelled**: record `sqrtPriceX96` in `beforeSwap` (transient storage — this
is per-swap scratch, not state), read it again in `afterSwap` via `_sellRate`, and scale the rate from
the base to a Safe-set ceiling (`surgeMaxBps`) as impact runs from zero to `surgeFullBps`. No oracle,
no liquidity math — just the price the pool itself moved to, so nothing for a manipulated feed to
loosen.

Two constraints that are not negotiable, both asserted:

- **`MAX_SELL_TAX_BPS` (1000) still binds the ceiling.** The surge is a *rate within the existing
  cap*, never an escape from it (`test_the_surge_ceiling_cannot_exceed_the_anti_rug_cap`).
- **Do not ship it in the same change as a base-rate move** (design §2.4). Retune and migrate together
  and neither can be measured afterwards.

One pleasant side effect: our stated operating rule `DISCOUNT_BPS < sellTaxBps` (a bond must be a
hold, not an arbitrage — design §9.6) only gets *safer*, because the effective rate can now exceed
the base but never fall below it.

### 2.3 LP Rewards — ADOPT THE STATUS HALF, in the backend, and it is free. DEFERRED.

The strategic case is the strongest of the five, and it is already quantified:

> `tools/bond-dials.js`: *"the binding constraint is pool depth and that will change"* … *"the
> strongest action available for these walls is POL, not a setting."*

Depth raises the honest bond cap (~5% of the pool's OMR reserve) and lowers impact on every trade.
Attracting **external** liquidity is therefore not a vanity metric — it directly raises how much
bonding the protocol can safely do.

But the on-chain half is where in-range LP rewards get eaten: paying in-range LPs *within the swap*
is the classic JIT target — add liquidity immediately before a large trade, collect, remove. Without
time-weighting it pays mercenaries rather than depth. **That is a question for hookr, not a thing to
copy blind.**

The half that works needs no contract at all, because **we already shipped the ladder**:
`BONDS.BACKER_TIERS` (Depositor → Patron → Underwriter → …), `backerTierOf`, `underwriterScore`, the
Underwriters' League and THE FINANCIER crown. Extend `underwriterScore` to count LP depth-over-time
and an external liquidity provider becomes a named figure in the city with a rank on a board. Pure
status, the hitman-rep precedent: no token flow, no payout, no securities surface.

**Deliberately not built yet, and the reason is honest:** it reads LP positions off a pool that does
not exist. Building the reader against nothing means guessing at the shape. It follows the pool (the
`bankPosition` dormant-reader pattern), and it is the first thing to build once a pool is live.

### 2.4 Auto Burn — DECLINE. Our own design already answered this.

Sending a share of buy output to the dead address contradicts a signed decision twice. Economy v3
step 2 chose **recycle over burn** — every sink routes to the desk, which resells it for ETH; the
founder picked revenue over deflation deliberately.

The tempting variant — send it to the desk's shelf rather than to `0xdead` — is worse than it looks,
and it is worse for the exact reason this hook exists: a buy-side fee taken **in OMR** reintroduces the
reflexivity the v4 migration was built to kill (the ERC-20 tax collected OMR while every consumer
needs ETH, so realising it meant selling, which is pressure on the pool being taxed). Clean no.

### 2.5 Nth-buy Pot — DECLINE the paying version. Take the free one.

It is *literally the Numbers*, which the Den already runs as a daily 600:1 draw. Thematically it is
the best fit on the list. Mechanically it is a prize for trading, and that runs into three walls:

1. **The gambling layer is CASH ONLY, never $OMR** — the stated regulatory line for the whole Den. A
   pot paying ETH to the Nth buyer of the token is a prize attached to a financial instrument.
2. **It pays for wash trading** — buying repeatedly to reach N manufactures the one metric that is
   supposed to tell us the pool is real, and our fee revenue scales with volume, so we'd be taxing
   volume we paid to create.
3. It would be a new counsel row on a memo whose existing rows are still being cleared.

**The free version is good and costs nothing:** the counter is public and we already watch the chain,
so the Nth buy fires a **city event** — the numbers came in, on the streets feed, no payout, no
qualifying act, no surface. It makes the DEX legible inside the fiction, which is the only part of
this idea that was ever really about OMERTÀ.

## 3. What this deliberately does not decide

**The permanent buy-side rate.** `omerta-v4-hook-design.md:584` records a founder confirmation
("one hook four slices") in which *"the D1 buy-side trade fee (30 bps, 100% → vig) joins as its own
rate"*. The contract implements the sell tax's three slices and no permanent buy rate.

Anti-snipe needs a buy fee **only inside its window**, so it is built as exactly that — a windowed
rate, not a permanent one. This is on purpose: a permanent buy tax with a fourth (vig) slice changes
`Owed`, `sweep`, the events, and the lockstep with `OMR.sol`, and it is an economic surface rather
than a safety one. It should be decided on its own merits, not smuggled in behind a launch guard.

It does, however, share the audit. **If the four-slice buy rate is wanted, decide it before the batch
goes out** — a second buy-side change on an immutable contract is a second audit.

## 4. Levers this introduces

All Safe-set, all defaulting to **off**, all bounded by a compile-time constant that the Safe cannot
raise. `surgeMaxBps = 0` and `antiSnipeBlocks = 0` each revert this contract to exactly today's
behaviour, which is the property that makes them safe to ship armed at zero and arm later.

| lever | default | hard cap | what it does |
|---|---|---|---|
| `antiSnipeBlocks` | 0 (off) | `MAX_ANTISNIPE_BLOCKS` (200) | length of the opening window, in blocks |
| `antiSnipeBuyBps` | 0 | `MAX_SELL_TAX_BPS` | extra fee on buys inside the window |
| `antiSnipeMaxBuy` | 0 (uncapped) | — | largest single buy inside the window, in quote |
| `surgeMaxBps` | 0 (off) | `MAX_SELL_TAX_BPS` | the ceiling impact can drive the rate to |
| `surgeFullBps` | — | — | price impact at which the ceiling is reached |

## 5. Order of work

1. **The contract** — anti-snipe + surge, with the compile-time caps, plus Foundry tests covering
   every revert and both fuzzed bounds. ✅ BUILT (forge 213/213).
2. **The city event** — the backend watches swaps and fires "the numbers came in". Free, no contract.
   Deferred (needs a live pool to watch).
3. **The liquidity league** — extend `underwriterScore` with LP depth-time once a pool exists.
   Deferred with a reason (§2.3).
4. **Open, needs a decision before the audit batch** — the permanent four-slice buy rate (§3).

## 6. What must survive, and is asserted by test

Carried forward from `omerta-contracts/CLAUDE.md` rule 7, because every one of them is a way this
change could go wrong:

- the fee **accrues**; `sweep` pushes. No in-tx forward — one reverting recipient would brick the pool.
- **`beforeInitialize`'s pool gate stays.** It is what makes every event this contract emits mean
  something, and the surge/anti-snipe events inherit that credibility.
- **no pause.** Anti-snipe's revert is bounded by a compile-time constant and expires on its own;
  nothing else added here can refuse a swap.
- `MAX_SELL_TAX_BPS` binds the surge ceiling. The anti-rug wall is not routed around.
- the observer stays fail-safe and gas-stipended.
- `DISCOUNT_BPS < sellTaxBps` still holds — and surge only widens the margin.
