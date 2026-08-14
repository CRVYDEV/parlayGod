# OMERTÀ — STREET DEEDS (the map as property)

**Founder-directed, 2026-08-14.** Reframe the identity mint from a character PFP to a **Street Deed**:
a named, mapped plot of the world a player owns, trades, and builds a legend on — the Monopoly layer.
The founder wants all three of collectible (A), rent (B), and productive turf (C), so the deed becomes
a genuinely valuable NFT on secondary markets.

This doc specifies how to do that **without** (1) breaking the sim-audited turf/war economy, (2) turning
minting into pay-to-win, or (3) shipping a security. The whole thing rests on one structural move.

---

## 0. THE ONE IDEA: separate the DEED from CONTROL

- **The deed** is permanent, on-chain-eventually, tradeable **property.** A named street, mapped, with
  generative block art and a **record of everything that ever happened there.** Nobody takes it off you
  on-chain. This is the valuable, collectible, sellable thing.
- **Control** — the rent (B) and the turf power (C) — is **earned and defended in-game.** You own
  Boardwalk, but if you don't have muscle on it, a rival moves in, shakes it down, and collects while
  you hold the paper.

Everything below follows from that split. It is what lets A+B+C coexist:

| | Layer | Lives where | Contestable? |
|---|---|---|---|
| **A** | the deed + its legend | on-chain property (eventually) / account-level status now | no — it's yours forever |
| **B** | the corner take (rent) | in-game, routed through the capped shakedown faucet | **yes** — you collect only while you control it |
| **C** | turf power (a racket slot, perks) | in-game, capped at free-player parity | **yes** — earned and defended like any turf |

**Why this is the safe *and* the valuable version:**
- **Not pay-to-win:** money buys the deed and a head start; the income ceiling is what a free player
  reaches by seizing turf in a war. A whale who buys 100 streets but can't defend them earns nothing.
- **Keeps the war game alive:** the income is fought over, not passively piped, so turf/territory/
  sovereignty are untouched.
- **The value is player-made, not team-promised** (see §5) — which is the strongest fact for the
  securities posture (§7).

---

## 1. WHAT A STREET IS

- **Account-level property**, one deed per account (mirrors how the mint is one `minted` flag per
  account today). Survives death — your characters die, the street stays yours. The heir inherits it.
- **Named** — a unique street name, claimed at mint, validated like living-street names
  (uniqueness, the creation-rules text filter, no impersonation).
- **Mapped** — the deed belongs to one of the six core districts; it renders as a plot on the
  existing `/v1/map` board (`src/citymap.js`), *under* the district's family-turf layer. Districts are
  neighborhoods; streets are the addresses inside them.
- **Arted** — a generative "block / street sign" plate, reusing the `portrait.js` composition engine
  (the identity-NFT art work carries over — same machinery, a place instead of a face).
- **Historied** — the deed accrues a **provenance record** (§4): the empires built on it, the wars
  won, the bloodlines that died holding it, who owned it before you. This is the value engine.

**Naming / collision note:** `/v1/streets` is already the district roster of *characters*, and "your
street dies" already means your character. To avoid overload, the DEED system is namespaced
`/v1/deeds` and the in-game object is "your **Deed**" / "the Deed to <Name>". Player-facing copy can
still say "own your street"; the code says `deed`.

---

## 2. THE BUILD, PHASED (matching this codebase's own discipline)

Every chain/economy feature here ships off-chain-first, sim-gated for anything touching §10.4, and
audit-gated for any new contract. Street Deeds is no different.

### Phase 1 — the deed + the legend engine (BUILD NOW · pure status · §10.4-ZERO)
The A layer and the value driver, buildable correctly today with zero economy risk:
- `street_deeds` (account-keyed, survives death — the estate/portfolio precedent).
- Claim a named deed, mapped to a district; render it on the map + a console surface.
- **Provenance accrual** — record notable events on a deed (the legend).
- A "great streets" status leaderboard (most legendary blocks).
- The deed-vs-control columns present but income dormant (`controller`, contest hooks stubbed).
- **Deliberately NOT wired into the live mint or the extraction/`minted` flag** — additive and
  independent, so the Sybil/extraction machinery is untouched.

Pure status, like the portrait/dynasty/estate: no currency moves, no new faucet, the nightly §10.4
sweep stays drift-0 by construction.

### Phase 2 — control: rent (B) BUILT · turf (C) deferred (sim-measured + founder sign-off levers)
The income layer touches §10.4, so it gets the full treatment. **B (rent) is BUILT** as THE CORNER
TAKE; **C (turf perks) is deferred** — it touches the SIGNED district-perk surface, so it wants its own
founder sign-off, not a slam.
- **B (rent) — THE CORNER TAKE + THE SHAKEDOWN (`src/deeds.js`, `test/deeds.js`):** a small, HARD-CAPPED
  lazy cash faucet (`deed:corner`, `DEEDS.CORNER_PER_HR` × up to `CORNER_CAP_MS` 24h) collected only by
  whoever **controls** a deed. Control is contestable: `shakedownCorner` is a stat contest (muscle +
  cunning/2 vs the incumbent) that **seizes control** for `CONTROL_MS` (a rival muscles in) or lets the
  owner **reclaim** their own corner; the seize forfeits the pending take (the seize precedent) and the
  shakedown moves **control, not money** (§10.4-neutral). Collecting is safehouse-gated (the signed D2
  "shield not bunker" income rule its `collectTerritory` sibling enforces); the shakedown is
  location-pinned (you must stand on the block) + level-floored + energy/heat/cooldown-bounded.
  - **HONEST NOTE, corrected from this doc's own §3 ideal:** B is a genuine small **bounded faucet**,
    not the "pure redirect" §3 first proposed. A true redirect (the owner keeps the rest, the shared
    clock bounds emission) needs a **cross-character lock on a hot path** (the collector and the deed
    owner are different accounts) or a new §10.4 bucket. The cleaner engineering answer is the
    **bounded-faucet-measured-and-flagged** precedent the whole game already uses (territory/business/
    port/world): `deed:corner` is a character_id'd cash faucet the per-character §10.4 check reconciles,
    it is measured in `tools/sim.js` **P9.37**, and every `DEEDS` number is a founder sim sign-off lever
    (BALANCE.md, pinned in `test/levers.js`). Base-wide ceiling = (deed holders) × PER_HR × 24h — ONE
    deed per account, so it is linear in the playerbase and petty per deed (~a territory-racket rung).
    The shakedown only moves WHO collects, so contesting a corner can never **widen** the faucet.
- **C (turf) — DEFERRED:** owning a street granting a **racket slot + turf perks in that district**
  touches the sim-audited district-perk surface, so it is a separate founder sign-off (capped at what a
  free player earns by seizing turf), not shipped with B.
- B is sim-measured (P9.37), tabled in BALANCE.md, all numbers founder sign-off levers.

### Phase 3 — the secondary market (off-chain core BUILT · the on-chain tradeable NFT BUILT, chain-dormant)
**Both the off-chain SECONDARY MARKET and the on-chain ERC-721 are BUILT** (2026-08-14; the founder
cleared all three former blockers — legal approved every design choice, no launch-schedule constraint,
build guided by completeness). Off-chain: `src/deeds.js` `listDeed`/`unlistDeed`/`buyDeed`. On-chain:
`omerta-contracts/src/StreetDeed.sol` (ERC-721, EIP-712 self-mint on the shared voucher signer, NO owner
mint, Safe-owned; 21 Foundry tests, part of the pre-mainnet audit batch — CHAIN-DEPLOY §0.5/§2a) +
`src/chain.js` (`requestDeedWithdraw` / `markDeedExtracted` / `reimportDeed`) + `src/watcher.js` (the
`Extracted`/`Redeemed` syncs). Chain-DORMANT until `STREET_DEED_ADDRESS` is set on both processes.
- **The market (BUILT):** a deed holder LISTS their street for cash (`sale_price`, no escrow — the
  car-auction row-stays precedent; you keep collecting the corner while listed). A **DEEDLESS** buyer
  buys it (one deed per account — the identity/Sybil model; a multi-deed PORTFOLIO is a deferred step
  needing the `account_id`-PK refactor). The deed + its **whole PROVENANCE** (the legend) transfer to
  the buyer, and **CONTROL RESETS** (the identity-NFT lesson, verbatim — the paper + legend travel, the
  corner-take control does NOT; the buyer must shake for the corner). §10.4: `deed:sale` is the audited
  **bodyguard:hire** non-escrow taxed transfer — seller nets 98% (1% dev off-ledger + 1% street tax →
  buyback), riding the existing `deed:` cash prefix (no new reason, no mint, no faucet — a pure
  redistribution). The test asserts exactly two `deed:sale` rows (the two-party transfer, no mint) + the
  transferred legend + reset control.
- **On-chain (DESIGN):** the deed as a tradeable ERC-721; the DEED transfers, the extraction entitlement
  stays **account-bound** (or the secondary floor becomes the Sybil cost and dead-alt streets flood the
  order book). Provenance travels with the token; control does not. Gated on the launch checklist + a
  third-party audit + securities counsel.

### Phase 4 — the growing map (BUILT · §10.4-ZERO — pure render)
**BUILT** (`src/deeds.js` deedBoard + `DEEDS.NEIGHBORHOODS`/`deedNeighborhoodsOpen`/`deedNeighborhoodOf`).
Each district's **neighborhoods OPEN in order** as the **living-player population** crosses
`EXPANSION_STEP` thresholds (the "as users join" framing the founder named — deterministic off the
count, not a mint). A deed's neighborhood is DERIVED from its name (stable, no column); a not-yet-open
one reads as the **FRONTIER** (you claimed ground before it was even a neighborhood). The city expands
with the playerbase; late joiners get fresh ground. **§10.4-ZERO** (reads + a formula — no schema, no
faucet). Surfaced on `GET /v1/deeds` (a `city` summary + per-district `neighborhoods {open, coming}`)
and the map render. **Marketed as a living, growing world — NEVER as "limited land that appreciates"**
(§6, the project's highest-scrutiny copy surface).

---

## 3. §10.4 PLAN (how it stays conservation-clean)

- **Phase 1 is zero-surface:** the deed, its name, its map plot, and its provenance are all status.
  No `transactions` row is written; the reason vocabulary is unchanged; the sweep stays drift-0. The
  test asserts zero ledger rows across the whole flow (the portrait/dynasty precedent).
- **Phase 2's rent (BUILT) is a bounded, measured CASH FAUCET, `deed:corner`:** the one new reason,
  added to the cash `KNOWN_REASONS` prefix `deed:` in `invariants.js`, character_id'd → the per-character
  cash check reconciles it. NOT the "pure redirect" first proposed here — a redirect needs a
  cross-character lock on a hot path or a new bucket; the bounded-faucet-measured-and-flagged precedent
  (territory/business/port/world) is cleaner. Hard-capped (`CORNER_CAP_MS` 24h, one deed per account),
  measured in `tools/sim.js` P9.37, every number a founder sign-off lever. The shakedown moves control,
  not money (zero ledger rows). The test asserts `deed:corner` is the ONLY new cash faucet across the
  whole Phase-2 flow and the shakedown is §10.4-neutral.
- **The claim fee (if any) is a SINK,** routed to the desk like every other $OMR sink, or an ETH mint
  fee out-of-band (the fees.js precedent — zero `transactions` rows). Decided at Phase 3.

---

## 4. THE LEGEND ENGINE (why one street outsells another)

This is the real product, and nobody else has it. A deed records its history, so its value is the
story on it — like a jersey a champion wore, or a Punk with provenance. Recorded events (each a
pure-status append to `street_deed_history`, keyed by deed):
- **Blood:** a fire-kill that happens while the victim (or killer) is standing on the street; a
  bloodline that dies holding the deed.
- **Empire:** a business/racket run on the street; a war won by its owner; a Commission seat held.
- **Title:** the deed's owner reaching an assassin/territory/boxing rank.
- **Lineage:** every prior owner (on transfer, Phase 3), with generation and dates.

The map surfaces "the deadliest / most storied streets," and a deed's page reads like a dossier of
what happened there. **This is what makes a Street valuable on a secondary market — and it can't be
farmed or faked, because it's a record of real play.**

---

## 5. VALUE COMES FROM LOCATION + LEGEND, NOT A PROMISED YIELD

Two durable, defensible value drivers — neither is a claim the team makes:
- **Location** = Monopoly board position. A street on the Neon Mile is Boardwalk; the docks are the
  railroads. The market prices it; we say nothing.
- **Legend** = §4. Player-created history, unforgeable, the strongest driver.

We never sell a yield. The rent (B) is contestable and capped, so it's a game mechanic you must *play*
to realize — not a passive coupon. That distinction is load-bearing for §7.

---

## 6. MARKETING GUARDRAILS (bind hard — this is the highest-scrutiny surface in the project)

From `MARKETING.md` §0, with extra force here:
- **Never** "buy land, it'll appreciate / be worth more / limited supply / get in before it runs out."
  The map growing is *a living world*, never *scarce real estate*.
- **Never** a yield/APR/"earn rent" claim framed as income. Describe the *mechanic* ("hold the corner
  and you take a cut of what moves through it"), never the *outcome*.
- **Never** a floor/price/appreciation number.
- The deed is *property with a history* — "own your block, and everything that happens on it becomes
  its story." Emergent value, player-made. That is the whole pitch and it is enough.

---

## 7. THE SECURITIES POSTURE (needs real counsel before Phase 3 mints anything)

Said plainly: *"a productive land NFT that pays rent and appreciates on secondary markets"* is, worded
that way, the textbook description of a security. The deed-vs-control design is specifically what keeps
it on the right side, for two concrete reasons a lawyer can lean on:
1. **Returns require the holder's own effort.** You aren't paid for holding paper; you're paid for
   playing (defending the corner, running the crew). That is the line between "an investment where
   others do the work" and "a game where you do."
2. **The team promises no value.** Utility is capped at earned-parity (a game item, not a yield
   product); the market — not us — sets the price; the copy never mentions appreciation.

**This does not ship to mainnet without securities counsel in the room, alongside the contract audit.**
The phasing buys that runway: Phases 1–2 are off-chain game mechanics; only Phase 3 mints a tradeable
token, and it is audit- and counsel-gated.

---

## 8. HOW IT UNIFIES WITH THE MINT (the founder's original framing)

Today the mint grants `account_persistent.minted` = the right to extract (the Sybil bound). The
founder's idea is that the mint *produces a deed* instead of a PFP. The clean end-state (Phase 3):
- **Minting = claiming your Street** — one deed, one account, the same one-per-identity bound.
- The deed is the tradeable trophy; **`minted` (the extraction entitlement) stays a separate,
  account-bound flag** that does NOT travel with a deed sale.
- Until Phase 3, Phase 1's deed is claimable by any account independent of `minted`, so nothing about
  the live extraction/Sybil machinery is touched. The unification is a chain-phase decision made when
  the contract is built and counsel has reviewed.

---

## 9. OPEN DECISIONS (founder)
1. **Claim cost** for a Phase-1 deed: free (pure onboarding/collectible), a small cash sink, or a
   small $OMR sink? (Recommend: free in Phase 1; the ETH mint fee attaches at Phase 3.)
2. **One deed per account, or a few?** (Recommend: one, matching the identity/Sybil model; a Monopoly
   *portfolio* of many streets is a Phase-3 secondary-market behavior, not a mint primitive.)
3. **B/C ceiling** — where "free-player parity" sits exactly (a sim call for Phase 2).
4. **Art:** block/street-sign plate, or keep the bloodline portrait *and* add a deed plate? (Recommend:
   a deed plate; the portrait stays the character's face.)

---

## 10. WHAT SHIPS IN THIS SESSION (Phase 1)
`src/deeds.js` (a pure-status module): claim a named deed → mapped to a district → rendered on the map;
provenance accrual on the notable events already emitted by the game; a "great streets" leaderboard; a
console surface; survives death (heir inherits; the estate report shows it kept). `street_deeds` +
`street_deed_history` tables (account-keyed → outside the estate wipe by construction). ZERO §10.4
surface (proven by the test counting zero ledger rows). No touch to the mint, extraction, or the
signed turf economy. B/C income and the on-chain token are Phases 2–3, gated as above.
