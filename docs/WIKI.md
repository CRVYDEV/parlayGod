# OMERTÀ — The Codex

This is the knowledge base for OMERTÀ, a multiplayer crime game. It describes every system, every gameplay
loop, and every important number. This is the source text. The game shows the same content at **`/wiki`** (the
CODEX button in the top bar).

> **How to read this document.** The numbers are the current settings. They can change.
> The routes start with `/v1/…`. A route needs a character with a login, unless the route has the mark
> **[public]**, **[mod]**, or **[chain]**.
> "Level N" is the character level. The level comes from respect: `level = floor(sqrt(respect/10)) + 1` — L5 ≈ 160 respect, L10 ≈ 810, L20 ≈ 3,610.
> For example: L5 ≈ 64 respect, L10 ≈ 324, L20 ≈ 1444, L30 ≈ 3364.

---

## Table of contents
1. [The core loop](#1-the-core-loop) · 2. [Your character, death & the heir](#2-your-character-death--the-heir) ·
3. [Cars, guns & gear](#3-cars-guns--gear) · 4. [The city & the living world](#4-the-city--the-living-world) ·
5. [The economy — $OMR, cash, the window](#5-the-economy) · 6. [The Kitchen](#6-the-kitchen) ·
7. [Businesses & fronts](#7-businesses--fronts) · 8. [Territory rackets](#8-territory-rackets) ·
9. [Families](#9-families) · 10. [The Commission](#10-the-commission) · 11. [The Den (casino)](#11-the-den) ·
12. [The Speakeasy](#12-the-speakeasy) · 13. [The Fights (boxing)](#13-the-fights) ·
14. [PvP — jumps, hits & contracts](#14-pvp) · 15. [Make risk pay — loot, safehouse, revive](#15-make-risk-pay) ·
16. [The Law & RICO](#16-the-law--rico) · 17. [The Pen (prison)](#17-the-pen) ·
18. [Loan sharking](#18-loan-sharking) · 19. [Convoys](#19-convoys) · 20. [Crew heists](#20-crew-heists) ·
21. [The Black Market](#21-the-black-market) · 22. [Vendettas](#22-vendettas) · 23. [Skills](#23-skills) ·
24. [The Underworld (fixers)](#24-the-underworld) · 25. [The Wire](#25-the-wire) ·
26. [The Store & the Season Pass](#26-the-store--the-ledger) · 27. [Going Legit — what your $OMR does](#27-going-legit) ·
28. [The Estate & Auction House](#28-the-estate--auction-house) · 29. [The chain — withdrawal & bonds](#29-the-chain) ·
30. [Growth — paths, missions, first week](#30-growth) · 31. [Reference — districts, gotchas, glossary](#31-reference)

---

## 1. The core loop

You start as a new player in the Docks district. You have $500 and no reputation. The main loop is: **do jobs
to earn cash. Train your stats. Put your cash in the bank. Set up income sources that pay you while you are
away. Increase your level.**

**Crimes** (`POST /v1/crimes/:id`) — there are 29 jobs. The first job is Pickpocket (L1, 2 nerve, $40–120). The
last job is Empty the Federal Depository (L110, 35 nerve, $160k–400k). Each job has a level requirement, a
nerve cost, a cash range, and a chance of jail if you fail. Your success rate increases with your **cunning**
and **speed**, your family level, some districts, and your rank. A job can also give you **contraband crates**
(you use these to buy guns and to make gear) and **makings** (ingredients for the Kitchen).

**Every job has a mark, and the money comes off them.** A crime names a victim drawn from the NPC
residents standing in your district. When that mark has money on them, THE TAKE moves it: the cash
you earn is transferred off their pocket (up to 25% of it per job) and only the shortfall is created
by the game. So a job on a busy street is a robbery with a name on it; a job on an empty one still
pays exactly the same, it just comes from nowhere. Marks are always NPC residents — a real player is
never robbed by a stranger's crime roll, because they would get no warning and no way to answer.
Taking from a real player is what the PvP asset crimes are for (rob a front, steal a car, mug their
trunk), and those always tell the victim who did it.

**Energy and nerve** power your actions. They increase again with time. The game does not use a global clock;
your resources increase when you do an action. Energy powers crimes and training. Nerve powers the more
dangerous actions. **Heat** is the police attention that crime causes. Too much heat starts a police case (see
section 16).

**Train** (`POST /v1/train/:stat`) — one training session costs 10 energy. You can train muscle, cunning, or
speed. The increase becomes smaller as the stat becomes higher. **Heal** (`POST /v1/heal`) — you pay cash to
return to full health. The cost increases with your injury. **Check in** (`POST /v1/checkin`) — do this one
time each day. A daily streak pays `250×lvl + 100×lvl×min(streak,7)` plus 20 energy.

**The Bank** (`POST /v1/bank/deposit|withdraw`) — **another player can steal the cash in your pocket when you
die. The cash in your bank is safe.** But a new deposit is **"in transit" for 2 hours** before it is safe.
Another player can steal it during this time. A new deposit resets the 2-hour clock. The bank pays about 2%
interest each 12 hours. The interest has a limit (12 hours of interest each day). The interest is smaller
above $10M. **You cannot use the bank from a safehouse.**

**Travel** (`POST /v1/travel/:district`) — travel between the 6 districts costs $250. You cannot travel from
jail.

**Important limits:** jail stops almost all actions. Energy and nerve limit crimes and training. A safehouse
stops your own attacks and your money movements. A safehouse is a shield, not a base.

---

## 2. Your character, death & the heir

Each account has one living character. You start at Level 1 (respect 0). You have 50 energy, 10 nerve, 100
health, and $500. Your muscle, cunning, and speed are 5 each. You start in the Docks district.

**Respect, level, and rank.** Respect is your experience. Your level comes from your respect. The **RANKS**
ladder gives you benefits at each level: L10 Hustler (+5% crime pay), L22 Runner (+1 energy increase), L35
Enforcer (+5 attack), L50 Associate (10% cheaper healing), L65 Soldier (a made man, −20% jail), L80 Capo (+1
nerve increase), L95 Underboss (+10% racket and business income), L110 Mob Boss, L125 Don of the City.

**Effective stats** = your trained stats + gear increases + asset increases. **Firepower (fp)** comes from
the gun you carry. You need 50 fp or more to make a lethal attack.

**Death and the estate (section 7.9).** A lethal attack starts the **estate** process in one step. **The
character dies, but your account does not die.** An heir is born. The heir is a new character (generation
+1). The heir inherits everything at the account level. **These are lost when the character dies:** stats,
skills, businesses, the speakeasy, the Kitchen crew, the boxing fighter, control of territory operations, and
this season's kills. **These pass to the heir:** prestige, the
**Estate**, the Store **patron/pass** benefit, **hitman reputation and lifetime kills**,
minted status, revive tokens, and 25% of your **Underworld** standings.

**Prestige and seasons.** A season is 28 days. At the end of a season, your level converts to **prestige**
(`floor(level/2)`). Your respect returns to 0. The players with the most respect win an SPCX (stock) prize.
You can **respec** your stats for 90 $OMR (`POST /v1/respec`). This has a 24-hour cooldown that it shares with
skills.

Routes: `POST /v1/character` (create — the name is 2–24 characters and must be unique among living characters;
you can add `referralCode`), `GET /v1/me`, `GET /v1/session` [public probe], `POST /v1/respec`.

---

## 3. Cars, guns & gear

**Cars and the Garage** (limit 12). There are 60 car models. The cheapest is a County Auction Junker ($900).
The most expensive is The Tsarina's Ghost ($400k). Each car has a chance of being stolen, a scrap value, and a
book value. A **trim** (Rusted to Coachbuilt) increases all three values.
- **Boost** (`POST /v1/garage/boost`) — steal a random car. This has a 5-minute cooldown.
- **Melt** (`POST /v1/garage/:carId/melt`) — scrap a car for ammo. 25% of the ammo goes to your family.
- **Fence** (`/fence`) and **Repair** (`/repair`) — sell a car for cash, or repair its damage.

**RARITY, AND THE WAY OFF THE BOARD (the rarity NFTs).** Every car and boat carries a rarity —
Common, Rare, Legendary, Epic — rolled by the server the moment you EARN it, and logged so the draw
can be checked. It is pure status: it changes no speed, no value, no race, nothing. What it changes is
scarcity, and scarcity is what a collector pays for.

You can buy your way up the ladder with $OMR (`POST /v1/nft/:kind/:id/upgrade`), and the price buys
exactly the next tier — a known item for a known price, never a roll. **Nothing in this game sells a
random outcome for money**, and that is a rule rather than a habit.

You can also take one **ON-CHAIN** (`POST /v1/nft/:kind/:id/withdraw`, on the same rail gear uses),
and this is the real decision:

> **In-game items are lootable. Extracted NFTs are safe, and inert.**

An extracted car is an ERC-1155 in your own wallet. Nobody can steal it, win it in a pink-slip race,
chop it off your corpse or take it in a war — and it **survives your death**, passing down the
bloodline. In exchange it never races, hauls, melts, fences or earns again. It is a trophy, not iron.
Use it or own it; you cannot do both, and there is no way back. You must be MADE to take anything
on-chain (the same gate as a $OMR withdrawal); a free-trial street plays the whole game and extracts
nothing.
- You cannot melt, fence, or repair a car that is **listed** on the market or **pledged** as loan collateral.

**Guns and the Armory.** There are 15 guns. The cheapest is a Rusty .25 ($800, fp3). The most powerful is the
Long-Case 'Undertaker' ($400k, fp60). Each gun costs cash and crates. **Vests** (bought with $OMR) increase
your chance to survive. Routes: `POST /v1/armory/gun/:id/buy`, `/equip`, `/unequip`, `/armory/vest/:id`,
`/armory/ammo`. Ammo costs $2000 for 50 rounds. **The price of ammo is never reduced. Ammo controls the cost
of a kill.**

**Gear** (about 55 items, from Common to Legendary, priced in $OMR) increases your stats. Gear is a
**tradeable NFT on the blockchain** (the GearVault system, section 29). When a player kills you with a fire
attack, they have a **15% chance to take one piece of your in-game gear.** **Gear that you minted on the
blockchain is safe.** It has left the game. Keep gear in the game to use it (you can lose it), or move it to
the blockchain (it is safe and tradeable, but you cannot use it in the game).

**Consumables** (bought with crates): espresso (+energy), medkit (+health), Getaway Kit (leave jail), Priest's
Alibi (−heat), and more. Route: `POST /v1/items/:id/use`. The **Workshop** (`POST /v1/workshop/craft/:id`,
`/workshop/ammo`) makes gear and ammo from crates and cash. It is cheaper in the Old Foundry district.

---

## 4. The city & the living world

The city has a **daily background that is the same for all players**. You can know it before it happens.

**City events** (16 events, one each day, in order) change every loop. Examples: HEAT WAVE (job pay ×1.5, jail
×2), DOCK STRIKE (contraband ×2), COMMISSIONER'S VISIT (jail ×0.5), THE CRACKDOWN (job pay ×1.75, jail ×1.5),
BUREAU SWEEP (deal heat ×2), THE THIRST (drug demand ×1.3), SUPPLY DROUGHT (makings +40%), OPEN CITY (heat
decreases ×2). `GET /v1/city` [public] shows the current day and a **7-day forecast**, so you can plan.

**Regional weather** — a daily price change on trade goods in each district (0.9–1.1×, average 1.0). **Day and
night clock** — during patrol hours (UTC 13:00–22:00), RICO convictions are stronger (×1.15). At night, NPC
raids are easier.

**The 6 districts:** **Docks** (+50% contraband, the harbor), **Neon Mile** (+15% racket and
business income; the vice district — casino, speakeasy), **Old Foundry** (workshop −25%), **Brick Yards** (+2%
crime success), **Canal Row** (+10% crime pay), **Cathedral Hill** (nerve increases two
times faster).

**NPC rival families** (`GET /v1/world`, `POST /v1/world/:npcId/raid`) — these are shared cash reserves for the
whole server. All players attack them together. This is a cooperative task. The outfits are: Dock Rats (L4), Zappa Crew (L8),
Kryl Syndicate (L20), Moreau Cartel (L40), Volkov Bratva (L55) — the top three need a CREW raid. A raid costs energy, ammo, and heat. It takes a limited amount of
cash. It pays a one-time bonus if you reduce a family below its floor. If the family repels the raid, you go
to hospital. If you defeat a family, your **family holds its outpost**. The outpost pays tribute to your
treasury. A rival family can take the outpost if it pays more than your garrison.

**The uprising** (`POST /v1/world/:npcId/reinforce`) — the NPC families fight back. On some days (the forecast
shows them a week early) one family **rises up**. It becomes harder to raid, and it stops paying tribute. At
the end, it will **leave your outpost if your garrison is too small.** Use `reinforce` to make the garrison
stronger from the treasury. This also protects the outpost from rival families. If you keep the family weak
with raids, a small garrison is enough.

---

## 5. The economy

**Currencies:** **cash** (in your pocket and your bank), **$OMR** (the premium currency; earned by
playing, extractable on-chain by minted accounts; held at the account level, so it survives death),
**crates** (cb), and **ammo**. **Cash and $OMR do not trade** — cash is the city's own money and it
stays in the city; $OMR comes in from outside and leaves through the Exchange window. The
main economic rule (section 10.4): the game records and checks every movement of value.

**Nothing you do in the game creates $OMR.** There is no wage, no yield and no drip — the Street Wage
was retired, and the game now has no printer at all. Every $OMR in the city was **bought with real
money** by somebody, which is exactly why it is worth taking off them. Your three ways to get some:
**take it** (killing a player loots their liquid $OMR — staked and committed $OMR is safer), **earn it**
from another player who pays you in it, or **buy it**. A nightly job asserts that no new $OMR appeared,
so this is a fact you can check rather than a promise.

**The Desk** (`GET /v1/desk`) — where you buy it, and where it goes when you spend it. Every $OMR a
sink takes off you (a vanity burn, an estate tier, a jury, the Window) is **not destroyed** — it lands
on the desk's shelf, and the desk puts it back up for sale. Once a day the desk runs a **descending
auction**: it opens high and the price falls for six hours toward a **reserve**, and whatever does not
sell simply rolls to tomorrow. The lot is what came home yesterday, capped at 1% of all the $OMR in
player hands so a big spending day cannot become a dump. **The desk can only ever sell what is on its
shelf** — it never issues anything, which is why buying here moves no supply at all: those are somebody
else's spent chips changing hands. There is a **buy side** too: if the price falls far enough below
the 30-day average, the desk restocks off the open market instead of waiting for the sinks — paid for
out of the trading fees the game's own liquidity earns, never by printing. Between the two edges it
does nothing at all, which is deliberate: a desk that buys and sells at the same time is just paying
fees to trade with itself. The board publishes the shelf, the clock, the price and the exact
list of spends that feed it, so the claim is checkable. **$OMR bought at the desk is FRESH** — it pays
the full early-exit toll for its first 48 hours, same as any other fresh token.

**The Exchange window** (`GET /v1/window`, `POST /v1/window/redeem`) — the ONE conversion in the
game, and it runs one way: **burn $OMR, receive cash at a published rate**, from a till that real
cash sinks fill (the street take). A short till refuses cleanly and burns nothing — the window is a
claim on what was funded, never a promise. 5% of every redemption goes to the top families (the
family yield). **Cash can never become $OMR** — the old AMM swap and every laundering rail
(street and private) are retired; those routes answer `retired`.
- **The early-exit tax on withdrawals:** $OMR that you received less than 48 hours ago pays an
  extra toll when you extract it on-chain — 50% at age zero, decreasing in a straight line to 0% at
  48 hours, newest tokens priced first so old savings cannot shield a fresh dump. Hold a token for
  two days and it exits free. There are no exemptions.

**THE MADE MAN** (`GET`/`POST /v1/made`) — the recurring subscription. Pay **120 $OMR every 30 days**
and you are *made*: the badge, the upper compound (Country Estate and above), a club of your own, and
**the pad pays itself** — your fronts settle their own cash upkeep the moment you touch them, so a
stretch away no longer leaves them cold.

**It buys standing, never power.** No earning loop is gated, no odds move, no stat changes, and the
pad is not discounted by a cent — the same money leaves your pocket, you just stop having to remember.
Operating costs stay in cash, all of them, which is the line that keeps the game free: a man who never
pays a dues runs the whole city at full strength — and can hunt made men for their $OMR. Paying buys
you a seat at tables where you can lose money. It buys no advantage at any of them.

Dues are a sink like any other, so they go to **the Desk** to be sold again rather than being destroyed.

**THE ACCESS STAKE** — the high-stakes room at the Den wants a seat (level 30, or the Madame's velvet
rope) *and* **300 $OMR held in a stake**. Held, not spent: it earns nobody anything, and its whole job
is to put a permanent, visible, lootable float on exactly the players worth hunting.

**The Vault (staking)** (`POST /v1/stake`, `/unstake`) — **cheaper cover, not a safe harbour.**
Staking used to make $OMR untouchable. It no longer does: a killer takes 50% of a loose or unbonding
balance but only 20% of a staked one, so committing halves what a bad night costs you without ever
making you safe. You always get your full principal back, but it "unbonds" for 6 hours (at the higher
IDLE rate during that window) before it is liquid. **Nothing you hold is out of reach** — the whole
point of the currency is that it can be taken off you. The old per-staker
yield is retired (`/claim-rewards` answers `retired`): $OMR yield now pays THE FAMILIES — the top
families by seasonal standing draw the **family yield** into their gang reserves.

**The money cycle:** cash costs (the casino cut, house takes, fines, and other fees) go to the
**street-tax pool**, and every 12 hours the whole take funds the **Exchange window's till** — so the
cash that players spend is what backs the cash that $OMR redeems for. On the $OMR side, a cut of
every window redemption flows to the top families (**the family yield**). Spenders fund earners;
nothing is created to make it so.

### Why it is built this way

Almost every game with a token has the same pipe: you farm the game's own currency, convert it to the
token, and sell. It is one pipe, and everything bad runs through it. Farming is unbounded, so the token
is unbounded. The people converting are the people leaving, so the sell pressure grows exactly as fast
as the game succeeds. And because the token is the only reason to grind, the grind is optimised until
it stops resembling a game. The genre's most-studied collapse — Axie's SLP — is that pipe running to
completion.

**OMERTÀ does not have the pipe.** Cash cannot become $OMR at any price, through any route, at any
rate. There is no swap, no wash house, no laundering at your own front — those routes exist as code
that answers `retired`. This is not a rate that was tuned down or a cap that was lowered; the
conversion does not exist.

Four things follow, and each is a mechanism rather than a policy:

- **Grinding cannot inflate the token.** Grinding makes cash, and cash has nowhere to go but back into
  the city. A player who plays twenty hours a day is a rich player, not a source of new supply.
- **Supply is enumerated, and the list is shrinking.** The ledger check is
  `buckets == genesis + mints − burns`, and a reason nobody enumerated is itself an alarm. The Street
  Wage — the one scheduled printer — is retired, and a nightly check now asserts that no new unit of it
  appears. Two small legacy taps remain (mission rewards and the Vig prize pool) and retire with their
  own systems. There is no fourth tap to find.
- **No faucet is the strong version of the promise.** With nothing paying $OMR for play, in-game $OMR
  can never exceed what was deposited — so "you can only take out what somebody put in" stops being a
  rule the game has to enforce and becomes an arithmetic fact about the ledger.
- **The one conversion runs the other way, and only on money that already exists.** The Window burns
  $OMR and pays cash out of a till that real cash sinks filled. A short till refuses and burns
  nothing. It is a claim on what was collected, never a promise about what will be.

**Why this particular game.** OMERTÀ's whole thesis is that things are lost — death is permanent, your
pocket is lootable, your empire is seizable by someone who wants it more. A token you can farm and dump
is, structurally, a way to opt out of that: convert your position into something the game cannot take,
and leave. Severing the pipe means effort converts to $OMR only by being paid for playing well, and
$OMR converts to power only by being burned. The currency cannot be used as an exit from the risk that
the game is about.

**And there is no hiding place, by design.** The obvious way to soften a risk economy is a vault
nobody can reach into, and this game deliberately does not have one. What it has instead is a CHOICE
with a real trade-off: money doing nothing is the most exposed thing you own (a killer takes half),
money you have committed to a stake is cheaper to be caught with (a fifth) — and neither is free.
Both answers help the city: committing keeps the currency moving, staying liquid keeps hunters in
business. On top of that, unstaking exposes the principal for six hours, staking pays no personal
yield (the yield goes to families), and every route out of the city passes an early-exit toll that
starts at 50% and decays over 48 hours.

**Flat passive income** (buy one time, then earn continuously — this is different from Businesses):
**Rackets** (`/v1/rackets/:id/buy`, Laundromat L3 to The Invisible Hand L100) and **Assets**
(`/v1/assets/:id/buy`, `/sell` for 80% — vehicles, property, and legal businesses that increase your cargo,
energy limit, or income).

**Trade goods** (10 goods, with a set price in each district) — buy at a low price, carry the goods in your
trunk, and sell at a high price. This is the start of the Black Market and convoys. Routes: `POST
/v1/goods/buy`, `/goods/sell`. The **Exchange** (M3) is a separate market for crates and ammo, with escrow.

---

## 6. The Kitchen

The Kitchen is a drug operation that earns income while you are offline: **makings → lab → cook → deal.** Your
**trade rank** controls it.

Loop: buy **makings** (`POST /v1/kitchen/makings/:drugId`) → **upgrade your lab** (`/kitchen/lab/upgrade`, 5
levels; the top levels cost $OMR) → **cook a batch** (`/kitchen/cook`) → **collect** (`/kitchen/collect`) →
**deal** (`/kitchen/deal`) or let your **crew** sell while you are offline.

- **Drugs** (8, unlocked by rank): VIM (base 90) to NOCTURNE (base 9000).
- **Cook** produces `demand × 12`, and 1 crate for each 20 units. There is a **fire** risk. You survive a
  fire but lose the batch. The risk is higher for lower quality.
- **Deal** income = demand × quality × city event × trade-rank bonus. It **adds heat** (this feeds the Law).
  A rank-0 dealer gets a **+50% bonus** on the corner. This bonus stops at rank 1.
- **Crew** (`/kitchen/crew/hire`, up to 5) sell your cheapest drugs while you are offline. But each crew
  member costs **$1,200 each hour in wages** (also called "the nut," `/kitchen/crew/wages`) whether the
  stash moves or not. If you do not pay for 3 days, the crew becomes **cold** and stops selling.
  **Keep them stocked and check in often.** Offline sales are capped at 8 hours' worth however long you
  are away, but the nut keeps running for up to a week — so a crew you visit three times a day earns
  about 3.6× its wages even on the cheapest line, a crew you see once a day barely clears it, and a crew
  you leave for three days costs more than it makes. That is the trade: they are staff, not a machine.
- **Letting one go** (`DELETE /v1/kitchen/crew`): square up what they are owed and one walks. If the crew
  has already gone **cold**, they walk for nothing — so you can always get out from under the nut. Their
  buy-in does not come back; hiring again starts at the first step price.
- **Lay low** (`/kitchen/laylow`, $5k plus energy, −25 heat) and **clean papers** (`/kitchen/cleanpapers`, 10
  $OMR) reduce your heat. Above heat 60, the Bureau can **raid** your operation.

Connections: deal heat feeds the Law meter. Crates feed the workshop and armory. Trade reputation feeds the
assassin and trade ranks.

---

## 7. Businesses & fronts

Businesses are premium, level-gated, **upgradeable** places that earn pocket cash — the endgame
personal-income engine, different from flat Rackets and Assets. Catalog: **Laundromat (L15) to
Casino (L58)**. Each has 3 levels. You can own one of each kind. `GET /v1/catalog` [public] lists
them all. *(Fronts no longer launder anything — cash can't become $OMR anywhere since the wash
houses shut.)*

Loop: **buy** (`/v1/business/:kind/buy`) → **collect** (income accrues, 24-hour limit,
`/business/collect`) → **upgrade** (`/business/:id/upgrade`) → **pay the upkeep**.

### The pad, and why a front can owe you money

**A front wants an owner who shows up, and the terms say so.** The till only holds a **day** of
takings (income stops banking after 24 hours) but the pad — protection and wages, 20% of the
hourly income — keeps running for a **week** whether you are there or not. So an absent owner can
genuinely owe more than the place can hand back. That is the deal working as written, not a
fault: it is what happens to an absentee owner. Collect every day or two and a front is an engine;
buy one and forget it and it is a debt.

- **Upkeep** (also called "the pad," `/business/upkeep`) — 20% of the hourly income, and it climbs
  5% for every extra front you run, on *all* of them. It accrues to a 7-day limit. Unpaid for
  3 days the business goes **cold** — no income, no upgrades, no specialization — until you square
  it out of pocket.
- **Closing up** (`DELETE /v1/business/:id`) — the way out. A cold front you cannot carry does not
  merely sit idle: you can only own one of each kind, so it holds that slot for the rest of your
  street's life. Close it and the pad stops and the slot frees; you can buy that kind again later
  at level-1 prices. It is permanent — the tier, the specialization and everything sunk in go with
  it, and you get back whatever `BUSINESS_SHUTTER_BPS` is set to (shipped at 0 — nothing).
- **The Bureau** — a front heats up by *earning*. Every full day's income you bank adds to its
  file; past the threshold the Bureau rolls a raid that seizes the pending take and fines you.
  Collecting often keeps the file thin and any raid small. **The Accountant** and **The Fixer**
  specializations halve the heat and the fine.
- **Shakedown** (`/business/:id/shakedown`) — a rival takes 30% of the pending income in a muscle
  and cunning contest (8-hour cooldown, costs energy and heat). You cannot shake down a family
  member or a safehoused owner.
- **The bigger threats** — a rival can attempt a **hostile takeover** (a forced sale), an
  inside-job crew heist can raid your pending take, and a killer who puts your street down can
  **SACK** your best front and run it themselves. A passive empire is risk capital — defend it.

---

## 8. Territory rackets

There is **one income operation in each district**. The family that holds the turf owns it. So wars are about
income, not only a one-time treasury payment. Ladder: **Numbers Racket ($50k) → Protection ($250k) →
Smuggling Front ($1M)**. The return on each level becomes smaller.

A boss or underboss **establishes** an operation on held turf from the treasury
(`POST /v1/territory/:districtId/establish`). Income accrues (24-hour limit) and **collects to the treasury**
(`/territory/collect`). **Upgrade** climbs the levels. You must pay **upkeep** (`/territory/upkeep`, 20% of
income; it becomes cold after 3 days). **When another family seizes the turf, the operation moves to the new
owner** (the pending income is lost, and the clock resets). The victor also pays a war premium of 50% of the
build cost. If a family is dissolved, its operations end.

---

## 9. Families

Families are player groups with a treasury, roles, wars, turf, and status badges.

**Found or join** — you found a family for $25k at L5 (maximum 20 members). You join a family immediately.
Roles: **boss / underboss / capo / crew**. Each role has an income multiplier.

**Tribute** — `/v1/gangs/tribute` (cash; this adds to the weekly task) and `/gangs/tribute/omr` (adds $OMR to
the family reserve). **Wars** (`/gangs/war/:targetGangId`) — you declare a war for $10k. It runs 30 minutes.
The winner takes 20% of the loser's treasury and standing. A jump-kill scores 1 war point. A fire-kill on a
family that you are at war with scores 3 points. **Turf** (`/districts/:id/seize`) — seize a district for its
benefits and its territory racket.

**The watch.** A holder declares the hour their family stands ready (`/districts/:id/watch`, boss or
underboss, free and changeable — the cost is having to BE there, though not once somebody is at
the door: with a contest running you are held to the hour you committed to). Inside that four-hour window, taking
the district is the plain price; outside it, catching them cold costs **1.5x**. A family that never
declares a watch is dear at every hour, so declaring is what buys you the cheap window. Every declared
hour is public on `/districts` — you are meant to plan around it, on both sides.

**The sealed bid.** A district *another family holds* cannot be bought at a published price — it goes
to a contest (`/districts/:id/claim`). Every family puts up a SECRET stake from its treasury; when the
window closes the highest takes the district, **the holder wins ties**, and the winning stake becomes
the new garrison. The board tells you how many families are in and never what any of them put up. A
loser gets half of their stake back and forfeits the rest, so committing everything against a family
that was never coming is how you lose money without losing a fight. A stake only ever goes up, and it
leaves the treasury the moment you make it — you cannot bluff with money you have already spent. The
watch still applies: staking outside the holder's declared window costs more just to get in.

**The map.** The six core districts are not a flat set — they border each other, and `/v1/districts`
publishes which. Geography prices the door from both sides. A district a family holds is **dearer to
come for once per bordering district that family also holds**, because they can reinforce across their
own ground: contiguous turf genuinely defends itself. And a district **next to ground you already
hold** is **cheaper for you** — your men are already on that side of the river. That is one foothold
discount however many borders you share, not a bonus for encirclement. So "we cannot defend the canal,
we do not hold the docks" is now a real sentence, and taking the district next to your own beats taking
the rich one across town.

**The charter — what your family IS.** Every family used to be mechanically identical apart from what
it happened to hold. Now the boss picks a charter, and every one of them trades an edge for a real
handicap — a charter with only an upside would be a free upgrade everybody takes, and then nothing is
asymmetric again. **The Syndicate** runs its operations 15% leaner but pays 15% over the odds for
turf. **The Outfit** takes ground 15% cheaper and pays 15% more to run what it holds. **The Fixers**
have the Bureau building its file 25% slower, but forfeit 25% more of a losing contest stake. Running
NO charter is a real answer — you get neither side, which is exactly the family you have today. The
first pick is free; re-founding costs the family reserve and locks for a week afterwards. The two
mirrors are deliberate: a Syndicate family and an Outfit family are each good at what the other is
bad at, so an alliance between them is complementary rather than just twice as big.

**The season has an ending.** A season runs 28 days in three phases you can read on `/seasons`:
**The Opening** (days 1–7 — cheap ground, nothing settled), **The Long Game** (8–21 — build and hold),
and **The Reckoning** (22–28). In the last week held turf is a quarter cheaper to challenge, contests
settle in half the time and a holder's watch window is halved, so an incumbent who has been sitting on
a district since week one has to defend it while the door is open. Nothing is reset or seized when the
books close — instead the city REMEMBERS: the top City Standing takes the season and the family holding
the most core turf goes on the permanent roll, and the champion's bloodline keeps the crown forever.
That is the whole point of the arc — you are not just accumulating, you are racing a clock.

**The posts.** A family fills five chairs — the Enforcer, the Caporegime, the Streetboss, the
Quartermaster and the Bagman (`/roster`, boss or underboss). **One post per made man, one man per
post**, so your best man can do one job and not the others; each post reads one stat, and what it is
worth scales with the man in it. What makes this worth fighting over: **a post is dead while its
holder is dead, in lockup or in the hospital** — put a family's Enforcer in the hospital and their
turf gets cheaper to take without your ever going near the district. They can fill the chair again
straight away, but only with somebody who was on the STREET; you cannot slide a man across from
another post for six hours — nor stand him down and walk him into the next chair, which is the same
shuffle — so answering a hit costs the family a second made man. Every post is a
bonus, never a requirement — the scarcity is which chairs you fill, not that the baseline moved.

**The reserve pays for status:** **seals** (`/gangs/vanity/seal`, Wax 150 to Obsidian 9000 $OMR, a badge) and
the **Foundation** (`/gangs/foundation`, Community Fund 360 to The Legacy 18000 $OMR). The Foundation is real
power: it **reduces the RICO conviction chance of every member** and speeds their case bleed (only members
present when a case was filed get the benefit). The family also holds a legal **RWA book** that earns a
dividend (section 27).

Routes: `POST /v1/gangs` (found), `/gangs/:id/join`, `/gangs/leave`, `/gangs/kick`, `/gangs/promote`, tribute
×2, war, seize, foundation, vanity (color/name/seal). `GET /v1/gangs` [public], `GET /v1/gangs/:id`.

---

## 10. The Commission

Server-wide player politics, with no money — only status and weekly rule changes. The **top 5 families by this
season's standing** (`season_tribute + 10000×season_wars`, recomputed live) hold the seats. Each seated boss
or underboss casts **one public vote each week**. The **majority of last week's votes controls this week** (a
tie or no votes means no decree). The boss of the first seat can **veto** one time each week.

**Decrees** (each changes one thing): **Open Season** (safehouse stays ×0.5 — every player is more exposed),
**Pax** (no player can declare a new war), **Amnesty** (lay-low ×0.5), **Lockdown** (convoy defense +20).
`GET /v1/commission` [public], `POST /v1/commission/vote`, `/commission/veto`.

---

## 11. The Den

Player-against-house and player-against-player gambling at the Neon Mile. **CASH ONLY, never $OMR** (this is a
legal rule). Every result is calculated on the server and recorded. The house adds 1% of stakes to the
street-tax pool, **only from real profit**. `GET /v1/casino` [public].

- **Street craps** (`/v1/casino/dice`) — the pass line in one action, 1:1, edge about 1.41%, 1 nerve, $100 to
  $250k table ($2M in the high-stakes room at L30 or higher).
- **The Numbers** (`/v1/casino/numbers`, `/numbers/claim`) — pick a number 0–999, bet $10 to $1000, **one
  ticket each day**, drawn from the daily seed, pays **600:1** (edge about 40%). Claim finished tickets when
  ready.
- **Back-room PvP dice** (`/v1/casino/fade` to list, `/casino/dice/:targetId` to challenge) — you agree by
  listing a fade limit. It uses 2 dice for each player. The winner takes the pot minus a 5% rake.
- **The weekly Fight** (`/v1/casino/fight`, `/fight/claim`) — one bet of up to $5k each week on a favorite
  (which wins 65% of the time). The boss of the family that holds Neon can **fix** the result one time each
  week for $50k from the treasury.
- **The Track** (`/v1/casino/track`, `/track/claim`) — the greyhounds and the horses. There is a **daily**
  race card. Each race has 6 runners with posted odds. The odds include a 15% house share. You make one
  **win** bet for each race each day, $50 to $10k. The winner comes from the daily seed (this is fair; the
  odds carry the house share, not the draw). Claim finished tickets at the posted odds.
- **Rakeback** — owners of a casino business share 1% of the Den's stake volume.

### The Stable — own the dogs & the ponies

You can also OWN racing animals (this uses the boxing-stable pattern). **Buy** a greyhound ($30k) or a
racehorse ($120k) at level 6 or higher (`/v1/stable/buy`). **Train** its speed, stamina, and heart
(`/v1/stable/train/:id`, cash and energy, with a limit). **Race** it. The PvE **circuit** pays a purse
(`/v1/stable/circuit/:id` — the entry fee is lost win or lose; the purse pays only for a win). The PvP **match
race** is against another owner's animal of the same kind (`/v1/stable/match/:opponentId` — you agree by
listing a wager; the winner takes the pot minus a 5% share). You can run up to 3 animals. An animal **dies
when your character dies**. Your lifetime wins are an **owner record** that survives death
(`/v1/leaderboard/stable`). CASH only. **Breed** two animals of the same kind into a foal that inherits their
form (`/v1/stable/breed` — this is a head start, not a way to pass the limit; both parents retire). Enter **The
Stakes** (`/v1/stable/stakes/:id`) — a scheduled major race. A cash buy-in goes into escrow as a purse. The
worker races the field, and the top places share the purse minus a 5% rake. (Mickey the Cornerman — the
Underworld boxing fixer — also trains your animals; his standing reduces the training cost.) **Run in the
card** (`/v1/casino/track/enter/:racerId`) — enter a fit animal into The Track's daily card (its kind's race,
$5k entry fee, up to 2 owner entries a race). The whole town bets on it. The worker records its win for the
animal and your owner record. Track bets now lock **fixed odds** at bet time. So a player animal that enters
in the middle of the day changes the board but does not change settled tickets. **The Futurity**
(`/v1/casino/futurity/nominate/:racerId`, `/v1/casino/futurity/bet`) — the major race where the Stable and the
Track meet. Owners **nominate** their animals ($5k fee, up to 8 in the field). The **whole town bets
parimutuel** on the race (one bet for each player; you cannot bet on a card that has your own animal). At the
window close, the worker races the field on form. The winners share the losing pool minus a 5% share. The
winning owner takes a promoter's purse. The animal records a win. This is different from The Stakes: The
Stakes has owners competing for a pooled buy-in; the Futurity has the crowd betting on the field.

---

## 12. The Speakeasy

There is one prestige **nightclub in each district**. A made man opens it (L15, $750k). It is a business, a
casino, and a social place. It dies when the owner's character dies. `GET /v1/speakeasy` [public].

- **Collect** the bar income (it accrues, 24-hour limit). **Upgrade** the decor levels (Backroom to The
  Cathedral). **Name** it (this costs $OMR).
- **Be seen:** a player in the district can **buy a round** (`/speakeasy/:districtId/round`, a taxed cash
  payment to the owner; it adds the player to the guest list; 1-hour cooldown; 10 visits make a "regular").
  A player can also buy **bottle service** (`/bottle`, a $OMR status payment, for large prestige).
- **The back-room table** (`/table`) — a cash game. The owner takes 3%. It adds **notoriety**.
- **Prohibition raids** — notoriety above 60 causes a raid. The raid takes the pending income, fines the
  owner, and closes the club for 2 hours. One player can only add limited heat to a club each day.
- **Cross-club renown** — a personal nightlife record (Nobody to King of the Night). It unlocks earned decor.
- **P2P buyout** (`/list`, `/:districtId/buy`) — an agreed, taxed sale. The hostile **Standover**
  (`/:districtId/standover`) — pay a $250k fee (lost win or lose), win a muscle contest, and force the owner
  to sell at the club's assessed build value.

---

## 13. The Fights

Sign and manage a **stable of up to 3 boxers** (L8, $50k each). Train the boxer. Fight the boxer against other managers.
`GET /v1/boxing`.

Loop: **recruit** (`/v1/boxing/recruit`, stats power/chin/speed set to 6–14) → **train** (`/boxing/train`,
$20k plus energy, +1 to a stat, limit 25) → **list a bout limit** (`/boxing/list`) → **fight**
(`/boxing/fight/:opponentId`). The bout uses each fighter's three stats plus a random amount. The winner takes
2× the stake minus a 5% rake (this is the same taxed transfer as PvP dice; no new money is created). The
loser's fighter is **in the hospital for 4 hours**. The fighter dies when your character dies. Ranks: Prospect
to Hall of Famer (30 wins).

---

## 14. PvP

**Jump** (`POST /v1/streets/:targetId/jump`) — not lethal. It costs energy and ammo. It steals up to $25k of
pocket cash. It puts the target in the hospital for about 3 minutes. It scores 1 war point.

**The hit (search then fire).** Put a **search** on a target (`/streets/:targetId/search`, about 3 hours to be
ready; cancel it with `DELETE /streets/search`). Then **fire** (`/streets/:targetId/fire`) when it is ready. A
fire costs energy, needs 50 fp or more, has a 2-hour cooldown, and **adds +20 heat**. On a kill, the game runs
the victim's estate. It **takes 40% of the victim's real cars** for you. It **loots** their cash and $OMR (see
section 15). It has a 15% chance to take one piece of gear. It **swears a vendetta**. It pays any open kill
contracts. It scores war points. It earns you **hitman reputation**.

**NPC hit** (`/streets/:targetId/npchit`) — pay a fixed fee (Leg-Breaker $50k to The Professional $1M) for a
hit that the server calculates. **The fee is lost win or lose.** A weak player buys a *chance* against a strong
player, never a certainty. It adds heat, a 6-hour cooldown, and a 24-hour cooldown for each target. It pays no
reputation. You cannot use it against a family member, yourself, a jailed player, a new player (below L5), a
hospitalized player, or a safehoused player.

**The Contract Board** (`GET /v1/contracts` [public]) — bounties are escrow pots that you can view. There is
one pot for each (target, kind). A **hospitalize** pot pays for a jump or a kill. A **kill** pot pays only for
a completed kill. Post a bounty (`/streets/:targetId/bounty`, minimum $500; add 18 $OMR to post it
**anonymously**). You can name a **directed hitman** for an exclusive time window (minimum $10k, up to 24
hours, +1.5× reputation). This minimum is **removed** for a vendetta, rat, welsher, or wanted kill contract. A
**family contract** (`/gangs/contract/:targetId`) is paid from the treasury. The target can **peek**
(`/contracts/peek`, 30 $OMR) to read every funder. This removes the anonymity.

**Hitman reputation** is a status ladder (Associate to Button Man to Mechanic to Ghost to The Undertaker).
Your lifetime reputation and kills survive death (like prestige). This season's kills die with the character.
You earn reputation only from targets at L5 or higher. It is reduced if you kill the same family many times.
`GET /v1/leaderboard/hitmen`, `GET /v1/feud/:characterId` [public].

---

## 15. Make risk pay

A kill is designed to be worth the risk — contracts, war points, and loot all attach to it.

**Loot (only for a PLAYER fire-kill):** the killer takes 25% of the victim's **pocket and in-transit** cash and
20% of their **liquid and unbonding** $OMR. **Cleared bank cash and staked $OMR are safe.** (An NPC kill and a
mod kill take nothing.) A fire-kill also takes 25% of the victim's open market buy-order escrow and loan-offer
escrow.

**Loot surfaces** — this is why banking is a *timed* action: a new deposit is in transit for 2 hours, and
unstaked principal unbonds for 6 hours. Another player can take both during those times. Bank early. Stake to
be safe.

**Defenses (earned in the game):**
- **Safehouse** (`POST /v1/safehouse`) — the cost increases with your wealth (minimum $25k, or 1% of cash plus
  bank) for each 4-hour stay. A hit cannot target you, but a jump can. It is a **shield, not a base** — you
  cannot attack or move money from inside.
- **Bodyguard** — a guard lists a price (`/v1/bodyguard/offer`). You hire a guard
  (`/bodyguard/hire/:guardId`). The guard **absorbs one lethal hit** (the guard goes to hospital in your
  place). The game never absorbs the guard's own attack — betrayal defeats protection.
- **Revive insurance** (a real-ETH `respawn_token`) — it absorbs a lethal hit completely (full health, keep
  everything, no car loss, no loot, no estate). It is used before the estate runs.

---

## 16. The Law & RICO

The state is the PvE opponent. It reacts to your **heat**. `GET /v1/law` [public] is your record.

**The investigation meter** accrues slowly: heat above a threshold builds **exposure**, which decreases
slowly. Stages: **clean → watched → investigation → indicted** (which locks). A short heat spike costs little.
A long, high heat builds a case.

**Escapes (before it files):** **bribe** (`/v1/law/bribe`, scales with wealth, reduces the meter — blocked
when you are clean, indicted, or safehoused), the **lawyer retainer** (`/law/retainer`, $150k for 3 days,
reduces the bust and forfeiture), and the **envelope** (`/law/envelope`, 90 $OMR for 7 days — a standing
payment that halves the meter's *gain* and doubles its *decrease*).

**The RICO bust.** When you cross the line, the state files an **indictment** (a grace clock starts). A
conviction takes **30% of your pocket and bank** into the confiscation pool and jails you. But **staked $OMR
and minted gear are safe, and this is NOT death** (the Law is an economic opponent; death is PvP only). If you
stay offline past the grace window, the worker force-busts you (so a rich player cannot hide).

**The courtroom:** **plea** (`/law/plea`, a certain smaller loss plus short jail), **buy the jury**
(`/law/jury`, a $OMR payment that reduces the conviction chance), **demand trial** (`/law/trial`, resolve
now).

**Informants (Phase 4):** **flip** (`/law/flip/:targetId`) — drop your own case, add exposure to a rival, and
earn the permanent **rat** badge (it follows your family; a rat loses family omertà). **Witness protection**
(`/law/witpro`) makes you untargetable for a short time. If you kill a witness, the seeds they planted are
removed.

The **Foundation** (section 9) reduces family convictions. **Patrol hours** (section 4) increase convictions.

---

## 17. The Pen

Jail is a **place**. Every Pen action requires that you are locked up. `GET /v1/pen`.

- **Work the yard** (`/v1/pen/work`) — energy for a little cash, and it reduces your sentence (good
  behaviour).
- **The commissary** (`/pen/buy/:item`) — a **shiv** ($5k), a **burner phone** ($25k), a **cutkit** ($50k).
- **Protection** (`/pen/protection`, $15k) — a period when no one can shank you (the in-jail safehouse; it is
  a shield, so a protected inmate cannot shank either). **Bribe the guard** (`/pen/bribe`, per second) — the
  fast, expensive exit.
- **The shank** (`/pen/shank/:targetId`) — both players must be jailed. You spend a shiv and energy in a
  muscle contest. It passes street defenses but respects a revive token, witness protection, and omertà
  (unless the target is a rat), and protection or the hole. A successful shank is a **real death** (an heir, a
  sworn vendetta) but with **no loot, no car loss, and no reputation** (it is dishonorable). A caught attempt
  costs the shiv, more time, and **the hole** (solitary — you cannot act and no one can shank you).
- **Yard incidents** (a daily draw): Lockdown (no shanks), Riot (higher shank chance), Visit (cheaper
  bribes), Toss (commissary closed).
- **The burner phone** — the only way to reach outside: use it to call an NPC hit from your cell.
- **The breakout** — solo (`/pen/break`, needs a cutkit; a win clears your sentence but you become a **WANTED
  fugitive** for 2 days) or **co-op** (`/pen/break/plan`, `/breaks`, `/:id/join`, `/go` — a crew of 2–4; a win
  frees everyone and makes them WANTED; a loss puts the whole crew in the hole).

---

## 18. Loan sharking

Player-to-player lending — the first PvP credit market. `GET /v1/loans` [public].

**Offer** (`POST /v1/loans`) puts the principal in escrow ($5k to $1M, rate up to 50%, term 1–72 hours;
optional **directed** to a named borrower, or **collateralized** by a car). A borrower **takes** the loan
(`/loans/:id/take`; one active loan at a time; the borrower pledges a car if it is secured, and that car
locks). The borrower owes `principal × (1 + rate)` by the due date.

**Repay** (`/loans/:id/repay`) returns the debt. A 5% vig splits between the street-tax pool and the
Loan House's lending pool. **Cancel**
(`/loans/:id/cancel`) removes an offer that no one took. **Default and collect** (`/loans/:id/collect`, past
due) — the lender takes the pocket and in-transit cash (cleared bank and staked $OMR are safe), takes the
pledged car, sends the borrower to hospital for 30 minutes, and marks the borrower a permanent **welsher** (no
one lends to them again).

A default also marks the borrower **WANTED** for 3 days: it removes omertà (even the borrower's family can hunt
them), it puts a pool-funded $25k bounty on their head (if they are L20 or higher), and NPC hunters look for
them. **Square your name** (`/loans/square`, $50k) clears WANTED, welsher, and the bounty. There is also a
**paper market**: sell an active loan's claim (`/loans/:id/sell`, `/:id/buy`). A lender with muscle can buy
risky paper at a low price.

---

## 19. Convoys

Bulk goods on a real 30-minute clock. They are visible, and players can ambush them. Turf gives protection.
`GET /v1/convoys` [public].

Loop: **open** a shipment from your district with a first load from the trunk (`POST /v1/convoy`) → **load
more** between the trunk and the market (`/convoy/load` — the manifest can be larger than your trunk limit) →
**depart** (`/depart`), and pick a **guard tier** (none, crew $5k, or heavy $20k — this is never public) and
optional **insurance** → it travels 30 minutes → **collect** at the destination (`/:id/collect`, one trunk
load at a time).

The route and a value band are announced, but never the manifest. **Ambush** (`/:id/ambush`) — spend energy,
ammo, and heat in a contest of your muscle and speed against the guards and the turf defense. If you win, you
take goods up to your trunk limit. There are up to 3 hijacks for each convoy (one for each attacker; only a
win reduces the guards). **Tolls** — if you collect at another family's docks, you pay 5% to their treasury.
**Insured** freight pays for a hijack, with a limit so that a group of related accounts cannot take honest
premiums.

---

## 20. Crew heists

The game's co-op content. `GET /v1/heists` [public]. Jobs: Payroll Office (crew 2, L8) → Inside Job (crew 2,
against a player's business) → Bank Vault (crew 3, L20) → Reserve Train (crew 4, L40). Each crew position is a
**role** (brains, muscle, wheelman, gun). The success calculation uses each member's stat *for their role*. So
a crew of specialists can match a crew of generalists at a lower cost.

Loop: a leader **plans** and stakes the cost (`/v1/heists/plan`) → the crew **join** from the board by role
(`/:id/join`) → the leader **executes** (`/execute`), one calculation for everyone. Success divides the pot
evenly (1.2× for the leader). Failure jails the whole crew. **The Inside Job** takes 60% of a player business's
pending income (it refuses a hot, raid-eligible business). **The Rat** (`/:id/rat`) — any member can inform
silently. A ratted job fails automatically. The rat leaves with half the stake. The rest get double jail. The
feed only says "somebody talked." A successful standard heist also gives every crew member a small legal
**AAPL** stock share (section 27). The **solo Daily Score** (`POST /v1/heist`) shares an 8-hour cooldown.

---

## 21. The Black Market

Player-to-player trade. `GET /v1/market` [public]. **Cars sell by auction. Goods sell at a fixed price with a
district pickup. Standing buy orders (WTB) let buyers name a price.** (Gear is not here; its market is the
GearVault on the blockchain.)

- **Car auction** — one standing bid, an optional buy-now, a hidden reserve, and an anti-snipe soft-close. An
  outbid player gets a refund immediately. A listed car locks (no melt, fence, or repair).
- **Goods** — a fixed price. The buyer must **stand at the listing's dock** with trunk space (partial buys are
  allowed). The market cannot move freight past the convoy game.
- **Buy orders** — a buyer escrows quantity × price at their dock. Sellers who stand there fill the order from
  the trunk and are paid at once. The goods wait until the buyer claims them.

Routes: `POST /v1/market` (list), `/:id/bid`, `/buy`, `/cancel`, `/market/order`, `/:id/fill`, `/:id/claim`. A
1% listing fee and a 2% sale fee apply. If the poster is killed, the escrow refunds bidders (and burns their
own).

---

## 22. Vendettas

A **blood feud** starts after a fire-kill — status only, no money. `GET /v1/feud/:characterId` [public]. A
player fire-kill swears the victim's family against the killer's family **for 7 days**. The heir inherits the
feud and gets a message. A **revenge fire-kill inside the window** ends the feud, pays 2× feared-reputation,
and feeds the streets feed. Revenge also **removes the directed-contract minimum** on a kill contract against
your vendetta target. An NPC kill and a mod kill do not start a feud.

---

## 23. Skills

Your character build. **Three branches, FOUR levels each** — the 4th a capstone that also unlocks an
ACTIVE ability. Points **come from your level** (`floor(level/4)`, plus a small prestige bonus — a full
branch is about L40). Skills **die with the character**. Respec for 60 $OMR on the shared 24-hour
cooldown. `GET /v1/skills`, `POST /v1/skills/:id`, `/skills/respec`.

- **Enforcer** — Bruiser (jump and shakedown ×1.08) · Doctor's Friend (heal ×0.75) · Executioner (search
  ×0.8).
- **Operator** — Fast Talker (lay-low ×0.8) · Fence Network (fence and melt +8%) · Broker (listing fees
  ×0.5).
- **Wheelman** — Pack Mule (+3 trunk) · Getaway (crime jail ×0.8) · Road Captain (own convoys 20% faster).

### The Trades (mastery — learn by doing)

Ten **use-XP tracks** — the RuneScape shape: every job, deal, race and bout schools its own craft, and
nothing else does (XP is never bought, gifted or traded). `GET /v1/mastery` is the board; the catalog is
public on `/v1/rules.mastery`.

| Trade | Fed by |
|---|---|
| Larceny | street crimes (success) |
| Wet Work | fire kills · shanks · duels |
| The Cook | cook collects · deals |
| Wheels | boosts · street races |
| Seamanship | clean port landings · piracy wins |
| The Gambler | dice · blackjack · numbers · track bets |
| Protection | jump wins · shakedowns · standovers |
| Commerce | goods sales · market fills |
| Big Scores | the daily Score · crew heists |
| Fisticuffs | boxing bouts · exhibitions |

The curve is the game's own quadratic (level = √(xp/15)+1, capped at 50); ranks run Green → Apprentice →
Made → Craftsman → Expert → **Master of the Trade**. Levels **die with the street** — the heir inherits
**25% of each track's XP** (the bloodline echo) — while a lifetime, account-level XP **legend** survives
death whole and ranks the `GET /v1/leaderboard/trades` board (Dabbler → A Legend of the Life; agents
excluded).

**Milestone perks (step two):** each trade carries ONE perk that deepens at L10/25/40 — shorter jail
stints (Larceny), a faster search clock (Wet Work), faster batches (The Cook), discounted tunes and
boat refits (Wheels, Seamanship), a higher PvE table limit (The Gambler — access only, the odds never
move), harder jumps and shakedowns (Protection), cheaper listings (Commerce), the Score lining up
sooner (Big Scores), fighters healing faster (Fisticuffs). Den plays under **$1,000** school nothing
(no min-bet farming). At **level 50**, choose a permanent trait — **Virtuoso** (the perk deepens
further, for this life) or **Dynast** (your heir keeps HALF this trade's schooling instead of a
quarter). The choice dies with the street; the heir chooses their own.

**Paths v2 (step three):** six careers now — The Gun, The Ledger, The Kitchen, **The Wheel, The
Shadow, The Ring** — each with a signature edge, a REAL handicap (the Gun sells goods at ×0.95, the
Ledger fights at ×0.95, the Kitchen does ×1.1 jail time, the Wheel cooks slow, the Shadow shies from
duels, the Ring pays the Doc ×1.15), and trades that come easy (**×1.5 XP**) or fight you (**×0.6**).
The Ledger's long-advertised +10% front income is finally real. Switching careers takes the 150 $OMR
AND a week between moves.

**Stats by use (step four):** working a trade also exercises its core stat — each XP-paying action
has a small chance of +1 to the track's stat (larceny builds cunning, wet work builds muscle,
wheels builds speed…), on the gym's own diminishing curve, hard-capped at **3 points per rolling
day** whatever you play. The gym is still the fast lane; this just makes plying your trade FEEL
like training it. Your board shows today's remaining allowance.

---

## 24. The Underworld

Five **named fixers** that you build a *relationship* with (standing 0–100, for each character).
`GET /v1/underworld`.
- **Doc Moretti** (survival) · **Vinnie the Match** (contracts) · **Bella Bang-Bang** (gear) ·
  **Big Tuna** (trade) · **The Madame** (the Den).

You **earn standing when you work with a fixer** (healing, buying guns, posting contracts, killing, running
convoys — each action adds standing to the correct fixer). The limit is 25 standing each day. Levels at 25, 60,
and 90 unlock single perks: Doc gives heal discounts and early discharge; Vinnie gives NPC-hit and
contract-fee discounts and faster searches; Bella gives gun and craft discounts and a gun buyback; Big Tuna
gives guard discounts, longer listings, and a 4th market slot; the Madame gives no-nerve dice, high-stakes
access, and a hunter count.

- **Gifts** (`/underworld/:npc/gift`, $5k, +5) only work below 50 (you must earn the top levels).
- The **daily lead** — do the fixer's assigned task one time each day with your best fixer for a bonus (and a
  streak).
- **Rivalry and grudges** — a kill costs you standing with the Doc. If you kill a fixer's friend (standing 60
  or higher), you get a **grudge** that limits your level with that fixer until you pay **penance**
  (`/underworld/:npc/penance`, $25k). **Decay** reduces idle standing toward level 1. A **weekly favor**
  (`/favor`, level 3, a resource package) and an **errand chain** (`/errand`, 3 days for a bonus) reward
  loyalty. Your heir inherits 25% of your standings.

---

## 25. The Wire

Information as a $OMR resource that you can spend. `GET /v1/wire`.
- **Wiretap** (`/v1/wire/tap/:targetId`, 48 $OMR, 12 hours, up to 5 at one time) — shows a rival's Law stage
  and heat band, wealth band, operations, WANTED status, and **if they are hunting you** (this pierces the
  peek space).
- **Sweep** (`/wire/sweep`, 30 $OMR) — removes every tap on you (free when you are clean).
- **The Street Wire subscription** (`/wire/subscribe {tier}`) — a **tiered ladder**: Street Wire (72 $OMR for
  7 days — Law forecasts and threat data: a *count* of hunters and contracts on you, never a
  name; the layered intel economy — the subscription warns you, a tap identifies a rival, and the $OMR peek
  names funders), The Wire Room (30 — plus your family war room and 2 standing watches), The Switchboard (60 —
  plus 5 standing watches).
- **The Standing Watch** (`/wire/watch/:targetId`, tier 2 or higher) — enroll a target and the Wire
  **renews the tap from your $OMR** each cycle (`intel:watch`). So the surveillance runs while you are offline
  (limited by your balance and the tier's slots). It pauses if you run out of $OMR or the subscription ends.
  Use `DELETE` to stop it.
- **Tradecraft and the Spymaster board** — your lifetime intel actions rank you (Eavesdropper to The Oracle).
  This gives more wire slots and a discount on intel reads. The **watchdog** sends you a live alert the moment
  a tapped target becomes hot (hunts you, becomes wanted, or is indicted). Also: **bug trace** (name your
  watchers), **dossier** (a deep read), **disinformation** (send false data to your watchers), and
  **informant** (a human source that passes disinformation).

---

## 26. The Store & the Ledger

**The Store** (`GET /v1/store` [public]) — real-money (ETH) packages that grant **only non-currency items**
(this prevents pay-to-win: entitlements, access windows, cosmetics, and status — never cash, $OMR, gear, or
power). Packages: Made Man (a mint credit), revive bundles, a 30-day Street Wire, the Season Pass, the Patron's
Ring badge, and decor styles. The revenue divides 40% to the founder, 40% to the buyback (the Vig, which funds
withdrawals and prizes), and 20% to the RWA reserve.

**Every real-money price is ETH.** There used to be a second rail — PLEX, which let you pay a fee or a
package in earned $OMR — and it is retired. Two reasons. A fee payable two ways is always priced by whichever
rail is cheaper, which is fatal for the mint, since becoming Made is what unlocks extraction and so is the one
price that must be unambiguous. And a Store package is a real-money *product*: its whole purpose is the revenue
split, and paying in $OMR routed the purchase around it.

That costs you nothing on the free road: the mission ladder's *Dockside Heist* hands you a mint credit
outright. And $OMR keeps every in-game use it had — dues, the compound, family seals, the Wire, vanity,
respec, the staked ladder. The line is simple: **real money buys real-money things; $OMR buys in-game
things.**

**The Season Pass / The Ledger** (`GET /v1/pass`, `/pass/claim`) — while your pass is active, claim the next of
12 levels one time each day: titles, revive tokens, energy refills, and small **$OMR stipends** paid from the
funded prize pool (never created). This is account-level, so it survives death.

---

## 27. Going Legit

**The stock book is retired** (D11, 2026-08-05): the game sells no shares, real or fictional — the
tickers, the invests, the Dynasty Fund and its leaderboards are gone, and their routes answer
`retired` rather than 404 so nothing has to guess. Going legit now means what your **earned $OMR**
actually does:

- **Stake it** (`/v1/stake`) — a held balance climbs the ladder (trunk, energy, nerve, garage, the
  fence at the top), and a committed balance is looted lighter than an idle one when you die.
- **Redeem it** at the Window for cash (below).
- **Claim backed ETH** at the Vault (`GET /v1/vault`) — real ETH the treasury holds, never more than
  it holds; big moves draw the Bureau's eye and are blocked from a safehouse.
- **Get Made** (`/v1/made`) and take your $OMR out on-chain (`/v1/withdraw`).
- **Landmarks** (`/v1/landmarks/:districtId`) — one plaque in each district still bears a name that
  survives death.

### The Window and the Family Yield (tokenomics v2)

How $OMR works changed (`omerta-tokenomics-v2-design.md`). **Cash no longer buys $OMR** — the wash houses
are shut, laundering at your own front is gone, and the swap says so plainly if you try it. In exchange:

- **The Window** (`GET /v1/window`, `/v1/window/redeem`) — burn $OMR, take in-game cash at a published
  rate, from a till that the street take fills. It runs **one way only**: cash never becomes $OMR again.
  The till can run dry, and a short window refuses and **burns nothing** — it is a claim on what was
  funded, never a promise. There is a daily limit per account. It is **open**, which it could not be
  while cash still bought $OMR: the two together would be a money pump, and the game refuses to run both.
- **The Family Yield** (`GET /v1/yield`) — the top families by this season's standing split a pot of $OMR
  into their reserve. The pot is fed by **the family's cut of every redemption at the Window** — a small
  share of what a player burns goes to the families instead of leaving supply, so the yield scales with
  real redemption volume. It is what staking rewards and personal dividends become: standing stops being
  only a badge and starts paying, so tribute, wars and the Commission are worth real money to a family.
- **The Vault** (`GET /v1/vault`) — four streams of real ETH (the DEX sell tax, treasury bonds, the
  store, game fees) fund the protocol: liquidity, the withdrawal reserve, the founder, and a treasury.
  Burn earned $OMR and you claim a share of what that treasury actually holds. It is **backed by ETH,
  not by stock** — until 2026-07-31 the vault was denominated in real tokenized shares; that layer is
  retired. The rule is the same one it always had and is now unbreakable: **the house never owes more
  than it holds**, and with ETH on both sides no price move can change that. The board publishes what
  came in and from where, so you can check the claim yourself. Allocation only — nothing is delivered,
  no sell, no cash-out.

---

## 28. The Estate & Auction House

**The Estate** (`GET /v1/estate`) — a deep, account-level (death-proof) $OMR cost and a "home" surface: buy
levels (Safe House 240 to The Compound 36000 $OMR), unlock features (Trophy Room to The Menagerie), name it, and
show **trophies** that come from your real holdings (rarest car, guns, book value, kills, family seal). Status
only. `POST /v1/estate/upgrade`, `/feature/:id`, `/name`.

**The Auction House** (`GET /v1/auction` [public]) — a competitive weekly $OMR cost: 3 unique numbered prestige
items each week. The highest **$OMR bid wins**, and **the winning bid burns** (it reduces the supply). Bids go
into escrow. An outbid bidder gets a refund immediately. Won items are account-level and survive death.
`POST /v1/auction/:lotId/bid`.

---

## 29. The chain

OMERTÀ settles on Robinhood Chain (an EVM L2). The blockchain layer is built but **not active until mainnet**
(behind legal and audit approval). The design: the off-chain game is authoritative; the blockchain settles
withdrawals and ownership proofs. The ONE place new $OMR is created on-chain is bonds — minted at
bond time inside hard walls (a daily cap, a discount ceiling, a rate ceiling).

- **Withdraw $OMR** (`/v1/withdraw`) — this burns your $OMR (a legal burn) and signs an EIP-712 voucher **only
  if the reserve can back it** (the full-reserve queue; if not, it waits in a queue). Every withdrawal pays a
  **2% exit toll** (steeper on tokens younger than 48 hours — the early-exit tax). **Only a minted account
  can extract.**
- **Gear withdrawal** (`/gear/:id/withdraw`) — mints your in-game gear as an ERC-1155 NFT (it leaves the game,
  and it becomes safe and tradeable).
- **Wallet link** — SIWE (`/wallet/challenge`, sign, `/wallet/verify`). **Character mint**
  (`/character/mint`) — a 0.01 ETH fee makes a free-trial character permanent (able to withdraw). Revive
  insurance is a 0.10 ETH fee.
- **Bonds** (`GET /v1/bonds` [public], `/bonds/:id/claim`) — the Reserve Bond (Protocol-Owned Liquidity):
  deposit ETH to receive **discounted $OMR that vests over time**. The ETH deepens the OMR-ETH pool
  and feeds the Vig. Bonds are the ONE mint — new $OMR is issued at bond time inside hard on-chain
  walls (a daily cap, a discount ceiling, a rate ceiling).

The **Vig** is the real-revenue engine: fee, store, and bond revenue buys hard $OMR that backs withdrawals and
funds the prize pools.

---

## 30. Growth

**Paths** (`POST /v1/path`, at L5 for $10k; switch for 150 $OMR + a 7-day cooldown) — a career, not just a
bonus: SIX Paths (**The Gun**, **The Ledger**, **The Kitchen**, **The Wheel**, **The Shadow**, **The Ring**),
each with a signature edge, a REAL handicap, and trades that come easy (×1.5 mastery XP) or fight you (×0.6).

**Missions** (`/v1/missions/:id`) — 29 pay-once jobs with level and stat requirements. They pay cash, respect,
sometimes $OMR (a legal source, one time for each account), and titles.

**Daily contracts** (`GET /v1/daily`, `/daily/:id/claim`) — 3 drawn each day. Complete all three for a $OMR
bonus. **The Daily Score** (`/v1/heist`) is the best repeatable income at a low level (8-hour cooldown). **Check
in** each day for a streak bonus.

**Referrals** (section 7.13) — your referral code is your character **name**. A recruit qualifies after 4
conditions (L8, 40 jobs, 3 check-ins, $25k net worth). Milestones pay the recruiter cash and titles.
- **THE CREW BONUS** — the real reward, and the reason to recruit people who actually play. Every
  qualified recruit makes you earn **respect faster**, scaled by how far *they* have got: a recruit at
  level 5 is worth +5%, at level 10 +10%, at level 15 +15%, and so on in steps. It applies to every
  respect you earn, anywhere in the game. It is **live** — recomputed from your crew's current levels,
  so it rises as they rise, falls when one of them dies back to an heir, and stops when they stop.
  It is capped, and it is not a currency: it cannot be sold, given away or laundered.
  **Referrals no longer pay $OMR** (retired 2026-07-31).
- **Naming your referrer** — a recruit can type the sharer's street name in the **"who sent you?"
  field when they create their character** (a shared `?ref=` link pre-fills it), or — if they missed
  it — from the **"Did someone send you?" card on Start Here within their first 3 days**. Spelling is
  forgiven on case; attribution is set once and can't be changed after.
- **The spark** — a small EARLY payment ($2,500 for the recruiter, $1,500 for the recruit, cash only) when
  your recruit reaches L3 and 10 jobs, before full qualification — fast feedback so you continue to recruit.
- **Tier-2 "the family tree"** — when a recruit that YOU brought in then brings in their OWN qualified
  recruit, you earn a single $5k finder's fee (cash only, depth 2 only). This is a referral bonus, not a
  percentage.
- **The recruitment drive** — a time-limited event (a "🔥 RECRUITMENT DRIVE" banner) where every referral CASH
  payment multiplies. **The Recruiters** boards
  (`GET /v1/leaderboard/recruiters`) rank the top recruiters and families by recruits.
- **My Profile** (`GET /v1/profile`, the "My Profile" screen) — your personal page: who you are (mood,
  member-since, generation, family, honor, kills), your **Top 8** (every recruit you brought in, with
  their status — green / coming up / made), and **The Take** — exactly what recruiting has paid you in
  cash and $OMR, read straight from the ledger. Your copy-the-link and share buttons live here too;
  the link carries your name as the referral code.

**Spread the Word** (`GET /v1/social`, `/v1/social/:taskId/claim`) — three daily social tasks (post about the
game, share your code, follow or repost). Each pays a small amount of **cash** ($300; $500 for all three). Cash
only, one time each day, agents excluded. A share pays in two steps: first you REGISTER it (the claim button starts the clock), then it pays only after the post has STOOD for 4 hours — if the server runs live verification, a deleted post pays nothing. The share links carry your name as a referral code, so real sharing
feeds the referral system. (This needs `SOCIAL_VERIFY_MODE` not equal to off; a wrong deploy shows the tab but
pays nothing.)

**The First Week** (`GET /v1/onboard`, `/onboard/:taskId/claim`) — a short checklist (do a job, boost a car,
use the bank, declare a Path, join a family, link a wallet, follow on X). It pays cash to teach you the
game, with a final bonus. **The Coach** (the ▸ line on your sheet) always names your single best next action.

**Vanity** — name change (30 $OMR), custom title (60), car plate (12), family color (60), family rename (150).

### For agents (autonomous players)
Agents are full players. `POST /v1/auth/agent-key` grants a permanent 🤖 flag and a 90-day token (limited to 1
action each 3 seconds). Discovery: **`GET /agents`** (the quickstart), **`GET /openapi.json`** (the full API
contract), **`GET /llms.txt`** (the discovery index), **`GET /v1/opportunities`** (the Opportunity Board —
every open economic action and skill loop, with the estimated value and risk, in one call), and
**`GET /v1/leaderboard/agents`** (the agent leaderboard). Agents earn by SKILL. The anti-abuse sources
(referrals, Spread-the-Word, assassin reputation) are for humans only; every economic loop is open. An MCP
server (`omerta-mcp/`) shows the game as MCP tools, so any MCP-capable agent can play directly.

---

## 30a. The Megaproject (the city builds a monument)

The whole server pools value toward ONE announced monument (`GET /v1/megaproject`; the City tab).
Contribute **cash** (`POST /v1/megaproject/cash`), **trade goods** from your trunk (credited at
catalog base value), or **$OMR** (at a fixed $500 rate). Every contribution is a BURN — this buys
glory, not power. Contributions clamp to what the wall still needs, and the whole city sees
milestones at 25/50/75%. When it completes, the monument joins **the skyline** on the city board
permanently, and the plaque records every contributor forever — tiered **The Architect** (top
brick) → Foreman (top 3) → Patron (top 10) → Builder. The plaque is account-level: your dynasty
keeps its glory through death. Monuments are raised in order (the Cathedral Restoration → the
Grand Casino → the Founder's Bridge → the Colossus of the Docks).

## 30a2. The Dueling Circuit, Clue Scrolls & the Season

**The Dueling Circuit** (Wet Work tab; `GET /v1/duels`) — the game's ranked ladder. List yourself
with a stake cap, challenge anyone listed: your BUILD fights (stats + gear), the stake changes
hands minus the 5% rake, and your **ELO** moves. The rating is seasonal (resets every 28 days),
dies with your street, and feeds `GET /v1/leaderboard/duels`. Lifetime wins are a dynasty legend.
Rematch-farming the same opponent pays less and less each day.

**Clue Scrolls** (the Streets tab) — a rare drop on any successful job starts a treasure trail. Trails
come in TIERS (easy 3 steps up to master 7), each riddle naming a district (sometimes an hour of day).
Travel there and DIG (5 energy). The last dig opens a **casket** ($3k up to $120k on a master scroll,
with a shot at a RELIC for the Collection) and counts on your lifetime diggers' legend. One hunt at a
time; after a casket the streets go quiet for 8 hours.

**The Season** (the City tab) — each 28-day season MAY carry one rule twist drawn from a public
pool (The Crackdown, Blood in the Streets, The Gold Rush — or a vanilla Dead Quiet season). The
banner on the City board tells you the season's law; it snaps back at rollover.

## 30a3. The deferred four: the Household, the Motion, the House Window & Ring Poker

**The Household & the Gala** (Estate tab) — your compound now RUNS: hire staff (Groundskeeper to
the Capo of the House) who draw daily $OMR wages on one household clock. Pay the book or they WALK
after a week — arrears die with the insult, but so do your hires. With a Butler on staff and a
square book, a tier-2+ house can throw a GALA: a big $OMR burn that opens the doors for four hours
and puts every guest's name on your list. `GET /v1/leaderboard/estates` ranks the great houses.

**Motions before the Commission** (Family tab) — a seated family's boss can now TABLE A MOTION:
stake a $100,000 treasury deposit to put a decree on the week's ballot. When any motions exist,
ONLY proposed decrees are votable; the enacted motion's deposit comes home, every other forfeits to
the confiscation pool. The fifth decree is **THE LEVY** — while in force, the family yield
pays the seated families by seat instead of the standing board. Politics finally pays.

**The House Window** (Shylock tab; `POST /v1/loans/house`) — the lender of last resort. Always
open, terms deliberately bad (35% for 24 hours, a level-scaled cap), and it lends ONLY what its
pool holds — the window is fed by half of every street vig, never printed money. Default and the
house ALWAYS collects: the sweep seizes what you have, brands you a welsher, and puts you on the
WANTED books.

**Ring Poker** (Den tab; `GET /v1/casino/ring`) — the den's skill game at last: real multi-way
hold'em with betting streets. The TABLE holds the money — you buy in, your stack lives on the felt,
and cash only moves when you sit down or stand up. Raises cap at the shortest stack (everyone can
always call), a 90-second clock folds stallers, the rake is carved from the pot. Die at the table
and your stack burns with you. The tournament also gained **THE BRACKET** — open it in bracket
format and the field plays down in rounds of heats to a televised final.

## 30b. The Cellphone & the Troll Box (talking)

**The Cellphone** (the 📱 up top; `GET /v1/phone`, `GET /v1/phone/thread/:characterId`,
`POST /v1/phone/dm/:characterId`) — your personal inbox + direct messages. The **inbox** shows what happened
TO you (a convoy jacked, a contract posted on your head, a fee credited); the **line** is player-to-player
DMs. Threads are ACCOUNT-level, so they survive death — the heir picks up the phone. 240 characters a line,
one message every 2 seconds, 30-day retention. No money ever rides a message. **Blocked lines**
(`POST`/`DELETE /v1/phone/block/:characterId`) — block a pest and they get a dead tone (they will know);
the block follows their bloodline until you lift it, and it only mutes their mouth — game events (a jump,
a contract on your head) still reach you. There is also a 📱 button on every street in Wet Work, and a
cell stop with an unread badge on the mobile thumb bar.

**The Troll Box** (`/v1/chat`, `/v1/gangs/chat`) — public city chat plus a family-only room (you only see
family chat from AFTER you joined — no back-reading a family you infiltrate).

## 30c. Street Life — the corner, the black book, the call

**Word on the Street** (`GET /v1/corner`, `POST /v1/corner/:slot/accept|claim`) — every district posts
3 daily tasks (the same board for everyone standing there, one CONFLICT job — a jump or a bust —
guaranteed). Take a job WHERE it's posted, do the work anywhere it happens, collect the envelope back
at the district: $400 + 15 respect each, at most 5 envelopes a day across the whole city. Only work
done AFTER you take a job counts.

**The block's standing job** — work the same district's corner on **3 separate days** and it pays a
**$1,500 + 40 respect** bonus on the last one. A second envelope in that district today still pays,
but it does not move the chain: a chain is days of showing up, not a busy afternoon. Finish one and
the block has another for you.

**The Black Book** (`GET /v1/contacts`) — phone numbers are EARNED, never free. You get a line three
ways: **meet them** (any completed face-to-face — a jump, a hire, a fade, a duel — hands BOTH sides
the other's number), **tap them** (a wiretap or dossier earns it one-way; they never get yours), or
**answer** (whoever rings you reveals their own number). The phone's compose list IS your book — a
stranger's 📱 reads 📵 until you earn the line. How many lines you hold is a **rank** — Nobody Calls up to The
Switchboard — and `GET /v1/leaderboard/contacts` ranks the busiest books in the city.

**Standing** — every job you finish for one contact deepens that relationship (a stranger → a
regular → a friend → family). A contact who knows you asks for **bigger loads and tips better**.
The money still comes from their own pocket, so a contact who cannot cover the bigger ask simply
does not call: standing moves what they ASK, never where it comes from.

**The Call** (`POST /v1/call/fulfill`) — contacts you've met ring you with paid requests: bring N
units of freight to their district (base × 1.15), or just come see them (a tip). The pay comes from
THE CONTACT'S OWN pocket — a real transfer, never minted — and an unanswered request lapses in a day.

**The Favor** (`GET /v1/favors`, `POST /v1/favors`, `POST /v1/favors/:id/run`, `DELETE /v1/favors/:id`) —
the player-posted call. Put up to 3 requests on the wire: N units of a trade good delivered to a
district, with the pay **escrowed the moment you post it**. Everyone who holds your number sees it;
whoever hauls the freight there takes the money on the spot, minus a 2% house cut. That escrow is
why this is worth posting at all — a runner can never cross town and find your pocket empty. Pull it
back any time and the money returns; nobody runs it in a day and the money returns by itself. But
escrow is cash sitting outside your pocket, so it is NOT a hiding place: you cannot post from a
safehouse, and a killer takes a quarter of every open favor you were holding.

## 31. Reference

### Districts
| District | Benefit |
|---|---|
| Docks | +50% contraband on crimes; the harbor; the start district |
| Neon Mile | +15% racket and business income; the vice district (casino, speakeasy) |
| Old Foundry | Workshop crafting −25% cash |
| Brick Yards | +2% crime success |
| Canal Row | +10% crime pay |
| Cathedral Hill | Nerve increases two times faster |

### The three "safe from looting" places
Cleared **bank** cash · **staked** $OMR · **minted (on-chain)** gear · your account-level **estate,
and prestige**. Everything else in your pocket is at risk when you die.

### Status marks on your sheet
**wanted** (hunted, even by family — square it) · **welsher** (defaulted, cannot borrow — square it) ·
**indicted** (a RICO case is filed — go to The Law) · **in transit** (a deposit is not cleared — another player
can steal it) · **unbonding** ($OMR is not liquid yet — another player can steal it) · **safehouse**
(untargetable, but you cannot act) · **hospital / lockup / the hole** (wait).

### Currency quick-reference
- **Cash** — earned everywhere. Pocket cash can be stolen. Bank cash is safe (after it clears).
- **$OMR** — the premium currency. It is earned by playing (never converted from cash), can be staked,
  and can be extracted (after you mint). It is account-level, so it survives death. A killer takes half a loose or
  unbonding balance and a fifth of a staked one — cheaper, never safe.
- **Crates (cb)** — from crimes and cooking. Use them to buy guns and make gear.
- **Ammo** — from melting cars, or bought at $2000 for 50. Used on jumps, fires, raids, and ambushes.

### "Three things with the same name" (do not confuse them)
- A flat **Racket/Asset** "Speakeasy", "Nightclub", or "Casino" (buy-once passive income) is NOT a **Business**
  casino or nightclub (an upgradeable front). Neither is **The Speakeasy** (the deep club system). Neither is
  **The Den** (the casino games). They are different systems.

### Test-only settings (never active in production)
`SEARCH_MS`, `SHOOT_CD_MS`, `CONVOY_MS`, `PASS_CLAIM_MS`, `LAW_BUST_P`, `SHANK_P`, `PEN_BREAK_P`,
`PEN_YARD_EVENT`, `BUSINESS_RAID_P`, `SPEAKEASY_RAID_P`, `WORLD_RAID_P`, `SPEAKEASY_STANDOVER_P`,
`GEAR_LOOT_CHANCE`, `WANTED_HUNT_P`.

### Discovery endpoints
`GET /v1/rules` [public] (the rulebook — crimes, guns, drugs, catalogs), `GET /v1/catalog` [public]
(businesses), `GET /` (the console), `GET /wiki` (this codex), `GET /admin` (the live-ops dashboard, needs the
mod key).
