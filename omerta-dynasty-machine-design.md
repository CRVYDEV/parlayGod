# THE DYNASTY MACHINE — the uncapped identity NFT, its ERC-6551 vault, and the activation model

Status: **DESIGN. Chain-dormant, gated on counsel memo rows A2 + A4 (`omerta-counsel-memo.md`) and
the standing third-party-audit gate.** Founder-directed: the identity NFT rides **ERC-6551
token-bound accounts** (the founder pointed at the standard itself:
https://eips.ethereum.org/EIPS/eip-6551), has **no maximum supply**, and carries the utility of the
RWA fee slice through the **activation** model (the StonkBrokers shape). This doc grounds those
three directives in the REAL standard — every mechanical claim below was verified against the EIP
text on 2026-08-09 (a fan-out read + adversarial cross-check of each repo assumption; all
consistent) — and extends `omerta-identity-nft-design.md` (the trophy/entitlement wall) and
`omerta-rwa-stock-machine-design.md` (where the stock comes from).

## 1. What ERC-6551 actually provides (verified, with the facts that decide our design)

1. **A canonical, ownerless registry singleton** at `0x000000006551c19487814612e58FE06813775758`,
   deployed to ANY EVM chain by anyone via Nick's Factory
   (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) with a published salt and raw transaction — so
   deploying it to Robinhood Chain is permissionless deploy CONFIG, not a contract we write.
   *Deploy-check: Nick's Factory must exist on the Orbit chain (it ships on virtually every EVM
   chain; verify before relying on it — the CHAIN-DEPLOY checklist gains a line).*
2. **Counterfactual accounts.** `createAccount` is CREATE2 + permissionless, and the registry
   exposes a view computing the address BEFORE deployment — an account can HOLD assets while
   undeployed. **This is the whole gas model**: allocations accrue to a computed address for free;
   the player deploys their own account (or anyone does — it changes nothing) only when they want
   to ACT, paying their own gas. The founder's claims-model, native to the standard.
3. **The NFT contract needs zero changes.** 6551 layers onto any already-deployed NFT — the
   Dynasty NFT can be the plainest possible ERC-721, and the TBA rail can even ship AFTER the NFT
   does.
4. **Control is derived live, nothing ever "moves."** The account's valid signer is whoever holds
   the bound NFT NOW (the reference implementation reads `ownerOf(tokenId)` at call time). Selling
   the NFT transfers control of the account and everything in it in the same instant, with no
   per-asset transfer calls.
5. **The account is an ERC-1167 minimal proxy** with its binding (implementation, salt, chainId,
   tokenContract, tokenId) baked immutably into bytecode. The spec's own trust statement: *the
   only trusted contract for any token-bound account is the implementation.* → **the account
   implementation joins the third-party audit scope** the moment a TBA can hold stock.
6. **The drain-before-sale fraud vector is real and explicitly out of the standard's scope**: a
   seller empties the TBA one block before accepting an offer, and the buyer receives a hollow
   trophy. The spec names four mitigations: `state()`-bound marketplace orders, asset-commitment
   lists, an order-validating external contract, or a lock mechanism in the account
   implementation. §5 below picks ours.
7. **Status: the EIP is in Review, not Final.** The registry address and interface IDs
   (`IERC6551Account = 0x6faff5f1`) are de-facto stable across the ecosystem, but we pin the
   registry + implementation bytecode we deploy against at deploy time and record them in
   CHAIN-DEPLOY.md — a Review-status spec is not a promise.
8. **721-shaped by design.** The registry does no interface check (even fungible tokens "work,
   although these use cases are outside the scope of the proposal") — but control derives from
   `ownerOf`, which ERC-1155 does not have. So: **the Dynasty NFT is an ERC-721 — the suite's
   first** (everything on GearVault stays ERC-1155: gear 1..N, cars 100000+, boats 200000+ — those
   are ITEMS, plural by nature; an identity is singular by nature, which is exactly the 721/1155
   split as intended).

## 2. The three founder rules, restated as architecture

**(1) NO MAXIMUM SUPPLY.** A supply cap on the identity would cap the player count. The Dynasty
NFT mints uncapped at the fixed identity fee (0.01 ETH — the existing mint fee), proceeds through
the declared money-router waterfall. No scarcity marketing, no appreciation language (counsel memo
A4 + the standing copy rule).

**(2) THE TROPHY/ENTITLEMENT WALL HOLDS — the TBA is the exception, deliberately.**
`omerta-identity-nft-design.md`'s load-bearing rule stands: the game ENTITLEMENT
(`account_persistent.minted`, wage/withdraw gates) stays account-bound in the database and is
never read off `balanceOf` — otherwise the real per-identity cost decays to the secondary floor
(the dead alts of the last farm). What the NFT + TBA adds is a **container of on-chain value**
(the activated stock allocations) that IS transferable — knowingly, as counsel memo A2 records.
Selling your Dynasty NFT sells your vault contents and your portrait; it never sells your ACCOUNT
(the buyer does not get your login, your legends, or your entitlement — those live in the DB, on
the account, where they always did).

**(3) THE ACTIVATION MODEL (the StonkBrokers shape, made never-by-chance).** The treasury's stock
(bought by the Stock Machine's keeper off the daily Ticker Ballot) is allocated to Dynasty NFTs by
**activation weight**: burning EARNED $OMR activates a share for an allocation epoch. Earned or
bought, never rolled — the RWA never-by-chance rule holds by construction (a ballot votes, a
purchase buys, an activation burns). Activation is the missing $OMR demand engine: a deep,
recurring, voluntary sink whose payout is the thing the whole machine exists to distribute. Every
activation burn rides the audited `spendOmr` till under a new enumerated reason (its own §10.4
vocabulary entry + `DESK.SINK_REASONS` row when built — sinks recycle to the desk since v3 step 2).

## 3. The allocation rail (why counterfactual accrual is the design)

- Allocation is BOOKKEEPING first: the game's vault ledger (the `allocated ≤ held, same asset both
  sides` wall from the stock-layer retirement) assigns treasury-held stock units to a Dynasty
  NFT's **computed TBA address** — no deploy, no gas, no on-chain writes at allocation time.
- DELIVERY is the player's act: deploy-if-needed + a server-signed transfer through the ONE
  extraction boundary (the voucher rail), eligibility enforced at signature time (counsel memo A3
  — geofence/KYC depth is counsel's parameter), the claimant paying their own gas end to end.
- Between allocation and delivery, nothing custodial changes: the treasury Safe holds the stock,
  the ledger holds the assignment, `allocated ≤ held` is checked nightly like every other
  real-value invariant. An unclaimed allocation is a ledger row, not a stranded on-chain balance.

## 4. Contract surface (Phase B of the Stock Machine, one audit batch)

New: **DynastyNFT** (minimal ERC-721 — uncapped mint at the identity fee, tokenURI to the layered
portrait composition, zero owner-mint paths beyond the fee-gated mint, the house discipline) and
the **TBA account implementation** we bless (prefer the ecosystem reference implementation,
pinned by bytecode hash, over writing our own — an account that custodies securities is the last
place for novel Solidity; if we must fork, it is for §5's lock only). The registry we do not
write — we replay the published deploy transaction. The StockVault/claim rail is already specified
in `omerta-rwa-stock-machine-design.md`. All of it lands in the SAME third-party audit batch
(the audit clock is already reset; batch, don't dribble).

## 5. The drain-before-sale answer (ours, since the spec declines to pick)

A hollow-trophy sale is a market-integrity problem on OUR flagship asset, and with SECURITIES in
the vault it is also an A2 disclosure item. Three layers, cheapest first:
1. **Disclose structurally**: the public dossier/marketplace metadata for a Dynasty NFT surfaces
   the TBA's `state()` value and its current holdings summary (banded per the info-economy rule),
   so any marketplace or buyer CAN bind an order to state — the spec's own first mitigation.
2. **Prefer an implementation with a holder-optional lock** (the spec's third mitigation): a
   seller can lock the vault for N hours and point buyers at the lock — a locked listing is a
   credible listing.
3. **Never promise marketplace enforcement we don't control**: the buyer-side residual risk is a
   stated caveat in A2's disclosure question for counsel, not something we paper over.

## 6. What this deliberately does not do

No supply cap (rule 1). No entitlement on the token (rule 2 — the wall's whole point). No RNG
anywhere near allocation (never-by-chance). No custom account implementation beyond the lock, if
even that (audit surface). No cross-chain execution (the spec supports it; we bind chainId =
Robinhood Chain and stop there). No delivery outside the voucher boundary (A3). And no copy that
promises anything about what the NFT or the stock will be worth.

## 7. Order of work

1. **Now (chain-dormant, no counsel dependency):** the activation-model design + sim (the burn is
   a §10.4 sink — sizing wants the standard sim pass) and the allocation ledger schema (pure
   bookkeeping, the vault-ledger shape that already exists for ETH).
2. **On A2 + A4 signatures:** DynastyNFT + pinned account implementation + registry replay on a
   devnet → the audit batch with StockVault.
3. **On A3's parameters:** delivery live behind the voucher rail.

*Maintainers: every mechanical claim in §1 cites the EIP as verified 2026-08-09; if the EIP moves
out of Review with changes, §1 is the checklist to re-verify. The counsel memo's A2 row is the
legal gate for everything past §7.1.*

## 8. THE ACTIVATION MECHANICS (designed 2026-08-09 — the §7.1 deliverable; build waits on A1)

The §2.3 model made concrete. Every number below is a PROPOSED DEFAULT — a founder sign-off lever
the moment it becomes a constant; none exists in code yet, deliberately (building a burn whose
payout cannot exist until the keeper buys would sell exposure to nothing).

**The epoch is the DAY — the ticker ballot's own clock.** During day D the chamber's vote is
public and anyone MINTED may **activate**: burn $OMR (reason `activation:share`, a new omr
vocabulary prefix joining `omrBurns` + `DESK.SINK_REASONS` — sinks recycle to the desk since v3
step 2) to take a linear share of day D's allocation pool. At the roll, the ballot freezes and the
keeper executes day D's buy with the treasury slice accrued through D; the units land pro-rata on
day-D activations: `u_a = U × b_a / Σb`. So activation is an INFORMED act — you watch the ballot
all day, then commit — and the loop reads: *the families vote the ticker, the town activates, the
treasury buys, the vault fills.* Linear weight, a fixed public formula, no draw anywhere —
never-by-chance holds by construction.

**Design decisions, each with its reason:**
- **Allocations book to the ACCOUNT, not the TBA address.** Pre-Phase-B there is no on-chain NFT;
  the TBA is the DELIVERY destination, resolved at claim time (§3). The ledger stays the
  vault-ledger shape keyed by `account_id`.
- **A silent day still buys.** If nobody activates, the keeper buys anyway (the ballot is the
  town's decision, not the activators') and the units sit UNALLOCATED in the treasury's general
  holding — inside `held`, never inside `allocated`, claimable by nobody. No roll-forward: a
  retroactive windfall for tomorrow's activators would reward waiting out the town.
- **No per-account cap.** A whale burning more takes proportionally more — that is
  purchase-shaped, not chance-shaped, and capping it would only fragment the burn across alts.
  `ACTIVATION.MIN_OMR` (proposed 1) exists solely to refuse dust rows.
- **Agents may activate** (they burn real-money-backed $OMR like anyone); the A3 claim-rail gate
  is where delivery eligibility lives, and counsel's A3 answer governs them there.
- **No self-reference in the money loop** (checked against the router, not assumed): the
  activation burn recycles to THE DESK, whose auction ETH splits founder/POL — the treasury's
  stock budget is fed ONLY by the four declared revenue slices (fee 10% · store 20% · sell-tax
  4/9 · bond 25%). Activation demand cannot inflate its own payout. This is the anti-Ponzi shape
  in one sentence: the payout is bought with OTHER people's spending, never with the burn itself.

**The ledger (DDL sketch — built with the burn, post-A1; all NEW tables, live-DB-safe):**
```sql
CREATE TABLE stock_activations (day INT, account_id TEXT, omr NUMERIC,
  PRIMARY KEY (day, account_id));                       -- day-D burns (the epoch's share register)
CREATE TABLE stock_buys (day INT PRIMARY KEY, ticker TEXT, eth_spent NUMERIC, units NUMERIC,
  price NUMERIC, tx_hash TEXT, real BOOLEAN);           -- txHash-gated (comps book ZERO — the anti-fabrication rule)
CREATE TABLE stock_holdings (ticker TEXT PRIMARY KEY, units NUMERIC);        -- treasury held, per ticker
CREATE TABLE stock_allocations (account_id TEXT, ticker TEXT, units NUMERIC,
  PRIMARY KEY (account_id, ticker));                    -- the vault-ledger shape (account-keyed, survives death)
```
Invariants (the nightly runner, the treasury-wall shape): per ticker
`Σ stock_allocations.units ≤ stock_holdings.units`; holdings grow only from a `real` buy;
allocations grow only from a buy's pro-rata split; `Σ activation:share burns == Σ stock_activations.omr`.

**The sizing (sim P9.34, printed every run).** The equilibrium is the sizing answer: each
activated $OMR carries `T / A` ETH-worth of stock (T = the day's treasury buy, A = the day's total
activation), so rational participation self-sizes toward `A* ≈ T × P` (P = the oracle's OMR/ETH) —
the point where a burned $OMR buys exactly one $OMR's worth of exposure. **The recurring sink this
creates is therefore the treasury inflow itself, denominated in $OMR** — activation converts every
ETH of declared treasury revenue into that much daily $OMR demand, which is precisely the demand
engine §2.3 promised. Below-equilibrium participation over-rewards early activators (the bootstrap
incentive); above it, the burn is dominated by simply holding — both self-correcting. INTERNAL
sizing only: the standing copy rule forbids ever publishing a value-per-$OMR figure as marketing.

## 9. THE PROVENANCE TRAITS (founder-directed 2026-08-09; design only — counsel row A7)

The founder's idea: *make the NFTs generative in a way affected by traits derived or generated by
how much or which tokens or other NFTs a wallet held on ETH / Robinhood Chain / other major
chains.* This section makes it mechanical. The short version: **your mobster's portrait carries
the colors of the tribe you came from** — a snapshotted CryptoPunks wallet mints a portrait with a
Pixel District marker, a StonkBrokers wallet with a Broker's Floor marker — and the derivation
rides machinery the launch plan already commits to building. An adversarial pass over every
standing rule (22 binding rules swept; six real tensions surfaced) shaped the five load-bearing
decisions below; each is the tension's resolution, not a preference.

### 9.1 One dataset, two uses — and the announce-gate extends to THIS feature

Traits derive from **the SAME taken-before-announce snapshots the community drop pays from**
(`omerta-launch-sequence-design.md` G-0/G-3 — block heights fixed BEFORE anything is announced;
"pre-announced snapshots" are exactly what that rule forbids). The drop already requires
per-wallet balances at a fixed block to compute merkle amounts, so the trait derivation is a
LOOKUP in data the launch already produces — no new infrastructure — and it inherits the
snapshot's whole security argument: no Sybil, flash loan, rental, or buy-mint-sell can acquire
into a past block. **The corollary the sweep surfaced: the provenance-trait feature itself must
not be announced before every snapshot it will ever read from is fixed** — a trait announced
ahead of its snapshot is a farmable snapshot, exactly the thing G-0's rule exists to prevent. The
G-0 gate now covers both the drop AND the traits.

**"Other major chains" happen through CAMPAIGNS, never the genesis set** (the founder named
ETH/RH/other): the genesis snapshots cover the two launch chains only (what A6 names). A later
chain or community is a NEW campaign — its own snapshot-before-announce, its own layer art, its
own memo touch if it widens A7's surface. The mechanism is reusable; the genesis set is closed.

### 9.2 A birth certificate, not a wallet tracker — and OPT-IN

Provenance stamps ONCE, at identity mint, from the SIWE-linked wallet's snapshot membership — and
never updates. Three reasons, each sufficient alone: a live-updating trait re-opens the farm (buy
the token, refresh the art, sell the token); a portrait that tracks a wallet's current holdings
is a WALLET SCANNER wearing art's clothes; and noir-wise, provenance is where you CAME from — a
birthplace, not a balance.

**The stamp is OPT-IN at mint.** The identity doc's wealth rule ("exposed never, in any form";
the free public token at most as revealing as the paid Wire dossier) is genuinely strained here:
even banded, a provenance trait publicly attests that the minting wallet held a six-figure NFT or
a deep token position — a real-world wealth signal no existing surface volunteers. The resolution
is consent: **no wallet's holdings are ever attested without the owner's explicit claim at mint**
(default = clean portrait). What opt-in plus banding leaves as residual is small and honest — the
minting wallet is on-chain anyway, so a minter who claims provenance reveals nothing the chain
didn't already show at that block — but the CHOICE is theirs, which is what the rule's
anti-targeting rationale actually wants. Banded tiers only (proposed: HELD / DEEP per community,
thresholds as levers), never an amount, never a count.

### 9.3 One provenance per snapshot wallet, EVER (the unbounded-grant fix)

The collection is uncapped (A4) and snapshot membership is immutable — so without a bound, one
snapshotted wallet could mint UNLIMITED trait-bearing NFTs at 0.01 ETH each and sell them
forever: an open-ended monetizable grant to third-party communities that the drop's own design
(fixed amounts, caps, time-boxed claims) deliberately avoids, and a quiet dilution of the trait's
meaning. The rule: **a snapshot wallet stamps provenance onto exactly ONE identity, ever** — the
first mint that claims it consumes it (recorded server-side beside the merkle claim state). A
birth certificate is issued once. This also keeps A4's framing intact: no scarce-edition
economics inside the uncapped collection, because the trait is a one-per-wallet birthmark, not an
edition.

### 9.4 Art only — zero gameplay effect (a hard rule, three reasons)

A provenance trait moves NOTHING in-game: no stat, no cap, no discount, no access, no wage, no
allocation weight. (1) Power from external holdings is pay-to-win via outside wealth — worse than
anything the D8=D ceiling permits, and it would put third-party tokens inside the game's balance
surface; (2) it keeps the A2 analysis unchanged — the trait is cosmetic art on the trophy, and
nothing new accrues value to the NFT from gameplay; (3) it makes farming pointless even if a
future campaign leaks early — a trait buys a look, never an edge. §10.4: zero surface (art moves
no value; the fees.js precedent).

### 9.5 The IP posture — two vocabularies, cleanly split (memo row A7)

**Trait names, metadata, and art are fictional** — the Broadcast posture extended to the token
surface: evocative noir-native inventions (working names, all levers — the Pixel District, the
Ape Social Club, the Broker's Floor, the Frog Pond, the Cat's Table), original art, no
trademarked string or derivative imagery anywhere in tokenURI or plates. **Eligibility and
announcement copy names the real collections FACTUALLY** ("wallets holding a CryptoPunk at block
N") — nominative reference, unavoidable for any targeted drop and already required by A6's own
claim copy; the mint/claim page carries a non-affiliation line. That split — factual naming in
eligibility copy, fictional vocabulary in the artifact — is the posture; **memo row A7** records
both questions (the Yuga-v-Ripps class on the art; whether holdings-derived traits alter the
A2/A4 analysis) for counsel's eyes before launch. Design and art production proceed under the
standing directive.

### 9.6 Slots, choice, transfer, and the layer pipeline

Each provenance is ONE reviewed layer item (a lapel pin, a pocket square, a backdrop tint) in the
identity doc's layered composition — reviewed as LAYERS, per its own rule. A multi-community
wallet's single stamped identity records EVERY qualifying provenance in metadata attributes; the
ART shows the one the player PICKS (server-stored like the title slot; default = the scarcest).
On NFT transfer the provenance travels with the token — correct for a trophy: it stamps the MINT
moment, and the chain of custody is public; the buyer gets a portrait with a history, not a claim
about themselves. The entitlement wall is untouched (account-bound in the DB, never read off the
token). Cross-chain reads are archive-node RPC calls at the snapshot block; per-chain address
lists are campaign config, not code.

### 9.7 What it does to the funnel

The strongest share hook in the launch: the drop's communities get a VISIBLE tribal identity
inside the game (a Punk-provenance mobster IS the share moment), and it stacks the launch doc's
D1 recommendation further toward in-game claims — claim the drop, mint the identity, claim your
colors, one SIWE flow. The G-3 funnel bonus already pays a claim that also mints; provenance
makes the mint the thing you WANT rather than the toll you pay. Provenance keys on the WALLET,
not the claim route, so it lands identically under D1's on-chain variant.

### 9.8 Open levers (tabled; none pinned — nothing here is a constant yet)

Community list per campaign · tier thresholds (HELD/DEEP per community) · the evocative name set ·
the visible-slot default · whether genesis snapshots ever re-open (recommended: never — the
launch-era marker is the scarcest honest thing the collection will ever have) · whether a
campaign may ever stamp an EXISTING identity retroactively (recommended: no — stamps happen at
mint, or the birth-certificate fiction breaks).
