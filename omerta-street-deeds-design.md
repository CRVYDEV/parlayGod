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

### Phase 2 — control: rent (B) + turf (C) (DESIGNED · sim + founder sign-off before ship)
The income layers touch §10.4 and the war economy, so they get the full treatment, not a fast slam:
- **B (rent):** a "corner take" that **redirects** a bounded existing faucet (the shakedown/territory
  pattern — the owner keeps the rest, the clock advances by only the stolen share, so total emission
  stays bounded by the same signed curve → §10.4-neutral). Capped. Collected only while you control
  the street; contestable by rivals (the existing rival-raid/shakedown mechanic).
- **C (turf):** owning a street grants a **racket slot + turf perks in that district**, capped at what
  a free player earns by seizing turf. Interacts with the war system — the deed is permanent, but the
  *control* can be occupied/shaken down by whoever has muscle there.
- Both sim-measured (the P9.x faucet-measurement discipline), tabled in BALANCE.md, founder-signed.

### Phase 3 — the tradeable NFT + secondary market (AUDIT-GATED · a new contract resets the audit clock)
- On-chain deed as a tradeable token; the DEED transfers, the **extraction entitlement stays
  account-bound** (the identity-NFT lesson, verbatim — or the secondary floor becomes the Sybil cost
  and dead-alt streets flood the order book).
- Provenance travels with the token (it's the value); control does not (it's earned by the new holder).
- Gated on the launch checklist + a third-party audit, exactly like every other chain feature.

### Phase 4 — the growing map (design; ships with Phase 1's map render)
As the mint count crosses thresholds, new blocks/neighborhoods **open** on the map — deterministic
off the world seed (the §7.11 hash the game already generates content from). The city expands with the
playerbase; late joiners get fresh ground. **Marketed as a living, growing world — NEVER as "limited
land that appreciates"** (§6).

---

## 3. §10.4 PLAN (how it stays conservation-clean)

- **Phase 1 is zero-surface:** the deed, its name, its map plot, and its provenance are all status.
  No `transactions` row is written; the reason vocabulary is unchanged; the sweep stays drift-0. The
  test asserts zero ledger rows across the whole flow (the portrait/dynasty precedent).
- **Phase 2's rent is a REDIRECT, not a faucet:** it rides the existing `territory`/`shakedown`
  vocabulary (owner keeps the rest, the shared clock bounds total emission by the signed curve). No
  new mint reason; the gang-treasuries / per-character checks reconcile it. Measured before ship.
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
