# On-chain items — marketplace-ready NFTs for cars, gear, and the portrait (design only)

**Status: DESIGN ONLY. Nothing here is built, nothing touches launch.** Founder question, prompted
by Unipeg/uPeg (@unipegv4): *should OMERTA's tradeable items (cars, gear, the identity portrait)
use fully-on-chain generative tech like Unipeg, so they sell well on NFT marketplaces?*

The answer is nuanced and it is **"borrow the right idea, reject two wrong ones, and match the tech
to each item class."** Up front:

- **The real gap is not aesthetics — it is that the metadata rail does not exist.** `GearVault` has
  no `tokenURI`, so an extracted OMERTA item today renders as **nothing** on OpenSea. That is the
  actual thing to fix, and it is fixable without adopting any Unipeg mechanic.
- **Borrow: "the object itself is the thing" — no fragile server dependency.** Achieve it the
  standard, art-preserving way (on-chain traits + IPFS-pinned images) for the rich photographic
  items, and go *fully* on-chain only for the portrait, which is already vector SVG.
- **Reject: art that re-rolls on every trade** (Unipeg's core mechanic). It is a memecoin gimmick
  and it is the exact anti-pattern OMERTA already ruled out for the Dynasty NFT (freeze at transfer).
- **Reject: pixel-arting the car catalog** just to fit fully-on-chain rendering. The rich generated
  art is an asset; do not throw it away to win an on-chain-maximalism point the game does not need.

---

## 1. What Unipeg actually is, and what is genuinely clever in it

uPeg is a fully-on-chain generative NFT where **the art is a live function of the token's own
trading history.** A v4 hook (`UpegHook.sol`) re-randomises an on-chain seed on every swap (seed
inputs: swap count, `block.timestamp`, `block.prevrandao`, `block.number`), exposes it via
`IRandomSeedProvider`, and an on-chain SVG renderer draws a 24×24 unicorn from it — no IPFS, no
external storage, one image per whole token. The hook is `afterSwap`/`afterAddLiquidity` only, takes
nothing from the pool, "only listens, then updates state."

Two distinct pieces of tech are bundled here, and they must be judged separately:

1. **Fully-on-chain SVG rendering** (deterministic image from on-chain data, returned as a `data:`
   URI in `tokenURI`, no server, no IPFS). This is real, battle-tested tech — Nouns, Loot, Chain
   Runners did it years ago; Unipeg is a clean v4-native example. **This piece is worth learning
   from.**
2. **Market-activity-as-state** (the seed re-rolls on every swap, so the object mutates with its
   trading). This is the novel, eye-catching bit — and it is **the wrong pattern for a game item.**

## 2. Why "art that changes when it trades" is wrong for OMERTA — and already-decided

A game item represents a *specific thing you own*. A player's rare car re-rolling its appearance
every time it changes hands is not a feature; it degrades the thing the buyer bought. OMERTA already
reasoned to exactly this conclusion on the Dynasty portrait, for a sharper reason: *the portrait is
dynamic while the minting wallet holds it and FREEZES at first transfer* — because a "living"
portrait that re-renders on the seller's later play lets a seller vandalise the buyer's asset (rat
after the sale and degrade what they sold). Unipeg's re-seed-on-swap is that anti-pattern as the
headline feature.

It also collides with a signed OMERTA rule: **"sell deterministic, drop random."** Rarity is rolled
once, at earn time (rng-audited), and never re-rolled; the paid upgrade grants *exactly* the tier,
never a gamble. Unipeg's live seed is a perpetual roll. Adopting it would re-introduce the loot-box
dynamic the rule exists to forbid.

**So: adopt on-chain RENDERING where it fits, never on-chain RE-SEEDING. Item identity is stable,
deterministic, and frozen once it leaves your hands.**

## 3. The tech, matched to each item class

OMERTA has three NFT classes with three different art styles. One tech does not fit all.

| Class | Art today | Right tech | Why |
|---|---|---|---|
| **Cars / gear / boats** | rich generated *photographic* plates (245 fal.ai images) | **on-chain traits + IPFS-pinned image** | a 260KB JPEG cannot live on-chain affordably; IPFS pins it permanently, traits go on-chain, the rich art survives. Marketplace-standard. |
| **The Dynasty portrait** | layered vector **SVG** (`portrait.js`) | **fully on-chain** (Unipeg-style rendering, deterministic) | it is *already* vector and layered; porting the renderer to Solidity makes the identity NFT truly self-contained — "the object itself is the thing," where it matters most. |
| **A future on-chain-native cosmetic line** (optional) | — | **fully on-chain pixel/SVG** | if you ever want a deliberately on-chain-maximalist collectible, THIS is where Unipeg's exact style belongs — a new line designed for it, not a retrofit of the cars. |

The load-bearing insight: **Unipeg's "no fragile server dependency" property is worth having, but
you get it for the photographic items via IPFS pinning without pixel-arting anything.** Full
on-chain rendering is only worth its gas + art-rewrite cost for art that is *already* vector — which
is exactly the portrait, and nothing else you have.

## 4. The actual gap to close first (independent of any Unipeg decision) — ✅ BUILT 2026-08-13

Before any of §3's ambition: **`GearVault` needs on-chain metadata at all.** It shipped with an
`uri(id)` that returned `<base><id>.json` — a URL to an off-chain, server-hosted file — so an
extracted item was invisible on a marketplace the moment that host wasn't serving it, and its traits
were a server's claim rather than the token's. The minimum viable marketplace rail:

1. **`uri(id)` on the vault** returning a self-contained ERC-1155 metadata JSON `name`,
   `description`, `image`, `attributes` (the item's rarity, catalog id, and its stable traits).
2. **The image**: for cars/gear/boats, an IPFS URI to the pinned plate (per catalog-id × rarity); for
   the portrait, a `data:image/svg+xml` URI rendered on-chain (§3).
3. **Traits on-chain** so the marketplace shows rarity/attributes and they are provably the token's,
   not a server's claim.

**Shipped (`GearVault.sol` + `test/GearVault.t.sol`, forge 222/222):** `uri(id)` now assembles a
`data:application/json;base64,...` JSON on-chain. The tokenId is self-describing (gear `1..N`; car
`CAR_BASE + idx*STRIDE + rarityIdx`; boat `BOAT_BASE + ...`, mirroring `RARITY.TOKEN`), so **every
scarcity trait — Type / Class / Rarity — is DERIVED from the tokenId with zero per-token storage**,
which is exactly what makes it provable rather than a claim. Only the `image` points off-chain (the
IPFS-pinned plate at `<imageBase><tokenId>.png`), which is correct for the rich photographic art (§3).
An optional Safe-set `setClassName`/`setClassNames` registry gives marketplace-readable names ("GTO ·
Legendary" instead of "Car #3"), with a graceful derived fallback when unset. Chain-dormant like the
rest of the rail; deploy note in CHAIN-DEPLOY.md. The renderer for the portrait (§3, point 2's
`data:image/svg+xml`) is the remaining §3 piece — porting `portrait.js` to Solidity — and is separate.

This is the piece that makes "sell items on marketplaces" *true* rather than aspirational, and it
needed no Unipeg mechanic — just the metadata standard the whole NFT market already speaks.

## 5. The game-economy safety check — why marketplace-tradeable items are safe

A fair worry: if a rare car can be *bought* on OpenSea, does that let players buy game power and
bypass earning it? OMERTA already answers this, and the answer is a reason to be confident:

**An extracted item is INERT.** The v3-step-7 rule: once an item is taken on-chain it is *safe*
(survives death, can't be stolen or won off you) but *inert* (it never races, hauls, melts, or
fences — it left the game). So buying an extracted car on a marketplace gets you a **trophy, not a
game advantage.** The inert rule is precisely what makes a liquid secondary market safe for the game
economy: marketplace demand cannot pull game-power out of the earning loop, because on-chain items
have no game-power to pull. Keep that rule; it is what lets the marketplace and the game coexist.

One consequence to state plainly (and it is already in the identity-NFT design): a *tradeable* asset
whose price is set by a secondary market means the real per-item cost stops being the mint/extract
price and becomes the **floor**. For cosmetics and collectibles that is fine and desirable. It must
never be true of anything with game-power — which the inert rule guarantees.

## 6. Recommendation

1. **Build the metadata rail** (on-chain `uri` + derived traits + IPFS image) — this is the real,
   launch-of-the-marketplace-story work, and it is Unipeg-independent. ✅ **DONE 2026-08-13** (§4);
   IPFS pinning of the plates is the remaining ops step, done at chain go-live.
2. **Cars / gear / boats: on-chain traits + IPFS image.** Keep the rich art. Marketplace-native,
   permanent, no aesthetic sacrifice.
3. **The portrait: port `portrait.js` to a fully-on-chain Solidity renderer** (deterministic from
   bloodline attributes). This is the one place Unipeg's rendering tech genuinely upgrades you, and
   it is feasible because the art is already vector. On an L2 (Robinhood Chain), the deploy gas is
   affordable.
4. **Reject re-seed-on-trade everywhere.** Items are stable and deterministic; the portrait freezes
   at first transfer (already designed).
5. **Optional, later: an on-chain-native cosmetic line** if you want a collection built *for* full
   on-chain rendering — that is where Unipeg's exact style is a fit, as a new thing, never a retrofit.

**None of this is a launch item.** The chain is dormant in production and the on-chain items rail
rides behind the same gates as the rest of Door 3. This doc is the blueprint to build against when
that opens — and the metadata rail (§4) is the first, most valuable, and least risky piece of it.
