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
- `src/accrual.js` — spec §7.1 lazy accrual: regen, bank interest, racket/asset income, staking rewards, heat decay (the no-global-tick design)
- `src/game.js` — shared txn machinery (`withCharacter` row-locks character + account, accrues both, ledgers) + M1 actions
- `src/economy.js` — M2 actions: garage, workshop, goods, rackets/assets, swap, staking, gear
- `src/worker.js` — the 12h buyback (spec §7.12); `npm run worker` runs it standalone
- `src/server.js` — Fastify routes, JWT auth, uniform error shape
- `schema.sql` — M1+M2 tables (spec §3 subset)
- `test/smoke.js` — M1 end-to-end journey + the §10.4 ledger invariant
- `test/economy.js` — M2 economy journey + §10.4 cash-ledger and car-conservation invariants

## M2 endpoints
`GET /market/prices` (deterministic, public) · `POST /goods/buy|sell` · `POST /garage/boost` · `POST /garage/:carId/melt|repair|fence` · `POST /workshop/craft/:id` · `POST /workshop/ammo` · `POST /items/:id/use` · `POST /rackets/:id/buy` · `POST /assets/:id/buy|sell` · `POST /swap` · `POST /stake` · `POST /unstake` · `POST /claim-rewards` · `POST /gear/:id/mint`

## Milestones (spec §13)
- [x] **M1** — skeleton: auth, /me, accrual, crimes/gym/bank/travel/check-in
- [x] **M2** — economy: garage, workshop, goods, rackets/assets, swap + 12h buyback worker, deterministic markets, staking, gear, ledger invariants
- [ ] **M3** — social: gangs, wars, turf, jumps, bounties, hits + death, busting, websocket
- [ ] **M4** — Kitchen, paths, trade ranks, First Week (real OAuth), referrals, mod tools
- [ ] **M5** — alpha hardening → invite-code alpha
- [ ] **M6** — Solana service (devnet → audit → mainnet)
