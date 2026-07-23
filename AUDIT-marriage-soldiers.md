# AUDIT — Marriages & the Consigliere + Named Soldiers (founder picks #2+#3)

A two-lens max-effort red-team over the two content drops (`omerta-marriage-soldiers-design.md`;
`src/dynasty.js`, `src/soldiers.js`, assist helpers in `game.js`, touchpoints in
`growth.js`/`world.js`/`social.js`). Each lens ran independently against actual source; every
reported finding re-verified before any fix. **Result: no CRITICAL, no HIGH. Two MEDs (both
concurrency, both in the marriage flow) + one economy flag + LOWs — all confirmed items fixed
in-commit with regressions. §10.4 verified EXACT on every path by the dedicated lens.**
Suite green + sim drift-0 after all fixes.

## Lens A — §10.4 + concurrency/locks/persist: §10.4 CLEAN, 2 MED (fixed)
- **§10.4 exact**: exactly four ledger sites, all negative, all character_id'd
  (`dynasty:ceremony` ×2, `dynasty:consigliere`, `soldier:hire`); the crime cut is a verified
  pre-ledger shave (`take -= cut` before both the credit and the row — ledgered == credited, the
  faucet strictly shrinks); `soldierResult` moves no currency; the non-refund posture (withdrawn
  proposals / unaccepted consigliere offers stay sunk) has zero §10.4 impact. Vocabulary closed.
- **MED-A1 (FIXED) — bigamy race**: monogamy was enforced by UNLOCKED reads; two acceptors hold
  disjoint char locks, so X-proposes-to-P-and-Q + concurrent accepts committed TWO accepted
  marriages for X (distinct pair rows — no row conflict), falsifying the documented invariant
  (nondeterministic `marriageOf`, a hidden second marriage after divorce, double scandal
  deterrent). **Fix:** `lockMarriageRows` — a deterministic `ORDER BY … FOR UPDATE` read of every
  marriage row touching either account, evaluated as the source of truth in propose AND accept;
  concurrent accepts sharing a party now contend on the shared rows and serialize (EvalPlanQual
  re-read → the loser throws `taken`). Residual cross-pair 40P01 maps to the standard `contention`
  retry.
- **MED-A2 (FIXED) — accept vs withdraw race**: neither side locked the pair row and the accept
  UPDATE never checked rowCount — a withdraw racing an accept could leave the acceptor $25k paid
  + vendettas cleared for a marriage that doesn't exist, or a sealed marriage silently unwound as
  a free "withdrawal" (no divorce honor). **Fix:** both paths now lock the pair row
  (`lockMarriageRows` / the divorce `FOR UPDATE` read), the accept UPDATE is `… AND NOT accepted`
  with a rowCount assert (a 0-row update rolls the debit + ledger + vendetta-clears back cleanly).
- Verified CLEAN: lock posture (single-party withCharacter everywhere, leaf-row writes only, no
  AB-BA into the canonical chain), `checkScandal` race-safety (both spouses' char rows held at
  every killerCh site; single-entry runEstate; no double honor hit), `bumpHonor` under the held
  lock (honor not in the persist positional list), absolute soldier writes (pg-mem discipline),
  estate/dispositions (soldiers wiped + classified; dynasty tables account-keyed, survive).

## Lens B — exploit/grief/death + gate matrix: 1 MED (fixed), LOWs
- **MED-B1 (FIXED) — the divorce-first scandal dodge**: divorce was instant, ungated, and left NO
  record, so any premeditated in-law kill paid −10 (divorce) instead of −30 (scandal) via a free
  action one step before the trigger. **Fix:** a `dynasty_divorces` tombstone (upserted on every
  accepted-marriage split, including a scandal dissolve) + `MARRIAGE.SCANDAL_GRACE_MS` (48h, a
  sign-off lever): a kill within the window of divorcing that same house STILL fires the full
  scandal, and the same pair can't RE-marry inside the window (`cooling`) — which also slows the
  marry/divorce vendetta-laundering cycle Lens B measured (already consent-bounded + Mad-Dog
  self-terminating; the pre-positioned-proposal instant clear is now blocked by the same window).
- **Economy flag (FIXED) — the safecracker was the one pure-upside trait**: The Score always
  succeeds, so an assigned safecracker took zero risk, paid zero cut, and compressed the heist
  cadence ×0.715 at lvl 10 (≈ +40% on the `heist` faucet for a one-time $25k). **Fix:** every
  assisted Score now pays the same `CUT_BPS` 5% pre-ledger shave as crime (the faucet shrinks —
  §10.4-safe; assignment is a real tradeoff). Magnitudes (safecracker cadence, gunner +20→38
  raid power) remain BALANCE.md sim sign-off levers.
- **LOW (FIXED) — `endConsigliere` shotgun**: one call dropped the actor's own adviser AND every
  advising post they held. Now scoped by role (`?role=house|adviser`, default house-then-adviser);
  the console's "walk away" passes `role=adviser`.
- **LOW (FIXED) — silent withdrawal**: declining/withdrawing a pending proposal now notifies the
  counterparty (`marriage_withdrawn`) — the $25k stays sunk by design, but the proposer hears.
- Verified CLEAN: estate/death completeness (soldiers wiped + DISPOSITION'd; memorial rows never
  block roster slots; dynasty tables survive with null-steward rendering, no crash; no proposing
  to a corpse), proposal spam (cost-bounded, one row per pair), consigliere accept (already an
  atomic conditional UPDATE), wheelman NOT dominant (pays 5% on every success for a fail-only
  benefit), the wheelman jail floor (~54% cut stacked with getaway+rank — softened, not trivial;
  sign-off note), dismiss+rehire trait gacha (a $25k/pull cash sink — noted, fine).

### Accepted / flagged (NOT patched — ground rule #1)
- **Mad Dog can name/accept a consigliere** — arguably flavor (a mad dog with a respected
  adviser); flagged as a founder call, unlike marriage/diplomacy where the lockout is load-bearing.
- **Wheelman jail-floor stack** (~0.46× with getaway skill + rank) and the **gunner raid-power
  magnitude** — sim + BALANCE.md sign-off levers, not defects.
- **`divorceMarriage` with multiple pending inbound offers** withdraws an arbitrary one (LIMIT 1,
  accepted-first) — a UX nicety (a pair-targeted variant), not a defect.

## Regressions added (test/dynasty.js)
- The grace-window scandal fires post-divorce (full −30, `graced: true`) — MED-B1.
- The same pair can't re-marry while the ink is wet (`cooling`) — MED-B1.
- Every assisted Score pays the cut (`soldier.cut > 0`) — the safecracker fix.
- The scoped adviser resignation (`?role=adviser`) — the LOW fix.
- (MED-A1/A2 are lock-discipline changes exercised by the whole existing flow; pg-mem can't drive
  true concurrent transactions, so their guarantee is the FOR-UPDATE discipline itself, verified
  by inspection + the unchanged-behavior suite.)
