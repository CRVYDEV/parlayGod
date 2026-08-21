# CHAIN-AUDIT-PACKET — what goes to the third-party reviewer, and what to attack

**This is gate 2 of the three in `CHAIN-DEPLOY.md` §0.** Gate 1 (`forge test`) is green and gate 3
(the launch review) is signed; this is the one that is outstanding, and it is the one that cannot be
patched after the fact, because a contract is immutable the moment it is deployed.

**Read this beside `CHAIN-DEPLOY.md`, never instead of it.** That document is the operational
runbook — the deploy order, the arm order, the env, the kill switches. This one is the SCOPE and the
ATTACK SURFACE: what is in the batch, what each contract's walls actually claim, what has already
been proven and by what, and — the part worth an auditor's time — the properties that are load-bearing
and are NOT proven by anything we can run ourselves.

Every figure below was measured on **2026-08-21** against the tree. `test/docs.js` fails the build if
the batch enumeration drifts from the `.sol` files, or if any launch-gating doc calls an existing
contract unwritten — that guard exists because this document's predecessor did exactly that, and an
auditor told a contract does not exist does not attack it.

---

## 1. THE SCOPE — 17 contracts + 1 interface, one engagement

*"Batch, not dribble"* (`omerta-dynasty-machine-design.md`): the scope must be KNOWN before it is
sent, because a contract added afterwards means paying to re-audit. The set below is complete —
`omerta-contracts/src` holds exactly these 18 files and nothing else.

| # | contract | what it is | its tests |
|---|---|---|---|
| 1 | `OMR` | the token. Fixed genesis supply + a single owner-set `minter`; a four-way sell tax on transfers into registered AMM pairs, armed at zero | `Omerta.t.sol`, `OMRTax.t.sol` |
| 2 | `VoucherClaim` | the $OMR withdrawal bridge. EIP-712, nonce-replay-proof, deadline-bound, daily-capped, pausable, tranche-funded | `Omerta.t.sol` |
| 3 | `GearVault` | ERC-1155 gear. Mint gated to `VoucherClaim`, per-`gearId` supply cap, fail-closed at 0 | `GearVault.t.sol` |
| 4 | `OMRStaking` | pre-funded reward pool, APY ceiling, principal always withdrawable | `Omerta.t.sol` |
| 5 | `OmertaFees` | the inbound ETH tollbooth. Exact-fee, forwards in-tx, custodies nothing, monotonic nonce; carries `payForPackage` (the on-chain Store leg) | `Omerta.t.sol` |
| 6 | `OmertaBond` | **the only mint.** Server-signed `BondQuote`, four walls (below), four-way ETH split forwarded in-tx, linear vesting | `OmertaBond.t.sol` |
| 7 | `OmrTwapOracle` | the accretion oracle the bond's wall 4 reads. Permissionless `update()`, bounded window, fail-closed | `OmrTwapOracle.t.sol` |
| 8 | `GenesisOracle` | a fixed-price `IOmrOracle` for the launch window, swapped out for the TWAP at pool init | `GenesisOracle.t.sol` |
| 9 | `IOmrOracle` | the interface both oracles implement — **the interface, not a contract** | (implementations' tests) |
| 10 | `OmertaHook` | the Uniswap v4 hook. Sell tax taken in the quote currency inside the swap, anti-snipe window, impact surge, permissionless sweep | `OmertaHook.t.sol` |
| 11 | `StreetDeed` | ERC-721 street deeds. Self-verifying EIP-712 mint, `tokenId = keccak(name)`, never-pausable `redeem`, default-ON transfer lock | `StreetDeed.t.sol` |
| 12 | `DynastyNFT` | ERC-721 identity. Self-verifying EIP-712 mint, no owner mint, EIP-2981 royalty — **and gates NOTHING on `balanceOf`** | `DynastyNFT.t.sol` |
| 13 | `StockVault` | the stock distributor. **Never mints** — every `deliver` is a pre-held `SafeERC20.transfer`; keeper-only, idempotent, per-token daily cap | `StockVault.t.sol` |
| 14 | `Alchemist` | THE BANK — the nUSD/DNR collateral market | `Bank.t.sol` |
| 15 | `Transmuter` | THE BANK — the redemption side | `Bank.t.sol` |
| 16 | `Denari` | THE BANK — the DNR debt token | `Bank.t.sol` |
| 17 | `CollateralEscrow` | THE BANK — collateral custody | `Bank.t.sol` |
| 18 | `FlashGuard` | THE BANK — the flash-loan guard | `FlashGuard.t.sol` |

**305 Foundry tests across 12 suites, green** (measured 2026-08-21, `forge test`), including two
512-run fuzzes: OMR sell-tax conservation and the bond's anti-Ponzi tranche invariant.

**Deliberately NOT in the batch, and each for a reason:**
- **ERC-6551** (`test/vendor/ERC6551Registry.sol`, `ERC6551Account.sol`) — the reference
  implementation, **vendored unmodified from npm and never imported by `src/`**. It is deploy config,
  not our code. It is in the tree only so the provers can stand a real registry up.
- **A merkle distributor** — there is none. The airdrop's delivery decision (D1) is in-game SIWE
  credit, so no distributor contract exists to review.
- **The off-chain EIP-712 signer** — in scope for gate 2 but not a contract; see §5.

---

## 2. THE WALLS — what each one CLAIMS, so a reviewer can attack the claim rather than the code

### 2.1 The mint: four walls, and the claim is that 3 and 4 COMPOSE rather than substitute
Tokenomics v2 step 4 **deleted the property every prior review of this suite rested on** — "nothing
mints" — and replaced it with walls. That is the freshest reason this gate exists.

1. **`OMR.mint` is callable only by a single `minter`**, owner-set, evented, shipping UNSET. There is
   deliberately **no owner mint**, so "the Safe was compromised" and "supply was inflated" stay two
   separate events, and `setMinter(0)` is a one-transaction emergency stop needing no pause.
2. **`OmertaBond.dailyCapOMR`** — with no tranche bounding the total, this is the ENTIRE blast radius
   of a leaked quote-signer. **`0` means UNLIMITED**, so a deploy that forgets it has no wall; it is a
   constructor argument for that reason.
3. **`MAX_DISCOUNT_BPS` (2000, compile-time)** — a discount is a mint at a price.
4. **`maxOmrPerEth`** — the post-discount mint-RATE ceiling, **fail-closed at 0**.

> **The deviation an auditor should be pointed at directly.** The design's "accretive-only" wall, read
> literally, forbids *every discounted bond* — a discount is by definition issuing OMR worth more than
> the ETH paid. The real (Olympus) meaning is treasury-BACKING accretion, which needs reserves ÷ supply
> and is unknowable in a contract that custodies nothing and forwards every wei in-tx; an oracle on the
> mint path would make a feed the thing standing between a leaked key and unbounded supply. **So wall 3
> is a hard Safe-set rate ceiling: weaker as economics, stronger as a wall.** It is documented in-contract
> as a deliberate deviation. Backing accretion lives in the off-chain policy that decides what price to
> sign, where it can read the whole treasury.

**Sizing (`tools/bond-dials.js`, and the finding is counter-intuitive):** the daily cap should be sized
on **price impact, not dilution** — impact is a function of POOL DEPTH, so the rule is ≈5% of the pool's
OMR reserve, re-derived whenever POL deepens; a "% of supply" figure was ~4× too loose. And the attack
goes loss-making at larger caps, which is **not** a reason to relax it: a griefer needs no profit, and
anyone short elsewhere profits from the crash. **Size on damage, never on attacker P&L.**

**There is no MINIMUM vest, and that is deliberate** — `claim()` is not `whenNotPaused`, so a vest is
never a window in which the Safe can intervene, only one in which an attacker waits. Vesting here is a
product feature, not a security control, and the point of writing that down is that nobody counts it as one.

### 2.2 The oracle: fail-closed on four failure modes, and bounded on BOTH sides
`update()` is permissionless on purpose (a keeper-gated poke means a lost key freezes the product) —
which means **whoever pokes chooses when the window closes**. An interval longer than
`PERIOD × MAX_WINDOW_MULT` is therefore **DISCARDED, not averaged**: it re-baselines, `consult()`
reports no usable reading, the bond reverts, and `Rebaselined` is emitted so an outage is visible.
Without that bound a nine-day keeper outage spanning a spike-and-crash reported **19,998.84 against a
5,000 spot, stamped fresh**, invisible to a staleness check that measures when the average was COMPUTED
rather than what period it COVERS.

### 2.3 The v4 hook: three claims worth attacking directly
`OmertaHook` is a different mechanism at a different layer from the ERC-20 tax — **do not treat it as a
variant** (the ERC-20 path survives armed at zero as its backstop). Its claims:

- **(a) `beforeInitialize`'s pool gate is what makes `SellTaxTaken` unforgeable.** A hook address is part
  of a `PoolKey`, so ANYONE can create a pool naming this hook — then swap against themselves in an
  (OMR, WORTHLESS) pool and emit a genuine event with a genuine tx hash, i.e. **fabricated revenue wearing
  the exact credential the backend's anti-fabrication gate trusts.** Without the gate the whole event
  stream is forgeable by a stranger for the price of gas.
- **(b) The fee ACCRUES and is swept separately, never forwarded in-tx.** Three pushes inside a swap means
  one reverting recipient **bricks the pool**. Pool liveness must not depend on a wallet's behaviour, so
  `sweep` is permissionless and pays only Safe-set recipients — with a zero-address guard at BOTH the
  setter and the sweep, because `currency.transfer` to `address(0)` BURNS (reproduced: 4.75 ETH
  irrecoverable, from a hook armed in the ordinary order with nobody doing anything wrong).
- **(c) There is deliberately NO pause.** A hook that can revert `beforeSwap` can halt a public market.
  The only lever is the rate, and zero stops the fee rather than the pool.

Also stated rather than hidden: **exact-OUTPUT sells are taxed in OMR, not the quote** — `afterSwap` can
only take a delta on the *unspecified* currency, which is the output for exact-input (all router volume)
and the input for exact-output. That path is at PARITY with the tax it replaces, not a bypass. MEV around
a fee-taking hook is worth an explicit look.

**One operating rule spans two immutable contracts and nothing else relates them:** `DISCOUNT_BPS` must
stay strictly under `sellTaxBps`, or a bond stops being capital formation and becomes a subsidy on
selling. At 800/900 an immediate flip returns `1.08 × 0.91 = 0.983` and loses money. A bonder holds known
size on a known schedule and is the most motivated bypass-seeker this token will have. Asserted in Foundry
on the contract side and as a preflight WARNING on the backend side.

**`MAX_SELL_TAX_BPS` is a ceiling PER LAYER**, and `OMR`/`OmertaHook` cannot see each other — so a seller
pays the SUM. The rule is **one venue, one layer**; coupling two immutable contracts would be worse than
the problem.

### 2.4 The NFTs: the split that makes them safe to trade
- **`DynastyNFT` gates NOTHING on `balanceOf`.** The game entitlement (`minted`) is account-bound
  OFF-CHAIN, so the token is a freely transferable trophy carrying no on-chain power. If a transferable
  token carried the entitlement, the real per-identity cost would stop being the mint price and become
  the **secondary floor** — whose cheap end is by construction *the dead alts of the last farm*.
- **`StreetDeed`**: `tokenId = uint256(keccak256(bytes(name)))` is a name↔id bijection enforced on-chain
  (`_safeMint` reverts on an existing id), so a name mints at most once and a burn frees the same id for
  re-extraction. **`redeem` is NEVER pausable** — a paused contract must never trap a holder's asset.
  The **default-ON `transferLocked`** re-locks on every transfer arrival and only the OWNER may unlock
  (an approved marketplace operator deliberately cannot, because operator-unlock IS the drain vector).
  Residual, stated: the lock forces the drain BEFORE the unlock; it cannot stop an owner draining then
  unlocking, which no on-chain rule can.

### 2.5 `StockVault`: the wall is physical, and the address is the only thing between the treasury and a loss
It **never mints** — every delivery is a pre-held transfer, so `balanceOf(this)` per token is the
PHYSICAL half of `allocated ≤ held` and the ERC-20 reverts on over-delivery. Keeper-only, idempotent on
`deliveryId`, per-token daily cap (**`defaultDailyCap` exists because the ticker set GROWS** — a mapping
default of 0 = unlimited made a freshly-added stock the one a leaked keeper could drain in a block).

**The founder's §3.3 decision is GATELESS PUSH**: units land straight in the deed's ERC-6551 account with
no claim step and no on-chain eligibility gate. The four arguments made against it and rejected are
recorded in `omerta-brokers-design.md`. It is in the NatSpec **so the audit sees a decision, not an
omission** — and it is why the ADDRESS is load-bearing: a wrong one is invisible to every wall, because
they are denominated in UNITS and *who received them is not a quantity*.

### 2.6 Ownership, pausing and the shared key
- **Every ownable contract is two-step** (`test/docs.js` fails a sixteenth that ships single-step).
  Renouncing deliberately stays one step, so OMR's "renounce to freeze the configuration forever" survives.
- **The pause matrix**: every pausable contract exempts its EXIT (`StreetDeed.redeem`, `OmertaBond.claim`,
  `VoucherClaim`'s reclaim sweep, `StockVault.sweep` Safe-only), so **none can be paused into a state where
  value is unreachable by anybody.**
- **ONE `VOUCHER_SIGNER_PK` signs FOUR contracts** (`VoucherClaim`, `OmertaBond`, `StreetDeed`,
  `DynastyNFT`), each storing its own `signer` and each with an independent nonce space and a distinct
  EIP-712 domain. **Its blast radius is the SUM of four daily caps.** The rotation runbook is
  CHAIN-DEPLOY §8 (pause four → `setSigner` four → rotate → unpause), and every one of the four takes its
  cap as a **constructor argument** so the wall cannot be a deploy-checklist line somebody skips.

---

## 3. WHAT IS ALREADY PROVEN, AND BY WHAT — the four provers

An auditor's time is best spent where nothing we can run reaches. These four are what we can.

| prover | what it stands up | what it PROVES |
|---|---|---|
| `forge test` | the Foundry VM | 305 tests / 12 suites, incl. two 512-run fuzzes. Unit + property behaviour of every contract |
| `npm run chain-e2e` | a real EVM (ganache/anvil), the REAL backend booted against it | 27 asserted steps: deploy → SIWE link → a real on-chain fee → the watcher crediting it → mint → **a real EIP-712 voucher claimed for 25 real ERC-20 OMR** → replay REVERTS → tampered voucher REVERTS → the watcher closing the reserve exact → a gear voucher minting the ERC-1155 → an UNCAPPED gearId failing closed even with a valid signature |
| `npm run dexbot-e2e` | a **real Uniswap v4** — real `PoolManager`, real liquidity, real swaps, behind the real `OmertaHook` at a mined permission address | 23 asserted steps with both bots' senders **UNSEAMED**, so `src/dexbot.js`'s own encoders build the calldata that executes. This is what closed the ⚠ on the raw v4 encodings |
| `npm run stock-e2e` | the real ERC-6551 registry (vendored reference impl) + StreetDeed + StockVault | 14 asserted steps: a deed minted from a server-signed voucher, **the backend's computed TBA equal to the registry's own answer**, units landing in it, the keeper sending but never settling, the `Delivered` log flipping the allocation |

**The residual is the same shape for all three e2e provers and is stated rather than smoothed over:
each prover CONFIGURES the thing it then checks against.** So a wrong `DEX_POOL_FEE` /
`DEX_POOL_TICK_SPACING`, or a wrong `ERC6551_REGISTRY` / `_ACCOUNT_IMPL` / `_SALT`, is a **config error
no prover can see**. Resolve one real deed's TBA against the live registry by hand, and do one small live
swap and pairing, before the first real value moves.

**A second residual worth naming:** `forge test` here runs against a solc-js shim in a sandbox; the
third-party review should re-run with **native solc**.

---

## 4. WHAT THE BACKEND OWES THE CONTRACTS — the parity surface

Several walls are only as good as an off-chain value that must agree with an on-chain one. These have
their own crossing check (`chainParity`, hourly, alarming through the same channel as a §10.4 drift),
and an auditor should understand that they exist rather than re-deriving them:

- **`OmertaFees.vigBps`** — `MintFeePaid` carries the gross ALONE, so the backend DERIVES the share.
  A divergence directly mis-books the withdrawal reserve's funding source, and **every downstream check
  sums correctly because they all descend from the same restated number.**
- **`OmertaBond`'s four immutable bps** — event-authoritative, so the accounting is safe; a divergence
  moves only the declared waterfall.
- **`OmertaFees.mintFee` / `respawnFee`** — these MOVE at a published tranche boundary, and a stale-cheap
  copy makes $OMR the cheaper rail at a price nobody chose.
- **`VoucherClaim.dailyCapOMR`** — the backend refuses a withdrawal whose NET exceeds it *precisely so it
  never signs a voucher `claim()` will reject forever*; a stale-HIGH copy signs exactly that voucher and
  the player's $OMR is burned and stranded until the reclaim sweep.
- **The sell tax on both layers** — all four slices are DERIVED from levers, so a divergence mis-books the
  treasury's stock budget and the family-buyback inflow at once.

**A same-typed adjacent event-parameter swap is invisible to a type comparison** (`Bonded` has six adjacent
non-indexed `uint256`), so the 14 backend event signatures are crossed against the contracts' declarations
on type, indexed-ness AND positional name (`test/gates.js` THE ABI LEDGER). viem decodes positionally, so a
rename on one side alone yields `undefined` → NaN silently.

---

## 5. THE SIGNER IS IN SCOPE, AND IT IS NOT A CONTRACT

Gate 2 is "a third-party audit of the contracts **AND the signer**". The off-chain half:

- **Four EIP-712 domains, all distinct** (`OmertaVoucherClaim`, `OmertaBond`, `OmertaStreetDeed`,
  `OmertaDynasty`), each with its own `verifyingContract` and nonce space. Parity between the signer and
  each contract is asserted in-suite by **recovering against a HARDCODED domain literal mirroring the
  contract**, never against the same helper the server signs with — that version was vacuous and a
  domain-name mutation survived it.
- **`assertChainId`** compares `CHAIN_ID` to the RPC's real `getChainId()` and refuses to sign on a
  mismatch, in BOTH the API (which signs) and the worker.
- **The full-reserve queue**: a withdrawal signs only if `signedOutstanding + amt ≤ funded_omr`, else it is
  debited-but-unsigned and queued. Extraction ≤ inflow holds by construction.
- **The comp/`txHash` posture ladder** — every real-value ingest refuses to book revenue for a call that
  carries no transaction hash, because fabricated revenue buys real-looking backing and is invisible to
  the very check meant to catch it. Two unbounded-mint holes in the BACKEND keepers were found this way
  on 2026-08-12 (`AUDIT-family-buyback.md`) *after* they shipped with green tests and passing invariants.
  That is precisely the class an external reviewer exists to catch on the contract side, where it cannot
  be patched after the fact.

---

## 6. THE PROPERTIES TO ATTACK — a starting list, not a limit

1. **Can anything mint OMR other than `OmertaBond` calling `OMR.mint` under all four walls?** This is the
   single most load-bearing claim in the suite, and the property it replaced was "nothing mints".
2. **Do walls 3 and 4 COMPOSE?** They are checked independently in `bond()`, so a manipulated oracle should
   only ever TIGHTEN the bound. Confirm that.
3. **Can a stranger's pool emit a credible `SellTaxTaken`?** (`beforeInitialize`, §2.3a.)
4. **Can any configuration halt the canonical pool?** (§2.3c — the claim is no.)
5. **Can a paused contract trap a holder's asset?** (§2.6 — the claim is no, on every one.)
6. **Can `StockVault` deliver to an address the treasury did not intend**, or more units than it holds?
7. **Can a voucher signed for one contract be replayed at another** given one shared signer key?
8. **Can `sweep` (hook) or `sweepETH` (bond) reach value that backs an outstanding obligation?**
9. **`StreetDeed`'s burn→re-mint cycle**: a burned deed's ERC-6551 account still exists and still holds
   whatever was in it. Re-import → in-game sale → re-extract hands the buyer that vault. Flagged, not
   fixed; the in-game market discloses what was DELIVERED (never a balance — the game cannot see what
   remains). Worth a reviewer's view on whether the disclosure is the right answer.
10. **The ERC-6551 address derivation** — the one input no prover can validate (§3).

---

## 7. WHAT IS OUT OF SCOPE FOR THIS GATE

- **Gate 3, the launch review** — a separate thing entirely, and cleared. Do not conflate them.
- **The economics** — every lever is a founder sign-off item recorded in `BALANCE.md`; a reviewer is
  welcome to comment, but a "the APY is too high" finding is not what blocks mainnet here.
- **The in-game §10.4 conservation set** — audited continuously by `invariants.js` and a nightly sweep,
  and structurally separate: the chain layer writes ZERO `transactions` rows.

**Mainnet is blocked on 1 + 2 + 3. Nothing on the deploy checklist should be armed until this clears.**
