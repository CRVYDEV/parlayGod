# OMERTÀ — Economy & Tokenomics plan (decisions locked 2026-07)

Turns the four economy/tokenomics decisions into buildable mechanisms. **Nothing here
is implemented yet.** Anything that changes sim-audited balance (sinks, permadeath,
governance levers) needs a full re-sim + Jorge's sign-off before it ships (ground rule
#1). Evidence base: `tools/econ-sim.js` (faucets beat sinks 50–70×; the AMM moves
+132,000% on one whale's daily cash; a bot nets ~$46.5M/day).

> **Two caveats that must travel with this plan:**
> 1. **Legal surface grows.** A player-governance body that tunes economic levers, plus
>    a freely-withdrawable yield token that bots can extract, pushes this further toward
>    "governance token + financial product" — squarely more securities/regulatory
>    exposure. This plan does not change the standing recommendation: **counsel review
>    before M6-B.** The Mob Council especially should be legally scoped before design.
> 2. **Re-sim before balance ships.** The sink %, upkeep rates, prestige buffs, and
>    insurance costs below are placeholders to show the mechanism — not final numbers.

---

## D1 · Reserve — **Full-reserve + withdrawal queue** (lives in M6-B)

The chain never owes what it can't pay. Internal $OMR is a *claim*; withdrawal settles
only from a funded tranche.

- **`withdrawals` table** (state machine): `queued → funded → signed → claimed`. A
  request debits the in-game $OMR ledger immediately (so it can't be double-spent
  in-game) and enters `queued`.
- **Reserve ratio** = `funded_tranche_OMR / outstanding_claims`. `POST /v1/withdraw`
  only signs an EIP-712 voucher when the ratio stays ≥ 1 after the debit; otherwise the
  request sits `queued` until the Safe tops the tranche, then drains FIFO.
- **Visibility:** a live reserve gauge on `GET /v1/withdraw/status`, plus a §10.4-style
  alert if outstanding claims ever exceed funded reserves (they shouldn't, by
  construction — the alert catches a bug).
- **Invariant:** `Σ signed vouchers ≤ Σ tranche funding`, reconciled nightly beside the
  existing ledger job.

*Status:* ready to build as the core of M6-B. No balance change.

---

## D2 · Sinks — **Hybrid: $OMR is hard money, cash is disposable, + levers**

The re-sim shows sinks alone can't tame a 62× gap without punishing rates. So:

**(a) Design principle — two-tier money.** Cash is the *flow* currency (inflates, that's
fine — it's spent). **$OMR is the hard store of value**, bounded by the fixed on-chain
supply + the full-reserve queue (D1). Value that leaves the game must pass through the
$OMR bottleneck, so cash inflation can't inflate the *withdrawable* asset.

**(b) Cap the racket-income window.** The sharpest single fix from the sim: racket income
is only capped at 8h *per accrual gap*, so an active player who touches every &lt;8h collects
~24h/day. Cap total racket income to a rolling 8–12h/day regardless of touch frequency.
This is a bug-shaped balance fix (closes an unintended multiplier), low-risk, high-impact.

**(c) Wealth-scaling upkeep sink.** A daily upkeep burned as a % of holdings
(rackets/turf/fronts) so the top burns as it earns. Sim @ 1.5%/day: grinder 70×→14×,
whale 62×→34× — helps, tune with (b). Placeholder %; re-sim required.

**(d) The Mob Council (governance) — its own design pass.** Top crews (by standing) get
**bounded** control over a few economic dials — e.g. the upkeep %, the buyback split, an
event-fund tax — each clamped server-side to a safe range so governance can *tune* the
economy but never break §10.4 or mint value. Open design questions before any build:
vote weight (standing? staked $OMR? — the latter deepens the securities problem),
quorum/cadence, anti-capture (whales/bots owning the council), and whether levers are
advisory or binding. **Recommend: scope this legally first, then a dedicated design doc —
do not fold it into the first economy patch.**

*Status:* (b) is a near-term, low-risk fix. (c) needs re-sim + sign-off. (a) is a
principle that shapes M6-B. (d) is a separate track, legal-gated.

---

## D3 · Permadeath — **Keep, soften the cliff**

Permadeath stays (the stakes are the identity). Three softeners, all tunable:

- **Heavier prestige carryover.** Today the heir gets `500 + 100×prestige` cash and a
  fresh level-1 street. Add prestige-scaled stat floors / a respect kickstart so a
  veteran's heir isn't reset to a rookie — death costs a lot, not everything.
- **$OMR "life insurance" (a sink!).** Pre-pay $OMR to reduce what the estate loses
  (e.g. keep a % of cash/cars). Doubles as a wealth sink and a rage-quit buffer.
- **Post-death protection window.** The heir can't be re-hit for N hours, killing the
  coordinated bounty-pile-on griefing vector.

*Status:* balance change — parameters + re-sim + sign-off. Mechanically small.

---

## D4 · Agents — **Let them extract, expand the experience**

Agents stay first-class *and* can withdraw. The safety net is D1 (full-reserve queue) +
Sybil/KYC at the withdrawal edge, not a play-restriction. To make agents an *audience*,
not just a drain:

- **Agent arena / ladder.** A public 🤖 leaderboard and agent-vs-agent objectives
  (bounty tournaments, turf skirmishes) — a competitive surface built *for* automation.
- **Distinct agent goals.** Objectives that reward strategy over grind (the throttle
  already caps raw grind), so the interesting agents win, not just the biggest farm.
- **Agent-legible API depth.** The `snapshot()`-style machine state + richer structured
  actions so builders can write genuinely good agents — turning "bot problem" into a
  developer ecosystem.

*Caveat:* free extraction makes D1's reserve discipline and edge-level Sybil/KYC
**load-bearing** — they're the only thing standing between a farm and the treasury.

*Status:* extraction policy is an M6-B config; the agent-experience layer is a new
product track (design pass of its own).

---

## Suggested sequencing

1. **Legal read** (token + gambling + drug theme + Robinhood ToS + *governance*). Gates the rest.
2. **Racket-window cap (D2b)** — low-risk, high-impact, do early.
3. **M6-B** built around the **full-reserve queue (D1)** + agent extraction config (D4).
4. **Re-sim** the wealth sink (D2c) + permadeath softeners (D3); Jorge signs the numbers; implement.
5. **Mob Council (D2d)** and the **agent-experience layer (D4)** — separate design docs, legal-gated.

## Open decisions still needed
- Mob Council vote weight + binding-vs-advisory (and its legal scope).
- Final numbers: upkeep %, racket-window hours, prestige buffs, insurance cost, per-account withdrawal caps.
- KYC/Sybil posture at the withdrawal edge (needed once agents extract).
