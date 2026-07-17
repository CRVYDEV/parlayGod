# Audit — Black Market, Skills, and the Underworld (steps 1–5)

Four independent red-team lenses over the three systems shipped after `AUDIT-full-system.md`:
**(1)** §10.4 ledger discipline, **(2)** concurrency / lock order / persist-clobber / death paths,
**(3)** player exploits & abuse economics, **(4)** line-level code correctness. Every claim below
was re-verified against source before action. Full suite 16/16 + `tools/sim.js` drift-0 after fixes.

## Fixed in-commit (code correctness — regressions added)

- **CRITICAL — `buyListing` minted goods from a buy-ORDER.** `POST /v1/market/:id/buy` branched
  only on `kind==='car'`; a buy-order (`kind='order'`) fell through to the goods-sale branch, which
  charged the buyer, paid the *order's poster*, and credited the buyer `qty` units that were never
  escrowed as goods — conjured inventory **and** §10.4 market-escrow drift (an order's `qty×price`
  escrow dropped with no outflow row). Two alts turned a $1,000 order into ~$500k of goods. Fixed
  with a `kind !== 'good'` guard (`not_for_sale`) — orders are filled at the dock, never bought.
  Regression: buying an order id is rejected, no units land, escrow check untouched.
- **MED — bloodline memory inherited the STORED standing, not the decayed effective value.** A
  street idle for months (stored 90 / effective 25) handed its heir `floor(90×25%)=22` instead of
  `floor(25×25%)=6`. `runEstate` now reads `h.victimOwned.npc` (the same effective map every perk
  and the board use). Regression: a victim with a stale row inherits from the floor. *(Committed
  separately as `2caec07`/`a20954b` before this report; listed for completeness.)*
- **MED — `decayedGrudges` could add a PHANTOM grudge under clock skew.** `count − floor(days/14)`
  with `days` computed from DB `now()` (the write) vs the JS clock (the read): if the app clock lags
  the DB even a second, a fresh grudge read `floor(−ε)=−1` → `count+1`, capping the tier and
  inflating a penance charge with zero real grudges. Clamped `days` at 0.
- **MED — `fixFight` raced to a raw 500.** The once-a-week check ran *before* the serializing gang
  lock, so a boss/underboss double-submit (or two gangs around a neon seizure) both passed it and
  the loser died on the week-PK `23505` instead of a clean error — the exact PK-500 class the
  Commission vote/veto paths already harden. The check now runs under the gang lock and the insert
  catches `23505` → clean `fixed`. *(Committed as `a20954b`.)*
- **LOW — the Broker skill undercut the anti-spam listing-fee floor.** `×0.5` applied *after*
  `LIST_FEE_MIN`, so a small ask listed for $5 (below the signed $10 floor). Re-asserted
  `LIST_FEE_MIN` after the discount at all three fee sites — Broker still discounts the percentage
  on larger asks, never below the floor. Regression: a $200 ask by a broker pays exactly $10.
- **LOW — `discharge` lacked the jail gate every sibling underworld action has.** Added it
  (`jailed` → clean error). Regression: a jailed+hospitalized T3 player is refused.
- **LOW — the armorer weekly favor free-repaired a market-LISTED car** (mutating an auctioned item
  bidders were pricing; melt/fence/repair all refuse listed iron). The favor now skips `listed`
  cars. Regression: it repairs the garaged car, leaving the listed one untouched mid-auction.
- **LOW — "Vinnie never grudges" was documentation, not code.** `bearGrudges` had no `fixer`
  exclusion; a victim who was a made friend of Vinnie (≥60) capped the killer's fixer tier. Now the
  loop skips `fixer` (arranged or answered, a kill is his business). Regression strengthened: the
  victim is seeded at fixer 90 and the killer bears no fixer grudge.
- **LOW — a capped bump didn't re-stamp the decay clock.** At standing 100 a positive business
  bump computed `next===cur` and skipped the write, so a maxed player whose daily business wasn't
  the drawn lead task had `touched_at` frozen at the day they capped and dipped below 100 after the
  grace despite daily play. Added an `else`-branch `touched_at` re-stamp. Regression: an armorer-100
  player buying a gun (never the lead task) has `touched_at` moved to now.

## Verified clean (traced, no defect)

Lock order across the market (bid/buy/fill/cancel/sweep/death all lock characters-before-listings,
sorted; no path locks a listing before a character); persist-clobber discipline (every actor/self
payment threads `inMemoryCh`/`killerCh`/`selfRefund`, third parties are relative SQL); every
`bumpStanding` call site holds the actor's own character lock; the market escrow identity (f3) holds
exact on all 14 escrow-moving paths including the race-guard double-settle combinations;
`paySeller` rounding (`take+net==hammer`); all discount sites ledger the discounted number; the
`underworld:gunsale` faucet is bounded (every buy/sell cycle loses ≥60% + crates, no discount stack
reaches it); both respec burns are balance-guarded and vocabularied; skills points can't be
double-spent; every new INT-column write is absolute (pg-mem quirk clean); the errand/lead/streak
ceiling has no multi-claim path; Fastify route resolution has no collisions; rakeback+edge
collusion is net-negative (loses the burn portion).

## Accepted residual (documented, not patched)

- **`voidListingsAtDeath` refunds a standing bidder without the alive-guard the sweep uses.** The
  ledger lens rated this plausible-only and could not construct a reaching interleaving (the same
  listing-row locks serialize concurrent estates, and `burnBidsAtDeath` clears a dead bidder's live
  bids); even if hit, the `market:refund` row carries the bidder's `character_id`, so checks (a) and
  (f3) stay balanced — the failure mode is cash stranded on a zeroed corpse row, not drift. A guard
  here risks stranding un-refunded escrow (an f3 drift *worse* than the LOW), so it is left as-is.
- **A future `rules.js` re-extract that removes a skill node would silently refund points** (stale
  `character_skills` rows count 0 spent). No currency surface — build-integrity only; the trigger is
  a prototype change under ground rule #2, handled at regeneration time, not runtime.

## Flagged for founder — BALANCE / DESIGN calls (NOT patched, per ground rule #1)

These are the exploit lens's findings. None is a code bug; each is a signed-balance or new-lever
decision the founder must make. Ranked by leverage:

1. **Buy-order escrow is a loot-proof cash vault (undercuts the signed Make-Risk-Pay package).**
   `fire`'s loot base is pocket + in-transit bank only; order escrow is invisible to it, jump theft,
   and (on death) burns — so parking cash in a self-order and cancelling (instant, full refund,
   ≤0.5% with Broker) hides liquid value from every loot surface at near-zero cost, dominating the
   2h bank in-transit exposure the signed levers rely on. **Recommendation:** make live un-filled
   order escrow lootable on the poster's death/kill, OR gate order post/cancel as an extraction act
   (safehouse-blocked, a cooldown, or an in-transit window like bank deposits). This is a real
   Risk-to-Earn hole — worth a sign-off decision soon.
2. **The order warehouse is unbounded off-trunk storage escaping MAX_LISTINGS.** `claimOrder` has no
   status filter, so a cancelled order keeps `filled_qty` claimable forever and off the live-listing
   cap; order `qty` at post is unbounded. An alt ring warehouses arbitrary bulk for ~3%, defeating
   the convoy game's "bulk needs an ambushable manifest" premise. **Recommendation:** cap order
   `qty` at post (a new lever) and/or count orders holding unclaimed `filled_qty` against
   MAX_LISTINGS even when cancelled.
3. **Standing velocity is uncapped — "top tiers are EARNED" is defeated.** `bumpStanding` has no
   daily cap; at the 1/s rate limit the cheapest fixture reaches tier 3 in minutes (fixer ~$250 of
   self-cancelled $500 bounty posts; madame ~$130 of $100 dice rolls). Every T3 perk (fee waiver,
   4th slot, velvet rope, whispers) is minutes of scripting. **Recommendation:** a per-fixture
   daily standing cap (e.g. the lead+streak ceiling ~+20/day) — a new lever.
4. **Whispers (madame T3) may kill the silent hunt.** A ~$130 madame-90 grind + a 1/s poll of
   `whispers.asking` (searches have no TTL) lets a script auto-safehouse the instant a hunter places
   a search, wasting the 3h/≥50-round/40-energy/+20-heat investment. The perk *as designed* (a
   count, not names) is defensible only behind an expensive gate; the gate is cheap because of (3).
   **Recommendation:** gate behind (3), or add a whisper lag / raise the dice bump cost.
5. **Reserve-lock car grief (MED).** On a `reserveMet=false` auction, a min-bid locks the seller's
   car for the full TTL (can't cancel/melt/fence/repair, can't hammer) and refunds the griefer in
   full at expiry — zero-cost denial, repeatable. **Recommendation:** let a seller cancel below an
   unmet reserve, or make an unmet-reserve bid forfeitable.

Grudge-griefing (brief's worry) traced **inverted** — the killer is paid (+5 fixer, funds his own
climb) while the victim loses a whole street to inflict a $25k-or-wait-or-ignore choice; not an
exploit. Respec-swapping around opposed contests is architecturally impossible (defenses read live
base stats, not skills; shared 24h cooldown). Both are non-issues.
