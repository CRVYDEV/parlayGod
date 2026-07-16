# OMERTÀ — Smuggling Convoys (design)

**Status: building step one.** Wealth in transit for GOODS: today trade goods teleport in your
trunk, invisibly. A convoy is a BULK shipment that travels on a real clock, visible to the whole
city — rivals can ambush it, guards defend it, and turf shelters it. It ties the §7.11 trade
system, territory, and the interception layer into one loop, on the same design spine as
bank-clearing loot windows: value that crosses the street can be taken on the street.

## 1. The loop

1. **LOAD** — `POST /v1/convoy {to, goodId, qty}` opens a shipment at your CURRENT district
   bound for `to`, loading goods FROM your trunk (then `POST /v1/convoy/load` to add more).
   That's the bulk unlock: load, refill the trunk from the market, load again — a convoy
   carries what a trunk never could. One active convoy per character. Cancelling while loading
   returns the goods (needs trunk space).
2. **DEPART** — `POST /v1/convoy/depart {guards}` picks a guard tier (none $0 / crew $5k /
   heavy $20k — a cash sink `convoy:guards`; cheaping out makes you a target, and everyone
   knows the tiers exist but nobody sees which one you bought) and puts the shipment on the
   road for `CONVOY.MS` (30 min). The streets feed announces the route and a VALUE BAND (order
   of magnitude, not the manifest); `GET /v1/convoys` lists everything in transit.
3. **AMBUSH** — `POST /v1/convoy/:id/ambush`, once per convoy (first crew to try, win or lose,
   spends the opportunity — the guards are alerted after). Costs energy + ammo (`convoy:` ammo
   sink); jailed/safehoused/hospitalized attackers and the owner's family are blocked. Contest:
   `muscle + speed/2 + rand(30)` vs `guardDef + turf bonus + rand(30)` (a convoy departing from
   or arriving to the owner's family turf gets `CONVOY.TURF_DEF` — territory shelters its own).
   - **Win**: the hijacker takes as much of the manifest as their OWN trunk holds (a pure
     ownership transfer, like gear loot — goods aren't a §10.4 currency); the rest drives on.
     Heat on the hijacker; the owner and the city hear.
   - **Lose**: the guards put the hijacker in the hospital (`CONVOY.FAIL_HOSP_MS`) and the
     shipment rolls on, now un-ambushable.
4. **COLLECT** — after arrival, the owner collects AT the destination (`POST
   /v1/convoy/:id/collect`), trunk-capacity at a time, then sells at local §7.11 prices.

## 2. Why ship (the economics)
District price spreads (±40% by seed block) × bulk beyond trunk size = the freight margin; the
costs are the guard fee and the ambush risk. No new faucet: goods move, cash only flows through
the existing goods:buy/sell ledgers plus the new `convoy:guards` sink. Ambush is a transfer.
Numbers (`CONVOY` block in the rules tail) are founder sign-off levers.

## 3. Edges
- Estate: a dead owner's convoy is lost with the street (scattered on the highway).
- `CONVOY_MS` env override is TEST-ONLY (the SEARCH_MS pattern).
## 4. Step two — BUILT (tolls, multi-ambush, insured freight)
- **Destination tolls**: collecting at docks HELD by another family pays `TOLL_BPS` (5%) of the
  collected goods' base value from the shipper's pocket to the holder's treasury — a ledgered
  TRANSFER (`convoy:toll`, the tribute pattern; the §10.4 treasury check gained the term). Own
  turf and unheld docks are free; the toll clamps to pocket and never holds the freight hostage.
  Turf finally taxes the trade routes that cross it.
- **Degrading multi-ambush**: up to `MAX_AMBUSHES` (3) attempts per convoy, ONE per character
  (`convoy_ambushes`); each prior fight wears `GUARD_WEAR_BPS` (25%) off the GUARD tier's
  defense (turf + lockdown never wear). The wear is visible in the rng-audit outcome.
- **Insured freight**: `depart {insure:true}` pays a premium of `INSURE_BPS` (10%) of the
  manifest's base value into a shared pool (`convoy_insurance` singleton, `convoy:insure`); a
  hijack stamps the LOST base value on the policy and the owner claims `INSURE_PAYOUT_BPS`
  (50%) of it lazily AT COLLECT — **capped at the pool** (the stake_pool precedent), so the
  product is zero-sum among shippers by construction: collusion (insure → friend hijacks →
  claim) can only redistribute premiums, never mint. §10.4 check: pool = premiums − payouts.
  The claim settles in the OWNER's transaction (an ambush never touches the owner's row).
- Deferred: NPC trucking for a fee.
- New numbers (`TOLL_BPS`/`MAX_AMBUSHES`/`GUARD_WEAR_BPS`/`INSURE_BPS`/`INSURE_PAYOUT_BPS`)
  are founder sign-off levers.
