# The Black Market — player marketplace / auction house (design)

## 1. Why
There is no general P2P trade: the Exchange covers only cb/ammo, and cars + trade goods can't
change hands between players at all. A marketplace deepens every producer loop (GTA/garage,
goods/convoys) and gives wealth a player-facing demand sink — with the 2% house take feeding
the same street-tax → buyback flywheel as every other transfer.

## 2. What trades (and what deliberately doesn't)
| Asset | Mode | Why |
|---|---|---|
| **Cars** | AUCTION (single standing bid, min-raise, optional buy-now) | No capacity constraint at settle → safe to settle lazily. The fleet game finally has a market above the 50% fence floor. |
| **Trade goods** | FIXED-PRICE, **district-pinned pickup** (buyer must stand at the listing's dock, trunk-space clamped, partial buys) | A district-less market would TELEPORT freight and kill convoys. Pinning pickup preserves transport risk — the market creates demand, convoys still move supply. |
| Gear | **excluded** | Gear's tradeability IS the on-chain rail (GearVault, M6). An in-game gear market would compete with it. |
| cb/ammo | **excluded** | Already the Exchange's job. |

## 3. Mechanics
- `POST /v1/market` list: cars (`carId`, `minBid`, optional `buyNow`, `hours ≤ MAX_TTL_H`) or
  goods (`goodId`, `qty`, unit `price` — pinned to the seller's current district). Listing fee
  `LIST_FEE_BPS` (1%) of the ask, min $10 (`market:list`, a §10.4 sink) — prices the warehouse
  angle (see 5). Item escrows: car → `cars.listed=true` (row stays — car conservation counts
  rows); goods → qty deducted from the trunk into the listing.
- `POST /v1/market/:id/bid` (cars): ≥ minBid and ≥ standing bid × (1+`MIN_RAISE_BPS`). Cash
  escrows (`market:bid`); the outbid player is refunded inline (`market:refund`). Self-raise
  refunds in-memory. One standing bid per listing.
- `POST /v1/market/:id/buy`: cars buy-now → instant settle. Goods → district + trunk gates,
  partial `qty`, pay unit price × n.
- Settle: hammer − take → seller (`market:sale`); take = `TAKE_BPS` (2%) of the hammer, half →
  street tax (the buyback), half burns — ledgered as one character_id-NULL `market:take` row so
  the escrow check closes exactly. Expired auctions settle in the worker sweep (chars sorted →
  listing — the global lock order); expired/unsold listings are reclaimed by the seller
  (`cancel`) — goods return only if the trunk has space (the convoy-cancel rule).
- `POST /v1/market/:id/cancel`: seller only, no standing bid. Expired listings reclaim the same way.

## 4. §10.4
New cash vocabulary `market:` — `list` (sink), `bid` (escrow in), `refund` (escrow out),
`sale` (escrow out, seller net), `take` (escrow out, NULL row), `death` (escrow out, NULL row —
a dead bidder's standing bid burns, the bounty dead-funder precedent). New check:
**market escrow** = Σ standing bids on live listings == posted − refunded − sales − takes −
deaths. Car transfer is conservation-neutral (row count unchanged). Goods aren't §10.4 currency
(pure ownership moves, the convoy precedent).

## 5. Abuse analysis
- **Free warehouse** (list goods at an absurd price → empty trunk → buy more): priced by the 1%
  listing fee, bounded by `MAX_LISTINGS` (3 live per character), and throttled at reclaim
  (goods come back only into free trunk space).
- **Wash-trading** (alt buys own listing to launder or fake volume): a pure transfer minus 2% —
  strictly worse than the existing taxed transfer paths; nothing mints; rakeback doesn't read
  market volume.
- **Escrowed-car dodges**: melt/fence/repair reject a listed car ('listed'); CHOP still counts
  listed cars in fleet value (a hit crew knows your assets — and excluding them would let a
  marked man warehouse his fleet pre-hit, gutting the signed kill economics).
- **Death**: seller dies → bids refunded (killer-as-bidder threads through killerCh, the
  refundPot discipline), listings die with the estate (cars in the fleet wipe, goods scatter).
  Bidder dies → standing bid burns (`market:death`), the auction reverts to open.
- Jail gates list/bid/buy/cancel. No safehouse gate — bidding is shopping, not offense or
  extraction (P1.3/D2 untouched).

## 6. Locks
characters (actor via withCharacter; counterparty read-unlocked → locked → re-verified, the
heist-execute pattern) → market_listings (pot class) → street_tax singleton. Acyclic against
every existing path; 40P01 falls back to the global `contention` retry.

## 7. Levers (founder sign-off)
`MARKET`: `LIST_FEE_BPS` 100 (min $10) · `MIN_PRICE` 50 · `MIN_RAISE_BPS` 500 · `TAKE_BPS` 200
· `MAX_TTL_H` 48 · `MAX_LISTINGS` 3.

## 8. Step two (deferred)
Goods auctions with a warehouse-claim flow, reserve prices, anti-snipe extensions, buy orders
(standing WTB), and a gear-market design call if the founder ever wants in-game gear trade to
coexist with the on-chain rail.
