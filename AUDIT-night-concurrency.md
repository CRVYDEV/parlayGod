# AUDIT — concurrency, lock order, death/estate (night pass)

**Scope.** The six classes named in the brief, over `src/game.js` (the transaction machinery),
`src/social/estate.js` (`runEstate`), `src/worker.js` (~60 sweeps), `src/population.js`
(`retireResident`), and the 421 `FOR UPDATE` sites across the tree. Read-only pass; nothing edited.

**Headline: no CRITICAL, no HIGH, no MED.** Two LOW findings, both in the same class and both
about a *guard* rather than about live behaviour. That result is not a shrug — the specific
attacks below were driven against source, and the reason they die is visible in the code: the
codebase has converged on four disciplines (the whole-transaction character row lock, the
in-memory-mirror rule for the actor's own row, claim-then-act in every paying sweep, and
tier-ordered multi-row locking) that close these classes structurally rather than case by case.

---

## Findings

### F1 (LOW) — `retireResident` orphans `masteries`; retirement's cleanup has no guard at all

**Where.** `src/population.js:188-304` (`retireResident`) vs `src/social/estate.js:213`
(the `runEstate` wipe loop, which includes `'masteries'`).

**The path, verified.** A resident advertises a duel stake in `residentAct`
(`src/population.js:669`, `duel_limit`). A player challenges and *loses*. `src/duels.js:160`:

```js
await bumpMastery(client, win ? h : null, winner, 'wetwork', 'duel');
```

`winner` is the resident. `bumpMastery` (`src/game.js:517-541`) takes the headless branch
(`h` is null → reads `cur` by SQL) and writes an UPDATE-then-INSERT into `masteries` keyed on
`ch.id` — the resident's character id. `retireResident` never deletes it; `runEstate` does.

**Severity LOW, and I want to be precise about why.** These rows are unreachable, not wrong.
`masteryBoard` reads under `withCharacter` (the actor's own id), and `tradesLeaderboard`
(`src/mastery.js:88-92`) ranks `mastery_legend` — account-keyed, and resident accounts carry
`npc_flag`, which that query excludes. So this is storage, at roughly
`POPULATION.TURNOVER.PER_DAY` (24) retirements/day × a handful of rows. No §10.4 surface (XP is
not a currency), no gameplay effect.

**Minimal fix.** Add `masteries` to the retirement deletes beside `character_cargo`
(`src/population.js:275`).

**The structural point is bigger than the row.** `test/migrate.js` fails CI closed when a new
character-scoped table has no *death* disposition. **Nothing enforces the same for retirement.**
Every retirement-vs-death bug in this tree's history was found by a person noticing the
asymmetry after it shipped — the stranded loan (`population.js:220-233`), the phantom champion
(`:266-273`), the stale consent listings, the hired-gun crew rows (`:285-293`), the dead black-book
lines (`:237-242`), the phantom made man (`:276-284`). `clearInboundPointers`
(`estate.js:75-93`) was extracted precisely so the *inbound* half could not drift again; the
*outbound* half — what the character owns — is still two hand-maintained lists that must be kept in
step by memory. The cheap version of the guard is a test asserting that every table in the
`runEstate` wipe-loop array is either deleted by `retireResident` or listed in a
`RESIDENTS_NEVER_HAVE` allowlist with a reason (the catalog-or-declare shape `NOT_API` and the
DISPOSITION map already use).

---

### F2 (LOW) — the DISPOSITION completeness guard is blind to a third character-FK convention

**Where.** `test/migrate.js:151` — the parser accepts `character_id` or `[a-z0-9_]+_character`.

**Five character-scoped tables match neither** and are therefore absent from `DISPOSITION`,
invisible to the `unclassified` assertion, and uncounted by the success line:

| table | column | handled today by |
|---|---|---|
| `searches` | `hunter`, `target` | `clearInboundPointers` — `estate.js:87` |
| `boxing_title` | `holder_char`, `callout_char` | `wipeFighterAtDeath` — `estate.js:262` |
| `boxing_bouts` | `a_char`, `b_char` | `cancelMainEventsAtDeath` — `estate.js:261` |
| `boxing_bets` | `bettor_char` | `cancelBout` / `resolveMainEvent` burn — `boxing.js:423-431`, `:484-487` |
| `futurity_bets` | `bettor_char` | `resolveFuturity` burn — `casino.js:657`, `:688` |

**All five are correctly handled.** The defect is the guard, and it is the *third* occurrence of
the class the guard's own comment names: the `%_character` arm was added after the audit found it
blind to sixteen tables ("a guard that cannot see the class it guards reads as a clean bill of
health"). `%_char` is a different suffix and slipped straight through the same fix. The success
message — *"all 80 character-scoped tables … have a documented death disposition"* — overstates,
which is the part that matters: a *new* table using the `_char` convention (the boxing/futurity
files establish it as house style) would fail open.

**Minimal fix.** Widen the column pattern to `character_id|[a-z0-9_]+_(character|char)` and add the
five entries (`searches`/`boxing_title`/`boxing_bouts` → `special`, `boxing_bets`/`futurity_bets`
→ `escrow`). `hunter` and `holder_fighter` stay outside any pattern and are best handled by the
existing SCOPE note.

---

## Attacked and found SOUND

### 1. Lock-order cycles

I extracted the `FOR UPDATE` sequence of every function in `src/` (421 sites) and cross-produced
the ordered pairs looking for any pair taken both ways. **No cycle.** The pairs I then chased by
hand, because a mechanical pass cannot see cross-function order:

- **`districts` ↔ `gangs` ↔ `sov_structures`.** Every path is districts → gangs → sov_structures:
  `buildSov` (`sov.js:92,94`) — whose comment records this exact AB-BA being *found and fixed*
  ("this used to lock gang → district … that analysed the wrong pair"); `seizeDistrict`
  (`gangs.js:522,535` → `razeSov` `:553`); `settleContest` (`:632,641` → `:699`); `dissolveSov`
  under `removeMember`'s gang lock (`gangs.js:71,99`). `upgradeSov`/`paySovUpkeep`/`siegeSov` take
  the gangs → sov_structures tail only. Acyclic.
- **`account_persistent` ↔ `racers`.** Both worker settles lock account-before-racer explicitly
  (`casino.js:504-506` and `:670-671`), mirroring the player order (`withCharacter` holds the
  account, then the racer). Comments cite the v4 MED-1 fix.
- **`vig_prize_pool` ↔ `account_persistent`.** `settlePassStipend` (`pass.js:94-95`) takes
  pool-then-account, an intentional inversion of the global order — safe because it is
  *standalone* (not nested inside `withCharacter`) and matches `payPrizes` (`vig.js:199,204`) and
  `runVigBuyback`. Every path that touches this pair takes it the same way.
- **`characters` ↔ `<escrow row>` in the four scheduled-field resolvers.** All four lock entrant
  characters sorted → the state singleton → the card row, and the state-before-row order is
  explicitly the anti-AB-BA against a concurrent entry: `resolveGrandPrix` (`races.js:379-382`),
  `resolveStakes` (`stable.js:298-301`), `resolveFuturity` (`casino.js:637-640`),
  `resolveMainEvent` (`boxing.js:452-455`).
- **`bounties` ↔ `street_tax` ↔ `gangs` in `refundPot`.** `contracts.js:412-445` processes funders
  in *tier* order (characters → gangs → the deferred `HOUSE` singleton write last) rather than by
  contributor uid, with the reasoning for it written at the site. This is the one place where a
  naive sort genuinely would cycle, and it is handled.
- **`desk_inventory` ↔ `account_persistent`** — `desk.js:175-179` locks buyer → shelf → auction,
  matching the recycle path (which holds the account first via `ledger`). No sink can AB-BA it.

**On the retry masking.** `deadlockToRetry` (`game.js:49`) maps 40P01/23505/55P03 to a retryable
`contention`. Worth stating plainly for the record: that makes a cycle *slow and occasionally
user-visible*, not *wrong* — nothing commits on the aborted side. It is not a licence to leave one
in, and the tree does not: `buildSov`'s comment is the model ("it was masked by the 40P01 →
`contention` retry; the standing rule is to fix the order").

### 2. Persist-clobber

I swept every `UPDATE characters SET` / `UPDATE account_persistent SET` in `src/` against the two
positional lists (`persistCharacter` `game.js:1093-1120`, 65 columns; `persistAccount`
`game.js:1002-1013`, 18 columns). 66 direct-SQL sites touch a persist-list column.

**The class is narrower than it looks, and the reason is load-bearing.** `withCharacter` holds
`FOR UPDATE` on the character row for the *whole* transaction (`game.js:866`), so a direct-SQL
write to a *third party's* row from another transaction cannot be clobbered — it blocks until that
player commits and then applies to the fresh value. The exposure is therefore only:
**same-transaction direct SQL to `ch`/`victim` on a persist-list column with no in-memory mirror.**

Every such site carries the mirror, and each names the rule:

- `market.js:48,141,271,500` — `inMemoryCh`/`l.bidder === ch.id`/`killerCh.id` guards, with
  "self-raise refunds in-memory — never SQL-touch the actor's own row".
- `contracts.js:421-423` (`refundPot`) — `skipId` defers the poster's own refund to the caller.
- `estate.js:269-270` — the killer-as-principal `guarded_by` mirror.
- `estate.js:288-294` — the killer-as-named-target `heat_exposure`/`indicted_at` mirror on the
  informant collapse.
- `boxing.js:426` — the killer-as-bettor refund mirror in `cancelBout`.
- `estate.js:363` — writes the dying victim's row, and both wrappers *skip* `persistCharacter`
  for a dead row (`game.js:881`, `:1064`).

Verified as non-issues for the same reason: `market.js:331` cannot hit a self-refund because
`bidListing` rejects a self-bid (`market.js:123`, error `own`); `defense.js:145` and
`estate.js:79` write a *third* character with no in-memory copy anywhere; `secrets.js:184`,
`law.js:277`, `combat.js:659,664` (`huntWanted`), `store.js:100`, `primetime.js:228,234`,
`npcwar.js:394` are all headless worker paths with no persist to clobber them.

Every column written by direct SQL for *pacing/status* — `train_at`, `mission_at`, `active_at`,
`statuse_used/at`, `clue_at`, `race_at`, `duel_at/elo/style/limit`, `disinfo_until`, `wire_tier`,
`port_used/at`, `berths`, `contraband`, `heist_loot`, `bio`, `lfg`, `pen_faction`, `shank_at`,
`bust_used/at`, `car_stolen_at`, `trunk_robbed_at`, `sabotaged_at`, `seeking_mentor`,
`npc_seed`, `paper_at`, `path_at`, `honor`, `capo_recruits` — is **absent** from both positional
lists. I checked all of them; there are no mismatches.

### 3. Lost updates

- `sweepStandingWatches` (`wire.js:404-421`) — the one sweep that debits `$OMR` outside
  `withCharacter`. It opens its own txn per renewal and re-reads the balance under
  `account_persistent … FOR UPDATE` before deciding affordability. The comment records a prior
  bare-`pool.query` version where the lock was inert under autocommit.
- `bumpCrewObjective` (`game.js:613-630`) — locks `crew_objectives FOR UPDATE` before the
  SUM-and-write, char → objective, consistent with `claimObjective`.
- `store.js:97-101` (`grantPackage`) — locks the character row before the absolute `wire_until`
  read-modify-write, specifically because it is a persist-list column and the grant is headless.
- `foundNpcFamily` (`population.js`) — re-reads the chosen founder `FOR UPDATE` before the
  absolute cash write; the comment records the prior version being clobbered by the crime TAKE.
- `takeFromMark` (`game.js:1647-1665`) — the only read-modify-write that deliberately *never
  blocks*, behind `FOR UPDATE SKIP LOCKED`, with the fallback path independently correct.
- `sweepCapoLicense` (`growth.js:855-891`) and `resolveContest` — absolute recomputes from the
  source of truth; a lost update is self-healing on the next tick.

### 4. Claim-then-act in worker sweeps

I enumerated every `sweep*`/`settle*`/`run*`/`enforce*`/`hunt*`/`open*`/`close*` export that
writes, and checked each for a claim. Every paying sweep claims:

- `settlePrimeTime` (`primetime.js:219-222`) — `UPDATE … SET settled=true WHERE … AND NOT settled
  RETURNING`, skip on empty. The reward is a pure function of *final* turnout, so the two workers
  cannot disagree about the amount either.
- `sweepPush` (`push.js`) — claim-then-notify, per the R28 C1 fix.
- `sweepFavors` (`favors.js:216-227`) — poster char locked, then `favors … FOR UPDATE` with a
  status re-read; characters-before-pots.
- `sweepSecrets` (`secrets.js:176-181`) — mark char locked *before* the secret, with the bounty-
  sweep lock order cited.
- `openAuction` (`desk.js:123-143`) — day is the PK, and 23505 is caught and reported as
  `already`.
- `sweepTickerBallot` (`commission.js:383-398`) — same PK-race shape, `try/catch` around the
  insert.
- `resolveMainEvent`/`cancelBout` (`boxing.js:418-420`) — status re-read under the bout lock, with
  the R15 stranded-escrow finding recorded at the site.
- `sweepFamilyAggro` — the DELETE *is* the claim (`RETURNING gang_id`, strike gated on `rowCount`),
  per the R28 #1 fix.
- `runPopulation` / `runWageEpoch` / `sweepNpcAggression` / `sweepNpcDiplomacy` — session advisory
  locks, so two replicas during a deploy overlap cannot both spend a metered budget.

The sweeps with no claim are the ones that need none: `sweepDiplomacy`/`sweepMentorOffers`
(idempotent DELETEs of lapsed rows), `sweepCapoLicense` (idempotent recompute),
`spawnNpcConvoys`/`despawnArrivedNpc` (documented self-correcting TOCTOU).

### 5. Death/estate completeness

`node test/migrate.js` is green: 80 character-scoped tables, all classified, and every
`wiped`/`special` one proven to have a DELETE or a resolving status UPDATE in `src/`. Beyond the
guard I chased the dangling-pointer half by hand — a booked event, an open escrow, a listing, a
held office — and found each resolved: `cancelMainEventsAtDeath` (booked card + crowd refund),
`voidListingsAtDeath`/`burnBidsAtDeath`, `voidLoansAtDeath` (a dead *lender's* claim passes to the
heir rather than voiding), `voidFavorsAtDeath`, `wipeRingAtDeath` (stack burned under the table
lock, never a bare DELETE), `wipeSpeakeasyAtDeath`, `removeMember` (succession → dissolution →
`gang:dissolved` ledger row), `razeSov`, the `crew_heists`/`pen_breaks`/`world_raids` leader
abandon + stranded-crew notify, and the escrow tables left deliberately unwiped so the frozen field
resolves. The four scheduled-field resolvers each `LEFT JOIN characters` and burn a dead entrant's
stake (`race:gp:death`, `stable:stakes:death`, `casino:futurity:death`, `boxing:bet:death`), which
is what makes leaving those rows correct rather than an oversight.

### 6. Retirement vs death

I built the full list of what a resident can acquire or point at — from `spawnResident`
(`population.js:92-176`: cars, businesses, boats, fighters, racers), `residentAct` (consent limits,
loan offers, market buy orders, drift, freight), the step-four scheduled-field entries, and NPC
family membership — and checked each against `retireResident`. All handled but F1. The social
layer is closed at the *source*: `crew.js:61,275`, `mentor.js:26`, `vouch.js:23` and
`discovery.js:75,86,97` all gate on `NOT is_npc`, so a resident can never be a crewmate, a
protégé, a vouchee or a crew target — which removes those tables from the question entirely rather
than requiring retirement to clean them.

---

## Not defects, recorded so they are not re-litigated

- **`retireResident` deliberately does not clear bounty pots on the retiree** (`estate.js:75-81`
  comment). A pot resolves through the expiry sweep's *refund*, which is fairer than a death-burn
  for a retirement and stays §10.4-exact either way. Bounded by the pot TTL.
- **A retired resident's `filled_qty` warehouse goods vanish.** The seller was paid at fill, so no
  currency moves; goods are not a §10.4 currency.
- **`dm_messages` threads with a retired resident render "line dead"** — the same surface a dead
  player shows before their heir rises.
- **`withCharacterRead` (`game.js:942-968`) takes no lock and no `BEGIN`.** Verified safe:
  `accrueInMemory` is pure (`game.js:726-731`), the accrual fingerprint covers all three things
  that can move above the one-second early return (`game.js:739`), and any movement returns `null`
  so `readCharacter` re-runs the audited locked path from a fresh read.
