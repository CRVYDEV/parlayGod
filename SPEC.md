# OMERTÀ — what exists, and what it owes

A complete inventory of the built system, and an honest technical-debt register.

Written 2026-07-25. Every number below was measured from the tree, not recalled.

---

## 1. Size, measured

| | |
|---|---|
| Backend modules | **102** files, **31296** lines (`src/`, incl. `src/routes/` and `src/social/`) |
| Test suites | **57** files, **18489** lines (`test/`) — ratio 0.59 test:src |
| HTTP routes | **497** registrations |
| Database tables | **166** (`schema.sql`, 2,290 lines) |
| Client | **5,652** lines (`public/index.html`, single file, zero dependencies) |
| Ops dashboard + wiki | `public/admin.html`, `public/wiki.html` |
| Smart contracts | **839** lines Solidity, 6 contracts, 73 Foundry tests passing |
| Harnesses | `tools/sim.js` (economy), `tools/playthrough.js` (player experience), `tools/pgcheck.js` (real Postgres), `tools/loadtest.js` (concurrency), `tools/chaos.js` (interruption), `tools/mobile.js` (the screens, at phone size), `tools/scale.js` (market liquidity at population scale) |
| Design + audit docs | **133** markdown files, **28914** lines — indexed in `docs/AUDITS.md`, which states they are point-in-time |
| Ledger invariants | 18 named escrow/identity checks + per-currency conservation, **drift-0** |

Roughly **55,000 lines** of code, tests, schema and contracts.

---

## 2. The architecture that has held

Everything is built on five load-bearing decisions. None has needed revision in ~47 systems.

**`rules.js` is the constants layer, in two files.** `rules.generated.js` holds the prototype's 22 data
tables (455 lines) and is overwritten wholesale by the extractor; `rules.tail.js` holds every helper,
catalog, ladder and founder-signed lever (3223 lines) and the extractor never opens it. `rules.js`
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


**Consequence audit (2026-07-26).** D1 is the only change in the split programme that altered
semantics rather than moving code, so its consequences were traced rather than assumed. Four classes,
each measured:

1. **Do reads still checkpoint accrual?** YES — measured against a live server, not read off the
   source. The fast path skips the write only when `accrue()` provably changed nothing (it early-
   returns under one second); anything with real time behind it fails the fingerprint, falls back to
   `withCharacter`, and persists. A read 20 minutes after the last checkpoint advances
   `last_accrued_at` exactly as it did before D1. This matters because `accrue()` is **not**
   split-neutral — measured, a 4-hour step and 240 one-minute steps disagree on `heat_exposure`
   (0 vs 19.5) and on bank interest (the bucket is capped per BURST as well as per day, so one big
   step earns 8h of interest and polled steps earn 12h/day) — so if reads had stopped checkpointing,
   an idle-but-polling player would have drifted onto the offline-returner treatment on every
   time-metered surface. They have not. Both facts are now asserted in `test/hardening.js` and both
   assertions were shown non-vacuous by flipping them.
2. **Are the 24 read handlers really side-effect free?** YES, re-verified across all 23 board
   functions (11–83 lines each) — none calls `h.track`/`h.notify`/`h.ledger`/`h.bumpDaily`, none
   issues write SQL, none takes a lock. Worth recording HOW: the first pass reported "clean" from an
   extraction that returned **zero lines for every function**. A check that examines nothing agrees
   with everything.
3. **The write guard was a backstop with holes.** Probed rather than trusted: MERGE, `COPY … FROM`,
   `SELECT … INTO`, `setval`/`nextval`, an advisory lock and `SELECT … FOR UPDATE` all sailed past the
   first version. FOR UPDATE is the interesting one — with no BEGIN on this path the lock is taken and
   dropped in the same statement, so it looks like protection and is not. All now blocked, with three
   legitimate reads (a column named `last_update`, a join, a `LIKE` count) asserted to still pass.
4. **Tests reading raw DB columns across API calls.** Only the actor's own row is affected (a read
   never touches a third party's), which clears the `test/intrigue.js` exposure assertions. The one
   real instance was `test/port.js`, already fixed — but the explanation committed with that fix was
   **wrong**: it blamed D1 for reads no longer checkpointing. They do. The confound is that the
   intervening `meOf`/`cashOf` calls are the captain's OWN requests and bank his accrual after the raw
   sample, which was equally true before D1. Comment corrected.

Net: no production behaviour difference found. One incorrect explanation corrected, one vacuous check
replaced with a real one, and the guard tightened from six known holes to none.

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

### D4 — `social.js` was 2,003 lines — **RESOLVED**
Split into a layered package under `src/social/` — combat, estate, contracts, defense, gangs,
exchange, shared — with `social.js` as a facade re-exporting the same 37 names EXPLICITLY (not by
star, so the package's private helpers stay private). No call site changed.

The layering is the point: nothing lower imports anything higher, so the package is acyclic by
construction. `combat` reaches down into contracts (a kill pays the pot), defense (a bodyguard
absorbs it), the estate (the body) and gangs (war scoring); the estate reaches into gangs
(`removeMember`) and contracts (`refundPot`); nothing reaches back up. `runEstate` — the most
consequential function in the game — now sits in a 435-line file rather than buried mid-way through
a 2,000-line one.

Verified as a LOGIC move, which needs more than the route-table diff the other splits used: all 61
definitions are present byte-identical, the public surface is unchanged (same names, kinds and
arity, compared against the pre-split module loaded side by side), every module imports every
dependency it still uses, and suite + sim + pgcheck are green.

**A guard went quiet rather than failing, and that is the finding worth keeping.** `test/migrate.js`
proves every estate-wiped table really has a `DELETE FROM` somewhere in `src/`, and it listed `src/`
FLAT — so moving `runEstate` into a subdirectory made the entire estate wipe invisible to it. This
was the second occurrence (`test/preflight.js` did the same when the route modules moved), so the
recursive walk now lives in `test/lib/srcfiles.js` and both scanners use it; both were then verified
to fire against a file in `src/social/`. Any future guard that scans the tree should use it.

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

### D6 — Lock discipline is enforced by convention **(MEDIUM, accepted — now MEASURED)**
200+ `FOR UPDATE` sites obey a global lock order maintained by comments, code review and ~30 red-team
passes. It has held, and the audits keep finding the exceptions — but it is enforced by discipline, not
by the type system or a shared helper.

**It now has evidence rather than only argument.** `tools/loadtest.js` drives 5–50 concurrent players
through a contention-heavy mix against real Postgres and reads `pg_stat_database.deadlocks` before and
after — the only place a deadlock is visible, since the codebase maps `40P01` to a retryable
`contention` error, so a lock-order bug can fire constantly while every request still succeeds.
Measured at every level up to 50 players, with hundreds of two-party `withTwoCharacters` acquisitions
converging on a handful of victims: **zero deadlocks, zero `contention` retries, and §10.4 unmoved.**

The same run answered a question that could not be reasoned about: throughput is FLAT (~175 req/s) from
5 players to 50 while latency rises roughly linearly — a saturated CPU queue, not a lock wall (which
looks superlinear and produces deadlocks). So capacity here is bought with CPU, not with a locking
rewrite. D6 stays accepted-as-is; the convention is now known to hold under load, not just under review.

### D7 — Documentation mass **(LOW-MEDIUM, partly addressed)**
127 markdown files, 26k lines, with CLAUDE.md alone 5368 lines of dense prose. Two codices already
drifted once (a test now guards it). Onboarding a second developer means reading a novel.

**Addressed: the prose that a reader could ACT on is now machine-checked.** Stale prose does not fail
loudly — it makes the next maintainer confidently do the wrong thing, and this pass found five live
examples, including a comment instructing the reader to re-apply a line by hand after every extractor
run (the hazard had not existed since the rules split), a "1,091 auto-generated lines" figure whose real
value was 454, a module count that under-reported by 27 the moment code moved into subdirectories, and
the `~1,000 lines` self-description this very section carried while being 5,368. So `test/docs.js` (the
52nd suite) asserts every figure in §1 against the tree, the rules-seam split, that no doc misstates its
own size, that the false by-hand warning cannot return, and that `docs/AUDITS.md` indexes every audit
report; `test/routes.js` asserts the route count, which needs the app booted. All nine tripwires were
mutation-tested. File COUNTS are exact; LINE totals get a 2% band, because a guard that nags on every
unrelated edit gets deleted, and every error worth catching here was off by 27%, 140% or 5×.

`docs/AUDITS.md` indexes all 57 audit reports with dates and subjects, and says plainly that they are
point-in-time records while this file is what is current. They were deliberately NOT relocated: 68
source comments name a design doc and 32 name an audit report, so moving them would stale 100 references
to gain a tidier root. CLAUDE.md's chronological drop log was likewise kept in place, for a sharper
reason — ~414 comments in `src/` cite a pattern by name ("the fade pattern", "the refundPot discipline"),
and that log is where those names are defined, so it is the codebase's precedent lookup table and it
only works because it is the file a session loads automatically. It instead gained a header saying what
it is and how to read it (search it; do not read it front to back), and its stale opening claim that the
chain is Solana was corrected.

What remains is the mass itself. 26k lines of markdown is a lot to hand a second developer, and the only
real reduction would be deleting history, which costs more than it saves.

### D8 — No real migration tooling **(LOW, guarded)**
`schema.sql` is all `CREATE TABLE IF NOT EXISTS` plus a derived `ADD COLUMN IF NOT EXISTS` pass. It
handles fresh installs and in-place upgrades, and `test/migrate.js` guards column disposition. It does
not handle renames, backfills, or destructive changes.

### D9 — Unsigned balance levers **(LOW, tracked)**
Many numbers remain "proposed defaults" pending sim + founder sign-off. `SIGN-OFF.md` and `BALANCE.md`
track them; the last sweep resolved every open row. This is process debt, not code debt.

### D10 — The client is one 4,631-line file **(LOW, deliberate)**
Zero dependencies, zero build step — a real asset for deployment. It is at the edge of comfortable.

### D11 — Nothing had ever been interrupted **(MEDIUM → ADDRESSED)**
Around twenty worker sweeps carry a comment claiming they are idempotent, per-row transactional, or safe
to re-run. Not one had ever been killed mid-run and then run again. "Idempotent" is a claim about a code
path that only becomes true once something interrupts it and the second run is checked.

The cost of not checking was already paid once. On 2026-07-25 the API process **died on every database
restart** — an unhandled Pool `'error'` event — and the only signal was a tester reporting "Internal
error on every crime". That was found by accident, after the fact, from a log.

`tools/chaos.js` (`npm run chaos`, the fifth harness, real Postgres only) now does it deliberately:
SIGKILLs the worker mid-sweep at three different points and checks the resumed run pays exactly once;
`pg_terminate_backend`s ~80 backends mid-transaction under load; and stops and starts Postgres entirely
underneath a running server.

It immediately found **the other half of the 2026-07-25 bug**. `pool.on('error')` covers clients sitting
IDLE in the pool. A client a request has CHECKED OUT — `pool.connect()`, ~73 sites, every transaction in
the game — emits `'error'` on *itself* when its connection dies mid-transaction, and an EventEmitter with
no listener throws, so the process died exactly as before. The earlier fix had closed half the door. It
is not exotic: it fires on any restart or failover landing while a transaction is open, and pointedly on
our own `idle_in_transaction_session_timeout`, the safety valve that exists to kill leaked transactions.
Fixed in `src/db.js` by attaching a logging handler once per client; node-pg still rejects the in-flight
query, so the request fails through the normal path and answers 503 `db_down`.

Verified by removing the handler and confirming the harness fails (it does, loudly, non-zero). With the
fix: interrupted sweeps settle each lot exactly once, ~80 killed backends leave §10.4 unmoved, and a full
database outage produces 503s rather than 500s and **recovers unaided** with no redeploy.

**It runs in CI**, on the real-Postgres job that already existed, on its own database so `pgcheck`'s
fresh-database ledger leg still runs. Scenario 3 needs `pg_ctl` on the database host, which a service
container cannot give it — the harness skips that one and its summary line stops claiming the outage
path was covered, so run it by hand against a local Postgres before a deploy that touches the pool or a
transaction boundary. `loadtest` joined it at a small field: a correctness gate, not a benchmark.
A guard in `test/docs.js` fails if the workflow ever stops invoking one of them, because a harness that
does not run is not a guard.

**Then the same weapon was aimed at the two places where being wrong costs real value.** `runWageEpoch`
MINTS $OMR against a lifetime endowment, one character per transaction; a resumed run is supposed to
split only what the crash had not already spent. Killed at five points mid-payment and resumed, it pays
every worker exactly once and mints exactly the uninterrupted total. That claim is now **proven
load-bearing rather than merely asserted**: deleting the resume guard makes the same run mint **five
times the schedule**, and the scenario fails. The first version of the scenario did *not* catch it —
running on the real 500 $OMR budget, every share clamped to the 5 $OMR per-account cap, so the guard
was irrelevant and the mutation passed. The budget now binds instead of the cap, with an assertion that
keeps it that way. Separately, ~155 two-party `withTwoCharacters` transfers were driven through a
backend reaper: none was left half-applied, and the payer's books match their ledger to the cent.

One seam confirmed reachable and correct: an interruption between a committed action and the storing of
its idempotency result leaves that key reserved. A retry gets `409 in_progress` until the 7-day prune
rather than being released, because releasing could run the action twice. That is fail-closed and
deliberate; `AGENTS.md` now tells agents what a persistent `409` means and to read their state rather
than spin.

### D12 — Nothing had ever checked the economy has a COUNTERPARTY **(MEDIUM → ADDRESSED)**
Every economic proof here is about one player or about conservation. `sim.js` measures faucet sizes and
proves §10.4 holds; `playthrough.js` measures what one person experiences. Neither can see the failure
mode the whole Risk-to-Earn thesis rests on: **a market with perfect accounting and nobody on the other
side.** A dead market conserves value beautifully.

The shape of the risk was already measured from the other end — a plausible player reaches level 128 and
$51M in thirty days having never once interacted with another human.

`tools/scale.js` (`npm run scale`, the seventh harness) drives a town — 36 players across six
archetypes, five warped days, plus the NPC residents — through every player-to-player market, then
takes a census: how many have a live counterparty, and of what got posted, what got taken.

It asserts three things and reports the rest:
1. **§10.4 drift DELTA is zero.** The harness seeds starting cash so players can reach the markets at
   all, so the baseline is non-zero by construction; what must not move is the delta.
2. **Every driven market is reachable.** A market that took zero posts across the whole run, with 36
   funded and levelled players trying, is a gate bug rather than a quiet town.
3. **The census reconciles with the flow.** If more went into a market than came out of it, something
   must still be standing — and if the count says zero, the count is reading the wrong table.

That third check exists because it caught its own author. A first cut queried the loans table for
`status='offered'`; the word is `'open'`. It counted zero every run and was one commit away from
publishing "the Shylock ended EMPTY" as a finding about the *game* rather than about a typo in a SQL
string. **A census that reads a column wrong reports confident nonsense, and nothing else here would
notice.** Mutation-verified — and the first mutation attempt PASSED, because at 12 players every loan
offer gets taken, `posted == taken`, and the check is vacuous. CI runs 18×2, the smallest size where it
bites. The same discipline runs through the harness: any branch that cannot even attempt is counted and
printed (`SKIPPED`), never silently nothing, which is how three dead branches were found — a `goods[0]`
read against an id-keyed map, a district read as a commodity, and a `unitPrice` field the market
handler does not read (it takes `price`; the neighbouring `/v1/exchange/list` is the one taking
`unitPrice`).

**A measurement I published and then had to correct.** The first version reported `taken / posted` as
"liquidity" and it was wrong — not slightly, structurally. `taken` is bounded by PER-PLAYER caps (one
debt at a time, one bodyguard, a duel cooldown), so it can never exceed the number of distinct
shoppers; with posts scaling as players/6 per round the ratio collapses to **3/rounds, independent of
population**. It matched the data exactly (6 rounds → 50%, 15 rounds → 20%), which is how a number
that says nothing about the game can look like a finding about it.

The honest metric is per-ATTEMPT **AVAILABILITY**: when a player went looking, was there an eligible
counterparty on the board at all? That is density-sensitive by construction, and it separates the two
reasons a trade does not happen — nobody was there (a dead market) versus a gate said no (the game
working). `SCALE_SWEEP=8,16,32,64` runs the town at each population and prints the curve.

**The answer, measured: liquidity does not gate the launch.**

| market | 8p | 16p | 32p | 64p |
|---|---|---|---|---|
| goods lots | 50% | 38% | 38% | 34% |
| loan offers | 79% | 88% | 82% | 84% |
| bodyguards | 88% | 100% | 100% | 100% |
| duel listings | 100% | 100% | 100% | 100% |
| buy orders | 50% | 38% | 38% | 34% |
| contracts | 88% | 100% | 95% | 95% |

Flat from 8 players to 64. The reason is the NPC residents: they post consent limits, loan offers and
buy orders regardless of how many humans are online, so the boards have a floor under them. That is a
direct validation of the population system — it was built so an empty alpha would still feel
inhabited, and this is the measurement that it does. The mild DECLINE in goods lots and buy orders is
contention, not emptiness: supply is one listing per trader per round while shoppers scale with N, so
the first shopper takes the lot. **There is no minimum invite wave to clear.**

Honest scope: car auctions and speakeasies are censused but not driven, and are labelled as such.

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
2. ~~**Finish the lock-free read path** (D1).~~ **DONE** — `withCharacterRead` / `readCharacter` wired
   to all 24 authed read GETs, verified against real Postgres in `pgcheck` §8, red-teamed after
   shipping. This entry said "blocked on a design choice" for a while after D1 was already finished,
   which would have sent the next reader off to re-do it; `test/docs.js` now fails if a debt item is
   struck through in §4 and still listed as outstanding here.
3. ~~**Split `server.js`** into domain route modules (D3).~~ **DONE** — 220 routes into 18 modules,
   2,396 → 1,771 lines, route table proven identical, two new guards for what that diff can't see.
4. ~~**Split `rules.js`** into generated + tail (D5).~~ **DONE** — machine-owned tables in one file,
   hand-written everything in another, the extractor writes only the first, `test/rules.js` enforces it.
5. ~~**Split `social.js`** along death/estate | contracts | gangs | combat (D4).~~ **DONE** — seven
   layered modules under `src/social/`, byte-identical bodies, unchanged public surface.
6. ~~**Consolidate the docs** (D7).~~ **DONE, differently than planned** — the plan was to archive the
   audit reports; measurement said not to (100 source comments cite a design doc or an audit by name, and
   CLAUDE.md's log is the precedent lookup table for ~414 more). So the docs were INDEXED rather than
   moved (`docs/AUDITS.md`, which states they are point-in-time), and every load-bearing figure is now
   machine-checked by `test/docs.js` + `test/routes.js` — five stale claims found and fixed, nine
   tripwires mutation-tested. See D7.

**What is left. Nothing on this list.** Every numbered item is struck through. D6 (lock discipline by
convention) is measured and accepted; D8–D10 are accepted as-is with guards; D11 is addressed and now
runs in CI. What remains is not architecture: the founder's operational steps (the alert webhook, one
production backup, the X token), the balance levers tracked in `SIGN-OFF.md`, and the chain track, which
is gated on a third-party audit and legal counsel rather than on any work in this repo.
