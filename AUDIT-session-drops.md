# AUDIT — session content-drops red-team (Boxing 3–5, Skills 2, Wire 2, World 2–3)

**Scope:** everything shipped in commits `4efb68c..0d090f5` — the Fight Circuit steps 3–5 (main event
parimutuel, cornerman, belt defense, callout), Skills step two (tier-4 capstones + active abilities +
per-skill respec), the Wire step two (bug trace, dossier, spymaster), and the Living World steps 2–3
(war effort, enraged cartels, co-op crew raids, the frontier).

**Method:** four independent red-team lenses in parallel — (1) §10.4 ledger conservation / economy,
(2) concurrency / lock order, (3) death / estate / PvP, (4) gameplay exploit / griefing — each
re-verified against source before any fix, then every confirmed finding re-verified again by hand and
fixed with a regression. Full suite 30/30 + `tools/sim.js` drift-0 after the fixes.

## Verdict: NO CRITICAL / HIGH. Two MED (lock-order), one LOW (row hygiene) — all fixed in-commit.

The core §10.4 surfaces are clean: the new `boxing bet escrow` invariant reconciles exactly
(`posted == wins + refunds + purse + take + death`) across booked / resolved-two-sided /
resolved-one-sided / cancelled states; the co-op raid is §10.4-neutral vs a solo raid (the same bounded
`world:raid` faucet, just split); every capstone/active/respec/wire spend ledgers against a closed
vocabulary. No mint-on-top, no rounding dust minted, no unledgered value across a death boundary.

---

## Fixed in-commit

### F1 (MED) — `fightBout` ↔ `resolveMainEvent` locked two singletons in opposite order
`fightBout` credited `street_tax` (singleton) **before** calling `applyBeltResult` (which locks the
`boxing_title` singleton), while the worker's `resolveMainEvent` locks `boxing_title` first (via
`applyBeltResult`) then `street_tax`. An AB-BA cycle needing **no shared row** — only temporal overlap
between a frequent player fight and the timer-driven resolver. Absorbed by the `40P01 → contention`
retry net (no data loss), but a genuine reversed lock order.
**Fix:** moved `fightBout`'s `street_tax` pool credit to **after** `applyBeltResult`, so both paths lock
`fighters → boxing_title → street_tax` (one canonical order). Behavior-preserving — the rake→pool split
is independent of the belt result; the existing belt-via-`fightBout` test validates it.

### F2 (MED) — `acceptCallout` locked the challenger's fighter under the title-singleton lock
`acceptCallout` (run by the champion, so it holds only the champion's char lock) locked `boxing_title`
first, then locked the **challenger's** fighter row — a row it does not hold the owning char lock for.
`fightBout` locks a fighter then `boxing_title` (via `applyBeltResult`), so a `fightBout` staking that
same still-listed challenger fighter could AB-BA against `acceptCallout`.
**Fix:** `acceptCallout` now reads the title **unlocked** to learn the two fighters, locks them sorted
**before** locking `boxing_title FOR UPDATE`, then re-verifies the callout didn't shift under it (the
`executeHeist` TOCTOU pattern) — restoring `fighters → boxing_title`. A shifted card returns a clean
`contention` for retry.

### LOW-1 — a dead co-op raid leader left orphan crew rows
`abandonRaidsAtDeath` set the leader's planning raid to `abandoned` but never deleted the **other**
crew members' `world_raid_members` rows — and `sweepStaleRaids` only reaps `status='planning'`, so those
rows lingered forever (harmless — no `UNIQUE(character_id)`, filtered by status — but unbounded bloat).
**Fix:** `abandonRaidsAtDeath` now also deletes the stranded crew's member rows (the pen-break death
precedent). Regression: after a mod-kill of a co-op leader mid-plan, the crew rows are gone and the freed
soldier can plan a fresh raid.

---

## Verified CLEAN (no fix)

- **§10.4 across all four systems** — boxing-bet escrow identity exact on every terminal state; the
  house cut mirrors the audited `casino:pvp` pattern (leaves escrow via a NULL-char row, half→pool /
  half burns, the pool isn't a conservation bucket); co-op raid cash credited == cash ledgered per head;
  `cartel_damage`/`boxing_wins`/`intel_ops` are status counters bumped by clobber-safe direct SQL;
  dossier/trace/respec $OMR burns ride closed vocabularies. Vocabulary fully closed.
- **World co-op raid locks** — `characters → member rows (sorted) → raid row → world_npcs` (the
  `executeHeist` twin); re-verifies the crew under lock (`crew_changed`); one-active-raid keeps concurrent
  executes disjoint; the residual leader-vs-PvP 40P01 rides the existing contention retry. `raidNpc`,
  `sweepStaleRaids`, `releaseFrontierHolds`, `abandonRaidsAtDeath` all acyclic.
- **Skills** — `active_at` is written by direct SQL (outside `persistCharacter`) and mirrored in-memory,
  no clobber; `adrenaline`/`moxie`/`hot_wire` mutate persist-carried fields correctly; actives are cap
  SETs (can't exceed cap / stack); per-skill respec is leaf-first on the shared 24h cooldown.
- **Death / estate** — `cancelMainEventsAtDeath` runs before `wipeFighterAtDeath`, mirrors a
  killer-bettor's refund in memory, and serializes vs the resolver (both gate `status='booked'`); the belt
  + callout can't dangle at a dead/deleted fighter; a dead co-op member simply drops from the crew.
- **Gates** — co-op level gate re-checked per member at execute (no alt-drag); rout bonus fires only on
  the floor crossing (solo + co-op); `own_event`, one-bet-per-bettor, betting-past-close, callout
  one-at-a-time / #1-contender-only / no-self, duck→forfeit, booked-form freeze — all hold under re-read.
  Dossier returns a wealth **band**, never exact (the anti-precise-kill-EV rule).
- **`callOutChamp`** (locks only the caller's OWN fighter, protected by the caller's char lock) and
  **`wipeFighterAtDeath`** (serialized behind the dying manager's char lock) — title-before-fighter but
  NOT reachable cycles. **`cancelBout`'s** third-party refund order is the established death-refund
  posture (`voidListingsAtDeath` twin), self-healed by the contention net.

---

## Flagged for founder sign-off (NOT patched — ground rule #1, balance levers)

- **B1 — apex-solo floor.** `raidChance` floors at 0.1, so a min-level whale can solo-raid an apex outfit
  (Volkov def 220) at 10%/attempt for the full `GRAB_MAX` (no split) every 2h — undercutting the
  "too well-defended to solo" framing that motivates co-op. §10.4-bounded by the shared reservoir/regen.
  The dial is the min-clamp or a coop-only gate on `raidNpc` for `fixture.coop` outfits. Sim the apex
  reservoir $/day (this is the same emission flag already recorded for World step three).
- **B2 — exhibition purse.** A maxed stable's exhibition EV is mildly positive (~+$40k/fighter/6h), a
  sustained faucet already flagged in CLAUDE.md/BALANCE.md as sim + sign-off. Self-limits on the training
  investment; wants the sim.
- **L1 (grief, symmetric-cost)** — `announceMainEvent` can perpetually re-book a rival's *listed* fighter
  (30 min each, blocking their other action) at equal cost to the griefer; the target un-lists to stop it.
  Consistent with the consent-by-listing pattern. **L2** — a joined co-op raider who goes un-ready blocks
  the leader's `go` (no kick; disband + re-plan) — identical to the crew-heist/pen-break posture. **B3** —
  the belt's inactivity clock accepts a win over an alt, but the callout mechanic neutralizes true
  contender-dodging, so only the passive strip is defeated. All design-consistent, no reward to the abuser.

Suite 30/30 + sim drift-0; contracts untouched.
