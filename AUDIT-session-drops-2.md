# AUDIT — session drops v2 (Territory 3, Pen 4–5, faucet retunes)

A max-effort, four-lens red-team over the surfaces shipped after `AUDIT-session-drops.md`
(which covered Boxing 3–5, Skills 2, Wire 2, World 2–3) and after the Pen step-three/four
audits — i.e. the genuinely un-audited work this session:

- **Territory step three** — per-district racket **TYPE** axis (numbers/protection/smuggling
  income mults) + the **Bureau crackdown** (lazy scrutiny → raid on collect).
- **Pen step four** — the **co-op breakout** (plan/join/leave/execute/stale-sweep).
- **Pen step five** — **prison factions / shot-callers**, the **break rat**, richer yard incidents.
- **The faucet retunes** — protection `scrutinyPerHr` 6→10, boxing NPC exhibition fees.

Four independent lenses ran in parallel; every finding was re-verified against source before
any fix. **No CRITICAL, no HIGH.**

| Lens | Verdict |
|---|---|
| §10.4 ledger integrity | **CLEAN** (all three surfaces reconcile; retunes have zero §10.4 impact) |
| Concurrency / lock order | **CLEAN** (no cycle, no TOCTOU hole, no persist-clobber) |
| Death / estate / PvP | **CLEAN** (no orphan, no double-resolve, no un-killable stack, no stale inheritance) |
| Exploit / grief / balance | no hard exploits; **one LOW-MED design-integrity gap** + balance flags |

---

## Fixed in-commit (regression each)

### F1 (LOW-MED) — the co-op-break self-rat falsified its own "−EV by construction" claim
`executeBreak`'s ratted branch gave the rat an **absolute sentence cut** (`baseJail −
BREAK_RAT_CUT_S`, 1h off). The docs claimed "self-ratting is −EV by construction", which held
only for a *lone* player (a break needs `COOP_MIN` 2 to execute). Against a **Sybil pair** — a
main leader stakes a $50k cutkit, a throwaway alt joins, the main rats its own crew and calls
the go — the ratted branch handed a controlled account **1h off its sentence for a $50k kit
(~14× cheaper than bribing the same hour at `$BRIBE_PER_S`)**. A bounded, kit-sunk, alt-gated
farm, but it undercut the bribe sink and broke the stated invariant.

**Fix (structural, not a number retune):** the rat's deal is now **relief-only** — they dodge
the crew's added stretch (`BREAK_CAUGHT_ADD_S`) and the beating, but serve their **own sentence
unchanged, never less**. So join-and-rat is never better than abstaining → "self-rat is −EV by
construction" now actually holds (a Sybil burns a $50k kit for zero net gain, and gives the alt
a longer stretch + a beating). A **legit saboteur** still benefits: they dodge the failure
penalty the crew eats *and* deny the crew the escape (spite / a planted infiltrator) — a
coherent, non-farmable incentive, and a faithful analog of the heist-rat (who avoids the crew's
double-jail). `BREAK_RAT_CUT_S` retired (it was flagged-not-signed pen-five, never sim'd, so
this overrides no sim-audited number). `test/pen.js` regression: the rat now serves their own
sentence (no cut below it) while still faring better than the honest crew who eat the longer
stretch.

### F2 (LOW) — `ratBreak` missing the `insideOnly` gate
Every other break action gates `insideOnly`; `ratBreak` did not, so a walked-out or hole'd crew
member could still flip the `ratted` flag. Benign in practice (`executeBreak` already rejects a
walked/hole'd crew via `crew_free`/`crew_hole`, so the flag can't affect a real break), fixed
for consistency + defense-in-depth.

---

## Flagged for founder sign-off (NOT patched — ground rule #1)

- **`upgradeRacket` can dodge a pending Bureau raid.** Unlike `collectTerritory` (which resolves
  the raid on the collect touch), `upgradeRacket` collects the pending income at the old rate
  and resets the clock **without** rolling `resolveTerritoryRaid` — so a hot smuggling op can
  upgrade to sidestep the raid. Both the §10.4 and exploit lenses classified this as
  **balance-not-drift** (the pending income collected on upgrade is a legitimately ledgered
  `territory:income` faucet — no §10.4 issue). **The speakeasy audit fixed exactly this class**
  (`upgradeSpeakeasy` resolves the raid first + refuses while shut), so the parity dial is: mirror
  it in `upgradeRacket` (resolve the pending raid before the upgrade, order the fine vs the
  upgrade cost). Left as a sign-off call since it changes territory economics; it's not a *new*
  exploit class (frequent-collect already dodges the raid for protection — see BALANCE B-terr).
- **Frequent-collect fully dodges raid risk while keeping the income mult** (protection collected
  <10h / smuggling <6h never crosses the threshold → 0% realized raid, full ×1.15/×1.35). This is
  the by-design "active collection banks the full mult" tradeoff already in BALANCE.md — a lever,
  not a defect.
- **Flat pen `PROTECTION_COST`** ($15k/2h) is not wealth-scaled like the street safehouse, so a
  jailed whale buys shank/burner immunity cheaply. A cash sink with the can't-attack tradeoff (the
  intended shield); the dial is wealth-scaling it like the safehouse if it bites.
- **`TERRITORY_RAID_P` / `PEN_BREAK_P` / `SHANK_P` env-settable** — the established TEST-ONLY
  posture (documented "never in production"); ops-config responsibility, not a code defect.

---

## Verified sound (no finding)

- **§10.4** — territory `establish`/`income`/`upkeep`/`raid` all reconcile exactly in the treasury
  check; seized pending income is never ledgered (a true seize, not a faucet); the co-op break /
  factions / break-rat move **zero currency** (the cutkit's only ledgered event is `pen:commissary`
  at buy-time); the retunes touch only check-(a)/roll magnitudes.
- **Concurrency** — co-op break lock order (leader → sorted members → break row, one-active-break
  disjoint, the leader-vs-PvP AB-BA correctly mapped to `contention`); `ratBreak`'s flag read is
  transitively protected by the char lock `executeBreak` already holds; `factionCover` is a
  lockless point-in-time read (no cycle edge); `pen_faction` is off the positional persist UPDATE;
  territory's district→gang→racket order is consistent, dissolution is non-overlapping.
- **Death / estate / PvP** — a dead break-leader's plan is abandoned + member rows deleted (no
  `UNIQUE(character_id)` brick); a dead crew member is cleaned + a mid-execute death caught by
  `crew_gone`/`crew_changed`; `factionCover` counts only ALIVE jailed inmates (no dead-man cover);
  the heir inherits no faction/hole/pen state; the shank still honors respawn/penSafe/hole/witpro
  with factions layered on, and the `SHANK_MIN` 0.15 floor keeps the shank always-possible against
  the max 0.34 faction stack (never un-killable); territory seizure transfers with scrutiny reset,
  income forfeited (unledgered), no orphan on dissolution.

**Suite 30/30 + sim drift-0** after the fixes.
