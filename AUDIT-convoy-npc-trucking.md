# AUDIT — Convoy step three (NPC trucking)

A focused red-team over the NPC-trucking drop (`src/convoy.js` `spawnNpcConvoys`/`despawnArrivedNpc` +
the NULL-owner `ambushConvoy` path + `convoyBoard` + the worker wiring): §10.4/faucet, the NULL-owner ambush
path, spawn/despawn concurrency, and cross-system (collect/toll/insurance/estate). Suite 31/31 + sim
drift-0.

**No CRITICAL/HIGH. One LOW hardening + one measurement clarification.**

## Verified CLEAN

- **§10.4 — the NPC-goods faucet is invisible + bounded.** There is NO goods-conservation check (trade
  goods are freely minted/burned by the buy/sell loop), and `goods:` is already a vocabularied faucet/sink
  prefix — so an NPC truck's hijacked goods sell via the EXISTING market faucet (`goods:`/`swap:`), adding
  ZERO new §10.4 reason and no drift (the sim, which doesn't run the spawner, stays drift-0). The faucet is
  bounded three ways: **one manifest per convoy** (up to `MAX_AMBUSHES` raiders SPLIT it — a convoy never
  yields more than its manifest), **turnover = TARGET/lifetime** (a hijacked-but-not-arrived truck stays
  "live" so hijacking never frees a slot early — the respawn cadence is the 30-min lifetime, not the
  hijack rate), and the **trunk cap** per raider. Measured (P9.17): ~$216k–$433k/day base-wide CEILING
  (whole road captured uncontested); the real per-player bound is ENERGY (`AMBUSH_ENERGY` 20 + `AMBUSH_AMMO`
  10 per hit → a solo grinder is capped well under the ceiling), at boxing/territory parity.
- **The NULL-owner ambush path is crash-free.** Every `c.owner_character`/`c.owner_gang` reference in
  `ambushConvoy` is NULL-safe for an NPC convoy: the own-truck gate (`NULL !== ch.id`), the family-omertà
  gate (`c.owner_gang && …` short-circuits), the turf-defense block (`if (c.owner_gang)` skips), the
  insurance stamp (`c.insured` false), and BOTH owner-notify calls (now `if (c.owner_character)` guarded).
  No other owner reference exists.
- **Cross-system containment.** An NPC convoy can't be collected (`collectConvoy` filters
  `owner_character=$1`, never NULL), tolled (toll is at collect, owner-only), or insured (NPC `insured`
  false). It doesn't count against a player's one-convoy-per-player cap (`myActive` filters by owner). It
  needs no estate handling (no owner → not tied to a death; hijacked goods ride the raider's trunk, wiped
  normally). `despawnArrivedNpc`/`spawnNpcConvoys` filter strictly on `is_npc` — a player convoy is never
  touched.
- **The board.** NPC trucks surface as ambush targets (`npc:true`, owner "an unmarked truck"); an
  arrived-but-not-yet-despawned NPC truck briefly shows unhittable (`ambushConvoy` throws `arrived`), the
  same window player convoys already have — self-corrects on the next worker tick.

## Fixed in-commit

**LOW (hardening) — non-atomic despawn.** `despawnArrivedNpc` deleted cargo, ambushes, and the convoy row
in three separate auto-committed `pool.query` calls, so a mid-despawn crash could leave an arrived
empty-manifest convoy (harmless — it despawns next tick — but untidy). Now each truck's three deletes run
in ONE txn (BEGIN/COMMIT, per-truck, rollback-on-error), so the removal lands together.

## Clarified (measurement, not a defect)

The P9.17 base-wide ceiling ($216k–$433k/day) is the WHOLE road captured uncontested; the sim now also
prints the real per-player bound (the ENERGY throttle — ~25 ambushes/day at ~500 energy) and notes that
`MAX_AMBUSHES` raiders split one manifest, so a contested road dilutes the take. Both land at
boxing/territory parity.

## Flagged (NOT patched — sign-off)

- The base-wide faucet magnitude + the single-worker spawn TOCTOU (a mild, self-correcting over-spawn only
  if multiple worker processes ran — the world-raid/city-event precedent, single-worker in production).
  `CONVOY.NPC.TARGET` / manifest size are the dials.

Suite 31/31 + sim drift-0.
