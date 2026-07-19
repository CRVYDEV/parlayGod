# AUDIT — UI/UX & gameplay-flow (the client, the onboarding, the new-player journey)

Max-effort review of the playable console (`public/index.html`, ~1900 lines), the onboarding/coaching
system (`growth.js` onboard board, `game.js:coachOf`, the welcome/glossary/empty-state layer), and the
new-player flow across ~31 shipped systems. Three independent lenses were run (console UX, onboarding +
flow, full feature inventory) and cross-checked against `server.js` routes and `rules.js` numbers.

**Headline.** The backend is enormous and correct; the *client makes almost none of it legible to a new
player.* Three structural problems hurt everyone: (1) the guided onboarding funnel pointed players at
destinations that didn't exist (a genuine dead-end), (2) the foundational trade-goods economy had no UI
while three other systems told players to use it, and (3) **22 flat tabs with no hierarchy** bury core
screens next to niche endgame ones. This pass FIXED the dead-ends and the cheapest legibility wins, added
an in-game **CODEX** (the wiki), and refreshed the onboarding to match the game as it exists now. The rest
is documented below, ranked, as the follow-up backlog.

---

## FIXED THIS SESSION (shipped in this pass)

| # | Fix | Files |
|---|-----|-------|
| A | **Path dead-end (was a BLOCKER).** The coach + First-Week checklist sent a level-5 player to Streets to declare a Path, but no Path control existed there and the raw deck shipped an invalid `{path:'earner'}` body → `bad_path`. Added a curated **Declare Your Path** card to Streets (shown at lvl 5, live from `rules.paths`), a "coming at level 5" teaser below it, and fixed the deck template. `/v1/rules` now serves the `paths` catalog. | `server.js`, `public/index.html` |
| B | **Trade-goods economy had no UI (was HIGH).** Black Market and Convoys both say "buy goods on the Streets first" — but Streets had no goods control, so the whole smuggling pillar was bootstrap-blocked. Added a **Trade Goods** buy/sell grid to Streets (spot price + trunk qty per good). | `public/index.html` |
| C | **Raw error codes leaked to players (was HIGH).** `safe`, `pax`, `contention`, `feds_watching`, `cold`, `witpro`, etc. surfaced verbatim in toasts. Added an `ERRMAP` code→sentence table in `describe()` (40+ codes) with a `_`-to-space fallback. | `public/index.html` |
| D | **Coach went silent at ~level 8 and ignored urgent threats.** Added top-of-ladder rungs for **wanted / indicted / welsher** (time-boxed, clearable, urgent) and a late-game bridge toward **skills** (lvl ≥ 4, unspent) and **going legit** (lvl ≥ 15, holds $OMR, no book) so the coach keeps guiding into the deep game. | `game.js:coachOf` |
| E | **Onboarding copy was M4-era.** Expanded the glossary from 9 → 21 terms (safehouse, wanted/welsher, the Law/indicted, the Pen, in-transit/unbonding, skills, family/Commission, vendetta, the Underworld, renown/notoriety/scrutiny, the Wire) and refreshed the welcome modal (depth warning, "watch the coach line," two survival rules, a CODEX pointer). | `public/index.html` |
| F | **No knowledge base.** Built a served, navigable in-game **CODEX** (`/wiki`) covering every system and loop, linked from the top bar; and `docs/WIKI.md` as the canonical text. | `public/wiki.html`, `server.js`, `docs/WIKI.md` |
| G | `data-do` buttons now honor an optional `data-body='{…}'` (reusable; drives the Path buttons). | `public/index.html` |

Verification: `node --check` on both sources; `test/growth.js` (which covers `coachOf`) green; full suite green.

---

## RANKED FINDINGS (the full backlog)

Severity: **BLOCKER** (breaks a core path) · **HIGH** (whole systems invisible / frequent player pain) ·
**MED** · **LOW**. "Status" marks what this pass did.

### 1. BLOCKER — Onboarding funnel routed to dead ends · **FIXED (A)**
Path declaration is now a first-class Streets card. *Remaining sub-item:* the `ob_wallet` First-Week task
still routes to the raw deck's two-step SIWE flow with no signing helper — a guest with no browser wallet
can't complete it. **Recommend:** a curated "Connect Wallet" widget (address → `window.ethereum`
`personal_sign` of the challenge → verify), or mark the wallet task explicitly optional so it doesn't gate
the capstone. (Deferred here — it needs a real wallet to test end-to-end.)

### 2. HIGH — Trade-goods economy had no UI · **FIXED (B)**

### 3. HIGH — Core economy loops reachable only through the raw "Everything Else" deck
Deck-only today (each route appears once, inside the raw JSON-body power tool): **swap/laundering**
(`/v1/swap`), **staking** (`/v1/stake`, `/unstake`, `/claim-rewards` — the sheet even shows a "staked"
figure with no way to stake), **rackets & assets** (`/v1/rackets|assets/:id/buy` — a whole buy-once/
drip-forever passive layer), **daily contracts & missions** (`/v1/daily`, `/v1/missions/:id` — the intended
level-1→10 progression, and they need ids the player can't see), **NPC rival-family raids** (`/v1/world`),
**workshop crafting**, the **cb/ammo Exchange**. **Recommend:** promote swap+stake into "Going Legit,"
rackets/assets into "The Empire," daily/missions into "Start Here," world-raids into "The City." These are
day-1-to-endgame retention loops most players will never find.

### 4. HIGH — Whole shipped systems have zero client surface (not even the deck)
- **Reserve Bonds** — `/v1/bonds*` appears **0 times** in the client. The 30th shipped system is invisible.
- **Family seals & crest/rename** — `vanity/seal`, `gangs/vanity` appear **0 times**; the Family tab shows a
  seal *chip* but no way to buy one. These are the family $OMR sinks the economy relies on.
- **Underworld gun-buyback**, **vanity plate**, and other tail routes — absent from curated screens and deck.
**Recommend:** a Bonds card in "Going Legit," seal/crest/foundation purchase in the Family dashboard, and
deck groups for the tail at minimum. (Foundation *is* surfaced; seals are not.)

### 5. HIGH — 22 flat tabs, no hierarchy, journey-blind ordering
`start, streets, pvp, kitchen, family, market, garage, empire, speakeasy, boxing, scores, loans, portfolio,
estate, life, pen, law, wire, store, city, den, deck`. Niche endgame systems (Speakeasy, Fights, Estate,
Wire, Store) get identical billing to Streets; the **Garage** (an onboarding task) is 7th; the **Den** and
**City** are near-last; **the Law** (a consequence surface players need the moment a red chip lights) is
17th. **Recommend:** group into 4–5 labeled clusters (Core · Rackets · Combat · Family/Social · Endgame) or
collapse rare tabs behind "More," and reorder by journey (Streets · Garage · Kitchen · Den · City · Law
lead). This is the single biggest structural IA win.

### 6. HIGH — Cryptic error codes · **FIXED (C)** (map is extendable; add codes as new ones ship)

### 7. HIGH — No idempotency / double-submit protection on money actions
`api()` never sends the `Idempotency-Key` the server supports, and buttons aren't disabled in-flight. A
double-tap on bid/buy-now/invest/cook/deal fires twice. **Recommend:** a per-action UUID `Idempotency-Key`
header + disable-until-response. The server already has the machinery; the client throws it away.

### 8. MED — "Declare war" needs a pasted raw gang id
Once you're in a family the rival-families board isn't shown, so war requires copying an opaque id from the
deck. Contracts and loans already do target dropdowns right. **Recommend:** a rival-family `<select>` on the
Family dashboard.

### 9. MED — No confirmation on destructive / expensive actions (inconsistent)
`confirm()` is used exactly once (standover). Melt-a-car, leave-family, respec (burns $OMR), estate upgrade
(thousands of $OMR), invests, fire/shank/npc-hit (lethal), collect-a-debt (breaks legs) all fire instantly.
**Recommend:** one consistent confirm (echo the cost) on irreversible / high-value actions.

### 10. MED — The open tab goes stale; only the sheet auto-refreshes
The 30s poll, visibility handler, and WS `me` handler all re-render only the sheet. A live board (contracts,
nightlife, auction) stays stale until you re-tab → players act on stale data and eat error toasts.
**Recommend:** dispatch a re-render of the *active* tab on relevant WS/`me` events. (This pass added
`renderStreets` on tab entry; generalize it.)

### 11. MED — The PvP "hunt" is client-local and fragile
The active search lives in `localStorage`, written only by the PvP search button — a search started
elsewhere never records a hunt, and FIRE readiness is computed client-side so it can disagree with server
readiness (executioner/Underworld search-time cuts). **Recommend:** source the active search from the server
(`/v1/me` or `/v1/streets`) with a server-authoritative ready time.

### 12. MED — No global "active timers" view
Batch cooking, convoy-on-the-road, search placed, heist cooldown each live only inside their own tab across
a 22-tab surface, so players forget them. **Recommend:** a compact "in progress" strip on the sheet
(batch ready in X · convoy arrives X · mark ready · heist cd) with jump links.

### 13. MED — Store & wallet flows are largely non-actionable
The Store shows ETH prices with a buy button only for PLEX; ETH purchase points at an on-chain paywall that
doesn't exist in-client, and "link a wallet" points at the deck SIWE flow with no signer. **Recommend:**
per-SKU "available at launch" state + the wallet widget from finding #1.

### 14. MED — Mobile: the 22-tab rail doesn't scroll the active tab into view
On programmatic tab switches (welcome → Start Here, coach "take me there") the highlighted tab is often
off-screen on a phone. The stacked layout also isn't sticky, so every nav scrolls past the whole vitals
block. **Recommend:** `scrollIntoView({inline:'center'})` on `setTab`; a condensed sticky vitals bar on mobile.

### 15. MED — Leaderboards inconsistent: nightlife & boxing use blocking `alert()`
Portfolio/hitmen render inline cards; nightlife and boxing dump into `alert()`. **Recommend:** render inline.

### 16. LOW–MED — `--gold` CSS var / `.chip.gold` used but never defined (styling silently no-ops)
**Recommend:** define `--gold` (or alias `--neon`) and a `.chip.gold` rule.

### 17. LOW–MED — Many actions toast a flat "done." with no numbers
`describe()` recognizes an enumerated success set; tribute/seize/establish/vote/gift/penance/skill-learn fall
through. **Recommend:** extend `describe()` (or have the server always return a `message`) so every action
confirms its concrete effect.

### 18. LOW — Blocked actions rarely explain "why can't I do this"
Crime/buy buttons aren't disabled when gated (level/energy/cash/location); the player clicks and gets a
toast (now humanized by fix C, but a pre-emptive disabled-with-reason is better). **Recommend:** compute
affordability/level gates client-side from `me`+`rules`; dim with a reason.

### 19. LOW — Numeric inputs unvalidated (empty → `0` → server error)
**Recommend:** `type=number`, min/step, a pre-submit guard.

### 20. LOW — Polish: varied cancel verbs, redundant `/v1/me` fetches per action, WS token in the URL query
string, empty-state coach cards missing on pvp/family/law/scores/life. **Recommend:** as noted; low priority.

### Admin dashboard (`admin.html`) — solid, minor gaps
Fit-for-purpose (mod-key gate, §10.4 OK/DRIFT banner, economy/players/funnel/chain panels, confirm-gated
actions). Gaps: no per-player drill-down (despite `/v1/mod/audit` existing), drift banner shows counts but
no link to offending rows, no history/trend. Not blockers.

---

## GAMEPLAY-FLOW MAP (new-player journey) & remaining friction

- **First 10 min** — create → welcome → Start Here → first job → boost a car. **Clean, works.**
- **First hour** — bank, train, reach lvl 5, **declare a Path** (was the dead-end, **now fixed**), join a
  family at lvl 3. The repeatable early faucets — **Daily Score, Daily Contracts, Missions** — are still
  deck-only (finding #3); surfacing them is the biggest remaining early-game win.
- **First day** — family dashboard, first earner (Kitchen / a business / a racket), first PvP, first heat.
- **First week** — finish the 9-task checklist (wallet task is the one hard step, finding #1 remainder).
- **Mid/late** — territory, endgame $OMR sinks (estate, auction, seals, foundation, landmarks), going legit,
  the Vig/extraction loop, bonds. The coach now bridges toward skills + going-legit (fix D); the endgame
  sinks (bonds, seals) still need surfacing (finding #4).

**Softlock check:** no true softlocks — jailed/hospitalized/broke are all recoverable and the coach
redirects correctly. The one functional wall was the Path dead-end (fixed).

---

## TOP 5 HIGHEST-LEVERAGE (remaining)
1. **Restructure the 22 tabs into labeled groups + reorder by journey** (finding #5) — the biggest legibility
   win; nothing else changes how the game *feels* to navigate as much.
2. **Promote the deck-only core loops into curated screens** — swap/stake → Going Legit, rackets/assets →
   Empire, **daily/missions → Start Here** (the early-game faucet), world-raids → City (findings #3/#4).
3. **Surface the invisible endgame sinks** — Bonds card + Family seals/crest (finding #4) — built, tested,
   balance-signed features the economy depends on, currently undiscoverable.
4. **Idempotency-Key + disable-in-flight on money actions, and re-render the active tab on WS events**
   (findings #7/#10) — eliminates double-spends and stale-board mistakes across the whole client.
5. **The wallet-link widget** (finding #1 remainder) — unblocks the last First-Week task and every $OMR/gear
   extraction.

*Numbers, gates, and balance levers referenced here are the founder's sign-off levers (ground rule #1) and
were not changed. This audit is UI/UX/flow only — no mechanic was retuned.*
