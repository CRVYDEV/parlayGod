# OMERTÀ Backend — M1

Server-authoritative backend for OMERTÀ, built to `omerta-backend-spec.md` (in this repo). M1 delivers the playable solo loop: auth, character creation, lazy accrual, crimes, gym, Doc, bank, travel, daily check-in — with the transaction ledger and RNG audit live from day one.

## Run it (zero setup)
```
npm install
npm test        # full smoke test on an in-memory database
npm start       # API on :8787 using pg-mem (no Postgres needed)
```
Set `DATABASE_URL=postgres://...` to use real Postgres (schema auto-applies). Set `JWT_SECRET` in production.

## Play it (the console)
`npm start`, then open **http://localhost:8787/** — the playable web console (`public/index.html`, one
static file, no build step, no extra deps). Guest sign-in → name a street character → the sheet (live
vitals), and a curated screen for EVERY major system: **Wet Work** (contracts, hunts, defenses, the
roster), **the Law** (the meter, the courtroom, the informant's door), **the Kitchen**, **the Family**,
**the Black Market**, **the Garage** (fleet + armory), **the Empire** (fronts + the pad),
**Big Scores** (solo + crew heists, convoys), **the Shylock** (loans + the paper market), **the Life**
(skills + the Underworld), **the Pen**, the City board, the Den, a live websocket feed ("the wire"),
and an **Everything Else** deck that reaches the remaining `/v1` routes raw (`:params` become inputs,
JSON bodies editable). `GET /v1/rules` serves the public rulebook (crimes/districts/guns/goods/lab
ladder/trade ranks) that powers it — server-authoritative always; the client only ever sends choices.

## Chain go-live (the devnet proof)
The full §11 rail — contracts + backend + watcher — is proven end-to-end by `tools/chain-e2e.js`
against ANY EVM RPC (a local dev node or the Robinhood Chain testnet):
```
npm i --no-save solc@0.8.26 @openzeppelin/contracts@5.1.0 ganache   # ad-hoc, never project deps
npx ganache --wallet.deterministic --chain.chainId 1337 &            # or point at a real testnet
node tools/compile-contracts.js                                      # solc-js, mirrors foundry.toml
CHAIN_RPC_URL=http://127.0.0.1:8545 CHAIN_ID=1337 \
DEPLOYER_PK=0x... PLAYER_PK=0x... VOUCHER_SIGNER_PK=0x... node tools/chain-e2e.js
```
27 asserted steps: deploy the suite → SIWE wallet link → 0.01 ETH `payMintFee()` on-chain (inexact
fee reverts) → the getLogs cursor watcher credits it → character MINTED → $OMR earned in-game
→ reserve funded → EIP-712 withdraw voucher signed → `claim()` on-chain (real
ERC-20 in the player's wallet; replay + tampering revert) → the `Claimed` watcher closes the
reserve accounting → gear voucher mints the ERC-1155 (uncapped ids fail closed; only VoucherClaim
mints) → §10.4 $OMR conservation holds with the chain live. The Foundry unit+fuzz suite
(`omerta-contracts/test`) now **passes 29/29 (incl. a 512-run fuzz) in CI** — `.github/workflows/forge.yml`
runs `forge test` on GitHub's runners on every contracts push; run it locally with `omerta-contracts/run-forge-test.sh`.

## Try it
```
TOKEN=$(curl -s -X POST localhost:8787/v1/auth/guest | jq -r .token)
curl -s -X POST localhost:8787/v1/character -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Lucky"}'
curl -s -X POST localhost:8787/v1/crimes/pick -H "Authorization: Bearer $TOKEN"
curl -s localhost:8787/v1/me -H "Authorization: Bearer $TOKEN"
```

## Layout
- `src/rules.generated.js` — the prototype's 22 data tables and NOTHING else. Machine-owned:
  `node tools/extract-rules.js path/to/omerta-game-v24.jsx` overwrites it wholesale, so never hand-edit
  it — change the PROTOTYPE and re-extract.
- `src/rules.tail.js` — the hand-written half: every constant, catalog, ladder, helper (`hash01`,
  `carMelt`, `goodPriceOf`, `levelOf`) and founder-signed lever. The extractor never touches this file.
- `src/rules.js` — re-exports both halves, so everything imports from here and no caller needs to know
  which half a name lives in. `test/rules.js` enforces the separation.
- `src/accrual.js` — spec §7.1 lazy accrual: regen (turf-aware), bank interest, racket/asset income, heat decay (the no-global-tick design)
- `src/game.js` — shared txn machinery: `withCharacter` (locks character + account), `withTwoCharacters` (locks both parties in stable order, §10.1), notifications + the websocket event bus, weekly family contracts
- `src/economy.js` — M2 actions: garage (melt tithes to the family), workshop, goods (turf prices), rackets/assets, the Vault (stake/unstake — principal only), gear, armory (swap + laundering retired by tokenomics v2)
- `src/social.js` — M3 actions: gangs, tribute, wars (+lazy resolution), turf seizure, jumps, hit contracts, death/estate, busting, the escrowed Exchange; M7 the Contract Board (hospitalize/kill contracts, directed hits, reason/expiry/refund) + the assassin reputation ladder (legend + season streak, ranks, leaderboard)
- `src/kitchen.js` — M4 §7.10: makings, the lab ladder, cook/collect, deal, crew, laylow, clean papers
- `src/growth.js` — M4 growth: paths, the Daily Score, missions, daily contracts, First Week claims, wallet link
- `src/verify.js` — §4 social verification (SOCIAL_VERIFY_MODE: off | trust | live)
- `src/invariants.js` — the §10.4 nightly ledger-invariant job: seven conservation checks + reason-vocabulary audit, telemetry + webhook alerting (`npm run invariants`)
- `src/ratelimit.js` — §10.2 token buckets: human 1/s burst 5, agent 1-per-3s, swaps 6/min (in-memory; Redis via REDIS_URL)
- `src/auth.js` — X/Privy sign-in, guest→provider upgrade, invite-code gate (INVITE_MODE=on)
- `src/chain.js` — M6-B chain service (§11, EVM): SIWE wallet link, EIP-712 voucher signing on viem (in parity with `VoucherClaim`), the full-reserve withdrawal queue, gear-mint vouchers, Claimed reserve release
- `src/fees.js` — §11 inbound real-ETH fees: the 0.01 ETH two-tier mint (free trial → permanent, withdrawal-eligible) and 0.10 ETH pre-paid revive insurance. Watches OmertaFees events, credits entitlements idempotently, reconciles pay-before-link. Never touches the §10.4 ledger (ETH → dev wallet on-chain)
- `src/worker.js` — hourly: the 12h buyback (§7.12) + season rollover (§8); daily: the §10.4 invariant sweep; the §11 chain-event sync poll; `npm run worker`
- `src/watcher.js` — §11 chain-event sync (audit F2/F3): polls `getLogs` over a persisted block cursor (`chain_cursor`), staying `CHAIN_CONFIRMATIONS` behind head — downtime backfills (no lost fee credits), shallow reorgs are never acted on. Idempotent; dormant without `CHAIN_RPC_URL`
- `src/server.js` — Fastify routes, JWT auth (+ban check), rate-limit + idempotency-key hooks, mod endpoints (MOD_KEY), `/v1/ws` websocket gateway
- `tools/backup.sh` — nightly pg_dump rotation (cron it with DATABASE_URL set)
- `omerta-contracts/` — M6-A on-chain suite (Foundry/Solidity) for Robinhood Chain; has its own README/CLAUDE.md. OMR, VoucherClaim, GearVault, OMRStaking + `OmertaFees` (the §11 entry/revive fee tollbooth — exact fees, ETH straight to the dev wallet, events the backend watches). `omerta-chain-migration-evm.md` documents the Solana→EVM switch.
- `schema.sql` — M1–M4 tables (spec §3 subset)
- `test/smoke.js` — M1 end-to-end journey + the §10.4 ledger invariant
- `test/economy.js` — M2 economy journey + §10.4 cash-ledger and car-conservation invariants
- `test/social.js` — M3 two-gang journey: war with spoils, hit → death/estate, live websocket push, buyback family split
- `test/growth.js` — M4 journey: kitchen loop with crew + raid, heist, missions, dailies, First Week capstone, referral qualification, mod tools
- `test/hardening.js` — M5: zero-drift invariants over an organically-earned economy, drift alarm, idempotency, invites, X OAuth + upgrade, season rollover, all three rate buckets
- `test/security.js` — red-team regression suite: one test per audited exploit (see `AUDIT.md`)
- `test/chain.js` — M6-B/C: SIWE link, EIP-712 signing parity (recovers the signer), full-reserve queue, $OMR ledger conservation, gear vouchers, the §11 mint gate (unminted can't withdraw) + fee reconcile (pay-before-link) + concurrent-credit safety
- `test/watcher.js` — §11 chain-event sync: confirmation-depth gating (reorg-safe), downtime backfill (no lost fee credits), cursor advance, idempotent reprocessing (mock chain source)

## M2 endpoints
`GET /market/prices` (deterministic, public) · `POST /goods/buy|sell` · `POST /garage/boost` · `POST /garage/:carId/melt|repair|fence` · `POST /workshop/craft/:id` · `POST /workshop/ammo` · `POST /items/:id/use` · `POST /rackets/:id/buy` · `POST /assets/:id/buy|sell` · `POST /stake` · `POST /unstake` (principal only — the yield retired to the family yield) · `POST /gear/:id/mint` · *(`POST /swap` and `POST /claim-rewards` answer `retired` since tokenomics v2 — cash and $OMR no longer trade; the Exchange window `POST /window/redeem` is the one-way $OMR→cash exit)*

## M3 endpoints
`POST /gangs` · `POST /gangs/:id/join` · `POST /gangs/leave|kick|promote|tribute` · `POST /gangs/war/:targetGangId` · `POST /districts/:id/seize` · `GET /gangs`, `GET /gangs/:id`, `GET /districts` · `GET /streets` · `POST /streets/:id/jump|bounty|search|fire|bust` · `DELETE /streets/search` · `GET|POST /exchange…` · `GET /notifications` · `POST /armory/gun/:id/buy|equip`, `/armory/vest/:id`, `/armory/ammo` · `GET /v1/ws?token=` (websocket)

## M7 endpoints (Contracts & Hitmen)
`POST /streets/:id/bounty` (kind hospitalize|kill, reason, hours, anon, hitman, exclusiveHours) · `GET /contracts` (the board) · `POST /contracts/:targetId/:kind/cancel` · `GET /leaderboard/hitmen` (legend + season) · `POST /streets/:id/npchit` (hire an NPC contractor — tier legbreaker|journeyman|professional; fee burns, rolled attempt) · `POST /safehouse` (go to ground — $25k, 4h untargetable by fire+npchit; Phase 4) · `POST /gangs/contract/:targetId` (boss/underboss posts a TREASURY-funded family contract; no member collects) · `POST /gangs/contract/:targetId/:kind/cancel` (refund → treasury) · `POST /bodyguard/offer` (list yourself, price ≥ $1k; 0 clears) · `POST /bodyguard/hire/:guardId` (24h window — the guard absorbs ONE lethal hit, hospitalized in your place, before any respawn token)

## M8 endpoints (Tailor & Engraver — vanity $OMR sinks, display-only)
`POST /vanity/name` (new street name, 5 $OMR — living-name uniqueness; rotates your referral code) · `POST /vanity/title` (custom title, 10 $OMR; empty clears free) · `POST /vanity/plate/:carId` (2 $OMR, 2–8 chars, engraved uppercase) · `POST /gangs/vanity/color` (boss only, #rrggbb, 10 $OMR) · `POST /gangs/vanity/name` (boss only, rename/retag, 25 $OMR)

## M8 endpoints (loop sinks — anonymity, counter-intel, respec)
`anon: true` on `POST /streets/:id/bounty` or `/gangs/contract/:targetId` (3 $OMR on a FRESH pot; top-ups inherit free) · `POST /contracts/peek` (5 $OMR — the mark reads every funder on their own head, pierces anon; free when nothing's posted) · `POST /respec` `{muscle,cunning,speed}` (15 $OMR — total conserved, each stat ≥ 5)

## Staking (the Vault) — principal only; the individual yield is RETIRED (tokenomics v2)
`POST /stake` / `POST /unstake` hold and release principal (unstaking still unbonds for the loot-exposure window; **principal always returns whole**). The old per-staker yield (`POST /claim-rewards`) answers `retired`: $OMR yield now pays THE FAMILIES — the top families by seasonal standing draw the **family yield** into their gang reserves, fed by a cut of every Exchange-window redemption (`yield:window`). Staked $OMR remains the safe harbour a fire-kill can't loot. Design: `omerta-tokenomics-v2-design.md`.

## Business Empire (premium, acquired-later personal fronts — cash farming under PvP risk)
`GET /catalog` (public — the venue catalog + tier ladders; laundromat lvl15 → casino lvl58) · `POST /business/:kind/buy` (level-gated, one per kind; cash sink `business:buy`) · `POST /business/collect` (lazy income → pocket cash, capped 24h; faucet `business:income`) · `POST /business/:id/upgrade` (next tier; collects pending at the OLD rate first; sink `business:upgrade`) · `GET /business` (your empire + pending income; also surfaced in the character view). *(`POST /business/:id/launder` answers `retired` — private laundering ended with tokenomics v2; cash can no longer become $OMR anywhere. With laundering gone, front scrutiny has no feed, so the Bureau-raid layer is dormant — a front's risk today is PvP.)* **The risk layer (PvP):** `POST /business/:id/shakedown` (a rival extorts 30% of a front's pending income in a muscle/cunning contest — per-venue 8h cooldown, heat win or lose, family off-limits; the owner keeps the rest pending) · hostile takeovers, inside-job heists, and a fire-kill can SACK a front outright (the killer takes it over). **The pad (recurring upkeep):** every front owes protection + wages = 20% of its income, accruing on its own clock (up to 7 days — distinct from the 24h income cap, so an absent owner owes more than they can earn) · `POST /business/upkeep` pays the pad on every front you can afford (cash sink `business:upkeep`) · a front unpaid past 3 days goes **cold** — no income, no upgrades — until you square it (`upkeepOwed`/`upkeepPerHr`/`cold` in the view). Numbers are founder sign-off levers. Design: `omerta-business-empire-design.md`, `omerta-recurring-sinks-design.md`.

## Risk-to-Earn Phase 3 — territory rackets (productive, seizable capital)
`POST /territory/:districtId/establish` (boss/underboss; one operation per district you hold; cost from treasury — Numbers $50k / Protection $250k / Smuggling $1M, marginal ROI TAPERS up the ladder per the sim audit) · `POST /territory/:districtId/upgrade` (next tier; collects pending first) · `POST /territory/collect` (any member banks the family's territory income to the treasury; lazy, capped 24h) · `GET /territory` (your family's operations). On a `POST /districts/:id/seize` the operation TRANSFERS to the victor with the turf — and seizing a BUILT district now costs a **war premium** (50% of the operation's cumulative build cost) on top of the garrison outbid, so raiding is no longer ~18× cheaper than building. Surfaced on `GET /gangs/:id` (`territory`). **The pad (recurring upkeep):** every operation owes protection + payroll = 20% of its income, accruing on its own clock up to 7 days · `POST /territory/upkeep` (boss/underboss pays it from the treasury on every operation you can afford) · an operation unpaid past 3 days goes **cold** — no income, no upgrades — until squared; seizure hands the victor a fresh clock (`upkeepPerHr`/`upkeepOwed`/`cold` in the view). Design: `omerta-risk-to-earn-design.md` (Pillar 2), `omerta-recurring-sinks-design.md`.

## Risk-to-Earn Phase 2 — the Vig (off-chain core; chain dormant, no mainnet extraction)
`POST /plex/mint` · `POST /plex/respawn` (pay a real-money fee from EARNED $OMR — burns `plex:*`, grants the same mint credit / respawn token an ETH payer gets; the EVE PLEX bridge) · mod/ops: `GET /mod/vig` (status + the extraction-≤-inflow invariant) · `POST /mod/vig/buyback` `{priceOmrPerEth}` (the DEX bot's manual/test twin — spends only unspent Vig revenue) · `POST /mod/vig/prizes` `{winners:[{accountId,omr}]}` (pay season prizes, backed by hard $OMR moved to the reserve). Real ETH fees route their `VIG_BPS` (60%) share into the pool; the reserve that backs every withdrawal is now fed only by revenue buybacks, so extraction ≤ inflow holds by construction. Design: `omerta-phase2-vig-design.md`.

## Smuggling convoys (bulk goods in transit — visible, ambushable, turf-sheltered)
`GET /convoys` (the road board: every run in transit with a value BAND, never the manifest; guard tiers listed, the one you bought stays secret; attempts made/left shown) · `POST /convoy` `{to, goodId, qty}` + `POST /convoy/load` (goods load FROM the trunk — refill from the market between loads: a convoy carries what a trunk never could; 5-unit minimum, one shipment at a time) · `POST /convoy/depart` `{guards, insure}` (none $0 / crew $5k / heavy $20k — a ledgered `convoy:guards` sink; 30 min on the road; **insure** buys a policy at 10% of the manifest into the shared pool) · `POST /convoy/:id/ambush` (up to THREE attempts per convoy, one per character — each fight wears the guards 25% for the next; energy + ammo + heat; owner/family/safehoused blocked; contest vs worn guards + turf + any lockdown decree — win takes what YOUR trunk holds, the rest rolls on; lose and the guards hospitalize you) · `POST /convoy/:id/collect` (after arrival, at the destination — a family holding those docks takes a **5% toll** of what lands, ledgered to their treasury; an insured hijack pays **50% of the lost value here, capped at the pool** — insurers only pay what premiums funded) · `POST /convoy/cancel`. Goods are ownership, not §10.4 currency — an ambush is a pure transfer; the toll/premium/payout are ledgered (`convoy:toll/insure/payout`, pool check exact). A dead shipper's freight scatters. Numbers are sign-off levers; `CONVOY_MS` is a TEST-ONLY knob. Design: `omerta-convoys-design.md`.

## Skills & Specializations (the build layer)
`GET /skills` (the tree + your build + points) · `POST /skills/:id` (learn — points derive from LEVEL, one per 4 levels; tiers cost 1/2/3 and build on each other, so one maxed branch = level 24 and two = level 48: builds bind) · `POST /skills/respec` (burn 10 $OMR to unlearn everything — the trainer sees you once a day, stats or skills). Three branches, all effects small single-touchpoint perks: **the Enforcer** (Bruiser +8% jump/shakedown attack → the Doc's Friend −25% healing → Executioner −20% hit-search time), **the Operator** (Fast Talker −20% laylow → Fence Network +8% fence/melt yields → Broker −50% Black Market listing fees), **the Wheelman** (Pack Mule +3 trunk → Getaway −20% crime stints → Road Captain −20% convoy time). Skills die with the street — the heir starts unschooled. All numbers are founder sign-off levers. Design: `omerta-skills-design.md`.

## The Underworld (named NPCs — who you know)
`GET /underworld` (the cast + your standing/tier with each, today's lead, and — Madame tier 3 — the whispers) · `POST /underworld/:npc/gift` ($5k opens doors — but only below standing 50; the top tiers are EARNED) · `POST /underworld/discharge` (Doc tier 2+: pay $150/remaining-minute to halve a hospital stay; tier 3 walks out in full) · `POST /underworld/gun/:gunId/sell` (Bella tier 3: she buys iron back at 30% of sticker). Five fixtures, one per loop, standing 0–100 earned by doing business (heals, guns, crafts, ammo, contracts, NPC hires, kills, convoys, listings, den play): **Doc Moretti** (healing ×0.9 → early discharge → walk-outs), **Vinnie the Match** (NPC hitmen ×0.9 → your contract-post fee waived, street tax stands → searches place ×0.9), **Bella Bang-Bang** (guns ×0.9 cash → crafts ×0.9 → the 30% buyback), **Big Tuna** (convoy guard fees ×0.9 → 72h market listings → a fourth listing slot), **The Madame** (dice cost no nerve → the high-stakes room at any level → she counts the hunters asking about you, never names). Steps two–four make relationships LIVE: a daily **lead** (a rotating TASK drawn per day — do the drawn job with your best fixture for +5, streaking +1/consecutive day up to +10), idle standings **cool** (1/day past a week, never below tier 1), **rivalries** (the Doc feuds with wet work −2 per kill/hire; an ambush pays Bella +2 and costs Big Tuna −2), **grudges with teeth** (whack a real friend of the house — standing 60+ — and that fixture docks you 5 AND caps your tier at 2 until you square it: `POST /underworld/:npc/penance`, $25k a grudge; the payer wears it on arranged hits), a **weekly favor** (one per street from any un-grudged tier-3 fixture — the Doc patches you up, the Madame refills nerve, Big Tuna refills energy, Bella repairs your worst iron; Vinnie deals in debts, not gifts), and the heir **inherits 25%** of each standing — the Doc remembers your father. Step five: grudges **heal with time** (one per two idle weeks — penance always charges the effective count), fixtures hand out **errand chains** (`POST /underworld/:npc/errand` — their drawn task on three separate days pays +15 and the streets hear), and **fixing the fight costs the Madame's respect** (−5; nobody fixes her book). Ammo prices and every audit-locked surface untouched; the only money in steps two–five is the penance sink. All numbers are founder sign-off levers. Design: `omerta-underworld-design.md`.

## The Black Market (P2P trade — car auctions + goods at the dock)
`GET /market` (public board: every live listing — cars with model/damage/standing bid, goods with their pickup dock; bidders stay anonymous) · `POST /market` (list: a car to AUCTION `{carId, minBid, buyNow?, hours}` or trunk goods FIXED-PRICE `{goodId, qty, price}` — goods pin to YOUR current district; 1% listing fee, min $10; 3 live listings max; ≤48h) · `POST /market/:id/bid` `{amount}` (cars: one standing bid, each raise beats it by 5%+; the outbid player is refunded on the spot; your cash escrows while you hold it) · `POST /market/:id/buy` (cars at buy-now — instant settle, any standing bidder refunded; goods `{qty}` — **you must stand at the listing's dock with trunk space**, partial buys fine, so the market creates demand without teleporting freight past the convoy game) · `POST /market/:id/cancel` (seller, never over a standing bid; expired goods reclaim into free trunk space only). Settlement: seller nets the hammer **minus the 2% take** (half street tax → the buyback, half burns — carved FROM the price, never minted on top). Expired auctions hammer to the standing bidder in the worker sweep. A listed car is escrowed — melt/fence/repair refuse it (chop still values it: a hit crew knows your assets). Death: a dead seller's listings void with bids refunded; a dead bidder's standing bid burns. **Step two:** `POST /market` accepts a hidden `reserve` (under it the hammer never falls — the board shows only whether it's met); a bid in the last 5 minutes **soft-closes** (the clock resets — no sniping); and **standing buy orders**: `POST /market/order` `{goodId, qty, price}` escrows the cash at YOUR dock, `POST /market/:id/fill` `{qty}` lets any seller standing there deliver from the trunk and get paid on the spot (minus the take), `POST /market/:id/claim` pulls delivered goods from the warehouse into your trunk — cancel/expiry refund only the un-filled escrow, and delivered goods stay claimable (they're paid for). §10.4: the `market escrow` check reconciles standing bids + order balances exactly; gear is deliberately NOT tradeable here (its market is the on-chain rail). Step-one levers SIGNED; step-two numbers are founder sign-off levers. Design: `omerta-market-design.md`.

## The Commission (server-wide player politics — status + rules, zero money)
`GET /commission` (public: the five seats — the top families by standing (lifetime tribute + 10,000 per war won), recomputed live, each with its VOTE WEIGHT (head of the table 5 … last seat 1) — this week's PUBLIC votes with weights, the active decree with `lapsesSeconds`, any veto on the record, and the decree book) · `POST /commission/vote` `{decree}` (boss/underboss of a seated family; one vote per family per week, changeable all week, always public; the ballot carries the family's CURRENT seat weight, refreshed on re-cast) · `POST /commission/veto` (the head seat's BOSS — and nobody else — kills the decree in force, once per week, on the public record; its touchpoints go inert immediately). The WEIGHTED majority of last week's votes governs THIS week — tallied lazily on read, no cron; a tie (by weight) or a silent chamber deadlocks (no decree). Four decrees, one touchpoint each: **Open Season** (safehouse stays halved), **The Pax** (no NEW wars — running wars finish), **Amnesty** (laying low costs half; the discount is what's ledgered), **Lockdown** (+20 defense on every convoy, visible in the rng audit). No decree moves a dollar — the Commission is politics, not a faucet. Modifier numbers are founder sign-off levers. Design: `omerta-commission-design.md`.

## Crew heists — THE BIG SCORE (co-op)
`GET /heists` (the catalog + open jobs with open SEATS + your active job) · `POST /heists/plan` `{job, role, businessId}` (payroll 2-crew lvl 8 / **inside 2 lvl 12 (names a player's business as the mark)** / vault 3 lvl 20 / fedtrain 4 lvl 40 — the leader fronts the stake, sunk once you go) · `POST /heists/:id/join` `{role}` (every slot is a named seat — brains/muscle/wheelman/gun — each claimed once; the success roll reads YOUR stat for YOUR seat, so specialists carry their weight; leader leaving disbands + refunds; one active job per player, shares the solo Score cooldown) · `POST /heists/:id/execute` (leader-only, crew full + everyone clean/healthy/rested; ONE rng-audited roll for everybody — success splits the pot evenly with a 1.2× leader weight; standard jobs scale the pot with AVERAGE crew level, the **inside job takes 60% of the mark's PENDING business income** — the owner keeps the rest, the venue locks down for a day win or lose, family fronts are omertà; failure jails the whole crew together) · `POST /heists/:id/rat` (silent: the job auto-blows, the informer walks with half the stake, the rest eat double time, and the street only hears **"somebody talked"**). Every dollar ledgered per member (`heist:crew*` / `heist:inside`). New faucet (the inside job redirects the bounded business-income faucet — not new emission) — numbers are sign-off levers (BALANCE.md addendum). Design: `omerta-crew-heists-design.md`.

## Vendettas & blood feuds
A player fire-kill swears the victim's BLOODLINE (account) against the killer's for 7 days — the heir is born owing blood (notified; active vendettas in the character view). Settling it (a revenge fire-kill inside the window) pays **2× feared-rep** (the bloodline-diminishing rule still applies, so a first revenge nets exactly full rep and kill-trading decays — farming is arithmetically dead), hits the streets feed, and closes the debt. A vendetta also **waives the $10k directed-contract floor** against your target — vengeance posts at street rates. `GET /feud/:characterId` is the public ledger: kills each way, net `bloodOwed`, active vendettas both directions. NPC/mod kills never create vendettas. Zero money flows — outside the signed economy. Design: `omerta-vendetta-design.md`.

## The Gambling Den (Neon Mile — cash only, never $OMR)
`POST /casino/dice` `{amount}` (street craps — the full pass line in one call, pays 1:1, house edge ~1.41%; $100–$250k table, 1 nerve; **level 30+ opens the high-stakes room to $2M**, big pots hit the streets feed) · `POST /casino/numbers` `{pick, amount}` (the daily Numbers: 0–999, $10–$1k, ONE ticket/street/day, pays 600:1 on the seed-drawn daily number) · `POST /casino/numbers/claim` · **back-room PvP dice**: `POST /casino/fade` `{limit}` (list yourself; 0 clears) then `POST /casino/dice/:targetId` `{amount}` (symmetric hi-roll, winner takes the pot − 5% rake, half the rake to the street) · **the weekly fight**: `POST /casino/fight` `{side, amount}` (one bet/street/week, $5k cap — the fix's abuse bound; favorite pays 1.45, the dog 2.6) · `POST /casino/fight/claim` · `POST /casino/fight/fix` `{winner}` (the family holding neon buys the result once a week, $50k from the treasury) · **rakeback**: casino-front owners split 1% of den volume at business collect · `GET /casino` (limits, tickets, the bout card, the fader board). Every roll server-side + rng-audited; every stake/payout ledgered `casino:*`. **$OMR is never accepted or paid** — the hard line. Numbers are founder sign-off levers. Design: `omerta-gambling-den-design.md`.

## Sim-audit balance drop 2 (directed squatting, territory taper, kitchen on-ramp)
**Directed contracts**: naming a hitman now takes a $10k minimum stake and the exclusive window caps at 24h — and a completed KILL pays *whoever* did the job even inside the window (the named hitman keeps the 1.5× rep bonus; hospitalize pots stay exclusive). Squatting a cheap friendly pot on your own head now funds your enemies instead of blocking them. · **Kitchen on-ramp**: rank-0 dealers earn a +50% *corner premium* on gross (phases out automatically at trade-rank 1 — the sim-audited mid/endgame curve is untouched). All numbers founder sign-off levers.

## Make Risk Pay (sim-audit package — loot surfaces, scaled safehouse, market PLEX, AMM depth)
Bank deposits ride **in transit** for 2h (lootable on a fire-kill; view: `bankInTransit`/`bankClearSeconds`) · unstaking **unbonds** for 6h (no yield, lootable; view: `unbonding`/`unbondSeconds`; staking in stays instant; principal always releases whole) · **safehouse costs 1% of cash+bank** (min $25k) per 4h — the view quotes `safehouseCost` · **PLEX is market-linked**: `GET /plex/price` quotes fee-ETH × the latest vig buyback price × 1.2 premium (static floor pre-market) — ETH stays the economical rail, $OMR burns at a markup · *(the 12h tick no longer buys $OMR or carves AMM liquidity — since tokenomics v2 the whole street take funds the Exchange window's till).* All numbers founder sign-off levers.

## Risk-to-Earn Phase 1 (off-chain rebalance — no new routes, changed behavior)
Loot on a player fire-kill (killer takes 25% of victim pocket cash + 20% of liquid $OMR; `whack:loot` transfers; response adds `loot`/`omrLoot`) · a safe-housed player can't `fire`/`jump`/`deal` (shield, not bunker) · bodyguard floor $1k→$10k, guard hospital 2h→4h · bank interest capped by a daily bucket (no ~4%/day risk-free). *(Phase 1's laundering gate on `POST /swap` is history — tokenomics v2 later retired cash→$OMR entirely.)* Numbers are founder sign-off levers. Design: `omerta-phase1-riskpay-design.md`, superseded in part by `omerta-tokenomics-v2-design.md`.

## M8 endpoints (family seals — the gang prestige ladder)
`POST /gangs/tribute/omr` (any member pools $OMR into the family reserve) · `POST /gangs/vanity/seal` (boss only — buys the NEXT seal from the reserve: Wax 25 → Brass 75 → Silver 200 → Gold 500 → Obsidian 1500; displayed on the family everywhere, pure status)

## M4 endpoints
`POST /kitchen/makings/:drugId` · `POST /kitchen/lab/upgrade` · `POST /kitchen/cook|collect|deal` · `POST /kitchen/crew/hire` · `POST /kitchen/crew/wages` (recurring sinks — pay the crew's nut: each corner man draws $1,200/hr whether the stash moves or not; unpaid past 3 days the crew goes **cold** and stops their offline sales until covered — `crewWagePerHr`/`crewWageOwed`/`crewCold` in the view) · `POST /kitchen/laylow|cleanpapers` · `POST /path` · `POST /heist` · `POST /missions/:id` · `GET /daily`, `POST /daily/:id/claim` · `POST /onboard/:taskId/claim` · `POST /wallet` · mod (X-Mod-Key): `POST /mod/ban|kill|confiscate`, `GET /mod/audit`

## M5 endpoints & ops
`POST /auth/x`, `POST /auth/privy` (invite-gated for new accounts when INVITE_MODE=on) · `POST /auth/upgrade` (guest → provider, possessions preserved) · `POST /auth/agent-key` (permanent 🤖 flag + throttled token) · mod: `POST /mod/invites`, `GET /mod/invariants` · every mutating route honors `Idempotency-Key` and rate limits (429 + Retry-After) · `npm run worker` (buyback + season + nightly invariants) · `npm run invariants` · `tools/backup.sh`

## Milestones (spec §13)
- [x] **M1** — skeleton: auth, /me, accrual, crimes/gym/bank/travel/check-in
- [x] **M2** — economy: garage, workshop, goods, rackets/assets, swap + 12h buyback worker, deterministic markets, staking, gear, ledger invariants
- [x] **M3** — social: gangs, wars, turf, jumps, bounties, hits + death (the Estate), busting, exchange, notifications, websocket
- [x] **M4** — Kitchen (§7.10 + crew/raids in accrual), paths, trade ranks, heist/missions/dailies, First Week, referrals (§7.13), telemetry, mod tools
- [x] **M5** — alpha hardening: §10.2 rate limits + agent keys, §10.4 invariant job with alerting, idempotency keys, invite codes, season rollover (§8), X/Privy OAuth + guest upgrade, backups → invite-code alpha
- [~] **M6-A** — on-chain contracts for **Robinhood Chain** (EVM, migrated from Solana): `omerta-contracts/` (OMR, VoucherClaim, GearVault, OMRStaking) — Foundry suite, 15 tests. See `omerta-chain-migration-evm.md`.
- [~] **M6-B** — backend chain service (`src/chain.js`): viem EIP-712 signer in `VOUCHER_TYPEHASH` parity, `vouchers`/`chain_reserve`/`wallet_challenges` tables, full-reserve withdrawal queue, `Claimed` watcher, SIWE wallet verify. Deferred: buyback bot, devnet deploy → audit → mainnet
- [~] **M6-C** — §11 real-ETH fees (`src/fees.js` + `OmertaFees.sol`): 0.01 ETH two-tier mint (free trial → withdrawal-eligible), 0.10 ETH pre-paid revive insurance (absorbs a killing blow), both forwarded straight to the dev wallet. `POST /character/mint`, `GET /fees/status`, fee-event watcher. Deferred: devnet deploy + `forge test` run
