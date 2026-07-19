# The Speakeasy — design (step one)

The game has deep systems but **no social hubs** — nowhere to *be seen*. The Speakeasy is the first
place-based social venue: a scarce, prestigious nightclub a made man opens and runs, where rivals gather,
buy rounds, and perform status. It ties three systems already built — **business** (a front that farms
cash), **casino** (the room can host the games — deferred to step two), and **social** (the place you're
seen with your family). The mafia fantasy is that the club is where reputation is *performed*, and
performance is the most natural thing to spend on.

Founder-directed; numbers are proposed defaults (sim + sign-off, ground rule #1). Off-chain, §10.4-clean.
The real-money (ETH) cosmetic decor / bottle-service tier is the documented **step-two** revenue layer
(dormant, mainnet-gated, the Store/chain pattern) — step one is the in-game economy (cash + earned $OMR).

## The model

**Scarcity = prestige.** ONE speakeasy per district (`speakeasies.district_id` PK — the territory-racket
pattern), owned by the character who opens it. Six districts → six clubs → owning one is a flex. First to
open it holds it; it **dies with the proprietor's street** (the business precedent — a marked man's club is
at stake), which frees the district for a new owner. No turf requirement (a personal venue), no seizure in
step one (death frees it; a buyout/contest is a later step).

## The three loops

**The proprietor.**
- `openSpeakeasy(district)` — level-gated (`MIN_LEVEL` 15), `OPEN_COST` ($750k) cash SINK `speakeasy:open`.
  Opens at tier 0 (The Backroom).
- `collectSpeakeasy()` — the base **bar take** accrues lazily, capped at `INCOME_CAP_MS` (24h, the business
  pattern), collected → pocket cash, faucet `speakeasy:income`. Safehouse-blocked (the exposed-act D2 gate).
- `upgradeSpeakeasy()` — the decor ladder (`TIERS`: Backroom → Lounge → Blue Room → Copa → Cathedral),
  each tier raises income + prestige; collects pending at the old rate first, then pays, sink `speakeasy:decor`.
- `nameSpeakeasy(name)` — a $OMR vanity burn `vanity:speakeasy` (rides `vanity:%`, zero invariant change).

**The patron (being seen).**
- `visitSpeakeasy(district, round)` — **buy a round** for the house. District-pinned (`ch.loc` must be at
  the club — you go THERE), a two-party CASH transfer patron → owner (the bodyguard-hire pattern: owner
  nets 98%, 1% street tax → buyback, 1% dev off-ledger), which puts your name + spend on the club's **guest
  list** and adds the round's prestige to the club. Gates: not your own club, owner alive, not jailed /
  hospitalized / safe-housed (you can't be *seen* while hiding), per-(patron,club) cooldown `VISIT_CD_MS`
  (1h). `ROUNDS` tiers = generosity (`round` $8k / `topshelf` $40k). Ledgered `speakeasy:round` both sides.
- `bottleService(district, bottle)` — the ultra-premium **$OMR** flex: a pure-status deflationary BURN
  (`vanity:speakeasy:bottle`, rides `vanity:%`) that puts you prominently on the guest list + adds big
  prestige to the club. No owner cut (it's a burn, not a transfer) — the "I light $OMR on fire to show off"
  move. `BOTTLES`: bottle 3 / magnum 8 / reserve 20 $OMR. Allowed at your own club (a self-flex burn).

**The being-seen economy.**
- The **guest list** (`speakeasy_patrons`, PK `(district_id, character_id)`) tracks visits + spend per
  patron per club; `REGULAR_VISITS` (10) makes you a **regular** (status). The club's **prestige** (stored,
  bumped by rounds + bottles, floored by tier) ranks the nightlife on `GET /v1/speakeasy`.

## §10.4

Cash: `speakeasy:` joins the cash `KNOWN_REASONS` — `speakeasy:open`/`decor` (sinks), `speakeasy:income`
(faucet), `speakeasy:round` (a taxed patron→owner TRANSFER, both sides character_id'd — check (a)
reconciles). The 1% street-tax + 1% dev-fee split is IDENTICAL to `bodyguard:hire` (audited clean — the
tax feeds the buyback via a direct `street_tax` update, the dev fee is off-ledger). $OMR: naming + bottles
ride `vanity:%` — zero omr invariant change. Estate: `speakeasies` + `speakeasy_patrons` wiped on the
owner/patron's death (the business precedent).

## Deferred (step two)
The club hosts the games (fight/dice nights with a rake to the owner — ties casino); a Prohibition **raid**
(the Law busts the club — ties the Law meter); a P2P **buyout/contest** so districts clear without a death;
a personal cross-club **renown** axis; and the **real-money (ETH) cosmetic decor + bottle-service** tier
(the Store rail — the revenue layer). All numbers are founder sign-off levers.

---

## Step two — the games + the risk (BUILT)

Two mechanics that turn the club from a passive front into a **living gaming venue** with real risk.

### The back-room table (the casino tie)
`playTable` (`POST /v1/speakeasy/:district/table`) — the club hosts a house game (the wheel). A patron
bets CASH (district-pinned, `TABLE.MIN_BET`..`MAX_BET`), the **owner takes a rake** carved from the stake
(`TABLE.RAKE_BPS` 3%, ledgered `speakeasy:table:rake` — a TRANSFER patron→owner, never minted on top; the
casino discipline), the remaining wager plays at `TABLE.WIN_P` (0.48) and a win pays 2× (the edge BURNS,
deflationary). Two-party (`withTwoCharacters(patron, owner)`). **CASH only** — the Den's hard rule; no
$OMR at the table. §10.4: `speakeasy:table:bet` (sink) / `:rake` (transfer to owner) / `:win` (faucet) —
all character_id'd, so check (a) reconciles like the casino; the rake is carved from the bet (not minted),
so no mint-on-top (the econ-pass anti-precedent). Gated: shut / travel / jailed / hospitalized / safehoused
/ self (withTwoCharacters). Collusion is −EV (a patron alt loses the ~7% edge+rake to funnel 3% to an
owner alt), so no laundering angle. Draws `TABLE.NOTORIETY` heat (the raid tie).

### The Prohibition raid (the risk layer)
A hopping club draws the Law. **Notoriety** (`speakeasies.notoriety`) accrues from the club's illicit
activity — the back-room table (`TABLE.NOTORIETY` 8) + patronage (`ROUND_NOTORIETY` 2) — and decays
hourly (`NOTORIETY_DECAY_HR` 4). **Anti-grief (`PATRON_NOTORIETY_CAP` 24):** unlike the business raid
(owner-only scrutiny, ungriefable), a club's notoriety comes from OTHER players' patronage, so a rival
could otherwise flood the table/rounds to force ~$300k raids on the owner at ~$70/play. So each
`(patron, club)` pair contributes at most `PATRON_NOTORIETY_CAP` notoriety per rolling 24h — a token
bucket (the D3-wash/business-launder pattern, `chargeNotoriety`), deliberately **< `RAID_THRESHOLD`** so
no single account can push a club to a raid. Legit play stays uncapped (unlimited rounds/hands); only the
HEAT one account can generate is bounded, so a hot club needs genuinely distinct traffic — thematically
"a busy den draws the cops," not "one griefer with a bankroll can torch your front." Past
`RAID_THRESHOLD` (60), the owner's `collectSpeakeasy` rolls a lazy
raid over the above-threshold window (the **business-raid pattern** exactly — `resolveRaid`): a raid
SEIZES the pending bar take (clock reset — never minted, no ledger row, the business/territory precedent),
FINES the owner `RAID_FINE_RATE` (15%) of the value sunk (open + decor), clamped to pocket+bank
(`speakeasy:raid`, a §10.4 cash sink), and SHUTTERS the club for `RAID_SHUT_MS` (2h) — while dark it
serves no rounds/table and earns nothing (`income_at` is pushed to `shut_until`). `SPEAKEASY_RAID_P` is a
TEST-ONLY roll knob (the `BUSINESS_RAID_P` precedent — never in production). This makes the passive income
EARNED: the more you monetize (table + patrons), the hotter the club, the bigger the raid risk.

### §10.4
`speakeasy:table:*` + `speakeasy:raid` all ride the `speakeasy:` cash prefix already in the vocabulary
(zero invariant change); the table's rake is a taxed transfer and the win a gambling faucet (both
character_id'd → check (a) reconciles); the raid fine is a character_id'd sink; the seized pending is
never ledgered (never minted). New `speakeasies` columns `notoriety`/`notoriety_at`/`shut_until` (wiped
with the row at the owner's death); `speakeasy_patrons` gained `noto_used`/`noto_at` for the per-patron
cap. `test/speakeasy.js` covers the table (rake/win/notoriety/gates) and the raid (forced seize + fine +
shutter + the shut gate on rounds/table/income/**upgrade**), plus the anti-grief regression (12 hands
from one account cannot cross `RAID_THRESHOLD`). **Red-team fix (MED-1):** `upgradeSpeakeasy` also
resolves a pending raid first and refuses while shuttered — otherwise an owner dodged the raid roll (and
resumed income mid-shutter by resetting `income_at`) by upgrading instead of collecting.

---

## Step three — the revenue layer + the endgame social loop (BUILT)

Three mechanics that complete the Speakeasy: a real-money cosmetic tier (the revenue foothold), a P2P
buyout (districts clear without a death), and a cross-club renown axis (the "being seen" payoff). All
off-chain, §10.4-clean; the NFT/resale-royalty part of the cosmetic tier stays mainnet-gated (documented
below). Numbers are founder sign-off levers.

### (A) Cross-club RENOWN — the nightlife legend (pure status)
The "being seen" economy needed a payoff. **Renown** is a personal nightlife-scene reputation, DERIVED
live (no new column, no §10.4 surface — the Commission-seats "recompute on read" precedent) from the
character's actual patronage + ownership: `floor(Σ spent_cash / RENOWN.CASH_PER + Σ spent_omr ×
RENOWN.OMR_WEIGHT + ownClubPrestige × RENOWN.OWNER_WEIGHT)` across every `speakeasy_patrons` row +
their own club. Bottle-service ($OMR) is weighted heaviest — the flex is worth the most renown. It
DIES WITH THE STREET (the patron/club rows already wipe at death) — a nightlife legend is a living-man
axis, like season kills. `RENOWN.RANKS` (Nobody → A Face → A Regular → High Roller → Big Shot → King of
the Night) is a display ladder; `GET /v1/leaderboard/nightlife` ranks the scene (the hitmen-board
full-scan precedent). Pure status — outside §10.4 and the sim-audited balance (the hitman-rep argument).

### (B) The P2P BUYOUT (districts clear without a death)
Today a district's club only frees up when the proprietor dies. **A consensual sale** lets an active
market form: `listSpeakeasy(price)` sets `speakeasies.sale_price` (bounds `SALE_MIN`/`SALE_MAX`),
`unlistSpeakeasy` pulls it, and `buySpeakeasy(district)` (two-party, `withTwoCharacters(buyer, seller)`)
transfers ownership for the listed price — a TAXED cash transfer buyer → seller (the round/bodyguard
pattern EXACTLY: seller nets 98%, 1% street tax → buyback, 1% dev off-ledger; `speakeasy:buyout` both
sides, already in the `speakeasy:` cash vocabulary). The seller's pending bar take (and any pending
raid) is resolved/collected for THEM first (they earned it); ownership flips to the buyer, the guest
list resets (a new proprietor, a fresh house — `speakeasy_patrons` for the district cleared), and
`sale_price`/notoriety/`shut_until`/`income_at`/`decor_style` reset. The buyer must be `MIN_LEVEL`, not
already own a club (one-per-man), at the district, not jailed / hospitalized / safehoused (a public
sit-down — the round/table parity), and carry the price. The club keeps its physical build (tier, name,
prestige — the buyer bought the establishment) but the **decor STYLE reverts to stock**: a style is an
account-level, owner-BOUND cosmetic entitlement (the seller keeps their `store_cosmetics` unlock for their
next club), so the new owner brings — or buys — their own (no displaying a cosmetic you don't own). §10.4:
a taxed transfer + a normal
income collect — no new reason, no invariant change. Deferred: a HOSTILE contest/takeover (a personal
venue isn't gang turf — hostile seizure is a griefing-risk balance call, left for a later step; death
+ the consensual sale cover the district-lock problem).

### (C) The ETH COSMETIC DECOR tier (the revenue foothold — Store rail, chain-dormant)
Cosmetic club **decor styles** — display-only skins on the club — sold through the EXISTING Store rail
(the M6 off-chain-first / chain-dormant pattern), so the whole revenue mechanism (the three-way split,
PLEX-in-earned-$OMR, idempotency, reconcile-at-link) is already built + audited. New `STORE.PACKAGES`
SKUs (`decor_deco`/`decor_gilded`/`decor_midnight`) grant an account-level cosmetic UNLOCK
(`store_cosmetics (account_id, style)` PK pair — SURVIVES DEATH, the patron-badge/mint-credit
precedent); the owner `applyDecor(style)` swaps an OWNED style onto their club (`speakeasies.decor_style`,
display-only, free to re-apply — you own it). §10.4-NEUTRAL by construction: the Store writes ZERO
`transactions` rows (the cosmetic is an out-of-band entitlement); the PLEX path burns `plex:<sku>` (the
existing plex:% term). Payable in ETH (dormant paywall) OR earned $OMR (PLEX, live now) — the same
anti-p2w posture as every Store SKU. **Deferred (mainnet-gated):** the cosmetics-as-NFT + resale-royalty
market (the GearVault rail — cosmetics minted to the player's ERC-1155, tradeable P2P with a creator
royalty) is the on-chain revenue engine, gated on legal + the third-party audit like all chain work; the
account-level unlock built here is exactly what that NFT would represent, so it's forward-compatible.

### §10.4 (step three)
Renown: pure derived status, zero §10.4. Buyout: `speakeasy:buyout` (a taxed patron→owner TRANSFER, both
character_id'd — check (a) reconciles, IDENTICAL to `speakeasy:round`) + a `speakeasy:income` collect for
the seller — no new reason, no invariant change. Cosmetics: Store entitlement (no `transactions` row) +
the PLEX `plex:<sku>` burn (existing plex:% term) — no invariant change. New columns
`speakeasies.sale_price`/`decor_style` + the `store_cosmetics` table (account-level, survives death).
`test/speakeasy.js` covers the buyout lifecycle (list/unlist/buy, the taxed transfer, ownership +
guest-list reset, gates), decor (own-gate, apply/swap, board surface), renown (computed from patronage +
ownership, the ladder, the leaderboard), and §10.4 (the buyout reconciles as a taxed transfer).

### Step-three red-team (independent, five-lens)
A focused adversarial review returned **CLEAN — no CRITICAL/HIGH/MED**: the buyout §10.4 reconciles
byte-identically to the audited round/`bodyguard:hire` transfer, lock order is acyclic (chars → leaf club
→ `street_tax` singleton, no AB-BA vs concurrent buyouts/rounds/collects), no persist-clobber (all
character mutations are in-memory, only `speakeasies`/`speakeasy_patrons`/`street_tax` are SQL-written),
the stale-seller race is handled (re-read under lock + owner compare → `gone`), `store_cosmetics` survives
death (account-keyed, absent from `runEstate`), renown is power-free (no gameplay gate reads it), and
`decorStyleOf` is proto-safe. Two LOW consistency items were fixed in-commit (regression each): **LOW-1**
the buyer now gates `hospitalized`/`safeHoused` (parity with round/table/bottle — a public sit-down);
**LOW-2** decor now REVERTS to stock on sale (a style is an owner-bound account entitlement, so no
displaying a cosmetic you didn't buy — the seller keeps their unlock). Accepted (flagged, not patched):
`list`/`unlist`/`decor` carry no jail gate (they move no value — matches `nameSpeakeasy`/`collect`/`upgrade`),
and the buyout is a large-denomination 2%-taxed P2P cash rail (an RMT/gifting pipe — but the same rate
class as the accepted uncapped `bodyguard:hire`, and TIGHTER with a hard `SALE_MAX` cap; §10.4-clean).

---

## Step four — the hostile takeover + the renown perk (BUILT)

Two of the three deferred items, both off-chain (the NFT market stays mainnet-gated, below). §10.4-clean,
numbers are founder sign-off levers.

### The STANDOVER (the hostile forced-sale)
The consensual buyout (step 3) lets willing owners trade clubs; the Standover forces an UNWILLING owner
out — the "you're too weak to hold this" mechanic the Risk-to-Earn design wanted (your club is at stake).
Deliberately designed to AVOID a new escrow §10.4 surface: it's an INSTANT muscle contest (the shakedown
pattern), not a windowed auction. `standoverSpeakeasy(district)` (two-party `withTwoCharacters(challenger,
owner)`): the challenger pays `STANDOVER.FEE` ($250k, a `speakeasy:standover` cash SINK that BURNS win or
lose — the cost of trying, the npcHit-fee precedent), then rolls `p = clamp(BASE_P + (atk − def)/STAT_SCALE,
MIN_P, MAX_P)` where atk/def are the muscle+cunning/2 effStat contest (the shakedown formula, BRUISER-boosted).
A **WIN** forces the owner to SELL at the club's **ASSESSED (build) value** (`assessedValueOf(tier)` = open
cost + every tier build climbed) — the owner is PAID (taxed, IDENTICAL to the `speakeasy:buyout` transfer:
98% net, 1% tax → buyback, 1% dev), so it's a forced SALE, never theft. The challenger risks the fee AND
must carry the full assessed price (gated up front) — so standing over a maxed Cathedral commits ~$19M, which
economically bounds griefing. A **LOSS** burns only the fee, costs health, and the owner keeps the club.
Either way the club goes on a per-club `STANDOVER.CD_MS` (24h) cooldown (`standover_cd_until`) so it can't be
leaned on back-to-back. Gated: challenger `MIN_LEVEL`/at-district/not jailed/hosp/safe/one-per-man/not-owner/
not-family(omertà); club exists/not shut/not on cooldown. `SPEAKEASY_STANDOVER_P` is a TEST-ONLY roll knob
(the raid/npcHit precedent). §10.4: the fee is a `speakeasy:` SINK, the win reuses `speakeasy:buyout` — both
under the existing prefix, so **no escrow bucket, no new invariant check, no vocab change**. The forced-out
owner forfeits pending bar take (the raid/territory-seize precedent — uncollected income vanishes on a hostile
event, never minted). No new death surface (instant — no pending state; the cooldown dies with the club).

### The renown PERK — earned decor (access/status, never power)
The renown axis (step 3) gets its one perk: **renown-EARNED decor styles** — cosmetic club skins you unlock
by BEING SEEN, no ETH/PLEX. `RENOWN.STYLE_UNLOCKS` (`house` at 800 renown, `crown` at 2000) gate two new
`DECOR_STYLES`; `applyDecor` accepts a style if you own it (a Store `store_cosmetics` unlock) OR your renown
clears its threshold. Pure cosmetic — access, never gameplay power (the design's hard rule). §10.4 untouched
(display-only, no currency). The console decor picker shows earned styles (★) alongside bought ones.

### §10.4 (step four)
Standover: `speakeasy:standover` (a fee SINK) + on-win the existing `speakeasy:buyout` taxed transfer — both
character_id'd under the `speakeasy:` prefix, so check (a) reconciles with NO new escrow bucket / invariant /
vocabulary. Renown decor: pure status, zero §10.4. New column `speakeasies.standover_cd_until`.
`test/speakeasy.js` covers the standover (cash gate, the fee burns win/lose, a loss keeps the club + sets the
cooldown, a win forces a taxed sale at the assessed value + transfers ownership + resets the guest list) and
renown-earned decor (the renown gate + the earned-style apply).

## Deferred (step five)
The cosmetics-as-NFT + resale-royalty market (the GearVault/chain rail — cosmetics minted to the player's
ERC-1155, tradeable P2P with a creator royalty; mainnet-gated on legal + the third-party audit, the M6
dormant pattern — the account-level `store_cosmetics` unlock built in step 3 is exactly what that NFT
represents, so it's forward-compatible), the WINDOWED contested auction variant of the takeover (an escrow
bid the owner can defend/outbid — deferred in favour of the leaner instant Standover), and deeper renown
perks (all constrained to access/status, never power).
