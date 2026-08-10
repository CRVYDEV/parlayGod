# OMERTÀ — Memorandum for legal counsel: the Stock Machine & the Dynasty NFT

**Status: A1–A3, A5, A6 APPROVED (founder assertion 2026-08-09: "Counsel has approved A1-A6");
A4 RE-OPENED 2026-08-10 (the tranche schedule was adopted, then capped at five waves / 0.05 ETH);
A7 + A8 OPEN; A9–A12 OPEN (THE BANK protocol rows, added 2026-08-10 — open as
questions, NOT as gates; that build proceeds on the founder's instruction, §2).**
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
`omerta-launch-sequence-design.md` (the genesis window + community drop — the source of A6),
`omerta-bank-protocol-design.md` (THE BANK — the dual game/DeFi protocol, the source of A9–A12).

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

## 2. The assertions (A1–A3, A5, A6 approved; A4 re-opened; A7 + A8 open)

A1–A6 were **founder assertions of counsel approval, approved 2026-08-09**; counsel's written
countersignature goes to the §5 block when it arrives. **A4 re-opened 2026-08-10** when the
tranche schedule was adopted (the row's own lockstep rule — a design change touching an
assertion re-opens it). A7 (the provenance traits) and A8 (the activator's securities leg) were
added with their designs and remain open.

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
**Custody amendment 2026-08-10 (the adversarial pass reconciled a §3/§8 contradiction so this
row states the true thing):** allocation bookkeeping is ACCOUNT-keyed and a **PENDING
(undelivered) allocation does NOT transfer with the NFT** — only stock actually DELIVERED into
the TBA travels with the token, so "selling the NFT sells the vault contents" means the
DELIVERED contents, verifiable on-chain, and nothing else. **Drain-before-sale, answered
honestly:** at launch NO marketplace-side 6551 mitigation exists (mainstream marketplaces are
not 6551-aware; the launch chain has no established marketplace), so the answer to this row's
disclosure question is **yes** — the design responds with a default-ON listing lock (or
voucher-gated TBA outflows) and explicit buyer-side disclosure, `omerta-dynasty-machine-design.md`
§5.

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
the securities perimeter in the target jurisdictions.* **Fact-pattern amendment 2026-08-10 (the
mint-price posture, `omerta-dynasty-machine-design.md` §10):** the mint is payable on **ONE rail —
ETH.** The second rail (PLEX, paying in earned $OMR) was retired the same day, across every
real-money price in the product: minting is the Sybil bound that gates extraction, and a fee
payable two ways is always priced by whichever rail is cheaper. So there is one price, in real
money, at the published wave — which simplifies this row rather than complicating it, since there
is no conversion, no oracle and no lockstep to describe. "Fixed price" means **fixed at any given
moment, repriced only by ordinary product decision** (announced factually); an AUTOMATIC
supply-indexed escalation ("the price rises as more mint") was proposed, evaluated, and
**REJECTED** — an auto-rising price is scarcity marketing in mechanical form (the Impact-Theory
shape) and would re-open this row. ~~The funnel bonus (A6's carve-out) is analyzed here as a
retail purchase promotion on that fixed-price sale.~~ *(2026-08-10: the funnel bonus is RETIRED —
superseded by THE WHITELIST's free mint, which is analyzed under A6; nothing
consideration-linked remains on this row from that carve-out.)* One whitelist interaction DOES
touch this row: free whitelist mints are EXCLUDED from the tranche-slot count (the schedule
indexes PAID mints only), so the free program cannot advance the published price.
**ADOPTED 2026-08-10 — the tranche schedule, and this row is RE-OPENED accordingly
(`omerta-dynasty-machine-design.md` §10 Shape D; the table is `MINT_TRANCHES` in the code,
whole-array test-pinned). REVISED the same day to FIVE WAVES WITH A PUBLISHED CEILING:** a
pre-published table of five discrete price waves indexed to cumulative mints — waves of 1,000 /
10,000 / 25,000 / 50,000 / 100,000 identities at 0.010 / 0.025 / 0.035 / 0.045 / **0.050 ETH**
(**ETH only — there is no $OMR price for an identity**, amended 2026-08-10: minting is the
extraction gate, so it has one unambiguous price in real money; the earned-token rail that previously
existed alongside it is retired, which also removes the two-denomination explanation from this row),
**flat tail** beyond the table (the last price holds until a new
table is published — a finite commitment, never an open-ended escalator). **The material change for
this row is the CEILING: the escalation TERMINATES at a number stated up front, so the most anyone
ever pays for an identity is 0.05 ETH, and that is true on the day the table is published.** The
increments also shrink as the waves widen, so the schedule flattens rather than accelerating; past
the first thousand it is cheaper at every point than the ten-row ladder it replaces. Both rails hold
one implied rate per row (boot-checked); execution is the existing owner-set fee at each boundary
(no contract change); the free path is guaranteed by its own MECHANISM rather than by a price bound —
a mission grants a mint credit outright, so a player who never spends real money can still be made
(test-pinned, as is the ceiling, asserted directly). Early-bird
framed, no countdown/remaining counters, the banned lexicon in force. *The re-opened question: does a
PUBLISHED forward escalation on an uncapped, transferable, TBA-carrying NFT — framed as
founding-era pricing, with no urgency mechanics and no value language, bounded at a stated ceiling
(0.05 ETH) beyond which every later mint pays the same — create the appreciation expectation that
fixed-price analysis avoided, and what copy/structure keeps it an ordinary early-bird discount
rather than an investment pitch? We believe the ceiling is materially favourable here, since the
schedule promises the escalation ENDS rather than continues; please confirm, and say whether the
cap should be stated in the mint copy itself.*

**A5 — Recycled $OMR may be redistributed as play-to-earn rewards.**
*(Fact-pattern amendment 2026-08-10 — THE BANK's city leg, `omerta-bank-protocol-design.md` §4.1.
Protocol profit is used to buy $OMR on the open market and distribute it to **the players who
play**. This row's operative language is unchanged and this amendment adds no new question: the
distribution is the same **skill/effort-based, never chance-weighted** rail counsel already
reviewed — pro-rata LINEAR on cooldown-bounded in-game activity, with **no per-account cap** (the
project measured that a per-account cap is anti-concentration rather than anti-Sybil and is what
created the Street Wage's farm incentive; see `BALANCE.md` § THE FARM). What changes is only the
FUNDING SOURCE, and it improves: alongside recycled sinks, the pool is now fed by real protocol
revenue used to purchase existing tokens on the open market. So the tokens distributed are, as
this row already states, "previously-purchased" — now doubly so. **No new row is required for this
leg**; A11 covers the separate NFT-holder distribution, which is a different legal fact.)*
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
construction); claims are gas-paid by the claimant and time-boxed (90–180 days,
founder-set 2026-08-10), with UNCLAIMED allocations reverting to the treasury via a post-deadline
Safe-only sweep — never any clawback of DELIVERED tokens (OMR has no confiscation path, by
design); claim-page copy runs under the standing no-promise rules.
**Fact-pattern amendments 2026-08-09:** (1) **the funnel bonus is CARVED OUT of this row** — the
launch plan's bonus tranche for a claim that also pays the 0.01 ETH mint is consideration-linked
(the Tomahawk/free-stock class), so it is analyzed under **A4** as a retail purchase promotion on
a fixed-price sale, and the BASE drop stays truly unconditional (a claim requires only a
signature proving control of a snapshotted address); (2) the claim may also assign a cosmetic
**provenance trait** (row A7 — opt-in, display-only, once per wallet).
**Fact-pattern amendment 2026-08-10 — THE WHITELIST (founder-directed):** the same snapshot
claim may also deliver a **one-time FREE identity mint** to each snapshotted wallet — one free
mint per wallet EVER, consumed on use, lapsing with the same claim window as the drop itself;
every later mint by that wallet pays the published tranche schedule (A4). This **supersedes and
RETIRES the funnel bonus**, which also dissolves amendment (1)'s carve-out: there is no longer
any consideration-linked bonus attached to the claim — the identity mint itself is free, so the
whole claim flow (drop + free mint + provenance stamp, one signature) is unconditional and stays
inside this row. Free mints do not consume tranche-schedule slots (the schedule indexes PAID
mints only), so the whitelist cannot move the published price. The identity granted is the same
account-bound entitlement described in A2's trophy/entitlement wall. *Additional question for
counsel: confirm that bundling a free identity mint (a paid product delivered at no charge to
snapshotted wallets) into the free-distribution claim does not re-introduce the consideration
analysis — the claimant still pays nothing and does nothing beyond proving control of a
snapshotted address; and note the MiCA Art. 4(3) question above applies to this leg identically.* *Questions for counsel:
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

**A8 — The activator's own transaction: consideration paid for a deterministic, wealth-weighted
allocation of third-party securities. (OPEN — added 2026-08-10; the adversarial pass found
neither A2 nor A5 covers this leg.)** The activation model
(`omerta-dynasty-machine-design.md` §8): a person burns $OMR — which is acquirable for ETH via
bonds and desk auctions — for a linear pro-rata share of the day's treasury stock purchase. A2
analyzes the NFT's profile; A5's operative qualifier is "skill/effort-based" — but activation is
neither skill nor chance, it is **wealth-weighted**: the net path is ETH → $OMR → burn →
deterministic securities allocation. The build proceeds chain-dormant under the standing
directive; **live allocation accrual is blocked on this row** (delivery was already blocked on
A3's parameters independently). *Question for counsel: analyze the ACTIVATOR's transaction as a
distribution/sale of the underlying securities to the payer — what structure, disclosure, or
gating (beyond the A3 claim rail) does that leg require, and does the $OMR intermediation change
the analysis at all?*

---

### THE BANK rows (A9–A12) — added 2026-08-10 with `omerta-bank-protocol-design.md`

The founder directed a **dual game / DeFi protocol**: the game's Bank tab becomes the front-end of
a real lending protocol on Robinhood Chain, synthesising Alchemix (self-repaying loans),
Inverse/DOLA + FiRM (a debt-backed stablecoin and the security architecture its 2022 exploits
forced) and Monolith (free-vs-paid debt, redemptions as peg defense). Protocol profit routes back
into the game — to NFT holders, and/or buying $OMR on the open market to fund free players.

**The build proceeds on the founder's instruction (2026-08-10), which is recorded here as TWO
distinct things because this memo's only value is that it is accurate:**
- *"Legal Counsel approves this"* — **a founder assertion of counsel approval**, the standing
  convention on rows A1–A6, with written countersignature to file when it arrives.
- *"Legal approves because America is the land of innovation and worst case scenario we will
  fight it in court"* — **a founder risk-acceptance**, logged verbatim. A decision about
  litigation risk is not a legal opinion, and converting one into the other in a document counsel
  will read would be the one thing this memo must not do.

The four rows below therefore do NOT gate the build. They remain open because they are also the
questions an **auditor, an exchange listing desk, an insurer, and a Robinhood partnership
conversation** will each ask independently — so having them answered has value regardless of the
litigation posture.

**Two design decisions materially narrow what counsel is being asked about, and both are
load-bearing:** collateral is **ETH and high-quality stablecoins only** (founder-constrained), and
each market is **denomination-matched** (USD debt against USD collateral; ETH debt against ETH
collateral), which removes price risk, liquidations, and the oracle from the borrow path entirely
— the exact vector that cost Inverse ~$21M across two 2022 exploits.

**A9 — Issuing a USD-pegged synthetic on Robinhood Chain. (OPEN.)** The design's `DebtToken` is
over-collateralised, debt-backed, redeemable 1:1 through a Transmuter whose queue is filled from
the repayment stream; mint authority is the position contract alone and there is no owner-mint and
no confiscation path (the OMR discipline). *Questions: does this fall inside the GENIUS Act's
payment-stablecoin definition, and if so which permitted-issuer route is available to us; what is
its MiCA classification (e-money token vs asset-referenced token) and what authorisation follows;
does the redeemable-1:1 design help or hurt that characterisation?*

**A10 — Yield-bearing deposits from game users. (OPEN.)** The Mix-Yield Vault takes user USDG and
allocates it across third-party strategies, returning yield. *Question: is this an investment
contract on the BlockFi / Celsius / Genesis-Gemini-Earn fact pattern; does a game-native framing
change the analysis at all, or does a retail, global, non-age-verified user base make it worse;
and is there any structure (fixed-term, non-discretionary, fully-disclosed passthrough) that
changes the answer?*

**A11 — Revenue distribution to synthetic holders and governance stakers. (OPEN.)** The brief
asks for protocol revenue "continuously distributed to holders of the stablecoin itself and to a
governance/token-staking layer." **We assess this as the clearest securities leg of the four**, so
`RevenueDistributor.sol` is specified and deliberately NOT written pending this row. *Question:
confirm or correct that assessment, and identify what — if anything — a compliant distribution
would look like.*

**A12 — Custody and transmission. (OPEN.)** Routing user funds into Morpho/Maple/Ethena/Spark is
custody plus, arguably, transmission. *Questions: does this require FinCEN MSB registration and
state money-transmitter licensing in the US, and CASP authorisation under MiCA; and does the
existing A3 jurisdiction list (still owed) cover this rail or does it need its own?*

**A standing counterparty note for all four:** these strategies carry real loss modes — Morpho
Blue market isolation and per-market oracle configuration, curator discretion inside the
Steakhouse vault, Ethena's basis-trade/funding exposure, and Maple's **undercollateralised**
institutional credit (its predecessor pools defaulted in 2022). A loss at any of them is a game
user losing real money. Counsel should assume that fact pattern when answering A10 and A12.

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
- **Live activation accrual** (allocations actually accruing to accounts): blocked on **A8** —
  the burn + bookkeeping BUILD proceeds chain-dormant; no allocation accrues to any account
  before the row is signed.
- **THE BANK protocol** (`omerta-bank-protocol-design.md`): **proceeds on the founder's
  instruction of 2026-08-10** (recorded in §2 as an assertion of counsel approval PLUS a
  risk-acceptance). A9–A12 stay open as questions, not gates. Two things still bind independently:
  the **third-party audit** of the contract batch, and the **RevenueSplitter's NFT leg**, which
  ships with its share settable to **zero** pending A11 — the staker leg and the open-market
  $OMR-buy leg are live from day one, because the $OMR leg is a purchase-and-distribute on the
  already-audited `prize:omr` pattern, distributed on **A5's approved skill/effort rail to the
  players who play**, and so needs no new row.
- **Shipped and unaffected**: Phase A (the Ticker Ballot — a vote and a record; no value moves),
  the Capo's License (rate-limit/status perks only), the money router (declare/verify/display).

## 5. Signature block

| Assertion | Confirmed / Qualified / Struck | Conditions | Counsel | Date |
|---|---|---|---|---|
| A1 — treasury stock purchases | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A2 — transferable TBA drops | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A3 — claim-rail geofence/KYC | Confirmed (founder assertion) | jurisdiction list + KYC depth still to be supplied | — | 2026-08-09 |
| A4 — uncapped NFT proceeds | RE-OPENED (tranche schedule adopted, capped at 0.05 ETH) | re-review the published-schedule fact pattern | — | 2026-08-10 |
| A5 — play-pool redistribution | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A6 — free community distribution (airdrop) | Confirmed (founder assertion) | written countersignature to file | — | 2026-08-09 |
| A7 — provenance traits (third-party holdings + evocative reference) | | | | |
| A8 — the activator's leg (consideration for wealth-weighted securities allocation) | | | | |
| A9 — issuing a USD-pegged synthetic on Robinhood Chain | | | | |
| A10 — yield-bearing deposits from game users | | | | |
| A11 — revenue distribution to synthetic holders + governance stakers | | | | |
| A12 — custody + transmission (routing user funds into third-party protocols) | | | | |

*Prepared 2026-08-09. Maintainers: keep this memo in lockstep with the design docs it cites; a
design change that touches an assertion re-opens its row.*
