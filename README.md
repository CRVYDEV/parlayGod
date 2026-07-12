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
- `src/rules.js` — ALL game data (350+ entries), auto-generated from `omerta-game-v24.jsx`. Never hand-edit; regenerate with `node tools/extract-rules.js path/to/omerta-game-v24.jsx`.
- `src/accrual.js` — spec §7.1 lazy accrual (the no-global-tick design)
- `src/game.js` — action resolution with ledger + RNG audit on every roll
- `src/server.js` — Fastify routes, JWT auth, uniform error shape
- `schema.sql` — M1 tables (spec §3 subset)
- `test/smoke.js` — end-to-end journey + the §10.4 ledger invariant

## Milestones (spec §13)
- [x] **M1** — skeleton: auth, /me, accrual, crimes/gym/bank/travel/check-in
- [ ] **M2** — economy: garage, workshop, exchange, goods, rackets/assets, swap + buyback worker
- [ ] **M3** — social: gangs, wars, turf, jumps, bounties, hits + death, busting, websocket
- [ ] **M4** — Kitchen, paths, trade ranks, First Week (real OAuth), referrals, mod tools
- [ ] **M5** — alpha hardening → invite-code alpha
- [ ] **M6** — Solana service (devnet → audit → mainnet)
