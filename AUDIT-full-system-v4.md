# AUDIT — full-system red-team v4 (deep pass)

A max-effort whole-codebase pass, **three deep independent lenses** (§10.4/emission,
concurrency/locks/persist-clobber, death/estate/PvP + cross-system dangling pointers), directed to go
DEEP on the highest-risk invariants and prioritize what changed since `AUDIT-full-system-v3.md`
(territory step five, the store/jump/chain/mint fixes). Every reported finding re-verified against
source before any fix; a regression per behavioural change. Suite 32/32 + sim drift-0.

**No CRITICAL/HIGH. No §10.4 drift.** Two confirmed LOW–MED, both fixed in-commit.

## §10.4 / emission — CLEAN (lens returned no findings)

Deep re-derivation confirmed: the territory step-five specialist/special-ops move ZERO currency (pure
defensive/scrutiny/fortitude); `ratePerHr` is unchanged by a specialist, so every income-REDIRECT faucet
(territory rival-muscle, business shakedown, port piracy, convoy toll) stays provably clock-advance-
neutral (`floor(pending−cut)` ≤ pending−cut, rate identical to accrual); a specialist/ghost only avoids
a (defensive, unledgered) seizure and can't cause a double-collect or over-cap bank (accrued() is
scrutiny-independent + hard-capped); the ghost op writes no `last_income_at`; every positive-amount
faucet's bound traces to a constant or a metered quantity, never request input; the backed pools
(stake_pool, both rwa_dividend_pools, vig prize) are strictly `min(reward, pool)` and both dividend pools
ARE in `omrBuckets` (the family pool isn't off-books).

## Fixed in-commit

**MED (concurrency) — territory-step-five specialist double-assign TOCTOU** (`src/territory.js`). The
one-per-specialist `busy` check was an unlocked SELECT while `assignSpecialist` locked only the TARGET
racket row. Two concurrent commanders (a boss + underboss) assigning the SAME made-man to two different
rackets both read the last-committed snapshot (neither sees the other's uncommitted write) → the member
specializes on TWO operations, doubling his defensive fortitude bonus. No lock contention (different
racket rows) so `deadlockToRetry` never fires; defensive-only, no §10.4. **Fix:** `assignSpecialist` now
locks the GANG row `FOR UPDATE` first (char → gang → racket, the territory convention), serializing
concurrent family assigns so the busy-check is reliable.

**LOW–MED (death/PvP) — a dead named hitman locked a directed hospitalize pot** (`src/social.js`). A
directed hospitalize contract names an exclusive hitman; `claimBounty` skips such a pot IN its window for
anyone but the named hitman, and `postBounty` blocks re-naming (`directed_exists`). `runEstate` cleared
bounties where the deceased was the MARK, but NOT where the deceased was the named HITMAN — so when the
gun died (mark alive), the pot stayed locked to the corpse for up to `DIRECTED_MAX_H` (24h), handing the
mark a free hospitalize-immunity window (kill pots were unaffected — the squat fix pays any killer).
**Fix:** runEstate now `UPDATE bounties SET hitman=NULL, opens_at=NULL WHERE hitman=<deceased>` — the pot
OPENS to all claimers immediately (§10.4-neutral: the escrow stays, only the exclusivity pointer clears).
Regression: a directed hospitalize pot naming a hitman who then dies is collectable by a third-party
jumper.

## Verified CLEAN (the deep lenses' negative results)

- **Every non-owning character POINTER clears/reassigns on death** — the death lens traced them all:
  `characters.guarded_by` (bodyguard, killer-mirrored + alive-checked), `boxing_title.holder/callout_char`
  + `boxing_bouts`/`boxing_bets` (wipe/cancel handlers, killer-bettor mirrored), `speakeasies.owner` +
  guest list, `loans.lender/borrower` + pledged `cars` (void/heir-reassign), `market_listings` bidders
  incl. buy-orders, co-op leader/member rows (heist/pen-break/world-raid — abandon + explicit member
  DELETE, no slot-block), wiretaps/informants/searches (both directions), faction shank-cover (alive-
  filtered). The territory-specialist clear (the v3-era pattern extended) is correct + load-bearing. The
  ONLY gap was `bounties.hitman` (fixed above).
- **Concurrency** — the territory step-five functions lock char→racket only and never want the gang after
  the racket, so acyclic vs collect/seize/fortify/raid (all hold-gang-want-racket). No OTHER headless
  writer of a persist-list column without the char lock (the store.js wire_until was v3's; no siblings).
  Worker sweeps + two-party settles all lock counterparty-before-write in the canonical order.
- **Killer-as-counterparty §10.4** mirrors threaded on every value-touching estate path; shield ordering
  (bodyguard → respawn-token → kill) consistent on fire/npcHit/shank/huntWanted; victim gates
  (safehouse/witpro/penSafe/inHole/jailed/hospitalized) consistent (v3 fixed jump).

## Flagged (NOT patched — design calls)

- Asset-extractions (shakedown/standover/inside-job/rival-raid) gate the ACTOR's safehouse + the owner's
  hospitalized/family, never the owner's safehouse/witpro/jail — internally consistent (they hit the fixed
  venue, not the relocated person), but a witpro'd rat's fronts stay shakeable — a defensible design call
  worth a founder note.

Suite 32/32 + sim drift-0.
