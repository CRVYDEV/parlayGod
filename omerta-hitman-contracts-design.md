# Contracts & Hitmen — design proposal (M7)

**Build status:** **Phase 1 (Contract Board) — BUILT** (browsable board, hospitalize/kill
split, reason/expiry/anon, cancel + expiry refund, target-notified). **Phase 2 (Player-hitmen
+ assassin reputation) — BUILT**: directed contracts (name a hitman, exclusive window → auto-opens),
the hybrid legend (account-level lifetime `hitman_rep` + `kills`, surviving death) + per-season
`season_kills` streak, the Button Man→Undertaker rank ladder, `GET /leaderboard/hitmen`, with
anti-abuse (level floor, repeat-bloodline diminishing, agents earn kills but not leaderboard rep).
Rep is a **status axis only** (no gameplay power → no §10.4 / balance impact). Phases 3 (NPC-hitmen)
and 4 (earnable defense + interlocks) remain design-only below.

---

**Status:** design draft. This is the keystone the core-loop audit
(`AUDIT-core-loop.md`) points at: one system that supplies the three things the game is
missing at once — an endgame **cash sink**, a **status ladder**, and a **reason to fight**.
It *extends* the M3 primitives (hits, bounties, escrow, the estate) rather than replacing
them. Everything here stays escrowed and ledgered — **nothing mints** (§10.4). All numbers
are placeholders pending sim + founder sign-off (ground rule #1).

---

## 1. Why this system (the thesis)

The audit found one hole from three sides:
- The economy is a **finite catalog** that completes in ~2 days of endgame income, with no
  scaling sink and a ~4%/day bank faucet — wealth grows with nowhere to go.
- Status is **level = respect**, farmable entirely through PvE — a player reaches *Don* without
  firing a shot. There is no killer identity, rank, or leaderboard.
- PvP is an **optional tap**, not a career: hits are invisible to the target, bounties are
  invisible to hunters, and the only earnable-free defense against a kill is real-ETH respawn
  insurance.

A **contract economy with an assassin progression axis** fixes all three: contracts and
NPC-hits are the cash sink; assassin reputation is the status ladder; directed contracts,
war-kill scoring, and earnable defense make PvP a specialization worth mastering.

## 2. Build on what exists (reuse, don't reinvent)

| Existing primitive | Reused for |
|---|---|
| `searches` (one active/hunter) + `fire`→`runEstate` | contract *fulfilment* stays the exact hit loop |
| `bounties` + `bounty_contributors` anti-self-pay lock | the escrow + no-funder-collects pattern, extended to contracts |
| `claimBounty` ledgered escrow payout | contract payout pattern |
| `notify` / `bus` fabric | telegraphing hunts, contract offers, kills |
| `runEstate` (killer-less mod-kill variant) | NPC-hit resolution (but **ledgered**, unlike mod-kill) |
| `ratelimit.js` token buckets, `track()`, `invariants.js` vocabulary | anti-abuse velocity caps, telemetry, §10.4 discipline |
| level→prestige season model (`runSeasonRollover`) | account-legend + per-season streak split |

## 3. The system, in layers

### Layer 1 — The Contract Board (foundation, low-risk, ship first)
Make contracts *discoverable and lifecycle-managed*. Today a bounty is a transient ticker
line with no board, no expiry, no refund, no reason.
- `GET /contracts` — browse open contracts (bounties + directed), with target, pot, type,
  reason, expiry, poster (or anonymous).
- Wire the unused `bounties.reason`; add **expiry → ledgered refund** to the poster (closes the
  one-way-commitment gap); add a cancel-with-refund window.
- **Split bounty types:** a cheap **hospitalize** bounty (collectible by a jump) vs a premium
  **kill** bounty (collectible only by a completed `fire`). Restores the hit contract's purpose
  (today jumps collect everything).

### Layer 2 — Player-hitmen + the assassin axis (the career)
A player accepts a **directed contract** (poster names a target; optionally names a hitman for
an exclusive window that auto-escalates to open if unfilled + expiring), fulfils it via the
existing `fire` loop, and earns the escrowed payout **plus assassin reputation**.
- **Assassin reputation** is a new axis distinct from `respect`. Ranks in the fiction:
  *Button Man → Mechanic → Ghost → The Undertaker*. `GET /leaderboard/hitmen`.
- A `kills` counter on the character (schema has `busts` but no kills today) + a killer title.
- **Rep location (open decision):** account-level *legend* (durable, survives death like
  $OMR/prestige) **+** per-season character *kill streak* (fresh, contestable leaderboard).
  Recommended hybrid — mirrors the level→prestige season model.

### Layer 3 — NPC-hitmen (the cash sink + the great equalizer)
Any player pays cash; the **server rolls a PvE hit attempt** on the target. This is the big
ledgered wealth sink §2 needs, and it lets a low-level player put real pressure on a whale
(restoring stakes). **Guard it hard** so it can't become cheap grief-for-hire:
- A *rolled* attempt, success scaled by price and capped; **cash burned to a named §10.4
  sink**; **heat on the payer**; velocity-limited; **pays zero rep**.
- On success it runs `runEstate` with no player killer — like the mod-kill path, but
  **ledgered** (mod-kill isn't).

### Layer 4 — Earnable defense (fairness fix)
So real-ETH respawn insurance isn't the only shield:
- **Bodyguard / protection contract** — a player insures another for a window (absorbs/deters a
  hit).
- **Safehouse / evade** — a cash sink that hides `loc` from the same-district fire check for a
  window (an in-game counter to being hunted).
Both are earnable, escrowed, and ledgered.

### Layer 5 — Interlocks (where it ties the game together)
- **Gangs:** a boss posts a **family contract funded from the treasury** — finally a sanctioned
  outflow for the roach-motel treasury, tying the social layer to the kill layer.
- **Wars:** **kills/hits score war points** and pay a war-kill bonus (today war score is
  jump-only) — the single highest-leverage interlock; unites the lethal and group-conflict
  layers.
- **Heat/law:** give `fire` a heat/law consequence (it generates none today) — killing gets a
  law-based counterplay and a reason to lay low, reusing the heat + Bureau-raid machinery.
- **Estate:** contract payout stacks on the existing chop, escrowed like a bounty.

## 4. §10.4 discipline (non-negotiable)

Every contract **escrows at post** (like `postBounty`), **refunds on expiry/cancel**, **pays on
fulfilment**, and **burns on target death** — all ledgered. NPC-hit cash burns to a named sink.
New reasons (`contract:post`, `contract:refund`, `contract:pay`, `npchit:burn`, …) join the
`invariants.js` vocabulary — an unknown reason is itself an alert (M5). No path mints value; a
kill moves value and destroys the street, exactly as the estate already does.

## 5. Anti-abuse (must-have before ship)

- **Wash-killing alts for rep:** rep only from targets above a level/net-worth floor;
  **diminishing rep for repeat kills of the same bloodline**; same-IP flagged (extend the
  existing §10.3 flag); agent-flagged accounts excluded (CLAUDE.md rule).
- **Self-contract laundering:** extend the proven `bounty_contributors` lock to directed
  contracts — no funder, and no same-account/same-IP party, collects.
- **Collusion/boosting:** velocity caps (reuse `ratelimit.js`), **rep decay** so farmed rep
  isn't permanent, same-IP directed-payouts flagged like exchange fills.

## 6. Suggested phasing

1. **Contract Board (Layer 1)** — pure additive, low-risk, immediately makes bounties a real
   activity. Ship first, validate the board UX.
2. **Player-hitmen + assassin rep (Layer 2)** — the career axis + leaderboard.
3. **NPC-hitmen (Layer 3)** — the sink; ship *after* rep so the guardrails (heat, caps,
   rep-less) are tuned against real data.
4. **Earnable defense + interlocks (Layers 4–5)** — bodyguard/safehouse, war-kill scoring,
   fire-heat.

Each phase is its own test suite (success + every gate) and its own §10.4 invariant test
(escrow reconciles, no drift), matching the M-milestone bar.

## 7. Open decisions for the founder (the sign-off list)

1. **Assassin rep: account legend, character streak, or hybrid?** — *Recommend hybrid.*
2. **NPC-hitmen: in or out?** — *Recommend in, tightly capped, rep-less, heat-heavy, ledgered.*
3. **Do jumps still collect kill-bounties, or split hospitalize-vs-kill?** — *Recommend split.*
4. **Should kills score war points + pay a war bonus?** — *Recommend yes (biggest interlock).*
5. **Should a hit generate heat / law risk?** — *Recommend yes (earnable counterplay).*
6. **Contract expiry → refund poster or forfeit to house?** — *Recommend refund, ledgered.*
7. **Earnable in-game defense, or leave respawn insurance as the only shield?** — *Strongly
   recommend earnable.*
8. **War duration** (the open §9 call) — resolve alongside; the war/hit interlock depends on it.

Plus the **numbers** that need sim + sign-off before ship: contract fees + house take, NPC-hit
price→success curve, assassin rep gains + decay + rank thresholds, expiry windows,
safehouse/bodyguard costs + durations, war-kill bonus, hit heat amount.

---

### TL;DR for Jorge
The game is a great PvE grind that runs out of things to spend money on and doesn't reward
fighting. **A contract/hitman system fixes both:** players (and NPC hitmen you *pay cash* to
hire) take contracts on each other, killers climb a feared-assassin leaderboard with real
titles, gangs fund hits from the treasury, and you can *earn* protection instead of only
buying a respawn with ETH. Money finally has somewhere to go, being dangerous finally means
something, and none of it prints value — every dollar is escrowed and tracked like the
bounties already are. Pick the 8 decisions above and I'll build it in phases, each tested.
