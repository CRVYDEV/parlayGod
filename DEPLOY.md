# OMERTÀ — off-chain alpha go-live checklist

The fresh-deploy runbook for the off-chain game (chain layer stays dormant unless the `CHAIN_*` vars below
are set). Two Node processes over one Postgres DB. No build step.

## 0. Pre-flight (on the release commit)
- [ ] `npm ci` (or `npm install`) — one runtime dep tree; no native build required for the game (the
      `@resvg/resvg-js` used by social-share PNGs is an **optionalDependency** — absent → cards fall back to SVG).
- [ ] `npm test` → **34/34 suites green**.
- [ ] `node tools/sim.js` → ends with `✅ sim complete — §10.4 holds exactly` (drift-0).
- [ ] (chain path only — not needed for off-chain alpha) `cd omerta-contracts && forge test` on a real
      Foundry toolchain. **Still the pre-mainnet gate; egress-blocked in CI here.**

## 1. Required environment (production boot REFUSES without these)
| Var | Why | Boot guard |
|---|---|---|
| `NODE_ENV=production` | enables rate limits + the boot guards below | — |
| `DATABASE_URL` | real Postgres; refuses pg-mem in prod (RAM-only = data loss on restart) | db.js |
| `JWT_SECRET` | signs player tokens; refuses the dev fallback | server.js |
| `MARKET_SEED` | secret ≥24 chars / ≥8 distinct; the §7.11 draw seed (Numbers/Track/Fight/goods). A weak seed is offline-recoverable from the public prices board → predictable money draws | server.js |

## 2. Recommended production config
- [ ] `SOCIAL_VERIFY_MODE=live` — **required for the alpha**; social-task + First-Week rewards fail-closed
      (pay nothing) in any other mode in production. (`off`/`trust` are dev only.)
- [ ] `MOD_KEY=<secret>` — gates the mod tools + the `/admin` ops dashboard (timing-safe compared). Without
      it the mod surface is disabled.
- [ ] `RATE_LIMIT=on` — token buckets (auto-on in prod anyway; set explicitly to be sure).
- [ ] `TRUST_PROXY=on` — **only if** behind a load balancer / reverse proxy, so per-IP throttles key on the
      real client IP (`X-Forwarded-For`), not the proxy. Leave OFF if the app is internet-facing directly.
- [ ] `PG_POOL_MAX=20` (default) — raise with instance count / concurrency.
- [ ] `INVARIANT_WEBHOOK_URL=<url>` — §10.4 drift + reserve alerts from the nightly worker job (recommended).

## 3. The X integrations — the full checklist (one-click sign-in + social verification)
All from https://developer.x.com (create a Project + App once). Every X surface degrades cleanly
when unconfigured — sign-in buttons hide, social claims fail-closed — so set these when ready:

**One-click X sign-in (OAuth2 PKCE, server-side exchange):**
- [ ] `X_CLIENT_ID` — the app's OAuth 2.0 Client ID.
- [ ] `X_CLIENT_SECRET` — set it if the app is a *confidential* client (recommended); omit for public PKCE.
- [ ] `PUBLIC_URL=https://www.omerta.fun` — and register the callback on the X app as **exactly**
      `https://www.omerta.fun/v1/auth/x/callback` (App settings → User authentication → Callback URI).
      Scopes needed: `users.read tweet.read`. Type of app: Web App. A mismatched callback = every
      sign-in fails at X's door.

**Social verification (First-Week follow + Spread-the-Word post checks, `SOCIAL_VERIFY_MODE=live`):**
- [ ] `X_BEARER_TOKEN` — the app's Bearer Token (app-only auth; reads tweets + follow lists).
- [ ] `X_TARGET_USER_ID` — the game's X account **numeric id** (not the handle — get it from
      `GET /2/users/by/username/<handle>` or an online lookup) for the follow check.
- [ ] `SOCIAL_X_HANDLE` — the handle (no @) used in share/brag intent links.
- Note: the follow check paginates to 5000 follows; X rate limits are per-app and tight — transient
  429s surface to players as a clean retryable "X is busy" (`verify_busy`), never as a failed task,
  and every X call is time-boxed at 8–10s so an X outage can never hang the game.

**Leave unset:** `X_TRUST_USER_TOKEN` — the legacy paste-token sign-in (default off; the PKCE flow
above is the real path and the only one the console offers).

## 3b. Other optional
- `INVITE_MODE=on` — closed-alpha gate; mint codes via `POST /v1/mod/invites`.
- `PRIVY_APP_ID` — enables Privy sign-in (else guest + X only).
- `SOCIAL_GAME_URL` — falls back for `PUBLIC_URL` in share links, OG cards, the OpenAPI `baseUrl`.
- `REDIS_URL` — moves the rate-limit buckets off in-memory (needed only for multi-instance).

## 4. Chain — LEAVE UNSET for the off-chain alpha
The chain service is dormant unless configured. Setting `CHAIN_RPC_URL` + `CHAIN_ID` +
`VOUCHER_CLAIM_ADDRESS` (+ `VOUCHER_SIGNER_PK`, `OMERTA_FEES_ADDRESS`, …) activates the watcher/withdraw
rail — **do not** until the chain go-live path (devnet → audit → mainnet, gated on legal + the third-party
contract+signer audit). `ALLOW_MOD_REAL_REVENUE` is a QA-only flag — **never** set in production.

## 5. NEVER set in production (the boot guard rejects them)
All test-only roll/timer overrides — `SEARCH_MS`, `SHOOT_CD_MS`, `RACE_CD_MS`, `*_MS` window knobs, and the
roll switches `LAW_BUST_P`, `SHANK_P`, `PEN_BREAK_P`, `WORLD_RAID_P`, `BUSINESS_RAID_P`, `PORT_INTERDICT_P`,
`PORT_SINK`, `PORT_PIRATE_WIN`, `SPEAKEASY_RAID_P`, `SPEAKEASY_STANDOVER_P`, `TERRITORY_*_P`, `WANTED_HUNT_P`,
`WORLD_UPRISING*`, `PEN_YARD_EVENT`, … They turn money rolls into always-win switches; **server.js refuses to
boot in production if any is set** — no action needed beyond not setting them.

## 6. Processes (both against the same `DATABASE_URL`)
- **API** — `npm start` (`node src/server.js`), listens on `PORT` (default 8080), host `0.0.0.0`. Serves the
  console (`/`), `/admin`, `/wiki`, `/agents`, `/openapi.json`, and the `/v1` API + `/v1/ws`.
- **Worker** — `npm run worker` (`node src/worker.js`), ONE instance: the 12h buyback, nightly §10.4 monitor,
  season rollover, and every lazy sweep (auctions/tournaments/loans/law/wanted/world/pen/wire/…). The game
  still functions without it, but income/settlements/alerts stall — run it.

## 7. First-boot behaviour (automatic)
On the real-Postgres branch, boot applies `schema.sql` (`CREATE TABLE IF NOT EXISTS`) then runs the
**idempotent column migration** (`ADD COLUMN IF NOT EXISTS`, derived from schema.sql) — so a **fresh** DB is
created whole and an **in-place upgrade** of an existing DB back-fills any later-added columns (logged as
`[db] Postgres ready — column migration ran N …`). No manual migration step. (MED-1/R30 — the in-place
break is closed; a proper FK/migration-tool pass remains an optional defense-in-depth follow-up.)

## 8. Post-deploy smoke check
- [ ] `GET /v1/session` → 200 (server up).
- [ ] Boot log shows `[db] Postgres ready` (NOT `[db] pg-mem …` — that means `DATABASE_URL` was missing).
- [ ] `POST /v1/auth/guest` → token; `POST /v1/character {name}` → 200; `POST /v1/crimes/pick` → a result.
- [ ] `GET /admin` (with the `x-mod-key`) → the ops dashboard; the §10.4 banner reads **OK** (drift-0).
- [ ] `npm run invariants` (or `GET /v1/mod/invariants`) → every check `ok:true`.
- [ ] Confirm the worker logged a tick (and, after 12h, a buyback).

## 9. Still gated (NOT part of the off-chain alpha)
Mainnet / on-chain extraction — `forge test` on a real toolchain, the third-party audit of the contracts
**and** the off-chain signer, and legal counsel on the Risk-to-Earn / RWA line. See CLAUDE.md + `SIGN-OFF.md`.
Founder balance sign-offs (`BALANCE.md` / `SIGN-OFF.md`) are numbers, not blockers, for the alpha.

## 3c. Seasonal League Modifiers (slate #6) — DORMANT by default
`SEASON_MODS=on` arms the once-per-season seed-drawn rule twist (the pool in `rules.js
SEASON_MODS` — it deliberately modifies SIGNED levers: laylow, law-gain, kill loot, safehouse,
goods sell). Leave UNSET until the founder signs the pool in BALANCE.md; unset = every season is
"Dead Quiet" (the signed baseline). `SEASON_MOD=<id>` is a test-only pin — never in production.
