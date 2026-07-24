# AUDIT — the Tier-3 → Tier-4 deepening program (combined red-team)

**Scope.** The six mid-depth ("Tier-3") systems deepened to the Tier-4 depth bar this program:
**Business Empire · Convoys · The Commission · The Reserve Bond · The Store & The Ledger ·
The Estate & Auction House**. Each gained the missing depth elements (multiple orthogonal
mechanics + a scaling catalog + a competitive/meta layer + a survives-death status legend on a
new `/v1/leaderboard/*` + a console screen). Commits: `82521ac` (Business), Convoys, `a5e0c6f`
(Commission), Reserve Bond, Store/Ledger, `8c8e830` (Estate & Auction).

**Method.** Six red-team lenses, source-verified against the actual code (not the design docs):
per-system deep reads of the two systems built this session (Commission, Estate & Auction) plus
targeted verification of the four built earlier, and two cross-cutting lenses (§10.4/invariants,
concurrency/persist-clobber/death). Every claim below was checked against source; the full suite
(45/45) + `node tools/sim.js` (§10.4 drift-0 across all checks) passed with the shipped code.

## Result: **no CRITICAL, no HIGH, no MED.** The batch is §10.4-clean and lock-safe.

The Tier-4 work is, by construction, overwhelmingly **status legends** (pure counters that move
zero §10.4 currency) plus **deflationary $OMR sinks** and one **new $OMR-escrow surface** (player
consignment). The one genuinely intricate ledger change — the consignment escrow — was verified
exact in three independent ways (source read of the invariants edit, the escrow identity math, and
the `test/auction.js` mid-listing + post-settle reconcile).

### Lens A — §10.4 / invariants (the riskiest surface): CLEAN

- **The Estate/Auction escrow extension is exact.** `auctionEscrow` (invariants.js:173-174) now
  sums live bids across **both** `auctions` **and** `auction_consignments`. `omrBurns` (line 207)
  gained `auction:take` and `auction:consign:fee` as **EXACT** matches — deliberately **not** a
  blanket `LIKE 'auction:%'`, which would have misclassified the `auction:bid`/`auction:refund`/
  `auction:consign` **transfers** as burns and broken conservation (this is the trap the critique
  flagged; the comment at line 205 calls it out). The `auction escrow` check (line 227) became
  `aucBids − aucRefunds − aucWins − aucConsign − aucTake`, with `auction:consign` a transfer OUT of
  escrow (subtracted here, absent from omrBurns) and `auction:take` a burn (subtracted here AND in
  omrBurns). `test/auction.js` proves it reconciles mid-listing (`esc.lhs == top`) and after settle
  (`esc.lhs == 0`, conservation drift == the SQL grants only).
- **Every new reason rides the right per-currency vocabulary.** The omr `KNOWN_REASONS` array
  (line 45) carries `'auction:'`, `'bond:'`, `'business:spec'`, `'estate:'`; the cash vocabulary
  carries the Commission/Convoy cash reasons; `business:spec%`/`bond:%` join `omrBurns` as burns.
- **`bond:pledge` (the Reserve Bond Tier-4 pledge) is a pure §10.4 BURN**, not a reserve fund.
  `pledgeTreasury` (bonds.js:197-208) spends $OMR through `spendOmr('bond:pledge')` and bumps a
  status counter (`pledged_omr`) — it **does not touch** `bond_reserve.capacity_omr`/`funded_omr`,
  so it creates **no unbacked extraction path** (the "extraction ≤ real inflow" wall of the
  full-reserve withdrawal queue is untouched). The Underwriters' League/score is read-derived.
  This was the highest-flagged pre-audit risk and is a **non-issue**.

### Lens B — concurrency / persist-clobber: CLEAN

- **All ten new `account_persistent` columns are clobber-safe.** `statecraft`, `prestige_sunk`,
  `season_sunk`, `laundered_lifetime`, `freight_delivered`, `freight_hijacked`, `pledged_omr`,
  `bond_charter`, `patron_spent`, `pass_seasons` are each written **only by direct SQL**, are
  **NUMERIC** (so `col = col + $n` is pg-mem-arith-safe), and are **absent** from the
  `persistAccount` positional UPDATE (game.js:485-492, which writes only omr/staked/rewards/prestige/
  deaths/recruits/checkins_lifetime/ref_paid/onboard/wallet_address/minted/mint_credits/
  respawn_tokens/hitman_rep/kills/unbonding/unbond_at/rat) — so no positional overwrite.
- **The consignment lock order is acyclic and race-clean.** `bidConsignment` locks the actor
  account (withCharacter) → the consignment row FOR UPDATE (which already EXISTS, created at
  `consignTrophy` — so unlike the server auction there is **no materialize race / 23505 path**).
  `sweepConsignments` (worker) locks the CLOSED consignment row → credits third-party seller/buyer
  accounts by direct SQL (the outbid-refund precedent). Bids land only while `now < closes_at`;
  settle runs only after — the live-vs-closed partition means no same-row AB-BA (the `sweepAuctions`
  posture). The `auction_wins` reassign is guarded `WHERE lot_id AND account_id=seller` and is the
  only writer of that row in the settle txn; the PK `(account_id, lot_id)` can't collide (one
  trophy per lot, one owner).
- **`season_sunk` reset is idempotent.** Done in `runSeasonRollover`'s per-char txn (worker.js:206),
  gated by the character's `season < current` and stamped to `current` in the same txn, under the
  char FOR UPDATE — the same account-write the prestige/duel-title bumps already use. No new lock.
- **Commission `bumpStatecraft`/`overrideVeto` are single-party or worker-only.** `proposeDecree`
  bumps statecraft BEFORE the gang FOR UPDATE (accounts-before-gangs preserved; a failed propose
  rolls the whole withCharacter txn back). The ENACTED bonus is **post-commit own-txn** (settle
  runs under held gangs+singleton locks, so an in-txn account bump would invert accounts-before-gangs
  — correctly deferred). `overrideWeightOf` string-coerces both sides of the TEXT-vs-UUID gang_id
  comparison.

### Lens C — death / estate: CLEAN

- Every Tier-4 legend + the auction trophies + estates + the consignment escrow are **account-level**
  and **survive death by construction** — `runEstate` (social.js:1453-1465) explicitly excludes the
  Portfolio/Estate, and `auction_wins`/`auction_consignments` are account/seller-account-keyed (never
  in the character-scoped wipe). A dead consignor's live consignment settles normally (the account,
  and thus the trophy row + the net credit, survive); a dead bidder's escrow refunds/vests to the
  surviving account. **No special death handling needed, none missing.**
- `blood_oath` threads through `runEstate` only on a PLAYER fire-kill (`opts.loot` true +
  `opts.bloodOathMult` passed); NPC/mod kills pass neither, so `estateLootRate = 0` and the mult is
  inert for them.

### Lens D — the touchpoints (decrees / takeover): CLEAN

- **`blood_oath`** is applied to **both** fire-kill CASH-loot sites (social.js:1029 pocket/transit,
  1635 estate escrow legs) via the same `bloodOathMult`/`opts.bloodOathMult`, composed with the
  seasonal `lootMult`, and clamped at the signed `Math.min(0.5, …)` ceiling. Cash-only (the $OMR
  loot at 1044 is untouched, matching the design). The dual-loot-site fix the critique demanded is
  in place.
- **`smugglers_moon`** scales only the **computed** interdiction `p` (port.js), left inert when the
  TEST-ONLY `PORT_INTERDICT_P` knob is set — the roll knob stays deterministic.
- **The business hostile takeover** pins **`p`** (not the roll) via the TEST-ONLY
  `BUSINESS_TAKEOVER_P` (business.js:408, the standover precedent) and is the audited two-party
  taxed transfer (fee sink `business:takeover`, the buyout transfer, 1% → `street_tax` singleton
  locked LAST in canonical order, 1% dev off-ledger).

## Founder sign-off flags (NOT defects — balance/design, ground rule #1)

Recorded in `BALANCE.md`; none is a bug, all are levers or accepted postures:

1. **`blood_oath` ×1.25 modifies the signed `CASH_LOOT_RATE`** — a temporary one-week decree
   modifier on a signed lever, clamped at the existing 0.5 ceiling (the open_season/amnesty
   precedent). `BLOOD_OATH_LOOT_MULT` is a sign-off lever; the mult never breaches the cap.
2. **Player consignment is a new P2P $OMR transfer rail** (bidder→seller). It is **net-deflationary**
   (both `TAKE_BPS` 5% and `FEE_OMR` 2 burn; collusion is −EV by the take — the market/loan/bodyguard
   rake precedent), so it can only shrink supply, but it IS a new $OMR movement path — flag for
   sim/sign-off. Dials: `AUCTION.CONSIGN.TAKE_BPS` / `FEE_OMR` / reserve bounds / `MAX_LIVE`.
3. **The Collector / Statesman / Patron / Benefactor / Underwriter / Teamster boards are
   Sybil-inflatable** by a self-funded whale — status only, no payout attaches (the referral/
   hitman-rep accepted posture).
4. **Deeper $OMR sinks** (the tier-6 Palazzo, legendary rare lots, family/estate seals, bond
   charter/pledge, business spec) are deflationary and help `extraction ≤ inflow` — favored.
5. **`season_sunk` boundary edge (LOW, accepted):** an account whose character dies exactly at a
   28-day season boundary keeps last season's `season_sunk` one extra season (a cosmetic Patron-crown
   inaccuracy, no §10.4, no payout) — consistent with the codebase's existing per-char lazy season
   markers (duel_elo/respect).

## Verification artifacts

- `npm test` — **45/45** suites green (incl. the extended `test/commission.js`, `test/auction.js`,
  `test/estate.js` Tier-4 blocks).
- `node tools/sim.js` — **§10.4 drift-0** across every check, including `auction escrow`,
  `commission escrow`, `$OMR conservation`, `reason vocabulary`, and the gang-treasuries check.
- No code fix was required — nothing survived verification as a real defect.
