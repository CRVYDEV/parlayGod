# AUDIT — World step four (THE FRONTIER MADE REAL)

A focused three-lens red-team over the just-shipped World step four (the status frontier turned into
productive + contestable turf): the `world:tribute` faucet, the `world:invade` sink, the rout-installs-
garrison/tribute logic, and `invadeOutpost`/`collectFrontier`. Each lens re-verified against source.

| Lens | Verdict |
|---|---|
| §10.4 ledger + emission | **CLEAN** — no drift, `world:tribute` is a bounded/reservoir-independent/un-gameable faucet, `world:invade` a pure treasury sink |
| Concurrency / lock order | **CLEAN** — no cycle, no lost update, no persist-clobber; mirrors exact |
| Exploit / grief | essentially clean — **one LOW** (fixed) + three balance flags |

**No CRITICAL, no HIGH, no MED.**

---

## Fixed in-commit (regression added)

### F1 (LOW) — `collectFrontier` was missing the SIGNED D2 "shield, not bunker" safehouse gate
Its sibling `collectTerritory` (`territory.js:132`) blocks collection while safehoused — the SIGNED D2 rule
(BALANCE.md: "bank deposits, business collection, and territory collection are now EXPOSED acts" blocked
while safe). `collectFrontier` is a NEW productive-income collect that should be under D2 but shipped
without the gate, so a boss/member could bank frontier tribute from inside a safehouse (untargetable). Value
was bounded (the 24h cap; treasury tribute, not $OMR extraction), but it's a genuine hole in a signed
anti-abuse bound. **Fix:** added `if (safeHoused(ch)) throw 'safe'` to `collectFrontier`, matching
`collectTerritory` verbatim (a correctness fix to comply with the signed rule, not a new balance decision).
`test/world.js` regression: a safehoused member is refused (`safe`); once they surface the tribute is still
there to collect.

---

## Flagged for founder sign-off (NOT patched — ground rule #1)

- **B1 — `invadeOutpost` had no level gate — FIXED (founder-directed follow-up).** Routing an outfit is
  `minLvl`-gated (Volkov = lvl 55 + a co-op crew), but invasion originally let a low-level boss with a
  $50k treasury hold an apex outpost. Now `invadeOutpost` gates `levelOf(ch.respect) < fixture.minLvl`
  (you can only HOLD turf you could RAID) — a consistency fix mirroring the rout gate; regression added
  (a lvl-10 boss can't invade kryl/lvl-20). The "economic conquest" alternative was declined for
  consistency.
- **B2 — the garrison ratchet has no decay and no invade cooldown.** Each invasion sets `garrison = cost =
  max($50k, prev×1.5)`, so successive invasions ratchet the garrison up 1.5× (25k → 50k → 75k → 112k →
  168k → …), exponentially pricing out further invasions. It's a pure treasury SINK (no extraction) and
  ROUT-RESETTABLE (routing installs the flat `ROUT_GARRISON` 25k), so it's never permanent for a family
  that can rout the outfit — but for a sub-apex family vs an apex outpost it can become a stuck-high,
  effectively-invade-locked state. Feature (an escalating war chest) or annoyance — founder call (a
  garrison decay-over-time or an invade cooldown is the dial).
- **B3 (noted, not a defect) — no jailed gate on invade,** consistent with other treasury ops
  (`collectTerritory` also gates only safehouse, not jail). Left as-is for consistency.
- **Emission magnitude** — `world:tribute` is a NEW faucet (~$157k/day base-wide ceiling across all 5
  outfits, one holder each, regen-metered + 24h-capped + rout-gated). §10.4-clean; the magnitude is the
  standing founder sim sign-off lever (BALANCE.md addendum).

---

## Verified sound (no finding)

- **§10.4** — collectFrontier's treasury +total == the ledgered `world:tribute` +total (added to the
  gang-treasuries IN terms); invadeOutpost's −cost == the ledgered `world:invade` −cost (OUT terms); both
  character_id NULL so excluded from the per-character check (a); `world:` is in the cash vocabulary.
  `frontierTribute` returns 0 for a null clock, clamps negative elapsed, and the 24h `Math.min` binds —
  collect-spam yields ~0; tribute is never drawn from the shared reservoir; every flag transfer
  (rout/invade/dissolution) resets `tribute_at` so no new holder inherits stale accrual and uncollected
  tribute is forfeited (never ledgered), never double-paid.
- **Concurrency** — every path obeys characters → accounts → gangs → rows → singletons with `world_npcs`
  locked last; collectFrontier's multi-row lock is disjoint-by-`held_by_gang` and gang-serialized;
  invadeOutpost's not-locking-the-incumbent-gang is safe (never writes their treasury) and two rivals
  serialize on the row with an EvalPlanQual re-read that outbids the fresh garrison; releaseFrontierHolds vs
  invade is acyclic (neither wants the other's gang); the in-memory treasury mirrors match the locked SQL.

**Suite 30/30 + sim drift-0** after the fix.
