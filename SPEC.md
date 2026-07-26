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

**`rules.js` is the constants layer, in two files.** `rules.generated.js` holds the prototype's 22 data
tables (454 lines) and is overwritten wholesale by the extractor; `rules.tail.js` holds every helper,
catalog, ladder and founder-signed lever (3,134 lines) and the extractor never opens it. `rules.js`
re-exports both. Nothing in `src/` hardcodes a balance number.

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

### D1 — Reads take the write lock **(HIGH → PARTLY ADDRESSED)**
Every authed request, including 24 pure-read GET routes, opened `SELECT … FOR UPDATE` on the character
row and held it for the whole request, so a player's own requests serialized against each other and
each held a pooled connection throughout. **Observed in production:** four of one player's requests
queued on their own row for 1.0s / 2.1s / 2.3s / 4.3s.

**Shipped:** `withCharacterRead` / `readCharacter` in `game.js`, wired to **all 24 authed read GETs** —
`/v1/me` plus the 23 board routes the console polls on every WS event and every 30s. No authed GET
takes the character write lock any more.

The blocker was never the locking, it was that reads PERSIST accrual, and §7.1 accrual is gameplay:
it fires the Bureau raid, which sets `jail_until`. Stop reads persisting and the raid can only land
during an action, whose own jail gate then throws and rolls the raid back — retry until it misses and
a player filters out their own raids for free. Two designs tried to work around that and both were
rejected on measurement: **pg-mem implements no SAVEPOINT syntax at all**, and **pg-mem's ROLLBACK is
a no-op**, so a "roll the action back, re-settle accrual" scheme applied accrual twice and drifted
§10.4 by ~$23 per refused action *while the full suite and the sim passed over it*.

The shipped cut needs neither. `accrue()` is pure — `accrual.js` makes zero database calls — so a read
can accrue **in memory** with no lock and then look at what moved:

- **Nothing moved** → nothing to persist. The request completes having taken no lock and written
  nothing. `accrue()` returns early under one second, so this is exactly the rapid-poll traffic that
  was queueing.
- **Something moved** → hand off to `withCharacter`, which re-reads under `FOR UPDATE` and behaves as
  it always has, raid included.

So every outcome is either "changed nothing, wrote nothing" or "the audited path, verbatim" — no third
behaviour, no schema change, no new failure mode. A `readOnlyClient` proxy makes the side-effect-free
claim enforceable: a write from the read path throws instead of committing outside any transaction.

**Verified on real Postgres** (`pgcheck` §8, which pg-mem cannot express — it has no row locks): a read
answers while another session holds `FOR UPDATE` on that row, and answers promptly; the paired write
against the same row *does* block and abort on the pool's `lock_timeout`, which is what makes the read
result meaningful rather than vacuous.

**How the 23 board routes were cleared to move** — three independent passes, because the runtime guard
is a backstop, not a proof:
1. Every route's handler resolves to exactly one board function (1:1, no shared helpers).
2. Each of those 23 call graphs was walked transitively for `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`,
   including every awaited helper. **No writes anywhere**, at any depth.
3. All 23 are exercised by the suites (1–25 references each), and a full run trips the write guard
   **zero** times. Five of them are additionally proven lock-free against real Postgres in pgcheck §8.

**Red-teamed after shipping** (the three clearing passes above were all static; none of them was
someone trying to break it). Two findings, both fixed in-commit with regressions:

- **The guard did not cover every route it was claimed to.** Three reads (`/v1/duels`, `/v1/world`,
  `/v1/world/raids`) handed their board the raw `pool` instead of the guarded client, so the write
  guard never saw them. No live bug — all three are statically write-free — but "the guard makes the
  claim enforceable" was true of 20 routes, not 23, and the commit message said otherwise. All three
  now pass `client`; none of them calls `.connect()` or `Promise.all`, so it is a drop-in. A
  source-level tripwire now fails the suite if any read route hands its board the pool again
  (verified to fire, not merely present).
- **A leading SELECT does not make a statement a read.** The guard anchored at the start of the SQL,
  so `SELECT 1; INSERT …` and `WITH x AS (…) INSERT …` both sailed past it. It now also scans for the
  multi-word write forms anywhere in the statement — which do not appear by accident in a SELECT the
  way a bare `update` can (a column named `last_update` is safe: `_` is a word character, so `\b`
  does not match inside it). Regressions cover both bypasses AND the false-positive case.

**Accepted, and worth stating because it is a real behaviour change:** a read is no longer serialized
against that player's own actions, so a board can now render the character row as it was before an
action with child rows as they were after — the read holds no lock and spans several statements. It
is cosmetic (boards only render; nothing decides on it, and there is no §10.4 surface because nothing
is written), it self-corrects on the next poll, and the console already serializes its own authed
requests. A `REPEATABLE READ` transaction would close it at the cost of a snapshot held per read;
not worth it unless a torn board is actually observed.

**Verified clean under the same pass:** the decline→delegate path discards its in-memory mutations
(`loadOwned` returns fresh objects and `withCharacter` re-reads from scratch); no double connection
hold (the `finally` releases before delegating); the post-commit referral hooks are not lost by
skipping them on a clean read, because every gate they check only advances on an action — and the
worker sweep reconciles regardless; and the raid/indictment notifications still fire, because they
only ever exist on the dirty path that delegates.

**Remaining:**
1. A compare-and-swap would make even the *dirty* reads lock-free. It needs a version column: the
   obvious CAS key, `last_accrued_at`, round-trips through node-pg at millisecond precision and would
   never match Postgres's microseconds, so it must be an integer `accrual_seq` bumped on every persist.
   Worth doing only if reads after a real gap show up in production waits.

### D2 — pg-mem / Postgres divergence **(HIGH → ADDRESSED)**
All 48 suites run on pg-mem; production runs node-pg against Postgres. This class is not theoretical:
it produced a crash on every database restart (unhandled pool `'error'`) and a deprecated
`Promise.all` on a single pooled client. 37 modules carry pg-mem workaround comments (INT arithmetic,
correlated subqueries, no `random()`).

`tools/pgcheck.js` now runs automatically — `.github/workflows/ci.yml` boots the real server against a
Postgres 16 service container on every push and PR, alongside `npm test` and the sim. It asserts 19
properties pg-mem cannot express: the connection safety valves actually reach the server and a blocked
lock aborts on the pool's *own* `lock_timeout`, the process survives its backends being killed, the
core loop and every board read stay off 500, concurrent same-row writes serialize with no lost update,
§10.4 holds on real Postgres, the schema re-applies in place, and node-pg emits no deprecations.

Each check is mutation-verified: removing `pool.on('error')` from `db.js` reproduces the production
crash and the run exits non-zero; removing the connection `options` fails the three timeout checks.
The blocked-lock probe refuses to run at all when `lock_timeout` is 0 rather than queue forever — a
hung CI job is a worse signal than a failed one.

Residual: the divergence itself remains (the suites are still pg-mem, and that is the right trade for
their speed). CI narrows the blast radius; it does not close the gap.

### D3 — `server.js` is 2,396 lines registering 491 routes — **MOSTLY ADDRESSED**
**Now 1,771 lines; 220 of ~279 routes live in `src/routes/*.js` by domain** (casino, pen, speakeasy,
port, kitchen, territory, boxing, races, law, estate, stable, convoy, heists, underworld, diplomacy,
sov, leaderboards, modtools). Handler bodies moved verbatim; each module exports
`register(app, deps)` taking the same closure the handlers already read.

Verified by diffing fastify's own route table — method, url, `hasAuth`, `isMod`, sorted — before and
after every step, so what is mounted and how it is authenticated is provably unchanged.

Two things the route-table diff **cannot** see, both now guarded:

- **A moved handler still reading a `server.js` import registers fine and throws on first call.**
  `test/routes.js` scans each route module for identifiers it reads but never binds. This found four
  real breaks during the split (`crypto`, `TAX`, `withdrawTaxBps`, and the two websocket close
  helpers) and is verified to fail when an import is removed.
- **`test/preflight.js` listed `src/` flat**, so a `process.env` read moving into `src/routes/` became
  invisible to the drift detector that exists to catch exactly that. It now walks recursively.

Two things had to move rather than be re-derived: the websocket close helpers are declared above the
registrations so they can be passed in (a `const` further down is in its temporal dead zone at
register time), and `modRealTxHash` moved into the mod module, its only caller.

Residual: ~59 routes stay in `server.js` — the ones that are genuinely infrastructure (auth, the
websocket gateway, static files, health, openapi) plus small scattered families (`/v1/gangs`,
`/v1/streets`, `/v1/market`, `/v1/wire`, `/v1/world`, `/v1/business`, `/v1/loans`, `/v1/dynasty`)
whose registrations are interleaved with the code they sit next to. Those are worth moving only
alongside a reason to touch them.

### D4 — `social.js` is 2,003 lines **(MEDIUM)**
The PvP god-module: gangs, wars, turf, jumps, hits, death, the estate, bounties, vendettas, safehouse,
bodyguards, the sacking. It is the highest-risk file in the tree to change, and the estate path inside
it is the most consequential code in the game. A split along death/estate | contracts | gangs/turf |
combat lines would reduce blast radius.

### D5 — The `rules.js` tail had outgrown its generated head — **RESOLVED**
Split into `src/rules.generated.js` (the prototype's 22 data tables, machine-owned) +
`src/rules.tail.js` (every helper, catalog, ladder and founder-signed lever), with `src/rules.js`
re-exporting both so no import site changed. `tools/extract-rules.js` now writes ONE file and never
opens the hand-written half; `test/rules.js` enforces the seam and each of its five tripwires was
verified to fire.

Two corrections came out of doing it, both worth recording because the old notes were wrong in ways
that would have misled the next person:

- **The generated region was 454 lines, not 1,091.** The extractor only ever emitted the 22 tables and
  then re-appended everything from `export const CONSTANTS` onward verbatim. So the hand-written half
  was 3,134 lines — nearly 90% of the file, not 70%.
- **`levelOf`'s "RE-APPLY THIS LINE after any regeneration" warning was false.** `levelOf` sits below
  `CONSTANTS`, in the re-appended region, so the pacing override was already preserved automatically.
  A warning that describes a hazard that does not exist is worse than none: it tells a maintainer to
  hand-patch a line that is already correct.

The real hazard was the opposite of the documented one, and it was live in **both** directions.
Running the old extractor today would have:

- **deleted `recruitRankOf`** — a hand-written function used by the recruiters leaderboard, which sat
  in the gap between the last table and `CONSTANTS` that the extractor overwrote; and
- **resurrected the retired "Star the repo" First-Week task**, because `ONBOARD_TASKS` was re-emitted
  from the prototype, silently undoing a founder decision with nothing in the diff to notice.

Both are measured, not hypothesised — the pre-split extractor was run and the diff inspected. The
`ob_repo` removal was then applied to the PROTOTYPE (the car-catalog precedent), so it now survives a
regeneration; `test/rules.js` asserts that it stays retired.

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

1. ~~**Wire `pgcheck` into CI** (D2).~~ **DONE** — `.github/workflows/ci.yml`.
2. **Finish the lock-free read path** (D1). Days. Now blocked on a **design choice between three
   measured options** (see D1), not on implementation — two attempts were built and rejected on
   evidence. Still the highest architectural payoff.
3. ~~**Split `server.js`** into domain route modules (D3).~~ **DONE** — 220 routes into 17 modules,
   2,396 → 1,771 lines, route table proven identical, two new guards for what that diff can't see.
4. ~~**Split `rules.js`** into generated + tail (D5).~~ **DONE** — machine-owned tables in one file,
   hand-written everything in another, the extractor writes only the first, `test/rules.js` enforces it.
5. **Split `social.js`** along death/estate | contracts | gangs | combat (D4). Days, carefully, with the
   existing suites as the harness. Do this last of the splits — highest risk, highest reward.
6. **Consolidate the docs** (D7): one architecture doc (this file), one balance sheet, one deploy
   runbook, and archive the 25 point-in-time audit reports.
