# The severance — the migration plan for tokenomics v2 step 2

*Written 2026-07-27, before any code. The parent design (`omerta-tokenomics-v2-design.md`) says
"the Exchange replaces the AMM" and stops there. Tracing what that sentence actually costs turned up
a dependency it does not account for, which is why this document exists.*

---

## 1. What we already know, measured

`tools/sim.js` P9.22 (this session) measured the window's absorption against the game's emission:

| | |
|---|---|
| street take (the window's funding), measured off a driven population | **$35/player/day** — population-invariant, and a floor |
| reaches the window at `FUND_BPS` 30% | $10.50/player/day |
| absorbable at `RATE` 500 | **0.021 $OMR/player/day** |
| the wage emits, base-wide and fixed | **500 $OMR/day** |
| players needed for the window to clear it | **~23,800** (~2,400 even at 10× a scripted player's take) |

Two conclusions carried forward:

- **The window is a relief valve, not the exit.** $OMR's real exit is the sink catalog (~13.7 $OMR/day
  recurring for a heavy player, against a wage sized for ~100 max earners) and, for real value, the
  reserve-backed chain withdrawal. As sized the window will read as permanently `dry`.
- **`EXCHANGE.DAILY_CAP_OMR` never binds.** 250 $OMR/day is ~12,000× what one player's activity funds.
  The pool binds first, always.

`EXCHANGE.RATE` 500 is not arbitrary: the genesis AMM is seeded 10,000,000 cash / 20,000 $OMR, an
implied spot of exactly **$500/$OMR**. The rate was set at genesis parity. The interlock exists
because trading moves spot away from it — below 500 the window becomes a money pump.

---

## 2. The dependency the plan missed

`runBuyback` acquires $OMR **by trading against `amm_pool`**, and five things are denominated in what
it buys. Retiring the AMM does not just remove a trading venue; it removes the only mechanism by which
cash sinks become $OMR.

| downstream of the buyback | denominated in | survives severance? |
|---|---|---|
| `stake_pool` (Phase 4 backed emission) | `bought` — $OMR | **no** |
| the weekly family split by standing | `bought` — $OMR | **no** |
| `fundFamilyYield` (tokenomics v2) | `bought` — $OMR | **no** |
| protocol-owned LP carve (`AMM_LP_BPS`) | cash → the AMM | **no** (moot — it feeds the thing being retired) |
| `carveExchange` (the window's own funding) | `tax.pool` — **cash** | **yes, economically** — but its call site is inside `runBuyback` |

Three consequences worth stating plainly:

**(a) Staking breaks, and it breaks in the direction that matters.** Phase 4 exists specifically to make
`stake:reward` a *transfer* rather than a mint — it is paid from `stake_pool`, and the buyback is that
pool's only funder. Sever the AMM and the pool stops refilling: staking yield throttles to `dry`
permanently. The principal still returns whole (it was never pool-gated), so nothing is stolen, but the
14%-APY-ceiling promise becomes 0% with no code change and no announcement.

**(b) The family yield — built last session — is already on the wrong side of this.** I funded it from
`bought`. It dies with the AMM exactly like the split it was meant to replace. That is my error and it
is caught here rather than mid-migration.

**(c) `amm_pool.omr_reserve` is a §10.4 bucket** (`invariants.js:195`). It holds real $OMR inside the
conservation set. "Retire the AMM" therefore cannot mean *delete the row* — that $OMR has to be moved
somewhere named, in a ledgered or bucket-to-bucket way, or `$OMR conservation` drifts on the day of the
migration.

### What is NOT affected — verified, not assumed

- **The whole Vig rail.** `runVigBuyback` prices off `priceOmrPerEth` passed in (mainnet: the external
  DEX TWAP), never `amm_pool`. So the **withdrawal reserve, the prize pool, and PLEX quoting all survive
  the severance untouched.** This is the load-bearing good news: the real-value exit does not depend on
  the in-game AMM at all.
- Bonds, the Store, the RWA float — all ETH-denominated, all independent.

---

## 3. The architecture this implies

The severance inverts the direction value flows between the two currencies.

```
TODAY      cash sinks ──▶ buyback buys $OMR off the AMM ──▶ distributed as $OMR (stakers, families)
AFTER      cash sinks ──▶ the Exchange pool (cash) ──▶ $OMR holders BURN to claim cash
```

That is a real improvement — it is deflationary where the old loop was circulatory — but it means the
single sentence the plan turns on is:

> **After severance there is no market mechanism to turn cash into $OMR. So every $OMR-denominated
> distribution must be fed from emission, from bonds, or retired.**

There are only two $OMR faucets left: the wage (endowment-bounded, 500/day, already spoken for) and
bonds (ETH-funded, mainnet-gated). Neither can carry staking yield or a family bonus.

### The proposal: make staking a claim on the window, not a source of more tokens

Rather than find a new $OMR faucet for staking — there isn't one that doesn't reintroduce a mint —
**restate what staking pays.** Staked $OMR earns *priority and headroom at the Exchange window* rather
than more $OMR:

- a larger personal share of the daily pool (staking raises your slice, so the cap stops being decorative
  and starts being the thing staking buys);
- and/or queue priority when the pool is thin, which it structurally will be.

This is coherent with the inversion: post-severance the value of holding $OMR *is* redeemability, so the
reward for locking it should be better redeemability. It needs **no new faucet, no mint, and no new §10.4
bucket** — it is a change to how an existing cash pool is allocated. `stake_pool` then winds down rather
than being refilled.

The same logic re-points the family yield: fund it in **cash to the treasury from the Exchange pool**,
not $OMR to the reserve. It stops depending on `bought` and starts depending on the sinks, which is where
the design says value should come from.

*(This is a proposal, not a decision. The alternative — retire staking outright — is simpler and
defensible, and is called out in §5.)*

---

## 4. Migration order, with the §10.4 consequence of each step

Ordered so the economy is never half-migrated: nothing is switched off before its replacement is live.

| # | step | §10.4 consequence |
|---|---|---|
| 1 | Re-point `fundFamilyYield` off `bought` and onto the cash Exchange pool | none — a cash pool split, no new reason |
| 2 | Decide + build what staking pays (§3 proposal or retirement) | none if it is pool allocation; a retirement needs the pending-rewards question answered |
| 3 | Move `carveExchange`'s call site out of `runBuyback` into its own worker step | none — same cash, same reason |
| 4 | Retire the laundering surface (`business.js` launder, wash cap, launder heat, the Launderer legend) | none — those are gates on a path being removed, not value movements |
| 5 | Retire `swap` **buy**. This is the severance proper | none directly; the AMM stops receiving cash |
| 6 | **Open the window** (`EXCHANGE.OPEN true`) — the interlock is satisfied only now | the window's own checks already hold |
| 7 | Retire `swap` **sell** + the LP carve | none |
| 8 | Drain `amm_pool.omr_reserve` to a named destination and retire the pool | **the one real §10.4 event.** Bucket-to-bucket (e.g. → `stake_pool` to fund the wind-down) conserves and needs no ledger row; a burn needs an enumerated reason in `omrBurns`. Either is fine — *silently dropping the row is not* |
| 9 | Re-sim: P9.22, the passive stack, the wash-cap and kill-EV probes are all stated against the old threat model | sweep must stay drift-0 throughout |

Steps 1–3 are safe to do immediately and unblock the rest. Step 6 is the payoff. Step 8 is the one that
needs care.

---

## 5. Founder decisions this needs

Nothing below is retuned or decided here (ground rule #1).

1. **What does staking pay after severance?** The §3 proposal (a claim on the window) or retirement. This
   is the biggest one — it changes what a currently-live mechanic means.
2. **Is the window a relief valve or a real exit?** Measured, it is a valve. If it is meant to be an exit,
   `FUND_BPS` and `RATE` have to move a long way — and note a **lower** `RATE` serves more $OMR per pool
   dollar. If it is meant to be a valve, the console should say so, or `dry` reads as broken.
3. **Where does the AMM's $OMR reserve go?** Transfer (conserves) or burn (deflationary). Both are clean;
   the choice is economic.
4. **Does the laundering surface come back in another form?** Retiring it removes a whole gameplay texture
   — heat, districts, the Accountant spec, the Launderer legend and leaderboard — that exists to make
   extraction prep risky. If extraction prep no longer exists, so does the reason for it, but that is
   content being deleted and should be a deliberate call.
5. **`MEGAPROJECT.OMR_RATE` is also 500.** Once the AMM is gone, `EXCHANGE.RATE` is the only in-game
   cash↔$OMR price. Decide whether these two are deliberately pinned together or free to drift.

---

## 6. Recommendation

Do steps 1–3 now: they are small, they carry no §10.4 consequence, and they remove the dependency that
would otherwise be discovered mid-migration. Then take decision (1) — what staking pays — because steps
4–8 are cheap once it is answered and blocked until it is.

Do not open the window before step 5. The interlock is not a formality: while `swap` buy is live and spot
sits below `RATE`, the window is a money pump, and `test/tokenomics.js` asserts this pairing so the suite
fails rather than the economy.
