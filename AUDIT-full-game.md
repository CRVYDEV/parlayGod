# OMERTÀ — Full Game Audit (code · economy · loops · new-player)

Four parallel auditors (each source-verifying, file:line-cited): a code red-team over the
newest paths (M7 Phase 4 remainder + all M8 drops), a quantitative economy pass, a loop-
coherence / risk-reward pass, and a new-player-experience pass. This document records what was
**fixed in-commit** (code-correctness only) and what is **flagged for founder sign-off**
(every balance/design lever — ground rule #1: numbers are never retuned silently).

Headline verdict on the founder's three questions is in §4.

---

## 1. Fixed in this pass (code correctness, no balance change)

All behavior-preserving; full suite 8/8 green after each.

- **Lock-order inversion in `postFamilyContract`** (deadlock). It locked the gang row before the
  pot; every other pot path (cancel, expiry sweep) locks pot → gang, so a repost could AB-BA
  deadlock a concurrent cancel/sweep under real Postgres. Reordered to pot → gang.
  (`social.js`, red-team F1.)
- **Unsorted two-gang score updates** in the `fire` war-kill branch (and the pre-existing
  identical pattern in `jump`). Two "my-gang-first" UPDATEs acquire rows unsorted → a
  simultaneous cross-kill between two warring families deadlocks. Collapsed each to one
  `UPDATE … WHERE id IN (…)` with CASE, which locks both rows in one plan-stable order.
  (`social.js`, red-team F2.)
- **Buyback worker locked the `street_tax` singleton before gangs**, inverting
  `bumpFamilyTask`'s gang → singleton order (the global order is characters → accounts →
  gangs → singletons). A family finishing its weekly contract at the same moment as a buyback
  tick could deadlock. Reordered: cheap unlocked due-check, then lock the payout gangs (sorted
  id), then re-read `street_tax` authoritatively under lock. Identical results; deadlock-safe.
  (`worker.js`, red-team F3.)
- **`offerBodyguard` accepted `Infinity`/`NaN`** (via a JSON string `"Infinity"` → `Number()` →
  a NUMERIC-write 500). Added a `Number.isFinite` guard → clean 400. Regression added.
  (`social.js`, red-team F9.)
- **Bodyguard market was undiscoverable** — guards can list a price but `GET /v1/streets` never
  surfaced it, so the entire earnable-defense feature was unreachable without an out-of-band id.
  Added `guardPrice` to the streets board. Regression added. (`server.js`, new-player F2 +
  red-team F10.)

**Verified clean (no action):** the §10.4 ledger discipline holds across every new reason —
`gang:contract`/`:take`, NULL-character `bounty:refund`, `death:bounty` burns, `vanity:*`,
`intel:*`, `respec`, `gang:tribute` all reconcile in `invariants.js` (walked end-to-end,
including gang-dissolves-mid-contract and boss-dies-with-contract-open). No clobber bugs in the
new code (the `skipId`/`killerCh`/relative-UPDATE discipline is applied at every party-row
credit). Anon-fee rollback, respec conservation, peek-charges-only-when-pots-exist, bodyguard/
respawn-token/safehouse ordering, self-hire and dead-guard blocks, idempotency replay — all
verified sound. Swap dust and exchange take-clamp holes confirmed closed.

---

## 2. Flagged for founder sign-off — CORRECTNESS-ADJACENT (design calls, no §10.4 leak)

These move no un-conserved value (the ledger stays exact) but are governance/fairness gaps a
malicious player could exploit. Fix shape is a design decision, so they are **not** patched.

- **F-A · Family-contract laundering (MED, flagged by two independent auditors).** A family
  contract's funder-lockout only blocks *current* members (`bounty_contributors` contributor =
  gang id, checked against the killer's *present* `gangId`). Two bypasses: (1) a member calls
  `/gangs/leave`, kills the mark, collects the family's pot, rejoins (joining is immediate); (2)
  the boss posts a cheap `hospitalize` contract and a colluding **outside alt** collects it on
  one jump. Either routes communal treasury money into a chosen personal wallet — something no
  prior treasury sink allowed (war/seize only *burn*). Value is conserved; the "no member
  collects" guarantee is not. **Recommended fix (your call on shape):** snapshot the funding
  gang's member ids at post time and lock them all out for the pot's life, **or** a short
  leave→collect cooldown on family-funded pots, **or** boss-approval on payout. All three need a
  number or a schema addition — hence sign-off.

- **F-B · One guard, many principals — stale "protected" view (LOW).** A guard can be hired by
  unlimited principals; the first absorbed bullet hospitalizes the guard and silently leaves
  every other principal unprotected while their `view()` still shows `guardedBy` active. No
  exploit (each paid up front, "saved or not"), but the UI would mislead. Consider capping a
  guard to one active principal, or surfacing the guard's availability.

---

## 3. Flagged for founder sign-off — BALANCE (the sim-audited numbers)

Every item here is a lever, not a bug. Ordered by impact on game health. Cross-referenced where
more than one auditor raised it.

- **B1 · Staking 14% APY is the only unbounded $OMR mint and out-runs every sink (HIGH).**
  Missions cap at 220 $OMR/account lifetime; all other "mints" (swap, referral, daily, weekly)
  are bucket *transfers*. Genesis is 20,000 $OMR. Staking is the sole perpetual mint, and the
  entire M8 sink catalog is near-entirely *one-time* (~32 $OMR personal + a 2,300 $OMR gang-seal
  ladder). Arithmetic: `0.14 × TVL` annual mint overwhelms the one-time sinks at any sustained
  staked balance above a few thousand tokens. Net $OMR supply grows; in-game purchasing power
  erodes over a season. Containment is sound (withdrawals gated on team tranche funding, so
  inflation surfaces as AMM price decay + a withdrawal queue, **not** a team liability) — but the
  APY itself wants a decision. *(Already your standing #1 item; this quantifies why.)*

- **B2 · Bank interest ~4%/day, risk-free, is the best risk-adjusted return (HIGH).**
  `BANK_RATE 0.02`/12h is capped only *per-accrual* at 8h offline — with **no daily token bucket**
  like rackets have. A continuously-active player compounds on full wall-clock time (~4%/day ≈
  1,400%/yr); an offline returner is capped at ~1.33%/return. Death takes bank and cash equally,
  so banking is pure upside vs holding jumpable cash. **Recommended:** mirror the racket
  `credit_ms` daily bucket, or an offline-only / capped-principal model. *(Standing item; confirmed
  dominant.)*

- **B3 · Cheap defenses neuter the lethal PvP economy (HIGH).** Safehouse ($25k / 4h) grants total
  fire+NPC-hit immunity **while you keep earning** (no action restriction), and bodyguard (floor
  $1k / 24h) absorbs a hit for a tenth of that. A wealthy target is effectively unkillable for
  ~$150k/day — trivial against 4%/day bank interest. **Recommended:** make the safehouse a *shield,
  not a bunker* (restrict offensive/earning actions while active) and/or raise costs; move the
  bodyguard floor toward safehouse parity or make the guard's absorbed-hit cost heavier.

- **B4 · The kill economy has no on-ramp and no intrinsic reward (HIGH).** `chop = 40% of the
  victim's REAL fleet`, but most players garage nothing (cars melted/fenced on sight), so chop ≈ $0;
  bounties are the only cash and they're someone else's money, posting one is −EV. So a rational
  earner never initiates a kill, and nothing routes players into the whole M7 layer. This is the
  single highest-leverage fix for the "Risk-to-Earn" feel. **Recommended (design):** give a kill a
  loot component that isn't fleet-dependent (e.g. a fraction of the victim's *pocket* cash), and/or
  make bounty-posting cheaper so contracts actually flow.

- **B5 · Endgame crime saturates at the 0.97 success cap (MED).** Stat/gang/turf/rank bonuses lift a
  built veteran's success on 0.10-base top crimes back to the ceiling, so the risk designed into the
  high tiers never materializes for its intended audience (~$9M/hr at trivial risk). **Recommended:**
  review whether additive bonuses should cap lower on high-tier jobs.

- **B6 · Bureau raid is too soft to price kitchen risk (MED).** Even a near-certain raid keeps
  30–60% of stash + a 60–120s jail + heat −40, and is fully dodgeable online (laylow/cleanpapers).
  Heat is a speed-bump, not a threat. **Recommended:** steeper stash loss or a real jail stint if
  kitchen risk should bite.

- **B7 · Dead-end pools: `omr_reserve` and `ammo_bank` (MED).** The family $OMR reserve (buyback +
  tribute) spends only on cosmetic seals; the gang `ammo_bank` (25% of every melt) is never spendable
  at all — only burned on dissolution. Players are routed *into* both pools with almost no route out.
  **Recommended:** a reserve-funded family utility (war financing, member ammo draw) so the tithe and
  the pooling have a payoff.

- **B8 · Turf + cross-district goods arbitrage (MED, known/open).** Deterministic per-district prices
  with 0.6–1.6× hash spreads let a cargo run net ~$380k minus the 4% take + travel; turf holders get
  an extra 0.95/1.05 edge. A clean recurring faucet, cargo-capped. *(Previously flagged/accepted.)*

- **B9 · War window 30 min makes wars a coordination sprint (LOW).** With fire-kills now worth 3 war
  points the lethal layer *can* decide wars — but only if a group is online in the same half hour. A
  longer window would let the kill layer matter to war outcomes. *(Tied to the open §9 duration call.)*

- **B10 · New-player onboarding gaps (MED/LOW, retention).**
  - *No action/catalog discovery in the API (MED).* Crimes, missions, guns, cars, rackets, kitchens,
    NPC-hitmen, vanity, seals all require the client to ship `rules.js` knowledge — a pure-API player
    or **AI agent** is blind to what exists. Recommend a read-only `GET /v1/catalog`. (Low risk; data is
    already public.)
  - *Flat, content-thin levels 1–5 (MED).* Path/family/rackets/kitchen all gate at level 3–5, so the
    opening is crime+train+heist+boost only. Consider a "next unlock at level N" hint in `/v1/me` and/or
    a cheap sub-level-3 racket.
  - *No jump level-floor (MED, UNCERTAIN if intended).* Rookies are immune to NPC-hits and worthless to
    farm for rep (both floored at level 5), and jumps are non-lethal + banking-defeated — so grief risk
    is low-moderate annoyance — but a griefer *can* skim a rookie's pocket cash every 3 min. Consider a
    short new-player jump-immunity window or a level-floor on the hospitalize-bounty payout.
  - *Positive:* the minute-one funnel (3 calls to first reward, instant pool regen) and the mint deferral
    (free trial plays the *entire* game; 0.01 ETH is required only to extract) are the strongest parts of
    onboarding — no change needed.

- **B11 · Housekeeping (LOW).** `KILL_HOSP_MS` (rules.js) is defined but unread — a kill runs the estate,
  not a hospital stay. Harmless dead constant; note for a future cleanup.

---

## 4. The founder's three questions — straight answers

**Is the game coherent, fun, and understandable?**
*Coherent — mostly yes.* The cash economy circulates cleanly, every value movement is ledgered, and
the §10.4 conservation holds under audit. Two pools dead-end (`omr_reserve`, `ammo_bank`, B7) and the
kill economy has no on-ramp (B4). *Fun/tension — uneven.* The kitchen (heat management) and wars have
genuine dilemmas; crime and rackets are low-risk clicking; PvP tension is deflated by cheap defense
(B3). *Understandable — for a human with a good client, yes; for a blind API client or agent, no* (B10:
nothing enumerates what actions exist). Error messages are mostly strong (they tell you the fix and the
number).

**Is the barrier to entry low enough?**
**Yes — this is a genuine strength.** Three API calls (~2 s) to first reward; energy/nerve refill in
under a minute so they barely gate anything; and the 0.01 ETH mint is required *only to withdraw value*
— a free-trial player plays the entire game, PvP and all. The real gaps are *discovery* (B10), not cost:
the opening levels are content-thin, and several shipped systems (the bodyguard market — now fixed — plus
NPC-hitman/vanity/seal catalogs) are hard to find from the API alone.

**Does it have a Risk-to-Earn feel — can a player who plays correctly generate a living?**
**Two separate answers, because "earn" and "extract" are different things here.**
- *In-game earning:* Yes, comfortably — cash is abundant (faucet:sink 48–70×), and a mid-game player
  clears ~$230k/day, a veteran far more. But it is **not** Risk-to-Earn today: the **highest earn is the
  lowest risk** (bank interest, rackets, kitchen-with-crew are all passive/safe), and the intended apex
  risk — killing and being killed — is both unrewarding to initiate (B4) and cheaply nullified (B3). The
  tension the design wants is muted because playing *safe* is playing *optimal*.
- *Real extraction (a "living" in dollars):* **No, and by deliberate design.** $OMR is scarce (20k
  genesis, ~7–22 acquirable per engaged week), withdrawals are gated on **team-funded** tranches, and the
  ETH fees are dev revenue that never backs the withdrawal reserve. So player extraction is a bounded,
  team-funded distribution, not a P2P or fee-funded income stream — consistent with the utility-only token
  framing in your design notes. A player cannot "earn a living" in fiat from this; they can earn status,
  progress, and a modest, capped $OMR trickle.

**The single highest-leverage change** if you want the game to *feel* Risk-to-Earn: couple reward to
exposure — make the safe income less dominant (B1, B2, B5) and give killing both a reason and a cost that
can't be trivially bought off (B3, B4). None of that is a code fix; all of it is a balance decision that
needs your sign-off and a sim pass.
