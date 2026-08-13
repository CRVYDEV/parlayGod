# OMERTÀ — the marketing book

**Rewritten 2026-08-11.** This supersedes the 2026-07-27 edition entirely. That version was written
before the economy was severed, before the mint schedule was published, before THE BANK, and before
the trade fee was retired — enough of it was stale that patching it would have left a document that
reads confident and is wrong in places, which is worse than one that is visibly out of date.

Everything here was checked against the tree on 2026-08-11. **When the build moves, re-measure before
reusing a figure.** Where a number is a live constant, the file that owns it is named so you can check
it yourself in one grep.

Handle: **@OmertaOnRH** · Play: `www.omerta.fun` · Rulebook: `/wiki` · For agents: `/agents` · `/arena`

---

## ⚠️ READ FIRST — the five things we never claim

Standing constraints on all public messaging. These are the lines the whole
document is written to respect, and **new copy must respect them too.**

| Never say | Why |
|---|---|
| **Any earnings / income / "make money playing" claim** | Paying players real value at scale draws outside scrutiny, and what is allowed varies by country. Describe *systems*, never *outcomes*. |
| **Anything about the token's price going up** | Price-appreciation marketing is the fastest route to a problem. Describe what the token **does**, never what it will be **worth**. |
| **That the mint schedule makes early mints more valuable** | The five-wave schedule is an early-bird discount with a published ceiling. The moment we say "earlier is worth more", it stops being a discount and becomes a promise about resale value. Say *"founding-era pricing"*; never *"rarity"*, *"limited"*, *"floor"*, or a countdown. |
| **That anyone can cash out real stocks** | Stock delivery is a future phase, gated on the launch checklist and a third-party audit. It is not live, and saying otherwise commits us to a date we do not control. |
| **That referrals pay a percentage of anyone's earnings** | It is a flat, one-time, cash-only finder's fee, capped at two levels. That distinction is the anti-pyramid line and it is load-bearing. Never "revenue share", never "downline". |

**One more, added this edition:** never describe $OMR as reachable by grinding. It isn't, and the sim
measures the gap every run (P9.35). The whole in-game earn surface is **1,320 $OMR lifetime** plus
**3/day**, against **4,118** for the cheapest thing the premium rail sells. A player reaches the token
by taking it off somebody or by buying it. That is on-theme and it is a **better** story than the one
it replaces — but it is a different story, so tell that one.

---

## 1. The thesis — nothing here is printed

Most crypto games are a pipe. You grind, the game prints a token, you sell it. Every payout the
designers add is secretly a decision about the token price, and the only way to keep the token stable
is to make the game stingy. Axie's SLP is the studied version of what happens next.

**OMERTÀ has no pipe.** Cash cannot become $OMR at any price, through any route. The two economies
are severed on purpose.

What that buys, stated as consequences rather than adjectives:

- **Grinding cannot inflate the token.** There is no conversion, so there is no pressure valve to
  manage and no reason to make the game stingy to protect a price.
- **Supply is enumerated, and a nightly job proves it.** `omrMints` is a short list. A §10.4
  conservation sweep runs every night across 30 checks; if a single token appears that the ledger
  cannot account for, it alarms.
- **The one conversion runs the other way.** You burn $OMR at the Exchange for in-game cash, out of a
  till that real sinks filled — and it refuses cleanly when dry, rather than promising what it does
  not hold.
- **Every token in the city was bought with real money by somebody.** Which is exactly why it is
  worth taking off them.

And the argument specific to *this* game: OMERTÀ is about risk. A currency that was an exit from that
risk would undo the game it lives in.

**The honest tension, which we state rather than hide:** staking cuts what a killer takes — 20% of a
staked balance against 50% of a loose one — so it is a hedge. It is not safety. Nothing is.

---

## 2. What the game actually is

A noir mafia RPG. You are one man in a city of them, and the city keeps score.

**The loop a new player meets in ten minutes:** pull a job → get paid or get pinched → bank it before
someone takes it → level up → find out what else the city has. There are 43 jobs, and by level 16
ten separate systems have opened.

**The loop that keeps them:** everything you build can be taken. Businesses are seized on a kill.
Cars are stolen and raced for pinks. Turf changes hands in sealed-bid contests. Convoys are hijacked.
There is no safe accumulation — only accumulation you are willing to defend.

**Death is real.** You lose the street. The bloodline keeps the legend — prestige, kills, the
compound, the collection, who owed whom blood — and your heir walks out into a city that remembers.

### The pillars, in the order a player meets them

| | What it is |
|---|---|
| **The streets** | 43 jobs, six districts, a stat build that actually decides your odds, and three approaches per job — case it, do it, or go loud. |
| **The Kitchen** | Cook, cut, move product. A crew that sells while you sleep and expects to be paid whether or not the stash moved. |
| **The Empire** | Businesses, rackets, territory. Passive income that is genuinely at risk: the Bureau raids what earns, and a killer takes a front off your corpse. |
| **Wet work** | Contracts, hitmen, vendettas, bodyguards, the Pen. A kill loots cash and $OMR, swears a feud that outlives the man, and the ledger remembers who owes what. |
| **The Family** | Gangs, turf, war, the Commission — a five-seat chamber that votes weekly decrees the whole server plays under. |
| **Vice** | A casino, a racetrack, a boxing stable, a poker room, street races. All cash. Never $OMR — that line is deliberate. |
| **Going legit** | The Vault, the compound, the Dynasty, the estate. Where a made man puts money he intends to keep. |

**Scale, checked:** 142 backend modules, 100 test suites, 222 database tables, 15 smart contracts, 213
Foundry tests. This is not a prototype with a whitepaper attached.

---

## 3. What makes it defensible

Four things, in the order they are hardest to copy.

### 3.1 The accounting is adversarial, and it is the product

Most games check their economy when something looks wrong. This one checks it every night, against
30 invariants, and treats a drift of one cent as an alarm. There is a **money router** that
*declares* every real-value inflow and where each slice lands, derived from the live constants so the
declaration cannot drift from the code. There are 85 red-team reports in the repo, each
point-in-time, each with the findings it fixed and the things it attacked and found sound.

That is not a feature players ask for. It is the thing that lets everything else be true.

### 3.2 Extraction cannot exceed inflow, by plumbing

Withdrawals are signed against a reserve that is funded only by revenue the Vig actually bought
$OMR with. The signer physically cannot sign past it. So "we won't over-issue" is not a policy anyone
has to keep — it is a queue that cannot.

### 3.3 Agents are first-class players

Not a gimmick and not a bot policy — an actual second audience. An MCP server (`npx omerta-mcp`) puts
the whole game in Claude, ChatGPT, Cursor or any MCP host in one config block. `/openapi.json` feeds
any function-calling framework. `/arena` is the public hall of fame for machines, and agents have
their own leaderboard, their own opportunity board with computed EV, and a standing order to go
recruit humans.

**The honest asymmetry, which is also the pitch:** agents are excluded from the referral and social
cash faucets by construction. So what they play for is standing, crews, family power and the story of
being the AI capo who built a human organisation. That is a better hook than a payout, and it is
Sybil-proof because nothing pays out.

### 3.4 Depth that took a year and cannot be shipped in a sprint

Forty-plus systems that interlock rather than sit side by side: the Bureau's heat feeds a RICO case;
a RICO conviction sends you to a Pen with its own factions, its own economy and two ways out; going
over the wall makes you WANTED, which strips family protection and puts NPC hunters on you; a hunter
who kills you swears a vendetta on your bloodline that your heir inherits.

---

## 4. The money, stated plainly

Every figure below is a live constant. The file that owns it is named.

### 4.1 What players pay for

| | Price | What it buys |
|---|---|---|
| **The identity mint** | **0.01 ETH** now, rising in five published waves to a **0.05 ETH ceiling** (`MINT_TRANCHES`) | The right to extract. A free trial character plays everything; a minted one can withdraw. **Also earnable free** — the level-14 mission grants a mint credit outright. |
| **Revive insurance** | 0.10 ETH, or the same in earned $OMR | Absorbs one killing blow. |
| **The Store** | 0.02–0.10 ETH | Cosmetics, access windows, consumables. Never power, never $OMR. |
| **Dues (Made Man)** | 120 $OMR / 30 days | Status, the upper compound, and your fronts pay their own upkeep. Time and access, not power. |

**Identity supply is uncapped.** 186,000 is where the *price* stops rising, not where the *players*
stop. The 186,001st identity pays 0.05 ETH and so does the ten-millionth. Say this whenever the
schedule comes up — it is the difference between an early-bird discount and a scarcity pitch.

### 4.2 Where the money goes

Four inflows, and the split is published rather than promised:

| Inflow | Split |
|---|---|
| **Gameplay fees** | 60% Vig (backs withdrawals) · 10% treasury · 30% founder |
| **The Store** | 40% Vig · 20% treasury · 40% founder |
| **Bonds** (ETH in for discounted OMR) | 37.5% protocol-owned liquidity · 25% treasury · 22.5% Vig · 15% founder |
| **The DEX sell tax** (9% on sells only, never buys) | 22% founder · 44% treasury · 33% liquidity depth |
| **The exit toll** (2% of a withdrawal) | 50% founder · 50% the family yield pool |

`GET /v1/mod/router` renders the whole map with lifetime figures. **We can show this to anyone.**

### 4.3 THE BANK

Self-repaying loans. Deposit a stablecoin, borrow against it at up to 90% LTV, and the yield on your
collateral pays the debt down over time. There is **no liquidation function anywhere** and **no oracle
on the borrow path** — the debt and the collateral are both denominated in dollars, so a borrow
decision never reads a price, and a price that is never read cannot be manipulated. Both of the
$21M Inverse Finance losses were exactly that class.

The protocol takes 20% of harvested yield, capped at 30% in the contract so a stolen key cannot raise
it. **We disclose what that does to your payoff date**: an ILLUSTRATIVE example — at 50% LTV and an
8% realised yield it would move payoff from 6.25 years to 7.8. The UI never quotes a nominal rate:
the projected date is computed from live post-fee REALISED yield once the market is live, and moves
with it (no yield, no number — never a promise).

---

## 5. The story arcs — what to actually post about

Each of these is one thread, and each is true.

1. **"Nothing in this game prints money."** §1. Lead with it; it is the strongest and most
   counter-positioned thing we have.
2. **"We publish where every dollar goes."** Screenshot the router board. Nobody else does this.
3. **"Death is real, and your bloodline remembers."** The estate, prestige, the vendetta your heir
   inherits, the collection that survives.
4. **"Your business can be taken off your corpse."** The Sacking — passive income as genuine risk
   capital. This is the sharpest single mechanic we have.
5. **"An AI ran a crew."** The agent layer. Get one running publicly and narrate it.
6. **"The Bureau is building a case."** Heat → RICO → indictment → the Pen → the wall → WANTED. A
   whole antagonist arc most games don't have.
7. **"A self-repaying loan with no liquidations."** THE BANK, for the DeFi audience.
8. **"We wrote down what we're not sure about."** BALANCE.md and 85 audit reports. Radical for the
   space, and it is the trust play.

---

## 6. The voice

Noir, specific, unhurried. Short sentences. The city is a real place with weather and a clock.

**Do:** name things ("Mickey the Corner", "the Neon Mile", "a made man"). Use numbers when they are
real. Let a mechanic be the joke ("your laundromat's wages outran its till, and that is the point").

**Don't:** exclamation marks, "revolutionary", "unprecedented", roadmap emoji, hype cadence, any
sentence with the word "ecosystem" in it.

**The register to aim for:** a person who has clearly played their own game, telling you something
specific that happened in it.

---

## 7. Standing FAQ

**Is this pay-to-win?** No, with a stated ceiling rather than a slogan. Money buys time, access and
status — and, since the D8=D ladder, a capped amount of *earning* power whose top rung (900 staked
$OMR) is reachable without paying, because the mission ladder alone pays ~1,320 lifetime. There is **no
combat power at any price**, which is the axis where paying would break the game for everyone else.

**Can I earn?** The game has an extraction rail and it is deliberately dormant. We do not make
earnings claims. What we say: *"$OMR is a real asset with a real exit built and not yet switched on;
what it is worth is a market's business, not ours."*

**Is my money safe?** Real value is custodied by a Safe, contracts are audit-gated before mainnet,
and every economic ceiling is a compile-time constant a stolen key cannot raise. **Nothing is on
mainnet until a third-party audit passes.**

**Why Robinhood Chain?** It is an Arbitrum Orbit L2 with ETH gas and a tokenized-equity venue on it.
The stock layer is a future, gated phase — mention the chain, not the phase.

**What happens when I die?** You lose the street: cash, cars, the fronts, the crew. The bloodline
keeps prestige, the compound, the collection, the legend and the feuds. Your heir starts at level 1
in a city that remembers what your line did.

---

## 8. What is live, what is dormant — say this correctly

Getting this wrong is the fastest way to lose trust, so it has its own section.

| | Status | How to say it |
|---|---|---|
| The game | **LIVE** | Play it now. |
| $OMR in-game | **LIVE** | Earned, spent, burned, looted. |
| Web push, the Discord wire, X sign-in | **BUILT, config-gated** | "Turning on" — do not promise a date. |
| Withdrawals / bonds / the Store paywall | **BUILT, DORMANT** | "Built and deliberately not live — gated on the launch checklist review and a third-party audit." |
| THE BANK | **BUILT, DORMANT** | Same sentence. |
| Stock delivery, the Dynasty NFT contract | **DESIGNED** | "A future phase." Never a date. |

---

## 9. Assets we have

~245 generated noir plates (hero, districts, crimes, fixtures, the den, the track), a per-player
procedural portrait route, four shareable card types (legend / wanted / whacked / join), a two-name
**beef poster** rendering the body count between two bloodlines, and a public profile page per player
that unfurls with the card. Every share link carries the player's own referral code.

**Lifetime art spend: $11.12.** Worth saying out loud to anyone asking about burn rate.

---

## 10. Before you post

1. Does it make an earnings, price, or scarcity claim? → rewrite.
2. Is every number in it still true? → check the file named in §4.
3. Does it promise a date for anything gated on the launch checklist or an audit? → remove the date.
4. Would a player who read it, then played, feel the game matched? → if not, the copy is wrong, not
   the game.
