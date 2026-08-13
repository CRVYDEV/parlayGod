# DNR pool hook — LP rewards, self-repaying leverage, and the peg (design only)

**Status: DESIGN ONLY. Nothing here is built, nothing touches launch.** This is the repo's
discipline (design → red-team → build), applied to a founder question: *can we add LP Rewards and
Leverage to a hook, and synthesise them with the Denari (DNR) self-repaying loan system?*

The honest answer, up front, so the reasoning below can be checked against it:

- **LP Rewards on the DNR pool: YES.** A fee-funded, no-mint redistribution that deepens the exact
  liquidity the stablecoin needs to hold its peg. Safe, valuable, self-contained.
- **Self-repaying looping leverage: PROBABLY NOT — and if ever, much later, heavily gated.** It is
  the *safe kind* of leverage (no oracle, no liquidation, native to the Bank), but it concentrates
  all the danger in one place: it manufactures the DNR supply that stresses the peg, using the same
  reflexivity that funds the rewards. For a *game* stablecoin, the risk/reward is poor.
- **The hook style for the DNR pool: a fee-taking redistribution hook** (the OmertaHook family), NOT
  a listen-only hook (the Unipeg family). The synthesis needs the hook to route fees; Unipeg's
  "takes nothing from the pool" style is right for NFT-art state and wrong here.

This doc exists to make those three calls defensible, not to greenlight a build.

---

## 1. The two leverages, and why only one is on the table

The earlier "no" on leverage was correct for the leverage the founder first meant (the Hookr /
generic kind): **borrow against collateral, price moves against you, a `liquidate()` seizes your
position.** That requires an oracle and a liquidation engine — the exact two things THE BANK
deliberately does not have (`Alchemist.sol:24` — *"there is no price at which a user is
liquidated"*). Bolting it on un-does the Bank's central safety claim. Still a hard no.

But connecting leverage to the *loan* system points at a different mechanism entirely, and this is
the part worth taking seriously:

**Self-repaying looping.** Deposit yield-bearing collateral → mint DNR up to `MAX_LTV_BPS` (90%) →
swap DNR for more collateral → deposit again → repeat. Alchemix calls this a leveraged self-repaying
position. Every iteration is **still non-liquidatable**, because the Bank's safety does not come
from a price feed — it comes from **denomination matching** (`Transmuter.sol:18` — the collateral
behind DNR is the *same unit* as the debt, so there is no price leg to move). The debt only ever
falls, from yield. Looping amplifies *how much yield exposure* you have, and therefore how fast the
position self-repays, without introducing a liquidation price.

So the founder's instinct was right: leverage *can* exist here in a form that carries none of the
blow-up risk of the kind we rejected. The question is not "is it possible" (it is) but "is it wise
for THIS token" — and that is where the critical work is.

## 2. The synthesis, drawn honestly

The pieces reinforce each other. That is the appeal, and — read carefully — also the risk.

```
  LP Rewards ──► deeper DNR pool ──► cheaper looping (less slippage per loop)
       ▲                                        │
       │                                        ▼
  hook fee ◄────  swap volume  ◄──────  more looping
       │
       └──► a slice to the Transmuter buffer (strengthens the peg floor)
```

- **One hook on the DNR/underlying pool** charges a swap fee — the OmertaHook machinery, reused. All
  **redistribution, never a mint.** It splits the fee two ways: a depth×time reward to LPs, and a
  slice into the Transmuter buffer (`bufferHealthy()` — the reserve that gates DNR issuance).
- **LP Rewards** pull liquidity → the pool deepens → each loop costs less slippage.
- **The leverage loop generates the swap volume** that funds both the rewards and the buffer.

The flywheel is **self-funding**: the volume pays for the depth that enables the volume, with no
emission propping it up. That property is genuinely good and is the reason the idea is not dismissed
outright — an emission-funded LP reward on a stablecoin is the classic death spiral, and this avoids
it by construction.

## 3. Why the leverage half is where I stop, and would counsel you to

Every self-reinforcing financial loop is also a self-reinforcing *unwind*, and a leveraged
stablecoin is the category where that unwind has ended protocols. Three specific, non-hand-wavy
reasons the looping half is dangerous even though each single position is liquidation-proof:

1. **Looping mints DNR supply faster than it repays it.** Each loop is a fresh `mint`. A book full
   of leveraged positions is a book that front-loaded DNR issuance relative to the yield flow that
   repays it. All that DNR eventually wants to be sold (to realise the leveraged yield or to exit) —
   which is structural, standing sell pressure on the peg. The Transmuter absorbs sell pressure
   *only while there is enough repayment/redemption flow to match it*, and leverage is precisely the
   thing that widens the gap between issuance and repayment. **The borrower being safe (no
   liquidation) and the peg holding ($1) are different claims** — leverage protects the first and
   strains the second.

2. **The reward funding and the peg risk are correlated, not independent.** The fee that funds LP
   rewards comes from looping volume. Looping volume is what stresses the peg. So in the exact
   scenario where you most need LPs to stay (peg wobbling), the reward stream that was holding them
   is drying up *and* their impermanent loss is spiking (a stable-stable pair's IL is ~0 while pegged
   and blows up off-peg). LP rewards are **pro-cyclical**: they hold in calm, flee in stress. Adding
   leverage makes the stress deeper and faster.

3. **The Bank's defences were sized for a flat book.** `MAX_LTV_BPS`, `mintPerBlockCap`,
   `mintPerDayCap`, and the buffer floor are strong — genuinely stronger than Terra, because there is
   real matched collateral behind every DNR. But they were reasoned about for players taking single
   self-repaying loans. A leveraged loop pushes all of them to their limit simultaneously. Before any
   leverage ships, every one of those numbers has to be **re-derived against a fully-leveraged worst
   case**, and a red-team has to *try to drain the buffer through a fast leveraged loop and fail.*
   That is not a code review; it is a modelling exercise on the highest-consequence surface in the
   whole system.

**The plain-language version for the founder:** the safe-leverage insight is real, but it turns your
game's convenience stablecoin into a leverage-amplified stablecoin, which is the single most
blow-up-prone product category in crypto. It mostly benefits sophisticated DeFi users, not your
game's players, and it buys "capital efficiency" the game does not need at the cost of the one risk
that can take the whole Bank down. **My recommendation is to build the safe, boring, valuable half
(LP Rewards) and to treat looping leverage as a separate decision you are allowed to simply decline.**

## 4. What I'd actually build (if/when the Bank goes live)

**Phase 1 — LP Rewards only, no leverage.** A DNR-pool hook that:
- takes a small swap fee (redistribution, no mint), split: most to LPs by **depth×time** (not a
  spot snapshot — depth×time can't be gamed by a flash-add before a big swap), a slice to the
  Transmuter buffer;
- carries the anti-snipe + surge blocks already written in OmertaHook, for the DNR pool's own
  opening;
- extends `underwriterScore` (the existing status axis) with LP depth-time, so providing DNR
  liquidity is *also* a game-legible reputation, not only a yield.

This is the whole of the safe, valuable idea. It deepens the peg the Bank needs regardless of
leverage, it is a pure redistribution inside the no-mint wall, and it adds no new blow-up surface.

**Phase 2 — leverage: a gate, not a build.** If it is ever revisited, it ships behind: the
re-derived caps of §3.3, a dedicated red-team whose brief is *break the peg through the loop*, a
per-account leverage cap far below the theoretical max, and — candidly — the human audit this doc's
whole §3 argues a leveraged stablecoin specifically needs. It is the one place "AI audit only" is
the wrong call.

## 5. The hook-style decision, resolved

v4 gives one hook per pool, so this is per-pool and there is no conflict:

| Pool | Hook | Style | Status |
|---|---|---|---|
| Canonical OMR/ETH | **OmertaHook** | fee-taking (dev/treasury/LP sell tax) | built, armed at zero |
| DNR / underlying | **a new fee-taking redistribution hook** | OmertaHook family — takes a fee, routes to LP rewards + buffer | design only, Phase 1 above |
| (hypothetical NFT-token pool) | Unipeg listen-only style | takes nothing, only updates state | **not applicable** — see the items doc |

The **best style for the DNR pool is the fee-taking redistribution hook**, because the synthesis's
whole value is the hook *routing* fees to fund depth. Unipeg's "no fee extraction, only listens"
style is correct for an NFT whose art is its trading history and wrong for a rewards engine. We
already own the fee-taking machinery; the DNR hook is a re-parameterisation of it, not new tech.

## 6. Open levers (when it becomes real, all founder sign-off)

- the DNR-pool swap fee (bps) and its LP/buffer split;
- the depth×time reward curve;
- whether leverage is ever enabled at all (§3's recommendation: no, or much later);
- if enabled: the per-account leverage cap and the re-derived buffer/mint caps.

**Nothing above is a launch item. The Bank itself is chain-dormant and behind the gates; this rides
on top of it.**
