# AUDIT — the slate trio: THE DUELING LADDER (#5) · CLUE SCROLLS (#4) · SEASONAL LEAGUE MODIFIERS (#6)

**Date:** 2026-07-24 · **Scope:** the three content drops built this session on
`omerta-ladder-clues-seasons-design.md` — `src/duels.js`, `src/clues.js` (+ the `doCrime` drop hook in
`src/game.js`), the `SEASON_MODS`/`seasonModOf` rules tail + its five touchpoints
(kitchen laylow, social safehouse + kill loot, economy goods sell, accrual law gain) — plus every file
they touch (schema, worker, server routes, console, invariants vocabulary).

**Method:** a six-lens ultracode red-team workflow (34 agents): independent finder lenses
(§10.4/economy · concurrency/locks/persist-clobber · death/estate/PvP · duels internals · clues
internals · seasons internals), every finding then adversarially verified by TWO independent refuters
(majority = confirmed). 13 findings confirmed (1 MED, 12 LOW — several duplicates across lenses),
1 rejected, 17 verified-clean/flag notes.

**Headline: no CRITICAL, no HIGH, no §10.4 drift.** The duel wager is the audited `casino:pvp`
taxed-transfer pattern byte-for-byte; the casket is a bounded, ledgered, character_id'd faucet; every
seasonal touchpoint ledgers the MODIFIED number (the decree discipline) and the whole layer is
DORMANT by default (`SEASON_MODS=on` to arm — the signed baseline ships untouched). Suite 42/42 +
sim drift-0 after all fixes.

---

## Confirmed → FIXED in-commit (regression each)

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| A | **MED** | `renderPvp`'s duels fetch wasn't graceful — any `/v1/duels` error (e.g. a jailed read) blanked the ENTIRE Wet Work tab (contracts, hunt, defenses all gone). | The fetch now degrades: `duelsRes.code < 400 ? body : null`; the Dueling Circuit section simply hides on error, the rest of the tab renders. |
| B | LOW | The view's live `safehouseCost` quote omitted the season `safehouseMult` the charge applies — quoted ≠ charged under Blood in the Streets. | `game.js` view quote now multiplies by `seasonModOf().safehouseMult \|\| 1`; `test/seasons.js` asserts sheet quote == armed charge. |
| C | LOW | The season `lootMult` reached only 3 of the 5 fire-kill loot surfaces — the escrow-loot legs (live market buy-orders, open loan offers) still looted at the base rate. | `runEstate` computes one `estateLootRate = min(0.5, CASH_LOOT_RATE × lootMult)` and threads it into `voidListingsAtDeath` AND `voidLoansAtDeath` — all five surfaces now agree. |
| D | LOW | The `doCrime` clue-drop hook's bare try/catch could NOT keep the enclosing txn healthy on real Postgres (25P02 abort poisons everything after; pg-mem hides it — the collection.js LOW-1 class). Also the drop/steps rolls were un-audited randomness feeding a cash faucet. | SAVEPOINT-probed wrapper (the `logCollect` pattern): probe once, `SAVEPOINT clue_drop` + `ROLLBACK TO` when supported, bare fallback on pg-mem. The drop roll + steps roll are now `rng_audit`'d (`clue:drop`). |
| E | LOW | `listDuel` wrote `duel_limit` by direct SQL but never mirrored it onto the in-memory `ch` — the same response's character view rendered the STALE limit. | `ch.duel_limit = cap` (or `null` on unlist) mirrored before return. |
| F | LOW | The reported ELO delta misstated at the ELO_FLOOR — the response (and the opponent's notify) claimed a symmetric ±delta while the persisted loser was clamped. Persisted values were always correct; the lie was cosmetic. | `loserApplied = loserNew − loserElo` computed after clamping; the response reports the actor's REAL applied delta, the notify the opponent's. |
| G | LOW | No challenger cooldown — a strong build could continuously drain a listed weaker duelist at rate-limit speed (the races precedent cools the challenger). | `DUELS.CHALLENGE_CD_MS` (10 min) on `characters.duel_at` (direct-SQL, clobber-safe), stamped after the duels INSERT; `DUEL_CD_MS` TEST-ONLY knob (boot-guard listed). Regression: back-to-back challenge refuses `cooldown`. |
| H | LOW | The fifth touchpoint (`lawGainMult`) had ZERO test coverage — and the original seasons test's crackdown assertion was tautological. | A direct-`accrue()` block (the test/law.js mock verbatim — crew + hot stash pin heat at 100 so exposure builds): the dead_quiet vs the_crackdown ratio isolates `lawGainMult` at ×1.25 (event/crew terms cancel). |
| I | LOW | The `duels` log table had no retention sweep — unbounded append-only growth (the pair-day K-decay only ever reads today). | Worker retention: duels rows older than 60 days reaped (the dm/troll-box precedent). |
| J | LOW | The codex drift-detector (`test/hardening.js`) wasn't extended — the three new systems were documented today, unguarded tomorrow. | Detector terms += `dueling circuit`, `clue scrolls`, `megaproject`, `cellphone`; both codices carry the sections. |
| K | LOW | `dig()` wasn't safehouse-gated — the casket cash faucet was collectable while untargetable. Classification call resolved as D2 collection-class (a casket is a collect, not a crime). | `safeHoused(ch)` → `safe` in `dig()`; regression in `test/clues.js`. |

Duplicate confirmations (the same B/C/D/F findings surfaced by second lenses) fold into the rows above.

## Rejected / accepted-as-designed

- **`their_cash` free-probe** (a challenger bisecting a listed opponent's cash upper bound via the
  `cash` gate within [STAKE_MIN, limit]): ACCEPTED — exact parity with the audited back-room fade +
  boxing bout gates; the probe costs real duels (rake + ELO risk) per bit and the listing is consent.
- **Pre-commit bus emits** (streets feed lines fire before COMMIT): the codebase-wide norm
  (documented in earlier audits); a rollback shows a ghost line at worst.
- One finder's variant of the try/catch finding was refuter-rejected as written (its failure model
  overclaimed); the underlying defect was real and is fixed as **D** above.

## Flagged for founder sign-off (NOT patched — ground rule #1; recorded in BALANCE.md)

1. **The Gold Rush round-trip** — the ×1.05 sell-only mult flips the same-district goods buy→sell
   round trip past the 4% fee wall (~+1% riskless per cycle, trunk-bounded) for the whole 28-day
   season. Dials: drop to ×1.03, or make it buy+sell symmetric. Moot while SEASON_MODS stays unarmed.
2. **`duel_wins` legend farmability** — the lifetime legend has no per-pair decay: one funded lvl-10
   alt can feed wins at rate-limit speed (rake-taxed, ELO-neutral after K-decay). Same posture as the
   accepted fight-fix/referral Sybil rows; `LEGEND_MIN_LVL` is the dial.
3. **Latent sub-1 `safehouseMult`** — the mult is applied OUTSIDE the `max($25k, 1% NW)` floor, so a
   future discount season could undercut the signed minimum. No current mod is sub-1; a
   `Math.max(SAFEHOUSE_COST, …)` re-floor is the one-liner if one ever ships.
4. **Crackdown `lawGainMult` retroactivity** — at a season boundary the CURRENT season's rate applies
   to the whole (already 8h-capped) accrual window. Bounded ±25% × 8h; accepted-shape note.
5. **Two 28-day season clocks** — `rules.js seasonIdxOf` and `worker.js runSeasonRollover` duplicate
   `day/28`; they agree today. Linking comments added at both sites (this pass) so a future lever
   change touches both.
6. **Heir clue cooldown** — death clears `clue_at` (heir born fresh). Economically irrelevant
   (~$7.5k mean casket); noted for the record.
7. **Mid-rollover duels** — a duel landing mid-rollover can mix reset and stale ratings across the
   boundary (batched per-char txns). Cosmetic for one duel; not a lock bug.

## Verified CLEAN (highlights)

- **§10.4**: `duel:wager` is the exact casino:pvp transfer (winner nets stake−rake, half-rake →
  street_tax, half burns; both rows character_id'd — check (a) reconciles both sides);
  `clue:casket` a bounded character_id'd faucet (2% drop × one scroll × 8h cooldown ≈ $22.5k/day
  hard ceiling, sim P9.19); every season touchpoint ledgers the modified number. Suite + sim drift-0.
- **Locks/persist**: `duel_elo/duel_limit/duel_at/clue_at` are direct-SQL columns off the positional
  persist (clobber-safe, mirrored in-memory where the same response renders); challenge is the
  withTwoCharacters sorted-lock posture; the scroll row is FOR UPDATE'd; no new AB-BA edges.
- **Determinism/leaks**: clue riddles derive from a server-held salt via the §7.11 hash (no stored
  answers, no oracle — a cold dig costs energy per probe); the seasonal draw is deterministic per
  season index and DORMANT unless armed; wealth stays banded everywhere.
- **Death/estate**: scrolls die with the street (`clue_scrolls` wiped + DISPOSITION-mapped);
  `caskets`/`duel_wins` are account-level legends that survive; duels seasonal ELO resets in
  rollover; agents excluded from both leaderboards.
