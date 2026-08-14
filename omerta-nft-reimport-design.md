# NFT re-import — reactivating an extracted item for in-game use (Option A)

**Status: BUILT off-chain + on-chain contract, CHAIN-DORMANT (founder-directed — "Option A for this"
2026-08-13; built 2026-08-14). A DELIBERATE PIVOT, not a bug fix.** The mechanism is complete: the
GearVault `redeem` burn path (contract + forge tests), the JS `nftDecode`, the `Redeemed` watcher, the
`reimportItem`/`sweepReimports` backend, and `test/reimport.js`. It rides behind the same chain gates as
the rest of the on-chain items rail (`omerta-onchain-items-design.md`) — **dormant in production** (no
`GEARVAULT_ADDRESS`, no live chain) — and the contract change (the burn path) resets the third-party-audit
clock, so it goes into that audit batch before mainnet, never a hot-fix.

**WHAT WAS BUILT vs the sketch below.** The scope was CARS and BOATS (the instance-row classes this design
foregrounds). **Gear is deliberately one-way** — the contract's `redeem` rejects a gear token — because
gear's in-game form is account-level SET MEMBERSHIP (`account_gear`), the same reason `character_assets`
are deferred (§1); rejecting it at the contract means a player can never burn a gear NFT expecting a
re-import that will not happen. The cap accounting (§2/§4) landed as a `redeemed[tokenId]` counter so the
bound is on LIVE on-chain supply (`minted - redeemed <= cap`) rather than lifetime mints — see §2. The
re-import CREATES a fresh row keyed to the burner (never un-flags an existing one — §1). Over-cap is
allowed (the market-win precedent) rather than refused, so a burned NFT is never stranded — see §3.

## 0. What this changes, stated first so it can't be missed

Today an extracted item is **inert**: safe (survives death, can't be stolen or won off you) but
useless in-game (never races, hauls, boosts, fences or melts). That rule is the single thing that
makes a liquid secondary market *safe* — a buyer on OpenSea gets a **trophy, not game power**, so
marketplace demand cannot pull earned power out of the game (`omerta-onchain-items-design.md` §5).

**Option A deletes that safety property on purpose.** Re-import lets the current on-chain owner deposit
the NFT back into the game and use it as a real car/boat/gear. The direct consequence, which the
founder is choosing knowingly:

> **The marketplace becomes a pay-for-power channel.** A player can buy a rare or maxed car on
> OpenSea, re-import it, and hold game power they did not earn. The item's real cost stops being the
> mint/extract price and becomes its **secondary-market floor** — for an item WITH game power, which
> the inert rule existed to forbid.

This is a legitimate design choice (many games make it), but it is a PIVOT away from OMERTÀ's
otherwise anti-pay-to-win posture and away from the sim-audited assumption that rare items are earned.
It must be recorded as such — in BALANCE.md, in the player-facing copy, and in the marketing (a game
where marketplace items convey power is a materially different product to describe than one where they
are cosmetic). The standing no-earnings-promise / no-appreciation-language rules apply with MORE force,
because now a purchasable asset genuinely affects play.

**The half of the rule that STAYS:** an item is still inert *while it is on-chain*. Listing it, holding
it, selling it — all inert. Only the deliberate re-import flips it back to live. So "buy power" is
always a two-step act the buyer chooses (own the NFT → re-import), never a passive property of holding.

## 1. The mechanism

Extraction (already built) is: in-game car row → `mint` the ERC-1155 (GearVault), set
`characters.…minted_onchain=true`, and `loadOwned` filters it out of `owned.cars` so nothing in-game
may touch it (`game.js:371`, `nft.js:100`). Re-import is the exact inverse:

1. **The owner links their wallet** (SIWE — already built). The depositing wallet must resolve to an
   OMERTÀ account with a **living character** to attach the item to (else the re-import waits / is
   rejected with a clear reason — you can't put a car in a dead man's garage).
2. **The owner deposits the NFT to the vault** — an on-chain transaction THEY sign, which is the
   ownership proof. This calls a NEW GearVault path (see §2): the token is **burned or locked**, and a
   `Redeemed(owner, tokenId, amount)` event is emitted.
3. **The watcher** (the polled `getLogs` sync, already built for `Claimed`) sees `Redeemed` after
   `CHAIN_CONFIRMATIONS`, decodes the tokenId (`kind : catalogId : rarity` — the metadata rail already
   derives all three, so the decode half is DONE), and **re-creates the in-game row** on the linked
   account's living character: a car/boat of the exact catalog class and rarity, `minted_onchain=false`,
   live again in `owned.cars`.
4. **The token is gone** (burned) — so the item can never exist on-chain (tradeable) AND in-game
   (usable) at once. That airtight consumption is the entire safety of the feature.

Same flow for boats and gear (the tokenId space already separates them). Assets (`character_assets`,
set-membership with no instance) stay deferred, as the items doc noted.

## 2. The one contract change — a burn/deposit path on GearVault

GearVault is mint-only today (audit G-MED-1 hardened it that way). Re-import needs a consume path.
Two shapes, pick one at build:

- **(a) `redeem(uint256 tokenId, uint256 amount)`** — the holder calls it; it `_burn`s their token and
  emits `Redeemed(msg.sender, tokenId, amount)`. Simplest; the burn is the proof.
- **(b) Deposit-to-custody** — transfer the token to a vault-owned address that can't move it. Weaker
  (custody is a rug surface, the CLAUDE.md escrow rule frowns on it) — prefer (a).

**The supply-cap decision (state it explicitly):** GearVault's per-tokenId `cap`/`minted` bounds
LIFETIME mints. On a burn, does `minted` decrement (freeing cap headroom for a future extraction) or
not?
- **Do NOT decrement (recommended).** The item still exists — it just moved from chain back to game.
  Decrementing would let the SAME rarity slot be minted again later, inflating true scarcity beyond the
  signed `SUPPLY_CAP`. Keep `minted` as "lifetime extracted," so the cap is a hard ceiling on how many
  of a rarity ever left the game, re-imports notwithstanding.
- The re-import itself moves NO new supply into existence: it converts one on-chain token into one
  in-game row. In-game cars conserve by ROW COUNT (the chop/market/pink-slip precedent), so a re-import
  is a +1 row exactly matched by a −1 on-chain token. Net item count across both worlds is invariant.

**Audit note:** adding a burn path is a real change to an immutable, soon-to-be-audited contract — it
RESETS the audit clock, so it must land in the SAME audit batch as the other on-chain-items work
(`omerta-onchain-items-design.md` §3), never dribbled in after.

## 3. Double-spend, idempotency, and the guards that must hold

- **Confirmation before credit.** The watcher credits the in-game row only after `CHAIN_CONFIRMATIONS`
  on the `Redeemed` event — a reorg that un-burns the token must never leave a live in-game car behind.
- **Idempotent on the event.** Each `Redeemed` (txHash:logIndex) credits exactly once (the `vouchers` /
  `fee_payments` nonce discipline). A re-delivered log is a clean no-op.
- **The burn is the ownership proof.** Only the token holder can burn it, so only they can trigger a
  re-import to THEIR linked account. No signature-forgery surface (unlike a voucher — this direction
  needs no server signature at all; the chain event IS the authority).
- **GARAGE_CAP.** A re-imported car respects `GARAGE_CAP` like every other acquisition path (or the
  re-import is refused / queued with a clear reason — the market-win precedent already handles
  over-cap acquisition).
- **Death re-applies.** A re-imported car is a normal in-game car again — it CAN be stolen, chopped,
  raced for pinks, and it DIES WITH THE STREET unless re-extracted. Re-import is the buyer choosing to
  put a safe asset back at risk. State it in the UI: "brought back into play — it's yours to use, and
  yours to lose."

## 4. Wash-trading and the economics to sign off (BALANCE.md)

- **Self-dealing is a no-op.** Extract → sell to your own alt → re-import nets nothing (same person,
  same power, minus gas + the marketplace fee). No exploit there.
- **Buying from OTHERS is real power transfer — and that is the point of Option A.** The sim's
  car-value / racing / hauling balance assumed a rare car is earned; re-import lets it be bought. The
  founder accepts this. The dial, if it ever bites, is a **re-import cost** (an $OMR or ETH sink at
  re-import — Option D from the original scoping) that makes the marketplace a convenience rather than a
  free power buy; ship it at 0 (pure Option A) and raise it only if bought-power distorts the ladder.
- **Rarity floor = OpenSea floor.** For a power item this is the pay-to-win being accepted. Keep the
  no-appreciation-language rule: never market the floor, the "value," or the earning potential.
- **Re-extraction round-trips.** A buyer can re-import (use it), then later re-extract (death-proof it
  again to resell). Each extraction is the existing `withdraw`/mint path; each re-import the new burn
  path. The GearVault `minted` cap not decrementing (§2) means re-extraction of a re-imported item does
  NOT consume fresh cap — it re-mints the same rarity slot the burn vacated in-game. This is the one
  place the cap accounting needs care: track it as "this specific item's token can be re-minted on
  re-extraction" rather than "a new mint against the lifetime cap." Simplest correct rule: **a
  re-import burns the token but records that this item is re-extractable to the same rarity without
  counting against `SUPPLY_CAP` again** (a per-item flag, not a fresh cap draw).

## 5. Player-facing framing (founder review)

The copy must change with the mechanic. Today's line is "extracted = a trophy, not an advantage."
Under Option A it becomes something like: *"Extracted items are yours on-chain — trade them freely.
Bring one back into the game to drive it, and it's live again: yours to use, and yours to lose."* No
promise of value, no appreciation language, no earnings claim — the standing rules, which matter MORE
here because the asset now conveys power. The founder signs the exact wording.

## 6. Sequence + gates

1. Spec the GearVault burn path (§2, shape (a) `redeem`) + the re-extractable-item cap flag (§4).
2. Build it INTO the on-chain-items audit batch (never alone — it resets the clock).
3. Wire the `Redeemed` watcher + the re-import backend (decode tokenId → re-create the row, all the
   §3 guards).
4. BALANCE.md: record Option A as a signed pay-for-power pivot with the re-import-cost dial at 0.
5. Player + marketing copy (§5), founder-signed.
6. Gated on chain go-live + the third-party audit (contracts AND the new burn path), exactly like the
   rest of Door 3.

**None of this is a launch item.** The chain is dormant in production; re-import rides behind the same
gates as extraction itself.
