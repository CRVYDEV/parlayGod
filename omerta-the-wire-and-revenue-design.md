# The Wire, the Dynasty Fund, and the Revenue Engine — design + brainstorm

Founder-directed 2026-07-19. Three threads: (1) **The Wire** — the next feature; (2) **the Dynasty
Fund + more tickers** — expanding the RWA layer; (3) **ETH revenue** — creative, self-sustaining ways
for players to spend real money, split between founder profit, the $OMR buyback flywheel, and the RWA
reserve. The through-line: **spenders fund earners** — whales buy real-money packages, the Vig
redistributes to skilled players as $OMR prizes and buyback support, engagement grows, more whales.

The hard rails (unchanged, from the existing chain/legal design):
- Real ETH is **out-of-band value** — never a §10.4 ledger row. The on-chain `OmertaFees` tollbooth
  forwards ETH straight to the dev wallet in the same tx; the backend only credits an in-game
  *entitlement* (`fees.js:recordFeePayment`).
- **Never sell $OMR or securities for ETH directly** (unregistered-offering / securities risk). ETH
  buys **cosmetics, status, access, and consumables** — never raw sim-audited power, never tokens.
- The RWA layer is **status-only in R1** (deterministic price, no sell, no cash-out). R2 (a real RWA
  reserve backing shares) and R3 (KYC'd on-chain extraction) stay **legal-gated** (Robinhood
  partnership + securities counsel + third-party audit) — design now, wire later.
- Everything buildable **now** is off-chain, §10.4-clean, no new regulatory surface. Everything that
  touches real ETH is built **dormant** (the M6 pattern — inert unless `CHAIN_RPC_URL` + contract
  addresses are set), so mainnet stays gated on legal + audit.

---

## 1. THE WIRE — the intelligence terminal (proposed feature)

**Concept.** The mob wiretap meets the Bloomberg terminal. Today "the Wire" is just the live
notification feed. The Wire *feature* turns information into a first-class, spendable resource: pay to
**know things** (surveillance on rivals, threat chatter, market signals) and pay to **not be known**
(sweep for bugs, go dark). It ties the whole game together — the Law, PvP, the contract board, and the
RWA ticker tape — into one screen, and its premium tier is a natural recurring sink.

Three layers (all off-chain, §10.4-clean cash/$OMR sinks — the premium tier can *also* accept ETH later):

### 1a. Wiretaps (the offensive intel sink)
Pay to run a wire on a rival (a cash/$OMR sink → the buyback pool, the confiscation-buffer precedent).
For a time-boxed window it reveals what the peek/Underworld intel don't:
- their **Law stage** (clean/watched/investigation/indicted) and rough heat;
- their **operations** — businesses/rackets/territory they run, and their approximate income;
- whether they're **hunting you** — an open search or contract on your head (pierces the intel-peek
  space), or forming a war;
- their **recent big moves** (a laundering run, a big invest, a war declaration).
Counter-play: **sweep for bugs** (a defensive sink) reveals + removes taps on you; at high Underworld
standing a tapped mark gets a faint "static on the line" tell. Optional: **feed disinfo** (plant a false
signal a wiretapper reads).

### 1b. The Street Wire (the premium feed — the recurring revenue sink)
A subscription that upgrades the notification feed into an intelligence service:
- **Law forecasts** — early warning of crackdown/sweep weather and patrol windows (the Living World
  forecast, delivered as actionable alerts);
- **Threat chatter** — "someone's asking about you", a contract forming, a hunter placing a search;
- **The ticker tape** — live RWA prices + the day's mover (the Dynasty Fund tie-in);
- **War room** — alerts on your family's wars, turf, and Commission votes.
Paid in **$OMR** now (a recurring in-game sink); the **ETH option** is the dormant premium path
(§3). Because RWA prices are *deterministic and already knowable* (the forecast is a pure function of
the day), the Wire sells **convenience + surveillance on people**, not an unfair market edge — so it
stays clear of "insider information" concerns.

### 1c. The ticker tape / market wire
The Wire surfaces the RWA board as a scrolling tape + a "hot tip" (which ticker is trending today) —
making the Dynasty Fund feel alive and driving Portfolio engagement.

**Why The Wire is the right next feature:** it's the surveillance fantasy players want, it's a fresh
recurring sink (both $OMR and, later, ETH), it makes the deep Law/PvP/RWA systems *legible* on one
screen, and it's entirely off-chain/§10.4-clean to build. Numbers are founder sign-off levers.

**Open design fork (needs your call):** is The Wire (A) the full surveillance + premium-feed terminal
above; (B) just the premium information *subscription* (leaner); or (C) something else — e.g. the
real-money **store** surface itself ("wire money in")? My recommendation: **A**, built off-chain first
(wiretaps + the $OMR Street Wire), with the ETH subscription as the dormant premium path.

---

## 2. THE DYNASTY FUND + more tickers (BUILT this drop, + the vision)

**Built now (off-chain, §10.4-clean):**
- **Five new tickers** — the board went 3 → 8, a real risk spread: `GLD` The Vault (drift .05, safe
  store) · AAPL · `AMZN` The Everything Store (.10) · TSLA · `HOOD` The Green House (.16, the Robinhood
  nod) · `NVDA` Nero Graphics (.18) · SPCX · `BTC` Digital Gold (.30, pure degen). All status-only,
  deterministic price. Drop-in (the board/leaderboard/view iterate `TICKERS`).
- **The Dynasty** — the account-level book already survives death (the heir inherits), so it *is* a
  generational fund. Now you can **name it** (`POST /v1/dynasty/name`, a `DYNASTY_NAME_OMR` 5 $OMR
  vanity sink ledgered under the existing `rwa:%` burn term — zero invariant changes). The name
  outlives every character, shows the **generation count** (deaths + 1), and **heads the legit-legend
  leaderboard** (the board now ranks *dynasties*, with the living steward beneath).

**The vision (proposed next steps for the Dynasty Fund):**
- **Dividends / compounding** — a small, sink-funded $OMR trickle to holders (redistribution from the
  event fund / Vig prize pool, *not* a mint), so the fund feels like it *works* for you across
  generations. Bounded like the stake pool.
- **Dynasty tiers / crest** — status ladders on total lifetime invested (the estate/seal precedent).
- **Family dynasty** — the gang book (`gang_portfolios`) gets the same naming + leaderboard treatment.
- **R2 (legal-gated):** a slice of ETH revenue buys **real RWA** into a reserve that *backs* the
  in-game shares — the "going legit" fantasy made real. Design the reserve accounting now (mirrors the
  withdrawal reserve / full-reserve queue); wire on legal + Robinhood.

---

## 3. THE REVENUE ENGINE — creative ETH sinks (brainstorm)

The goal: more ways to spend ETH, split three ways — **(F) Founder wallet** (profit), **(B) Buyback
flywheel** (Vig → buy $OMR off the AMM → back withdrawals + fund staker yield + prize pool), **(R) RWA
reserve** (back the Dynasty Fund, legal-gated). A single config split (`REVENUE_SPLIT_BPS = {founder,
buyback, rwa}`) the founder tunes. Today the on-chain fee forwards 100% to the dev wallet and the Vig
split is off-chain accounting; the new model makes the split explicit and configurable.

### The mechanisms (ranked by revenue potential × legal-safety × build-cost)

**Tier 1 — build first (safe, recurring, proven):**
1. **The Season Pass / "The Ledger"** — a recurring (monthly) ETH pass with a cosmetic + status reward
   track + a small $OMR stipend paid from the *prize pool* (redistribution, not a mint). The
   single strongest recurring-revenue model in games, and legally clean (a cosmetic pass, not tokens).
   Ties to the Vig: pass ETH → split F/B/R.
2. **The Premium Wire subscription** (§1b) — recurring ETH (or $OMR) for the intelligence terminal.
   Convenience/surveillance, never power — clean.
3. **The Vanity Store** — buy the existing cosmetic sinks (estate tiers/features, family seals &
   foundations, auction bids, plates/crests/titles, dynasty names) with **ETH** instead of $OMR.
   Pure cosmetic, zero pay-to-win, highest margin. (Mechanically: an ETH payment → an entitlement →
   the same in-game cosmetic grant.)

**Tier 2 — build with care (consumables/access, bounded so they don't break the sim-audited balance):**
4. **Revive-insurance bundles** — the existing `respawn_token` (0.10 ETH) sold in 3/5-packs at a
   discount. Already a designed consumable; just packaging.
5. **The Made Man tiers** — escalating one-time ETH packs that grant the *extract gate* (mint credit)
   + cosmetics + a founder's-cut of starting cachet (status, not power). The mint credit is the
   existing precedent (access to extraction, carefully bounded — free-trial characters still play
   fully).
6. **Cosmetic loot crates** — ETH buys a crate of *cosmetic-only* items (skins/plates/titles). NB:
   never RWA or power by chance (the R3 "never distribute securities/power by chance" rule) — cosmetics
   only, and disclose odds.

**Tier 3 — high-margin flexes (whale status, one-off):**
7. **Named landmarks / dedications** — pay ETH to put your dynasty name on a district landmark, a
   street, a plaque on the map. Permanent status flex, near-100% margin.
8. **Founder's boxes / charter memberships** — a limited "founding family" tier (numbered, permanent
   badge) — early-supporter monetization.

**Tier 4 — legal-gated (design now, wire later):**
9. **PLEX bridge (already designed)** — pay a real-money fee from *earned $OMR* instead of ETH (the
   EVE "pay your rent in ISK" path). ETH payers fund the pool; $OMR payers shrink supply. Live in
   `vig.js` (chain-dormant).
10. **R2 RWA backing / R3 extraction** — the Dynasty Fund's on-chain future. Securities + KYC —
    gated on Robinhood + counsel + audit.

### The split, made concrete (my recommended default — a founder lever)
Per ETH package: **Founder 40% · Buyback 40% · RWA reserve 20%** (matches the existing Vig posture: the
non-Vig 40% is dev/business, and of the 60% Vig share, half backs withdrawals). Tune freely:
- Want more profit now → raise Founder.
- Want a hotter token flywheel + happier earners → raise Buyback.
- Building toward "the Dynasty Fund is really backed" → raise RWA reserve.
The buyback share is what makes the game **self-sustaining**: real spend → $OMR bought off the AMM →
price support + staker yield + prize pool → earners have something real to grind → retention → more
spend. Extraction stays **≤ inflow by construction** (the full-reserve withdrawal queue already
enforces it — the reserve can only sign what real revenue funded).

### The anti-pay-to-win guardrail
Every ETH package sells **cosmetics, status, access, or bounded consumables** — never raw combat/economic
power that would break the sim-audited §10.4 balance. This keeps the game fair (skilled free players can
top the leaderboards), keeps it legally clean (no tokens/securities sold), and protects the "spenders
fund earners" model (earners must be able to *win* the prizes whales fund).

---

## 4. What I built this drop vs what needs your call
**Built (off-chain, §10.4-clean, tests green):** the 5 new tickers + the named Dynasty (a $OMR vanity
sink + generational leaderboard + console surface).

**Needs a founder decision before I build (product vision + real-money/legal weight):**
1. **The Wire's shape** — A (surveillance + premium feed), B (premium feed only), or C (the store
   surface). *Rec: A, off-chain first.*
2. **Which ETH packages to prioritize** — Season Pass, Premium Wire sub, Vanity Store, revive bundles,
   Made-Man tiers, named landmarks. *Rec: Season Pass + Vanity Store first (safest, most recurring),
   then the Premium Wire.*
3. **The revenue split** — Founder / Buyback / RWA-reserve BPS. *Rec: 40/40/20, env-configurable.*

Once you pick, I build The Wire's off-chain core + the ETH-package *entitlement scaffolding* (dormant
chain layer, the M6 pattern) so nothing touches mainnet until legal + audit sign off.
