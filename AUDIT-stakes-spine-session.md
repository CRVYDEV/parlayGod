# AUDIT — the stakes/spine session (L1/L2/L3 + the three entry verbs)

A focused red-team over everything built after `omerta-stakes-and-spine-review.md` was written, none of
which had faced an adversarial pass. Every finding below was **re-verified against source** before any
code was touched; nothing was "fixed" on suspicion.

**Scope (9 drops):** L3a THE SACKING · L3b THE SHIELD CAP · L3c THE CONTRACT'S BULLETS · L2a THE DEATH
DUTY · L1a apex front-curve flatten · L1b the progressive pad · D6a THE APPROACH (crime) · D6a step two
THE MESSAGE (jump) + THE PLAY (deal) · #4 THE CITY STANDING.

**Lenses:** (A) §10.4 / economy · (B) concurrency, locks, persist-clobber · (C) death / estate / PvP
correctness · (D) exploit, grief, Sybil.

**Result: no CRITICAL, no HIGH. One MED confirmed and fixed (plus its pre-existing twin). Three items
flagged for founder sign-off, not patched (ground rule #1).** Suite 46/46 + sim drift-0.

---

## CONFIRMED + FIXED

### F1 (MED) — a seized front claims den rakeback on the ENTIRE lifetime volume
**Where:** `social.js:sackEmpire` (this session) **and** `business.js:resetFrontToNewOwner` (pre-existing,
Tier-3 hostile takeover — my sackEmpire copied its reset block).

**The invariant it broke** is stated by the system itself. `buyBusiness` (business.js:129–131):
> *"Den rakeback (casino kind): the cursor starts at TODAY's den volume — a new owner earns against
> future action, not history"*

and CLAUDE.md: *"per-front `rake_cursor` stamped at buy so new owners never claim history"*.

Both **ownership-transfer** sites set `rake_cursor=0` instead. The claim is computed as
`floor(max(0, vol − rake_cursor) × RAKEBACK_BPS / 10000 / owners)` (business.js:163), so a cursor of 0
means the new owner's next `collectBusiness` claims rakeback against **all-time** den volume.

**Failure scenario:** kill (or hostile-takeover) the owner of a `casino` front → collect → claim
`RAKEBACK_BPS` of the den's entire lifetime stake volume in one payout.

**Blast radius — deliberately bounded, which is why this is MED not HIGH:** the econ-pass fix caps every
rakeback at `denAvailable()` (realized profit net of open liability), so it **cannot mint** and there is
**no §10.4 drift** (`casino:rakeback` is ledgered either way). What it does is let a seizure **jump the
queue** on a shared, profit-bounded pool — draining the distributable book at the expense of every honest
casino-front owner, whose claims then "wait for the book to recover".

**Fix:** both sites now stamp the cursor at the current den volume (read in JS, passed as a param — the
pg-mem-safe form), matching `buyBusiness` exactly.
**Regression:** `test/economy.js` seeds a $5M lifetime den volume before the hostile takeover and asserts
the seized front's cursor is `5000000`, not `0`. (Fails on the old code.)

---

## VERIFIED CLEAN (each checked against source, not assumed)

- **L1b the progressive pad is per-owner, not global.** Every `businesses` read in business.js is
  `WHERE character_id=$1`-scoped, and *both* callers of the new `upkeepOwed(row, count)` pass
  `rows.length` (`payBusinessUpkeep`, `businessesOf`). `sov.js`/`territory.js` have their own local
  `upkeepOwed` — untouched. No caller silently defaults to the 1-front rate.
- **L2a death-duty persist coverage is complete.** Five `runEstate` call sites: `fire`, `npcHit`,
  `pen.shank` persist through `withTwoCharacters` → `persistAccount` (which *does* write `omr`, verified
  at game.js:483); the two hand-rolled headless persists (`server.js` mod-kill, `social.js:huntWanted`)
  now carry the `omr` decrement. `worker.js:210` was checked and is a **season conversion, not a death**
  (no `runEstate`) — correctly no duty.
- **L2a ordering.** The duty runs after the P1.1 loot (killer's cut first, then the estate taxes the
  remainder) and `report.kept.omr` reads the post-duty figure. A respawn-token / bodyguard save skips
  `runEstate` entirely → no duty, correct.
- **L3a sack/estate ordering + concurrency.** `sackEmpire` (social.js:1160) runs **before** `runEstate`
  (:1223), so the transferred front survives the `DELETE businesses WHERE character_id=victim` wipe. The
  killer's `killerKinds` read (the `UNIQUE(character_id,kind)` guard) and the victim's front list are both
  taken under `withTwoCharacters`, which holds **both** character rows — no concurrent buy/sell can race
  it. `h.victimOwned.businesses` is filtered so the estate report doesn't double-count the seized front.
  `takeover_cd_until` is deliberately not reset (consistent with the documented takeover behaviour).
- **L3c the ammo rebate can never be net-positive.** `fired` is gated by owned ammo (social.js:1003) and
  fully consumed (:1024); the rebate is `floor(fired × 0.5)`. Net is `−fired + floor(fired/2) < 0` for all
  inputs. No contract-cycling ammo faucet exists.
- **L3b the shield cap.** Standard token bucket (the D3 wash-cap twin), charged **before** the cash spend
  so a capped-out player pays nothing; `safehouse_used`/`safehouse_at` are persisted ($62/$63); the
  `already safe` gate prevents stacking; the whole thing is inside the withCharacter txn so a throw rolls
  back cleanly.
- **§10.4 across all three verb axes.** THE APPROACH's take rides the unchanged `crime:<id>` faucet and its
  crate shift stays fully ledgered; THE MESSAGE scales a **symmetric transfer pair**
  (`jump:steal`/`jump:stolen` both read the same `stolen`, still `JUMP_STEAL_CAP`-bounded — it can move who
  holds cash, never create it); THE PLAY leaves `deal:<drugId>` and the house take untouched. Sim drift-0
  and the 46-suite confirm.
- **`standard` really is the identity** on all three axes (asserted programmatically), so every pre-choice
  code path is byte-identical — which is what makes the sim's signed measurements still valid.

---

## FLAGGED FOR FOUNDER SIGN-OFF (verified real, deliberately NOT patched — ground rule #1)

1. **The death duty spares `unbonding` $OMR (LOW).** The duty taxes `acct.omr` (liquid) only, but the
   sibling P1.1 loot takes liquid **+ unbonding**. So dying inside the 6h unbond window shelters that
   slice from the duty. It's a narrow inconsistency between two mechanics that otherwise share a loot
   surface. Fixing it would *increase* what death costs — a balance change to a signed lever
   (`DEATH_DUTY_RATE` and its base), so it's your call, not mine. One-line change if you want it.
2. **"Jump-to-shield" is 50% more effective (LOW, design-consistent).** The hospital is *protection* in
   this game, so deliberately jumping an ally puts them briefly out of everyone's reach. THE MESSAGE's
   `hospMult` 1.5 extends that blanket from 3 min to 4.5 min. The behaviour pre-existed; the new intent
   makes it modestly better. It also self-limits the attacker (you can't re-hit your own mark sooner).
   Consistent with the signed v24 "hospital = protection" rule — flagging it as a known consequence.
3. **THE MESSAGE's rep is rate-neutral but energy-positive.** Rep ×1.5 with hospital ×1.5 means rep-per-
   *time* against one repeatedly-jumped mark is exactly unchanged (and `rob` is 0.86× — strictly worse).
   But against *many* targets, energy (`JUMP_ENERGY` 25) is the binding constraint, so `message` is a real
   ~1.5× rep-per-energy increase, paid for with +5 law heat per jump. That's the intended trade; noting
   the magnitude so the heat cost can be re-priced if the alpha shows rep inflation.

---

## PROCESS NOTE

`sackEmpire` reproduced F1 because it was written by copying `resetFrontToNewOwner`'s column list rather
than calling it. The two reset blocks are now identical again but still duplicated across
`social.js`/`business.js` — worth collapsing into one exported helper the next time either is touched, so
a future ownership-transfer site can't drift a third time.
