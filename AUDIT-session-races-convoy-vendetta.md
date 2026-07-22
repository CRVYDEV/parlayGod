# AUDIT — session drops (Street Races 2–3, Convoy 3, Vendettas 2)

A full-system red-team over this session's four drops, run as two independent parallel adversarial lenses,
each tracing every finding against source before reporting:

- **Lens A** — §10.4/faucet-emission + concurrency/locks/persist-clobber.
- **Lens B** — death/estate/PvP correctness + cross-system exploit chains.

The drops audited:
1. **Street Races step two** — PINK SLIPS (race for the car — an ownership transfer) + NITROUS.
2. **Street Races step three** — THE GRAND PRIX (scheduled worker-resolved cash parimutuel + escrow check).
3. **Convoy step three** — NPC TRUCKING (NULL-owner NPC convoys players hijack via the existing ambush).
4. **Vendettas step two** — escalation tiers + the sit-down (peace) + the blood-debt leaderboard.

## Verdict: BOTH LENSES CLEAN — no CRITICAL / HIGH / MED

Independently verified sound:

- **Grand Prix escrow conserves exactly.** Full grid: outflow = `handedOut + deadBurn + totalTake` with
  `totalTake = rake + (net − handedOut)`, `net = livePool − rake`, `livePool = pool − deadBurn` ⇒ outflow
  = `pool = Σ buyin`. Short-field refund path also sums to `pool`. The `grand prix escrow` invariant
  reconciles, a byte-faithful port of the audited `resolveTournament`. A dead entrant / an entrant whose car
  was sold-melted-pink-raced / an all-dead grid all resolve without a crash (the race runs on the entry-time
  **power snapshot**, never dereferencing the car; characters are never row-deleted so the PK never dangles;
  the dead stake burns once via `race:gp:death`, no double-count vs the estate's remaining-cash burn).
- **Enter-vs-settle lock order** is `chars(sorted) → gp_state → gp`, identical to `enterGrandPrix` and the
  audited tournament twin (state before the row, so a concurrent entry can't AB-BA). `grand_prix.pool` uses
  the proven `pool = pool + $2` twin of `poker_tournaments.pool`.
- **All 5 car-ownership-transfer sites clear the race flags** — pinkSlipRace, market buy-now, auction-settle,
  loan-collateral collect, loan-forfeit — so the consent-bypass fix is complete; a double-flagged
  (`listed`+`pink_slip`) car is harmless (every race path rejects listed/pledged, and the sale/seizure clears
  the flags on the way out).
- **NPC convoys are fully walled off** — `owner_character=NULL` makes collect/toll/insurance/one-convoy-cap
  unreachable; `ambushConvoy` is NULL-safe (own/family/turf checks short-circuit, both notifies guarded);
  `despawnArrivedNpc` is atomic per truck; ambush-vs-despawn serialize on the convoy `FOR UPDATE` + the
  `arrived()` gate. The goods faucet is bounded + rides the existing `goods:` reason.
- **Vendetta step two moves zero currency** (§10.4 untouched by construction). `vendettas.kills` is an
  absolute JS-computed write (no pg-mem INT-arithmetic quirk); the same-pair lost-update is UNREACHABLE (an
  account has exactly one living character, so two simultaneous same-bloodline kills can't occur). Peace
  paths lock only the actor's char; the account-keyed offer/vendetta rows form no lock cycle; a fresh kill
  re-opening the feud is the designed behaviour. `postBounty` re-reads an active vendetta live, so peace
  correctly lapses the directed-floor waiver.
- **Persist discipline** — `race_at` is excluded from `persistCharacter`'s column list, `race_wins` from
  `persistAccount`; cars/boats/vendettas/grand_prix are separate rows. No clobber.

## Fixed in-commit (the one LOW both lenses flagged — a consistency tidy)

**LOW (cosmetic) — nitrous conveyed with a bought/seized car.** `pinkSlipRace` resets `nos=0` on the
transferred car, but the four non-pink transfer sites (market buy-now, auction-settle, loan collateral
collect + forfeit) kept the seller's/defaulter's nitrous charges. §10.4-neutral (nos isn't currency; the
$8k/charge was already a sunk sink; ≤$24k) and defensible either way — but an easy uniformity win. All four
`UPDATE cars SET character_id` transfers now also clear `nos=0`, so every one of the five transfer sites has
identical semantics (a transferred car arrives with no race listing, no pinks flag, and no nitrous).

## Flagged (accepted, pre-existing precedents — no action)

- The Grand Prix late-entrant/enter-vs-settle residual and the single-worker NPC-spawn TOCTOU are the
  identical accepted `deadlockToRetry`/worker-retry and self-correcting world-raid postures the poker-
  tournament and world-raid audits already blessed.

Suite 31/31 + sim drift-0.
