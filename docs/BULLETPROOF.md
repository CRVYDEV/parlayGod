# BULLETPROOF — the production-engineering ledger

**Date: 2026-08-21.** The founder handed over a ~110-item production-engineering checklist
("make sure our app is absolutely bulletproof on all of the applicable below") — rate limiting to
postmortems. This document is the answer, and it is a LEDGER, not a brochure: every item was
classified against the real tree with a file:line citation, every claimed gap was **verified
first-hand before anything was built** (ground rule #10: never assume — measure and unit test
everything), the real gaps were fixed with mutation-verified tests in the same change as this
document, and what was deliberately NOT fixed is recorded with its reason, because a deferred
item with no reason is a forgotten item.

**Scoreboard (112 items, as classified before this session's fixes):**

| Status | Count | Meaning |
|---|---|---|
| BULLETPROOF | 47 | Built, tested, and in most cases adversarially audited |
| PARTIAL | 39 | The core exists; a named gap remained |
| GAP | 2 | Nothing existed (WAF, SLOs) |
| NA | 24 | Does not apply to this architecture — each with the reason |

**After this session:** 11 code fixes + 4 operational runbook sections closed or materially
narrowed **19 of the 41 PARTIAL/GAP items** (marked ▲ in the ledger below). One PARTIAL was
**falsified on verification** and re-classified (Replication — see §5, the rule-10 example).
The rest are deferred with reasons (§4).

---

## 1. Fixes applied in this change

Every fix carries a test that fails BY NAME under mutation (the mutation run on a scratchpad
copy, its anchor asserted before the result was believed).

| # | Fix | Where | Test |
|---|---|---|---|
| 1 | **DNS failures classify as an outage, not a bug** — `EAI_AGAIN`/`EAI_FAIL` + syscall `getaddrinfo` + the aggregate-error shape join the `db_down` classifier, so a DNS blip answers 503 `db_down` instead of 500 `internal`. This closes the exact 2026-07-30 production shape ("Temporary failure in name resolution"). | `src/dbhealth.js` (ERRNOS + syscall + aggregate branch) | `test/hardening.js` — four DNS cases in the down-list |
| 2 | **Outbound fetches carry timeouts** — `AbortSignal.timeout(10_000)` on the ops-alarm webhook, the city wire, and the dispatch email sender. undici's ~300s default would hold a worker sweep behind one hung endpoint. | `src/invariants.js` (alertDrift), `src/citywire.js`, `src/dispatch.js` | behavioral (alertDrift stub captures the signal) + source tripwires for the two provider-gated senders |
| 3 | **WS backpressure: drop, never queue** — `wsSendable(socket)` refuses a send when `bufferedAmount` crosses `WS_MAX_BUFFER` (and when the socket is missing — you can't send to nothing). Safe to drop because every durable event is a `notifications` row the 30s poll backfill re-derives; a slow phone can no longer balloon the process's memory. | `src/server.js:157-159` + the WS send helper | `test/hardening.js` — unit (empty/under/at-bound/missing-field/missing-socket) + wiring tripwire |
| 4 | **Production load signal on `/health`** — `load: {req5m, err4xx5m, err5xx5m, p95Ms, maxMs}` (minute buckets + a 4096-entry latency ring) + `rssMb`, plus a slow-request sampler (>1s → one warn line). The request-side SLIs existed only in the loadtest harness; now they are read off the live process by the same endpoint the uptime monitor already polls. | `src/server.js` (~600-618, onResponse hook) | `test/hardening.js` — delta assertions around a driven 4xx with `HEALTH_TTL_MS=0` both sides |
| 5 | **SemVer is real** — package version 0.1.0 → **1.0.0** (the API surface has been stable and published for months); `/openapi.json` `info.version` is DERIVED from package.json instead of a frozen literal, so the machine contract's version can never silently drift from the release. | `package.json`, `src/agentgateway.js` (appVersion) | `test/hardening.js` — openapi version === package.json, major ≥ 1 |
| 6 | **Schema versioning + rollback guard** — a `schema_meta` stamp (app_version + git sha, UPDATE-then-INSERT because pg-mem lies about `ON CONFLICT DO NOTHING` rowCounts) written at every boot; an OLDER build meeting a NEWER stamp warns "likely a rollback in progress" citing DEPLOY.md §8c and does **not** overwrite the newer stamp. | `schema.sql` (schema_meta), `src/db.js` (stampSchema + newerVersion, both boot paths) | `test/hardening.js` — stamp shape + the '999.0.0' rollback branch visibly exercised |
| 7 | **SSRF re-checked at SEND time** — push endpoints were validated at subscribe only; DNS rebinding means the hostname can resolve private LATER. One `endpointAllowed()` implementation is now asked at BOTH ends, and a send-time skip does NOT prune the subscription (private resolution may be transient — the next sweep re-asks). | `src/push.js:95-107` + `pushToAccount` | `test/push.js` — SEND-TIME SSRF RECHECK block; mutation fails at "exactly one delivery — the internal endpoint is skipped at send time" |
| 8 | **WS reconnect backoff + jitter** — the fixed 4s retry re-dialed every open tab in step after a restart (a synchronized thundering herd at launch scale). Now 2s·1.6ⁿ capped 30s, ±30% jitter, reset on a successful open so a blip still reconnects fast. | `public/index.html` (wsRetryMs) | `test/client.js` — tripwire: no fixed-delay `setTimeout(connectWs, N)`, pow+jitter present, onopen resets |
| 9 | **Selective telemetry retention** — `telemetry` had NO retention (unbounded growth on the chattiest table). A blanket sweep would have been a silent §10.4 drift: `event='death'` telemetry is a LEDGER INPUT (invariants.js car-conservation sums every death's fleet size LIFETIME). So: a keep-list (`death` + 4 funnel analytics) and a 180d window — comfortably past every windowed reader (engagement 30d, capo 14d, dispatch 30d, /v1/online 15m). | `src/worker.js` (sweepTelemetry + TELEMETRY_KEEP_EVENTS, wired into the tick) | `test/hardening.js` — old noise pruned, old death SURVIVES, new noise survives |
| 10 | **Single-instance constraint written into the IaC** — the api service carries a "⚠ RUN EXACTLY ONE INSTANCE" block naming WHY (in-process bus, wsClients, in-memory rate buckets, metrics ring) and what scaling out would actually take (REDIS_URL + cross-process fanout); scale the DATABASE instead (the measured dial: +50%/doubling vs +2%). | `render.yaml` | doc-level (the constraint is prose in the blueprint the operator reads) |
| 11 | **TRUST_PROXY hop count** — `'on'`→1 (plain Render); a NUMBER (e.g. `2`) for a CDN-fronted deploy. With Cloudflare in front at trustProxy:1, every per-IP throttle reads Cloudflare's egress IPs as the clients and collapses onto ~a dozen shared addresses. Required for §8d below to be safe to execute. | `src/server.js:~195` | parse + DEPLOY §8d states the required value |

**Operational runbooks added to DEPLOY.md** (each closes a GAP/PARTIAL that was a missing
*decision*, not missing code):

- **§8b SLOs** — the targets stated (availability, /health p95, worker staleness, backup
  freshness), each SLI readable off `/health`, plus the uptime-monitor provisioning step
  (alert on non-200 AND the keyword `"stale":true`; NOT the platform health check — restarting
  the API doesn't fix a database). Closes the SLOs GAP and the Liveness-Probe gap (a dead
  worker is now an alarm someone provisioned, not a hope).
- **§8c Rolling back a bad deploy** — the exact heading the schema_meta warning cites: roll BOTH
  services to the same commit from the Render dashboard; additive-only schema is what makes
  rollback safe; rollback undoes CODE, never data. Plus the blueprint-drift paragraph (the
  render.yaml 16-day drift incident: the file must match the dashboard, both ways).
- **§8d Cloudflare front** — the one-move that closes CDN + Edge Caching + volumetric DDoS +
  managed WAF at once: cache `/art/*`, `/v1/art/*`, `/v1/avatar/*`; BYPASS everything else
  under `/v1`; WS passes; **TRUST_PROXY=2**; verify via the IPs on `/v1/mod/actions`. Documented
  as a runbook rather than executed because it is a DNS/account action only the founder can take.
- **§8e Disaster recovery** — JWT_SECRET/MARKET_SEED/MOD_KEY into the founder's password manager
  (the Render dashboard is currently the ONLY copy — an account-level disaster loses them and a
  DB dump alone does not recover the game); RPO ≤24h / restore <1h (rehearsed 2026-07-26); the
  real constraint on scheduling the verified dump (a Render cron has no persistent disk — the
  dump needs pg_dump + durable storage, `gpg -c` if third-party); DATABASE_URL = the INTERNAL
  connection string only.

---

## 2. The ledger — all 112 items

Legend: ✅ BULLETPROOF · ◐ PARTIAL · ✗ GAP · — NA. **▲ = upgraded by this session's fixes**
(the fix number from §1, or the DEPLOY section). Evidence is one line; the underlying audit
trail is docs/AUDITS.md (85+ reports) and the cited files.

### Traffic & the edge

| Item | Status | Evidence / disposition |
|---|---|---|
| Rate Limiting | ✅ | Token buckets per class (human 1/s burst 5, agent 1/3s, swaps 6/min; per-IP auth + keyless-GET denylist-default) — src/ratelimit.js, server.js:718-753 |
| Caching | ✅ | TTL caches on every hot keyless surface (/health 2s + single-flight — measured 200 concurrent → 2 queries; /v1/online 15s; skyline/ticker 30s; PNG by content hash) |
| Load Balancing | — | One instance by design; the measured dial is DB CPU. Constraint now WRITTEN into render.yaml (▲10) |
| Reverse Proxies | ✅ | Render edge terminates TLS; app is proxy-aware with trustProxy=1 never trust-all (blue-team H3) |
| API Gateways | — | The Fastify process IS the gateway: auth tiers, throttles, idempotency, auto-derived OpenAPI |
| CDN | ◐▲§8d | No CDN today; the Cloudflare one-move is now a written runbook incl. the TRUST_PROXY=2 requirement (▲11) that makes it safe |
| Edge Caching | ◐▲§8d | The code already preserves edge-cacheability (keyless /v1/city pinned by test); §8d is the activation step |
| Cache Invalidation | ✅ | Every cache short-TTL or content-hash-keyed; nothing caches authed state |
| DDoS Protection | ◐▲§8d | App-layer flood control thorough (adversarially driven); volumetric layer = the §8d move |
| WAF | ✗▲§8d | No WAF anywhere; compensating controls strong (parameterized SQL, shared esc(), charset guards); managed WAF = the §8d move |
| CORS | ✅ | Default-deny by construction — no CORS middleware exists, no cross-origin read is ever granted |
| CSRF | ✅ | No cookie session exists; the only cookie is the one-shot OAuth state (HttpOnly, SameSite=Lax, 900s) which IS the CSRF defense |

### Resilience

| Item | Status | Evidence / disposition |
|---|---|---|
| Timeouts | ◐→✅ ▲2 | DB timeouts were exemplary (statement 15s / lock 8s / idle-in-txn 30s / connect fail-fast); the unbounded webhook/email fetches now carry AbortSignal.timeout(10s) |
| Retries | ✅ | Transient contention (40P01/23505/55P03) maps globally to a retryable `contention`; alarm webhook retries with backoff; watcher cursors replay |
| Exponential Backoff | ◐→✅ ▲8 | Boot/outage guard already backed off (3s·1.6 cap 20s); the WS reconnect herd is now jittered exponential |
| Circuit Breakers | ◐ | The tripping behavior exists where it matters (worker skips the whole tick on one bounded pingDb); formal trip/half-open on outbound endpoints DEFERRED (§4) — the new timeouts bound the blast radius |
| Backpressure | ◐→✅ ▲3 | Pool fails fast to clean 503; WS slow-consumer guard now exists (wsSendable, drop-not-queue) |
| Idempotency | ✅ | Idempotency-Key with reserve-before-execute on all mutating routes; atomic claim-then-act at every exactly-once site; chain ingest idempotent on nonce/ref |
| Health Checks | ✅▲4 | /health: db + latency + uptime + worker liveness + now the load block and rssMb; 2s TTL + single-flight |
| Liveness/Readiness Probes | ◐▲§8b | healthCheckPath gates deploy cutover (readiness); worker liveness on /health; the uptime-monitor provisioning step is now written (a dead worker = every alarm dark) |
| Failover | ✅ | DB: `highAvailability.enabled: true` (standby + automatic failover, deliberately declared); app survives failover via pool error handlers on idle AND checked-out clients (the chaos harness's own find) |
| Network Partitions | ✅▲1 | Conservative db_down classifier → 503 + Retry-After; worker skips; client heals with backoff. DNS shapes now included |
| Chaos Engineering | ✅ | tools/chaos.js: SIGKILL worker mid-sweep (exactly-once on resume), ~80 backends terminated mid-txn, Postgres stop/start under a live server |
| Graceful Degradation | ✅ | (classified under Failover/Partitions) — every board isolated per-request; one broken board 500s only its own card |

### Data

| Item | Status | Evidence / disposition |
|---|---|---|
| Database Indexing | ✅ | 87 CREATE INDEX incl. hot-path composites; hot paths measured on real Postgres |
| Query Optimization | ◐ | Hot paths measured + consolidated (loadOwned 16→1 UNION ALL, +31% measured); pg_stat_statements DEFERRED (§4 — PGC_SUSET, superuser-only on managed Render) |
| N+1 Queries | ◐ | Every discovered instance fixed with a regression; a systematic per-request query counter DEFERRED (§4) |
| Connection Pooling | ✅ | Env-tuned max (40, set after the measured pool cliff: 20→30 req/s NINE 503s vs 60→284 req/s); leak-swept by THE CONNECTION LEDGER (test/gates.js) |
| Read Replicas | — | Single Postgres; measured dial is DB CPU plan, and the §10.4 sweep needs one consistent view |
| Sharding | — | The conservation sweep sums the WHOLE ledger; cross-character transactions need single-DB row locks |
| Partitioning | ◐▲9 | Chatty tables already swept (chat 7d, DMs 30d, duels 60d…); telemetry now bounded with a ledger-aware keep-list (▲9). `transactions`/`rng_audit` deliberately NOT pruned — they ARE the ledger the §10.4 sweep sums lifetime (§4) |
| Replication | ✅ (re-classified) | The workflow claimed "no standby exists"; render.yaml:34 declares `highAvailability.enabled: true` — the claim was FALSE on verification (§5). Durability separately watched via pg_stat_archiver five-state verdict |
| Migrations | ✅ | 100% idempotent schema.sql under a cross-process advisory lock; the derived ADD-COLUMN pass; pgcheck §7b applies the OLDEST schema then boots the current build |
| Schema Versioning | ◐→✅ ▲6 | Implicit-but-deliberate (git + additive-only + old-schema boot test); now EXPLICIT via schema_meta stamp + the rollback guard. Non-additive changes remain out-of-scope by policy (additive-only IS the rollback-safety property, §8c) |
| Optimistic Locking | ✅ | Atomic compare-and-set claim latches at every once-ever site |
| Pessimistic Locking | ✅ | withCharacter/withTwoCharacters FOR UPDATE in sorted order; THE LOCK LEDGER holds 46 pairs to one order |
| Distributed Locks | ✅ | Advisory locks, distinct class per metered job (wage, population, keepers, NPC sweeps, schema boot) |
| Race Conditions | ✅ | Claim-then-act everywhere; the classes proven on real Postgres (pg-mem is single-caller — stated at every site) |
| Deadlocks | ✅ | Prevention (one canonical order, guarded), detection (40P01→contention), and the ledger that found the historic AB-BAs |
| Distributed Transactions | — | One Postgres; the chain boundary deliberately avoids 2PC via staged/confirmed two-phase flows |
| Saga Pattern | ✅ | Stage→confirm with compensations across the whole chain boundary (deliveries, vouchers, reclaims) |
| Eventual Consistency | ✅ | The one EC surface (chain ingest) runs CHAIN_CONFIRMATIONS behind head with persisted cursors + poison classification |
| CAP Theorem | — | CP by construction: a DB outage yields an honest 503, never a fork |

### Async & messaging

| Item | Status | Evidence / disposition |
|---|---|---|
| Message Queues | — /✅ | No external MQ deliberately; queue semantics in Postgres with atomic claims (full-reserve withdrawal FIFO, delivery keeper, push claim) |
| Pub/Sub | ✅ | In-process bus with per-socket subscribe/cleanup; single-instance constraint now in the IaC (▲10) |
| Event-Driven Architecture | ✅ | Deliberate split: game state is lazy-accrual + row-locked txns; the bus is ephemeral presentation only |
| Dead Letter Queues | ✅ | Poison classification + durable-source replay (THE WATCHER POISON LEDGER: catalogue-or-declare per recorder) |
| Cron Jobs | ◐▲§8e | In-process scheduler excellent (re-entrancy guards, per-job isolation, heartbeat). The self-dump schedule's real constraint (no persistent disk on a Render cron) is now DOCUMENTED with the working alternative (§8e) rather than implied |
| Webhooks | ✅▲2 | Outbound only; retry+backoff+2000-char clamp+both Slack/Discord keys; now also time-bounded |
| WebSockets | ✅▲3,8 | Bearer in subprotocol (never the URL); revocation checked at connect AND live-cut; heartbeat; now backpressure-guarded and reconnect-jittered |
| Long Polling / SSE | — | The WS + a measured 30s short poll cover it; no SSE surface exists |

### APIs & versioning

| Item | Status | Evidence / disposition |
|---|---|---|
| API Versioning | ✅ | Everything /v1-prefixed; contract auto-derived from the live route registry; retired routes are tombstones, never 404s |
| Semantic Versioning | ◐→✅ ▲5 | omerta-mcp already semver'd on npm; the app is now 1.0.0 and /openapi.json derives its version from package.json |
| gRPC / HTTP2/3 / TCP-UDP | — | Two processes communicating through Postgres; h2 terminates at the managed edge; no datagram surface in a turn-based server-authoritative game |
| DNS | ◐→✅ ▲1 | ENOTFOUND was classified; EAI_AGAIN/EAI_FAIL/getaddrinfo now classify as db_down instead of 500 |

### Security

| Item | Status | Evidence / disposition |
|---|---|---|
| Secrets Management | ✅▲§8e | generateValue + sync:false in the blueprint; preflight REFUSES BOOT on the dev JWT fallback; the off-platform escrow step is now written (§8e) |
| IAM | ◐ | Three enforced tiers (player JWT + ban + token_version; agent tier; mod perimeter logged+throttled). Per-operator mod keys DEFERRED (§4) — one founder operates today, and mod_actions logs every mutation |
| OAuth | ✅ | Full PKCE S256 with server-side exchange; single-use atomic state; the revoked-token demotion fix (RT#2 H2) |
| JWT Rotation | ◐ | Per-account revocation complete on all four bearer paths; dual-secret SIGNING-KEY rotation DEFERRED (§4) |
| TLS | ✅ | Platform-terminated managed certs; HSTS in production; the app never listens on TLS so nothing in-tree can misconfigure it |
| Encryption at Rest | ◐ | Platform disk encryption; NO passwords stored at all. Field-level PII (email, wallet, IPs) accepted-as-is for now (§4) |
| Encryption in Transit | ◐ | Client↔server TLS + HSTS; app↔DB rides Render's same-region private network (the platform's own posture; internal connection string mandated in §8e) |
| WAF (app-level) | ◐▲§8d | The layered app-level equivalent exists and was adversarially driven; the managed layer is the §8d move |
| SQL Injection | ✅ | Parameterized throughout; RT#8 traced ALL 95 template interpolations — no user string reaches SQL text |
| XSS | ◐ | Server-rendered public surfaces escaped through ONE shared esc() with stored-XSS regressions; the client's write-time cleanText posture was adversarially driven (14/16 fields reached, 0 stored raw). A client output-encoding ledger DEFERRED (§4) |
| SSRF | ◐→✅ ▲7 | Subscribe-time validation existed; the DNS-rebinding window is now closed with the send-time recheck |
| DDoS | ◐▲§8d | (see edge section) |

### Delivery & infrastructure

| Item | Status | Evidence / disposition |
|---|---|---|
| CI/CD | ✅ | ci.yml (112 suites + sim drift-0 + scale + mobile w/ real Chromium; pgcheck on real Postgres 16) + forge.yml (305 contract tests + the three e2e provers on anvil); autoDeployTrigger: checksPass |
| Docker / K8s / Helm / Service Discovery / Terraform | — | Render-native Node runtime; two services + one DB; render.yaml IS the IaC format for this platform |
| Infrastructure as Code | ◐▲§8c | render.yaml covers the full stack; the blueprint-drift check (the 16-day incident) is now a written runbook step |
| Build Caching | ◐ | npm cached in both CI jobs; Chromium (~150MB) + forge lib/ re-fetched per run — DEFERRED (§4, cost-only) |
| Dependency Hell | ✅ | Lockfile committed; `npm ci` in CI and `npm ci --omit=dev` in production |
| Feature Flags | ✅ | Systematic env-gated flags read per-call (INVITE_MODE, SEASON_MODS, SOCIAL_VERIFY_MODE, chain dormancy…); TEST_ONLY knobs refused in production by preflight |
| Blue-Green / Canary | — | Render's health-gated instance replacement is the zero-downtime mechanism at this scale; release risk carried by CI + additive-only schema |
| Rolling Deployments | ✅ | Health-gated cutover + old/new coexistence proven by the additive-only discipline and pgcheck §7b |
| Rollbacks | ◐→✅ ▲6,§8c | Chain kill-switches were documented; the APP rollback runbook now exists (§8c) and the schema_meta guard makes a rollback visible to the code itself |
| Autoscaling | — | Doubling API CPU buys +2%; the binding resource is the DB. Autoscaling the wrong tier is not a control |
| Horizontal Scaling | ◐▲10,11 | Worker replicas SAFE by construction (advisory locks everywhere metered); the api's single-instance constraint is now stated in the IaC, and TRUST_PROXY hops make a fronted deploy correct |
| Vertical Scaling | ✅ | The dial is measured and written into the IaC (API +2%/doubling vs DB +50%) |
| Multi-Region | — | Single region, ~1,000-player launch cohort; no requirement it would serve |
| Cold Starts / Serverless | — /✅ | Paid always-on plan chosen explicitly; health-gated traffic swap; no serverless components |
| Cost Optimization | ✅ | Costs measured into the IaC with upgrade rationale per plan; the 9.5× player-ceiling gain (457→4,350) was bought with client-side reads, not infrastructure |

### Observability & operations

| Item | Status | Evidence / disposition |
|---|---|---|
| Monitoring | ✅▲4 | /health (db, worker, uptime, now load + rssMb); /admin panels; the nightly 31-check §10.4 economic IDS — every check proven able to fire |
| Logging | ◐▲4 | logger:false is deliberate and documented; every 500 logs method+url+stack; the slow-request sampler (>1s) now exists. Full request logging DEFERRED (cost > signal at this scale — the recorded rationale stands) |
| Distributed Tracing | — | One process + one worker + one DB — a trace would have exactly one span |
| Metrics | ◐→✅ ▲4 | Domain metrics were strong (telemetry, funnel, token-health KPIs); runtime performance metrics now exist on /health |
| Alerting | ✅ | alertDrift: telemetry row + console + webhook (both Slack/Discord keys), episode-latched, drill-provable via /v1/mod/alert/test |
| SLOs | ✗→✅ ▲§8b | Now stated, each readable off /health, with the monitor-provisioning step |
| SLIs | ◐→✅ ▲4,§8b | worker/db/backup SLIs existed; request-side SLIs now collected in production |
| Error Budgets | — | A policy instrument for multi-team release trade-offs; one founder + mechanically-gated releases |
| Observability | ◐▲4 | State observability exceptional (the economic IDS); the performance third now has its first real production signal |
| Latency / P99 / Tail | ◐→✅ ▲4 | Was harness-only (loadtest p50/p95/p99 in CI); production p95/max now on /health, tails hard-bounded by the DB timeout trio |
| Throughput | ✅ | Measured, modeled, binding constraint identified (the pool cliff, the DB-CPU dial, the poll-cost harness) |
| Memory Leaks | ◐▲4 | Known unbounded maps audited + FIFO-capped (blue-team B3); rssMb now visible on /health. A soak harness DEFERRED (§4) |
| Garbage Collection | — | Default GC on a 4GB instance at a measured ~284 req/s ceiling; nothing to tune |
| Thread Safety | ✅ | Single-threaded Node per process; the real hazard (cross-process concurrency) is the lock discipline above |
| Clock Skew | ◐ | The one-clock rule applied at every known combat/economy timer site (JS-set AND JS-read); a tree-wide guard DEFERRED (§4) |
| Production Incidents | ✅ | Real runbooks encoding lived incidents (DEPLOY §7b/§7d), plus §8b-§8e from this change |
| On-call | ◐ | Webhook alert delivery drill-provable; escalation past a chat webhook DEFERRED (§4 — one founder IS the escalation chain) |
| Postmortems | ✅ | Every production incident has a written RCA with reproduction, root cause, fix AND a permanent enforcement (the CLAUDE.md chronicle + 85 audit reports) |

---

## 3. What "bulletproof" means here — the standing enforcement

The classification above is a snapshot; these are the mechanisms that keep it true:

- **The eleven catalogue-or-declare ledgers** in the test suite (locks, connections, handovers,
  watcher poison, scenery, wire templates, money formatting, catalog gates, ABI names, isolation,
  sheet fields): a new site must be classified or the build fails. A guard that silently stops
  covering its subject reads exactly like a clean bill of health — every ledger carries an
  anti-vacuity floor for that reason.
- **The nightly §10.4 sweep** — 31 economic invariants, every one proven able to fire
  (AUDIT-red-team-eight planted the minimal violation for each and watched all 31 catch it).
- **Real-Postgres gates** (pgquery: every static SQL string PREPAREd; pgcheck: the boot, the
  locks, the ledger, old-schema migration, the death race) — because pg-mem disagrees with
  production in ways no suite can see, and it has (the 2026-07-30 `uuid = text` outage).
- **Ten measurement harnesses** (sim, playthrough, loadtest, chaos, scale, mobile, pollcost,
  bond-dials, dexbot-e2e, stock-e2e) — the numbers in this document are measured, not estimated.

## 4. Deferred — with reasons

A deferred item without a reason is a forgotten item. These are decisions, on the record:

| Item | Why deferred |
|---|---|
| JWT dual-secret rotation (kid) | Rotating JWT_SECRET today forces a global logout — acceptable at alpha scale (tokens are 90d and re-auth is one click); per-ACCOUNT revocation (the actually-urgent half) is complete on all four bearer paths. Dual-secret verify is a contained future change to `src/auth.js`. |
| Per-operator mod keys | One founder operates the mod perimeter; `mod_actions` logs every mutation with IP/method/path. Per-operator identity matters the day a second operator exists — building it now adds key-management burden with no one to distinguish. |
| Client XSS output-encoding ledger | Write-time `cleanText` is the enforced posture and was adversarially driven (RT#8: 14/16 player fields reached, 0 stored raw markup). A per-`innerHTML` ledger over 103 sites is the right long-term guard; it is a large client sweep with no live instance behind it. Recorded as the known fragility it is. |
| N+1 per-request query counter | Every discovered N+1 is fixed with a regression; a counter needs a pg client instrumentation layer. The poll-cost harness bounds the REQUEST side; the query side is bounded today by review + the aggregate consolidation work. |
| pg_stat_statements | `PGC_SUSET` — superuser-only on managed Render; enabling it in schema.sql would break boot. The slow-request sampler (fix 4) is the app-side substitute; Render's own dashboard carries DB CPU. |
| Partitioning `transactions`/`rng_audit` | They are THE LEDGER. The §10.4 conservation sweep and several invariants sum them LIFETIME — retention or partition pruning would drift a correctness check months later, silently (exactly the near-miss that shaped fix 9's keep-list). Growth is bounded by economy throughput, and the tables are indexed for the sweep's access pattern. |
| Circuit-breaker trip states | The new 10s timeouts bound the harm of a hung endpoint to one bounded wait per sweep; alertDrift already backs off and swallows after 3. A trip/half-open state machine is real complexity that currently protects two webhooks and one email provider. |
| Build caching (Chromium, forge lib/) | CI cost only — correctness is unaffected; both fetches are pinned versions. Worth doing when CI minutes matter. |
| Render-cron backup schedule | A Render cron job has NO persistent disk, so "just cron tools/backup.sh" cannot work as infrastructure. §8e documents the real options (external runner + durable storage) instead of pretending the platform primitive exists. Render's managed PITR is the active layer meanwhile. |
| Backup encryption | `gpg -c` documented as the step IF dumps leave trusted storage; dumps currently stay on operator-controlled storage with 0600 perms. |
| Clock-skew tree-wide guard | The rule ("one clock: JS-set AND JS-read") is applied at every known timer site and stated in comments there; a mechanical cross-comparison of timestamp sources is a research-grade static analysis with high false-positive risk (the recorded fate of mostly-wrong advisories is that they get ignored). |
| Memory soak harness | rssMb is now on /health (the signal that catches a leak in production); a multi-hour soak harness is the follow-up that would catch it pre-deploy. |
| On-call escalation | One founder is the whole escalation chain; the drill-provable webhook reaches them. Paging infrastructure adds a vendor and a rotation with one person in it. |

## 5. The rule-10 example — the claim that was false

The classification workflow reported, under **Replication**: *"No standby/failover replica
exists (render.yaml databases block has none), so loss of the single DB instance means PITR
restore."* Verified first-hand before acting: **render.yaml:34 declares
`highAvailability.enabled: true`** — a standby WITH automatic failover, deliberately declared
in the blueprint ("so Render never decides the standby should be off"). The workflow's own
*Failover* item cited the same line as evidence, three entries later — the two items
contradicted each other and only one could be right.

Had the gap been trusted, this change would have shipped configuration to "add" a standby that
already exists — and the ledger above would carry a fabricated fix. This is why ground rule #10
exists and why every GAP/PARTIAL in this document was re-verified against the tree before
anything was built: **a finding produced by a tool you did not check is not a finding** — and
neither is a gap.
