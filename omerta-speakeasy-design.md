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

## Deferred (step three, the revenue layer)
The **real-money (ETH) cosmetic decor + bottle-service tier** (the Store/GearVault rail — cosmetics-as-
NFTs with resale royalties, the recurring-revenue engine), a **P2P buyout/contest** so districts clear
without a death, and a cross-club **renown** axis. All chain work is mainnet-gated (legal + third-party
audit), the M6 dormant pattern.
