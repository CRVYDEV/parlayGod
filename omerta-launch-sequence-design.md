# THE LAUNCH SEQUENCE — the genesis window, the pool, and the community drop

Status: **DESIGN (founder-directed 2026-08-09). Every phase sits behind the two standing gates
(third-party audit of contracts AND signer; counsel signatures on `omerta-counsel-memo.md`) plus
one NEW counsel row this plan adds (A6, the airdrop).** The founder's shape: *a 1–3 day alpha/beta
phase where users can bond and purchase OMR; after that it initializes an LP where our designed
hook comes into play; and an amount of OMR reserved to airdrop to the top NFT and coin communities
on ETH and Robinhood Chain (CryptoPunks, BAYC, MAYC, StonkBrokers, $PEPE, $CASHCAT and similar).*
This doc makes that mechanical against the machinery that already exists. Three contract facts,
verified in-tree, carry the whole plan:

1. **OMR constructor-mints 100,000,000 to the treasury Safe** (`OMR.sol: SUPPLY = 100_000_000e18`,
   minted at deploy). The airdrop reserve and the pool's OMR side both come from this EXISTING
   genesis supply — no owner-mint is needed and none exists (bonds stay the only ongoing mint).
2. **`OmertaBond` is born refusing every bond until the Safe sets an oracle**, and `setOracle` is
   deliberately swappable ("so the feed can follow the canonical pool"). A TWAP cannot exist
   before the pool it reads — so the genesis window runs on a **GenesisOracle** (a tiny Safe-owned
   `IOmrOracle` returning one fixed price), swapped to the real `OmrTwapOracle` at pool init.
   One new ~20-line contract; it joins the audit batch.
3. **The 120h bond vest outlasts the longest window (72h)** — every OMR sold in the genesis window
   is still vesting when the pool opens. Nobody can dump the genesis at the bell, by construction;
   the 48h early-exit surcharge and the hook's 9% sell tax price the exits after it.

## Phase G-0 — pre-flight (everything here is a gate, not a task list)

- The audit batch (already scheduled for Phase B) gains the GenesisOracle + the launch checklist;
  counsel signs A1–A5 plus the new **A6** (§4 below). `forge test` green (standing).
- Deploys, in the contract's own documented order inverted only at the oracle step: OMR →
  OmertaBond → **setOracle(GenesisOracle)** → hook address mined → the 6551 registry replayed →
  `setMinter(bond)` LAST (the mint arms last — the standing rule).
- **THE GENESIS PRICE is the one number that anchors everything** (founder decision, priced with
  counsel's no-promise copy rules): the window sells at it, the LP initializes at it, and setting
  them EQUAL is what makes the pool open with no arbitrage gap in either direction.
- **Airdrop snapshots are taken BEFORE anything is announced** (the classic rule — a snapshot
  announced in advance gets farmed): block heights recorded per community, merkle roots computed
  and published (verifiable, unchangeable), amounts staying sealed until claims open if desired.

## Phase G-1 — the genesis window (1–3 days)

**Two purchase rails, one price, one throttle:**

- **BONDING (on-chain)** — the primary rail: `bond()` at the genesis price via the GenesisOracle,
  server-signed quotes as built, vested 120h. **THE DAILY OFFERING (live in production today) is
  the window's whole control surface**: the founder opens each day by hand —
  `POST /v1/mod/bond/offer {omr: <day's tranche>}` — exactly the "I only want to issue 100,000
  OMR this day" control it was built for. Day sizes are founder levers; the desk simply reads
  CLOSED before the first offering and after the last.
- **THE DESK (in-game)** — the secondary rail for players already in the city: the Dutch auction
  sells in-game $OMR credit for ETH, anchored to the same genesis price (the desk's fail-closed
  anchor gains a genesis print the same way the bond side does). In-game credit is extractable
  only through the audited mint-gate + withdraw rail — so this rail doubles as a funnel into the
  game rather than a parallel exchange.

**Where the window's ETH goes (the money router's own declared split, nothing new):** a genesis
raise of R ETH lands as **0.375R POL** (the LP seed — §G-2), **0.25R treasury** (the ticker
machine's first stock budget), **0.225R vig** (the withdrawal reserve is backed from day one —
extraction ≤ inflow holds before the first player extracts), **0.15R founder**. The window
literally funds the pool it precedes.

## Phase G-2 — the pool opens (the hook comes into play)

1. Pair the accrued **POL ETH (0.375R)** with **Safe genesis OMR at the genesis price** →
   initialize the canonical Uniswap v4 pool with **OmertaHook** — the founder-resolved
   **one hook, four slices** (dev / treasury / LP / vig; §10.8) — as the pool's one hook.
2. Deploy `OmrTwapOracle` on the pool; let it warm one full PERIOD (an unwarmed TWAP is exactly
   what its rebaseline guard refuses).
3. **The cutover, as ONE operation** (the audit's own warning — a gap here is a bond outage):
   `setOracle(OmrTwapOracle)` on the bond, and the desk's band re-anchors to the live TWAP.
   From this block, price is the market's; the GenesisOracle is retired.
4. The hook's treasury slice begins accruing on real swaps → the Stock Machine keeper (post-A1)
   has a live budget → the ticker ballot's record starts mattering.

**Why the open can't be dumped:** every genesis bond is mid-vest (fact 3); vested-and-claimed OMR
entering the game pays the 48h fresh-exit surcharge on the way back out; and the hook taxes sells
900 bps from the first swap. The genesis price = init price means no gap to arb. The one
deliberately accepted asymmetry: if demand at open exceeds the window's, early bonders are simply
up — which is the bootstrap incentive doing its job, not a defect.

## Phase G-3 — THE COMMUNITY DROP (the airdrop reserve)

**The reserve** comes from the Safe's genesis 100M (a founder-sized lever — sealed until claims
open). Target communities per the founder: **ETH mainnet** — CryptoPunks, BAYC, MAYC holders +
prominent coin communities ($PEPE-class, above a dust floor with a per-wallet cap); **Robinhood
Chain** — StonkBrokers holders + native coin communities ($CASHCAT-class). Weights per community,
flat-per-wallet vs per-NFT, floors and caps: all founder levers, tabled at decision time.

**The mechanics, each choice with its reason:**
- **Snapshot-then-announce** (G-0) — no Sybil exists after a block height is fixed.
- **Claims, never pushes** — the claimant pays their own gas (the house model), time-boxed
  (`CLAIM_WINDOW` ~60–90 days proposed), unclaimed reverts to the treasury.
- **Deterministic by construction** — a fixed amount per snapshotted wallet/NFT, published merkle
  root, no draw anywhere. The never-by-chance rule holds without effort.
- **D1 — the load-bearing decision: WHAT the claim delivers.** Two designs:
  - **(a) On-chain merkle drop** (a standard MerkleDistributor on Robinhood Chain; mainnet
    holders claim there with the same address — EVM addresses are portable, no bridge). Familiar
    marketing shape; but the tokens can hit the pool the moment they're claimed.
  - **(b) In-game credit via SIWE** — the claim page links the wallet (the SIWE rail, live
    today), verifies it against the merkle set, and credits **in-game $OMR** through the existing
    idempotent credit machinery. **Recommended**, because it converts the drop from a token
    scatter into USER ACQUISITION: every claimant becomes a registered account standing inside
    the game, the claimed value is extractable only through the audited rail (mint gate → toll →
    surcharge), and "unclaimed" never left the Safe at all. A hybrid (a small on-chain tranche
    for the headline + the larger tranche in-game) buys both stories.
- **The funnel bonus** (either design): a claim that also MINTS the identity (0.01 ETH) earns a
  stated bonus tranche — the drop pays for its own conversion.
- **THE PROVENANCE TRAITS ride the same snapshots** (`omerta-dynasty-machine-design.md` §9,
  counsel row A7): a snapshotted wallet's identity mint may claim — opt-in, once ever, banded,
  cosmetic only — a generative trait marking its community of origin. Two consequences for THIS
  plan: the G-0 announce-gate now covers the traits too (neither the drop NOR the trait feature
  is announced before every snapshot it reads is fixed), and the D1 recommendation strengthens
  further (the in-game claim flow delivers the drop, the mint, and your colors in one SIWE pass).

## 4. The new counsel row — A6

`omerta-counsel-memo.md` gains: **A6 — OMR may be distributed free to snapshotted third-party
communities.** A free, deterministic, snapshot-based distribution of the game token (not a sale;
no investment of money) to holders of unaffiliated NFT/token communities on ETH mainnet and
Robinhood Chain, claims gas-paid and time-boxed, claim-page copy under the standing no-promise
rules. *Question for counsel: does a free token distribution at this scale carry registration or
jurisdiction exposure (the historical airdrop-as-distribution line), and does the claim page need
the same geofence posture as A3's rail?* Phase G-3 is blocked on this row.

## 5. What this deliberately does not do

No pre-announced snapshots. No pushed tokens (every distribution is a claim). No chance anywhere
(fixed amounts, published roots). No LP before the window (the window funds it) and no second
pool (the untaxed-pool argument, §9.6). No genesis price talk in public copy beyond the number
itself — no targets, no projections, no appreciation language (the standing rule, with counsel's
eyes on the claim page and the window copy specifically). And no phase starts before the gates:
audit, A1–A5, and now A6.

## 6. Open founder levers (tabled at decision time, none pinned yet)

Window length (1–3 days) · per-day offering sizes · THE GENESIS PRICE · desk-rail on/off ·
airdrop reserve total · per-community weights + floors/caps · flat-per-wallet vs per-NFT ·
D1 (on-chain vs in-game vs hybrid) · the funnel-bonus size · claim window length.
