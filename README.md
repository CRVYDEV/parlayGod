# OMERTÀ Backend — M1

Server-authoritative backend for OMERTÀ, built to `omerta-backend-spec.md` (in this repo). M1 delivers the playable solo loop: auth, character creation, lazy accrual, crimes, gym, Doc, bank, travel, daily check-in — with the transaction ledger and RNG audit live from day one.

## Run it (zero setup)
```
npm install
npm test        # full smoke test on an in-memory database
npm start       # API on :8787 using pg-mem (no Postgres needed)
```
Set `DATABASE_URL=postgres://...` to use real Postgres (schema auto-applies). Set `JWT_SECRET` in production.

## Try it
```
TOKEN=$(curl -s -X POST localhost:8787/v1/auth/guest | jq -r .token)
curl -s -X POST localhost:8787/v1/character -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Lucky"}'
curl -s -X POST localhost:8787/v1/crimes/pick -H "Authorization: Bearer $TOKEN"
curl -s localhost:8787/v1/me -H "Authorization: Bearer $TOKEN"
```

## Layout
- `src/rules.js` — ALL game data (350+ entries), auto-generated from `omerta-game-v24.jsx`. Never hand-edit the tables; the tail (from `CONSTANTS` down — helpers like `hash01`, `carMelt`, `goodPriceOf`) is preserved verbatim by the extractor and is where hand-maintained logic lives. Regenerate tables with `node tools/extract-rules.js path/to/omerta-game-v24.jsx`.
- `src/accrual.js` — spec §7.1 lazy accrual: regen (turf-aware), bank interest, racket/asset income, staking rewards, heat decay (the no-global-tick design)
- `src/game.js` — shared txn machinery: `withCharacter` (locks character + account), `withTwoCharacters` (locks both parties in stable order, §10.1), notifications + the websocket event bus, weekly family contracts
- `src/economy.js` — M2 actions: garage (melt tithes to the family), workshop, goods (turf prices), rackets/assets, swap, staking, gear, armory
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
`GET /market/prices` (deterministic, public) · `POST /goods/buy|sell` · `POST /garage/boost` · `POST /garage/:carId/melt|repair|fence` · `POST /workshop/craft/:id` · `POST /workshop/ammo` · `POST /items/:id/use` · `POST /rackets/:id/buy` · `POST /assets/:id/buy|sell` · `POST /swap` · `POST /stake` · `POST /unstake` · `POST /claim-rewards` · `POST /gear/:id/mint`

## M3 endpoints
`POST /gangs` · `POST /gangs/:id/join` · `POST /gangs/leave|kick|promote|tribute` · `POST /gangs/war/:targetGangId` · `POST /districts/:id/seize` · `GET /gangs`, `GET /gangs/:id`, `GET /districts` · `GET /streets` · `POST /streets/:id/jump|bounty|search|fire|bust` · `DELETE /streets/search` · `GET|POST /exchange…` · `GET /notifications` · `POST /armory/gun/:id/buy|equip`, `/armory/vest/:id`, `/armory/ammo` · `GET /v1/ws?token=` (websocket)

## M7 endpoints (Contracts & Hitmen)
`POST /streets/:id/bounty` (kind hospitalize|kill, reason, hours, anon, hitman, exclusiveHours) · `GET /contracts` (the board) · `POST /contracts/:targetId/:kind/cancel` · `GET /leaderboard/hitmen` (legend + season) · `POST /streets/:id/npchit` (hire an NPC contractor — tier legbreaker|journeyman|professional; fee burns, rolled attempt) · `POST /safehouse` (go to ground — $25k, 4h untargetable by fire+npchit; Phase 4) · `POST /gangs/contract/:targetId` (boss/underboss posts a TREASURY-funded family contract; no member collects) · `POST /gangs/contract/:targetId/:kind/cancel` (refund → treasury) · `POST /bodyguard/offer` (list yourself, price ≥ $1k; 0 clears) · `POST /bodyguard/hire/:guardId` (24h window — the guard absorbs ONE lethal hit, hospitalized in your place, before any respawn token)

## M8 endpoints (Tailor & Engraver — vanity $OMR sinks, display-only)
`POST /vanity/name` (new street name, 5 $OMR — living-name uniqueness; rotates your referral code) · `POST /vanity/title` (custom title, 10 $OMR; empty clears free) · `POST /vanity/plate/:carId` (2 $OMR, 2–8 chars, engraved uppercase) · `POST /gangs/vanity/color` (boss only, #rrggbb, 10 $OMR) · `POST /gangs/vanity/name` (boss only, rename/retag, 25 $OMR)

## M8 endpoints (loop sinks — anonymity, counter-intel, respec)
`anon: true` on `POST /streets/:id/bounty` or `/gangs/contract/:targetId` (3 $OMR on a FRESH pot; top-ups inherit free) · `POST /contracts/peek` (5 $OMR — the mark reads every funder on their own head, pierces anon; free when nothing's posted) · `POST /respec` `{muscle,cunning,speed}` (15 $OMR — total conserved, each stat ≥ 5)

## Risk-to-Earn Phase 1 (off-chain rebalance — no new routes, changed behavior)
Loot on a player fire-kill (killer takes 25% of victim pocket cash + 20% of liquid $OMR; `whack:loot` transfers; response adds `loot`/`omrLoot`) · `POST /swap` `direction:buy` (laundering) now requires a wash-house district (docks/canal) or your family's turf, draws +15 heat, and is blocked from a safehouse (sell is ungated) · a safe-housed player can't `fire`/`jump`/`deal`/launder (shield, not bunker) · bodyguard floor $1k→$10k, guard hospital 2h→4h · bank interest capped by a daily bucket (no ~4%/day risk-free). Numbers are founder sign-off levers. Design: `omerta-phase1-riskpay-design.md`.

## M8 endpoints (family seals — the gang prestige ladder)
`POST /gangs/tribute/omr` (any member pools $OMR into the family reserve) · `POST /gangs/vanity/seal` (boss only — buys the NEXT seal from the reserve: Wax 25 → Brass 75 → Silver 200 → Gold 500 → Obsidian 1500; displayed on the family everywhere, pure status)

## M4 endpoints
`POST /kitchen/makings/:drugId` · `POST /kitchen/lab/upgrade` · `POST /kitchen/cook|collect|deal` · `POST /kitchen/crew/hire` · `POST /kitchen/laylow|cleanpapers` · `POST /path` · `POST /heist` · `POST /missions/:id` · `GET /daily`, `POST /daily/:id/claim` · `POST /onboard/:taskId/claim` · `POST /wallet` · mod (X-Mod-Key): `POST /mod/ban|kill|confiscate`, `GET /mod/audit`

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
