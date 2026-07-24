# OMERTÀ — Stakes, Spine & Economy Review (founder decision sheet)

**Author's note.** This came out of a critical read of the whole game after the content-accretion
phase. Seven structural gaps were surfaced; this doc records what was **MEASURED**, what was **BUILT**
(additive, §10.4-free), and what is **PROPOSED** as a founder-gated lever change. Per ground rule #1
the sim-signed numbers are NOT retuned here — the proposals below are for Jorge to accept/decline.
Every dollar figure below is analytic, read from the signed constants (`tools/sim.js` P9.20 + the
front catalog), zero value seeded, §10.4 sweep still drift-0.

---

## FINDING #1 — the passive-income STACK dwarfs the active game (MEASURED, the headline)

The economy is nominally SIGNED, but the sign-off measured faucets **one at a time**. Nobody summed
the **parallel stack** — and the passive earners **do not cost energy**, the bound on the active loop.

**Measured (P9.20, from the signed constants):**

| stream | daily ceiling | effort | notes |
|---|---|---|---|
| **Personal fronts** (5 businesses, top tier, NET of 20% pad) | **$48.96M/day** | **5 collect clicks** | one per kind, uncontestable; ~$110M to build → **~2.2-day payback** |
| Speakeasy (top tier, NET) | +$2.5M/day **per club** | 1 click | one club per district, additive |
| **Territory racket** (top tier × best type) | **~$20.9M/day per district** | boss collect | family-side; up to 6 core districts |
| — vs — | | | |
| Active crime grind (depository, lvl 110) | ~$7.9M/day | **~200 energy-bounded attempts + jail risk** | the whole active endgame loop |

**The gap.** The personal front stack alone is **~6× the top active grind, energy-free, from 5 clicks
a day** — before speakeasy/territory/frontier/sov pile on. On an **effort-adjusted** basis the active
loop is economically irrelevant at the top: 5 clicks beats 200 risky attempts by 6×. The territory
stack ($20.9M/day/district) is the larger monster; a family holding the core map runs **>$100M/day**
in treasury income.

**Why it matters beyond balance:** everything downstream inherits this. The $OMR extraction rail, the
Vig's "extraction ≤ inflow" wall, the Street Wage's real-money sizing — all assume the economy's income
is roughly what the sim signed *per faucet*. A player quietly earning $49M/day of launderable cash is
outside that envelope.

**§10.4 is CLEAN** — every front is a ledgered faucet, the sweep stays drift-0. This is a **balance**
problem, not a leak. The dial is the front `incomePerHr` CURVE, not the ledger.

**LEVERS — L1a + L1b BUILT (founder-directed "Balance the economy"):**
- **L1a — flatten the top-tier front curve. ✅ BUILT.** The apex fronts (`hotel` lvl42 / `casino` lvl58)
  had their `incomePerHr` HALVED at every tier in `BUSINESSES` (casino was $36M/day gross). The early/
  mid fronts (the on-ramp — laundromat/restaurant/nightclub) are UNTOUCHED, so a new player is unaffected.
- **L1b — progressive (wealth-scaled) pad. ✅ BUILT.** `BUSINESS_UPKEEP_PROG_BPS` (500 = +5%) is added
  per EXTRA front owned (`business.js:upkeepBps(count)` threaded through `upkeepOwed` + the view + the
  P9.20 probe), so a 1-front operator pays the base 20% pad while a full 5-front stack pays 40% — the
  5th front costs more to run than the 1st. Both stay ledgered `business:upkeep` sinks → §10.4 untouched.
- *L1c/L1d (a global personal-income cap / territory type-mult risk) remain the further dials if the
  full front `incomePerHr` curve or the family-side territory stack ($20.9M/day/district) still wants
  trimming — NOT applied; the L1a+L1b pass targeted the personal-stack headline.*

**Measured effect (P9.20, re-run):** the personal 5-front stack dropped **~$48.96M/day → $21.6M/day NET**
(gross halved by L1a → $36M, then × the 0.6 progressive-pad keep by L1b) — a firm **2.27× cut** to the
stack. The passive:active ratio (vs the sim's active-grind baseline, which floats run-to-run) lands
**~2–3.5×** now, down from ~6× — still passive-favoured (a maxed empire *should* out-earn the grind) but no
longer dwarfing the active loop. §10.4 stays drift-0 (every front a ledgered faucet).

---

## FINDING #2 — death has stopped costing anything (MEASURED + PROPOSED)

The premise is "the street dies, the account survives — permadeath gives PvP its stakes." But death now
wipes very little that took real time.

**What a death actually costs (measured against `runEstate`):** the street's pocket+bank cash (looted
+ burned), in-game gear (partially loot-rolled), the character's stats/skills (muscle-memory carries the
lowest tiers), and its active operations. **~35 character-scoped tables wiped.**

**What SURVIVES death (account-level, the heir inherits):** prestige, **25+ legend columns**
(kills/hitman_rep/every `*_earned`/`*_wins`/`*_lifetime`, statecraft, honor_peak, monument_built…),
the **RWA portfolio + Dynasty**, the **Estate + its features**, **marriages + consigliere**, **honor**
(25% echo), **muscle-memory** skill carry, the **Collection log**, all **35 leaderboard standings**, and
every paid entitlement (mint/respawn/pass/patron). Staked $OMR and on-chain gear are untouchable by
design.

**The contradiction:** the game keeps adding death-proof progression while asserting death is the core
stake. For an established player, dying costs a street's cash + a respec — a bad afternoon, not a
setback. That structurally **defuses the PvP loop the whole PvP economy is built to drive** (see #3).

**LEVER — L2a BUILT (founder-directed "Balance the economy"):**
- **L2a — the DEATH DUTY. ✅ BUILT.** On EVERY death (`runEstate`), the succession now burns
  `M3.DEATH_DUTY_RATE` (25%) of the heir's inherited **LIQUID $OMR** — a §10.4 `death:duty` $OMR BURN
  (the enumerated-burn/confiscation precedent, in `omrBurns`). Applied AFTER the P1.1 loot (the killer
  takes their share, then the estate taxes the remainder), so a whacked player's liquid hoard is docked
  twice on the way out. **STAKED $OMR, the RWA portfolio, and the Estate are UNTOUCHED** — the "go
  legit / retire the dynasty in safe harbours" pitch is intact by design; the duty only bites the
  *extractable, un-committed* hoard, so dying finally costs the bloodline something it valued while
  leaving the long-term wealth it was told is safe. A respawn-token save skips the estate entirely →
  no duty (you didn't die). Runs on every death path (fire/shank/npc-hit/mod-kill/NPC-hunter — the
  two hand-rolled headless persists carry the `omr` decrement too). Regression in `test/social.js`
  (heir keeps 7 → 6 after loot → 5 after the 25% duty).
- *L2b (legend decay) / L2c (succession friction) remain the further §10.4-free flavor levers if the
  duty alone doesn't re-anchor stakes enough — NOT applied.*

---

## FINDING #3 — core PvP is EV-negative AND easy to opt out of (MEASURED + PROPOSED)

**Measured:** a fire-kill's standalone loot-EV vs a careless mid mark is **−$72k** (ammo dominates;
break-even ≈ the victim holding ~$328k liquid). So initiating wet work is a *loss* unless the target is
a whale or a contract funds it.

**The defensive stack:** a target can be untouchable via **eight** distinct states — safehouse,
bodyguard, witpro, respawn token, pen-safe, the hole, hospital, jail. A rich, careful player is
effectively unkillable, and #2 means even a successful kill barely dents them.

**The result:** the "mafia" theme's central verb (put a rival in the river) is a **status hobby funded
by someone else's loss** (a contract pot), not an economic driver. This may be intentional — but it's a
sharp gap between the theme and the incentives, and it's *worsened* by #1 (the rich earn passively, so
they have no reason to take PvP risk) and #2 (killing them doesn't matter).

**PROPOSED levers (founder pick; NOT applied):**
- **L3a — make the passive stack a PvP target. ✅ BUILT — THE SACKING.** A PLAYER fire-kill now lets the
  killer **SEIZE one of the victim's business fronts** (the endgame passive-income engine) instead of it
  dying with the street — the territory-seizure precedent extended to personal fronts. Pure ownership move
  (§10.4-neutral — a front is not a currency; pending forfeits; clocks reset), gated so the killer can only
  *hold* a front they could run (level + an empty kind slot). Now the passive empire is genuine RISK CAPITAL
  and the kill economy has a prize worth far more than the ammo — the keystone that converges #1/#2/#3. Lever
  `M3.SACK_ON_KILL` (default on); `test/sacking.js` (45th suite). **DONE.**
- **L3b — cap the untouchable stack. ✅ BUILT — THE SHIELD CAP.** The safehouse is now a rolling-window
  token bucket (`M3.SAFEHOUSE_DAILY_CAP_MS` 12h/day — the wash-cap twin): you can shelter to weather a
  contract, but three 4h stays fill the bucket and the fourth is refused (`safe_cap`) — no one is
  permanently unreachable, the rich must surface. `safeCapSeconds` on the view; `test/shields.js`.
- **L3c — lower the kill cost floor. ✅ BUILT — THE CONTRACT'S BULLETS.** A kill that fulfils a PAID
  contract (any pool/directed/family/WANTED bounty → `bounty > 0`) now rebates `M3.CONTRACT_AMMO_REBATE`
  (0.5) of the rounds spent — a bounded, ledgered ammo faucet (`contract:rebate`) — so the pot doesn't
  carry the whole ammo loss and a smaller contract turns a hit +EV. A standalone kill pays no rebate
  (the standalone −EV stays). `test/shields.js`.

Recommendation: **L3a** — it's the keystone. It makes #1's passive wealth *risk capital*, gives #3 a
real prize, and makes #2's death actually cost the dynasty's income base.

> **Note the three findings converge:** #1 (too much safe passive wealth), #2 (death is free), #3 (PvP
> is pointless) are **one problem** — the endgame is a safe idle-collector with no threat model. **L3a
> (passive wealth is PvP-losable) is the single change that addresses all three.** That is the headline
> recommendation of this review.

---

## FINDING #6 — breadth ≫ depth of the moment-to-moment loop (PROPOSED direction)

35 systems, 22 tabs, ~279 routes — but the core verbs are shallow (crime = one click + RNG; endgame =
collect + watch cooldowns + place a bet). Most of the "depth" is accounting depth (escrows/ledgers) the
player never sees, not decision depth.

This isn't a bug to fix; it's a **direction call**. The honest options:
- **D6a — stop adding systems, deepen one core verb.** Give *crime* a real decision (risk/reward
  choice per job: go loud for more cash + heat, or quiet; pick a crew loadout). One verb with a
  meaningful choice beats a 36th system.
- **D6b — accept it as an idle/collection game** and lean in (the systems ARE the content; the loop is
  collection + status). Then #1/#2/#3 matter *more*, because collection-game economies live or die on
  their sink/faucet balance and their status spine.

Recommendation: **D6b is what the game actually is** — so the priority is fixing the economy (#1) and
giving it a spine (#4, below), not injecting twitch depth. If Jorge wants more *game*, **D6a on the
crime loop** is the highest-leverage single addition.

---

## BUILT (additive, §10.4-free — shipped alongside this doc)

- **#4 — THE CITY STANDING (a unifying "who's winning" spine).** 35 leaderboards, no spine → one
  aggregate metric + `GET /v1/leaderboard/city` that ranks players across the axes, so the endgame has a
  single answer to "what am I climbing." Pure status aggregation, zero §10.4. *(see the City Standing
  commit / CLAUDE.md entry.)*
- **#5 — free-path legibility (BUILT).** The wage card now carries a plain "Free trial vs Made Man —
  straight facts, no promises" disclosure (a free account plays the WHOLE game; minting unlocks the
  wage payroll + on-chain extraction, nothing else). Facts, not earnings marketing — the counsel-gated
  line holds.
- **#7 — consistency snags (VERIFIED / already shipped).** Cooldown legibility was already live (the
  `[data-until]` ticker from the overnight UX drop). The ownership-transfer-flag class is **verified
  clean**: all 5 car-transfer sites clear `pledged/listed/race_limit/pink_slip/nos` (the races-audit
  fix) and the business takeover resets `spec/scrutiny` — no other table transfers ownership with a
  stale consent flag. The remaining snag — **inconsistent cooldown WINDOWS** (1h/4h/6h/8h/12h/24h with
  no legible rhythm) — is a pacing observation, not a bug; left as a founder tuning call.

---

## Decision summary

| # | issue | status | founder action |
|---|---|---|---|
| 1 | passive stack ≫ active loop ($49M/day, 6× the grind) | **L1a+L1b BUILT** | stack → $21.6M/day (2.27× cut), ~2–3.5× the grind; L1c/L1d further dials |
| 2 | death costs nothing for the established | **L2a BUILT** | the Death Duty (25% of liquid $OMR); L2b/L2c further flavor |
| 3 | PvP is −EV and opt-out-able | **L3a/L3b/L3c ALL BUILT** | the Sacking + the Shield Cap + the Contract's Bullets — done |
| 4 | 35 leaderboards, no spine | **BUILT** | — |
| 5 | "pay then earn" legibility | **BUILT** | (messaging still counsel-gated) |
| 6 | breadth ≫ depth | **PROPOSED** | choose D6a (deepen crime) or D6b (embrace collection) |
| 7 | consistency snags | **VERIFIED / shipped** | (cooldown-window rhythm = a tuning call) |

**The one thing to take away:** #1, #2, #3 are the same problem, and **L3a — make passive wealth
losable to PvP — is the single lever that fixes all three.** Everything else is polish.
