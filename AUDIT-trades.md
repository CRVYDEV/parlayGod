# AUDIT — THE TRADES pillar (steps 1–4), combined red-team

**Scope:** the whole mastery pillar as shipped this session — step 1 (ten use-XP trades +
`bumpMastery` at ~24 hook sites + the death echo + the account legend), step 2 (milestone perks +
the level-50 Virtuoso/Dynast trait), step 3 (Paths v2 — six careers, home/rival XP rates, one perk +
one handicap each, the 7-day switch cooldown), step 4 (stats-by-use — the capped daily stat drip).
Commits `ca0e535`, `09b3d88`, `da27044`, `6df466c`.

**Method:** four independent adversarial lenses run in parallel (A §10.4/money-touchpoints,
B concurrency/locks/persist-clobber/pg-mem, C death/estate/echo/cross-generation, D XP-rate
exploits/Sybil/gates), every non-balance finding then attacked by two independent refuters before
being treated as real. Two verifier agents crashed mid-run (session limit) — their two findings
were **re-verified by hand** against source (the established discipline), one confirmed, one
refuted. Every fix below carries a regression that was **mutation-verified** (the fix reverted →
the named assertion fails).

**Result: no CRITICAL, no HIGH, no MED. Three LOW defects, all fixed in-commit. Lenses A and B
returned clean on the §10.4 and concurrency surfaces.**

## Verified CLEAN (the negative results, so nobody re-audits blind)

- **§10.4 (lens A):** XP is not a currency — `bumpMastery`, the drip, the trait insert and the
  estate echo write zero `transactions` rows (test-asserted). Every perk/path money touchpoint
  ledgers exactly what it charges/credits: wheels tune, seamanship refit, commerce listing fees
  (the `LIST_FEE_MIN` floor re-asserts after the discount), gun/ledger `goodsSell`, ledger
  `racketIncome` (accrual) + `frontIncome` (collectBusiness), ring `healCost`. The gambling perk
  is table-limit ACCESS only — the den-book identities are untouched.
- **Locks / persist (lens B):** `statuse_used/statuse_at/path_at` and the
  masteries/mastery_legend/character_traits writes are all outside `persistCharacter`'s positional
  list; the drip's stat increment rides the positional column deliberately (the `train()` shape),
  under the caller's held char lock. Every headless `bumpMastery` call site (duel passive winner,
  heist crew, boxing loser-owner read) holds the row it writes and never touches `h`. The
  UPDATE-then-INSERT upserts run under the actor's char lock (per-character serialization);
  `mastery_legend` uses NUMERIC bound-param ADDITION (the pg-mem sign-flip quirk is INT
  subtraction only). The loadOwned UNION traits branch carries explicit casts.
- **Death / estate (lens C, hand-verified where the verifiers crashed):** the echo reads
  `h.victimOwned.mastery`/`traits` BEFORE the wipe on every death path; the heir's
  statuse/path_at columns start fresh; the legend survives; `retireResident` leaves a dead
  character row whose `masteries` rows are inert cruft only — the leaderboard's `c.alive` JOIN
  already drops retired residents (finding refuted).

## Fixed in-commit (regression each, mutation-verified)

1. **LOW — residents could seat the Trades leaderboard.** `duels.js:159` pays the WINNER's
   wetwork mastery even when the winner is the passive lister — and residents list `duel_limit`
   (that is what lights the ladder), so a resident who wins a duel earns a `mastery_legend` row
   headlessly. `tradesLeaderboard` excluded `agent_flag` but not `npc_flag`, violating the
   population rule ("any step giving residents a legend excludes them on that board at the same
   time"). → the JOIN now also excludes `npc_flag`. *(One of the two crash-unverified findings;
   confirmed by hand.)*
2. **LOW — the port and races boards quoted the UNDISCOUNTED refit/tune price** while the till
   charges (and correctly ledgers) the mastery-discounted number — and the console renders those
   board figures directly on the buy buttons, so the button lied (benign direction: the player
   paid less than quoted). One refuter argued the "boards quote base price" convention
   (boxing trainCost, market listFeeBps) — but these two boards are per-character reads that feed
   buttons, the board/till mirror discipline applies, and both boards already receive `h`.
   → `portBoard` hullCost/engineCost and `raceBoard` tune.cost now quote the discounted number;
   regressions assert quoted == charged at real tills. (Boxing/market base-price quotes are
   pre-existing convention outside this pillar's diff — untouched.)
3. **LOW — `pinkSlipRace` paid no wheels XP** while both sibling race verbs do, despite consuming
   the identical `race_at` cooldown the XP table names as the throttle — a driver racing
   exclusively for pinks schooled nothing (pure under-award, no exploit). → the
   raceNpc/raceChallenge hook added; regression asserts the challenger schooled Wheels.

## Flagged for founder sign-off (NOT patched — ground rule #1; recorded here + BALANCE.md)

- **The path XP multiplier scales the stats-by-use drip.** The drip's P is per XP point *paid*,
  and home trades pay ×1.5 — so a home trade also trains its stat ~1.5× faster (still inside the
  hard CAP_DAY 3). Coherent with "per-XP" as documented, but the two levers are coupled: retuning
  `PATH_XP_HOME` moves stat-training speed too.
- **Fists XP has no winner-side throttle.** A bout pays 25 fists XP to the actor with no
  opponent-quality floor — an alt's junk fighter at the min stake feeds fists mastery at
  rate-limit speed (cost ≈ the 5% rake). The mastery LEVELS die with the street and the perk is
  recovery-pacing only, so the blast radius is small; the dial is the duel-style pair/day decay
  or a stake floor (the GAMBLER_MIN_STAKE shape).
- **Duel wetwork XP lacks the anti-Sybil floor its own legend enforces.** `duel_wins` requires a
  new opponent bloodline per day + a level floor; the 10 wetwork XP pays regardless. Same shape
  as the fists flag; same dials.
- **The DYNAST trait is per-track.** A street maxed in several trades can mark EVERY one dynast,
  multiplying the heir echo (each such track echoes 50% instead of 25%). Reaching L50 in N tracks
  is enormous playtime, and the echo is XP not power — but it compounds the death-softening dial
  `TRAIT_HEIR_BPS`; if the intent is ONE dynasty trade per street, the fix is a one-line
  per-character uniqueness gate in `chooseTrait`.

Point-in-time report (see `docs/AUDITS.md`). Suite green + sim drift-0 after all fixes.
