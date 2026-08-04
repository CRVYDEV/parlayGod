# AUDIT — THE STREET WAR + STREET LIFE + the Bureau's return + the resident economy (2026-08-04)

A max-effort red-team over the largest cash-touching batch shipped without a consolidated adversarial
pass: **THE STREET WAR** (steps 1–3 — rob-a-front, THE TAKE, car/boat/trunk theft, sabotage, THE
RIVALS LEDGER, revenge), **Street Life** (the corner, the black book, THE CALL, THE FAVOR), **the
Bureau's return** (income-sourced front scrutiny + raids), and **the resident economy** (marks, NPC
families, THE HIRED HAND, turnover). The Blood War / Manhunt / Conquest got their own pass
(`AUDIT-blood-war.md`); this covers the batch underneath them.

Four independent lenses in parallel — **§10.4/faucet-conservation**, **concurrency/locks/persist-
clobber**, **death/estate/retirement/dissolution**, and **exploit/grief/Sybil/info-leak** — every
candidate finding re-verified against source before any fix, a regression + a named-assertion mutation
per fix.

## Result: no CRITICAL, no HIGH. Two confirmed fixes (one MED-class, one MED), the rest clean.

### Lens A — §10.4 / faucet conservation — CLEAN
Every transfer nets zero and every reason is correctly bucketed. Verified: THE TAKE (`crime:take` two
legs net zero, the `cash >= want` guard forbids overdraw, the faucet pays the whole take on a broke
mark); rob/shakedown/inside redirects are emission-neutral because the clock-advance uses the *same*
`effRate` the cut used (confirmed `accrued()` caps at the same `BUSINESS_CAP_MS` as the redirect); the
Bureau raid seizes pending un-ledgered + fines a char_id'd `business:raid` sink; THE FAVOR's escrow
identity (`posted − paid − takes − refunded − death − loot`) holds on every path with the 2% take
carved FROM the pay, never minted on top (and `runFavor` runs under `withCharacter`, so the runner's
in-memory credit persists); THE CALL nets zero, recycle-only from the contact's own pocket; the corner
faucet folds its chain bonus into the one claim row so `MAX_DAY` bounds it; `npc:seed`/`npc:retire`
reconcile with matched deltas; `foundNpcFamily` spends the founder's own seed cash. Every new reason
(`crime:take`, `business:rob/shakedown/raid`, `favor:*`, `contact:*`, `corner:job`, `npc:*`,
`family:*`) is vocabularied in the correct term.

### Lens B — concurrency / locks / persist-clobber — CLEAN
No lock-order inversion, no lost update, no persist-clobber, no SAVEPOINT-context trap, no non-
idempotent worker race. Confirmed the earlier F1–F5 fixes hold: THE TAKE's debit is an atomic
`cash = cash - $n WHERE cash >= $n` behind `FOR UPDATE SKIP LOCKED` (never blocks → can't join a
cycle); the street-war shield/loot columns (`car_stolen_at`, `trunk_robbed_at`, `sabotaged_at`,
`contraband`, `heist_loot`) are direct-SQL and absent from `persistCharacter`'s positional list;
`recordRival`/`recordContact` use the per-call SAVEPOINT probe (records in both DB contexts/orders);
`runFavor`'s poster-cargo write is an atomic `qty = qty + $n`; `foundNpcFamily` re-reads the founder
`FOR UPDATE` before the absolute writeback (so a concurrent crime-TAKE debit can't be clobbered);
`runPopulation` holds a session advisory lock. One LOW note only — flagged for re-check if a *future*
loan-settle path is ever changed to skip the two-party lock; nothing wrong today.

### Lens D — exploit / grief / Sybil / info-leak — one MED (D1, fixed)
THE TAKE draws marks `WHERE alive AND is_npc` and re-asserts `is_npc` in the debit — a real player can
never be silently robbed. Property crimes correctly split (on-the-back `robTrunk` gates the victim's
unreachable states via `assertStreetCrime`; garage/stable property crimes deliberately don't).
`rivalsBoard` leaks no UUID / no exact wealth. Every roll knob preflight-classified TEST_ONLY.
`declareWar` throws `npc` on an NPC-run family (no fixed-price standing farm). THE FAVOR post is
safehouse-blocked + district-pinned + trunk-capped, self-favor strictly lossy. Corner pools hold no
gang-gated kind (no masking-class uncompletable card). The hired hand's cut is forfeit. **One finding:**

**D1 (MED, info-leak — the AUDIT-street-life HIGH-1 class) — FIXED.** `payHush` (the secret-extortion
pay path, `server.js`) ran under `withTwoCharacters` *without* `{ meet: false }`. The extortion
mechanic keeps the holder **anonymous to the mark** (dig via the wire, extort with no name; the sibling
`exposeSecret` explicitly carries `meet:false`). But paying the hush fired the mutual `recordMeeting`,
writing the extorter's living-street id into the **mark's black book** (account-keyed → survives death)
— so the mark could then identify and retaliate against a source whose anonymity was the entire point.
Fixed: `{ meet: false }` on the pay route, parity with `exposeSecret`. Regression in `test/intrigue.js`
(after a hush payment the mark's book contains no `contacts` edge to the holder); mutation-verified by
name.

### Lens C — death / estate / retirement — one MED-class (F1/F2/F4, fixed)
**The class:** `runEstate` (a killed resident/player) and `retireResident` (a *walked* resident)
diverged — `retireResident` cleaned up the rows the resident **owned** but not the rows **other
players/families created about it**. This is the recurring "retiring resident strands a row" family
(the step-two stranded loan, the phantom belt).

- **F1 (MED)** — a resident lists itself as a bodyguard (`residentAct` sets `guard_price`) and
  `hireBodyguard` has no `is_npc` guard, so a player can hire a resident guard (`ch.guarded_by =
  residentId`). On retirement `guarded_by` was never cleared → the player was **paid, unprotected, AND
  locked out of hiring a replacement** for the rest of the window (`hireBodyguard` throws `guarded`) —
  byte-for-byte the F8 bug `runEstate` documents and fixes.
- **F2 (LOW-MED)** — a wiretap/watch/informant pointed at the retiring resident kept consuming the
  watcher's `TAP_MAX` slot (and burning $OMR on informant renewal) until the `sweepWire` expiry.
- **F4 (LOW)** — `searches`, `secrets`, `npc_hits`, `family_aggro` target-side rows leaked until their
  sweeps (row-hygiene).

**Fixed** by extracting the "rows others pointed at this character" cleanup from `runEstate` into one
shared helper `clearInboundPointers(client, charId, accountId)` (guarded_by release, wiretaps/watches/
informants, family_aggro, searches, secrets, npc_hits) — called by **both** `runEstate` (replacing its
inline copies) and `retireResident` — so the retirement path can't drift from the death path again (the
one-core discipline). The refactor is behavior-preserving (the full death-heavy suite — social/law/wire/
pen/boxing/casino — passes unchanged). Regression in `test/population.js` (a retiring resident that was
hired as a guard + tapped → the principal is released and the tap slot freed); mutation-verified by name.

**F3 (bounties) — ACCEPTED, not fixed.** A bounty a player escrowed on a resident survives the
resident's retirement — but `postBounty` always sets `expires_at`, and `sweepExpiredBounties` refunds a
gone target's pot regardless of aliveness, so the escrow **self-heals at expiry (a refund) and stays
§10.4-exact**. Sharing `runEstate`'s death-*burn* would be *wrong* here — it would torch the funder's
stake for a target that merely walked away; refund-at-expiry is the fairer outcome. Documented in the
helper's own comment (deliberately excludes bounty escrow).

## Verified sound (recorded, not assumed)
- **THE TAKE** cannot rob a player (NPC-only draw + debit), cannot overdraw (`cash >= want` guard),
  cannot deadlock (non-blocking `SKIP LOCKED` debit), and is a §10.4 transfer that only ever *shrinks*
  crime's contribution to supply.
- **THE FAVOR** escrow identity holds on cancel/expiry/death-loot; post is safehouse-blocked (loot-
  proof-vault rule); the handoff is district-pinned (no teleport past the convoy game).
- **The Bureau raid** is emission-neutral (redirect clock-advance) with the raid fine a char_id'd sink;
  income-sourced scrutiny is a `businesses`-row column under the row lock.
- **Resident economy** — marks/families/turnover recycle held value only, `npc:seed`/`npc:retire`
  reconcile, `foundNpcFamily` re-reads under lock, `declareWar` can't farm an NPC family.
- **NPC-family dissolution + succession** ledgers `gang:dissolved`, releases turf/holds, and re-derives
  `npc_flag` from the new chair both directions.

## Levers / §10.4
No lever moved. §10.4 is untouched by both fixes (the D1 meeting grant and the C helper move no value —
the helper's SQL is byte-identical to `runEstate`'s former inline statements). Suite green + sim drift-0
+ pgquery + pgcheck 43/43 on real Postgres.
