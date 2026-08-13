# The Mob Council — governance design (D2d)

**Status:** design draft. Not built. Legal-gated (see §9). This document answers the open
questions the economy plan (`omerta-economy-plan.md` D2d) left standing — vote weight,
cadence, anti-capture, advisory-vs-binding, and which dials — and specifies a build that
**cannot break §10.4 or mint value** no matter who captures it. Numbers here are provisional
and need re-sim + founder sign-off before a build (ground rule #1).

---

## 1. What it is (the fiction and the point)

In the fiction: a **Commission** of the ruling families — the same table the mafia has always
had. In the economy: a bounded control surface that lets the top crews *tune* a few dials
(how fast the wealth sink bites, how the buyback is split) instead of those numbers being
fixed forever by us. Governance turns "the devs balance the economy" into "the players who
built the biggest empires have a stake in keeping it healthy" — which is both better fiction
and better live-ops (the economy self-corrects between our patches).

The point is emphatically **not** to hand players a value lever. It's to let them move a
thermostat inside a room we built with the windows bolted shut.

## 2. The one hard rule — governance tunes, it never mints

Every design choice below flows from a single invariant:

> The Council can only move a dial **within a server-clamped range**. It can never create
> value, change the withdrawal reserve, touch the ledger, or alter any §10.4 conservation
> rule. The worst a fully-captured, maximally-hostile Council can do is push every dial to
> the least-healthy end of its *safe* band — a band we chose so that even that state is fine.

Concretely, the governance service writes **only** to its own tables (`gov_dials`,
`gov_proposals`, `gov_votes`, `gov_audit`). It writes **zero** rows to `transactions`. The
sinks and splits it tunes (e.g. the D2c upkeep burn) still ledger every cent themselves, so
§10.4 holds by construction — governance changes a *coefficient*, never a *balance*. This is
the property that lets us ship player governance without re-opening the invariant proofs.

## 3. Vote weight — **earned standing, never staked $OMR**

This is the load-bearing decision, and we come down hard on one side:

| Option | Verdict |
|---|---|
| **Staked $OMR** (token-weighted, à la most DeFi DAOs) | **Rejected.** It makes $OMR a governance-rights instrument — squarely the expectation-of-profit pattern we are keeping $OMR *out* of (sensitive design note: utility-only). It also lets anyone **buy** control on the DEX: a whale with cash converts to $OMR and owns the economy. Both fatal. |
| **Earned standing** (`lifetime_tribute + 10,000 × wars_won`) | **Chosen.** It's the exact metric the buyback already ranks families by, it's **earned through play, non-transferable, and un-purchasable** — you cannot buy standing on any market — and it aligns governance power with the players most invested in the game's health. |

Standing-weighting keeps $OMR a pure utility token *and* closes the buy-the-vote attack in one
move. It is the anti-financialisation choice and the anti-capture choice simultaneously.

**Seats are families, not individuals.** The Council is the **top-N families by standing**
(propose **N = 9** — a "Commission" reads right and keeps quorum math simple; tune with
sim). One family = one seat. This matters for anti-capture: an individual whale can smurf
alt *accounts* cheaply, but a *family* with real standing is a social unit that takes real,
observable play to build — and you can't be in two families at once.

**Within the Council, votes are standing-weighted but compressed.** A raw-standing weighting
lets the #1 family dwarf the other eight. Weight is therefore **sub-linear and capped**:

```
weight(family) = min(WEIGHT_CAP, 1 + floor(sqrt(standing / STANDING_UNIT)))
```

The `sqrt` compresses the top (a family with 100× the standing gets ~10× the vote, not
100×); `WEIGHT_CAP` (propose 5) hard-limits any single seat. So the biggest empire has a
louder voice — earned — but never a controlling one. No family alone clears quorum.

## 4. Binding, but bounded and rate-limited

Advisory governance is theater; players see through a "vote" that we can ignore, and it
teaches them their input is fake. So Council decisions are **binding** — but every dial is
wrapped in three safety layers so *binding* never means *dangerous*:

1. **Hard clamp.** Each dial has a server-enforced `[min, max]`. A value outside the band is
   impossible to reach through any sequence of votes. The clamps are the real balance
   guarantee; the vote just chooses a point inside them.
2. **One step per epoch.** A dial can move at most one `STEP` per weekly epoch (e.g. upkeep
   ±0.1%/week). No single vote can slam a dial across its range; drift is slow and observable,
   and we can react between steps.
3. **Read-at-call, mod-revertible.** Live code reads the current dial value per call (exactly
   how `ratelimit.js` reads rates today), so a change takes effect without a deploy — and a
   `MOD_KEY` **freeze/reset** kill-switch reverts every dial to its default and halts voting
   (consistent with existing §10.3 mod tooling). Governance is a delegated privilege we can
   revoke instantly.

## 5. The dials (initial slate — all clamped, all provisional)

Start **small**. Three low-blast-radius dials, each of which only tunes an *existing*,
already-ledgered mechanic:

| Dial | Range (provisional) | Step/epoch | Tunes |
|---|---|---|---|
| `upkeep_pct` | 1.0% – 2.0% / day | 0.1% | the D2c wealth-scaling upkeep sink (burn on holdings) |
| `buyback_family_split` | 40% – 60% | 5% | the §7.12 buyback's family-vs-event-fund split |
| `event_fund_tax` | 0% – 3% | 0.5% | a small skim on the buyback into the event fund (funds live events) |

Deliberately **out of scope** (for now): engine constants that shape core loops — the
`RACKET_DAILY_CAP_MS`, swap curve, APY, timers. Those stay dev-owned; governance tunes
*redistribution*, not *game physics*. We can promote a dial into the Council's hands later
once the mechanism is proven; we can't easily walk one back.

Every dial's default sits in the **middle** of its band, and every band is chosen so that
**both endpoints are economy-safe** — the sim must show the game is healthy at min, mid, and
max of each dial *before* it's handed over.

## 6. Cadence and quorum (weekly epochs)

Aligns with the existing weekly family-contract cycle (`bumpFamilyTask`), so there's one
rhythm to learn.

- **Epoch = 7 days.** At epoch open, the server auto-generates a fixed slate: one proposal
  per dial, each a three-way choice — **Raise one step / Hold / Lower one step**. (Auto-slate,
  not free-form proposals: it keeps the surface tiny, un-gameable, and un-spammy.)
- **Seats** are recomputed at epoch open from live standing (top-9). A family that decayed off
  the list loses its seat; a rising family gains one. No permanent incumbency.
- **Vote window:** the full epoch. One vote per family per proposal; the **family's `boss`
  role** (already the command truth in `gang_members`) casts it, or it defaults to Hold.
- **Quorum:** a proposal resolves only if seats holding **≥ ⌈2/3⌉ of seated weight** voted;
  else the dial **holds**. A tie or a no-quorum epoch = Hold. Inaction is safe by default.
- **Execution:** at epoch close, each proposal's weighted tally picks a direction, the dial
  steps one `STEP` inside its clamp, and the change + full tally is written to `gov_audit` and
  telemetered. The new value is live immediately (read-at-call).

## 7. Anti-capture — the threat model

Who tries to own the Council, and why each fails:

- **Whale buys control.** Can't — standing is un-purchasable and non-transferable; there is no
  market for votes. Cash → $OMR → votes is severed at the root (§3).
- **Whale smurfs many families.** Each fake family needs *real, top-9 standing* (out-earning
  genuine competitors in lifetime tribute + wars won) — expensive, slow, and visible in the
  same telemetry that already flags same-IP referrals. One account, one family. `sqrt` + weight
  cap means even a legitimately huge family can't solo-clear quorum.
- **Agent/bot families.** Agent-flagged accounts already carry a public badge and harder limits;
  agent-flagged families are **excluded from Council seats** (they can play the economy, not
  govern it) — same posture as their referral-payout exclusion.
- **Cartel of the top 9 colludes to grief.** The hard clamps (§4.1) are the backstop: a
  unanimous hostile Council can only push each dial to its worst *safe* endpoint, one slow step
  per week, in full public view of the audit log — and the mod freeze/reset ends it instantly.
  There is no vote, or sequence of votes, that reaches an unsafe economy state.

The design assumes the Council **will** eventually be adversarial and simply makes that
outcome boring. Safety comes from the clamps, not from the voters' goodwill.

## 8. Data model & surface (sketch — for the build phase)

```
gov_dials      (id=1 singleton)  key → {value, min, max, step, default}   -- the live thermostat
gov_epochs     (epoch_no, opened_at, closed_at, status)
gov_proposals  (id, epoch_no, dial_key, resolved_dir, tally_json)
gov_votes      (epoch_no, gang_id, dial_key, choice, weight)              -- UNIQUE(epoch,gang,dial)
gov_audit      (id, epoch_no, dial_key, old_value, new_value, tally_json, at)
```

Endpoints (all standing/role-gated; the mutating ones honor Idempotency-Key + rate limits like
every other player route):

```
GET  /v1/council                      -- seats, live dials, this epoch's slate + your family's votes
POST /v1/council/vote                 -- {dialKey, choice}; boss-only, one per family per dial
GET  /v1/council/audit                -- public history (transparency is anti-capture)
POST /v1/mod/council/freeze|reset     -- MOD_KEY kill-switch (§10.3)
```

Epoch open/close runs in the **worker**, in the existing hourly tick, in its own transaction —
no new global clock (respects the lazy-accrual / no-global-tick rule; this is a coarse weekly
housekeeping job, not a per-player tick). Dial reads are per-call and cached like rate limits.

## 9. The one design rule that must survive a revision

**Voting weight is STANDING, never the token.** If a future revision is tempted to add staked-$OMR
voting for "more skin in the game," that temptation is exactly the trap this design was built to
avoid — it turns the council into a thing you buy, and it turns $OMR into something other than a
game currency. Re-read §3 before touching it, and put it on the launch checklist.

## 10. Build phasing (when it's greenlit)

1. **Sim the bands first.** Prove the economy is healthy at min/mid/max of all three dials
   (D2c upkeep must exist and be sim-signed before `upkeep_pct` can be a dial). Founder signs
   the numbers. *(Blocks everything below.)*
2. **Dials as read-only config** — ship `gov_dials` + read-at-call wiring with dev-set values,
   no voting yet. Proves the thermostat moves the economy safely in production.
3. **Voting** — seats, weekly epochs, auto-slate, quorum, execution, audit, the mod
   freeze/reset. Full test coverage: a captured-Council scenario asserting the clamps hold, and
   a §10.4 invariant test proving governance writes no ledger drift.
4. **UI + telemetry** — the Council table, audit transparency, live-ops dashboards on dial
   drift.

---

### TL;DR for Jorge
Top-9 families get a weekly vote on three economy dials (how hard the wealth tax bites, how the
buyback is split, a small event tax). **They can only nudge each dial a little, inside a safe
range we set — they can never break the economy or print money, and you have a one-button
kill-switch.** Voting power is *earned* through play (standing), never *bought* with the token —
that's what keeps $OMR clean and stops whales from buying control. It's real fiction (the
Commission), it makes the economy self-correcting between our patches, and every safety
guarantee comes from the hard limits in the code, not from trusting the players.
