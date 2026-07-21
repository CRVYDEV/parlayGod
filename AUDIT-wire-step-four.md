# AUDIT — The Wire step four (the Spymaster's Tradecraft + the Watchdog)

A focused three-lens red-team over the tradecraft rank perks + the watchdog push layer (§10.4/economy,
the watchdog worker concurrency, exploit/grief/info-leak), every claim verified against source. **No
CRITICAL / HIGH.** One MED hardening applied in-commit; everything else verified clean.

## Fixed in-commit

**MED — the watchdog's notify-then-flag was not idempotent under concurrent workers/retries.**
`sweepWireAlerts` originally fired the `notify()` and then set the per-tap flag in a separate statement,
so two overlapping worker passes (or a retry) could both read `alerted_*=false` and double-fire an
alert. **Fix:** converted to the **claim-then-notify** discipline (the fees.js/store idempotency
pattern) — each flag is set by `UPDATE … SET <col>=true WHERE … AND <col>=false`, and the notify fires
ONLY when that UPDATE claims the row (`rowCount > 0`). The flag-set is now the atomic guard, so exactly
one pass alerts per event. (`<col>` is a fixed literal, not user input — no injection.) The existing
test (fire-once-per-event, subscribe-gate, re-tap-reset) covers the behaviour; the change makes it
concurrency-robust. Benign in single-worker deployment either way, but this is the correct pattern.

## Verified CLEAN

**§10.4 / economy.** The tradecraft discount reduces the amount passed to `spendOmr`, so the ledgered
`intel:*` burn EQUALS the charge — still a deflationary burn, no faucet created (the skills/Underworld
"discounted amount is what's ledgered" precedent). The charge is recomputed SERVER-SIDE in
placeTap/recruitInformant/pullDossier from the account's real `intel_ops` (the board's discounted
`costs` are display-only — a client can't set its own price). `intelCost` floors at 1 (no zero/negative
at max 30% off). The rank-grind loop is deflationary and bounded (Oracle caps at 1500 ops / +5 slots /
30%; each bump costs an $OMR burn) — a status-axis modifier off the sim-audited balance. `sweepBugs`/
`traceBugs` early-return BEFORE `bumpIntelOps` on a clean line, so there is NO free rank-grind. The
watchdog moves zero value (pushes a notification only) — no §10.4 surface, no vocab/invariant change.

**Watchdog correctness.** The sweep query gates on `t.alive` (dead marks go silent), `wc.alive` +
`wc.wire_until > now()` (only a LIVE, currently-SUBSCRIBED watcher is alerted — a lapsed sub gets
nothing), and `w.expires_at > now()` (an expired tap is silent). Flags live on the `wiretaps` row (not
a character column), so there's no `persistCharacter` clobber; placeTap resets them by direct UPDATE on
a place/refresh (a fresh surveillance re-alerts). wiretaps aren't in the estate wipe, but the alive-JOINs
exclude a dead party, so no stale alerts. The `notify(pool, …)` writes the row + emits the bus event;
the row persists (surfaced on the WS backfill) even if the worker is a separate process from the API —
the loan-sweep-notify precedent.

**Exploit / grief / info-leak.** The watchdog pushes only what a live tap ALREADY reveals on read
(`huntingYou`/wanted/law) — a push of paid-for intel, not a new leak — and it's subscribe-gated. No
reward attaches to an alert (no farming incentive). The tradecraft discount is a single capped rank
lookup (no cross-system stacking), and the +slots are bounded by rank; every tap still burns $OMR.

Suite 32/32 + sim drift-0.
