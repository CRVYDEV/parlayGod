# AUDIT — World step six (THE UPRISING)

A focused three-lens red-team over the step-six drop (THE UPRISING — the World's first proactive
threat: a seed-drawn outfit rises up, defends harder + suspends its tribute, and at the reckoning
breaks free of an undefended held outpost unless the family reinforced the garrison). Three parallel
adversarial agents, each tracing every finding against source.

Scope: `cartelUprisingOf`/`WORLD.UPRISING` (`src/rules.js`), `reinforceOutpost`/`resolveUprising`/
`sweepUprisings`/`risingNow` + the `collectFrontier`/`raidChance`/`worldBoard` touchpoints
(`src/world.js`), the `world:reinforce` treasury term (`src/invariants.js`), and `world_uprisings`
(`schema.sql`) — compared against the audited frontier twins (`invadeOutpost`, `releaseFrontierHolds`,
`fortifyRacket`) and the materialize-then-resolve pattern (futurity/stakes).

## Verdict: no CRITICAL / HIGH / MED across any lens. Two LOWs fixed, two flagged.

**Lens A (§10.4 / emission) — CLEAN.** The one new sink (`world:reinforce`) debits the treasury by
exactly the ledgered amount (NULL-char/counterparty=gang) and is correctly subtracted in the
`gang treasuries` check (the `world:invade` twin, no double-count/sign error). The reclaim writes ZERO
`transactions` rows — `garrison` is a `world_npcs` NUMERIC, never a treasury balance nor a §10.4 bucket
(the money was already burned as a sink at spend time; resetting the number destroys no §10.4 value —
the `releaseFrontierHolds`/seizure precedent). The tribute suspension is a DEFERRAL bounded by the
existing 24h `TRIBUTE_CAP_MS` — emission can only DECREASE, never increase — and a break-free correctly
FORFEITS the arrears (`tribute_at`→NULL AND `held_by_gang`→NULL). No garrison→cash refund path (invade
+ reinforce are pure sinks; a rival invasion outbids, never refunds the incumbent). The raid-defense
bump only LOWERS raid odds (less `world:raid` emission). `world_uprisings` is a day-keyed schedule, not
a money surface, correctly excluded from the estate wipe. The step-five core-district occupation
(`turf:seize:`) is untouched.

**Lens B (concurrency / locks) — CLEAN** (no C/H/M). `world_npcs` is locked LAST on every path
(reinforce/invade/collect/raid all lock gang-or-char first); `world_uprisings` is single-writer
(only sweep/resolve touch it) and `resolveUprising` locks it BEFORE `world_npcs` — so no path locks
`world_npcs`→`world_uprisings`, **no AB-BA cycle**. The materialize is idempotent via the `day` PK
(23505 swallowed, everything else rethrown); `resolveUprising` latches on `status='active'` under
`FOR UPDATE` (no double-reclaim); the garrison RMW is an absolute write under the world_npcs lock (no
lost update); a concurrent collect/invade/reinforce re-reads the post-reclaim `held_by_gang=NULL` and
cleanly excludes/throws BEFORE any treasury debit. All NUMERIC columns use absolute writes (no pg-mem
INT-arith quirk). Per-row worker isolation (own connection, ROLLBACK→retry).

**Lens C (exploit / grief / server-authority) — CLEAN** (no C/H/M). The schedule + which outfit rises
are pure `MARKET_SEED` hashes (unknowable/unforgeable); both test knobs (`WORLD_UPRISING`,
`WORLD_UPRISING_FORCE`) are env-only, never a request field (the reinforce route passes only `amount`).
Every reinforce gate is tight (rank/not_held/amount≥MIN/`Number.isFinite`/treasury/bad_npc, all before
the debit). The threshold math is sound (`< need` breaks, `>= need` repels; the `need→0` degenerate
REPELS — the intended interlock, and held outposts always carry `garrison ≥ 25000` so garrison-0-held
is unreachable). The strength interlock is grief-proof (strength moves DOWN only via raids, UP only via
passive regen — no heal/pump action exists, so a rival can't inflate a holder's `need`; raiding an
outfit HELPS the holder). Forecast-gaming is a non-issue (the reckoning reads `held_by_gang` at resolve
time; no voluntary "abandon outpost" action exists to dodge-and-retake cheaply). Dissolution/unheld/
unknown-fixture all fall through to a clean `'quiet'` no-op.

## Fixes applied (the two LOWs — regression-covered)

- **Lens C LOW-1 (telegraph trap → fixed):** the board's `upriseNeed` was computed from the outfit's
  VIEW-time strength, but the reckoning scales the real need by RESOLVE-time strength (higher after
  regen), so a defender who reinforced to the displayed number could still lose to regen. The board now
  surfaces the **full-strength (worst-case) need** (`max × THRESHOLD_BPS/10000`) — reinforce to this and
  regen can't catch you out; a beaten-down outfit's real need at the reckoning is still lower (the
  interlock holds), so it's a conservative SAFE target, never an under-statement. Regression asserts
  the board value == the full-strength need.

- **Lens B LOW-1 (silent sweep catch → fixed):** the per-row `sweepUprisings` catch swallowed errors
  with no log (a persistent non-transient failure would retry every tick with zero signal). Now
  `console.error`s the day/npc/message — the `sweepAuctions` poison-row-logging precedent. (Isolation
  was already intact; this is diagnosability only.)

## Flagged for founder sign-off (NOT patched — ground rule #1)

- **Lens C LOW-2 (sub-apex uprisings are toothless):** for dockrats/zappa the full-strength need
  (4,500 / 12,000) is BELOW the base `ROUT_GARRISON` (25,000), so their held outposts always repel — the
  uprising there is cosmetic (a day of +DEF + suspended tribute, but the reckoning never breaks it). Only
  kryl/moreau/volkov (need-at-full 45k/150k/360k > 25k) are genuinely threatened. A balance/tuning
  observation — the dial is `THRESHOLD_BPS` (raise it) or a per-tier garrison floor; a founder call, not
  a defect. `UPRISING.*` are already flagged sign-off levers.
- **Lens C LOW-3 (worker-downtime liveness):** if the worker misses a day, that day's `world_uprisings`
  row is never materialized, so its reckoning never fires (holders keep the turf free). No player
  controls this; same-day DEF/tribute-suspend still work (live `risingNow`). Accepted for a scheduled
  event, consistent with every other worker sweep.

Suite 33/33 + sim drift-0 (16 §10.4 checks incl. the `world:reinforce` gang-treasuries term).
