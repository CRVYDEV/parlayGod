# AUDIT — World step five: THE OCCUPATION (NPC-held core districts)

**Date:** 2026-07-21
**Scope:** the World-pillar step-five drop — the 5 apex outfits literally OCCUPY 5 of the 6 signed core
districts (`WORLD.OCCUPATION`), an occupied district is LIBERATED through `seizeDistrict`'s new
`npc_holder` branch at a cost that scales with the occupying outfit's LIVE strength
(`outfitStrengthFrac` / `liberationCost`), the signed district perks stay dormant while occupied
(`holder_gang` NULL), and liberation is the existing `turf:seize:<district>` treasury sink.

**Method:** three independent red-team lenses run in parallel (§10.4 / emission, concurrency / locks,
exploit / grief / balance), every finding re-verified against source before any fix.

## Result — no CRITICAL / HIGH.

### §10.4 / emission — CLEAN
Liberation reuses the EXISTING `turf:seize:<district>` treasury cash sink already in the
gang-treasuries check (b) — **zero invariant change**. An NPC district carries no territory racket, so
the racket-transfer is skipped (no ledger surface). The perk VALUES are untouched (a district held by
NULL `holder_gang` gives no perk, exactly as an unowned district — active the moment a family holds
it). No new faucet, no minted value; the seed is idempotent state, not a transfer.

### Concurrency / locks — CLEAN
`seizeDistrict` locks the district row `FOR UPDATE` first, then the gang; `outfitStrengthFrac` is a
LOCKLESS regened read (a quote, never a write), so it adds no lock edge and no cycle vs a concurrent
raid (which locks the `world_npcs` singleton last). The liberation write is a single
`UPDATE districts` under the held district lock. No AB-BA, no persist-clobber (districts are not
persisted through `persistCharacter`).

### Exploit / grief / balance — two MED consistency fixes, three balance flags.

**E1 (MED) — schema occupation seed re-occupied a liberated-then-dissolved district. FIXED.**
`schema.sql` re-runs on every boot. The seed UPDATEs guarded on
`holder_gang IS NULL AND npc_holder IS NULL AND garrison=0`, but gang dissolution
(`social.js` — `UPDATE districts SET holder_gang=NULL, garrison=0`) leaves `seized_at` set and does
NOT touch `npc_holder`. A district that had been liberated (so `seized_at` set, `npc_holder` NULL)
then went unowned via dissolution matched the seed guard on a subsequent boot → the outfit RE-OCCUPIED
a district the players had already fought the World loop to liberate (and any live player garrison a
later reseize set would read as freshly occupied). **Fix:** all five seed UPDATEs now also require
`AND seized_at IS NULL`, so a district that has ever been fought over stays in player-controllable
state forever; only a pristine, never-touched district is occupied. Regression: run the exact seed
UPDATE against a liberated-then-dissolved district (seized_at set) and assert `npc_holder` stays NULL.

**E2 (MED) — the liberation branch was missing the outfit level gate. FIXED.**
The founder-directed frontier B1 fix established "you can only HOLD turf you could RAID" —
`invadeOutpost` gates `levelOf(ch.respect) < fixture.minLvl`. The core-district liberation branch
(the same conquest, one layer down) had no such gate, so a rookie boss could free-ride other families'
rout of an apex outfit (e.g. Volkov beaten down to the floor) and liberate its APEX core district
(neon, Kryl's canal, Moreau's foundry) for the $30k `OCCUPY_MIN` floor — turf they could never raid
themselves. **Fix:** the `if (occupied)` branch now throws `level` when
`levelOf(ch.respect) < fixture.minLvl`, mirroring the B1 precedent exactly. A liberation is now gated
by the same raid level as the outfit that holds it. Regression: a level-11 boss (Rocco) cannot
liberate canal (Kryl, minLvl 20) → `400`, even beaten-down.

## Balance flags — NOT patched (founder sign-off, ground rule #1; already noted in CLAUDE.md/BALANCE.md)
1. **The on-ramp shift** — 5/6 core districts start NPC-held, so a fresh family's old cheap free-seize
   is now a small liberation (the weak outfits' districts, docks $45k–brick $120k, are a soft on-ramp
   that teaches the World loop; cathedral stays free). Perk VALUES unchanged; `OCCUPATION` /
   `OCCUPY_BPS` / `OCCUPY_MIN` + the mapping are all sim sign-off levers.
2. **Garrison ratchet (carried from frontier B2)** — a liberated core district's garrison becomes the
   new player defense budget; no decay/cooldown on the player-vs-player reseize path. A pure sink,
   rout-resettable via the World loop, never permanent — a garrison-decay or reseize-cooldown is the
   dial if the snowball bites.
3. **Apex solo-raid floor (carried, World-wide)** — the 0.1 min-clamp on raid odds lets a min-level
   whale solo an apex outfit for the full un-split grab; the dial is the clamp or a coop-only
   `raidNpc` gate for `fixture.coop`. This bounds how fast an apex outfit (hence its core district)
   can be driven to the liberation floor.

## Verdict
The occupation layer is §10.4-clean, deadlock-free, and — after E1/E2 — consistent with the
founder-endorsed frontier conquest gates. Suite 30/30 + sim drift-0.
