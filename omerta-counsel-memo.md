# OMERTÀ — Memorandum for legal counsel: the Stock Machine & the Dynasty NFT

**Status: OPEN — awaiting counsel signature.** Founder-directed 2026-08-09 ("yes on the counsel
memo"). Every item below currently ships (or is designed) under the project's standing directive
that architecture is assumed counsel-approved; this memo converts those standing assertions into
an enumerated list a lawyer can confirm, qualify, or strike **one by one**. Nothing on this list
reaches mainnet before the two standing gates regardless (third-party contract+signer audit;
`forge test` green — the latter already holds), so signing this memo is a prerequisite, not a
trigger.

Companion documents: `omerta-rwa-stock-machine-design.md` (the machine), `omerta-v4-hook-design.md`
§10.8 (the one-hook-four-slices fee architecture, founder-confirmed 2026-08-09),
`omerta-identity-nft-design.md` (the trophy/entitlement wall), `CHAIN-DEPLOY.md` (the deploy gates).

---

## 1. The facts counsel is opining on

- **The game**: OMERTÀ, a multiplayer noir mafia RPG with a real-money boundary. In-game cash is
  play money and cannot become the token ($OMR) at any price (the tokenomics-v2 severance). $OMR
  is bought (bonds/desk auctions for ETH) or earned in-game from recycled sinks, and can be
  extracted on-chain through a full-reserve withdrawal queue ("extraction ≤ inflow" enforced by
  construction).
- **The chain**: Robinhood Chain (Arbitrum Orbit L2, live since July 2026). Robinhood's tokenized
  stocks trade there as standard ERC-20s with day-one Uniswap liquidity and **no on-chain
  transfer allowlist**. They are EU-facing instruments **not offered to US persons** by their
  issuer.
- **The revenue**: real ETH enters via gameplay fees (mint 0.01 ETH, respawn 0.10 ETH), Store
  packages, bonds, and DEX fees. A declared money router (`src/router.js`) publishes every split;
  a **treasury slice** of each source accrues to a treasury Safe.
- **The plan under review** (the Stock Machine, phased): **(A)** the in-game Commission (the top
  player families) votes daily on which supported ticker the treasury buys — shipped 2026-08-09 as
  a record only, nothing bought; **(B)** a keeper sweeps the treasury slice accrued in the pool's
  fee hook and market-buys the day's voted ticker on Uniswap into the treasury Safe; **(C)**
  players claim allocated stock to their own wallets, paying their own gas, through a
  server-signed voucher rail with eligibility enforced at signature time.

## 2. The five assertions requiring counsel's signature

Each is currently a **founder assertion of counsel approval**, recorded in the repo at the cited
location. Counsel is asked to confirm each in writing, with any conditions.

**A1 — The treasury may buy real tokenized stocks with fee revenue.**
The treasury Safe (US-controlled) purchases Robinhood tokenized stocks (EU-facing, not for US
persons) on the open market, funded exclusively by the treasury slice of declared game revenue.
Purchases are deterministic (the day's voted ticker, the accrued budget), never discretionary
per-player, never RNG. *Founder assertion 2026-08-08: "Counsel has approved." Question for
counsel: does a US-person-controlled treasury holding EU-facing tokenized stocks as inventory
(not offering them) require a jurisdiction change, a licensed intermediary, or neither?*

**A2 — Allocated stock may be dropped into transferable token-bound accounts (ERC-6551).**
The Dynasty NFT (the character/identity token) carries a 6551 token-bound account; allocations
land in the TBA, and the NFT — with its TBA contents — is transferable on the open market. This
knowingly touches the recorded trophy/entitlement wall (`omerta-identity-nft-design.md`): the
NFT stays a tradeable trophy, the game ENTITLEMENT stays account-bound, but a TBA holding stock
makes the trophy itself a container of value. Allocation weight follows the StonkBrokers
activation model — burning earned $OMR activates a share — which is **earned/purchased, never
chance**. *Founder assertion 2026-08-08 (after reviewing StonkBrokers): "legal council of
Robinhood has approved." The standard's mechanics were verified against the EIP text 2026-08-09
(`omerta-dynasty-machine-design.md` §1): control of a TBA derives live from the NFT's current
holder, so contents transfer with the token by construction, and the EIP itself names — and
declines to solve — the drain-before-sale fraud vector (a seller empties the TBA one block before
accepting an offer); our mitigations and the residual buyer-side risk are §5 of that design.
Question for counsel: does a transferable NFT whose TBA accrues allocations of third-party
securities create an investment-contract profile (Howey) for the NFT itself, and if so what
disclosures/structure defeat it — and does the drain-before-sale residual require disclosure
language on the marketplace surface?*

**A3 — Geofencing and eligibility live at the claim rail, and that is sufficient.**
The stock tokens have no on-chain allowlist, so the game's enforcement point is
`signStockVoucher`: the server signs a claim only for a wallet that has passed the
jurisdiction/attestation gate counsel specifies (Phase C is BLOCKED on counsel's answer to KYC
depth and the jurisdiction list). A US-person account plays fully and holds the in-game record
but can never claim delivery. *Question for counsel: is voucher-time attestation + geofence
sufficient, or is issuer-grade KYC required before any delivery? Provide the jurisdiction list.*

**A4 — The Dynasty NFT has no maximum supply, and proceeds are ordinary sales revenue.**
The identity mint is uncapped by design (a supply cap would cap the player count). Mint proceeds
(0.01 ETH each) are game revenue routed through the declared waterfall. No scarcity marketing, no
roadmap-of-appreciation, no buyback promise attaches to the NFT. *Question for counsel: confirm
uncapped utility-NFT sales at fixed price, marketed without appreciation language, stay outside
the securities perimeter in the target jurisdictions.*

**A5 — Recycled $OMR may be redistributed as play-to-earn rewards.**
Every in-game $OMR sink recycles to THE DESK (nothing is burned); the founder direction is that
free-to-play players can EARN from that recycled pool through in-game performance. Every token in
the pool was originally bought with real money; redistribution is skill/effort-based, bounded by
what the sinks collected, and **never chance-weighted**. The standing copy rule (no
income/earnings promises in any official copy) continues to apply to how this is described.
*Question for counsel: confirm skill-based redistribution of previously-purchased tokens, with
extraction still bounded by the full-reserve queue, does not create a wagering or
money-transmission profile.*

## 3. The walls that hold regardless of the answers

These are load-bearing project rules counsel can rely on as constants — they do not move with
this memo's outcome:

1. **Never by chance.** No security, token, or claim is ever distributed by RNG/loot/gambling.
   Ballots vote, purchases buy, activations burn earned value. (The RWA rule since R1.)
2. **No earnings promises.** No official copy states or implies income, yield, appreciation, or
   "earn a living" — mechanics are described factually. (The Street Wage counsel rule, still in
   force after its retirement.)
3. **Allocated ≤ held, same asset both sides.** The game only ever owes what the treasury already
   holds, in token units — no IOU, no cash-settled substitute (the derivative anti-pattern the
   stock-layer retirement removed).
4. **The anti-fabrication gate.** No mod/QA/comp path can assert real value arrived (`txHash`
   gates on every revenue ingest; comps book zero).
5. **One extraction boundary.** All real-value delivery flows through the server-signed voucher
   rail, where A3's gate lives — there is no second door.
6. **No undisclosed astroturfing.** Agent players recruiting off-platform must disclose AI status
   (the agent-manual rule).

## 4. What is blocked pending signature

- **Phase B** (the keeper buys stock; the hook's treasury slice sweeps): blocked on **A1**.
- **Phase C** (claims/delivery): blocked on **A2 + A3** (KYC depth + jurisdiction list) — and on
  the third-party audit gate independently.
- **TBA-carried allocations**: blocked on **A2**.
- **Play-pool redistribution build**: blocked on **A5** (design + sim may proceed).
- **Shipped and unaffected**: Phase A (the Ticker Ballot — a vote and a record; no value moves),
  the Capo's License (rate-limit/status perks only), the money router (declare/verify/display).

## 5. Signature block

| Assertion | Confirmed / Qualified / Struck | Conditions | Counsel | Date |
|---|---|---|---|---|
| A1 — treasury stock purchases | | | | |
| A2 — transferable TBA drops | | | | |
| A3 — claim-rail geofence/KYC | | | | |
| A4 — uncapped NFT proceeds | | | | |
| A5 — play-pool redistribution | | | | |

*Prepared 2026-08-09. Maintainers: keep this memo in lockstep with the design docs it cites; a
design change that touches an assertion re-opens its row.*
