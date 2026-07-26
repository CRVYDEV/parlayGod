# OMERTÀ — off-chain alpha go-live checklist

The fresh-deploy runbook for the off-chain game (chain layer stays dormant unless the `CHAIN_*` vars below
are set). Two Node processes over one Postgres DB. No build step.

## 0. Pre-flight (on the release commit)
- [ ] `npm ci` (or `npm install`) — one runtime dep tree; no native build required for the game (the
      `@resvg/resvg-js` used by social-share PNGs is an **optionalDependency** — absent → cards fall back to SVG).
- [ ] `npm test` → **48/48 suites green**.
- [ ] `node tools/sim.js` → ends with `✅ sim complete — §10.4 holds exactly` (drift-0).
- [ ] **`npm run preflight`** — on the box, with the real environment loaded. Runs exactly the checks
      the server runs at startup, so a green result means it will boot; non-zero exit means it won't,
      with the reasons listed. Run it BEFORE cutting traffic over rather than reading a stack trace at
      3am. (`src/preflight.js` is the single source of truth for every env var this server reads;
      `test/preflight.js` fails the suite if any new one is left unclassified, which is how the
      pacing-pass knobs came to be unguarded in the first place.)
- [ ] **`npm run pgcheck`** against a throwaway Postgres — the suite runs on pg-mem, which is by
      construction blind to node-pg's own contract, and a real deploy runs node-pg. This drives the
      core loop on real Postgres and FAILS on any pg deprecation. It has already caught one: 16
      overlapping queries on a single pooled client in `loadOwned`, deprecated today and removed in
      pg@9 — i.e. an upgrade would have 500'd every action in the game.
      ```
      createdb omerta_check
      DATABASE_URL=postgres://localhost/omerta_check JWT_SECRET=x MOD_KEY=y \
        MARKET_SEED='<32 random chars>' SOCIAL_VERIFY_MODE=off npm run pgcheck
      ```
- [ ] (chain path only — not needed for off-chain alpha) `cd omerta-contracts && forge test` on a real
      Foundry toolchain. **Still the pre-mainnet gate; egress-blocked in CI here.**

## 1. Required environment (production boot REFUSES without these)
| Var | Why | Boot guard |
|---|---|---|
| `NODE_ENV=production` | enables rate limits + the boot guards below | — |
| `DATABASE_URL` | real Postgres; refuses pg-mem in prod (RAM-only = data loss on restart) | db.js |
| `JWT_SECRET` | signs player tokens; refuses the dev fallback | server.js |
| `MARKET_SEED` | secret ≥24 chars / ≥8 distinct; the §7.11 draw seed (Numbers/Track/Fight/goods). A weak seed is offline-recoverable from the public prices board → predictable money draws | preflight.js |
| `MOD_KEY` | the only credential on the mod perimeter (ban / mod-kill / confiscate / comp grants) and on `/admin`. Fails closed — unset means every mod route 401s | preflight.js |

**Also refused:** any of the **44 test-only** roll/timer knobs (`SEARCH_MS`, `LAW_BUST_P`, `TRAIN_CD_MS`,
`MISSION_CD_MS`, `PEN_BREAK_P`, `ALLOW_MOD_REAL_REVENUE`, …). Each one pins a money roll to always-win or
collapses a pacing timer server-wide; `TRAIN_CD_MS`/`MISSION_CD_MS` in particular would reinstate the
"level 240 in two hours" speedrun the pacing pass fixed. The full list is `TEST_ONLY_ENV` in
`src/preflight.js` — and `test/preflight.js` fails if a knob is ever added without being classified.

## 1b. Must be STATED (production refuses to boot without an explicit value)
- [ ] `SOCIAL_VERIFY_MODE` = `live` | `trust` | `off`. It defaults to `off`, which pays the
      Spread-the-Word faucet **nothing** while still accepting posts — that default silently ran on a
      live server once. `live` is what an alpha wants (real X verification, needs the X keys in §3);
      `off` is a legitimate choice, but it now has to be a *choice*.

## 2. Recommended production config
- [ ] `MOD_KEY=<secret>` — gates the mod tools + the `/admin` ops dashboard (timing-safe compared). Without
      it the mod surface is disabled.
- [ ] `RATE_LIMIT=on` — token buckets (auto-on in prod anyway; set explicitly to be sure).
- [ ] `TRUST_PROXY=on` — **only if** behind a load balancer / reverse proxy, so per-IP throttles key on the
      real client IP (`X-Forwarded-For`), not the proxy. Leave OFF if the app is internet-facing directly.
- [ ] `PG_POOL_MAX=20` (default) — raise with instance count / concurrency.
- [ ] `INVARIANT_WEBHOOK_URL=<url>` — §10.4 drift, Vig/Bond, and backup-watchdog alerts (recommended).
      **Must be set on the WORKER process** — every automatic alarm lives there (`src/worker.js`); the api
      only alerts on a manual `GET /v1/mod/invariants` or an `/admin` load. On Render, put it on the shared
      env group so both get it. A Slack or Discord webhook URL works as-is: the payload carries `text` and
      `content` alongside the structured fields, because those services 400 a body with neither and
      `alertDrift` swallows the error — a webhook that looked configured would have delivered nothing.

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

## 7b. When the database goes down — what you should see (and what to do)
The 2026-07-25 incident was hard to read because a database problem and a code bug produced the
identical response (`500 {"error":"internal"}`), so "Internal on every button" could have been either.
That is now separated:

| you see | it means | do |
|---|---|---|
| `503 {"error":"db_down"}` on game routes | the database is unreachable; **nothing was lost**, it recovers by itself | check the DB dashboard; no code change needed |
| `500 {"error":"internal"}` | a real bug | read the server log; it is not an outage |
| `GET /health` → `503 {"ok":false,"db":"unreachable"}` | same, from a keyless probe | as above |

- **The API survives a database restart.** It logs `[db] idle client error …`, keeps serving 503s, and
  reconnects on its own when Postgres returns — no redeploy, no manual restart. (Before this was fixed
  the process *died* on every DB bounce, which is the likeliest real cause of the "Internal on every
  crime" report.) Verified by stopping a real Postgres under a running server.
- **The worker** skips a tick with one line (`worker: database unreachable … skipping this tick`)
  instead of dumping ~60 stack traces, and logs `database back after N skipped tick(s)` on recovery.
  Every sweep is idempotent, so nothing is lost by skipping.
- **Point an uptime monitor at `GET /health`** (keyless, no secret in the URL). It reports
  `{ok, db, dbLatencyMs, uptimeSeconds}` and returns 503 when the DB is unreachable, so a monitor can
  alert on status code alone.
- **Think twice before making `/health` the PLATFORM's own health check.** Restarting the API does not
  fix a database — it just adds a restart loop on top of an outage. Alerting on it is the point;
  auto-restarting on it usually is not.

## 7c. Backups — you are told when they break, and you keep your own
**The game now watches its own backups.** Postgres ships write-ahead-log segments to the backup
service; when that stops, the database keeps serving perfectly while your ability to *restore* it
quietly rots. It is the one failure that is invisible from inside the game — and on 2026-07-25 it
happened twice in one day with the only evidence buried in the host's log stream.

- **`/admin` leads with a Backups panel** and shows a red banner when it is broken. Five states:
  `HEALTHY` (shipping), `FAILING` (the newest event was a failure — act), `QUIET` (nothing shipped
  lately, normal on an idle database), `NOT RUNNING` (**`archive_mode=off`** — there is no recovery
  chain at all), `unsupported` (dev/pg-mem, or a role that can't read the view).
- **The worker checks every tick** and alerts through the same channel as a §10.4 drift (telemetry +
  `INVARIANT_WEBHOOK_URL`), once per episode — a healed-then-broken-again outage alerts again; a
  still-broken one doesn't re-nag hourly. **Set `INVARIANT_WEBHOOK_URL`** or nobody gets paged.
- Note that a *healed* outage leaves its failure counts in `pg_stat_archiver` forever. What matters
  is whether the most recent event was a success — which is what the panel reports.

You can also ask the database directly:
```sql
SELECT last_archived_wal, last_archived_time, failed_count, last_failed_wal, last_failed_time
FROM pg_stat_archiver;
```
If `last_failed_time` is newer than `last_archived_time`, archiving is broken right now.

### Your own dump — `npm run backup` (cron it nightly)
```
0 4 * * * cd /path/to/repo && DATABASE_URL=postgres://… BACKUP_DIR=/backups npm run backup
```
or call the script directly:
```
0 4 * * * DATABASE_URL=postgres://… /path/to/tools/backup.sh /backups
```
It dumps to a temp name, **verifies**, and only then moves the file into place — so a run that dies
halfway leaves no truncated file wearing a plausible name. Verification is: readable by `pg_restore`,
the expected schema, `accounts`/`characters`/`transactions` present, a size floor, **and actual rows**
(a schema-only database dumps to 161 tables and ~194 KB — it clears every other check while holding
nothing, so only reading the data section back proves there is data in there). Retention runs **only
after a good dump**, so a run of bad nights can never age out the last known-good backup.
- exit non-zero = **no backup was kept**; the message says why. Alert on it.
- `BACKUP_MIN_ROWS=0` for a genuinely cold database (nobody has signed up yet).
- A managed platform's own backups are not a substitute — the incident that motivated this was a
  *silent* failure of exactly that (WAL archiving erroring for ~11 minutes while everything looked
  healthy). Keep an independent dump you have personally restored at least once.

**The script has its own regression test** — `npm run backup:selftest`, pointed at a throwaway
Postgres it may create and drop databases on. It builds a populated database, a schema-only one and a
non-OMERTÀ one, and proves each check *refuses what it should*: a verification that cannot fail is
decoration. CI runs it against a real Postgres on every push, and that has already earned itself —
it caught a **race in the verifier that refused GOOD dumps**. The required-table check piped into
`grep -q` under `pipefail`; `grep -q` exits at the first match and SIGPIPEs the writer still emitting
the rest of a ~34 KB table of contents, so a *successful* match returned 141 and the backup was
rejected with "table X is missing" about a table that was plainly there. It never reproduced on a
developer machine and fired on every CI run, blaming a different table each time. Fails closed (a bad
dump is never kept in place of a good one), but a cron that starts refusing good backups with an
untrue reason is its own incident. If you ever see that message, check the table really is absent
before believing it.

## 8. Post-deploy smoke check
- [ ] `GET /health` → `200 {"ok":true,"db":"up"}`.
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
