# AUDIT — Skills step three (prestige carry) + randomized builds & the paid re-roll

A focused red-team over two same-session drops: (1) **Skills step three** — prestige carries into the
build (muscle memory + bonus points); (2) **randomized starting stats + a 0.01-ETH stat re-roll**.
Lenses: §10.4/economy, death/estate/persist-clobber, concurrency/locks, exploit/grief, chain-boundary.
Every claim verified against source. **No CRITICAL/HIGH.** One MED lock-order fix applied in-commit.

## Second pass — Skills step four (GRANDMASTERY) + a concurrency re-review

A follow-up red-team over the grandmastery drop + a deeper concurrency look at the re-roll. **No
CRITICAL/HIGH.** One MED lock-hygiene fix applied.

**MED — the re-roll's rare AB-BA vs `mintCharacter` now surfaces as a clean `contention`, not a 500.**
`withCharacter` locks character→account (canonical) and the earlier fix aligned `rerollCharacter` to
the same order, so a re-roll racing any normal action is deadlock-free. The one residual is
`mintCharacter`, which locks account→character(implicit UPDATE) — the reverse — so a *same-account*
mint + re-roll fired simultaneously (double-tap; both are once-off chain-fee-gated) could 40P01. That
already self-heals via Postgres abort, but it surfaced as a raw 500. **Fix:** `rerollCharacter`'s catch
now runs `deadlockToRetry(e)` (the codebase-standard 40P01/23505 → retryable `contention` mapping), so
the rare edge is a clean retry instead of a 500. (mintCharacter's own inconsistency is pre-existing and
out of scope; the common re-roll-vs-`withCharacter` path is already correct.)

**Grandmastery — verified CLEAN.** Owning both capstones of a pair DERIVES the grandmastery (no cost,
no state — recomputed from the owned-skills Set on every read via `grandmasteriesFor`), so there's
nothing to persist and nothing to clobber. The ultimate actives move only energy/nerve (regen
resources) + op-cooldowns (`heist_at`/`world_raid_at`, which ride `persistCharacter`) — ZERO §10.4, the
same surface as the step-two capstone actives (sim drift-0). `useActive` gates an ultimate on BOTH
capstones (`ult.reqs.every(...)`, tested — the locked Warlord is refused). The reduced cooldown
(`activeCdFor`) is applied CONSISTENTLY at the gate, the returned `cooldownSeconds`, AND the board's
`activeCdSeconds`/`activeCooldownSeconds` (all read the same helper) — no way to bypass the cooldown by
a stale display. `active_at` is written by direct SQL (outside the persist positional UPDATE — the
step-two discipline), so no clobber. **Death:** a capstone is tier-4, and muscle memory only carries a
tier-ASC prefix of ≤3 slots (all tier-1/2), so a capstone — hence a grandmastery — is NEVER inherited;
the heir must re-earn both, no death-softening. The faster cooldown is pure pacing (energy/nerve refill
over time anyway; the burst just tops them — never `jail_until` or a §10.4 cap), bounded by the
per-action gates, so no unbounded exploit.

## Fixed in-commit (first pass)

**MED — the re-roll's lock order could lose a build (and risked an AB-BA vs the canonical order).**
`rerollCharacter` originally locked `account_persistent FOR UPDATE` first and issued a bare
`UPDATE characters SET muscle…` WITHOUT locking the character row. Two problems: (a) **lost update** —
a concurrent `withCharacter` action (a crime, a deal) locks the CHARACTER row, reads the old stats,
and persists them at commit; if the re-roll committed in between, that persist would clobber the new
build (the credit already spent). (b) **lock-order inversion** — locking the account before the
character reverses the codebase-canonical `characters → accounts → gangs → singletons` order, so it
could AB-BA-deadlock against any `withCharacter` path (character-then-account). **Fix:** lock the
living **character row FOR UPDATE first**, then the account — so the re-roll serializes with every
other mutation on that character (no clobber) and follows the canonical order (no cycle). The credit
check + decrement + the `characters` stat write all sit under both locks in one atomic txn.

## Verified CLEAN

**§10.4 / economy — no currency, no power creep.** Both a fresh roll and a re-roll are
**total-conserved** (`rollStats` always sums to `CREATE_STAT_TOTAL` 15, each stat ≥ `CREATE_STAT_MIN`
3 — proven by a 100-roll sanity check: 0 bad sums, 22 distinct shapes). So the aggregate stat budget
is identical to the old fixed 5/5/5 — only the *shape* varies (a muscle spike costs speed). The
sim-audited stat economy is untouched (`node tools/sim.js` drift-0; full suite 32/32 with randomized
creation). A re-roll writes ZERO `transactions` rows — it only redistributes a fixed budget; the ETH
fee is out-of-band value (the `fees.js` mint/respawn precedent — no §10.4 surface, no new
reason/bucket/vocabulary). The M8 `/v1/respec` reads the character's ACTUAL current total
(`ch.muscle+ch.cunning+ch.speed`), so a randomized 9/3/3 build respecs correctly (collapses toward the
≥5-floored middle — the documented "deliberate rebalance").

**The re-roll credit — atomic, exactly-once, chain-idempotent.** `reroll` joins the fee-kind allowlist
in `recordFeePayment` + `creditEntitlement` (a `reroll_credits += 1`), riding the SAME idempotency as
mint/respawn: the `fee_payments.nonce` PK rejects a re-delivered event (a duplicate is a no-op; the
non-23505 rethrow so a real payment is never silently dropped — the F1 discipline). Pay-before-link is
reconciled by the existing `reconcileFees` (claim-then-grant, exactly-once). The spend
(`rerollCharacter`) checks `reroll_credits ≥ 1` and decrements under the account lock, so a
double-submit spends at most one credit; a re-roll with **no living character** (`no_character`) throws
BEFORE the decrement, so the credit is preserved. Repeatable by construction — each re-roll needs a
fresh paid credit (regression: the second re-roll with no credit is refused). The on-chain
`OmertaFees.payRerollFee()` mirrors `payMintFee` (exact-value, CEI + `nonReentrant`, forwards straight
to the dev wallet, monotonic nonce), `rerollFee` defaults to `mintFee` (0.01 ETH) and is owner-tunable
via `setRerollFee` (0-fee guarded); the watcher (`watcher.js`) now also reads `RerollFeePaid`. Contract
compiles clean (solc 0.8.26); Foundry tests added — `forge test` remains the pre-mainnet gate
(egress-blocked here, the established residual).

**Muscle memory — prereq-safe, no §10.4, no persist-clobber, a fresh line still dies.** `runEstate`
captures the deceased's loaded `h.victimOwned.skills` BEFORE the `character_skills` wipe and carries a
**lowest-tier-first PREFIX** (`rememberedSkills` — `min(MEMORY_MAX 3, floor(priorPrestige/
PRESTIGE_PER_SLOT 8))` slots). The prefix is **prereq-safe by construction**: a tier-ASC sort places
every tier-t skill after ALL tier<t, so a carried skill's same-branch tier-(t−1) prereq is always
already in the prefix (verified across single-branch, multi-branch, and mixed-tier owned sets). Read
from **pre-death accumulated prestige** (`priorPrestige`, captured before the `+legacy` bump) — so a
FRESH bloodline's skills still fully die (the first death of a lvl-25 street inherits 0 memory since
prestige is 0 then; regression: the prestige-0 `wil` heir is unschooled). The heir's inherited skills
are direct `character_skills` INSERTs on the fresh `heirId`, which no `persistCharacter` touches in
that request (the actor/killer is persisted, not the heir) — no clobber. Skills carried are a pure
ownership move, no currency — the sim stays drift-0.

**Bonus points — capped, non-exploitable.** `pointsOf` adds `min(PRESTIGE_POINT_MAX 3,
floor(prestige/PRESTIGE_PER_POINT 10))` bonus points; prestige only ever GROWS, so `available` never
goes negative (and `Math.max(0,…)` guards regardless). A player cannot manufacture > 3 bonus points.
**By-design note (not a defect):** at prestige 24 the heir can inherit 3 muscle-memory skills (3 tier-1
= 3 points) while carrying only 2 bonus points — a slightly-generous head start. It is NOT exploitable:
respeccing the over-carried skills returns only `total` (2) points, a net loss, so there's zero
incentive to convert the gift into points. The two dials (`PRESTIGE_PER_SLOT` for memory,
`PRESTIGE_PER_POINT` for points) are independent founder levers; both revert to the hard "skills die"
rule at 0.

**rng_audit.** Both creation (`roll_stats`) and re-roll (`reroll_stats`) write an `rng_audit` row with
the outcome distribution (ground rule #3 — server-side randomness logged). The creation audit row is a
sequential (non-txn) insert after the committed character INSERT — a failure would leave the character
without an audit row (harmless) but the INSERT mirrors the existing `rngLog` exactly and won't fail.

## Flagged for founder sign-off (NOT patched, ground rule #1)

- **`CREATE_STAT_MIN` 3 / `CREATE_STAT_TOTAL` 15** — the spread lets a build reach 9 in one stat. This
  is total-conserved (no power creep) but IS a build-identity change: some shapes may out-perform 5/5/5
  in a stat-weighted meta. Intended (uniqueness); the dial is the floor (raise toward 5 to narrow the
  spread, at 5 it collapses back to the old fixed build).
- **The re-roll has no cooldown** — a player can re-roll infinitely (each pays 0.01 ETH real). The ETH
  cost is the throttle; no gameplay exploit (total-conserved, no power gain), so left as the founder
  specified ("infinitely as long as they pay 0.01 ETH every time").
- **Muscle memory / bonus points soften death** — `MEMORY_MAX`/`PRESTIGE_PER_SLOT`/`PRESTIGE_PER_POINT`/
  `PRESTIGE_POINT_MAX` are all sign-off levers (BALANCE.md); watch whether repeat-death gets too cheap
  for a whale bloodline (the dial is `PRESTIGE_PER_SLOT` — a deeper dynasty per remembered skill).

Suite 32/32 + sim drift-0; contracts compile clean.
