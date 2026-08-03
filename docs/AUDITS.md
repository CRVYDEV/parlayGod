# The audit reports — an index, and a warning about reading them

There are 61 of these, 8985 lines in total. Every one is a **point-in-time** report: it describes what was
true of the tree on the day it was written, including findings that were fixed hours later in the same
session. None of them is a description of the system as it stands.

**If you want to know how OMERTÀ works now, read `SPEC.md`.** If you want to know what the balance levers
are, read `BALANCE.md`; what is signed, `SIGN-OFF.md`; how to deploy, `DEPLOY.md` and `CHAIN-DEPLOY.md`.

These reports are kept because they are the only record of WHY a lot of the code looks the way it does —
a comment saying "AUDIT-full-system-v2 C-HIGH-1" is only meaningful with the report to read. Some 100
source comments cite one of these by name, which is also why they have not been moved into a
subdirectory: a citation that no longer resolves is worse than a cluttered root.

A finding described here as "flagged, not patched" may since have been applied — `SIGN-OFF.md` is the
record of what was decided, not this file.

| report | written | lines | subject |
|---|---|---|---|
| `AUDIT-casino-tables.md` | 2026-07-21 | 59 | AUDIT — Gambling Den step three (blackjack + heads-up hold'em) |
| `AUDIT-casino-tournament.md` | 2026-07-21 | 58 | AUDIT — Gambling Den step four (the poker tournament) |
| `AUDIT-chain-onchain.md` | 2026-07-18 | 161 | AUDIT — the chain rail, on-chain + interactions (max-effort, five-lens red-team) |
| `AUDIT-content-drops.md` | 2026-07-16 | 117 | AUDIT — the post-sign-off content drops (vendettas, crew heists, convoys, the Commission) |
| `AUDIT-contracts.md` | 2026-07-14 | 55 | OMERTÀ M6-A (Solidity) — Security Audit — 2026-07 |
| `AUDIT-convoy-npc-trucking.md` | 2026-07-22 | 57 | AUDIT — Convoy step three (NPC trucking) |
| `AUDIT-core-loop.md` | 2026-07-15 | 145 | OMERTÀ — Core Game-Loop Audit (design/experience lens) |
| `AUDIT-deep-deferred.md` | 2026-07-24 | 70 | AUDIT — the deep-system deferred four (Estate 2 · Commission 3 · Loan House · Ring+Bracket) |
| `AUDIT-five-pillars.md` | 2026-07-23 | 98 | AUDIT — The Five Pillars (honor · diplomacy · sovereignty · campaigns · bloodline) |
| `AUDIT-full-game.md` | 2026-07-15 | 194 | OMERTÀ — Full Game Audit (code · economy · loops · new-player) |
| `AUDIT-full-product.md` | 2026-07-23 | 120 | AUDIT — Full-Product Max-Effort Red-Team (2026-07-23 → overnight) |
| `AUDIT-full-surface.md` | 2026-07-20 | 139 | AUDIT — full-surface red-team (2026-07-20) |
| `AUDIT-full-system-v2.md` | 2026-07-21 | 152 | AUDIT-full-system-v2 — overnight max-effort full-system red-team (2026-07-21) |
| `AUDIT-full-system-v3.md` | 2026-07-21 | 99 | AUDIT — full-system red-team v3 |
| `AUDIT-full-system-v4.md` | 2026-07-21 | 124 | AUDIT-full-system-v4.md — full-system red-team (post-Futurity / post-Uprising) |
| `AUDIT-full-system.md` | 2026-07-17 | 104 | AUDIT — full-system max-effort red-team (M1 → M8 + Risk-to-Earn + chain) |
| `AUDIT-gameplay-chain.md` | 2026-07-14 | 128 | OMERTÀ Full Audit — gameplay loops, chain service, contracts, UX (2026-07-14) |
| `AUDIT-interactions.md` | 2026-07-15 | 90 | OMERTÀ — Interaction Audit (contracts × Risk-to-Earn features) |
| `AUDIT-law-world.md` | 2026-07-17 | 102 | AUDIT — The Law / RICO and The Living World (five-lens red-team) |
| `AUDIT-loan-sharking-step-three.md` | 2026-07-18 | 62 | AUDIT — Loan Sharking step three (the paper market) |
| `AUDIT-loan-sharking-step-two.md` | 2026-07-18 | 79 | AUDIT — Loan Sharking step two (secured credit & enforcement) |
| `AUDIT-loan-sharking.md` | 2026-07-18 | 118 | AUDIT — Loan Sharking (the Shylock), step one |
| `AUDIT-loan-wanted.md` | 2026-07-18 | 127 | AUDIT — Loan Sharking step four (WANTED) |
| `AUDIT-market-skills-underworld.md` | 2026-07-17 | 143 | Audit — Black Market, Skills, and the Underworld (steps 1–5) |
| `AUDIT-marriage-soldiers.md` | 2026-07-23 | 80 | AUDIT — Marriages & the Consigliere + Named Soldiers (founder picks #2+#3) |
| `AUDIT-megaproject.md` | 2026-07-23 | 48 | AUDIT — THE MEGAPROJECT (founder pick #1) — focused three-lens red-team |
| `AUDIT-population.md` | 2026-07-25 | 213 | AUDIT — THE POPULATION (steps one + two) |
| `AUDIT-port-step-four.md` | 2026-07-21 | 50 | AUDIT — The Port step four (the contraband market + berths) |
| `AUDIT-port-step-three.md` | 2026-07-21 | 54 | AUDIT — The Port step three (the Smuggler's Legend + the Harbormaster) |
| `AUDIT-port-step-two.md` | 2026-07-21 | 76 | AUDIT — The Port step two (naval upgrades + PIRACY + rendezvous) |
| `AUDIT-portfolio.md` | 2026-07-19 | 88 | AUDIT — The Portfolio ("Going Legit" / RWA) + all contract interactions |
| `AUDIT-redteam-loop.md` | 2026-07-22 | 2618 | AUDIT-redteam-loop.md — autonomous overnight red-team (rounds) |
| `AUDIT-rwa-float.md` | 2026-07-23 | 95 | AUDIT — THE FLOAT (the full-reserve RWA layer, R2 redesigned) |
| `AUDIT-secrets-collection.md` | 2026-07-23 | 118 | AUDIT — Blackmail & Secrets + The Collection (founder picks #7 + #8) |
| `AUDIT-session-drops-2.md` | 2026-07-21 | 99 | AUDIT — session drops v2 (Territory 3, Pen 4–5, faucet retunes) |
| `AUDIT-session-drops.md` | 2026-07-20 | 100 | AUDIT — session content-drops red-team (Boxing 3–5, Skills 2, Wire 2, World 2–3) |
| `AUDIT-session-races-convoy-vendetta.md` | 2026-07-22 | 61 | AUDIT — session drops (Street Races 2–3, Convoy 3, Vendettas 2) |
| `AUDIT-sim.md` | 2026-07-16 | 123 | OMERTÀ — Full Sim Audit (core loops, contract interactions, technical + economic bugs) |
| `AUDIT-skills-prestige-and-reroll.md` | 2026-07-21 | 121 | AUDIT — Skills step three (prestige carry) + randomized builds & the paid re-roll |
| `AUDIT-slate-drops.md` | 2026-07-24 | 86 | AUDIT — the slate trio: THE DUELING LADDER (#5) · CLUE SCROLLS (#4) · SEASONAL LEAGUE MODIFIERS (#6) |
| `AUDIT-stakes-spine-session.md` | 2026-07-24 | 113 | AUDIT — the stakes/spine session (L1/L2/L3 + the three entry verbs) |
| `AUDIT-street-races-step-two.md` | 2026-07-22 | 67 | AUDIT — Street Races step two (PINK SLIPS + NITROUS) |
| `AUDIT-street-races.md` | 2026-07-21 | 64 | AUDIT — Street Races (the new content drop) |
| `AUDIT-territory-racket-wars.md` | 2026-07-21 | 55 | AUDIT — Territory step four (fortification + rival raids) |
| `AUDIT-the-pen-step-two.md` | 2026-07-18 | 78 | AUDIT — The Pen step two (three-lens red-team) |
| `AUDIT-the-pen.md` | 2026-07-18 | 83 | AUDIT — The Pen (three-lens red-team) |
| `AUDIT-tier1-deepening.md` | 2026-07-24 | 75 | AUDIT — the Tier-1 → Tier-4 deepening program (6 systems) |
| `AUDIT-tier2-deepening.md` | 2026-07-24 | 87 | AUDIT — the Tier-2 → Tier-4 deepening program (4 systems) |
| `AUDIT-tier3-deepening.md` | 2026-07-24 | 127 | AUDIT — the Tier-3 → Tier-4 deepening program (combined red-team) |
| `AUDIT-track-stable.md` | 2026-07-22 | 206 | AUDIT — The Track + The Stable (the racing drops) |
| `AUDIT-ux-gameplay-flow.md` | 2026-07-19 | 178 | AUDIT — UI/UX & gameplay-flow (the client, the onboarding, the new-player journey) |
| `AUDIT-value-creation.md` | 2026-07-23 | 164 | AUDIT — The Value-Creation Drops (max-effort red-team, 2026-07-23) |
| `AUDIT-wire-step-four.md` | 2026-07-21 | 45 | AUDIT — The Wire step four (the Spymaster's Tradecraft + the Watchdog) |
| `AUDIT-wire-step-three.md` | 2026-07-21 | 86 | AUDIT — The Wire, step three: the counter-intel triad (DISINFORMATION + THE INFORMANT) |
| `AUDIT-world-frontier.md` | 2026-07-21 | 70 | AUDIT — World step four (THE FRONTIER MADE REAL) |
| `AUDIT-world-occupation.md` | 2026-07-21 | 70 | AUDIT — World step five: THE OCCUPATION (NPC-held core districts) |
| `AUDIT-tokenomics-v2.md` | 2026-07-27 | 112 | AUDIT — Tokenomics v2 step 1 (THE EXCHANGE + THE FAMILY YIELD) |
| `AUDIT-tokenomics-v2-steps-2-3.md` | 2026-07-28 | 150 | RED-TEAM — Tokenomics v2 steps 2+3 (the retirements, the rewritten buyback, the re-sourced float) |
| `AUDIT-full-sweep.md` | 2026-07-27 | 205 | AUDIT — the full line-by-line sweep (7 mechanical lenses over the whole tree) |
| `AUDIT-world-uprising.md` | 2026-07-22 | 79 | AUDIT — World step six (THE UPRISING) |
| `AUDIT-oracle.md` | 2026-07-29 | 240 | AUDIT — the accretion oracle (OmrTwapOracle + OmertaBond wall 4 + the backend clamp) |
| `AUDIT-trades.md` | 2026-07-30 | 85 | AUDIT — THE TRADES pillar (steps 1-4), combined red-team |
| `AUDIT-street-life.md` | 2026-07-30 | 137 | AUDIT — STREET WAR step two + STREET LIFE (task #319) |
| `AUDIT-street-war-step-three.md` | 2026-07-31 | 186 | AUDIT — Street War step three (THE TAKE, revenge teeth, resident stables) |
| `AUDIT-favor-street-life-two.md` | 2026-07-31 | 195 | AUDIT — THE FAVOR + Street Life step two (escrowed player calls, corner chains) |
| `AUDIT-early-game-drops.md` | 2026-08-01 | 118 | AUDIT — the early-game batch (work board, trades strip, level-up, catalog, the crew door) |
| `AUDIT-strategy-package.md` | 2026-08-02 | 220 | AUDIT — the strategy package steps one to seven (sealed bid escrow, the watch, the roster, charters) |
| `AUDIT-economy-and-code.md` | 2026-08-03 | 184 | AUDIT — the full economic + code pass (the income ladders, the desk's anti-fabrication gate) |

Generated by hand; `test/docs.js` fails if a report exists that is not listed here, or if this
file lists one that does not exist.
