# AUDIT — The Wire, step three: the counter-intel triad (DISINFORMATION + THE INFORMANT)

**Date:** 2026-07-21
**Scope:** the Wire-pillar step-three drop — `plantDisinfo` (`intel:disinfo`, direct-SQL `disinfo_until`),
`scrambleTap` (cooks a wiretap's PRIVATE signals while PUBLIC bulletins stay true), `recruitInformant`
(`intel:informant`, the `wire_informants` retainer that reads deeper AND PIERCES disinfo), `informantIntel`,
and the `wireBoard` integration + `sweepWire` retainer reaping. (Steps one/two — tap/sweep/sub, trace/
dossier/spymaster — were audited previously; this pass covers the new triad + its interactions.)

**Method:** three independent red-team lenses run in parallel (§10.4/persist/$OMR, concurrency/locks, and
exploit/info-leak/grief/consistency), each re-verifying every claim against source, cross-checked against my
own read.

## Result — no CRITICAL / HIGH / MED. Verdict: CLEAN.

### §10.4 / persist / $OMR — CLEAN
- All seven wire spends (wiretap/sweep/disinfo/informant/trace/dossier/wire) burn via `spendOmr` — a pure
  account-bucket debit — under an `intel:*` reason that is in BOTH the omr `KNOWN_REASONS` vocabulary
  (`invariants.js:18`) AND the `omrBurns` conservation term (`invariants.js:124`, `reason LIKE 'intel:%'`).
  Zero drift; no faucet/mint anywhere in the module.
- `disinfo_until` is written by DIRECT SQL (`wire.js:111`) + mirrored in-memory (`:112`), and is ABSENT from
  `persistCharacter`'s positional column list (which ends `... envelope_until=$59, wire_until=$60`,
  `game.js:468`) — so no later action's persist can clobber it (the `active_at`/`pen_faction` pattern).
  `wire_until` IS persisted at `$60` and correctly set in-memory by `subscribeWire` (not direct SQL) —
  consistent, no conflict. `bumpIntelOps` likewise writes `account_persistent.intel_ops` by direct SQL,
  absent from `persistAccount` → the increment is never reverted (the kills/war-effort precedent).
- Free-when-clean paths (`sweepBugs :96`, `traceBugs :155`) return `{spent:0}` before `spendOmr` — never
  charge, never mint.
- `runEstate` deletes `wiretaps` AND `wire_informants` for BOTH watcher and target sides
  (`social.js:1347/1349`); `disinfo_until` rides the character row and dies with the wipe.

### Concurrency / locks — CLEAN
- All 8 `/v1/wire/*` routes run under `G.withCharacter` single-party (none two-party). The actor's living
  character row is `FOR UPDATE`-locked for the whole txn.
- `placeTap`/`recruitInformant` upsert (UPDATE-then-INSERT-if-rowcount-0) on `PK(watcher,target)` scoped to
  `watcher_character=ch.id`: same-watcher calls serialize on the actor's char lock (the second sees the
  committed row → takes the UPDATE branch, never a double-INSERT); distinct watchers → distinct PK, no
  collision; a stray `23505`/`40P01` maps to a retryable `contention` regardless. The `TAP_MAX`/
  `INFORMANT_MAX` cap SELECT + upsert are both under the same lock — no TOCTOU bypass.
- Every read (`tapIntel`/`informantIntel`/`pullDossier`/`traceBugs`/`wireBoard`) reads OTHER characters'
  rows UNLOCKED and writes to no second character → no AB-BA possible (mutual surveillance A↔B can't cycle).
- `plantDisinfo`/`subscribeWire` write only the actor's own (already-locked) row.

### Exploit / info-leak / grief / consistency — CLEAN (two LOW design-margin notes)
- **Anti-precise-kill-EV rule holds:** every wealth read is BANDED (`tapIntel :64`, `informantIntel` via
  tapIntel, `pullDossier :185`, `scrambleTap :42`) — no path emits exact cash. The dossier's hard-records
  read pierces disinfo but STILL bands wealth.
- **scrambleTap is non-invertible:** the cook hashes on `(target, day)` only and is completely independent
  of the true values, so a watcher cannot recover truth from a cooked read, and daily re-hashing kills
  cross-day signals. The board fully REPLACES the private fields — the true `huntingYou`/`wealth`/`law`
  computed in `tapIntel` never survive into a disinfo'd tap response. `...intel` preserves only
  intended-true PUBLIC fields (`name/level/loc/wanted/ops.family`).
- **Public-vs-private split correct:** `wanted` is NOT overridden (a wanted man can't hide behind disinfo —
  the design mandate); the INFORMANT and DOSSIER correctly read hard-records truth (the intended piercers).
- Self/dead/heir gates present on all three targeted actions (ids are TEXT, so the string-param `===`
  self-gate can't be type-bypassed); all reads JOIN `alive` (a dead mark's wire goes silent, taps don't
  follow to the heir's fresh id).
- **Grief-bounded:** a tap is a READ (no damage) — the griefer pays 8 $OMR to place, the victim ignores it
  free or sweeps for 5; net cost favors the victim. Surveilling a safehoused/witpro/jailed mark reveals
  only banded/public data and never undermines those systems' attack-time guarantees (`fire`/`npcHit` still
  throw).

**LOW-1 (design-margin, NOT patched — ground rule #1):** `scrambleTap` hardcodes `law.indicted:false`,
`ops.territory:0`, and `huntingYou:false` rather than randomizing them. A watcher holding INDEPENDENT
knowledge (e.g. the mark's territory is visible on `GET /v1/gangs`) could infer disinfo is active. This is
**by design and documented/tested**: `huntingYou:false` IS the feature (disinfo hides the hunt — asserted in
`test/wire.js`), and `indicted:false` is the documented "the indictment flag false" behavior. Disinfo is a
bluff, not perfect invisibility; the intended counters are the informant/dossier. Left as-is.

**LOW-2 (pre-existing, cosmetic, NOT specific to this drop):** the SPYMASTER leaderboard (`intel_ops`) does
not label/exclude agent-flagged accounts. This is CONSISTENT with the other bought/grind status boards
(`worldLeaderboard`/`territoryLeaderboard`); only the anti-Sybil-PAYOUT axes (hitman season board, referrals)
special-case agents. `intel_ops` is a pure $OMR SINK (every bump burns $OMR) → rank is bounded by spend, not
farmable, and carries no payout, so agent inclusion is acceptable. A cosmetic `agent:true` label on the
world/territory/wire boards would be a codebase-wide polish item, not a Wire fix.

## Regression added
`test/wire.js` — a persist-clobber guard: after the quarry plants disinfo, they perform a persisting action
(subscribe) and the board still reports disinfo active — locking in that the direct-SQL `disinfo_until`
survives `persistCharacter`.

## Verdict
The DISINFORMATION + INFORMANT + trace/dossier/spymaster triad is §10.4-clean, deadlock-free, persist-safe,
and exploit-clean; the layered intel economy (SUB counts → TAP IDs foilably → DOSSIER reads records →
INFORMANT is the reliable human source → DISINFO counters the cheap tap) holds as designed. Suite 30/30 +
sim drift-0.
