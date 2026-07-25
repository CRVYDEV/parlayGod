# OMERTÀ — what exists, and what it owes

A complete inventory of the built system, and an honest technical-debt register.

Written 2026-07-25. Every number below was measured from the tree, not recalled.

---

## 1. Size, measured

| | |
|---|---|
| Backend modules | **73** files, **29,652** lines (`src/`) |
| Test suites | **48** files, **15,435** lines (`test/`) — ratio 0.52 test:src |
| HTTP routes | **491** registrations |
| Database tables | **161** (`schema.sql`, 2,203 lines) |
| Client | **4,631** lines (`public/index.html`, single file, zero dependencies) |
| Ops dashboard + wiki | `public/admin.html`, `public/wiki.html` |
| Smart contracts | **839** lines Solidity, 6 contracts, 73 Foundry tests passing |
| Harnesses | `tools/sim.js` (economy), `tools/playthrough.js` (player experience), `tools/pgcheck.js` (real Postgres) |
| Design + audit docs | **117** markdown files, 24,254 lines |
| Ledger invariants | 18 named escrow/identity checks + per-currency conservation, **drift-0** |

Roughly **55,000 lines** of code, tests, schema and contracts.

---

## 2. The architecture that has held

Everything is built on five load-bearing decisions. None has needed revision in ~47 systems.

**`rules.js` is the constants layer.** Lines 1–1,091 are auto-generated from the prototype and must
never be hand-edited; the remaining ~2,500 lines are the hand-written tail where every later system's
numbers live. Nothing in `src/` hardcodes a balance number.

**`withCharacter` is the transaction spine.** Every player action opens `SELECT … FOR UPDATE` on the
character row, runs §7.1 lazy accrual, executes the action, persists three tables, commits, then runs
post-commit hooks non-fatally. `withTwoCharacters` does the same for both parties of a PvP action,
locking in a stable global order (characters → accounts → gangs → singletons) that every module obeys.

**§10.4 is the conservation law.** Every value movement writes a `transactions` row with an enumerated
reason. `invariants.js` reconciles each currency bucket against its reason vocabulary nightly and on
demand; an unrecognised reason is itself an alarm. This is what makes a 47-system economy auditable.

**Lazy accrual, no global ticks.** Income, heat decay, regen and risk resolve from timestamps when
touched. There is no cron sweeping every player.

**Server-authoritative, always.** Client input is a choice, never a value. All randomness is
server-side and written to `rng_audit`.

---

## 3. Complete feature inventory

### 3.1 Core loop (M1–M2)
Auth (guest / X / Privy / agent keys, invite gate) · character creation with randomised
total-conserved stats · 29 crimes with three risk approaches (case it / standard / go loud) · the gym ·
the doc · bank with in-transit clearing · travel · 6 districts · the garage (60-car catalog, boost,
melt, fence, repair) · the workshop and consumables · trade goods on the deterministic §7.11 price hash ·
rackets and assets with lazy income · the AMM swap · staking (backed by a funded pool, not minted) ·
NFT gear mint · the 12h buyback worker.

### 3.2 Social and PvP (M3, M7)
Gangs (found/join/leave/kick/promote) · tribute and weekly family contracts · wars · turf seizure with
live district perks · jumps with intent (roll them / send a message) · the contract board (bounties as
browsable, lifecycle-managed pots) · player hitmen with an account-level reputation ladder · NPC hitmen ·
the safehouse (wealth-scaled, daily-capped) · family contracts from the treasury · bodyguards ·
server-side death and estate · busting · the escrowed exchange · vendettas and blood feuds (escalation
tiers, the sit-down, the blood-debt board) · notifications and the websocket gateway.

### 3.3 The Kitchen (M4)
Makings · the lab ladder with purity/yield/stealth modules · cook → collect · dealing with three plays
(careful / standard / flood) · cutting agents · crew hire, offline crew sales, and crew wages ("the nut") ·
Bureau raids resolved lazily in accrual · lay low · clean papers · the Kingpin legend.

### 3.4 Growth and retention (M4)
Paths · the Daily Score · missions · daily contracts · First Week onboarding with server-side
verification · the coach · Spread the Word daily social tasks · referrals (§7.13) with stepped spark
payouts, a tier-2 finder's fee, recruitment drives, and the Recruiters boards · THE BROADCAST (shareable
noir cards, public profiles, `?ref=` attribution) · telemetry.

### 3.5 Hardening (M5)
The §10.4 invariant job · token-bucket rate limits · idempotency keys · X/Privy OAuth with PKCE ·
season rollover · the closed-alpha invite gate · mod tools (ban, mod-kill, confiscate, audit) ·
`preflight.js` env classification with a drift-detecting test.

### 3.6 Chain (M6, mainnet-gated)
`OMR` ERC-20 with an owner-armed DEX sell tax · `VoucherClaim` (EIP-712, replay-proof, daily-capped) ·
`GearVault` ERC-1155 with per-id supply caps · `OMRStaking` · `OmertaFees` (mint / respawn / reroll) ·
`OmertaBond`. Backend: EIP-712 voucher signing in exact parity, the full-reserve withdrawal queue,
SIWE wallet linking, a polled `getLogs` watcher over a persisted cursor, the exit toll, the early-exit
surcharge.

### 3.7 Risk-to-Earn economy
Loot the living · located laundering · shield-not-bunker · the bank daily cap · THE VIG (real revenue →
buyback → reserve + prize pool) · the PLEX bridge · backed emission (staking paid from a funded pool) ·
THE STREET WAGE (a fixed, halving, endowment-capped daily emission to minted accounts) · THE RESERVE
BOND (protocol-owned liquidity, no reflexive mint) · THE FLOAT (RWA reserve — off-chain core, legal-gated).

### 3.8 The pillars
**Territory** — rackets with scale tiers and business types, the Bureau crackdown, fortification, rival
raids, upkeep, specialists and special operations, the Empire leaderboard.
**Business Empire** — five upgradeable fronts, private laundering, scrutiny and raids, shakedowns, the
pad, hostile takeover, the Launderer and Tycoon legends.
**The Casino** — craps, the Numbers, back-room PvP dice, the weekly fight and the fix, blackjack,
heads-up hold'em, the poker tournament and bracket, ring poker, THE TRACK, THE FUTURITY.
**The Stable** — buy, train, race, breed, the circuit, match races, THE STAKES, running in the card.
**Street Races** — the PvE circuit, PvP wagers, tuning, nitrous, pink slips, THE GRAND PRIX, THE WHEEL.
**Boxing** — recruit, train, the stable, exhibition bouts, the belt with mandatory defense, THE MAIN
EVENT parimutuel, the cornerman, the callout.
**The Pen** — the yard, work, commissary, protection, bribes, the shank, the hole, yard incidents, the
burner phone, the solo and co-op breakout, prison factions, the break rat.
**The Law / RICO** — the investigation meter, bribes and retainers, indictment and forfeiture, the
courtroom (plea / jury / trial), informants, witness protection, THE ENVELOPE, THE FOUNDATION.
**The Living World** — the visible city and forecast, NPC cartels, co-op raids, economic weather, the
day/night clock, the war effort, the frontier with tribute and invasion, NPC-occupied core districts,
THE UPRISING.
**The Port** — boats, routes, interdiction, naval upgrades, piracy, rendezvous, the smuggler's legend,
the harbormaster toll, the contraband market, berths.
**Convoys** — bulk shipping, guards, ambushes, tolls, insurance, NPC trucking, route notoriety.
**Crew Heists** — a 12-job ladder, roles, casing, the inside job, THE RAT, the fence, crew notoriety.
**The Black Market** — car auctions with reserves and anti-snipe, district-pinned goods, buy orders.
**Loan Sharking** — offers, collateral, directed loans, the welsher mark, the paper market, WANTED
pursuit, the backed Loan House.
**The Speakeasy** — open a club, decor tiers, buying rounds, the back-room table, prohibition raids,
renown, the buyout, the standover, ETH cosmetic decor.
**The Commission** — seats by seasonal standing, weekly decrees, the veto, proposals with deposits,
THE LEVY, the override, THE STATESMAN.
**Skills** — a 3×3 tree, tier-4 capstones, active abilities, per-skill respec, prestige carry,
grandmastery.
**The Underworld** — six named fixtures, standing with decay, gifts, the daily lead and streaks,
rivalries, grudges and penance, weekly favors, errand chains.
**THE WIRE** — wiretaps, sweeps, the tiered subscription, the bug trace, the dossier, disinformation,
informants, the spymaster ladder, the watchdog, the standing watch.
**Secrets & Blackmail** · **The Collection** · **THE MEGAPROJECT** · **The Estate** and **Auction
House** (with player consignment) · **The Portfolio / Dynasty Fund** (dividends, tiers, family books) ·
**The Store** and **The Ledger** season pass · **Landmarks** · **Vanity** · **Clue Scrolls** ·
**The Dueling Ladder** (ELO, divisions, weapon styles, the season belt) · **Seasonal League Modifiers** ·
**Honor & Infamy** · **Diplomacy** (pacts, coalitions) · **Sovereignty** (strongholds, sieges, income) ·
**Underworld Campaigns** · **The Bloodline** · **Marriages & the Consigliere** · **Named Soldiers** with
permadeath · **THE POPULATION** (NPC residents that behave and renew) · **City Standing** (the spine
metric) · **THE CELLPHONE** (inbox, DMs, blocked lines).

### 3.9 Surfaces
The playable console (22 tabs, progressive disclosure, 15 language packs, live feed, atmosphere layer) ·
`/admin` live-ops dashboard · `/wiki` codex · the Agent Gateway (`AGENTS.md`, OpenAPI, `llms.txt`, the
Opportunity Board, the agent leaderboard, `omerta-mcp`) · THE BROADCAST cards and profiles ·
`/health` and the backup watchdog.

---

## 4. Technical debt register

Ranked by risk × cost to fix. Each item states the evidence.

### D1 — Reads take the write lock **(HIGH value, designed fix known)**
Every authed request, including 24 pure-read GET routes, opens `SELECT … FOR UPDATE` on the character
row. Reads therefore serialize against everything else for that player and hold a pooled connection
throughout. **Observed in production:** four of one player's requests queued on their own row for
1.0s / 2.1s / 2.3s / 4.3s.

Mitigated client-side (peak concurrent authed requests measured 6 → 1). The architectural fix was
built and reverted the same night: with reads no longer persisting, a Bureau raid can only fire during
an action, the raid sets `jail_until`, that action's own jail gate throws, and the rollback undoes the
raid. Completing it requires accrual's side-effects to survive a failed action — a two-phase commit
inside `withCharacter`. **This is the single highest-value piece of remaining work.**

### D2 — pg-mem / Postgres divergence **(HIGH, partially addressed)**
All 48 suites run on pg-mem; production runs node-pg against Postgres. This class is not theoretical:
tonight it produced a crash on every database restart (unhandled pool `'error'`) and a deprecated
`Promise.all` on a single pooled client. 37 modules carry pg-mem workaround comments (INT arithmetic,
correlated subqueries, no `random()`). `tools/pgcheck.js` exists but **is not wired into `npm test`**,
so nothing forces it to run.

### D3 — `server.js` is 2,396 lines registering 491 routes **(MEDIUM)**
One file wires every route. It works and is consistently structured, but it is the natural next split
(per-domain route modules). Cost is low; the risk is churn in a file every system touches.

### D4 — `social.js` is 2,003 lines **(MEDIUM)**
The PvP god-module: gangs, wars, turf, jumps, hits, death, the estate, bounties, vendettas, safehouse,
bodyguards, the sacking. It is the highest-risk file in the tree to change, and the estate path inside
it is the most consequential code in the game. A split along death/estate | contracts | gangs/turf |
combat lines would reduce blast radius.

### D5 — The `rules.js` tail has outgrown its generated head **(MEDIUM)**
1,091 generated lines vs ~2,500 hand-written. The "generated, never edit" rule now covers 30% of the
file, and re-running `tools/extract-rules.js` requires hand-preserving the tail plus known overrides
(`levelOf`'s divisor, the pacing pass). A physical split — `rules.generated.js` + `rules.tail.js` —
would make the contract enforceable instead of remembered.

### D6 — Lock discipline is enforced by convention **(MEDIUM, accepted)**
200+ `FOR UPDATE` sites obey a global lock order maintained by comments, code review and ~30 red-team
passes. It has held, and the audits keep finding the exceptions — but it is enforced by discipline, not
by the type system or a shared helper.

### D7 — Documentation mass **(LOW-MEDIUM)**
117 markdown files, 24k lines, with `CLAUDE.md` alone ~1,000 lines of dense prose. Two codices already
drifted once (a test now guards it). Onboarding a second developer means reading a novel.

### D8 — No real migration tooling **(LOW, guarded)**
`schema.sql` is all `CREATE TABLE IF NOT EXISTS` plus a derived `ADD COLUMN IF NOT EXISTS` pass. It
handles fresh installs and in-place upgrades, and `test/migrate.js` guards column disposition. It does
not handle renames, backfills, or destructive changes.

### D9 — Unsigned balance levers **(LOW, tracked)**
Many numbers remain "proposed defaults" pending sim + founder sign-off. `SIGN-OFF.md` and `BALANCE.md`
track them; the last sweep resolved every open row. This is process debt, not code debt.

### D10 — The client is one 4,631-line file **(LOW, deliberate)**
Zero dependencies, zero build step — a real asset for deployment. It is at the edge of comfortable.

---

## 5. Is a rewrite needed?

**No. A rewrite would be the single most destructive thing you could do to this codebase.**

The reasoning, plainly:

**The valuable asset is not the code — it is the accumulated correctness.** ~30 red-team passes,
hundreds of fixed findings, 48 suites of regressions, 18 escrow identities, an economy simulated to
drift-0, contract invariants under fuzz. Nearly all of that knowledge lives in tests and in the
specific shape of the code. A rewrite discards it and re-earns every bug.

**The architecture has not buckled.** Adding a system has meant: a module, its routes, its tests, and
its §10.4 reasoning. Forty-seven systems went in that way and the spine — `rules` → `game` →
modules → `server`, with the ledger underneath — never had to change. That is the signature of a
design that fits its problem.

**The measured debt is local, not structural.** Every item in §4 is a bounded refactor of one file or
one path. None requires touching the transaction model, the ledger, or the data model. There is no
"we built it on the wrong foundation" item on that list — which is exactly the item a rewrite exists
to solve.

**The test ratio is real.** 0.52 lines of test per line of source, with suites that assert economic
identities rather than just call functions. That is what makes incremental refactoring safe, and it is
precisely what a rewrite throws away.

The honest counter-argument: the system is large enough that **no one person holds it in their head**,
and the documentation load (D7) is real. But that is an argument for better structure and better
onboarding docs — not for retyping 55,000 lines.

**Recommendation: no rewrite. Targeted refactors, in the order below.**

---

## 6. Recommended sequence

1. **Wire `pgcheck` into CI** (D2). Hours. Nothing else on this list prevents a repeat of tonight.
2. **Finish the lock-free read path** (D1). Days. Two-phase commit in `withCharacter` so accrual
   survives a failed action, then reads stop taking write locks. Highest architectural payoff.
3. **Split `rules.js`** into generated + tail (D5). Hours. Makes ground rule #2 mechanically enforceable.
4. **Split `server.js`** into domain route modules (D3). A day. Pure mechanical relief.
5. **Split `social.js`** along death/estate | contracts | gangs | combat (D4). Days, carefully, with the
   existing suites as the harness. Do this last of the splits — highest risk, highest reward.
6. **Consolidate the docs** (D7): one architecture doc (this file), one balance sheet, one deploy
   runbook, and archive the 25 point-in-time audit reports.
