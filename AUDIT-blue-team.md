# AUDIT — the blue-team pass (2026-08-09)

**Point-in-time, like every report in `docs/AUDITS.md`.** It describes the tree on the day it was written,
including the fixes applied hours later in the same session. For how OMERTÀ works *now*, read `SPEC.md`.

This is a **blue-team** review, and that word is doing work. The ~78 reports before it are red-team passes:
they hunt for an exploit — a §10.4 drift, a lock cycle, a forgeable voucher, a way to mint money — and the
finding is a bug that was live. This pass asked the defensive question instead: *if an attacker who cannot
find a logic bug comes at the running service, what is the posture — the perimeter, the secrets, the
detection, the blast radius?* The output is not "here is money you can steal"; it is **defence in depth** —
the layers that make an incident less likely, smaller when it happens, and visible when it does.

**Headline: no CRITICAL, and the core is sound.** The economic and auth invariants the whole game rests on
were found strong (see *Posture* below). Every finding is a hardening of the surface *around* that core, and
every fix is additive or fail-safe: §10.4 untouched, the full test suite + sim drift-0 + real-Postgres
`pgquery`/`pgcheck` green after each batch. Nothing here patched a live exploit — it removed ways a *future*
mistake or a *stolen credential* could turn into a bad day.

The review ran as six parallel domain sweeps (auth, resilience, detection, deploy/secrets, the unauthenticated
edge, and dependency/supply-chain), synthesised into one ranked list, then applied in five risk-ordered
batches. This document is the record of both.

---

## Posture — what the blue team found already strong

These are not findings. They are the reason there was no CRITICAL, and they are worth stating because a
hardening list read alone makes a system look weaker than it is.

- **§10.4 conservation is a first-class, continuously-checked invariant** — the economic intrusion-detection
  system. `invariants.js` reconciles every currency bucket against an enumerated reason vocabulary; the
  worker runs it nightly and alerts; `tools/sim.js` proves drift-0 over an entirely earned economy on every
  economy change. An attacker who *did* find a way to mint would trip an alarm the same night.
- **Extraction ≤ inflow is enforced by construction**, not by policy — the full-reserve withdrawal queue can
  only sign a voucher the reserve backs. The real-money boundary cannot be over-drawn even if the game
  economy is somehow inflated.
- **The ban check is DB-driven, never token-driven** — a banned account's pre-ban JWT is dead at the door,
  and a mid-session ban closes its live sockets. Agent status is read from the DB too, so a pre-flag token
  can't dodge the agent throttle.
- **Server-authoritative everything.** Client input is a choice, never a value; all randomness is server-side
  and `rng_audit`'d. There is no client-trusted state to forge.
- **Idempotency reserves before it executes** — a double-submit can't double-spend, and the reservation is
  released on a 4xx/5xx so a transient error can't poison the key.
- **The lock discipline is mature** — a global lock order, `withTwoCharacters` sorted locks, and a
  `40P01/55P03 → contention` retry mapping so a deadlock is a clean retry, never a 500. The real-Postgres
  `pgcheck`/`loadtest`/`chaos` harnesses exercise it under contention.
- **The CI posture is itself a control.** `pgquery` type-resolves every static SQL string on real Postgres
  (the `uuid = text` outage class), `pgcheck` runs the loop/locks/ledger on real Postgres, and the
  client/routes/mobile/docs/levers guards keep the surface honest. Real-Postgres CI catches the pg-mem/prod
  divergence that a unit suite structurally cannot.
- **The chain layer is dormant and gated** on a third-party contract+signer audit and the launch checklist; the
  contracts carry their own `forge` suite and anti-rug walls (no owner mint, daily caps, fail-closed oracle).
- **DB-outage resilience was already hardened** — pool `error` handlers on idle *and* checked-out clients
  (the 2026-07-25/07-26 incidents), a `db_down` 503 classification distinct from a 500, `/health`, and a
  backup + WAL-archiver watchdog into the alarm channel.
- **The public render routes are SSRF-safe by construction** — `/art/:file` is a boot-time allowlist Map
  lookup, so path traversal is not a code path that exists.

---

## Findings and fixes, by batch (risk-ordered)

Severity is defensive: **C**ritical / **H**igh / **M**edium, where "High" means *a plausible path from a
common mistake or a leaked credential to real harm*, not *a live exploit*.

### Batch 1 — the deploy pipeline (C1, M5, M6)

- **C1 — a red CI could auto-ship to production.** `render.yaml` had `autoDeploy: true`, so any push to the
  deploy branch shipped whether or not the checks passed — the one place a broken *or insecure* build reaches
  players with nothing in the way. **Fixed:** `autoDeployTrigger: checksPass` — the gate the whole guard
  suite exists to be. (A dashboard-verification note is in `DEPLOY.md`; branch protection was deliberately
  *not* used, to avoid a paths-ignore wedge.)
- **M5 — non-reproducible build with dev deps on the box.** `buildCommand: npm install` → **`npm ci --omit=dev`**:
  a lockfile-exact install with no devDependencies (a smaller attack surface on the running host).
- **M6 — a HIGH in the dependency tree.** `npm audit fix` cleared a `fast-uri` transitive (a fastify
  dependency) → **0 vulnerabilities**. Recorded as pre-existing, not introduced by this session.

### Batch 2 — preflight: fail the boot on a weak posture (H1, H5, M8, M1)

- **H1 — a weak `JWT_SECRET` is a master key.** The whole session-auth model is HS256 over one shared
  secret; a low-entropy secret is offline-brute-forceable, after which *any* token for *any* account is
  forgeable. **Fixed:** a secret under **≥24 chars / ≥8 distinct** is a **hard boot error** in a hardened
  deploy. `render.yaml`'s `generateValue: true` keeps prod strong on its own; the floor catches a hand-set
  or copy-pasted weak one before it can serve a request.
- **H5 — the alarm channel firing into nothing.** With `INVARIANT_WEBHOOK_URL` unset, the §10.4-drift /
  backup-failure / oracle-halt / worker-stale alarms have nowhere to go. **Fixed:** a **warning** (not fatal —
  a live server must not fall over for a dormant alarm), so the operator is told at boot.
- **M8 — public drama on the private channel.** `CITY_WIRE_WEBHOOK_URL == INVARIANT_WEBHOOK_URL` would post
  public city events into the private ops-alarm channel (and drown real alerts). **Fixed:** a **hard error** —
  they must be different channels.
- **M1 — the worker didn't refuse test knobs in prod.** The API process already errors on a `TEST_ONLY_ENV`
  knob in a hardened deploy; the worker (a separate process) did not, so a `SEARCH_MS`/`SHANK_P`-class knob
  could silently shrink a timer or pin a roll in production on the worker's half of the game. **Fixed:** a
  `testOnlyLeaks()` boot guard on the worker mirrors the API.

### Batch 3 — the unauthenticated edge (H2, H3, H4, SSRF)

- **H2 — no security-header baseline.** Only `/admin` set any; every other served page (the console, `/wiki`,
  `/play`, the SVG cards) shipped with no framing, sniff, or referrer protection. The console keeps the bearer
  in `localStorage` and is one-click money-driven (FIRE / unstake / withdraw), so a framed console is a real
  clickjacking target. **Fixed:** an `onSend` hook sets `X-Content-Type-Options: nosniff` on everything, HSTS
  in production, `X-Frame-Options: DENY` + `Referrer-Policy` on `text/html`, and a locked-down CSP on served
  SVG — without clobbering `/admin`'s stricter headers. The hook is **fail-safe**: it skips once headers are
  on the wire, so a route that double-sends can never crash the process on a header write. *(Building it
  surfaced one latent double-send: the digest-unsubscribe handler called `reply.send()` without returning it —
  a Fastify async-handler footgun that runs the send lifecycle twice. Fixed to `return reply.type().send()`,
  matching every other static-HTML route. The fail-safe guard covers any future one.)*
- **H3 — `trustProxy: true` let the client IP be spoofed.** Trust-all means the *leftmost* `X-Forwarded-For`
  is believed — attacker-controlled — so the IP the rate limiter and the audit log key on is forgeable.
  **Fixed:** `trustProxy: 1` (trust exactly one hop = Render's proxy → the real client IP), behind
  `TRUST_PROXY=on`.
- **H4 — a keyless board could exhaust the pool.** The per-IP public limiter was an *allowlist*, so any
  DB-heavy keyless `/v1` GET omitted from it hit zero buckets — above all `GET /v1/gangs/:id`, which opens a
  *write* transaction holding a pooled connection and gang-row locks. An unauthenticated flood could pin the
  pool and starve everyone. **Fixed:** every keyless `/v1` GET routes to the per-IP limiter by **default** (a
  denylist, not an allowlist) — a new keyless route can no longer ship unthrottled by omission.
- **SSRF — a push subscription is an attacker-supplied URL the server later POSTs to.** Web-push endpoints
  are stored and hit by the worker; an attacker could point one at `169.254.169.254` (cloud metadata) or an
  internal service and use the server as a confused deputy. **Fixed:** `saveSubscription` rejects a
  localhost / `.local` / private / CGNAT / link-local / IPv4-mapped target (IPv4 *and* IPv6 literals) and
  DNS-resolves a hostname to reject a private answer — best-effort, so a lookup failure doesn't block a
  legitimate provider.

### Batch 4 — detection depth (C2, exchange invariant)

- **C2 — the worker could go silent invisibly.** The worker is a **separate process** and the *sole* source
  of every proactive alarm and every timed settlement (buyback, bounty refunds, auction/tournament settles,
  voucher reclaim, the nightly §10.4 sweep). A dead or wedged worker took *all* detection dark and stopped
  *all* settlement — and "clean nightly" was indistinguishable from "dead for a week". **Fixed:** a
  `worker_heartbeat` row the worker stamps each tick, surfaced on `GET /health` as
  `worker.beatAgoSeconds`/`stale`, so an uptime monitor can alarm on worker silence. *(Ranked C because the
  worker's silence disables the very alarms that would otherwise report an incident — a detection single point
  of failure.)*
- **The redemption window's cash-backing wasn't watched.** `runExchangeInvariants` (the "paid ≤ funded"
  check on the $OMR→cash Window) was tested but not run in production. **Fixed:** it joins the worker's
  nightly sweep beside the desk / vig / bond / treasury checks.

### Batch 5 — auth depth (M2, M3)

- **M2 — the god-mode perimeter was unlogged and unthrottled.** A leaked or misused `MOD_KEY` grants
  ban / mod-kill / confiscate / mint-invites / fund-reserve with **no record of who did what when**, and the
  perimeter had no flood bound. **Fixed:** a `mod_actions` audit table records every mod *mutation*
  (method/path/IP/time — GETs are dashboard reads, not actions, so they're skipped to keep the log signal),
  a per-IP throttle bounds a flood at the perimeter, and `GET /v1/mod/actions` reads the log back (a GET, so
  it doesn't log itself). *Limitation, stated:* the `MOD_KEY` is one shared secret, so the log records the
  IP, not the operator identity — per-operator keys are the next step.
- **M3 — a stolen token couldn't be revoked.** A 30-day JWT was valid until expiry; ban covered a *banned*
  account, but there was no self-serve "log me out everywhere" and no way to neutralise a compromised token
  short of a full ban. **Fixed:** every issued token carries a `tv` (token_version) claim; a bump invalidates
  every token issued before it. `POST /v1/auth/logout-all` (self-serve) and `POST /v1/mod/revoke` (the lighter
  tool than a ban) bump it. Enforced on the `auth` preHandler *and* the guarded-mutation path — so a revoked
  token is refused on essentially every authed route, read and write. **Grandfathered by design:** a token
  with *no* `tv` claim (issued before this shipped) stays valid until its ≤30-day TTL, so the deploy is not a
  mass logout; revocation is fully effective once the old tokens age out. *(Enforcement requires the account
  load the `auth`/guarded paths already do; the fully-keyless boards have no token to revoke.)*

---

## What was deferred, accepted, or noted

Nothing here is a live hole; each is a bound on how far a fix went or a next step worth a separate pass.

- **Per-operator mod identity (M2 next step).** The audit log keys on IP, not operator, because the mod
  secret is shared. Per-operator keys (or an OIDC-gated mod dashboard) would name the actor. Deferred — a
  design change, not a patch.
- **M3 read coverage.** Enforcement is on the account-loading paths (the `auth` preHandler covers authed
  reads *and* writes); the keyless public boards have nothing to revoke. Full read-path revocation on the
  keyless boards would cost a DB load per keyless read — deliberately not taken (it would undo the H4
  pool-protection intent). The important half (anything that moves money, and every authed read) is covered.
- **Grandfathered tokens.** Old tokens are valid ≤30 days after M3 ships. This is the *safe* semantics (no
  deploy-day mass logout); the weak window closes on its own.
- **The chain / real-money layer** stays gated on the third-party contract+signer audit and the launch checklist
  (`CHAIN-DEPLOY.md`). Nothing in this pass touched it.

**Bottom line:** the perimeter, the secrets posture, the detection, and the blast radius are materially
better, and the core the game rests on was strong to begin with. The fixes are the kind you want to have made
*before* an incident, not the kind you make *during* one.
