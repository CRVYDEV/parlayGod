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
  sides` wall from the stock-layer retirement) records the assignment — no deploy, no gas, no
  on-chain writes at allocation time.
- **CUSTODY CLARITY (the adversarial pass caught §3 and §8 disagreeing — this is the resolution,
  and A2's fact pattern states it):** the bookkeeping is **ACCOUNT-keyed** (§8's DDL governs —
  pre-Phase-B no token exists to key on, and account-keyed is the trophy/entitlement wall's own
  preference). The TBA is the **DELIVERY DESTINATION**, resolved at claim. The consequence,
  stated plainly so counsel signs the true thing: **a PENDING (undelivered) allocation is
  account-bound and does NOT transfer with the NFT; only stock actually DELIVERED into the TBA
  travels with the token.** Selling the NFT sells the TBA's contents — the delivered stock — and
  nothing else. Anyone buying "the vault" buys what is IN it, verifiable on-chain, which is also
  the honest frame for the drain-before-sale disclosure (§5).
- DELIVERY is the player's act: deploy-if-needed + a server-signed transfer through the ONE
  extraction boundary (the voucher rail), eligibility enforced at signature time (counsel memo A3
  — geofence/KYC depth is counsel's parameter), the claimant paying their own gas end to end.
- Between allocation and delivery, nothing custodial changes: the treasury Safe holds the stock,
  the ledger holds the assignment, `allocated ≤ held` is checked nightly like every other
  real-value invariant. An unclaimed allocation is a ledger row, not a stranded on-chain balance.
- **The Sybil re-derivation flag (exploit lens):** a token whose TBA holds delivered stock is a
  VALUE-BEARING token, and BALANCE.md § THE FARM's per-identity Sybil math was measured against a
  token with no intrinsic value. Before mainnet delivery goes live, the Sybil bound must be
  RE-DERIVED with the vault floor included — the §1 wall holds for the ENTITLEMENT only, and
  nobody should claim otherwise.

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
the vault it is also an A2 disclosure item. **Stated honestly first (the adversarial pass's
correction): at launch, NONE of the spec's marketplace-side mitigations exist** — state()-bound
orders and order-validating contracts require 6551-aware marketplaces, which the mainstream ones
are not and which a July-2026 Orbit chain has none of at all. So the answer to A2's "does
drain-before-sale require disclosure language" is **yes**, and the layers below are what WE
control, cheapest first:
1. **Disclose structurally**: the public dossier/marketplace metadata for a Dynasty NFT surfaces
   the TBA's `state()` value and its current holdings summary (banded per the info-economy rule),
   so any marketplace or buyer CAN bind an order to state — the spec's own first mitigation.
2. **Prefer a DEFAULT-ON lock at listing time** in the account implementation we bless (the
   holder-OPTIONAL lock creates a lemons market — an honest seller who keeps activating during
   the listing window is indistinguishable from a drainer). Stronger still, and preferred if the
   audit scope allows: delivered stock can only ever move OUT of the TBA through the same
   eligibility-gated voucher path — no arbitrary ERC-20 transfer signer on the TBA — so a "drain"
   is itself gated.
3. **Never promise marketplace enforcement we don't control**: the buyer-side residual risk is a
   stated caveat in A2's disclosure question for counsel, not something we paper over — and the
   claim/marketplace copy warns explicitly against wrapper/escrow "rentals" of vault-bearing
   tokens (the one rental shape ERC-4907 immunity does not cover).

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
into a past block. **The corollary the sweep surfaced, in its per-campaign form (the design lens
corrected the first wording, which read literally would have forbidden every future campaign): no
campaign — genesis included — is announced before its OWN snapshot blocks are fixed.** The
mechanism being publicly known is harmless; the targets and blocks of an unfixed campaign are
what must stay unannounced. The G-0 gate covers both the drop AND the traits.

**"Other major chains" happen through CAMPAIGNS, never the genesis set** (the founder named
ETH/RH/other): the genesis snapshots cover the two launch chains only (what A6 names). A later
chain or community is a NEW campaign — its own snapshot-before-announce, its own layer art, its
own memo touch if it widens A7's surface. The mechanism is reusable; the genesis set is closed.

### 9.2 A birth certificate, not a wallet tracker — and OPT-IN

Provenance stamps ONCE and never updates. Three reasons, each sufficient alone: a live-updating
trait re-opens the farm (buy the token, refresh the art, sell the token); a portrait that tracks
a wallet's current holdings is a WALLET SCANNER wearing art's clothes; and noir-wise, provenance
is where you CAME from — a birthplace, not a balance.

**The stamp-eligible moment, defined** (the design lens caught four different "mint moments"
across the docs — the account fee-mint live today, the future DynastyNFT issuance, the retrofit
batch to already-minted accounts, and a fee paid with no wallet linked at all): the moment is
**DynastyNFT token issuance — the retrofit batch included** — and the window is *at issuance, or
at first wallet-link thereafter, one-time*. A grace window, not open-ended retroactivity: the
certificate is issued when the token is, which for retrofitted veterans is the honest reading,
and a pay-before-link minter stamps from **the wallet LINKED at stamp time** (the paying wallet
can differ; the linked one is the identity's). §9.8's "never retroactive" lever means
never re-stamping an already-stamped or window-lapsed identity — not locking out the existing
player base.

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
first mint that claims it consumes it. **The consumption unit is the WALLET's one stamp EVENT,
not (wallet, community)** — the design lens caught the ambiguity: per-community consumption would
let a Punks+BAYC+PEPE wallet mint three separate trait-bearing NFTs, the exact grant this rule
bounds. At the one event the minter chooses WHICH of their qualifying communities to record
(opt-in is per-community — the consent granularity §9.2 wants); anything unclaimed at that event
is forfeit. Recorded server-side keyed by WALLET, beside the merkle claim state. A birth
certificate is issued once. This also keeps A4's framing intact: no scarce-edition economics
inside the uncapped collection, because the trait is a one-per-wallet birthmark, not an edition.

### 9.4 DISPLAY-ONLY FOREVER — the wall, in the trophy/entitlement wall's own shape

A provenance trait moves NOTHING, in-game or on-chain: no stat, no cap, no discount, no access,
no wage — and, stated as a WALL rather than an implication, **never an input to activation
weight, allocation, claim eligibility or priority, or any till, gate, or lever, ever**. The
adversarial pass named the cliff exactly: the drift is one future "reward our genesis
communities" coupling away, and the moment a holdings-derived trait weights an allocation, the
free trait retroactively becomes a distribution of expected securities allocations keyed to
third-party asset holdings — the strongest possible Howey fact against the NFT AND against A6's
"no investment of money" characterization, while nicking the never-by-chance wall (assigned by
what a wallet happened to hold, not by purchase or effort). Three standing reasons besides:
(1) power from external holdings is pay-to-win via outside wealth — worse than anything the D8=D
ceiling permits; (2) display-only is what keeps the A2 analysis unchanged; (3) it makes farming
pointless even if a future campaign leaks early — a trait buys a look, never an edge. **When the
activation burn is built, this wall gets PINNED the house way**: a mutation-verified test that
the allocation computation reads only `(day, account, omr)` and no trait/provenance column is
reachable from it. §10.4: zero surface (art moves no value; the fees.js precedent).

### 9.5 The IP posture — two vocabularies, cleanly split (memo row A7)

**Trait names, metadata, and art are fictional** — the Broadcast posture extended to the token
surface: evocative noir-native inventions (working names, all levers), original art, no
trademarked string or derivative imagery anywhere in tokenURI or plates. **Eligibility and
announcement copy names the real collections FACTUALLY** ("wallets holding a CryptoPunk at block
N") — nominative reference, unavoidable for any targeted drop and already required by A6's own
claim copy. That split — factual naming in eligibility copy, fictional vocabulary in the
artifact — is the posture, and the adversarial pass sharpened it into enforceable rules:

- **The guessability test** (the layer-review gate, in this project's own mutation-test spirit):
  a reviewer who has NOT seen the community→trait mapping must be unable to identify the source
  community from the trait's name + art alone. Guessable = evocation of the mark, not noir —
  rename/redraw. So the working names above ("the Pixel District", "the Ape Social Club") FAIL
  this test and are placeholders only; invented district/club names with no source lexeme pass
  trivially. The layer contact-sheet checklist gains an IP criterion for the community slots:
  no apes/primates, no frogs (Pepe is Furie's actively-enforced character COPYRIGHT — the
  no-trademarked-strings rule does nothing there), no pixel-avatar aesthetics, no serum motifs,
  no cat-coin mascots.
- **Marks live ONLY in eligibility prose**: plain-text collection names, minimum necessary,
  never stylized, never logos, never their art; **numeric community ids** in contract source,
  calldata, event names, merkle-set filenames, and URLs (a verified claim contract shipping
  `enum Community { BAYC … }` embeds the marks in published source forever — the realistic
  week-two breach is marketing surfaces, not the design doc).
- **The non-affiliation disclaimer** sits adjacent to EVERY use of a community name (claim page,
  announcement, landing copy) — and deliberately NEVER in tokenURI or on-chain artifacts, which
  stay mark-free by construction, so the question never arises there.
- **The banned lexicon** (an extension of the standing no-appreciation rule, attached to the
  counsel copy-review packet as an exhibit): rare/rarity/rarest, limited, exclusive, floor,
  value, "only N will ever" — banned in shop copy, docs, tweets, and the claim page for this
  feature. The allowed frame, stated positively: recognition/homage/provenance — "the city
  remembers where your founder came from." (Third-party rarity tools will price the trait
  distribution from public metadata regardless — their speech; the rule protects OUR legal
  surface, so it must be airtight there.) The metadata field is **`genesis_provenance`** — never
  `tier`/`rank`/`rarity`, and no ordinal or value-ranked tier names.
- **Privacy (EU-shaped, cheap to preempt)**: the snapshot is processing of pseudonymous personal
  data — the privacy policy gains a paragraph (what was read, at what block, the
  legitimate-interest basis, retention, that traits derive from it); publish the MINIMUM claims
  need (address+amount for merkle proofs) with the trait mapping computed server-side at claim,
  never shipped as a public address→tier table; bands stay coarse.

**Memo row A7** records the counsel questions (the Yuga-v-Ripps class on the art; whether
holdings-derived traits alter the A2/A4 analysis), and **A2/A4/A6's own fact patterns are
amended** so no signature is given against a stale record (the memo's lockstep rule). Design and
art production proceed under the standing directive.

### 9.6 Slots, choice, transfer, and the layer pipeline

Each provenance is ONE reviewed layer item in **its own named slot** in the identity doc's
composition table (fixed z-position between attire and effects, so reputation effects render OVER
it — the game's judgment outranks your origins, which is also the right fiction; "backdrop tint"
is dropped as an example since it collides with the district-driven backdrop slot) — reviewed as
LAYERS, per the standing rule. A multi-community wallet's single stamped identity records every
provenance it CLAIMED at the stamp event (§9.3) in metadata attributes; the ART shows the one the
player PICKS. **The pick's persistence, specified precisely** (the design lens caught both
defects): stored ACCOUNT-level (a character-keyed slot dies with the street while the token
persists across generations — a pick keyed "like the title slot" silently resets every death),
and the default is the scarcest **computed ONCE at stamp time and stored AS the pick** (live
"scarcest" recomputes as the uncapped collection mints, flipping unpicked portraits under
marketplace caches). **The shame markers are never suppressible**: the player arranges the
POSITIVE provenances; the identity doc's negative marks (rat/welsher/wanted effects) always
render if present — the collectible cannot hide the mark.
On NFT transfer the provenance travels with the token — correct for a trophy: it stamps the MINT
moment, and the chain of custody is public. **Framing rule for every surface** (the
false-statement-about-the-buyer fix): a provenance trait is an immutable historical fact about
the FOUNDING wallet at the snapshot block — the metadata attribute reads as provenance-of-mint
("Origin (at mint): …", description "the wallet that founded this bloodline, at block N"), which
stays true through every transfer — and it is NEVER rendered as a badge of the current holder
anywhere (dossier, marketplace description, console). **And the WHOLE PORTRAIT freezes at
transfer** — both adversarial lenses converged on this independently, and it resolves a
contradiction that predates this section: the identity doc's "dynamic, ages with the bloodline"
portrait re-renders from the MINTING account's ongoing state, but the account never transfers
with the token, so a sold "living portrait" would keep mutating on the SELLER's later play (the
seller rats post-sale and the buyer's asset acquires the broken frame — drain-before-sale's
presentational twin). The rule: **dynamic while held by the minting account's linked wallet,
FROZEN at the block of first transfer away from it** — a sold portrait is a photograph, which is
the identity doc's own thesis ("you can buy a dead man's photograph, you cannot buy his
reputation"). The entitlement wall is untouched (account-bound in the DB, never read off the
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

Community list per campaign · tier thresholds (HELD/DEEP per community) · the evocative name set
(everything must pass the §9.5 guessability test) · the visible-slot default · whether
genesis-named COMMUNITIES may ever appear in a later campaign at a NEW block (recommended: no —
that is what preserves the launch-era marker's meaning; the design lens struck the earlier
"re-open the snapshot" phrasing since a past block height cannot re-open) · whether an
already-stamped or window-lapsed identity may ever be re-stamped (recommended: no — §9.2's grace
window is the whole allowance, or the birth-certificate fiction breaks).

## 10. THE MINT PRICE (founder-directed 2026-08-10: "maybe instead of .01 ETH it can also be a
number of OMR that gets burned and scales up as more NFTs are minted")

> **SUPERSEDED IN PART, SAME DAY — THE MINT IS ETH ONLY, AND SO IS EVERYTHING ELSE.** The founder
> then ruled *"Make the mint ETH only no OMR"* and, an hour later, *"Make plex items and consumables
> eth only"*. So the whole $OMR-rail half of this section is history: **PLEX is retired** (payers
> deleted, routes mounted as tombstones, `plex:%` kept in the vocabulary and the burn term forever
> because real rows exist, and a `plex bridge retired` freshness check asserts nothing new writes
> them). What SURVIVES from this analysis, and is now live: **Shape A (the automatic supply-indexed
> curve) stays rejected**; **Shape D (discrete published tranches) is ADOPTED** — five waves, ETH
> only, capped at 0.05 (`MINT_TRANCHES`); and the rail-interaction law below is the reason the
> second rail went at all. The recycles-to-the-desk observation is what finally settled it: since
> v3 step 2 a PLEX purchase did not burn anything, so the trade the bridge was sold on had already
> expired. Read §10 for the reasoning, not for the mechanism. See BALANCE.md § THE TRANCHE SCHEDULE.

**Half of this is already live.** The $OMR-denominated mint exists: PLEX (`POST /v1/plex/mint`) —
pay the identity fee in earned $OMR (`PLEX_MINT_OMR` 5 floor, market-linked at
`max(floor, feeEth × oracle × 1.2)`), and since economy-v3 step 2 that $OMR **recycles to THE
DESK** rather than burning — the founder's own revenue-over-deflation decision (`plex:%` is in
`DESK.SINK_REASONS`; the desk resells it, the auction ETH splits founder/POL). So "a number of
OMR" is shipped; the two genuinely new pieces are **the scaling** and **the maybe-instead-of-ETH**
— and both were evaluated against the walls rather than assumed.

**The rail-interaction law first, because it shapes everything:** with two rails open, the
EFFECTIVE mint price is the CHEAPER rail. Scaling one rail alone is either decorative (it becomes
the expensive rail nobody uses) or silently becomes the only real price (it undercuts the other).
The rails move in LOCKSTEP or not at all — this is exactly what the preflight implied-rate guard
exists to enforce (both fee pairs pin ~500 $OMR/ETH; a desync makes the cheapest identity the
lagging rail, and minting is the Sybil bound, so a desync quietly undoes the bound).

### The three shapes, evaluated

**Shape A — the automatic supply-indexed curve (the literal proposal): REJECTED, four reasons.**
(1) **A4's signed predicate** is "uncapped at a FIXED price… no scarcity marketing, no
roadmap-of-appreciation" — an automatically-rising mint price IS the scarcity pitch in mechanical
form (mint now, it only goes up), the Impact-Theory-shaped fact the memo just hardened A2/A4
against; adopting it re-opens A4. (2) **The free-path ceiling**: the mission ladder pays a FINITE
lifetime $OMR (220, test-pinned against the live MISSIONS table — the D8=D bound-(1) promise that
the top of the game is reachable without paying, and the "you can get made for free" coach rung).
A rising $OMR price crosses that ceiling at some future supply number and breaks the promise
SILENTLY — the exact class (the game withholding its own terms) behind every tester complaint this
project has recorded. (3) **The growth headwind**: a curve prices identity UP exactly as the game
succeeds. The whole funnel investment — the drop as user acquisition, provenance making the mint
the thing you WANT — optimizes for LATER cohorts joining, and a curve taxes precisely them. The
Sybil bound does not need it: a farm mints EARLY at the cheap end, so the curve is anti-late-player,
not anti-farm. (4) **The copy problem is unsolvable**: there is no honest way to describe an
auto-escalating mint that does not imply appreciation.

**Shape B — $OMR-only, retire the ETH rail ("instead of"): REJECTED, three reasons.**
(1) The tokenomics-v2 severance means a fresh player holds ZERO $OMR by construction — $OMR-only
is ETH-with-extra-steps (buy at the bond/desk, then mint). (2) Worse, it couples ONBOARDING
AVAILABILITY to token supply: bonds are throttled by THE DAILY OFFERING and the desk sells only
what the sinks returned — a mint rush exhausts the day and NEW PLAYERS ARE LOCKED OUT OF IDENTITY
until tomorrow, an onboarding stall the growth work exists to prevent. (3) The ETH mint is
declared revenue in the money router, and the launch funnel bonus is priced against it.

**Shape C — dual-rail + ERA REPRICING, by hand: RECOMMENDED.** The DAILY OFFERING's own
GM-control precedent applied to the mint price: the founder raises the price at growth milestones
— **both rails in lockstep** (`mintFee` is owner-settable on-chain; `PLEX_MINT_OMR` is env; the
preflight guard warns on any desync) — announced factually as a repricing, never as an automatic
curve. Every raise runs TWO checks before it ships: the implied-rate guard, and **the free-path
check** — the $OMR price stays ≤ what the mission ladder pays lifetime, or the "get made for
free" promise, the coach rung, and both codices change in the SAME commit (the pad-legibility
rule: the game never withholds its own terms). What this keeps of the founder's instinct:
early-cheaper-than-late is real (the price ratchets up over eras), urgency is real (a raise can be
announced AFTER it happens, factually), and A4 survives with a soft amendment — fixed at any given
moment, repriced by ordinary product decision, never supply-indexed, never marketed as
appreciation. (Precedent: the founder already considered 0.01 → 0.025 once, 2026-08-01, and held —
the lever was always there; this names the discipline for using it.)

### The demand engine is already the rail, not the curve

The founder's underlying goal — token demand that scales with adoption — is delivered by the $OMR
rail ITSELF: every PLEX mint pulls the price out of a player's balance and hands it to the desk,
so demand scales LINEARLY WITH HEADCOUNT with no escalation needed. If the $OMR rail should be
chosen MORE often, the honest lever is the PREMIUM (`PLEX_PREMIUM_BPS` 1.2 — lower it toward 1.0
and the earned path gets relatively cheaper), not a curve. And if minting should pull HARDER per
head, raise the price on both rails through Shape C's discipline.

### The burn-vs-recycle flag (a founder lever, one line either way)

The proposal says "burned." Today a PLEX mint RECYCLES to the desk — house revenue, per the
founder's own v3 decision ("you cannot burn AND recycle the same unit; the founder chose
revenue"). A TRUE burn for identity mints is a one-line exclusion (the `withdraw:omr` shape) and
buys deflationary optics for the collection at the cost of desk revenue on every $OMR mint —
recorded as a lever, recommendation: keep the recycle (the v3 argument is unchanged: revenue ≈
sink volume × price, and the mint is about to become the single highest-volume sink the game has).

### What adopting Shape C changes (and what it does not)

No code today (both rails are live; the repricing discipline is process + two existing guards).
A4 gains the soft fact-pattern amendment. Nothing else moves: the Sybil bound stays the mint
price on whichever rail is cheaper (the guard keeps them equal), the provenance stamp keys on
token issuance regardless of rail, and §10.4 is untouched (the ETH rail was always out-of-band;
the $OMR rail rides the existing `plex:%` vocabulary).

### Shape D — THE TRANCHE SCHEDULE (founder-directed refinement 2026-08-10: "first 1000 mints are
.01 ETH or x OMR … next 2000 are .02 ETH and 2x OMR and so and so")

The founder's refinement of Shape A: not a continuous curve — **discrete, pre-published price
tranches indexed to cumulative mints, both rails moving together**. This is materially better
than the rejected curve on every axis, and the founder's own example already obeys the lockstep
law (0.01→30 and 0.02→60 both imply 3,000 $OMR/ETH — the exact rate the preflight guard pins). It
is designed here as the ADOPTABLE shape, with the one honest cost stated up front: **adopting it
re-opens A4** (the row's fixed-price predicate becomes a published-schedule predicate — the
memo carries the proposed amendment and the re-drafted counsel question).

**The mechanics — Shape C's machinery executing a published schedule (zero new code):**
- The schedule is a PUBLISHED TABLE (a founder lever): `[{through: 1000, eth: 0.01, omr: 5},
  {through: 3000, eth: 0.02, omr: 10}, …]` — cumulative-mint thresholds, both prices per row.
- **One implied rate per row, every row** — the lockstep law as a table constraint: each row's
  `omr/eth` must equal every other row's (the preflight guard extends per-row when the table
  becomes a constant; today it already checks the live pair).
- Execution at each boundary is exactly Shape C: one Safe `setFees` transaction (the setter is
  live, `onlyOwner`) + the two env values — **`plexQuote` already scales the $OMR rail off
  `MINT_FEE_ETH` automatically** (feeEth × oracle × premium), so only the floor moves by hand.
  No contract change, NO audit-clock reset — the schedule is a COMMITMENT, the existing lever is
  the mechanism. The admin surface gains a tier-progress line (minted count vs the current
  threshold) so the GM sees a boundary coming.
- **Boundary semantics are already safe**: `payMintFee` requires the EXACT fee, so a player who
  loaded the page at 0.01 and submits after the raise gets a clean revert (no overpay, no
  underpay) — a rare, annoying, harmless edge. Nothing at a boundary can be gamed; the worst
  case is a reverted transaction and a refreshed quote.
- The launch funnel bonus's sizing rule now references **the current tier's** mint cost (the
  bonus stays strictly below the marginal cost net of the base drop — at every tier).

**The progression decides the free-path crossing — measured, both readings of the example:**
the mission ladder's lifetime earnable is 220 $OMR (test-pinned). **LINEAR** (tier k = k×0.01 /
k×5, tranche sizes growing 1000, 2000, 3000…): the $OMR rail crosses 220 at tier 45 —
**~990,000 identities in**, effectively never at any plausible scale. **DOUBLING** (0.01, 0.02,
0.04… / 5, 10, 20…, tranches 1000, 2000, 4000…): crosses 220 at tier 7 — **~63,000 identities
in**, genuinely reachable for a successful game. **Recommendation: LINEAR** — it keeps the free
path alive to ~1M identities, delivers the early-bird effect exactly where it matters (the first
few tranches), and rises gently enough that the growth headwind stays negligible. Either way,
**the free-path law binds the schedule's tail**: the published table must either cap the $OMR
rail below the earnable ceiling, or the release that crosses it changes the "get made for free"
promise, the coach rung, and both codices in the SAME commit.

**The copy rules, with more force than Shape C** (a published forward schedule is what converts
"repricing" into "promised escalation" — this is the entire legal delta): the frame is
**founding-era pricing** (an ordinary early-bird discount — concert tickets, presale software),
never investment language. The mint page shows the CURRENT price and may state the published
schedule as a fact sheet; it never shows a **countdown or "N remaining at this price" counter**
(a pressure mechanic that reads as scarcity marketing); the banned lexicon
(rare/limited/exclusive/floor/value/"only N will ever") applies verbatim. What may never be
said, in any channel: that earlier mints are worth more because later ones cost more.

**The defensibility ladder, honestly:** discretionary era repricing (Shape C — A4 intact) <
**published tranche schedule, early-bird framed (Shape D — A4 re-opens, defensible with the copy
discipline above)** < continuous auto-curve (Shape A — rejected, stays rejected). Shape D's
residual that no copy rule removes: the schedule itself tells buyers the price will rise, on a
tradeable asset — that is why the row goes back to counsel rather than being self-certified.

**THE MINT IS ETH ONLY (founder-directed 2026-08-10: "Make the mint ETH only no OMR").** This
supersedes the two-rail framing that the whole of §10 above reasons about — the rail-interaction law,
the lockstep requirement, the "effective price is the cheaper rail" analysis. All of it was correct,
and the conclusion it kept pointing at is that the surest way to keep two rails in agreement about
the Sybil bound is for the bound to have ONE. The identity now has a single price, in ETH, at the
published wave. `MINT_TRANCHES` has no `omr` column; `payPlex` refuses a mint; `PLEX_MINT_OMR` is
deleted rather than zeroed; `plex:mint` stays in the §10.4 vocabulary and burn term forever (real
rows exist) with a freshness check asserting nothing new uses it. **Respawn stays on PLEX** — a
repeatable consumable is not the bound, so "pay your rent in ISK" applies to it cleanly. And the free
path is untouched, because it never ran through this rail: the mission GRANTS a mint credit, which at
the honest genesis rate is the only way it could have worked anyway (~2,471 $OMR for a wave-1 mint
against ~220 lifetime earnable).

**ADOPTED 2026-08-10 (founder: "let's do your recommendation" — the LINEAR progression), then
REVISED the same day to FIVE WAVES WITH A HARD CEILING** (founder: *"cap it at 5 waves so by wave 5
the maximum mint price anyone can pay would be .05"*). The published table is **`MINT_TRANCHES`**
in the code — five rows, waves of 1,000 / 10,000 / 25,000 / 50,000 / 100,000 at
0.010 / 0.025 / 0.035 / 0.045 / 0.050 ETH (ETH only — no $OMR column), cumulative 186,000,
whole-array test-pinned — with `mintTierOf` as the one reader and the flat tail holding **0.05
forever** beyond it.

**The ceiling settles the progression question the LINEAR-vs-doubling analysis above was trying to
answer, and settles it better than either.** That analysis picked LINEAR because doubling crossed
the free-path ceiling at a reachable ~63k identities while linear crossed it at an unreachable
~990k — but both answers were *arithmetic about where a rising price eventually breaks the promise*.
A cap removes the crossing from the shape: the dearest row is 150 $OMR against ~220 earnable and
**no future row can ever exceed it**, so the free path is guaranteed structurally rather than
re-derived at each extension. It also reverses the growth headwind that counted against Shape A —
the waves widen while the increments shrink, so past the first thousand the schedule is cheaper
than the ladder it replaces at every point (#5,000 pays 0.025 against 0.03; #20,000 pays 0.035
against 0.06).

Waves 3 and 4 are the only edit to the founder's figures: 0.0333 and 0.0444 do not land whole on
the $OMR rail at 3,000 $OMR/ETH (99.9 and 133.2), and a fractional PLEX floor matters because the
rail is set by hand at each boundary — a GM typing the round number would trip the off-schedule
warning over a 0.1% rounding. 0.035 / 0.045 are the nearest pair whole on both rails (+5.1%,
+1.4%); restoring the exact figures is the `eth` column plus `omr` 99.9 / 133.2.

Built with it: the preflight off-schedule warning (a rate-clean pair the table never promised —
0.015/7.5 — is caught at boot), the admin chain panel's tier-progress line with an OFF-SCHEDULE
flag (the GM's instrument for executing a boundary), and the row-level laws pinned in
`test/made.js` beside the free-path computation they depend on: one implied rate per row, the
free-path law (dearest 150 vs ~220 earnable), and **the ceiling itself** — the last row IS 0.05, no
row exceeds it, and the millionth identity still pays it, so raising the cap fails by name as a new
promise rather than passing as a retune. A4 is RE-OPENED in the memo with the amended fact pattern,
and the cap **strengthens** that position: the hardest form of the A4 question is whether a forward
schedule promises indefinitely-rising prices, and a published ceiling answers it in the pattern
itself. The LIVE price today is wave 1 — nothing changes at the till until the 1,001st identity.
