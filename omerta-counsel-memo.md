# OMERTÀ — Memorandum for legal counsel: the Stock Machine & the Dynasty NFT

**Status: A1–A6 APPROVED (founder assertion 2026-08-09: "Counsel has approved A1-A6"); A7 OPEN.**
The approval is recorded the project's standing way — as a founder assertion of counsel approval,
with the written countersignature to file in §5 when it arrives. What it unblocks: **Phase B**
(the buy keeper + stock bookkeeping) and **the activation burn** are now buildable (chain-dormant
until the audit gate); **Phase G-3** (the community drop) may proceed to build. What it does NOT
supply: **A3's parameters** — the jurisdiction list and KYC depth are inputs counsel must still
provide before Phase C delivery goes live (approving the assertion is not the parameter list).
Every item below ships (or is designed) under the project's standing directive that architecture
is assumed counsel-approved; this memo converts those standing assertions into an enumerated list
a lawyer can confirm, qualify, or strike **one by one**. Nothing on this list reaches mainnet
before the two standing gates regardless (third-party contract+signer audit; `forge test` green —
the latter already holds).

Companion documents: `omerta-rwa-stock-machine-design.md` (the machine), `omerta-v4-hook-design.md`
§10.8 (the one-hook-four-slices fee architecture, founder-confirmed 2026-08-09),
`omerta-identity-nft-design.md` (the trophy/entitlement wall), `CHAIN-DEPLOY.md` (the deploy gates),
`omerta-launch-sequence-design.md` (the genesis window + community drop — the source of A6).

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

## 2. The assertions (A1–A6 approved; A7 open)

A1–A6 are **founder assertions of counsel approval, approved 2026-08-09**; counsel's written
countersignature goes to the §5 block when it arrives. A7 was added with the provenance-trait
design and remains open.

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
language on the marketplace surface?* **Fact-pattern amendment 2026-08-09 (the lockstep rule —
review the aggregate, not the TBA alone):** the NFT also carries banded cosmetic PROVENANCE
traits derived from the founding wallet's snapshot holdings (`omerta-dynasty-machine-design.md`
§9, row A7) — **display-only forever** (never an input to activation weight, allocation, or claim
priority; the wall is stated in §9.4 and will be test-pinned), metadata field
`genesis_provenance` (never tier/rank/rarity), no ordinal or value-ranked names, uncapped total
supply stated as the securities-favorable fact it is. The aggregate profile counsel is signing:
uncapped, fixed-price, TBA-carrying, provenance-marked — the Dapper-Labs/Impact-Theory class is
the reason the traits are inside this row's fact pattern rather than beside it.

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

**A6 — OMR may be distributed free to snapshotted third-party communities.**
The launch plan (`omerta-launch-sequence-design.md` Phase G-3) reserves genesis OMR for a free,
deterministic, snapshot-based distribution — not a sale, no investment of money — to holders of
unaffiliated NFT/token communities on ETH mainnet and Robinhood Chain (CryptoPunks/BAYC/MAYC and
$PEPE-class on mainnet; StonkBrokers and $CASHCAT-class on Robinhood Chain). Snapshots are taken
at a fixed block height BEFORE any announcement; amounts are fixed per snapshotted wallet/NFT
against a published merkle root (no draw anywhere — the never-by-chance wall holds by
construction); claims are gas-paid by the claimant and time-boxed, with unclaimed tokens
reverting to the treasury; claim-page copy runs under the standing no-promise rules.
**Fact-pattern amendments 2026-08-09:** (1) **the funnel bonus is CARVED OUT of this row** — the
launch plan's bonus tranche for a claim that also pays the 0.01 ETH mint is consideration-linked
(the Tomahawk/free-stock class), so it is analyzed under **A4** as a retail purchase promotion on
a fixed-price sale, and the BASE drop stays truly unconditional (a claim requires only a
signature proving control of a snapshotted address); (2) the claim may also assign a cosmetic
**provenance trait** (row A7 — opt-in, display-only, once per wallet). *Questions for counsel:
does a free token distribution at this scale carry registration or jurisdiction exposure (the
historical airdrop-as-distribution line); does the claim page need the same geofence posture as
A3's rail; does **MiCA Art. 4(3)** — which removes the offer-to-public exemption where
crypto-assets are provided in exchange for personal data or any fee/benefit — defeat the "free
offer" characterization in the EU where the claim requires SIWE wallet-link + account
registration (design (b)), and does that require jurisdiction-gating the claim page; and does the
snapshot/eligibility publication (wallet addresses + amounts) need anything further in the EU?*

**A7 — Dynasty NFT traits may derive from third-party holdings and reference the communities
evocatively. (OPEN — added 2026-08-09 with the feature's design; not covered by the A1–A6
approval.)** The provenance-trait design (`omerta-dynasty-machine-design.md` §9): the identity
NFT's generative art carries a cosmetic marker derived from whether the minter's SIWE-linked
wallet appears in the SAME taken-before-announce snapshots the A6 drop pays from. Deterministic
(never chance), banded tiers (never amounts), **opt-in at mint** (no wallet's holdings are
attested without the owner's explicit claim), one provenance per snapshot wallet ever, zero
gameplay effect, and the trait vocabulary is fictional noir-native names + original art with no
trademarked string or imagery anywhere in metadata or art. Announcement/eligibility copy names
the real collections FACTUALLY ("wallets holding a CryptoPunk at block N") — nominative
reference only, exactly as A6's own eligibility copy must. *Questions for counsel: (1) does
evocative trait art + factual eligibility naming of famous collections (the Yuga-v-Ripps class)
need more than the non-affiliation disclaimer we ship; (2) does a holdings-derived cosmetic
trait on a paid, transferable, uncapped NFT alter the A2/A4 analysis in any way?*

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

## 4. What is blocked pending signature (updated at the A1–A6 approval)

- **Phase B** (the keeper buys stock; the hook's treasury slice sweeps): ~~blocked on A1~~ —
  **UNBLOCKED 2026-08-09** (build proceeds chain-dormant; mainnet still audit-gated).
- **Phase C** (claims/delivery): A2 approved; still **parameter-blocked on A3's inputs** (KYC
  depth + jurisdiction list) — and on the third-party audit gate independently.
- **TBA-carried allocations**: ~~blocked on A2~~ — **UNBLOCKED 2026-08-09** (the Phase-B audit
  batch still gates the contracts).
- **Play-pool redistribution build**: ~~blocked on A5~~ — **UNBLOCKED 2026-08-09**.
- **Launch Phase G-3** (the community drop): ~~blocked on A6~~ — **UNBLOCKED 2026-08-09**; the
  claim surface still sits behind the audit gate for its on-chain pieces.
- **Provenance-trait art + claim/announce copy** (the community-evocative surfaces): counsel eyes
  per **A7** before launch; design and art production proceed.
- **Shipped and unaffected**: Phase A (the Ticker Ballot — a vote and a record; no value moves),
  the Capo's License (rate-limit/status perks only), the money router (declare/verify/display).

## 5. Signature block

| Assertion | Confirmed / Qualified / Struck | Conditions | Counsel | Date |
|---|---|---|---|---|
| A1 — treasury stock purchases | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A2 — transferable TBA drops | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A3 — claim-rail geofence/KYC | Confirmed (founder assertion) | jurisdiction list + KYC depth still to be supplied | — | 2026-08-09 |
| A4 — uncapped NFT proceeds | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A5 — play-pool redistribution | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A6 — free community distribution (airdrop) | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A7 — provenance traits (third-party holdings + evocative reference) | | | | |

*Prepared 2026-08-09. Maintainers: keep this memo in lockstep with the design docs it cites; a
design change that touches an assertion re-opens its row.*
