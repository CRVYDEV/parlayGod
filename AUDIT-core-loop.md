# OMERTÀ — Core Game-Loop Audit (design/experience lens)

Three parallel design auditors — early-game/retention, economy/progression, PvP/social —
read the live code and assessed the loop as *players experience it*: is it fun, well-paced,
cohesive, and does it hold people past week one? This is a design audit, not a security pass
(that was done separately in `AUDIT-gameplay-chain.md`). Every finding is a **recommendation
for founder sign-off** — per ground rule #1, none of these are changes made against the
sim-audited prototype without your number.

## The one-sentence verdict

**OMERTÀ is a strong, richly-flavored PvE spine that completes — the content is a finite
catalog, the retention hooks switch off around day 7, and the only real status ladder is a
level any player reaches without ever fighting.** The fixes are almost entirely *additive*,
and they point at a single keystone: a **Contracts & Hitmen** system (designed in
`omerta-hitman-contracts-design.md`) that simultaneously supplies the missing endgame sink,
the missing status ladder, and the missing reason to engage in PvP.

---

## 1. Early game & retention — the D7→D30 hooks are half-broken

**What works (keep it):** the crime/city-event flavor is excellent; the slot-machine texture
(crate/makings rolls, jail-on-fail, daily event modifier) keeps taps from being pure math;
the Daily Score (8h) is a good twice-a-day anchor; the First Week checklist is a solid week-1
spine.

**The gaps:**
- **The check-in streak is capped at day 7** (`game.js:397`, `min(streak,7)`). The single
  cheapest, strongest long-retention mechanic is switched *off* exactly when it should start
  compounding. A 30-day streak pays the same as a 7-day one, and `streak` is used nowhere
  else. **Fix:** extend the curve + add 14/30/60 milestones (cb/$OMR/title).
- **Daily contracts are frequently un-completable** for a new/solo player: the draw
  `(day+2i)%pool` (`rules.js:512`) isn't filtered by what the player has unlocked, and
  `dice3/dice6` are **undrawable by anyone** (no dice endpoint — the AUDIT.md gap, reframed
  here as a *retention* bug). On many days the all-three bonus is simply unreachable. **Fix:**
  filter the draw to completable jobs; implement or remove dice.
- **No level-1 offline income.** The first passive faucet is a $12.5k racket at level 3
  (`rules.js:66`), so a day-1 player who closes the app has nothing accruing to pull them back
  on day 2. **Fix:** a free tier-0 "corner" that trickles cash offline from level 1.
- **No always-visible next goal.** `/me` returns stats but no assembled "here's your next
  step"; after First Week + early missions, a mid-teens player can be left with only "tap
  crime." **Fix:** surface a server-side current-objective pointer in `/me`.
- **The crime loop is one dominated button** — crimes cost only nerve, and EV-per-nerve rises
  monotonically with tier, so the 28-crime table collapses to "tap the highest unlocked."
  **Fix:** differentiate a few crimes by reward *type* (crates vs respect vs cash) so "which
  crime" is a real choice.
- **First Week capstone is gated on `ob_wallet`** (a real EVM wallet + SIWE), the likeliest
  onboarding stall. **Fix:** pay the capstone on the gameplay tasks; treat wallet-connect as a
  separate bonus.

---

## 2. Economy & progression — the empire completes, then cash has nowhere to go

**What works (keep it):** the level+capital-gated racket ladder is a clean "always a next
goal" engine; assets have real mechanical hooks (energy cap / cargo / idle income); the
subsystem interlock (crime→makings→kitchen→trade_rep; garage→melt→ammo→violence; gear→stats)
is better than typical for the genre.

**The gaps:**
- **The whole economy is a finite, completable catalog with no scaling sink.** Owning
  everything ≈ **$419.5M**; endgame idle income ≈ **$260–312M/day**. The empire pays for
  itself in **under two days**, after which nothing consumes cash — and the bank pays
  **~4%/day** on idle cash, so endgame wealth *grows on its own with nowhere to go.*
- **The only real wealth sink is death** (the estate wipes the street), and it's *involuntary*
  and now **buyable-out via real-ETH respawn insurance** — the richest players can permanently
  opt out of the only reset.
- **No status/flex ladder.** Titles are earned once; the leaderboard is respect-based. Nothing
  lets a player *spend to signal rank*, so the rich and the comfortable look identical.
- **The kitchen is out-scaled by idle** — a full Cathedral batch nets ~$4–6M/9h vs rackets'
  ~$260M/day, so the most hands-on system becomes a rounding error exactly when mastered. Its
  real (undeclared) role is the `trade_rep` identity track.
- **Paths are a soft multiplier, not a playstyle** — a 25-$OMR toggle an optimizer flips
  before each action; no commitment, no identity.
- **Staking and trade-goods are silos** that neither feed nor draw from the empire.

---

## 3. PvP & social — a side annoyance, not a career

**What works (keep it):** the same-district fire gate is genuine counterplay; chop scales with
victim wealth (hunting the rich pays more than griefing the poor); the estate is
account-survivable (retention-friendly); jumps are the best-tuned PvP piece; the
`bounty_contributors` anti-self-pay lock is well-designed.

**The gaps:**
- **PvP is optional and status is PvE-farmable.** Rank = level = respect, and respect comes
  entirely from crime/missions — a pure-PvE player can reach **Don of the City** without
  firing a shot. There is **no killer rank, no "most feared," no assassin leaderboard.** PvP
  is a respect-and-cash tap bolted onto a PvE spine.
- **The hit is invisible to its target.** `startSearch` fires zero notifications, so the 3h
  "defense window" only happens by accident. There's no informed counterplay.
- **The only earnable-free defense against a landed kill is real-ETH respawn insurance** — the
  loop's biggest fairness/optics risk. There is no in-game bodyguard/safehouse/evade.
- **Bounties are invisible and passive:** no `GET /bounties` board, no expiry, no refund, no
  directed contracts — and they're collected by *jumps* (cheap) rather than the hit contract
  (expensive), undercutting the intended fulfilment. `bounties.reason` exists in schema but is
  never set.
- **Wars are a 30-min skirmish scored only by jumps** (kills contribute nothing), so the
  lethal layer is divorced from the group-conflict layer; **turf is a pure cash auction** with
  no violence path; **`fire` generates zero heat**, so killing has no law consequence.

---

## 4. The unifying prescription

The three audits describe **one hole from three sides**: the game has no endgame *sink*, no
*status ladder*, and no *PvP career* — and a **Contracts & Hitmen** system is the single
addition that supplies all three at once:

- **Sink:** contracts escrow cash; NPC-hitmen *burn* cash to a §10.4 sink → the scaling
  wealth outlet §2 is missing.
- **Status ladder:** an assassin reputation/rank/leaderboard → the "spend/earn to signal rank"
  §2 and §3 are missing.
- **PvP career:** a reason to specialize as a fighter, with directed contracts, war-kill
  scoring, and earnable defense → fixes §3 wholesale.

Full design, options, and the founder decision list: **`omerta-hitman-contracts-design.md`**.

### Cross-cutting priorities (ranked)

1. **Build the Contracts & Hitmen keystone** — highest leverage; closes the biggest gaps in
   §2 and §3 together. (Its own design doc + sign-off list.)
2. **Repair the daily hooks** — filter daily contracts to completable jobs; extend the
   check-in streak past day 7 with milestones. *High retention, low effort.* (§1)
3. **Add a scaling wealth sink + visible flex ladder** — partly subsumed by #1 (contracts),
   but a non-violent sink (racket reinvestment levels, a family-compound tier) should pair
   with it so wealth has an outlet that doesn't require getting shot. (§2)
4. **Level-1 offline income + an always-visible next goal** — fixes the D1→D2 pull and the
   mid-teens "quiet." (§1)
5. **Give paths real identity** (path-gated content or use-based mastery; ramp the switch
   cost). (§2)
6. **Earnable in-game kill defense** so real-ETH respawn insurance isn't the only shield —
   also a §1/§3 fairness fix. (folded into #1's protection contracts)

---

## Balance / design items requiring founder sign-off (ground rule #1)

Carried from the security audit and reconfirmed here as *design* priorities: bank interest
~4%/day online asymmetry; trade-goods arbitrage; war duration (the open §9 call); the
dice-contract gap. None are changed in code without your number. The Contracts & Hitmen
build introduces new numbers (contract fees, rep curves, NPC-hit success odds, expiry
windows) that likewise need sim + sign-off before shipping — enumerated in the design doc.
