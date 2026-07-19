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
