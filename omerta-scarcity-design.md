# OMERTÀ — SCARCITY & THE LUXURY LAYER

**Founder-directed, 2026-08-16**, from an observation about an agent-only RuneScape server:

> *Low cost of labor makes most commodities abundant · currency inflation means trading goods for goods,
> nobody really wants cash · huge swarm contention as certain resources with limited respawn rate become
> valuable.*

The question was whether OMERTÀ has enough **scarcity** and enough **luxury activities** (the reply
thread's phrase — clue-scroll completionism, wilderness turf wars: the things a player does once the
grind has stopped being about money).

This doc is the answer and the build plan.

---

## 0. THE DIAGNOSIS: this city is POSITION-scarce and ITEM-abundant

The honest read of the current tree:

**What is genuinely scarce today — and it is a lot.** Every one of these is a *position*: there is exactly
one of it, and holding it means somebody else does not.

| Scarce thing | Bound |
|---|---|
| The six core districts | one holder each; contested by sealed bid |
| Territory rackets | **one per district**, seized with the turf |
| The boxing belt | one holder, server-wide |
| Commission seats | five, re-earned every season |
| Operation slots | 12 max, so 12 of 36 catalog rungs, ever |
| Street Deed names | city-wide unique, one deed per account |
| Auction lots | unique numbered serials `W<week>-<n>` |
| Provenance wards | one per snapshot wallet, ever |
| The season crown | one family per season |
| Frontier outposts | five, held by conquest |

**What is not scarce at all.** Every *item* in the game is infinite-supply at a deterministic price:
60 cars, 15 guns, 6 vests, 10 trade goods, 8 drugs, 6 boats, the whole consumables bench. The §7.11 price
hash moves with the day and the district but **never with demand** — there is no supply response anywhere
in the catalog. Two players wanting the same car both get one. Nobody has ever queued for anything.

**And the one contested rate-limited resource pays the wrong currency.** The World cartel reservoirs are
the closest thing to runite ore: a shared pool, regenerating on a clock, drained by whoever gets there.
But what it pays is **cash** — the abundant thing. Draining a reservoir does not give you a *material*
anyone needs; it gives you money, which the tweet's server is precisely the story of nobody wanting.

So the shape of the gap is exact: **when the city gets rich, there is nothing for the rich to want.**
Position is already fought over. Items are not, because items are free.

**The luxury layer, separately, is in better shape than expected.** Clue trails have tiers, timed steps,
riddle/anagram/cipher variety, caskets and relics; THE COLLECTION is 140 items across nine categories;
there are 35+ status leaderboards and the City Standing spine over them. The gap there is not *quantity* —
it is that almost none of it is **scarce**: two players can hold the same complete collection, so a
completionist's trophy says "I did the work" and never "and you cannot have it."

---

## 1. THE FIRSTS — the completionist trophy that can only be won once

**One per server, forever.** The first account ever to complete a collection category, to take a trade to
mastery 50, to unlock a grandmastery — that account holds the FIRST, and nobody else can, no matter how
well they play afterwards. Everyone else can still finish everything; only the *first* is gone.

This is the cheapest possible fix for the luxury layer's real gap, because **the content already exists.**
It re-prices 140 collection items and 10 mastery tracks from "a thing to finish" into "a race that ends".

- **Account-keyed → survives death** (the deed/legend/dynasty posture). A bloodline that got there first
  keeps it through every heir.
- **Claimed at the crossing, in the same transaction as the achievement**, so it cannot be raced twice:
  the row IS the latch (`INSERT … ON CONFLICT DO NOTHING`-shaped, but written as the codebase's
  SELECT-then-INSERT under the actor's char lock — pg-mem lies about `ON CONFLICT … RETURNING`).
- **Hooks** (three, each at an existing crossing): collection-category completion (`logCollect`'s caller
  side), mastery level 50 (`bumpMastery`'s level-crossing branch), grandmastery unlock (`learnSkill`,
  after a capstone — grandmastery is derived on read, so the *acquisition* is the only event).
- **§10.4: ZERO.** A first is status. No currency, no reason, no ledger row — test-pinned by counting.
- **The city hears about it.** A first goes to the streets feed and to the Discord city wire: this is the
  only kind of achievement where "somebody else got there" is *itself* the content.

Scope at the current catalogs: 9 collection categories + 10 mastery tracks + 3 grandmasteries + the master
clue trail ≈ **23 permanent uniques**, all of them already-built content, none of them purchasable.

---

## 2. LIMITED RUNS — numbered cars, N of them ever

A small set of catalog cars get a **hard city-wide cap and a serial**: *Coupe de Ville — 1 of 25 ever.*
Once 25 exist, the model never appears again, for anybody, for the life of the server.

**Why cars, and why the boost.** Cars are the only catalog item that already has an *instance row* with a
provenance-shaped life: they are boosted (earned), tuned, raced for pinks, pledged as loan collateral,
listed on the market, chopped, melted, stolen, and looted. A numbered car inherits all of that machinery
for free — and, decisively, cars are the one catalog where a rarity axis **already ships** (v3 step 7's
`cars.rarity` + the extraction rail).

**A limited run is MINTED BY A RARE ROLL ON A SUCCESSFUL BOOST** — never sold. That is the standing rule
from the rarity NFTs, and it binds here with the same force:

> **Sell deterministic, drop random.** Money may buy exactly what it is quoted. A random outcome may be
> *dropped*, never *sold*.

So: no purchase path, no crate, no "roll for a chance at a numbered car". You steal cars; sometimes the
car you steal turns out to be one of twenty-five.

- **The cap is the scarcity**, and it is real: a counter row per run, claimed atomically, and when it is
  spent the roll simply stops firing. Serials are sequential and permanent.
- **Melting one is destruction, and destruction is news.** A numbered car that goes to the smelter is
  gone from the world — the run's supply *falls* and never recovers. That goes on the city wire. It makes
  the melt decision a real one and gives the remaining holders something they did not have before.
- **§10.4: ownership only.** Cars conserve by ROW COUNT and are not a §10.4 currency; a run mint writes no
  ledger row (the boost's own faucet is unchanged), and a melt rides the existing `melt:` sink.
- **The collection gains a `runs` category**, so the FIRSTS layer and the completionists inherit it.

The market consequence is the point: a numbered car is the first thing in this game whose price is set by
*other players wanting it*, not by a hash.

---

## 3. THE SHIPMENT — the contested material

The runite-ore answer, built as a **material, not a currency.**

Once a day the city gets a shipment: a fixed quantity of something the catalogs cannot produce, landing at
a **seed-drawn district** (forecastable like every other §7.11 draw — you can plan for it, you cannot
manufacture it). It is **first-come against a city-wide daily cap**, with a per-player cap so one whale
cannot take the lot.

This is the piece that answers the tweet directly, and every part of it is chosen against the failure it
would otherwise cause:

- **It is not a currency.** It is an owned quantity on the character, like trunk cargo or contraband —
  which means it is **lootable on a fire-kill**, it dies with the street, and it never touches §10.4.
- **It is an INPUT, never an output.** The shipment does not pay cash. It is consumed by elite workshop
  crafts that cannot be made any other way. So the material's whole economic role is to gate a **sink** —
  which makes the drop emission-safe *by construction*: nothing about it can inflate anything.
- **The contention is the feature.** A city-wide cap plus a drawn location is exactly the "swarm
  contention on a limited respawn" the tweet describes, and it is the first thing in OMERTÀ where being
  *there* and being *early* beats being rich.
- **The apex cartels drop it too.** Routing an apex World outfit (the crossing branch, once per rout)
  yields units — which finally gives the reservoir loop a payout in the scarce thing rather than in the
  abundant one, and gives the co-op raid layer a reason that is not cash.

Because it is barterable between players by ordinary trade and cannot be bought from any NPC, it is also
the natural **goods-for-goods** medium the tweet's thread ends up at — without anyone designing a barter
system.

---

## 4. FURTHER IDEAS (brainstormed, ranked, not all recommended)

**(a) DEATH-MINTED MEMENTOS — recommended, next.** When a genuinely notable street dies (a belt holder, a
Commission boss, a top-ten City Standing), the estate mints **one** personal effect — *"Vito Corvino's
lighter"* — a one-of-one item that outlives the man and can be auctioned. Every one is unique by
construction, the supply is bounded by how many legends the server actually produces, and it makes death
generate heirlooms instead of only wiping tables. §10.4-clean (an owned object, auctioned through the
existing $OMR auction escrow).

**(b) THE SEASON CROWN AS AN ITEM — recommended.** THE RECKONING already names a season's top family and
writes a permanent record; it does not hand anybody a *thing*. Minting the crown as a single held object
(displayable in the compound, transferable within the family) costs almost nothing and converts a
leaderboard row into scarcity.

**(c) DESTRUCTION IS NEWS — ships with §2.** Any permanent removal of a scarce object — a numbered car
melted, a memento burned with an estate — goes to the city wire. Scarcity is only felt if the city sees
supply fall.

**(d) THE TROPHY ROOM — recommended, cheap.** The estate's Trophy Room feature exists and computes a
display from holdings. Point it at the new uniques (firsts, serials, mementos, the crown) and the compound
becomes the place a collector's status is *seen*, which is what a luxury layer needs to be worth anything.

**(e) RETIRING CATALOG ITEMS — flagged, not recommended yet.** A "no longer manufactured" flag on old car
models would make existing stock genuinely finite. The catalogs are MACHINE-OWNED (ground rule #2), so
this is a prototype edit + re-extract, and it silently re-prices every existing holder's fleet. Worth
doing eventually; not worth doing in the same drop as three new systems.

**(f) SUPPLY-RESPONSIVE PRICES — rejected.** Making the goods hash respond to demand would create the
scarcity the tweet describes and would also break the arbitrage board, the convoy manifest values, the
Trade Winds forecast and a signed §7.11 surface. The deterministic hash stays.

**(g) "SCARCE LAND" MARKETING — rejected, standing.** The deeds design (§6) forbids scarcity/appreciation
framing on the map, and nothing here changes that. The map GROWS; the scarce things are the objects, and
even those are described as what they are, never as what they might be worth.

---

## 5. WHY THIS DOES NOT BREAK ANYTHING

| | New emission? | New §10.4 reason? | Buyable? |
|---|---|---|---|
| The Firsts | none — pure status | none | no (unwinnable with money) |
| Limited runs | none — cars conserve by row count | none | no (drop-only, by rule) |
| The shipment | **negative** — it gates sinks | none (non-currency ownership) | no (drawn + capped) |
| Mementos | none — an owned object | none | on the secondary market only |

Every scarcity added here is **a thing you can hold and lose**, and none of it is a faucet. That is the
whole design: the tweet's server discovered that value migrates to whatever is rate-limited and contested.
This gives OMERTÀ three of those, and hands the rich something to want that money cannot simply buy.

---

## 6. LEVERS

All numbers below are founder sign-off levers, pinned in `test/levers.js` and tabled in BALANCE.md when
built. Setting any of them to `0`/`[]` disables its feature cleanly.

| Lever | What it bounds |
|---|---|
| `FIRSTS.*` | which crossings mint a first (the catalog itself) |
| `LIMITED_RUNS[].cap` | how many of each numbered model exist, ever |
| `LIMITED_RUNS_P` | the boost roll that mints one (TEST-ONLY override classified in preflight) |
| `SHIPMENT.CITY_CAP` | the city-wide daily quantity |
| `SHIPMENT.PER_PLAYER` | one player's daily take |
| `SHIPMENT.ROUT_UNITS` | what an apex rout yields |
