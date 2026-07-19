# OMERTÀ — The Codex

The complete knowledge base for OMERTÀ, a multiplayer noir mafia RPG. Every system, every gameplay loop,
every number that matters. This is the canonical text; the same content is served in-game at **`/wiki`**
(the CODEX button, top bar).

> **How to read this.** Numbers are the current tuning (founder sign-off levers — they can change).
> Routes are `/v1/…` and need a logged-in character unless marked **[public]**, **[mod]**, or **[chain]**.
> "Level N" means character level; level comes from respect: `level = floor(sqrt(respect/4)) + 1`
> (L5 ≈ 64 respect, L10 ≈ 324, L20 ≈ 1444, L30 ≈ 3364).

---

## Table of contents
1. [The core loop](#1-the-core-loop) · 2. [Your character, death & the heir](#2-your-character-death--the-heir) ·
3. [Cars, guns & gear](#3-cars-guns--gear) · 4. [The city & the living world](#4-the-city--the-living-world) ·
5. [The economy — $OMR, cash, laundering, staking](#5-the-economy) · 6. [The Kitchen](#6-the-kitchen) ·
7. [Businesses & fronts](#7-businesses--fronts) · 8. [Territory rackets](#8-territory-rackets) ·
9. [Families](#9-families) · 10. [The Commission](#10-the-commission) · 11. [The Den (casino)](#11-the-den) ·
12. [The Speakeasy](#12-the-speakeasy) · 13. [The Fights (boxing)](#13-the-fights) ·
14. [PvP — jumps, hits & contracts](#14-pvp) · 15. [Make risk pay — loot, safehouse, revive](#15-make-risk-pay) ·
16. [The Law & RICO](#16-the-law--rico) · 17. [The Pen (prison)](#17-the-pen) ·
18. [Loan sharking](#18-loan-sharking) · 19. [Convoys](#19-convoys) · 20. [Crew heists](#20-crew-heists) ·
21. [The Black Market](#21-the-black-market) · 22. [Vendettas](#22-vendettas) · 23. [Skills](#23-skills) ·
24. [The Underworld (fixers)](#24-the-underworld) · 25. [The Wire](#25-the-wire) ·
26. [The Store, PLEX & Season Pass](#26-the-store-plex--the-ledger) · 27. [Going Legit — the Portfolio & Dynasty](#27-going-legit) ·
28. [The Estate & Auction House](#28-the-estate--auction-house) · 29. [The chain — withdrawal & bonds](#29-the-chain) ·
30. [Growth — paths, missions, first week](#30-growth) · 31. [Reference — districts, gotchas, glossary](#31-reference)

---

## 1. The core loop

You are a nobody on the docks with $500. The loop that makes you a name: **pull jobs for cash → train your
stats → bank what you earn → set up earners that pay while you're gone → climb.**

**Crimes** (`POST /v1/crimes/:id`) — 29 jobs from Pickpocket (L1, 2 nerve, $40–120) to Empty the Federal
Depository (L110, 35 nerve, $160k–400k). Each has a level gate, a nerve cost, a cash range, and a jail
risk on failure. Success scales with **cunning** and **speed**, your gang level, some districts, and rank.
Jobs can drop **contraband crates** (used to buy guns/craft gear) and **makings** (kitchen ingredients).

**Energy & nerve** fuel actions and refill over time (lazily — there are no global ticks; everything
accrues when you act). Energy runs crimes and training; nerve runs the riskier plays. **Heat** is what
crime draws — too much and the Law opens a case (see §16).

**Train** (`POST /v1/train/:stat`) — 10 energy per session; muscle / cunning / speed. Gains diminish as a
stat climbs. **Heal** (`POST /v1/heal`) — pays to patch you to full; cost scales with how hurt you are.
**Check in** (`POST /v1/checkin`) — once a day; a streak pays `250×lvl + 100×lvl×min(streak,7)` + 20 energy.

**The Bank** (`POST /v1/bank/deposit|withdraw`) — **pocket cash gets looted when you're killed; banked cash
is safe.** But a fresh deposit rides **"in transit" for 2 hours** before it clears — lootable until then
(stacking deposits reset the clock). Banking earns ~2%/12h interest, metered (12h/day cap) and tapered
above $10M. **You can't bank from a safehouse.**

**Travel** (`POST /v1/travel/:district`) — $250 between the 6 districts; blocked in jail.

**Gotchas:** jail blocks almost everything; energy/nerve gate crimes and training; being in a safehouse
blocks your own offense and money-moving (it's a shield, not a base).

---

## 2. Your character, death & the heir

One living character per account. You start Level 1 (respect 0), 50 energy, 10 nerve, 100 health, $500,
muscle/cunning/speed = 5 each, on the docks.

**Respect → level → rank.** Respect is your XP. The **RANKS** ladder gives perks: L10 Hustler (+5% crime
pay), L22 Runner (+1 energy regen), L35 Enforcer (+5 attack), L50 Associate (Doc 10% off), L65 Soldier
(made man, −20% jail), L80 Capo (+1 nerve regen), L95 Underboss (+10% racket/front income), L110 Mob Boss,
L125 Don of the City.

**Effective stats** = base (trained) + gear boosts + asset boosts. **Firepower (fp)** comes from your
equipped gun — you need ≥50 fp to fire a lethal hit.

**Death & the estate (§7.9).** A lethal blow runs the **estate** in one transaction: **the street dies, but
your account survives.** An heir is born (a fresh character, generation +1) and inherits everything
account-level. **Dies with the street:** stats, skills, businesses, your speakeasy, kitchen crew, boxing
fighter, territory-op ownership (released), this season's kills. **Survives to the heir:** prestige, your
legit **portfolio/Dynasty** book, your **Estate** compound, Store **patron/pass**, dynasty name, **hitman
rep + lifetime kills**, minted status, revive tokens, and 25% of your **Underworld standings**.

**Prestige & seasons.** A season is 28 days. At rollover, level converts to **prestige** (`floor(level/2)`),
respect resets, and the top respect-grinders win an SPCX (stock) prize. **Respec** your stats for 15 $OMR
(`POST /v1/respec`, 24h cooldown, shared with skills).

Routes: `POST /v1/character` (create — name 2–24, unique among the living, optional `referralCode`),
`GET /v1/me`, `GET /v1/session` [public probe], `POST /v1/respec`.

---

## 3. Cars, guns & gear

**Cars & the Garage** (cap 12). 60 models from a County Auction Junker ($900) to The Tsarina's Ghost
($400k), each with drop weight, a melt (scrap) yield, and a book value; **trims** (Rusted → Coachbuilt)
multiply all three.
- **Boost** (`POST /v1/garage/boost`) — steal a random weighted car; 5-min cooldown.
- **Melt** (`POST /v1/garage/:carId/melt`) — scrap a car into ammo; 25% of the rounds tithe to your gang.
- **Fence** (`/fence`) / **Repair** (`/repair`) — sell for cash / fix damage.
- Cars **listed** on the market or **pledged** as loan collateral refuse melt/fence/repair.

**Guns & the Armory.** 15 guns from a Rusty .25 ($800, fp3) to the Long-Case 'Undertaker' ($400k, fp60);
each costs cash + crates. **Vests** (bought with $OMR) multiply survival. `POST /v1/armory/gun/:id/buy`,
`/equip`, `/unequip`, `/armory/vest/:id`, `/armory/ammo` (50 rounds for $2000 — **ammo is never
discounted; it's the anchor of the kill economy**).

**Gear** (~55 items, Common → Legendary, priced in $OMR) boosts your stats. Gear is the **tradeable
on-chain NFT** (the GearVault rail, §29). A player fire-kill has a **15% chance to strip one piece of your
in-game gear** — but **gear you've minted on-chain is safe** (it's left the game). Keep gear in-game to use
it (losable) or extract it on-chain (safe + tradeable, but it leaves play).

**Consumables** (bought with crates): espresso (+energy), medkit (+HP), Getaway Kit (walk out of jail),
Priest's Alibi (−heat), etc. `POST /v1/items/:id/use`. **Workshop** (`POST /v1/workshop/craft/:id`,
`/workshop/ammo`) crafts gear/ammo from crates + cash (cheaper in the Old Foundry district).

---

## 4. The city & the living world

The city runs on a **deterministic daily backdrop** — the same for everyone, knowable in advance.

**City events** (16, one per day, round-robin) modulate every loop: HEAT WAVE (job pay ×1.5, jail ×2),
DOCK STRIKE (contraband ×2), COMMISSIONER'S VISIT (jail ×0.5), THE CRACKDOWN (job pay ×1.75, jail ×1.5),
BUREAU SWEEP (deal heat ×2), THE THIRST (drug demand ×1.3), SUPPLY DROUGHT (makings +40%), OPEN CITY (heat
decays ×2), and more. `GET /v1/city` [public] shows today + a **7-day forecast** so you can plan.

**Regional weather** — a per-district daily price shock on trade goods (mean-neutral, 0.9–1.1×). **Day/
night clock** — during patrol hours (UTC 13:00–22:00) RICO convictions hit harder (×1.15); at night NPC
raids are easier.

**The 6 districts:** **Docks** (+50% contraband, a wash district), **Neon Mile** (+15% racket/front income;
the vice district — casino, speakeasy), **Old Foundry** (workshop −25%), **Brick Yards** (+2% crime
success), **Canal Row** (+10% crime pay, a wash district), **Cathedral Hill** (double nerve regen).

**NPC rival families** (`GET /v1/world`, `POST /v1/world/:npcId/raid`) — shared server-wide cash reservoirs
the whole player base grinds down together (positive-sum co-op): Zappa Crew (L8), Kryl Syndicate (L20),
Moreau Cartel (L40). A raid costs energy + ammo + heat, grabs a bounded slice, and pays a one-time bonus if
you drain one below its floor. Repelled → hospitalized.

---

## 5. The economy

**Currencies:** **cash** (pocket + bank), **$OMR** (the premium, launderable, extractable currency — held
at the account level, so it survives death), **crates** (cb), **ammo**. The sacred rule (§10.4): value
always *transfers*, it is never minted — every movement is ledgered and reconciled.

**The AMM swap** (`POST /v1/swap`) — a constant-product pool that converts cash ↔ $OMR.
- **Buy (cash → $OMR) = laundering.** Min $500; **only** at a wash district (Docks / Canal Row) or your
  family's turf; draws **+15 heat**; **blocked from a safehouse**; capped at $2.6M/account/day. Fee 1% +
  1% tax. Laundering is a deliberate, exposed act.
- **Sell ($OMR → cash)** — ungated, 2% house take.

**Staking** (`POST /v1/stake`, `/unstake`, `/claim-rewards`) — up to a **14% APY ceiling**, paid from a
**funded pool** (not minted): 30% of each buyback tops the pool. **Principal always returns whole, but
unbonds for 6 hours** (no yield, and lootable in that window) before it's liquid. Staked $OMR is safe from
looting; unbonding $OMR is not.

**The money flywheel:** cash sinks (swap tax, casino cut, various fees) feed the **street-tax pool** → a
12h **buyback** worker buys $OMR off the AMM → splits it: 30% to the staking pool, 25% to protocol-owned
liquidity, 50% to a family split by standing. This is how "spenders fund earners."

**Flat passive income** (buy once, drip forever — distinct from Businesses): **Rackets**
(`/v1/rackets/:id/buy`, Laundromat L3 → The Invisible Hand L100) and **Assets** (`/v1/assets/:id/buy`,
`/sell` at 80% — wheels/property/legit fronts that boost cargo/energy-cap/income).

**Trade goods** (10 goods, deterministic per-district price) — buy low, haul in your trunk, sell high; the
on-ramp for the Black Market and convoys. `POST /v1/goods/buy`, `/goods/sell`. The **Exchange** (M3) is a
separate escrowed market for crates & ammo.

---

## 6. The Kitchen

The offline-income drug operation: **makings → lab → cook → deal**, gated by your **trade rank**.

Loop: buy **makings** (`POST /v1/kitchen/makings/:drugId`) → **upgrade your lab**
(`/kitchen/lab/upgrade`, 5 tiers, top tiers burn $OMR) → **cook a batch** (`/kitchen/cook`) → **collect**
(`/kitchen/collect`) → **deal on the corner** (`/kitchen/deal`) or let your **crew** sell offline.

- **Drugs** (8, rank-unlocked): VIM (base 90) → NOCTURNE (base 9000).
- **Cook** produces `demand × 12`, crates 1 per 20 units; a **fire** risk you survive with your skin (loses
  the batch) scales against quality.
- **Deal** gross = demand × quality × city event × trade-rank bonus; **adds heat** (this feeds the Law);
  rank-0 dealers get a **+50% corner premium** that phases out at rank 1.
- **Crew** (`/kitchen/crew/hire`, up to 5) sell your cheapest lines offline — but each draws **$1,200/hr in
  wages ("the nut," `/kitchen/crew/wages`)**. Unpaid past 3 days the crew goes **cold** and stops selling.
- **Lay low** (`/kitchen/laylow`, $5k + energy → −25 heat) and **clean papers** (`/kitchen/cleanpapers`,
  10 $OMR) cool you down. Past heat 60 the Bureau can **raid** your operation.

Connections: deal heat → the Law meter; crates → workshop/armory; trade rep → the assassin/trade ranks.

---

## 7. Businesses & fronts

Premium, level-gated, **upgradeable** venues that farm pocket cash **and** launder privately — the endgame
Risk-to-Earn engine (distinct from flat Rackets/Assets). Catalog: **Laundromat (L15) → Casino (L58)**, each
a 3-tier ladder. One per kind. `GET /v1/catalog` [public] lists them all.

Loop: **buy** (`/v1/business/:kind/buy`) → **collect** (lazy, 24h cap, `/business/collect`) → **upgrade**
(`/business/:id/upgrade`) → **launder** (`/business/:id/launder`) → **pay the pad**.

- **Launder** cash → $OMR through the same AMM, but gated by the front's **daily capacity** (not the
  district) and drawing **less heat (8 vs the street's 15)** — your own books are safer. Still blocked from
  a safehouse.
- **Upkeep ("the pad," `/business/upkeep`)** — 20% of hourly income, accrues to a 7-day cap; unpaid past 3
  days the front goes **cold** (no income, no laundering) until squared.
- **Scrutiny & raids** — laundering builds scrutiny; past 60 the Bureau can **raid** (seizes pending income
  + a fine + shutters the front). Income-only fronts never get raided (their risk is PvP).
- **Shakedown** (`/business/:id/shakedown`) — a rival extorts 30% of a front's pending income in a
  muscle/cunning contest (8h cooldown, costs energy + heat; family/safehoused owners are off-limits).

---

## 8. Territory rackets

**One seizable income operation per district**, owned by whoever holds the turf — so wars fight over income
streams, not just a one-time treasury cut. Ladder: **Numbers Racket ($50k) → Protection ($250k) →
Smuggling Front ($1M)**, marginal ROI tapering.

A boss/underboss **establishes** on held turf from the treasury (`POST /v1/territory/:districtId/establish`),
income accrues lazily (24h cap) and **collects to the treasury** (`/territory/collect`); **upgrade**
climbs tiers; **upkeep** (`/territory/upkeep`, 20% of income, cold past 3 days) must be paid. **On a turf
seizure the whole operation transfers to the victor** (uncollected income forfeits, clock resets) plus a
war premium of 50% of its build cost. A dissolved family's operations die with it.

---

## 9. Families

Player factions with a treasury, roles, wars, turf, and status badges.

**Found/join** — found for $25k at L5 (max 20 members); joining is immediate. Roles: **boss / underboss /
capo / crew** (the command truth), with income multipliers.

**Tribute** — `/v1/gangs/tribute` (cash, bumps the weekly task) and `/gangs/tribute/omr` (pools $OMR into
the family reserve). **Wars** (`/gangs/war/:targetGangId`) — declare $10k, run 30 min, winner takes 20%
spoils + standing; a jump-kill scores 1 war point, a fire-kill on a family you're at war with scores 3.
**Turf** (`/districts/:id/seize`) — seize a district for its live perks + its territory racket.

**The reserve pays for status:** **seals** (`/gangs/vanity/seal`, Wax 25 → Obsidian 1500 $OMR, a badge)
and the **Foundation** (`/gangs/foundation`, Community Fund 60 → The Legacy 3000 $OMR) — the Foundation is
real power: it **softens every member's RICO conviction** and speeds their case-bleed (only members present
when a case was filed benefit). The family also holds a legit **RWA book** that earns a dividend (§27).

Routes: `POST /v1/gangs` (found), `/gangs/:id/join`, `/gangs/leave`, `/gangs/kick`, `/gangs/promote`,
tribute ×2, war, seize, foundation, vanity (color/name/seal). `GET /v1/gangs` [public], `GET /v1/gangs/:id`.

---

## 10. The Commission

Server-wide player politics, zero money — pure status + weekly rule modifiers. The **top 5 families by this
season's standing** (`season_tribute + 10000×season_wars`, recomputed live) hold seats. Each seated
boss/underboss casts **one public weekly vote**; last week's **majority governs this week** (ties or
silence → no decree). The head-seat boss can **veto** once a week.

**Decrees** (each one touchpoint): **Open Season** (safehouse stays ×0.5 — everyone's more exposed),
**Pax** (no new wars can be declared), **Amnesty** (lay-low ×0.5), **Lockdown** (convoy defense +20).
`GET /v1/commission` [public], `POST /v1/commission/vote`, `/commission/veto`.

---

## 11. The Den

Player-vs-house and PvP gambling at the Neon Mile. **CASH ONLY, never $OMR** (the regulatory line). Every
roll is server-side and audited; the house tips 1% of stakes to the street-tax pool **only out of realized
profit**. `GET /v1/casino` [public].

- **Street craps** (`/v1/casino/dice`) — the pass line in one call, 1:1, edge ~1.41%, 1 nerve, $100–$250k
  table ($2M in the high-stakes room at L30+).
- **The Numbers** (`/v1/casino/numbers`, `/numbers/claim`) — pick 0–999, $10–$1000, **one ticket per day**,
  drawn from the daily seed, pays **600:1** (~40% edge). Claim matured tickets lazily.
- **Back-room PvP dice** (`/v1/casino/fade` to list, `/casino/dice/:targetId` to challenge) — consent by
  listing a fade limit; symmetric 2d6; winner takes the pot minus a 5% rake.
- **The weekly Fight** (`/v1/casino/fight`, `/fight/claim`) — one capped $5k bet/week on a favorite (wins
  65%); the boss of the family holding Neon can **fix** the result once a week for $50k from the treasury.
- **Rakeback** — casino-business owners split 1% of den stake volume.

---

## 12. The Speakeasy

One prestige **nightclub per district**, opened by a made man (L15, $750k) — a front, a casino, and a
social hub in one. It dies with the proprietor's street. `GET /v1/speakeasy` [public].

- **Collect** the bar take (lazy, 24h cap), **upgrade** the decor ladder (Backroom → The Cathedral), **name**
  it (a $OMR burn).
- **Be seen:** a patron who's standing in the district **buys a round** (`/speakeasy/:districtId/round`, a
  taxed cash transfer to the owner, joins the guest list, 1h cooldown; 10 visits → "regular") or throws
  **bottle service** (`/bottle`, a pure $OMR status burn, big prestige).
- **The back-room table** (`/table`) — a cash wheel the owner rakes 3% of; draws **notoriety**.
- **Prohibition raids** — notoriety past 60 → a raid seizes pending income, fines the owner, and shutters
  the club 2h. One patron can only heat a club so much per day (anti-grief).
- **Cross-club renown** — a personal nightlife legend (Nobody → King of the Night), unlocks earned decor.
- **P2P buyout** (`/list`, `/:districtId/buy`) — a consensual taxed sale — and the hostile **Standover**
  (`/:districtId/standover`) — pay a $250k fee (burns win or lose), win a muscle contest, and force the
  owner to sell at the club's assessed build value.

---

## 13. The Fights

Sign and manage **one boxer** (L8, $50k), train them, and stake them against other managers. `GET /v1/boxing`.

Loop: **recruit** (`/v1/boxing/recruit`, stats power/chin/speed rolled 6–14) → **train** (`/boxing/train`,
$20k + energy, +1 to a stat, cap 25) → **list a bout limit** (`/boxing/list`) → **fight**
(`/boxing/fight/:opponentId`). The bout scores each fighter's three stats + variance; the winner takes
2× stake minus a 5% rake (the same taxed-transfer as PvP dice — no new money is minted); the loser's
fighter is **laid up 4 hours**. The fighter dies with your street. Ranks: Prospect → Hall of Famer (30 wins).

---

## 14. PvP

**Jump** (`POST /v1/streets/:targetId/jump`) — non-lethal; costs energy + ammo; steals up to $25k pocket
cash; hospitalizes the target ~3 min; scores 1 war point.

**The hit (search → fire).** Put a **search** on a mark (`/streets/:targetId/search`, ~3h to mature; call
it off with `DELETE /streets/search`), then **fire** (`/streets/:targetId/fire`) once it's ready — costs
energy, needs ≥50 fp, has a 2h cooldown, and **adds +20 heat**. On a kill: it runs the victim's estate,
**chops 40% of their real car fleet** to you, **loots** their cash & $OMR (see §15), a 15% chance to strip
a piece of gear, **swears a vendetta**, pays out any open kill contracts, scores war points, and earns you
**hitman rep**.

**NPC hit** (`/streets/:targetId/npchit`) — pay a fixed fee (Leg-Breaker $50k → The Professional $1M) for a
server-rolled hit. **The fee burns win or lose.** Weak buyers buy a *chance* at the strong, never a
certainty. Draws heat + a 6h cooldown + a 24h per-target cooldown; pays zero rep. Blocked against
family/self/jailed/rookies(<L5)/hospitalized/safehoused marks.

**The Contract Board** (`GET /v1/contracts` [public]) — bounties are browsable escrow pots, one per
(target, kind). A **hospitalize** pot pays on a jump or kill; a **kill** pot pays only on a completed hit.
Post one (`/streets/:targetId/bounty`, min $500; +3 $OMR to post it **anonymously**); name a **directed
hitman** for an exclusive window (floor $10k, ≤24h, +1.5× rep) — that floor is **waived** on a vendetta /
rat / welsher / wanted kill contract. A **family contract** (`/gangs/contract/:targetId`) funds from the
treasury. The mark can **peek** (`/contracts/peek`, 5 $OMR) to read every funder, piercing anonymity.

**Hitman rep** is a status ladder (Associate → Button Man → Mechanic → Ghost → The Undertaker) — lifetime
rep + kills survive death (like prestige); this season's kills die with the street. Rep only comes from
targets ≥L5 and is diminished for repeatedly killing the same bloodline. `GET /v1/leaderboard/hitmen`,
`GET /v1/feud/:characterId` [public].

---

## 15. Make risk pay

Killing is meant to pay — a skilled, risk-taking player can earn.

**Loot (only on a PLAYER fire-kill):** 25% of the victim's **pocket + in-transit** cash and 20% of their
**liquid + unbonding** $OMR go to the killer. **Cleared bank cash and staked $OMR are safe.** (NPC and mod
kills loot nothing.) A fire-kill also loots 25% of the victim's open market buy-order and loan-offer escrow.

**Loot surfaces** — the whole point of banking being a *timed* act: fresh deposits are in-transit 2h, and
unstaked principal unbonds 6h. Both are lootable in that window. Bank early, stake to be safe.

**Defenses (earned, in-game):**
- **Safehouse** (`POST /v1/safehouse`) — cost scales with your wealth (min $25k, or 1% of cash+bank) per 4h
  stay; **untargetable by hits, still jumpable.** It's a **shield, not a bunker** — you can't run offense
  or move money from inside.
- **Bodyguard** — a guard lists a price (`/v1/bodyguard/offer`); you hire one (`/bodyguard/hire/:guardId`).
  It **absorbs one lethal hit** (the guard goes to hospital in your place). The guard's own shot is never
  absorbed — betrayal beats protection.
- **Revive insurance** (a real-ETH `respawn_token`) — absorbs a killing blow entirely (full heal, keep
  everything, no chop/loot/estate). Burned before the estate runs.

---

## 16. The Law & RICO

The state is the PvE antagonist — everything **downstream of your heat**. `GET /v1/law` [public] is your
rap sheet.

**The investigation meter** banks lazily: heat above a threshold builds **exposure**, which bleeds slowly.
Stages: **clean → watched → investigation → indicted** (which latches). A spike-and-decay costs little; a
long-running high heat builds a case.

**Escapes (before it files):** **bribe** (`/v1/law/bribe`, wealth-scaled, knocks the meter down — blocked
when clean/indicted/safehoused), the **lawyer retainer** (`/law/retainer`, $150k / 3 days, softens the bust
+ forfeiture), and the **envelope** (`/law/envelope`, 15 $OMR / 7 days — the standing graft: halves the
meter's *gain* and doubles its *bleed*).

**The RICO bust.** Crossing the line files an **indictment** (a grace clock starts). Conviction seizes
**30% of your pocket + bank** into the confiscation pool and jails you — but **staked $OMR and minted gear
are safe, and it is NOT death** (the Law is an economic antagonist; death stays PvP). If you stay offline
past the grace window, the worker force-busts you (so the whale can't hide).

**The courtroom:** **plea** (`/law/plea`, a certain smaller loss + short jail), **buy the jury**
(`/law/jury`, a $OMR burn cutting conviction odds), **demand trial** (`/law/trial`, resolve now).

**Informants (Phase 4):** **flip** (`/law/flip/:targetId`) — drop your own case, seed exposure onto a
rival, and earn the permanent **rat** badge (it follows your bloodline; a rat loses family omertà).
**Witness protection** (`/law/witpro`) makes you briefly untargetable. Killing a witness lifts the seeds
they planted.

The **Foundation** (§9) softens family convictions; **patrol hours** (§4) convict harder.

---

## 17. The Pen

Jail is a **place** — every Pen action requires being locked up. `GET /v1/pen`.

- **Work the yard** (`/v1/pen/work`) — energy → a little cash + shaves your sentence (good behaviour).
- **The commissary** (`/pen/buy/:item`) — a **shiv** ($5k), a **burner phone** ($25k), a **cutkit** ($50k).
- **Protection** (`/pen/protection`, $15k) — a no-shank window (the in-jail safehouse — a shield, so a
  protected inmate can't shank either). **Bribe the guard** (`/pen/bribe`, per-second) — the fast, expensive
  exit.
- **The shank** (`/pen/shank/:targetId`) — both must be jailed; spend a shiv + energy in a muscle contest.
  It bypasses street defenses but respects a revive token, witness protection, omertà (unless the mark's a
  rat), and protection/the hole. A landed shank is a **real death** (heir, a sworn vendetta) but with **no
  loot/chop/rep** (it's dishonorable). A caught miss costs the shiv + more time + **the hole** (solitary —
  you can't act and can't be shanked).
- **Yard incidents** (a daily draw): Lockdown (no shanks), Riot (shank odds up), Visit (cheaper bribes),
  Toss (commissary closed).
- **The burner phone** — the one way to reach outside: consume it to call in an NPC hit from your cell.
- **The breakout** — solo (`/pen/break`, needs a cutkit; win clears your sentence but you walk out a
  **WANTED fugitive** for 2 days) or **co-op** (`/pen/break/plan`, `/breaks`, `/:id/join`, `/go` — a crew of
  2–4; win = everyone out + WANTED, loss = the whole crew in the hole).

---

## 18. Loan sharking

Player-to-player predatory lending — the first PvP credit market. `GET /v1/loans` [public].

**Offer** (`POST /v1/loans`) escrows the principal ($5k–$1M, rate ≤50%, term 1–72h; optional **directed**
to a named borrower, or **collateralized** by a car). A borrower **takes** it (`/loans/:id/take`; one active
loan at a time; pledges a car if secured — that car locks). They owe `principal × (1 + rate)` by the due
date.

**Repay** (`/loans/:id/repay`) returns the debt, a 5% vig going to the buyback pool. **Cancel**
(`/loans/:id/cancel`) pulls an untaken offer. **Default → collect** (`/loans/:id/collect`, past due) —
the shark seizes pocket + in-transit cash (cleared bank & staked $OMR are safe), the pledged car, breaks the
deadbeat's legs (30-min hospital), and brands them a permanent **welsher** (nobody lends to them again).

A default also marks the borrower **WANTED** for 3 days: omertà stripped (even their family can hunt them),
a pool-funded $25k bounty on their head (if they're ≥L20), and NPC hunters come looking. **Square your name**
(`/loans/square`, $50k) clears WANTED + welsher + the bounty. There's also a **paper market**: sell an
active loan's claim (`/loans/:id/sell`, `/:id/buy`) — a collector with muscle buys risky paper cheap.

---

## 19. Convoys

Bulk goods on a real 30-minute clock — visible, ambushable, turf-sheltered. `GET /v1/convoys` [public].

Loop: **open** a shipment from your district with a first load from the trunk (`POST /v1/convoy`) →
**load more** between the trunk and the market (`/convoy/load` — the manifest beats your trunk cap) →
**depart** (`/depart`) picking a **guard tier** (none / crew $5k / heavy $20k — never public) and optional
**insurance** → it rides 30 min → **collect** at the destination (`/:id/collect`, a trunk-load at a time).

The route + a value band are announced, never the manifest. **Ambush** (`/:id/ambush`) — spend energy +
ammo + heat in a contest of your muscle+speed vs the guards + turf defense; win and take goods up to your
trunk cap. Up to 3 hijacks per convoy (one per attacker; only a win wears the guards down). **Tolls** — 
collecting at another family's docks pays 5% to their treasury. **Insured** freight pays out on a hijack,
capped so alt-collusion can't skim honest premiums.

---

## 20. Crew heists

The game's co-op content. `GET /v1/heists` [public]. Jobs: Payroll Office (crew 2, L8) → Inside Job
(crew 2, on a player's business) → Bank Vault (crew 3, L20) → Reserve Train (crew 4, L40). Each crew slot
is a **role** (brains / muscle / wheelman / gun) and the success roll reads each member's stat *for their
role* — so a specialist crew matches a generalist for cheaper.

Loop: a leader **plans** and stakes (`/v1/heists/plan`) → crew **join** off the board by role (`/:id/join`)
→ the leader **executes** (`/execute`), one roll for everyone. Success splits the pot evenly (1.2× to the
leader); failure jails the whole crew. **The Inside Job** redirects 60% of a player business's pending
income (it refuses a hot, raid-eligible front). **The Rat** (`/:id/rat`) — any member can silently flag; a
ratted job auto-blows, the rat walks with half the stake, the rest eat double jail, and the feed only ever
says "somebody talked." A successful standard heist also parks a small legit **AAPL** stock cut for every
crewman (§27). The **solo Daily Score** (`POST /v1/heist`) shares an 8h cooldown.

---

## 21. The Black Market

Player-to-player trade. `GET /v1/market` [public]. **Cars sell by auction; goods sell fixed-price with a
district-pinned pickup; standing buy orders (WTB) let buyers name a price.** (Gear is excluded — its market
is the on-chain GearVault.)

- **Car auction** — one standing bid, optional buy-now, a hidden reserve, anti-snipe soft-close; an outbid
  player is refunded instantly. A listed car locks (no melt/fence/repair).
- **Goods** — a fixed price; the buyer must **stand at the listing's dock** with trunk space (partial buys
  allowed) — the market can't teleport freight past the convoy game.
- **Buy orders** — a buyer escrows qty × price at their dock; sellers standing there fill from the trunk and
  are paid on the spot; delivered goods wait until the buyer claims them.

Routes: `POST /v1/market` (list), `/:id/bid`, `/buy`, `/cancel`, `/market/order`, `/:id/fill`, `/:id/claim`.
A 1% listing fee and a 2% hammer take apply; a killed poster's escrow refunds bidders (and burns their own).

---

## 22. Vendettas

A **blood feud** sworn after a fire-kill — status only, no money. `GET /v1/feud/:characterId` [public].
A player fire-kill swears the victim's bloodline against the killer's **for 7 days**; the heir inherits the
feud and is notified. A **revenge fire-kill inside the window** closes the feud, pays 2× feared-rep, and
feeds the streets. Vengeance also **waives the directed-contract floor** on a kill contract against your
vendetta target. NPC and mod kills don't swear a feud.

---

## 23. Skills

Your character build. **Three branches × three tiers**; points **derive from level** (`floor(level/4)` —
one maxed branch ≈ L24). Skills **die with the street**. Respec for 10 $OMR on the shared 24h cooldown.
`GET /v1/skills`, `POST /v1/skills/:id`, `/skills/respec`.

- **Enforcer** — Bruiser (jump/shakedown ×1.08) · Doctor's Friend (heal ×0.75) · Executioner (search ×0.8).
- **Operator** — Fast Talker (lay-low ×0.8) · Fence Network (fence/melt +8%) · Broker (listing fees ×0.5).
- **Wheelman** — Pack Mule (+3 trunk) · Getaway (crime jail ×0.8) · Road Captain (own convoys 20% faster).

---

## 24. The Underworld

Five **named fixers** you build a *relationship* with (standing 0–100, per character). `GET /v1/underworld`.
- **Doc Moretti** (survival) · **Vinnie the Match** (contracts) · **Bella Bang-Bang** (gear) ·
  **Big Tuna** (trade) · **The Madame** (the den).

Standing is **earned by working their corner** (healing, buying guns, posting contracts, killing, running
convoys — each touchpoint bumps the right fixer), capped at 25 raw/day. Tiers at 25 / 60 / 90 unlock
single-touchpoint perks: Doc heal discounts + early discharge; Vinnie NPC-hit + contract-fee discounts +
faster searches; Bella gun/craft discounts + a gun buyback; Big Tuna guard discounts + longer listings + a
4th market slot; the Madame no-nerve dice + high-stakes access + a hunter count.

- **Gifts** (`/underworld/:npc/gift`, $5k → +5) only work below 50 (the top tiers are earned).
- The **daily lead** — do the fixer's drawn task once a day with your best fixture for a bonus (+ a streak).
- **Rivalry & grudges** — killing costs you the Doc; killing a fixer's ≥60-standing friend earns a **grudge**
  that caps your tier until you pay **penance** (`/underworld/:npc/penance`, $25k). **Decay** cools idle
  standing toward tier 1. A **weekly favor** (`/favor`, tier-3, a resource package) and an **errand chain**
  (`/errand`, 3 days → a bonus) reward loyalty. Your heir inherits 25% of your standings.

---

## 25. The Wire

Information as a spendable $OMR resource. `GET /v1/wire`.
- **Wiretap** (`/v1/wire/tap/:targetId`, 8 $OMR, 12h, up to 5 at once) — reveals a rival's Law stage + heat
  band, wealth band, operations, WANTED status, and **whether they're hunting you** (pierces the peek space).
- **Sweep** (`/wire/sweep`, 5 $OMR) — clears every tap on you (free when clean).
- **The Street Wire subscription** (`/wire/subscribe`, 12 $OMR, 7 days) — a ticker tape, Law forecasts, and
  threat chatter (a *count* of hunters/contracts on your head — a count, never a name; the layered intel
  economy: the sub warns, a tap IDs a rival, the $OMR peek names funders).

---

## 26. The Store, PLEX & the Ledger

**The Store** (`GET /v1/store` [public]) — real-money (ETH) packages that grant **only non-currency things**
(anti-pay-to-win: entitlements, access windows, cosmetics, status — never cash/$OMR/gear/power). SKUs: Made
Man (a mint credit), revive bundles, a 30-day Street Wire, the Season Pass, the Patron's Ring badge, decor
styles. Revenue splits 40% founder / 40% buyback (→ the Vig, funding withdrawals + prizes) / 20% RWA reserve.

**PLEX** — pay a Store SKU or a game fee from **earned $OMR** instead of ETH (`/v1/store/plex/:sku`,
`/v1/plex/mint`, `/plex/respawn`; `GET /v1/plex/price` [public]). ETH payers fund the pool; $OMR payers
shrink supply. (The EVE "pay your rent in ISK" path.)

**The Season Pass / The Ledger** (`GET /v1/pass`, `/pass/claim`) — while your pass is active, claim the next
of 12 tiers once a day: titles, revive tokens, energy refills, and small **$OMR stipends** paid from the
backed prize pool (never minted). Account-level → survives death.

---

## 27. Going Legit

The laundering arc's apex: turn dirty cash → laundered $OMR → a **legitimate, death-proof stock book**. The
tickers are **real Robinhood tokenized stocks** (GLD, AAPL, AMZN, TSLA, HOOD, NVDA, SPCX, GME); in-game
they're a **pure-status collectible** with a deterministic price — **no cash-out, no sell** (the regulatory
line; a real KYC'd extraction is a legal-gated future phase). `GET /v1/portfolio` [public].

- **Invest** (`/v1/portfolio/invest`) burns clean $OMR for fractional shares; a big move (≥1000 $OMR in a
  day) draws heat (the laundering red flag) and is safehouse-blocked. 15% of each invest funds a **dividend
  pool**.
- **Dividend** (`/portfolio/dividend`) — a ~daily payout of your book value from that pool (pool-bounded,
  never minted). The family book earns one too (`/gangs/portfolio/dividend`).
- **The Dynasty** — the book is account-level, so it's a **generational fund**: name it
  (`/dynasty/name`, `/gangs/portfolio/name`) and it, plus a crest tier, passes to your heir.
- **Landmarks** (`/v1/landmarks/:districtId`) — one dedicable plaque per district, held by the biggest
  $OMR flex, bearing your dynasty name — a monument that survives death.
- Earned (never by chance): a heist big-score AAPL cut, and the season-prize SPCX grant.

Leaderboards: `/v1/leaderboard/portfolio`, `/family-portfolio`, `/foundation`.

---

## 28. The Estate & Auction House

**The Estate ("the compound," `GET /v1/estate`)** — a deep, account-level (death-proof) $OMR sink and a
"home" surface: buy tiers (Safe House 40 → The Compound 2500 $OMR), unlock features (Trophy Room →
The Menagerie), name it, and display **trophies** computed from your real holdings (rarest car, arsenal,
book value, kills, family seal). Pure status. `POST /v1/estate/upgrade`, `/feature/:id`, `/name`.

**The Auction House ("the sit-down," `GET /v1/auction` [public])** — a competitive weekly $OMR sink: 3
unique numbered prestige lots each week, highest **$OMR bid wins**, and **the winning bid burns**
(deflationary). Bids escrow $OMR; an outbid bidder is refunded instantly; won trophies are account-level and
survive death. `POST /v1/auction/:lotId/bid`.

---

## 29. The chain

OMERTÀ settles on Robinhood Chain (an EVM L2). The chain layer is built but **dormant until mainnet** (legal
+ audit gated). The intent: off-chain stays authoritative; the chain settles withdrawals and ownership
proofs; nothing mints.

- **Withdraw $OMR** (`/v1/withdraw`) — debits your $OMR (a legal burn), signs an EIP-712 voucher **only if
  the reserve can back it** (the full-reserve queue; else it queues). **Only a minted account can extract.**
- **Gear withdrawal** (`/gear/:id/withdraw`) — mints your in-game gear as an ERC-1155 NFT (it leaves play,
  becomes safe + tradeable).
- **Wallet link** — SIWE (`/wallet/challenge` → sign → `/wallet/verify`). **Character mint**
  (`/character/mint`) — a 0.01 ETH fee makes a free-trial character permanent (withdrawal-eligible). Revive
  insurance is a 0.10 ETH fee.
- **Bonds** (`GET /v1/bonds` [public], `/bonds/:id/claim`) — the Reserve Bond (Protocol-Owned Liquidity):
  deposit ETH → receive **discounted, vested treasury $OMR**; the ETH deepens the OMR-ETH pool + feeds the
  Vig. It **never mints** — the payout comes from a budgeted tranche.

The **Vig** is the real-revenue engine: fee/store/bond revenue buys hard $OMR that backs withdrawals and
funds the prize pool — so "extraction ≤ inflow" holds by construction.

---

## 30. Growth

**Paths** (`POST /v1/path`, at L5 for $10k; switch for 25 $OMR) — a permanent earning specialty: **The Gun**
(+10% fight power, +15% hit contracts), **The Ledger** (+10% racket/front income, +5% trade), **The Kitchen**
(+15% cook quality, −25% deal heat).

**Missions** (`/v1/missions/:id`) — 29 pay-once scripted jobs with level/stat requirements, paying cash +
respect + sometimes $OMR (an enumerated legal faucet, once per account) + titles.

**Daily contracts** (`GET /v1/daily`, `/daily/:id/claim`) — 3 drawn each day; complete all three for a $OMR
bonus. **The Daily Score** (`/v1/heist`) is the best low-level repeatable income (8h cooldown). **Check in**
daily for a streak bonus.

**Referrals** (§7.13) — a recruit qualifies after 4 gates (L8, 40 jobs, 3 check-ins, $25k net worth);
milestones pay the recruiter cash + $OMR + titles.

**The First Week** (`GET /v1/onboard`, `/onboard/:taskId/claim`) — a 9-task checklist (pull a job, boost a
car, bank, declare a Path, join a family, link a wallet, three socials) that pays cash to teach the ropes,
with a capstone bonus. **The Coach** (the ▸ line on your sheet) always names your single best next step.

**Vanity** — name change (5 $OMR), custom title (10), car plate (2), gang color (10), gang rename (25).

---

## 31. Reference

### Districts
| District | Perk |
|---|---|
| Docks | +50% contraband on crimes; a wash (laundering) district; the starting district |
| Neon Mile | +15% racket/front income; the vice district (casino, speakeasy) |
| Old Foundry | Workshop crafting −25% cash |
| Brick Yards | +2% crime success |
| Canal Row | +10% crime pay; a wash (laundering) district |
| Cathedral Hill | Double nerve regen |

### The three "safe from looting" harbours
Cleared **bank** cash · **staked** $OMR · **minted (on-chain)** gear · your account-level **portfolio /
estate / prestige**. Everything else in your pocket is at risk when you die.

### Status you'll see on your sheet
**wanted** (hunted, even by family — square it) · **welsher** (defaulted, can't borrow — square it) ·
**indicted** (a RICO case is filed — go to The Law) · **in transit** (a deposit hasn't cleared — lootable) ·
**unbonding** ($OMR isn't liquid yet — lootable) · **safehouse** (untargetable, but you can't act) ·
**hospital / lockup / the hole** (wait it out).

### Currency quick-reference
- **Cash** — earned everywhere; pocket is lootable, bank is safe (after it clears).
- **$OMR** — the premium currency; laundered from cash, stakeable, extractable (once minted); account-level,
  so it survives death. Staked is safe; liquid/unbonding is lootable.
- **Crates (cb)** — from crimes/cooking; buy guns, craft gear.
- **Ammo** — from melting cars or bought at $2000/50; spent on jumps, fires, raids, ambushes.

### "Three things named the same" (don't confuse them)
- A flat **Racket/Asset** "Speakeasy"/"Nightclub"/"Casino" (buy-once passive income) ≠ a **Business**
  casino/nightclub (upgradeable front) ≠ **The Speakeasy** (the deep club system) ≠ **The Den** (the casino
  games). Different systems.

### Test-only knobs (never live in production)
`SEARCH_MS`, `SHOOT_CD_MS`, `CONVOY_MS`, `PASS_CLAIM_MS`, `LAW_BUST_P`, `SHANK_P`, `PEN_BREAK_P`,
`PEN_YARD_EVENT`, `BUSINESS_RAID_P`, `SPEAKEASY_RAID_P`, `WORLD_RAID_P`, `SPEAKEASY_STANDOVER_P`,
`GEAR_LOOT_CHANCE`, `WANTED_HUNT_P`.

### Discovery endpoints
`GET /v1/rules` [public] (the rulebook — crimes, guns, drugs, catalogs), `GET /v1/catalog` [public]
(businesses), `GET /` (the console), `GET /wiki` (this codex), `GET /admin` (the live-ops dashboard, mod-key).
