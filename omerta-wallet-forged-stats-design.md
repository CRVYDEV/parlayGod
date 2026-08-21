# The Ledger-Born — wallet-forged starting stats (founder idea 2026-08-21, expanded)

**Status: SIGNED AND BUILT (founder, 2026-08-21 — "B Wallets also grant bonus points based on
history/usage"). Depth B shipped: `src/walletforge.js` + the `WALLET_FORGE` rules block +
`wallet_rolls` latch + `POST /v1/character/forge` / `GET /v1/forge`; levers pinned in
`test/levers.js`; the bounded wall-retirement recorded in BALANCE.md § THE LEDGER-BORN and
SIGN-OFF § THE 2026-08-21 PAIR.**

The founder's idea, verbatim in spirit: *a player submits a wallet, and the game rolls their stats
from what that wallet IS — coins held, transaction count, volume, and similar.* Your on-chain life
becomes your character's birth certificate. This document expands it into a buildable shape and
names the walls it has to live inside.

## 0. What it collides with, stated first

Three standing rules touch this idea, and the design below is shaped by them rather than around them:

1. **Character creation is TOTAL-CONSERVED.** `rollStats()` scatters a fixed budget
   (`CREATE_STAT_TOTAL` 15, floor 3 per stat) — only the SHAPE varies, never the total, which is
   what makes creation zero-power-creep and Sybil-neutral by construction. The paid re-roll
   (0.01 ETH → a `reroll_credit`) re-rolls the shape under the same budget.
2. **Outside wealth must not buy power** (the dynasty provenance wall, §9: a wallet-derived trait
   "moves NOTHING — no stat, no cap, no discount"). The founder retired §4.3 for *$OMR* ("$OMR may
   buy power, under a ceiling reachable free") — but that was an in-game-token decision; letting a
   *bank balance on Ethereum* buy stats is a separate wall and a separate signature.
3. **The anti-precise-kill-EV / privacy rule.** Nothing public may reveal a wallet's exact holdings,
   and the wallet↔character linkage is deliberately loose. A stat vector readable off every roster
   must not be invertible into "this player is rich."

**The one structural insight that makes the idea shippable tomorrow rather than after a sim cycle:
let the wallet decide the SHAPE, never the TOTAL.** All shapes sum to 15, so a whale's wallet and a
fresh wallet are exactly equal in power — what differs is *who the wallet says you are*. That keeps
rule 1 byte-intact, satisfies rule 2 with zero exceptions, and turns the feature from a balance
question into an identity feature: **your wallet is your birth chart, not your bank statement.**

## 1. The feature vector — what a wallet can honestly say about you

Ranked by cost-to-fake, because every wallet-read feature is a farm target the moment it matters:

| Feature | Read | Cost to fake | Use |
|---|---|---|---|
| **Wallet age** (first-tx block) | one archive lookup | **unfakeable retroactively** | the strongest signal — patience |
| **Lifetime gas spent** | tx-history fold | costly (real ETH burned) | grind / labor |
| **Tx count** (nonce) | free read | cheap on an L2 | velocity — weight LOW |
| **Distinct tokens ever touched** | log replay | cheap-ish | breadth / curiosity |
| **Held balances** (curated coin list) | balanceOf at a block | **flash-borrowable** — only safe read at an UNANNOUNCED block or at first-link, once | weight |
| **NFT holdings** (curated collections) | ownerOf/balanceOf | buyable | provenance (already built as WARDS) |

Two disciplines from the drop/provenance work carry over whole:
- **Read once, at first link, latched forever** (the `stamped` one-shot). A wallet gets ONE
  ledger-born roll ever, recorded before the mapping is public knowledge where possible. Grinding a
  wallet *after* learning the mapping buys nothing — the roll already happened.
- **Snapshot-before-announce for anything balance-weighted.** A held-balance feature announced in
  advance is a flash-loan costume party.

## 2. The mapping — archetypes, not arithmetic

Raw features → a small set of named **noir archetypes**, each a stat SHAPE over the 15-point budget:

| Wallet reads as… | Archetype | Shape (M/C/S) |
|---|---|---|
| old, quiet, holds through everything | **The Patient Man** | 3 / 9 / 3 |
| high velocity, thousands of txs | **The Wheelman** | 3 / 4 / 8 |
| heavy gas, years of grinding | **The Workhorse** | 8 / 4 / 3 |
| broad — touched everything once | **The Fixer** | 4 / 7 / 4 |
| fresh / empty wallet | **The Unknown** | the ordinary random roll |

(Names illustrative; the real set passes the **guessability rule** — fictional, noir-native, never
naming a chain or a coin.) The archetype is the PLAYER-VISIBLE half: a birth line on the sheet and
the public profile — *"born The Patient Man"* — which is the shareable artifact and the marketing
hook. The mapping itself stays server-side (the WARDS discipline). Deterministic per wallet: the
same wallet always forges the same man, which is what makes it feel like fate rather than a slot
machine — and is also the never-by-chance rule holding (a *reading* of the wallet, not a draw).

## 3. Privacy — the shape must not be a wealth scanner

- Features are **banded** before mapping (age: <1y / 1–3y / 3y+; the rest in coarse tiers), and the
  stored record is ONLY the archetype id + the stat shape — **never the raw features, never a
  balance**. There is nothing in the database to leak.
- The shape's resolution is deliberately coarse (a handful of archetypes), so a 9-cunning build says
  "an old quiet wallet was here" and nothing finer. Held-balance weight, if used at all, feeds a
  binary band (the dossier's `moneybags` precedent), never a gradient.
- **Opt-in, always** (the provenance consent rule): the default creation stays the random roll; the
  wallet roll is a button — *"forge them from my wallet"* — behind the SIWE link (EVM) or the
  ed25519 challenge (Solana; both proof rails exist and the drop's claim leg already uses each).

## 4. Where it plugs in — three existing rails, no new machinery class

1. **At creation**: an alternative to `rollStats()` — same budget, wallet-seeded shape,
   rng_audit'd (`wallet_roll`), one per wallet EVER (a `wallet_rolls` latch table, the `stamped`
   pattern). Requires a linked/proven wallet, which most fresh players won't have — fine: the
   feature is a hook for exactly the crypto-native audience the drop targets.
2. **Via the paid re-roll**: the 0.01 ETH `reroll_credit` already exists and is infinitely
   repeatable for RANDOM shapes. A wallet roll through the same credit gives an existing character
   their wallet-born shape — once, same latch. (Without a price, "pick your shape by shopping
   wallets" becomes a free targeted respec; the credit prices it at the reroll fee, and the
   once-per-wallet latch kills wallet-shopping loops — each new wallet costs a fresh SIWE identity
   AND a fresh credit.)
3. **The display half rides the provenance rail**: the archetype joins the portrait/profile the way
   the wards did — a birthmark, one composition slot, frozen at stamp.

## 5. Sybil / farming analysis (why Shape-only is safe by construction)

- All shapes sum to 15 → a farmed wallet gains **zero power** over a random roll. The only thing
  farmable is *which* shape — and the $OMR respec already sells arbitrary shape redistribution
  (90 $OMR, 24h cooldown), so the ceiling on what a farmer "wins" is a discounted respec. Pricing
  the post-creation wallet roll at a reroll credit (≈ the respec's real-money value) closes even
  that arbitrage.
- Wallet age — the dominant feature — cannot be manufactured after the fact at any price.
- The latch means the mapping leaking (it will) changes nothing for already-rolled wallets and only
  lets a NEW wallet aim its shape, which is worth at most the paragraph above.

## 6. The founder's pick — three depths, ranked

- **A (recommended, buildable now): SHAPE-ONLY.** Everything above. Zero new power, zero §10.4
  surface, no sim required, no wall broken. The feature is identity + marketing ("your wallet is
  your birth chart") — and it is genuinely novel; nobody else reads a wallet as a *character*, only
  as a balance.
- **B: BANDED BONUS POINTS.** Age/gas tiers grant +1..+3 TOTAL points (the `PRESTIGE_POINT_MAX`
  head-start precedent). Real power from outside wealth — breaks total-conservation and the
  provenance wall, needs a sim pass, a BALANCE table, and an explicit founder retirement of "outside
  wealth must not buy power" (the §4.3-retirement shape: a CEILING, reachable free, or it's
  pay-to-win on the stat layer). Only worth it if A's pull proves insufficient.
- **C: COSMETIC-ONLY.** Fold activity-derived traits into the existing wards and touch stats not at
  all. Zero risk, least novel — the idea's whole spark is that the wallet *reads on the sheet*.

**Copy rules under any pick** (the standing lexicon): never "rich wallets roll better" — under A it
is factually false and must stay so; no value/appreciation language; the opt-in screen states
exactly what is read, that nothing raw is stored, and that the roll is once-ever.

## 7. Build sketch (when A is signed)

`src/walletforge.js` — the feature reader (RPC folds behind a `__setReader` seam, chain-dormant;
the snapshot tooling's log-replay already does the heavy half), `forgeShape(features)` (pure,
exhaustively testable), the `wallet_rolls` latch, `POST /v1/character/forge` +
`POST /v1/character/reroll {wallet:true}`, rng_audit `wallet_roll`, the archetype on
view/portrait/profile. Tests: determinism, the latch, banding (raw features never stored),
budget conservation (every archetype sums to `CREATE_STAT_TOTAL` — pinned against the live
constant, never a literal), and the §10.4 zero-ledger pin.
