# THE TABLE — OMERTÀ's economy, v3

*Founder-directed 2026-08-01. Supersedes `omerta-value-creation-design.md`, `omerta-tokenomics-v2-design.md`,
`omerta-phase*-design.md` and the emission half of `omerta-risk-to-earn-design.md`.*

**Founder's four answers, which fix the shape:** (1) **band** — two-sided, never both at once;
(2) **ETH mainnet**; (3) **the Street Wage dies entirely**; (4) **OMR is an in-game consumable, and
the only viable extraction is killing other players and taking theirs.**

---

## 0. The model in one sentence

> **You buy chips, you play, the house rakes, and the only way to leave with more than you brought
> is to take it off somebody else.**

OMR is not a currency with a supply. It is **inventory in a rental business**: the desk sells it,
the game consumes it, it comes home, the desk sells it again. Revenue is bounded by **velocity**, not
by supply.

**There is no faucet. Nothing in the game pays OMR to anyone, ever.** OMR enters the world only when
a player buys it, moves only when a player takes it from another player, and leaves only into a sink
— which returns it to the desk to be sold again.

---

## 1. What dies, what survives

The demolition is smaller than "erase the tokenomics", because most of what exists is accounting
plumbing rather than the model.

| dies | survives, load-bearing |
|---|---|
| the Street Wage (`emission.js`, the endowment, halvings, the epoch budget) | §10.4 conservation, the ledger, `invariants.js` — the accounting spine |
| the Exchange window (OMR → cash at a fixed rate) | the full-reserve discipline (and it gets *easier* — see §2) |
| the stake pool, the family yield, `stake:reward` | `OmertaBond` — already mints OMR for ETH with a configurable split |
| burn-as-sink (~25 reasons) → becomes **recycle** | `OmrTwapOracle` — fail-closed, and now the band's anchor |
| the Vig's four-way split, `vig_revenue`, the prize pool | `OmertaFees` — the tollbooth, repointed |
| the RWA/treasury vault (already retired) | `GearVault` (ERC-1155) → the rarity-NFT rail |
| PLEX-as-alternative-payment (it becomes the *point*) | all nine harnesses; the deposit/withdraw voucher rail |

**Nothing is deleted until the replacement is built and green.** The kill order is in §9.

---

## 2. The four walls

Every one of these is *checkable*, which is the only kind of promise worth making.

1. **No faucet.** Zero `omrMints` reasons that pay a player. The only mint is `OmertaBond`, and it
   mints only against ETH received in the same transaction.
2. **The desk never sells inventory it does not hold.** Already the `committedOMR ≤ balanceOf`
   discipline in `OmertaBond`.
3. **Extraction ≤ deposits − sinks, automatically.** With no faucet, in-game OMR can never exceed
   what was deposited. The full-reserve queue stops being a constraint we enforce and becomes an
   identity we observe. *This is a large simplification and a large trust win.*
4. **The buyback is funded only by realized ETH revenue.** Never by minting. This is the single line
   separating this design from Olympus.

---

## 3. THE DESK — primary issuance and the band

### 3.1 The daily auction

A **Dutch auction**, once a day, of a fixed quantity: yesterday's returned inventory.

Descending from a ceiling toward a **reserve price**. Elegantly, this means **the auction *is* the
band on the sell side** — set the reserve at the band floor and unsold inventory simply rolls to
tomorrow. No separate "should we bond today?" logic, and the price is discovered rather than guessed.

ETH proceeds split **50 / 50 → POL / founder** (founder's spec; `OmertaBond` already does a
configurable split, so this is a constants change).

### 3.2 The band, and why it is not optional

The bond and the buyback are opposites: one spends OMR to get ETH, the other spends ETH to get OMR.
Run both at once and you buy at market, sell at a discount, and pay gas for the privilege — a losing
round trip wearing a flywheel costume.

| price vs anchor | the desk does |
|---|---|
| above `UPPER` | **sells** — the Dutch auction clears |
| between | **nothing** |
| below `LOWER` | **buys** — while the buyback budget lasts |

Anchor = the `OmrTwapOracle` 30-day TWAP (built, fail-closed, and audited). Defaults, all sign-off
levers: `UPPER = 1.00×`, `LOWER = 0.85×`.

**We never promise a floor.** The buyback is bounded by its budget, and saying otherwise converts a
market operation into a liability.

### 3.3 Where bought OMR goes

To **inventory**, not the fire. The buyback is the desk restocking from the open market when that is
cheaper than waiting for the sinks.

### 3.4 Reflexivity, the healthy kind

| | the loop | its anchor |
|---|---|---|
| **ours** | price ↑ → each unit of inventory fetches more ETH → more revenue → more buyback budget | **revenue.** Real ETH, realized, external |
| **Olympus** | price ↑ → higher APY → more buyers → price ↑ | **itself** |

Ours has something outside it. That is the whole difference, and walls 1 and 4 are what keep it true.

---

## 4. THE FLOOR — the in-game economy

### 4.1 Movement

OMR moves exactly three ways:

1. **in** — a player deposits what they bought;
2. **sideways** — one player takes it from another (PvP: the fire-kill loot, the shank, the Sacking);
3. **out** — a sink consumes it → **the desk's inventory**.

There is no fourth. Strictly zero-sum among players, minus the rake.

### 4.2 The rake is the sinks

Every OMR sink is the house's cut. Which makes the revenue equation almost embarrassingly simple:

> **annual revenue ≈ annual OMR sink volume × OMR price**

and the KPI that matters is **RETURN VELOCITY** — sink volume ÷ circulating float, i.e. *how many
times a year one OMR comes home*. Not supply. Velocity. Every design decision below should be judged
against it.

### 4.3 What OMR buys — and what it must never buy

The alpha tester's complaint (*"I don't enjoy pay to win"*) is the binding constraint here, and it
is also correct. The resolution is the one RuneScape and EVE both landed on:

> **OMR buys TIME, ACCESS and STATUS. It never buys POWER.**

Everything a payer gets is reachable by playing. Paying skips the grind. Combined with §4.1, a
skilled free player accumulates OMR by *taking it from payers* — which is exactly the EVE/Albion
loop, and the honest version of "free-to-play."

---

## 5. THE HOLDING PROBLEM — the crux

**A consumable you should never hold cannot be the loot that makes killing worth it.** If the
rational play is buy-and-spend-instantly, nobody carries a balance, there is nothing on the body,
and the founder's only extraction path is empty. Forcing a **float** is therefore the central
mechanic of this design, not a detail.

Three mechanisms, all reusing shipped systems. Recommend all three.

### (i) THE NUT — recurring obligations denominated in OMR
Estate staff, family dues, business protection, crew wages. The *premium tier* of each moves from
cash to OMR. You must carry a float to keep your operation running; miss it and things go cold.
**This is the strongest,** because it creates *continuous* demand (revenue) rather than one-off
demand, and the cold/thaw mechanics are already built and audited (the pad, the nut, territory
upkeep).

### (ii) THE CLEARING WINDOW — deposits are exposed
Deposited OMR "clears" over `CLEAR_MS` (24h), lootable at a **higher** rate while it does. The act of
bringing money in is itself the risk. The shape exists: bank in-transit, unstake unbonding.

**And this is the same mechanic as the bond's vest.** Olympus vested bonds to stop instant
re-selling; our auction clears near spot, so there is no arbitrage to prevent and a vest would be
pure friction — *except* that a vest is exactly the exposure window §5 needs. So make them one
thing: **bonded OMR arrives vesting, the vest is the clearing window, and the clearing window is
when it can be taken off you.** One mechanic doing three jobs — anti-dump, float creation, and the
loot that makes the founder's extraction path exist.

### (iii) THE STAKE — access requires a HELD balance, not a spend
The high-stakes room, a Commission seat, running a Syndicate: *hold* N OMR, don't spend it. A
permanent, visible, lootable float attached to exactly the players worth hunting.

### And the loot rate goes up
`OMR_LOOT_RATE` 0.20 was sized when the wage was the main source. As the *only* source it is too
low — five kills to break even on a purchase, assuming you can even find a holder. Proposal:
**0.50 of unprotected OMR**, with protection expensive, temporary and daily-capped (the safehouse
cap L3b and the Sacking already do this work). Sign-off lever; sim it.

---

## 6. THE HOOK — Uniswap v4 on mainnet

`afterSwap` takes a fee **in ETH**, **asymmetric** (heavier on sells), deployed as protocol-owned
liquidity. Because the LP is ours, its trading fees are a *third* ETH revenue line that compounds.

Two honest limits:

- **A hook taxes only its own pool.** Anyone can open an untaxed v4/v3/v2 pool. Mitigations: keep POL
  concentrated so the taxed pool has the depth (liquidity is the moat), and keep the **ERC-20
  backstop tax** that already exists, armed at zero.
- **Mainnet gas is a real UX cost.** Set a minimum bond size so gas is a small percentage, use
  `permit` to avoid approvals, and keep the in-game balance off-chain so only boundary crossings cost
  anything. A $20 purchase does not survive mainnet; a 0.05 ETH one does.

---

## 7. THE ASSETS — rarity NFTs

Cars, boats and assets carry on-chain rarity: **common / rare / legendary / epic**. ERC-721 (or 1155
by kind), tradeable on OpenSea for ETH.

**Two things this buys that are bigger than they look.** Royalties are a fourth ETH line — and more
importantly, **a player can earn ETH without ever touching OMR**, which de-risks the token
enormously. If rare items are *minted or upgraded with OMR*, then ETH-denominated NFT buyers create
OMR demand indirectly. That is the bridge between the two markets.

**Sell deterministic, drop random.** Rarity is rolled server-side and `rng_audit`'d when an item is
*earned* in play. ETH only ever buys a *known* item. Selling random-trait NFTs for money is a loot
box and is genuinely contested in the EU/UK — this line costs us nothing and removes the question.

**Lootable or safe? Both, and the player chooses.** Extend the existing gear precedent exactly:

> **in-game items are lootable; extracted NFTs are safe but inert.**

Use it and risk it, or own it and display it. That preserves EVE's destruction engine — *the real
lesson of EVE is not PLEX, it is that ships die permanently* — while still giving a real NFT market.

---

## 8. Three players

- **The payer.** Buys OMR at the daily auction, skips grind, runs a premium operation on the nut.
  Carries a float, which makes them a target. Their money funds POL, founder revenue and the buyback.
- **The hunter.** Buys nothing. Hunts float-carriers, takes their OMR, sells it into the pool. This
  is the *only* extraction path and it is a skill.
- **The builder.** Buys nothing. Earns rarity NFTs by playing and sells them for ETH on the secondary
  market — the ETH earn path that never touches OMR at all.

The design fails if any of the three has nothing to do.

---

## 9. Migration — the order that keeps the lights on

Each step is shippable and testable alone; nothing is deleted before its replacement is green.

1. **Kill the faucet.** Retire `emission.js` and the wage. §10.4 gets *simpler* — `omrMints` shrinks
   to the bond alone. Wall 1 becomes assertable immediately.
2. **Recycle instead of burn.** Reclassify the ~25 sink reasons: destination `bond_inventory` rather
   than the burn term. One invariant change; the conservation identity gains a bucket.
3. **The daily auction.** Dutch, reserve-priced at the band floor, over the existing bond contract.
4. **The band + buyback.** Off the existing oracle. Budgeted, never promised.
5. **The float** (§5) — the nut, the clearing window, the stake. Re-sim the loot rate here.
6. **The v4 hook** — mainnet, asymmetric, POL-funding.
7. **The rarity NFTs** — extend `GearVault`'s pattern to cars/boats/assets.

Steps 6 and 7 touch contracts and therefore reset the third-party audit clock. Steps 1–5 are
off-chain and gated on nothing.

---

## 10. Risks, on the record

**A. This is a real-money competition with a rake — a GAMBLING question, not the securities question
we have been managing.** Players buy in with ETH, compete against each other under RNG, the house
takes a cut, and they cash out. In some jurisdictions that is gambling regardless of the skill
ratio; in others the skill ratio decides, and our combat has meaningful RNG. The founder's standing
"assume counsel approved the architecture" directive predates this category. **This one needs its own
opinion before launch, and it is the highest-stakes open item in the document.**

**B. Recycling means supply never falls.** You cannot burn *and* recycle the same unit — burn
supports price, recycle produces revenue. We chose revenue. The pitch changes from "deflationary" to
"high-velocity" and must never be marketed as the former.

**C. 50% of primary issuance as founder revenue is the first thing anyone forensic will compute.**
Not a legal problem, an optics one. Vesting that half costs nothing long-run and removes the "exit"
read entirely.

**D. No faucet means f2p has no OMR income.** Their path is NFT drops and hunting. I think that is
*better* than a wage — but it means the game needs payers to be worth playing free, which needs
population. Below some player count the hunter has nobody to hunt.

**E. The LP is the exit, and its depth is the real constraint.** The protocol never pays ETH out —
a player extracting sells OMR *into the pool*, so POL is the release valve. With no faucet the float
is small by construction, so thin liquidity plus a taxed pool means price moves on small volume, and
sustained extraction drains ETH from the pool rather than from us. **POL depth is therefore not a
nice-to-have; it is the number that decides how much extraction the system can absorb before the
price stops meaning anything.** That is the whole reason the tax exists and why 50% of bond ETH goes
to POL rather than to founder.

**F. Why buy from the desk when the DEX exists?** The honest answer is **size without slippage** —
a whale taking 5% of a thin float moves the pool badly; the auction gives them a known price for
size. That is a real product, but it means the desk's customer is the large buyer, and the auction
should be sized and scheduled for them rather than for retail.

---

## 11. Open decisions

1. **Loot rate** (§5) — 0.50 of unprotected OMR is the proposal. Sim first.
2. **How much of the nut moves to OMR** — this is the demand dial and therefore the revenue dial. Too
   little and the desk has no customers; too much and it reads pay-to-win.
3. **Does founder revenue vest?** (risk C)
4. **Minimum bond size** — sets who can participate on mainnet gas.
5. **Is the Commission/high-stakes STAKE (§5 iii) held on-chain or in-game?** In-game is lootable,
   which is the point; on-chain is safer and therefore weaker.
