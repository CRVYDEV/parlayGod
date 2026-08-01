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
| burn-as-sink (13 reason patterns in `omrBurns`) → becomes **recycle** | `OmrTwapOracle` — fail-closed, and now the band's anchor |
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
levers: `UPPER = 1.00×`, `LOWER = 0.80×` — the reasoning is in §11.6.

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

### (i) THE MADE MAN — a recurring subscription in OMR
A monthly OMR payment that buys **standing** (§11.2). This is the strongest of the three because it
creates *continuous* demand rather than one-off demand — which is the same thing as saying it is the
revenue engine.

**Note what this is NOT.** The first draft of this section proposed moving operating costs — business
upkeep, crew wages, territory upkeep — from cash to OMR. §11.2 rejects that: it would mean a player
*must* buy real money to keep earning, which is a subscription wall on the core loop rather than a
premium tier, and it contradicts §4.3 directly. **Operating costs stay in cash. All of them.**

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

1. **Kill the faucet — BUILT 2026-08-01.** `emission.js` is a tombstone, the rules block and its five
   levers are deleted, the worker tick is gone, and `/v1/wage` refuses with `retired` (the v2
   swap/launder precedent) rather than 404ing on a caller that has been polling it.
   *Correction to this line as originally written:* §10.4 does NOT shrink — `emission:%` **stays** in
   the vocabulary and in `omrMints`, because a live database holds the rows the wage already wrote and
   conservation is a claim about the whole ledger; drop the reason and every server that ever paid a
   wage drifts by exactly what it paid. What is new is the `emission faucet retired` check, which
   asserts no NEW row appears — wall 1 made checkable rather than promised. And `omrMints` does not
   reduce "to the bond alone" yet: `mission:%` and `prize:omr` survive into steps 2–4 with their own
   systems, which the check's comment says out loud rather than letting the doc imply otherwise.
2. **Recycle instead of burn — BUILT 2026-08-01.** A $OMR sink now hands the token to the desk
   (`desk_inventory`) instead of destroying it. Two corrections to this line as written:
   *(a)* the reasons are NOT reclassified — a wholesale reclassification would drift conservation on
   any live database by the entire historical burn volume, because those rows really were burns when
   they were written. Instead the sink keeps its reason and its place in the burn term, and a paired
   `desk:recycle` row rides the SAME term, so the two cancel while the new bucket holds the value.
   Historical rows have no partner and still count as the burns they were. *(b)* it is 24 reasons,
   not ~25, and one of them — `withdraw:omr` — is deliberately EXCLUDED: that token leaves for the
   chain rather than into the house, so recycling it would put the same unit in a player's wallet
   and on our shelf at once. The recycle hooks `game.js:ledger` rather than the ~60 sink call sites,
   because a recycle you have to remember is one a new sink will forget.
3. **The daily auction — BUILT 2026-08-01.** Dutch, once a day, reserve-priced at the band's SELL
   edge (`UPPER`, not the floor — the floor is where the buyback would BUY, and the line as written
   had the wrong edge). Four corrections/clarifications to this line as written:
   *(a)* the sale is a **TRANSFER, not an issuance**: the desk sells $OMR it already holds, so
   `desk_inventory` falls by exactly what the buyer's account rises by and both are inside
   `omrBuckets`. Conservation therefore needs no new mint or burn term and does not move — wall 2
   ("the desk never sells inventory it does not hold") holds by construction rather than assertion,
   because it is one clamped subtraction. The `desk:sale` row is written for auditability, and for
   the vest.
   *(b)* it is **NOT over the bond contract** off-chain. `OmertaBond` MINTS against ETH; the desk
   RECYCLES. Running the auction through the mint path would issue new supply alongside inventory
   that already exists, which is exactly the double-count wall 1 forbids. The fill arrives through
   an idempotent ingest (the Store/bond/sell-tax `ref` + `txHash` pattern), chain-dormant, with a
   mod/QA route that books ZERO ETH.
   *(c)* **the 48h vest needed no code.** A `desk:sale` credit is a positive $OMR row on the buyer's
   account, and `tax.js:earlySurcharge` replays exactly those as FIFO lots — so bought $OMR is
   already priced at the full early-exit surcharge decaying to zero over `FRESH_WINDOW_MS`, which is
   48h. §11.7's "one concept, one constant" was more literally true than it looked; the suite asserts
   it rather than assuming it.
   *(d)* the 1%-of-float cap needed a **bootstrap floor** (`FLOAT_CAP_MIN_OMR`): with a float of zero
   the cap is zero, so no auction opens, so nobody can buy, so the float stays zero. Also: the anchor
   is fail-closed on the oracle (no print or a stale one → no auction, and never a fallback price),
   and the shelf clamp — the third of wall 2's three bounds — is unreachable in today's code and is
   tested against a synthetic drain rather than left as an untested claim.
4. **The band + buyback — BUILT 2026-08-01.** Off the existing oracle, budgeted by POL trading fees
   exclusively, never promised. Three notes on this line as written:
   *(a)* `desk:buyback` is a **MINT**, and the doc should say so plainly rather than leaving it to be
   discovered: it is the **exact inverse of `withdraw:omr`** — an in-game mint into the SHELF paired
   with hard OMR entering the withdrawal reserve, where a withdrawal is an in-game burn paired with
   hard OMR leaving it. Supply exits one way and re-enters the other. Wall 1 survives because it
   credits the shelf and NEVER a player: nobody is paid, and the token only reaches a player by being
   bought at the auction for ETH.
   *(b)* the mint is admissible only to the extent the hard token arrived, and conservation cannot see
   that — so it is checked from three sides (the desk's books, the ledger, and the Vig's two-sided
   reserve sandwich, which now carries the desk's contribution BY NAME rather than being loosened).
   Both legs move in ONE transaction: the Vig funds the reserve post-commit and calls that gap a
   lost-funding alarm, but here the gap's direction is worse — soft supply existing before its backing.
   *(c)* the buy side needs a **fat-finger floor** (`PRICE_FLOOR_BPS`) that §11.10 does not mention: the
   shelf credit is `eth / price`, so a price a decimal place too low mints inventory out of a typo.
   The RWA float shipped exactly that bug. Fail-closed rather than clamped.
5. ~~**The float** (§5) — the nut, the clearing window, the stake. Re-sim the loot rate here.~~
   **BUILT** (`src/made.js`, `test/made.js`, the tiered loot in `src/social/combat.js`, sim P9.30).
   Three corrections to what this line said. *(a)* **The clearing window needed no code**, and saying
   so is the point rather than a shortcut: §11.1's own table already prices "everything fresh from
   the bond" at the IDLE rate, and a freshly-arrived balance IS a loose balance, so the tiering
   subsumes the timer — the same argument as step 3's 48h vest, which the FIFO surcharge already
   implemented. A separate `CLEAR_MS` would have been a second mechanism doing the first one's job.
   *(b)* **the flat `OMR_LOOT_RATE` is RETIRED, not raised** — the design's own §11.1 corrects §5's
   "0.50 of unprotected OMR" to a two-tier rate, and the load-bearing half of that is that
   **staked $OMR stops being a safe harbour** (0.20, cheaper but never free). That reverses a
   player-facing promise both codices made, so they were corrected in the same commit.
   *(c)* **the Commission is NOT gated on being made**, though §11.2's list opens with it: a decree
   moves real gameplay surfaces, so gating the vote on a paid subscription is $OMR buying POWER —
   against §4.3, which the same section names as binding. Flagged for the founder rather than taken
   silently (BALANCE.md § THE FLOAT). The speakeasy gate IS built as written, and sits at the edge of
   the same line for the same reason.
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

## 11. THE PARAMETERS — every open decision, resolved

*Founder: "design all of them utilizing your max effort rationale and logic. We are trusting your
recommendations." So these are recommendations with the reasoning shown, not options. Every number is
still a lever; what follows is the argument for where it starts.*

---

### 11.1 The loot rate — TIERED, and inverted from the obvious answer

**The trap.** There are two failure modes and they pull in opposite directions. Too *low* and hunting
is not worth the wall-clock time, so the only extraction path is dead. Too *high* and holding is
suicide, so nobody carries a float, so **there is nothing to loot** — and the path is dead the other
way. My first instinct (a flat 0.50) fails the second test.

**What changed the answer.** After the severance, in-game cash cannot become OMR — so cash has no
real-money value. A hunter therefore spends a *worthless* resource (ammo, guns, contracts) and their
time to gain a *real* one. The old D1 kill-EV measurement (−$72k standalone) is now irrelevant to
this question: the cost side is nearly free in real terms, so hunting does not need a high rate to
be worth doing. It needs a rate that leaves something to hunt.

**The design move: exposure should be proportional to idleness, not to wealth.** OMR sitting doing
nothing is dead capital that suppresses velocity — the one KPI. OMR committed to a purpose is already
doing work, and the commitment is itself a cost.

| state | rate | why |
|---|---|---|
| **idle** — a loose balance, and everything fresh from the bond | **0.50** | hoarding is the punished behaviour; the vest window is idle by definition |
| **committed** — an access stake, an escrowed bid, the subscription float | **0.20** | already working; less exposed, never safe |

**Three consequences worth naming.** It gives holders a genuine choice with a real tradeoff (commit
and be safer, or stay liquid and be a target) — and both answers help us, because committing drives
velocity and staying liquid feeds the hunters. It makes whales the rational prey and **automatically
protects new players: a fresh street holding nothing is worth nothing to hunt**, with no rule
required. And it is self-balancing — as whales learn to commit, typical scores fall and hunters must
hunt more, which is more play.

**No cap, no floor, no safe harbour.** §4.1 says OMR moves three ways; a protected tier would be a
fourth.

---

### 11.2 The nut — DON'T MOVE IT. Build THE MADE MAN instead.

I talked myself out of the obvious answer here and the reasoning matters.

**Why moving operating costs to OMR is wrong.** Business upkeep, territory upkeep and crew wages are
what keep a player's engine running. Denominate them in OMR and a player *must* buy real money to
keep earning — that is not "pay for convenience," it is a subscription wall on the core loop, and it
converts a free game into a rented one. It also directly contradicts §4.3.

**What replaces it, and why it is thematically perfect.**

> **THE MADE MAN** — a recurring OMR subscription (`MADE_OMR` **20 OMR / 30 days**) that buys
> **standing**, not power.

Being *made* is a status in the fiction — you can hustle on the street forever without it. So it
gates the **social and prestige layer** (Commission eligibility, speakeasy ownership, the upper estate
tiers, the portrait frame, the badge) plus pure convenience (fronts auto-pay their cash upkeep while
you are away, so absence stops being punishing). **It gates no earning loop whatsoever.** A free
player runs a complete empire — streets, crime, kitchen, family, PvP, the Law, the Pen, the market —
at full power, and can hunt made men for their OMR.

That is RuneScape membership and EVE PLEX, and it is the honest answer to the tester's complaint:
**paying buys you a seat at tables where you can lose money.** It buys no advantage at any of them.

**The float requirement comes from ACCESS STAKES, not operating costs** (§5 iii): *hold* N OMR to sit
at the high-stakes table, to hold a Commission seat, to run a Syndicate. Held, not spent — so it
generates no revenue but creates permanent, visible, lootable float attached to exactly the players
worth hunting. That is its whole job.

**Operating costs stay in cash. All of them.** This is the line that keeps the game free.

---

### 11.3 Founder revenue — VESTS, 70% of it

The number is large and permanently visible on-chain, so the read from outside is either "building"
or "exiting," and **the only thing distinguishing them is whether the money can leave immediately.**
Vesting costs nothing if the plan is measured in years, and removes the single most common rug-read.

But operations need funding now, so split the founder half rather than locking all of it:

| slice | of the founder 50% | treatment |
|---|---|---|
| **OPEX** | 30% (15% of bond ETH) | immediate — servers, art, audits, counsel |
| **CARRY** | 70% (35% of bond ETH) | **90-day cliff, then linear over 24 months**, at a published address |

**And reframe the split itself, because the current framing undersells it.** The LP half is not
*spent* — it is protocol-owned liquidity the treasury keeps and earns fees on. So the honest sentence
is not "half goes to the team"; it is **"half of every bond becomes permanent protocol liquidity, and
70% of the rest is locked for two years."** Very few projects can say that, and it is true.

---

### 11.4 Minimum bond — 0.1 ETH, and the desk is for whales by design

Mainnet arithmetic: a bond is ≈200k gas (signature, mint, two transfers, storage). At 20 gwei / $3k
ETH that is ~$12; at 50 gwei, ~$30. For gas to stay under ~5% of the purchase the bond has to be
≥ ~$250 in the good case.

**`BOND_MIN_ETH` = 0.1.** And rather than treat that as a limitation, make it the architecture:

| tier | venue | why |
|---|---|---|
| whale | **the desk** | size without slippage (§10 F) — the desk's actual product |
| mid | **the DEX** | a swap is cheaper than a bond and sized for them |
| everyone | **the hunt** | costs no gas at all, and is the design's centrepiece |

That is the three archetypes of §8 mapping cleanly onto three venues, which is a sign the shape is
right rather than a workaround.

**Withdrawals need the same treatment**: `WITHDRAW_MIN_OMR` **25**, so a claim's gas is a small share
of what is claimed. If volume ever justifies it, batch withdrawals into a daily merkle root (~60k gas
to claim, and the player picks their moment) — but that replaces an audited voucher rail, so it is an
optimization to earn, not to ship.

---

### 11.5 The access stake — IN-GAME, and lootable

**In-game, unambiguously.** An on-chain stake would be a safe harbour, and §4.1 admits no fourth way
for OMR to move — the whole thesis is that OMR is at risk. It would also cost gas on every
stake/unstake, which kills the loop it exists to create.

The trust objection ("on-chain is trustless") does not survive inspection: the in-game balance is
*already* custodial the moment a player deposits. An on-chain stake would not change the trust model,
only add gas.

Staked OMR is lootable at the **committed** rate (0.20). Defending your seat is the game.

---

### 11.6 The band — 30-day anchor, 0.80 / 1.00

- **Anchor: the 30-day TWAP** from the existing fail-closed `OmrTwapOracle`. Manipulation cost scales
  with the window, so 30 days is expensive to move; shorter than that and a whale sets our price.
- **`UPPER` = 1.00 × anchor.** Sell at or above the 30-day average — roughly half of all days, which
  is the right cadence for a seller who wants steady turnover rather than market timing.
- **`LOWER` = 0.80 × anchor.** Buy 20% below.
- **The 20%-wide dead zone is the point.** Narrower and we churn on ordinary noise, paying gas and
  spread to trade with ourselves; wider and the desk sits idle through conditions it should be
  acting on. 20% is about the daily volatility band of a thin token.

---

### 11.7 The auction — daily Dutch, 48h vest

| | value | reasoning |
|---|---|---|
| cadence | **daily** | founder's spec; also a rhythm players can plan around |
| quantity | yesterday's returned inventory, capped at **1% of float/day** | a huge sink day should not become a dump |
| open | **1.5 × anchor**, descending linearly | high enough that a genuine squeeze can clear there |
| duration | **6h** | long enough for a global player base to see it |
| reserve | **= `UPPER`** | *the reserve price is the band on the sell side* — unsold rolls to tomorrow, and there is no separate "should we bond today" logic to write or get wrong |
| vest | **48h** | see below |

**The vest is 48h because that is what `FRESH_WINDOW_MS` already is.** One concept, one constant, and
it is simultaneously the anti-dump, the float creator, and the loot exposure window (§5 ii). Long
enough that a hunter can realistically find you; short enough not to deter buyers.

---

### 11.8 The v4 hook — buy 0%, sell 5%, and it is counter-cyclical

Taxing buys discourages exactly what we want. So: **`HOOK_BUY_BPS` 0, `HOOK_SELL_BPS` 500**, taken in
ETH, deployed to POL.

The property that makes this the right shape: with buys untaxed, **all POL growth comes from sells —
so liquidity deepens fastest precisely when people are exiting.** Counter-cyclical liquidity, funded
by the people leaving. That is the opposite of most token designs, where the pool thins exactly when
it is needed.

5% also leaves headroom under the deployed `MAX_SELL_TAX_BPS` (10%) hard cap, with the ERC-20 backstop
tax staying armed at zero for the pools a hook cannot reach (§6).

---

### 11.9 The NFTs — horizontal rarity, 5% royalty, and the player chooses risk

**Which items:** cars, boats, assets. Not gear (GearVault already owns that rail), not businesses
(seizable, and an NFT the game can confiscate reads badly on a marketplace).

**Distribution:** common 60 / rare 27 / epic 10 / legendary 3.

**What rarity *does*, which is the part that matters.** If rarity is purely cosmetic the market is
thin; if it raises an item's power class, then ETH buys power and we have broken §4.3. The resolution
is to make rarity **horizontal**:

> Rarity rolls the item's stat **within its existing band** (±10%) and changes its look. A legendary
> Coupe is the best Coupe there is — and still loses to a common car one tier up.

So rarity makes you want *that specific item*, never a stronger class of item. It is the ARPG affix
model, and it sustains a collector market without selling advantage.

**Royalty 5%** (EIP-2981). Budget nothing on it — marketplace enforcement is optional and eroding.

**Lootable or safe: the player chooses**, extending the existing gear precedent exactly — *in-game
items are lootable; extracted NFTs are safe but inert.* Use it and risk it, or own it and display it.
This is what preserves EVE's destruction engine, which is the real lesson of EVE.

---

### 11.10 The buyback budget — POL trading fees, exclusively

Not the founder half (that is not ours to spend), not the LP half (POL depth is the binding
constraint of §10 E), and never minting (wall 4).

**Fund it from the fees the protocol-owned liquidity earns.** Three reasons this is the right source
and not merely an available one:

1. **It is self-limiting** — you cannot spend fees the pool did not earn.
2. **It scales with activity**, so the reflexive loop is anchored to real usage rather than to price.
3. **It compounds correctly** — POL grows from the sell tax, deeper POL earns more fees, more fees
   buy back more. The flywheel's fuel is the same thing that makes the exit work.

---

### 11.11 Does it add up? A worked example

1,000 active players, 200 paying, at the game's implied 500 OMR/ETH:

| | |
|---|---|
| Made Man | 200 × 20 = **4,000 OMR/month** returned |
| vanity + estate + auction + wire + PLEX | ~**2,000 OMR/month** |
| → the desk auctions | ~**200 OMR/day** ≈ 0.4 ETH/day ≈ **12 ETH/month** |
| → POL | **6 ETH/month** + the sell tax |
| → founder | 6 ETH/month (1.8 opex, 4.2 vesting) |
| → buyback | POL fees, ~**2 ETH/month** at 100 ETH POL and 2× monthly turnover |

Small but real, and **linear in players** — 10,000 players is ~120 ETH/month. The float at that size
is ~6,000 OMR, and hunters take 20–50% of the idle share of it.

**Where it breaks, stated plainly: below roughly 200 players there is no meaningful revenue and no
targets to hunt.** This design needs population, and specifically it needs *payers* — because the
free player's income is other people's subscriptions. That is the same dependency EVE and Albion
have, it works at scale, and it is fragile at launch. Seeding the first cohort is the real launch
risk, not the mechanics.

---

## 12. The lever table

Everything above, in one place, for `test/levers.js`.

| lever | value | §  |
|---|---|---|
| `LOOT_IDLE` | 0.50 | 11.1 |
| `LOOT_COMMITTED` | 0.20 | 11.1 |
| `MADE_OMR` | 20 / 30d | 11.2 |
| `FOUNDER_OPEX_BPS` / `FOUNDER_CARRY_BPS` | 3000 / 7000 of the founder half | 11.3 |
| `CARRY_CLIFF_DAYS` / `CARRY_VEST_MONTHS` | 90 / 24 | 11.3 |
| `BOND_MIN_ETH` | 0.1 | 11.4 |
| `WITHDRAW_MIN_OMR` | 25 | 11.4 |
| `BAND_ANCHOR_DAYS` | 30 | 11.6 |
| `BAND_UPPER` / `BAND_LOWER` | 1.00 / 0.80 | 11.6 |
| `AUCTION_OPEN_MULT` / `AUCTION_MS` | 1.5 / 6h | 11.7 |
| `AUCTION_MAX_FLOAT_BPS` | 100 (1%/day) | 11.7 |
| `BOND_VEST_MS` | 48h (= `FRESH_WINDOW_MS`) | 11.7 |
| `HOOK_BUY_BPS` / `HOOK_SELL_BPS` | 0 / 500 | 11.8 |
| `NFT_RARITY_WEIGHTS` | 60 / 27 / 10 / 3 | 11.9 |
| `NFT_RARITY_STAT_BAND` | ±10% | 11.9 |
| `NFT_ROYALTY_BPS` | 500 | 11.9 |
| buyback source | POL fees only | 11.10 |

---

## 13. What I am least sure about

Stated so it is not mistaken for confidence.

1. **`MADE_OMR` at 20/month is a guess, and it is the revenue dial.** It has no measurement behind
   it because there is no market price to measure against. It should be the first thing re-derived
   once a price exists, and the first thing the sim models.
2. **Whether convenience + standing is a strong enough sell.** RuneScape gates two-thirds of the game
   and people pay; we are gating standing and quality-of-life, which is weaker. If conversion is bad
   the honest fix is to gate *more breadth* (whole pillars) rather than to start selling power.
3. **The 0.50 / 0.20 split is reasoned, not measured.** It needs the sim, and the specific thing to
   measure is whether committed float actually survives long enough to be worth committing.
4. **Population.** §11.11 — the design is sound at scale and thin at launch, and no parameter fixes
   that.
