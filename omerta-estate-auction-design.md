# OMERTÀ — The Estate + The Auction House: deep $OMR sinks

Two mafia-flavored $OMR sinks that answer the standing economy flag ("every prior burn was one-time;
supply pools into staking") — one a **deep personal** sink, one a **competitive, recurring** one. Both
are PURE STATUS (the vanity / family-seal / Portfolio precedent): display-only, no gameplay power, so
they sit outside the sim-audited balance, and the only §10.4 flow is the enumerated `$OMR` burn (plus,
for the auction, an `$OMR` escrow bucket — the bounty-escrow twin). Numbers are founder sign-off levers.

## Why these

$OMR is the premium, laundered, extractable currency. The Risk-to-Earn math wants **sinks** — they're
deflationary, they keep "extraction ≤ inflow" honest, and they give late-game whales (whose $OMR
otherwise just sits in staking) a reason to keep playing. The Portfolio was the first *deep, uncapped*
sink; these two add a **personal legend** to pour money into and a **competitive** drain that scales
with wealth.

---

## Part 1 — THE ESTATE ("the compound")

The don's mansion: a personal, TIERED, FURNISHABLE home base bought and upgraded with $OMR — the single
most satisfying place for a whale to sink money, and a genuinely new "home" surface that *displays your
legend*. Account-level, so it **survives death** (the family compound passes to the heir — the Portfolio
precedent, reinforcing "your account outlives the street").

### Mechanics
- **Tiers** (`ESTATE.TIERS`, sequential like family seals): Safe House → Row House → Uptown Brownstone
  → Country Estate → The Compound. Each `upgradeEstate` burns `estate:tier` $OMR (bought in order).
- **Features** (`ESTATE.FEATURES`, one-time unlocks, tier-gated): Trophy Room, Wine Cellar, Rose Garden,
  Show Garage, The Study, Private Chapel, The Vault, Panic Room, Grand Ballroom, The Menagerie. Each
  `unlockFeature` burns `estate:feature` $OMR (gated by `minTier`, not-owned).
- **Name it** — `nameEstate` burns `estate:name` $OMR (a small vanity fee; "The Havens", "Villa Corleone").
- **Trophies** — the board computes a display of your *actual* legend from holdings: rarest car, finest
  gun, portfolio book value, lifetime kills + hitman rank, family seal. Display-only, moves nothing.
- **Estate value** — lifetime $OMR sunk (`spent_omr`), a status figure + a leaderboard hook.

### State & §10.4
- `estates (account_id)` PK — `name`, `tier`, `features` (comma-joined ids, pg-mem-safe), `spent_omr`.
  Account-level → **never in the runEstate wipe**; the heir inherits (surfaced as `kept.estate`).
- All burns ride the vanity `spendOmr` till (account bucket). `estate:` joins the `omr` KNOWN_REASONS
  vocabulary + `omrBurns` in `invariants.js`. Shares/tiers/features aren't a currency (status), so zero
  new bucket, zero faucet — `$OMR conservation` stays exact with one new burn term.
- Routes: `GET /v1/estate`, `POST /v1/estate/upgrade`, `POST /v1/estate/feature/:id`,
  `POST /v1/estate/name`. Surfaced on the character `view` (a one-line estate summary) + `/v1/rules`
  (the catalog, the discoverability precedent). Console: an "Estate" tab.
- Test `test/estate.js` (22nd suite): sequential tier gate, feature tier-gate + no-double-buy, naming,
  trophies from real holdings, death survival (heir keeps the compound), spends == ledgered `estate:`
  burns, the §10.4 vocabulary + `$OMR conservation` (drift == the test grant only).

### Deferred (Estate step two)
Recurring **staff & upkeep** (a butler/driver/chef/guards roster with a recurring $OMR wage — the pad/nut
precedent on $OMR; unpaid → they "walk out", a cosmetic downgrade), the **gala** (throw a party for a
temporary social-status bump), estate leaderboard, guest visits.

---

## Part 2 — THE AUCTION HOUSE ("the sit-down")

Server-run auctions of UNIQUE, numbered prestige items, paid in $OMR — highest bid wins, the winning
$OMR burns. The best *economic* sink: **competitive** (whales bid each other up), **recurring** (a fresh
set of lots each week), **self-balancing** (scales with wealth), status-only.

### Mechanics
- **Lots** are drawn deterministically each week from a prize pool via the §7.11 seed
  (`auctionLotsOf(week)` — the numbers-draw / daily-contract machinery), so the town sees the same
  rotating set: numbered vanity plates (`#001`…), estate features, exclusive titles, cosmetic gun
  engravings, a legendary car skin. Cosmetic/status prizes only (never a gameplay item — the fairness
  line, and it keeps RWA/casino out of it).
- **Bid** (`POST /v1/auction/:id/bid`) escrows $OMR (account → the auction), raising the standing bid by
  ≥ `MIN_RAISE`; the outbid player is **refunded inline** (the market-auction pattern). **$OMR is
  account-level and survives death, so a bid needs NO death handling** (unlike cash escrow).
- **Settle** — lazy on read + a worker sweep at week end: the top bidder WINS the item (a status grant
  to the account), the winning bid is **BURNED** (`auction:win`, deflationary), every loser already
  refunded. (Step-two option: route the winning $OMR to the Vig prize pool instead of burning — the
  literal "spenders fund earners" loop; step one burns for max deflation + §10.4 simplicity.)

### §10.4
- New `omr` reasons: `auction:bid` (account → escrow), `auction:refund` (escrow → account),
  `auction:win` (escrow → burn, in `omrBurns`). A NEW **auction-escrow** invariant check: escrow
  (SUM current_bid on live auctions) == bids − refunds − wins — the bounty/loan/market-escrow twin, on
  the `$OMR` side. No death term (account-level $OMR).
- State: `auctions (id)` — `week`, `item_kind`, `item_ref`, `min_bid`, `current_bid`, `bidder`,
  `status`. Won items become account status flags (a title, a plate, an estate feature, a cosmetic).
- Routes: `GET /v1/auction` (the block — live lots + your bids), `POST /v1/auction/:id/bid`. Worker
  `sweepAuctions` settles expired lots (accounts sorted → auction row, per-lot txn). Console: an
  "Auction" section (in the Estate tab or its own).
- Test `test/auction.js`: lot determinism, bid/outbid-refund-exact, min-raise, settle-burns-the-win +
  grants the item, the §10.4 escrow check + vocabulary, and a full weekly cycle.

### Build order
The Estate ships first (no escrow — pure status, fast). The Auction House follows (escrow → its own
§10.4 check → a focused red-team of the new $OMR-escrow surface before it's called done).
