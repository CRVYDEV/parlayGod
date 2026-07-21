# AUDIT — The Port step two (naval upgrades + PIRACY + rendezvous)

A focused three-lens red-team over the step-two surface (piracy PvP, naval upgrades, the offshore
rendezvous): **§10.4/emission**, **concurrency/locks**, and **exploit/grief**. Every finding
re-verified against `src/port.js`. **No CRITICAL/HIGH.** One MED-LOW fixed in-commit; the rest verified
clean; one balance item flagged for founder sign-off (ground rule #1).

## Fixed in-commit

**F1 (MED-LOW — the `port_intercepts` one-per-pirate guard swallowed retryable errors).** The INSERT
that enforces "one interception per pirate per live run" used a bare `try { … } catch { throw 'once' }`,
so a transient serialization/deadlock error (`40P01`/`40001`) on the INSERT would be **mis-reported as
`once` and swallowed** — defeating the wrapper's `deadlockToRetry` contention retry (game.js:28). Note the
codebase treats an *escaped* `23505` as retryable too, so a bubbled unique violation would infinite-retry;
the correct pattern (casino.js:256) is to catch the **known** `23505` locally as a terminal `once` and
**rethrow everything else**. Fixed: `catch (e) { if (e?.code === '23505') throw new GameError('once', …);
throw e; }`. The guard runs *before* any energy/ammo is spent, so a clean `once` rejection charges nothing.
Regression: `test/port.js` already asserts the `once` gate (a second intercept on the same run).

## Verified CLEAN

**Emission / §10.4 (piracy is a REDIRECT, not a new mint).** A piracy WIN lands
`PIRATE_TAKE_BPS` (60%) of the run's would-be `port:sale` and **voids the run** (`run_until=NULL`), so the
runner never lands it. Total emission for a pirated run is strictly **< a clean landing** (0.6× vs 1.0×),
and each run can be won only once (the void + the boat lock). So piracy can only *reduce* total port
emission while redistributing 60% to pirates — the convoy-hijack argument, realized as cash because the
Port has no goods intermediary. The ammo sink (`port:piracy`) rides the `port:` ammo vocab; the cash faucet
(`port:piracy`) rides the `port:` cash vocab — the sim's `reason vocabulary` + per-character `character
cash` checks reconcile (drift-0).

**Double-realization is impossible.** All run-mutating paths (`launchRun`/`collectRun`/`sellBoat`/
`upgradeBoat`/`interceptRun`/`rendezvous`) lock the boat row `FOR UPDATE`. A piracy and the owner's collect
therefore serialize on the boat: whoever commits first voids/lands the run; the loser re-reads
`run_until=NULL` → `landed`/`not_out`. No run pays twice.

**Lock order is acyclic.** Every single-boat action locks `own char (withCharacter) → one boat`. Piracy
locks `pirate char → one target boat`. Rendezvous is the only multi-boat locker: `runner char → two boats
in sorted id order`. Because every non-rendezvous path locks **at most one** boat (and never waits for a
second), no cycle can form with piracy or the owner's actions; two rendezvous can't AB-BA because both use
sorted order. The partner's *character* row is never locked in rendezvous (only their boat), so there's no
cross-character edge. Verified against `withCharacter` locking the actor's char row first.

**Rendezvous is a gift, not grief, and §10.4-neutral.** The run just changes vessels — no currency moves;
`port:sale` fires once for whoever finally collects. The receiver (a consenting, `rendezvous`-flagged
docked boat) *keeps the cargo* on a clean landing, so a "handoff" gives value to the partner — a runner
can't dump risk on an unwilling victim (the fine on interdiction hits the collector, but the collector also
banks the full sale; net-positive for them, and they opted in by flagging). Total sourcing stays bounded by
the *runner's* supply cap, so handing off can't exceed the cap or double emission.

**Persist-clobber-free.** Piracy mutates only the pirate's own `ch.*` (cash/energy/ammo/heat/health,
persisted by `withCharacter`) and the target boat via direct SQL; the runner's character row is never
loaded or written (only a `notify`). Rendezvous writes only boat rows + a notify. No positional-UPDATE
clobber.

**Upgrade path safe.** `part` is whitelisted (`bad_part`); the column is chosen by a hardcoded ternary
(no injection from the param); cost is bounded (tier clamped 1–12, level capped `UPGRADE_MAX`); `effHold`/
`effSpeed` guard null boat/spec with `|| 0`. Upgrades raise realized throughput toward the **unchanged**
daily supply cap, not the cap itself.

**Grief bounded.** Piracy costs the pirate energy + ammo + heat and is one-shot per pirate per run; only
the first winner takes the cargo (the rest waste their attempt on a now-voided run). A fast boat + escort +
the rendezvous escape give the runner counterplay. The `own`/`family`/`level`/`no_boat` gates hold.

## Flagged for founder sign-off (NOT patched, ground rule #1)

**Self-piracy floor (balance, §10.4-safe).** A Sybil pair (A launches a run, B pirates it) can convert A's
supply-capped sourcing into a *guaranteed* cash faucet without interdiction risk. Reviewed and **bounded**:
the ring's take is `0.6 × (hold × sell)` vs A's `hold × buy` cost — a net gain only where `0.6 × sell >
buy` (the richer routes), and always **less** than one player running the same cargo legit (which lands
`hold × sell` at 100% if clean). Total self-piracy emission ≤ `0.6 ×` the legit-landing ceiling and stays
bounded by A's daily supply cap, so it cannot exceed honest play's emission — it's a *worse* way to earn,
not an exploit. Left as-is; the dial if the alpha shows it (e.g. a same-account/-IP piracy exclusion, or a
lower `PIRATE_TAKE_BPS`) is a founder call. `PIRATE_TAKE_BPS` + the `STEP2.*` contest numbers remain
sign-off levers pending the sim pass BALANCE.md already flags.

Suite 32/32 + sim drift-0 after the fix.
