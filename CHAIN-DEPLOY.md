# OMERTÀ — chain go-live runbook (the on-chain rail)

The mainnet-prep sequence for the §11 chain layer — the counterpart to `DEPLOY.md` (which covers the
off-chain game). The chain layer is **dormant by default**: the backend runs the full game with ZERO chain
config, and each on-chain rail activates only when its env vars are set. This runbook is how you deploy the
contracts, hand them to the Safe, fund the reserves, and switch the rails on — **after** the three hard gates
below clear.

Everything here is REHEARSABLE on a devnet/testnet today (that's what `tools/chain-e2e.js` does). **Nothing
touches mainnet** until §0 is satisfied.

---

## 0. The three HARD GATES (no mainnet step proceeds until all three are green)

1. **`forge test` passes on a real Foundry toolchain. ✅ EXECUTED 2026-07-23 — 73/73 PASS; 128/128 after
   the v4 sell-tax hook** (incl. five 512-run fuzzes: OMR sell-tax conservation, the OmertaBond
   anti-Ponzi bound, the four-wall mint-rate bound, TWAP decode overflow, and the hook's fee-split
   dust) via the official
   npm-distributed forge 1.7.1 in the sandbox (`cd omerta-contracts && ./run-forge-test-sandboxed.sh`
   — forge-std/OZ from npm, solc via a solc-js 0.8.26 stdio shim: the emscripten build of the SAME
   compiler version+commit as native). The run surfaced and fixed a latent test-harness class (inline
   `_sign(...)` staticcalls consuming `vm.prank`/`vm.expectRevert` in OmertaBond.t.sol — 14 tests +
   one silently false-passing fuzz, all now genuinely exercising the contract). BELT-AND-BRACES: the
   third-party audit should re-run `./run-forge-test.sh` on an open-internet machine with NATIVE solc
   as part of its own verification — but the Foundry-VM gate itself is now green. NOTE: NATIVE solc is
   no longer only belt-and-braces. The hook's suite deploys a real v4 `PoolManager` and the emscripten
   compiler runs out of heap on it, so a shim-only box silently runs every suite EXCEPT that one.
2. **A third-party audit of the CONTRACTS *and* the off-chain EIP-712 signer.** The signer (`src/chain.js`) is
   as security-critical as the contracts — it mints withdrawal authority. Audit both.
   ⚠ **The audit clock was RESET by tokenomics v2 step 4 (2026-07-29).** Until then OMR had no mint
   function and "nothing mints" was the property every prior review of this suite rested on. Supply is now
   unbounded and bonds mint it. Any auditor must be pointed at that specifically, and at the FOUR walls
   that replaced the fixed cap: `OMR.minter` (one path, no owner mint) plus OmertaBond's `dailyCapOMR`,
   `MAX_DISCOUNT_BPS`, `maxOmrPerEth` and the `oracle`. **The single most important property to review is
   the COMPOSITION of walls 3 and 4** — a price feed sits on the mint path, and what makes that safe is
   that `maxOmrPerEth` is checked independently, so a manipulated oracle can only ever TIGHTEN the ceiling,
   never raise it. Also review `OmrTwapOracle` (a Uniswap V2 cumulative-price TWAP) and the keeper
   dependency it creates.
   ⚠ **The gate also WIDENED with `OmertaHook.sol` (economy v3 step 6).** v4 hook auditing is its own
   specialty with its own attack surface, and this one holds three claims worth attacking directly:
   (a) `beforeInitialize`'s pool gate is what makes `SellTaxTaken` unforgeable — anyone can create a
   pool naming a hook, so without it a stranger emits real-looking revenue events from a worthless
   pool; (b) the fee is taken as an `afterSwap` delta on the *unspecified* currency and then `take`n,
   with the accrual written before the interaction; (c) the contract deliberately has NO pause, so the
   claim is that no configuration can halt the pool. MEV around a fee-taking hook is worth an explicit
   look. **Do not treat the hook as a variant of the ERC-20 tax** — it is a different mechanism at a
   different layer, and the ERC-20 path survives armed at zero as its backstop.

   ### THE BATCH — what goes out, and why it is drawn here
   **The packet itself is `CHAIN-AUDIT-PACKET.md`** — the enumerated scope, what each wall CLAIMS,
   what the four provers already prove against what stays config-only, and the properties an auditor
   should attack. Send that; this section is the summary of it.
   *"Batch, not dribble" (`omerta-dynasty-machine-design.md`) means the scope must be KNOWN before it
   is sent. Enumerated 2026-08-11; `forge test` **305/305** green on this exact set, measured 2026-08-21
   (StreetDeed added 2026-08-14; `DynastyNFT` + `StockVault` + `OmertaFees.payForPackage` added
   2026-08-14; the count has since grown with the red-team regressions — RT#5's constructor daily
   caps, RT#8's two-step ownership, the four-way sell tax — so re-measure rather than quoting this
   figure, and if the two disagree the tree is right and this line is stale.)*

   **In the batch — 17 contracts + 1 interface, every one carrying tests:**

   | subsystem | contracts | the thing to attack |
   |---|---|---|
   | the $OMR rail | `OMR`, `VoucherClaim`, `GearVault`, `OMRStaking`, `OmertaFees` | the mint path (rule 2) and the two supply caps that survive a minter swap; **plus `OmertaFees.payForPackage`** — the on-chain Store leg: fail-closed on an unpriced sku, exact-value, forwards dev/Vig, custodies nothing |
   | issuance | `OmertaBond`, `OmrTwapOracle`, `GenesisOracle`, `IOmrOracle` | the four walls, and specifically that 3 and 4 COMPOSE rather than substitute |
   | the market | `OmertaHook` | the pool gate, the `afterSwap` delta, the absence of a pause |
   | THE BANK | `Denari` (the DNR debt token, né `nUSD`), `CollateralEscrow`, `Alchemist`, `Transmuter`, `FlashGuard` | that no oracle sits on the borrow path and no `liquidate()` exists anywhere — the design's central claim, and the class that cost Inverse ~$21M twice |
   | Street Deeds | `StreetDeed` | the EIP-712 self-mint (name↔tokenId bijection, the daily cap, replay/deadline; NO owner mint), that `redeem` (the burn-to-re-import) is never pausable so a paused contract can never trap a holder's asset, and the **default-ON per-token transfer lock** (added 2026-08-14, the drain-before-sale mitigation): mint locks, every transfer arrival RE-LOCKS, only the OWNER may unlock (an approved operator deliberately cannot — operator-unlock IS the drain vector), `redeem` is never blocked by it, and the unlock emits `TransferLockSet` — the public "listing" act a buyer anchors TBA-content checks on |
   | the identity NFT | `DynastyNFT` | the EIP-712 self-mint (NO owner mint, nonce/deadline/daily-cap walls), that it gates **NOTHING on `balanceOf`** (the entitlement is account-bound off-chain — the token is a transferable trophy), and the uncapped sequential supply + EIP-2981 royalty |
   | the stock delivery | `StockVault` | that it **NEVER mints** (pre-held transfer only — the physical half of `allocated ≤ held`), the keeper-only gateless push (no on-chain eligibility, a DELIBERATE §3.3 decision), and the leaked-keeper bounds (per-token daily cap, pause, `setKeeper`, `sweep`) |

   **NOW IN THE BATCH (added 2026-08-14, founder-directed).** `DynastyNFT`, `StockVault` and
   `OmertaFees.payForPackage` were previously held out; the founder cleared every design choice and lifted
   the launch-schedule constraint ("we will launch when I feel we are complete"), which removed each hold:
   - **`DynastyNFT`** — the tranche-schedule question that its "uncapped + escalating pricing" hinged on
     is settled (the published five-wave schedule with a hard 0.05-ETH ceiling; the mint fee lives in
     `OmertaFees`, not this contract, so it carries no pricing constant to audit).
   - **`StockVault`** — the founder chose the **GATELESS PUSH** (§3.3): there is no claim rail and no
     on-chain eligibility gate, so the claim-rail parameters it was gated on no longer exist. The
     accepted risk (Robinhood's tokenized stocks are EU-restricted; a gateless push has no on-chain
     control over who receives them) is documented in the contract NatSpec so the audit sees a decision.
   - **`ERC-6551` account contract** — NOT written and correctly so: the canonical registry singleton
     (`0x000000006551c19487814612e58FE06813775758`) + the ecosystem reference account implementation are
     used unmodified (deploy config, not a fork). Nothing to audit here beyond wiring.
   - **`MerkleDistributor`** — still NOT written, and still correctly so: launch **D1** resolved to
     variant (b) (in-game SIWE credit), which needs no contract at all.

   **`GenesisOracle` was written specifically so it would not become a straggler** — it is launch-blocking
   (the genesis window bonds before the pool its TWAP would read exists), carries no launch gate at all,
   and was the one contract the launch plan needed that nobody had enumerated. With the two NFTs and the
   Store leg now in, the batch is the WHOLE on-chain surface — a single engagement, which is what the
   "batch, not dribble" discipline asks for.
3. **Launch review sign-off** on the Risk-to-Earn line (see the "Sensitive design notes" in `CLAUDE.md`).
   **✅ CLEARED 2026-08-12; scope WIDENED to the whole checklist 2026-08-13** — the founder reports
   the tokenomics are approved and the on-chain details; on 2026-08-13 the founder further stated the
   outside review cleared the ENTIRE launch checklist (every value-moving surface — the stock buys,
   the TBA drops, the claim rail, THE BANK's four — not only the $OMR side first recorded here).
   Recorded as the founder's statements, which is what closes this gate.
   **This gate does NOT unlock mainnet on its own, and the distinction is worth keeping
   sharp: gate 2 is a SECURITY review — a different thing entirely.** It is also the gate with the freshest reason to
   exist — tokenomics v2 step 4 deleted the property every prior contract review rested on ("nothing
   mints") and replaced it with four walls, and on 2026-08-12 two unbounded-mint holes were found in the
   BACKEND keepers (`AUDIT-family-buyback.md`) that had shipped with green tests and passing invariants.
   That is precisely the class an external auditor exists to catch in the contracts, where it cannot be
   patched after the fact. **Nothing on this checklist should be armed until gate 2 also clears.**
   **What this gate covers has moved TWICE, and the current position is the second one.** The stock
   layer was retired 2026-07-31 (`omerta-stock-layer-retirement.md`) and **reinstated 2026-08-10**
   (`omerta-brokers-design.md`, founder decision), so this runbook's earlier reading — that there was
   no stock oracle and no eligibility gate to build — was stale for two days and is corrected here:
   **buying, holding and eventually delivering tokenized stock is back in scope**, and with it the
   claim-rail parameters (the eligibility list + verification depth) that step 7 is gated on.
   **What is live TODAY, corrected 2026-08-21 — this paragraph said `StockVault` was unwritten and it
   has shipped:** the whole rail is BUILT end to end and **chain-DORMANT**. `StockVault.sol` (2026-08-14,
   in the batch above) never mints — every `deliver` is a pre-held `SafeERC20.transfer`, so
   `balanceOf(this)` per token is the PHYSICAL half of the wall — and the off-chain half is complete
   too: `brokers.js:distributeBuy` writes the owed side through the clamped `allocateStock`,
   `stockdeliver.js` stages→confirms against the `Delivered` log, `runStockDeliveryKeeper` is the tx
   sender, and `delivered ≤ allocated` joins `allocated ≤ held` in the nightly sweep. **There is no
   claim route BY DESIGN and that is a decision, not a gap** — the founder chose the gateless PUSH
   (brokers §3.3): units land straight in the Street Deed's ERC-6551 account with no claim step and no
   on-chain eligibility gate, which is precisely why the ADDRESS is the only thing between the treasury
   and a permanent loss and why an auditor should attack it. Nothing moves until
   `STOCK_VAULT_ADDRESS` + `STREET_DEED_ADDRESS` + the ERC-6551 config are set (the watcher) and
   `STOCK_KEEPER_PK` besides (the sender), so **no stock has been delivered to anybody** — but the
   reason is unset env, not unwritten code, and the two are different things to review. The ETH
   VAULT is the same shape one asset over: a player burns earned $OMR for a share of ETH the treasury
   already holds, same asset both sides, allocation-only. The $OMR side and the stock side are
   different questions; as of 2026-08-13 the founder states BOTH are cleared by the outside review
   (still owed regardless: the claim-rail parameters — the eligibility list + verification depth —
   and gate 2). The in-game Portfolio remains a status collectible with no sell and no
   cash-out, using real ticker SYMBOLS for flavour (a flagged, undecided founder question).

Devnet + testnet rehearsal may proceed now. **Mainnet is blocked on 1 + 2 + 3.**

---

## 0.5 RESOLVED — the bond's fourth slice (now the treasury's) leaves on-chain

Found 2026-07-30 while scoping the v4 hook work; **fixed 2026-07-31** before the third-party audit, so
it costs nothing extra (the audit clock was already reset by tokenomics v2 step 4 — changing the
contract AFTER an audit would mean paying to re-audit it).

> **Note (2026-07-31, later the same day):** the founder retired the stock layer and kept the vault,
> backed with ETH. The fourth slice, its bps and this whole fix are unchanged — only the DESTINATION is
> now a treasury Safe rather than a stock-buy bot, and that Safe is what the vault's `allocated ≤ held`
> is measured against (see §7b). The `rwaBps`/`rwaRecipient`/`rwa_eth` names are historical.

**What was wrong.** `OmertaBond` split ETH three ways (`toPol`/`toDev`/`toVig` = remainder) and had no
RWA recipient. The backend booked four. On the on-chain path `recordBond` read an `onchainRwa` the
watcher could not supply, so `rwa_eth` was **0 on every real bond** and the contract's whole 4750 bps
remainder landed as Vig (signed split: 2250 Vig / 2500 RWA). The ETH was not lost — it reached
`vigRecipient` — but the slice that went missing is the one that keeps the stock float growing when DEX
volume is thin, and **neither bond invariant could see it**: check (4) sums because the Vig remainder
absorbs the missing slice exactly, and the mirror check compared 0 to 0.

**The fix, and why this one and not the cheaper one.** The contract now splits FOUR ways —
`rwaBps` + `rwaRecipient`, `Bonded` emits `toRwa`, the watcher reads it, `recordBond` books it. The
cheaper alternative (split the event's `toVig` backend-side) was **ruled out by a founder decision that
the Vig wallet and the stock-buy bot are SEPARATE keys** — the bot trades, so it is hot; the Vig funds
the withdrawal reserve and can be colder. With separate custody, booking the fourth slice's ETH against
the Vig's wallet claims a position the destination does not hold, which is the exact class
`allocated <= held` and the `txHash` gate exist to prevent.

Regressions: `test_the_float_gets_its_own_wallet_not_the_vigs` + `test_four_way_split_leaves_no_dust`
(Foundry), and `test/watcher.js` asserts a real on-chain bond funds BOTH `bond_reserve.rwa_eth` and
`rwa_revenue` (the treasury's inflow ledger). Mutation-verified: drop `onchainRwa` from the watcher
and the suite fails by name.

**Deploy requirement:** `rwaRecipient` MUST be the **treasury Safe's** own address, distinct from
`vigRecipient`. Setting them to the same address re-creates the defect silently — the split would be
correct on-chain and the books would still be right, but the founder's custody separation is gone.
It should be the coldest key in the system: this destination only ever RECEIVES, so it has no reason to
share a key with anything that spends — and it is now the Safe whose balance backs the vault (§7b), which
makes co-mingling it with a spending key strictly worse than before.

## 1. Build + test the contracts
- [ ] `cd omerta-contracts && ./run-forge-test.sh` → all `[PASS]` (Gate 0.1). Suite: OMR, VoucherClaim,
      GearVault, OMRStaking, OmertaFees (incl. `payForPackage`), OmertaBond, OmrTwapOracle, GenesisOracle,
      OmertaHook + THE BANK + StreetDeed + DynastyNFT + StockVault (288 tests, seven fuzzes).
      The hook's tests deploy a REAL Uniswap v4 `PoolManager`, which the emscripten solc cannot compile —
      **use native solc** (`./run-forge-test.sh`, or the sandboxed runner, which now fetches the native
      binary and says so if it cannot).
- [ ] No-Foundry compile path (artifacts for the deployer/e2e): `node tools/compile-contracts.js` → writes
      `omerta-contracts/out-js/` (used by `tools/chain-e2e.js`). Artifacts are gitignored — they must never
      drift from source; recompile before every deploy.

## 2. Deploy order + wiring (Safe-owned from deploy — no hot-deployer window)
Deploy with the deployer key, then immediately hand ownership to the Safe (§3). Mirror `tools/chain-e2e.js`
PHASE 1 for the exact calls/args.
- [ ] **`OMR(treasurySafe)`** — founding supply `100_000_000e18` minted once to the Safe. **No longer a
      fixed-supply token** (tokenomics v2 §4): it has ONE mint path, the `minter` address, which ships
      **unset (= minting off)** and is armed deliberately below. There is no owner mint.
- [ ] **`GearVault(safe, imageBase)`** — ERC-1155; mint gated to VoucherClaim (set in the next step);
      per-tokenId supply caps set by the Safe (set caps BEFORE signing any gear voucher — an uncapped id
      is fail-closed). `imageBase` is the IPFS base for the pinned plates, e.g. `ipfs://<CID>/`, so the
      per-tokenId image resolves to `<imageBase><tokenId>.png` (settable later via `setImageBase`).
      **Metadata is on-chain**: `uri(id)` returns a self-contained JSON data URI whose Type/Class/Rarity
      traits are derived from the tokenId (provable, no per-token storage); only the image is off-chain.
      OPTIONAL but recommended for marketplace readability: `setClassNames(classKeys, names)` gives each
      car/boat/gear class a display name (unset falls back to "Car #<idx>" etc.). A class key is the
      class's BASE tokenId (rarity digit 0). The encoding constants `CAR_BASE`/`BOAT_BASE`/`STRIDE` and
      the rarity names MIRROR `RARITY.TOKEN`/`RARITY.TIERS` in `src/rules.tail.js` — keep them in lockstep.
      **NFT RE-IMPORT (Option A, `omerta-nft-reimport-design.md`)**: GearVault also has `redeem(tokenId,
      amount)` — a holder BURNS an extracted CAR/BOAT back toward the game (gear is one-way, rejected), and
      the backend re-creates the live in-game row. Wire the backend to it by setting **`GEARVAULT_ADDRESS`**
      (this contract's address) on the WORKER so the `Redeemed` watcher (`syncRedeemedEvents` → `reimportItem`
      + the `sweepReimports` retry) runs; dormant until set. The `redeem` burn is new audit surface — it is
      part of THIS deploy's audit batch (rule 2 clock), not a later add. No env is needed on the API for it.
- [ ] **`VoucherClaim(omr, gearVault, signer, safe, dailyCapOMR)`** — the only $OMR bridge. Then
      `gearVault.setMinter(voucherClaim)` so gear mints route through it.
- [ ] **`OMRStaking(omr, safe)`** — pre-funded reward pool; principal always withdrawable.
- [ ] **`OmertaFees(safe, feeRecipient=devWallet, vigRecipient, vigBps=2500, mintFeeWei, respawnFeeWei)`** —
      the ETH tollbooth. It splits each fee ON-CHAIN in one tx: `vigBps` → `vigRecipient`, the remainder →
      `feeRecipient` (dev); it custodies nothing. **`vigBps=2500` is the Path A fee split** (fee vig 2500 —
      down from 6000); it is IMMUTABLE, so set it at deploy and keep it in lockstep with the backend
      `VIG_BPS` in `deploy/fee-splits.env` (the treasury + community slices of the fee are backend earmarks
      carved from the dev remainder — not on-chain). Fees: `MINT = 0.01 ETH` (wave 1 of the published
      `MINT_TRANCHES` schedule — five waves to a capped 0.05; each boundary is ONE owner `setFees` tx,
      watched on `/admin`), `RESPAWN = 0.10 ETH`, `reroll` defaults to `mintFee` (owner-settable).
- [ ] **`OmertaBond(safe, signer, omr, polBps=7500, devBps=1500, rwaBps=500, polRecipient, devRecipient,
      rwaRecipient, vigRecipient, dailyCapOMR, maxOmrPerEth)`** — POL bonding with the four-way ETH split.
      **Path A: 75% POL / 15% dev wallet / 5% treasury / the REMAINDER, 5%, to Vig** (POL-heavy for
      liquidity depth — up from 37.5% POL). All four leave the contract in the same tx; it custodies no
      ETH. **`rwaRecipient` must be the TREASURY Safe's own address, distinct from `vigRecipient`** (founder
      ruling on key separation — §0.5; the `rwa` name is historical, see
      `omerta-stock-layer-retirement.md`). **This contract MINTS** — see below. Keep
      `polBps`/`devBps`/`rwaBps`/`maxDiscountBps` in lockstep with the backend `BONDS.*` in `src/rules.js`
      / `deploy/fee-splits.env`.
      **Operating rule (`omerta-v4-hook-design.md` §9.6): keep `BONDS.DISCOUNT_BPS` strictly BELOW
      `SELL_TAX.BPS`.** At today's 800 vs 900 an immediate bond-and-flip nets `1.08 × 0.91 = 0.983` — a
      ~1.7% loss, which is what makes a bond a hold rather than an arbitrage. Invert the two and every
      bond becomes a subsidised sell. (`MAX_DISCOUNT_BPS` 2000 against a 900 tax would be a +9% guaranteed
      flip — it is a rogue-signer backstop, never a setting.)
      **Run `npm run dials` FIRST for the two cap arguments** — they derive from LIVE POOL DEPTH and are
      not fixed numbers. At a 100-ETH pool it gives `dailyCapOMR` **~27,000 OMR/day** (≈5% of the pool's
      OMR reserve, sized so a full day's cap dumped moves the price ≤10%) and `maxOmrPerEth` **~15,000**
      (3× the launch price — a circuit breaker, not a price). Re-run it whenever POL materially deepens
      and raise the cap with it.
      **At the planned genesis raise (21.38 ETH → POL 0.375R = 8.0175 ETH) the rule gives `dailyCapOMR`
      ≈ 82,500/day.** Derive it against the ACTUAL POL at deploy, never from a figure written down
      earlier: the raise is a founder lever and this cap moves with it (BALANCE.md § THE GENESIS RAISE —
      a smaller raise means a shallower pool means the same cap does MORE price damage, which is exactly
      why the number is a function of depth and not of supply).
- [ ] **`GenesisOracle(safe, price, validUntil)`** — WALL 4's feed for the GENESIS WINDOW ONLY, and the
      reason the window can exist at all: `OmertaBond` fails closed without an oracle, but the TWAP
      cannot be deployed before the pool it reads, and the window is what FUNDS that pool. So the
      window runs on an administered price. `price` is the published genesis rate (OMR per 1 ETH),
      `validUntil` the window's hard end. **Set `validUntil` to the window's real close and no
      further**: this feed answers `updatedAt = block.timestamp` while open — deliberately, because an
      administered price has no keeper and cannot go stale in the sense `maxOracleAge` guards, and
      pinning it to the set-time would silently halt bonding one `maxOracleAge` in, during the single
      event that funds the pool (`test_bonding_works_for_the_whole_window_not_one_max_age`). The
      window is what replaces time-staleness, so it is the ONLY thing bounding this feed. Past it,
      `consult()` reports the interface's own "no usable reading" and bonding refuses. `setPrice(0,0)`
      is the kill switch — zero is already "unavailable", so there is no pause flag and no second path.
      **This contract is retired by being unreferenced** at the `setOracle(twap)` cutover below;
      nothing needs tearing down.
- [ ] **`OmrTwapOracle(safe, omrWethPair, omr, period)`** — WALL 4's price feed for NORMAL OPERATION,
      deployed AFTER the pool exists (it reads that pool's cumulative price). `period >= MIN_PERIOD` (10 min); **30 min
      recommended** — past that the manipulation-cost curve flattens for a thin pool while the lag grows,
      and what actually makes this expensive is POOL DEPTH, not the clock (see `npm run dials`). The
      constructor works out which side of the pair OMR sits on rather than being told. It reports **no
      usable reading until a full period has been closed**, so bonding cannot start on a price derived
      from nothing.
- [ ] **`OmertaBond.setOracle(oracle, priceToleranceBps, maxOracleAge)`** — arm WALL 4. Recommended
      **500 bps (5%)** and **90 minutes** against a 30-minute keeper (3× the poke interval tolerates two
      consecutive misses and no more). Tolerance is how far a signed quote may sit ABOVE the TWAP —
      non-zero because a TWAP lags spot, so 0 rejects honest quotes exactly when the market moves; 0 is
      nonetheless a legitimate choice if you would rather bonding stall than drift. Hard-capped at 2000.
- [ ] **Start the oracle keeper.** `OmrTwapOracle.update()` is permissionless and must be poked at least
      once per `maxOracleAge`, or the feed goes stale and bonding halts. That failure direction is
      deliberate — a dead keeper must stop the mint, never leave it running on an unmaintained price —
      but it does mean **the keeper is a production dependency, not a nice-to-have**. The backend
      WATCHES it: the worker's `bondOracleHealth` check (hourly, dormant without a bond chain) flags
      `keeper-late` at 2× PERIOD — while bonding still works, so there is lead time — and `down` when
      `priceCeiling()` starts reverting, alerting through the same latched channel as a §10.4 drift
      and surfacing on `/admin` (Chain panel) + `GET /v1/mod/bonds`.
- [ ] **Arm the mint — the step that turns issuance on.** `OMR.setMinter(omertaBond)`. Do this LAST, and
      only after `dailyCapOMR`, `maxOmrPerEth` AND the oracle are all set to real values: those, plus the
      compile-time `MAX_DISCOUNT_BPS`, are the entire wall between a leaked quote-signer and unbounded
      supply. `maxOmrPerEth` and the oracle are both **fail-closed**, so bonding stays off until each is
      set — but `dailyCapOMR = 0` means UNLIMITED, so a deploy that forgets it has no daily wall at all.
      Set it. `setMinter(address(0))` is the one-transaction emergency stop.
- [ ] **Fund VoucherClaim's tranche (a plain OMR transfer — the bridge NEVER mints):** transfer OMR from the
      Safe into `VoucherClaim` to back signed withdrawal vouchers. Its `balanceOf` IS its cap.
      **OmertaBond no longer needs funding** — it mints each payout at bond time, which is what keeps
      `committedOMR ≤ balanceOf(this)` true at every instant so `sweep` can never strand a bonder.
- [ ] **Arm the DEX sell tax (after the pool exists):**
      `OMR.setTaxRecipients(devWallet, rwaWallet, communityWallet, lpWallet)` →
      `setExempt` for the POL manager + OmertaBond + VoucherClaim + the Safe → `setPair(pool, true)` →
      `setSellTax(bps, devBps, rwaBps, communityBps)` — the total is hard-capped at 10% and defaults to
      0 = off; LP takes the remainder after dev + rwa + community. **Path A: ship
      `setSellTax(900, 200, 160, 240)`** (dev 200 / rwa 160 / community 240 / lp remainder), matching
      `deploy/fee-splits.env`'s `SELL_TAX_RWA_BPS=160` + `SELL_TAX_COMMUNITY_BPS=240`. The **community
      slice is now a 4th ON-CHAIN recipient** (2026-08-15 — it was a backend carve before the contracts
      gained it): its wallet MUST be the **community-buyback keeper's** — a SEPARATE key from the
      treasury's and the Vig's (the §0.5 custody rule: `runFamilyBuybackInvariants` publishes
      `walletMustHold` against THAT wallet, so pointing the slice anywhere else books family backing
      against ETH the family keeper does not hold). The backend `recordSellTax` carve
      (`SELL_TAX_COMMUNITY_BPS`) covers only the mod-ingest rail until the SellTaxTaken watcher lands —
      keep the two numbers in lockstep. Only transfers INTO registered pools are taxed; buys and wallet transfers are clean. **HARD REQUIREMENT: the canonical pool must be
      Uniswap V2-COMPATIBLE** (sell-taxed tokens need the *SupportingFeeOnTransferTokens router path;
      Uniswap V3 does not support them). RESOLVED (verified July 2026): Uniswap deployed **v2, v3, v4 +
      UniswapX on Robinhood Chain at its July 1, 2026 mainnet launch** — so a V2 pool is available. Still
      CONFIRM ON-CHAIN at deploy: pull the addresses from Uniswap's deployment docs
      (developers.uniswap.org → Robinhood Chain deployments) and run `node tools/check-dex.js` against
      the live RPC (probes bytecode + the right view calls; prints a go/no-go verdict for the taxed pool).
      **This V2 requirement dies the day the v4 hook becomes the canonical venue** (§7) — the fee then
      lives in the pool, not in `_update`, and V3/V4 routers and every aggregator work normally. Keep the
      `_update` path anyway, ARMED AT ZERO: a hook tax is a property of ONE pool and anyone may open an
      unhooked one, so the token tax is the universal backstop the Safe arms if that starts to matter.
      **ONE VENUE, ONE LAYER (red-team C3).** `MAX_SELL_TAX_BPS` (10%) is a ceiling on EACH layer and
      neither contract can see the other, so a seller pays the SUM of what is armed on the venue they
      traded. Registering the v4 PoolManager as an `ammPairs` entry while the hook is armed doubles the
      rate past the ceiling both contracts advertise AND taxes protocol flows into the pool (the
      POL-pairing bot's LP add) unless each is `taxExempt`. So: arm the hook for the canonical pool and
      leave `_update` at zero; arm `_update` only for a venue the hook does not cover.

### 2a. STREET DEEDS — the on-chain tradeable deed (only when it ships; dormant until env-set)
- [ ] **`StreetDeed(safe, signer, imageBase, externalBase)`** — the ERC-721 Street Deed
      (`omerta-street-deeds-design.md` §2/§3). SELF-MINTING on the SAME `signer` as VoucherClaim (no owner
      mint — a deed mints only against a server-signed EIP-712 `DeedVoucher`), Safe-owned. `imageBase` →
      the game's block-plate route (`https://<host>/v1/deeds/plate/`), `externalBase` → the deed's legend
      page (`https://<host>/deed/`); both take `<tokenId>` appended. **NO wiring needed** (it verifies its
      own voucher — the OmertaBond precedent, since a deed voucher carries name+district strings the
      fixed VoucherClaim struct can't). **RATE WALL — pass `DEED_DAILY_MINT_CAP` (0 = unlimited).** It is a
      CONSTRUCTOR argument, so a deploy must STATE it: this contract self-mints on the SAME signer key as
      VoucherClaim/OmertaBond/DynastyNFT, so that key's blast radius is the SUM of the four daily caps.
      (Before R33 this read "optional" and the field was setter-only, so a fresh deploy minted unbounded
      deeds per day with nobody doing anything wrong — and a deed's ERC-6551 vault is where real tokenized
      stock lands. Both siblings that take their cap at construction could never be forgotten; these two
      could, and the runbook said not to bother.)
      **Backend activation:** set **`STREET_DEED_ADDRESS`** on BOTH the API (so `POST /v1/deeds/extract`
      signs the DeedVoucher — needs `CHAIN_ID` + the shared `VOUCHER_SIGNER_PK` too) AND the WORKER (so the
      `Extracted` watcher `syncDeedExtractedEvents` → `markDeedExtracted` frees the extractor, the
      `Redeemed` watcher `syncDeedRedeemedEvents` → `reimportDeed` brings a burned deed back into the game,
      and the **`Transfer` watcher `syncDeedTransferEvents`** (cursor stream `deed_transfer`) →
      `recordDeedTransfer` maintains `street_deeds.onchain_owner` — a deed SOLD on a secondary market
      stops being its extractor's STOCK-DELIVERY target (the plan + board both apply the exclusion,
      case-insensitive vs the SIWE wallet; a NULL owner fails OPEN so a chain-dormant deploy keeps
      delivering) and the sale lands on the deed's public legend; the worker also needs
      `CHAIN_RPC_URL`). The **default-ON per-token transfer lock** (`transferLocked`) is the
      drain-before-sale mitigation: a freshly minted or freshly received deed cannot move until its
      OWNER calls `setTransferLock(tokenId, false)` — the emitted `TransferLockSet` is the public
      "listing" moment a buyer checks TBA contents against. Dormant until set. The deed goes INERT in-game while
      extracted (no rent/control — the car/boat v3-step-7 precedent); a holder RE-IMPORTS by calling
      `redeem(tokenId)` (burn), which the `Redeemed` watcher hands to a deedless linked account.
      §10.4-NEUTRAL: a deed is ownership, never a currency — zero `transactions` rows. `tokenId =
      uint256(keccak256(bytes(name)))` (a name↔id bijection enforced on-chain), so a name mints at most
      once; a re-import (burn) frees the same id for re-extraction. `redeem` is NEVER pausable — a paused
      contract must never trap a holder's asset.

### 2c. THE IDENTITY NFT + THE STOCK DELIVERY VAULT (only when they ship; dormant until env-set)
- [ ] **`DynastyNFT(safe, signer, baseUri, royaltyRecipient, royaltyBps)`** — the uncapped identity NFT
      (`omerta-dynasty-machine-design.md` §4). SELF-MINTING on the SAME `signer` as VoucherClaim/StreetDeed
      (no owner mint — a token exists ONLY against a server-signed EIP-712 `MintVoucher`), Safe-owned.
      `baseUri` → the account's metadata endpoint (`https://<host>/v1/identity/`, `<tokenId>` appended);
      `royaltyRecipient` = the treasury Safe, `royaltyBps` = **500** (5%, EIP-2981). **THE WALL: the
      contract gates NOTHING on `balanceOf`** — the game entitlement (`account_persistent.minted`) stays
      account-bound OFF-CHAIN, so the token is a freely transferable trophy carrying no on-chain power.
      **NO wiring needed on the CONTRACT side** (it verifies its own voucher). Optional rate-cap:
      **pass `DYNASTY_DAILY_MINT_CAP`** — with no supply cap this is the entire blast radius of a leaked
      signer key, so **set it**. It is a CONSTRUCTOR argument (0 = unlimited), so a deploy must state it. **Backend activation:** the ENTRANCE is `POST /v1/identity/mint`
      (`chain.js:requestDynastyMint` — a made account with a SIWE-proven wallet gets one signed
      MintVoucher, one per account ever; added 2026-08-17 by red team #9, which found the contract
      deployable, watchable and **unusable** — three of the four contracts sharing this signer key had
      a signing route and this one did not, while this step said the rail was done). Set
      **`DYNASTY_NFT_ADDRESS`** on the **API** (signs) and the **WORKER** — the `Minted` + `Transfer` watchers (cursors `dynasty_minted`/`dynasty_transfer`)
      maintain the token registry (`dynasty_tokens`, minter resolved via the SIWE wallet) and **FREEZE the
      portrait at the first owner→owner transfer** (the snapshot stores the portrait ROW, so a sold token
      is a photograph of the bloodline as it stood — one-way; a buy-back does not unfreeze). The identity
      metadata routes (`/v1/identity/:param`) take the all-digits tokenId form, so the deployed `baseUri`
      contract holds. Dormant until set. §10.4-NEUTRAL (art/status only).
      *ERC-6551:* the canonical registry singleton (`0x000000006551c19487814612e58FE06813775758`) + the
      ecosystem reference **account implementation** are used UNMODIFIED — deploy config, not a fork. A
      player's token-bound account is `registry.account(accountImpl, salt, chainId, DynastyNFT, tokenId)`;
      nothing here is a new contract to deploy.
- [ ] **`StockVault(safe, keeper)`** — the gateless keeper-push tokenized-stock delivery vault
      (`omerta-brokers-design.md` §3.3). **NEVER mints** — every `deliver`/`deliverBatch` is a pre-held
      `SafeERC20.transfer`, so `balanceOf(this)` per token is the physical `allocated ≤ held` wall. Pass
      **`keeper = address(0)` at deploy** (deliveries OFF). **⚠ ORDER (fail-safe):** the Safe (1) pre-funds
      the vault with the tokenized-stock ERC-20s the treasury keeper bought (`runStockBuyback`), (2) sets a
      per-ticker `setDailyCap(token, cap)` (the leaked-keeper rate wall — a compromised keeper can only move
      HELD units, never mint, and the Safe can `sweep` unspent stock at any time), THEN (3) `setKeeper(bot)`
      to arm it. **GATELESS is a DELIBERATE §3.3 decision** (recorded in the NatSpec so the audit sees a
      decision, not an omission): there is no claim process and no on-chain eligibility gate — stock accrues
      straight into the player's ERC-6551 token-bound account, so the NFT sells self-contained; the accepted
      risk is that Robinhood's tokenized stocks are issuer-restricted (EU-facing) and a gateless push has no
      on-chain control over who receives them. Any operational eligibility is a backend/keeper concern.
      **DELIVERY TARGET REDIRECTED to the STREET DEED (`omerta-brokers-design.md` §3.4, founder-directed
      2026-08-14):** stock lands in the player's on-chain **Street Deed's** ERC-6551 TBA, not the Dynasty
      NFT's — so a player must own AND extract a Street Deed to receive stock (an account with none accrues
      its allocation as owed and waits). The identity NFT holds no stock, so its `balanceOf`-gates-nothing
      entitlement wall is intact. **Backend activation:** set **`STOCK_VAULT_ADDRESS`** on the WORKER +
      API, and **`STREET_DEED_ADDRESS`** + the ERC-6551 env (`ERC6551_REGISTRY` /
      `ERC6551_ACCOUNT_IMPL` / `ERC6551_SALT`, defaulting to the canonical registry singleton) so
      `src/stockdeliver.js` can resolve the deed's TBA; the worker runs the two watchers
      (`Delivered` → `confirmStockDelivered`, the deed's `Extracted` → `markDeedExtracted`). **The
      delivery KEEPER is BUILT (2026-08-15):** `runStockDeliveryKeeper` (worker tick + `POST
      /v1/mod/treasury/deliveries/run`) stages each owed allocation, CLAIMS it atomically
      (claim-then-send — `sent_at` stamped before the tx, released on a failed send, `RESEND_MS` 10min
      retry with the SAME deterministic `deliveryId` so the contract's `usedDeliveryId` bounds any lost
      race to a clean revert), and sends the real `StockVault.deliver` tx; it NEVER confirms — only the
      `Delivered` watcher flips `stock_allocations.delivered`. Arm it with **`STOCK_KEEPER_PK`** (a
      SECRET — the on-chain `keeper` bot key) + **`STOCK_TOKEN_ADDRESSES`** (JSON ticker→ERC-20 map;
      a ticker missing from it is a NAMED `no_token_address` skip, never a silent one) +
      each token's decimals are read off the token itself (never configured — a tokenized stock is not
      reliably 18dp and the map holds several). Dormant until wired. §10.4-NEUTRAL (out-of-band real value —
      zero `transactions` rows; the backend's `allocateStock` clamp + the nightly `allocated ≤ held` AND
      `delivered ≤ allocated` checks in `runTreasuryInvariants` are the owed-side half of the wall).
      **✅ BOTH ON-CHAIN LEGS ARE PROVEN (2026-08-16)** — `npm run stock-e2e` (the forge CI job, beside
      dexbot-e2e) stands the whole rail up on anvil and runs `resolveTbaOnchain` + `sendDeliverOnchain`
      UNSEAMED against the REAL ERC-6551 registry (the reference implementation, vendored unmodified at
      `omerta-contracts/test/vendor`) plus StreetDeed and StockVault off the forge build. 14 asserted
      steps: a deed minted from a server-signed EIP-712 voucher, the backend's computed TBA equal to the
      registry's own answer (and the account deployed there reporting THIS deed as its token), the units
      landing in that account, the keeper sending but never settling, and the `Delivered` log — not the
      keeper — flipping the allocation. **Why this leg gets its own prover:** with §3.3's gateless push
      the ADDRESS is the only thing between the treasury and a permanent loss, and a wrong one is
      invisible to every wall we have (they are denominated in UNITS; who received them is not a
      quantity). **Residual, as with the DEX bots:** the prover deploys the registry it then checks
      against, so a MISCONFIGURED `ERC6551_REGISTRY` / `ERC6551_ACCOUNT_IMPL` / `ERC6551_SALT` at deploy
      is a config error it cannot see — resolve one real deed's TBA against the live registry by hand
      before the first delivery.

### 2b. THE BANK — the Denari (DNR) market (only when it ships; not part of the first cut)
Order matters more here than anywhere else in this file, because **two of these steps fail SILENTLY**:
omit them and the market looks healthy from the outside and is not.
- [ ] **`Denari("Denari", "DNR", safe)`** → **`Transmuter(denari, asset, safe)`** →
      **`Alchemist(denari, asset, vault, transmuter, safe)`**, then wire:
      `denari.setMinter(alchemist)`, `denari.setBurner(transmuter)`, `transmuter.setFunder(alchemist, true)`,
      `transmuter.setFunder(safe, true)` (the launch seeder).
      *(The debt token was founder-named **Denari / DNR** on 2026-08-13 — pre-rename docs and every
      audit report call it `nUSD`; same contract. Pass the name and symbol EXACTLY as above — the
      constructor takes both, and the ERC-2612 permit domain is derived from the name.)*
- [ ] **`alchemist.setLtvBps(bps)`.** Bounded by `MAX_LTV_BPS` **and** by the harvest fee — the pair must
      satisfy `ltv + fee <= 10000`, enforced in both setters, so at the shipped 20% fee the reachable
      ceiling is 80%, not 90%.
- [ ] **⚠ SEED THE BUFFER BEFORE ANY BORROW.** `transmuter.fund(seed)` from the Safe. At zero supply
      the required buffer is zero, so the FIRST borrow always passes and every one after it reverts
      `BufferUnhealthy` — reserves are fed only by repay/harvest, which need existing debt. An unseeded
      market takes one borrow and deadlocks while reading as a correct config.
      `test_an_unseeded_market_bricks_after_one_borrow` pins it.
- [ ] **⚠ SET THE MINT CAPS.** `alchemist.setMintCaps(perBlock, perDay)`. **Zero means UNLIMITED here** —
      these fail OPEN, unlike `maxOmrPerEth` and the gear caps. Skipping this does not stop the market;
      it runs it with no rate limit on issuance.
- [ ] **`alchemist.setHarvestFee(bps, recipient)`** — the performance fee on realised yield, capped by
      `MAX_HARVEST_FEE_BPS`. A ZERO recipient disables the fee (fail-safe: an unset recipient
      under-charges rather than burning a borrower's yield), so this is the one bank setter whose
      omission costs revenue and nothing else.
- [ ] Backend: set `ALCHEMIST_ADDRESS` + `ALCHEMIST_ASSET` so the worker (the market's DECIMALS are read off the chain — never configured)
      syncs `HarvestFeeTaken` into `bank_revenue`. The decimals matter: the fee is denominated in the
      market's UNDERLYING (6dp for USDC), and `bank_revenue` is deliberately NOT mirrored into the
      ETH-denominated `rwa_revenue`, whose sum is the vault's `allocated <= held` wall.

## 3. Transfer ownership to the Safe
- [ ] Every contract is `Ownable2Step`. From the deployer: `transferOwnership(safe)`; from the Safe:
      `acceptOwnership()`. Verify `owner() == safe` on all six. (In `chain-e2e.js` the deployer *is* the Safe;
      in production they differ — do the two-step handoff.)

## 4. Backend env — activate the dormant rails (production API + worker, same DB)
Each rail is OFF until its address/config is present. Set on BOTH processes.

| Env var | Turns on | Notes |
|---|---|---|
| `CHAIN_RPC_URL` | the whole chain sync + signer | absent ⇒ fully dormant |
| `CHAIN_ID` | EIP-712 domain + `assertChainId` | **must equal the RPC's real chainId** — a mismatch DISABLES chain sync fail-closed (never signs under the wrong domain) but does NOT crash the worker |
| `CHAIN_CONFIRMATIONS` | reorg depth (default 5) | the watcher stays this far behind head |
| `CHAIN_START_BLOCK` | first-scan seed | set to the contracts' deploy block (don't scan from genesis) |
| `CHAIN_POLL_MS` | sync cadence | optional |
| `VOUCHER_CLAIM_ADDRESS` | `Claimed` sync (frees reserve) + it's the voucher `verifyingContract` | — |
| `VOUCHER_SIGNER_PK` | EIP-712 signing — vouchers (`POST /v1/withdraw`, gear) AND bond quotes (`POST /v1/bond/quote`) | **the crown jewel — HSM/KMS in prod, audited (Gate 0.2)**; the same signer must be set as OmertaBond's `signer` |
| `BOND_QUOTE_TTL_SEC` | bond-quote validity window (default 3600s) | must stay under the contract's `MAX_QUOTE_TTL` (30d) |
| `VOUCHER_RECLAIM_GRACE_SEC` | expired-voucher reclaim grace | optional (worker sweep) |
| `DAILY_CAP_OMR` | per-day withdrawal cap (wei) | mirrors the contract's `dailyCapOMR` |
| `OMERTA_FEES_ADDRESS` | fee sync (`MintFeePaid`/`RespawnFeePaid`/`RerollFeePaid` → credits) | — |
| `OMERTA_BOND_ADDRESS` | **the `Bonded` → `recordBond` bond sync (NEW — now wired)** | books the event's authoritative payout + POL/Vig split; idempotent on nonce |
| `STREET_DEED_ADDRESS` | API: `POST /v1/deeds/extract` signs the DeedVoucher (needs `CHAIN_ID` + `VOUCHER_SIGNER_PK`) + it's the deed `verifyingContract`. WORKER: `Extracted` → `markDeedExtracted` (frees the extractor) + `Redeemed` → `reimportDeed` (burn brings the deed back) | set on BOTH processes; dormant until set. §10.4-neutral (ownership, not currency) |
| `ALCHEMIST_ADDRESS` (+ `ALCHEMIST_ASSET`, the label only — decimals come from the chain) | THE BANK's harvest-fee sync → `bank_revenue` | only when the bank market ships |
| `MINT_FEE_ETH` / `RESPAWN_FEE_ETH` | the PLEX price quote | ETH-denominated; keep == the contract fees |
| `WALLETCONNECT_PROJECT_ID` | the console's **WalletConnect (mobile)** option — the ONLY way a phone can link a wallet (desktop browser wallets are auto-discovered via EIP-6963 and need nothing) | a PUBLIC WalletConnect/Reown project id, free from https://dashboard.reown.com; unset ⇒ the console hides the option. Surfaced in `/v1/rules`. Not chain-gated: linking is a signature, so the chain is requested as OPTIONAL and a wallet that has never heard of the OMERTÀ chain still connects |
| `PLEX_RESPAWN_OMR` | the respawn's PLEX floor price (pre-market) | a sign-off lever. **There is no `PLEX_MINT_OMR`** — the mint is ETH only (it is the Sybil bound and the extraction gate, so it gets one rail and one published price); setting it does nothing |
| `VIG_BPS` / `VIG_RESERVE_BPS` / `VIG_MAX_PRICE_JUMP` | Vig split + the buyback price-sanity bound | — |

**`ALLOW_MOD_REAL_REVENUE` — leave UNSET/off in production.** It is a QA-only flag that lets the mod
comp/simulate routes inject *real* revenue; in prod the ONLY legitimate real-revenue source is a real on-chain
event carrying a txHash (fees, `Bonded`, `HarvestFeeTaken`). With it off, a comp books zero POL/Vig — no fabricated,
unbacked reserve. (Red-team D-MED2.)

- [ ] **THE PATH A REVENUE SPLIT — the env flip (`deploy/fee-splits.env`).** The founder-signed fee split
      (`deploy/fee-splits.json`, 2026-08-13) is a coherent SET of ~17 backend levers. Apply them on **BOTH
      the api and worker** at go-live — never piecemeal: several are validated by rules.tail.js load guards
      at boot (`SELL_TAX` four-way sum, `BOND` sum, the fee sum), so a partial set crash-loops the process.
      **Run `node tools/validate-fee-splits.js` first** — it loads the router with exactly these values and
      asserts they reproduce the JSON and pass every guard. The code DEFAULTS stay byte-identical (community
      slices 0), so this file IS the "env flip with sign-off" (`omerta-treasury-to-family-design.md` §8
      Phase 2); do NOT set these in the pre-chain render.yaml. The three IMMUTABLE contract args that must
      match — `OmertaFees.vigBps=2500`, `OmertaBond(polBps=7500,devBps=1500,rwaBps=500)` — are in the deploy
      steps above; the sell-tax `setSellTax(900,200,160,240)` matches too — the 240-bps community slice
      is a 4th ON-CHAIN recipient as of 2026-08-15 (the community-buyback keeper's wallet; it was a
      backend carve before the contracts gained it).

## 5. Fund + reconcile the backend accounting to MIRROR the chain
The backend keeps its own reserve records; they must track the on-chain balances, or the invariants flag a gap.
- [ ] `POST /v1/mod/reserve/fund` → set `chain_reserve.funded_omr` to match the OMR held by `VoucherClaim`
      (the withdrawal full-reserve queue signs only within `funded_omr`).
- [ ] `POST /v1/mod/bond/fund` → set `bond_reserve.capacity_omr` to the OMR budget you intend bonds to issue.
      Since step 4 this is a **backend-side budget, not a mirror of a balance** — OmertaBond mints its payouts,
      so there is no on-chain tranche to match. The on-chain wall is `dailyCapOMR` + `maxOmrPerEth`; keep the
      backend budget in step with them or `GET /v1/mod/bonds` (`runBondInvariants`) reports the gap. The
      `Bonded` watcher **bypasses** the backend cap on ingest (the contract already enforced its own walls), so
      a real bond is always recorded and can never stall the sync cursor. Same discipline for
      `runVigInvariants` / `GET /v1/mod/vig` (extraction ≤ inflow).

## 6. Post-deploy verification (testnet, then the same on mainnet after the gates)
- [ ] `CHAIN_RPC_URL=… CHAIN_ID=… DEPLOYER_PK=… PLAYER_PK=… VOUCHER_SIGNER_PK=… node tools/chain-e2e.js`
      → all 27 asserted steps green (deploy → SIWE link → pay a fee → watcher credits → mint → earn $OMR →
      fund reserve → withdraw signs an EIP-712 voucher → `claim()` on-chain → replay/tamper REVERT → the
      `Claimed` watcher frees reserve → gear voucher mints → uncapped gearId fails closed → §10.4 holds).
- [ ] Boot the worker; confirm the sync logs advance (`💰 fee sync`, `👁 claimed sync`, `🏦 bond sync` once a
      `Bonded` fires, `🏛  bank sync` if the Alchemist is live) and the cursors persist (`chain_cursor`).
- [ ] `GET /v1/mod/reserve`, `/v1/mod/vig`, `/v1/mod/bonds`, `/v1/mod/emission` read green (backed / within
      caps). The `/admin` §10.4 banner reads OK. `npm run invariants` all `ok:true`.
- [ ] Do one real player round-trip on testnet: pay the mint fee → mint a character → earn $OMR → link wallet
      (SIWE) → `POST /v1/withdraw` → `claim()` the voucher → 25 real OMR in the wallet.

## 7. NOT part of the first mainnet cut (still deferred / gated)
- **The bond QUOTE SIGNER is BUILT** (`src/chain.js:quoteBond` + `POST /v1/bond/quote`) — a player requests a
  signed `BondQuote` bound to their linked wallet (`Chain.BOND_QUOTE_TYPES` / `bondChainConfig()`, exact parity
  with `OmertaBond.QUOTE_TYPEHASH`: `payer, principal, priceOmrPerEth, discountBps, vestSeconds, nonce, deadline`;
  domain `OmertaBond`/`1`; verifyingContract = `OMERTA_BOND_ADDRESS`), submits `bond(quote, signature)` on-chain,
  and the `Bonded` watcher recovers the quote's exact price/discount from the persisted `bond_quotes` row. It is
  **chain-dormant** (400s `chain_unconfigured` unless `CHAIN_ID` + `OMERTA_BOND_ADDRESS` + `VOUCHER_SIGNER_PK`
  are set) and pre-checks the backend tranche (`bond_reserve.capacity_omr`) so a player never gets a quote whose
  `bond()` would revert `TrancheExhausted`. Quote-nonce space is `bond_reserve.next_nonce` (independent of the
  withdrawal `chain_reserve` nonce). `BOND_QUOTE_TTL_SEC` (default 1h) sets the quote deadline (< contract
  `MAX_QUOTE_TTL`). **The in-browser wallet flow is BUILT**: the console (EIP-6963 multi-wallet discovery —
  MetaMask / Robinhood Wallet / any injected wallet, with a picker) requests a quote, then `POST /v1/bond/calldata`
  server-encodes `bond(quote, sig)` (viem) and the connected wallet `eth_sendTransaction`s it after switching to
  the quote's chain. It is DORMANT until this rail is configured. Still deferred: the DEX-TWAP oracle below (for a
  live quote board) — today the oracle is the latest manual Vig-buyback print.
- **The Uniswap v4 migration** (`omerta-v4-hook-design.md`) — `OmertaHook.sol` is BUILT and tested but
  **not deployed and not deployable yet**, and the remaining work is deliberately ordered:
  - **The address must be MINED.** v4 encodes a hook's permissions in the low 14 bits of its address, and
    the constructor refuses to exist anywhere that does not carry exactly `HOOK_FLAGS` (`0x30CC`). So the
    deploy is a CREATE2 salt search, and the permission set can NEVER be extended afterwards — a missing
    flag is a new hook plus a full liquidity migration.
  - **Wire before arming:** `setRecipients(dev, rwa, community, lp)` → `setAllowedQuote(quote, true)` for
    each quote currency the Safe is willing to HOLD (the empty allow-list is the deploy default, and until
    it is set NO pool can be created on this hook at all) → `initialize` the pool →
    `setSellTax(900, 200, 160, 240)` (Path A — rwa 400→160 with the 240-bps community slice a 4th ON-CHAIN
    recipient; the community wallet is the family-buyback keeper's, per the OMR sell-tax step above).
    `setObserver` once the hook-native oracle exists.
  - **✅ THE LP LEAGUE reader is BUILT AND PROVEN (2026-08-16)** — `src/dexbot.js:readLpPositions`,
    installed at worker boot (`lpReaderReady()`, a WEAKER condition than the bots': it is read-only
    and needs no `DEX_BOT_PK`, so a box that never sends a transaction still accrues the league).
    It enumerates through the poolId-filtered `ModifyLiquidity` stream rather than scanning every
    token the PositionManager ever minted — v4 passes `bytes32(tokenId)` as the position SALT and
    PoolManager indexes that event by poolId — and resolves the PoolManager from the
    PositionManager's own `poolManager` getter (one less address env to drift). `npm run dexbot-e2e`
    pins it against a real pool: the POL positions read 1.8518 ETH against the 1.851788 ETH they
    actually consumed, and a narrow position carrying 34× the liquidity is credited only the 1 ETH
    it put in (the anti-gaming property — depth is priced by TOKENS, never by raw L).
    **Config at launch:** `POSITION_MANAGER_ADDRESS` + `STATE_VIEW_ADDRESS` + `OMR_ADDRESS` +
    `OMERTA_HOOK_ADDRESS` + the pool params on the WORKER, plus `DEX_POOL_FROM_BLOCK` (the pool's
    deploy block — the log scan starts there; leaving it 0 works but re-scans the whole chain every
    12h tick). Then size `BOND_LP_SCORE_PER_ETH_DAY` (BALANCE.md § THE LP LEAGUE — the shipped 300
    is a proposed default; the ratio depends on LP fee income and impermanent loss at the live
    volatility, so it cannot be sized before there are real LPs).
  - **Sequencing that is not optional** (§9.2): deploy the hook-native oracle → let it accumulate a FULL
    window → `OmertaBond.setOracle` → *then* migrate liquidity. Doing the migration first points wall 4 at
    a pool where price is no longer discovered, which is worse than an outage because it still returns a
    number. And re-derive `dailyCapOMR` (`npm run dials`) against the new depth afterwards.
  - **Seed POL into the hooked pool BEFORE migrating** (§4b). Pool-local enforcement means the moat is
    depth; it is thinnest at launch, which is exactly when a rival untaxed pool is cheapest to stand up.
  - **CLOSED 2026-08-11 (founder: "get rid of the Vig trade fee") — the sell tax is the canonical
    pool's ONE hook and the trade fee is RETIRED, not folded.** The earlier fold (D1 = A) was never
    built because its ETH-on-buys fee needs the input-side `beforeSwap` path, which breaks partial
    fills. Consequence to carry into deploy: the Vig has no trading leg, so withdrawal backing is
    gameplay fees + Store + bonds only (sim P9.15 prints it). **Nothing to configure and nothing left
    to build here** — `OmertaHook` already IS the canonical pool's hook, so the address may be mined
    against it as it stands.
- **The two DEX bots are BUILT (2026-08-15, `src/dexbot.js`)** — chain-dormant keepers on the worker's
  chain-sync tick (their own cadence, `DEX_BOT_EVERY_MS`, default 12h):
  - **The DEX buyback bot** (`runDexBuyback`) swaps unspent Vig revenue for hard OMR on the canonical v4
    pool via the Universal Router and books the **ACHIEVED** price through the audited `runVigBuyback`
    (inheriting its continuity wall, root cap, reserve split + fundReserve). The price comes from the
    SAME oracle the bond reads (resolved from `OmertaBond.oracle()` — the setOracle cutover repoints the
    bot automatically), FAIL-CLOSED on no/zero/stale readings, and every swap carries a hard `minOmrOut`
    slippage floor (`DEX_MAX_SLIPPAGE_BPS`, default 3%). Two-phase swap-then-book (`dex_swaps` journal,
    idempotent on the tx hash): a crash between the real swap and the accounting loses nothing and never
    re-swaps. The manual `mod/vig/buyback` price stays as the QA/fallback rail.
  - **The POL-pairing bot** (`runPolPairing`) pairs the bond-delivered POL ETH into the OMR-ETH pool as a
    full-range v4 position minted to the SAFE (`POL_POSITION_OWNER` — POL belongs to the treasury, never
    the hot bot key). Root cap: Σ real `pol_pairings` ≤ `bond_reserve.pol_eth` — the bot can never pair
    ETH the bond programme did not deliver. The OMR side is the bot wallet's own hard OMR
    (Safe-allocated genesis supply — nothing mints).
  - **Activation (worker):** `DEX_BOT_PK` (SECRET — fund it with the POL ETH stream + Safe-allocated OMR
    for the pairing side) + `UNIVERSAL_ROUTER_ADDRESS` + `POSITION_MANAGER_ADDRESS` +
    `STATE_VIEW_ADDRESS` + `POL_POSITION_OWNER` (the Safe) + the pool params (`DEX_POOL_FEE` /
    `DEX_POOL_TICK_SPACING` — must match the initialized pool EXACTLY) on top of the existing
    `CHAIN_RPC_URL` + `OMERTA_BOND_ADDRESS` + `OMR_ADDRESS` + `OMERTA_HOOK_ADDRESS`. Nightly invariants
    (`runDexBotInvariants` → alertDrift: the POL root cap, orphan-fill freshness, comps-book-nothing,
    the swaps↔buybacks reconciliation); ops board + run-now triggers at `GET/POST /v1/mod/dexbot*`.
  - **✅ THE v4 ENCODINGS ARE PROVEN (2026-08-16).** `npm run dexbot-e2e` stands up a REAL Uniswap v4 on
    anvil — the actual PoolManager / PositionManager / StateView / Universal Router / Permit2 bytecode,
    the canonical OMR/ETH pool behind the REAL OmertaHook — and runs BOTH bots with their senders
    UNSEAMED, so `src/dexbot.js`'s own encoders build the calldata that executes (18 asserted steps).
    **It found a real defect:** the mint over-sent ETH and v4 never refunds it (`DeltaResolver` settles
    native ETH out of the periphery contract's own balance), so the remainder was stranded in the
    PositionManager — unreachable by anyone, in bonded POL money, **0.148 ETH of 1 ETH at a 15%
    oracle-vs-spot gap**, with the journal still booking the full ETH as paired. Fixed (a `SWEEP`
    action + booking what the position actually consumed), both halves mutation-pinned.
    **Still do a live smoke on the real chain before the first real run** — this proves the encodings,
    not your deploy: one small swap and one small pairing, then read the position and the fill back.
    A wrong `DEX_POOL_FEE`/`DEX_POOL_TICK_SPACING` misses the pool entirely and is a config error the
    prover cannot see.
- **The on-chain Store** — `OmertaFees.payForPackage` is **BUILT** (2026-08-14, in the audit batch:
  fail-closed on an unpriced sku, exact-value, forwards dev/Vig, custodies nothing; `setPackagePrice(sku,
  wei)` prices a package on-chain, `0` retires it). **The BACKEND watcher is BUILT (2026-08-15):**
  `syncStorePaidEvents` (worker, cursor `store`, dormant until `OMERTA_FEES_ADDRESS`) credits the paying
  account through the audited `recordStorePurchase` (idempotent on `nonce`, pay-before-link reconciled).
  The on-chain sku is **`uint256(keccak256(bytes(skuString)))`** (the StreetDeed tokenId convention — no
  lockstep registry; `skuChainId(sku)` in store.js computes it, `skuFromChainId` reverses it over live +
  RETIRED skus). A REAL payment for a retired/unknown sku **HOLDS THE CURSOR** (re-thrown, not
  poison-skipped) so a human looks — money arrived for something we don't sell. **Deploy:** the Safe
  calls `setPackagePrice(skuChainId(sku), wei)` per live sku in lockstep with the backend
  `STORE.PACKAGES` prices, and sets `OMERTA_FEES_ADDRESS` on the worker.
- **Liquidity bonds** (LP-token deposits) — launch-gated (§0.3).
- **The tokenized-stock layer** — RETIRED 2026-07-31 (`omerta-stock-layer-retirement.md`) and
  **REINSTATED 2026-08-10** (`omerta-brokers-design.md`, founder decision). The treasury BUYS tokenized
  stock, `allocated ≤ held` (per ticker, in units) holds, and `StockVault` (now in the audit batch, §2c)
  is the GATELESS delivery leg. The BACKEND is now COMPLETE: the buy keeper (`runStockBuyback`), the
  per-account allocation ledger (`allocateStock` + nightly `runTreasuryInvariants`), and the delivery
  keeper (`runStockDeliveryKeeper`, 2026-08-15 — §2c) that drives `StockVault.deliver` are all built
  and chain-dormant. The ETH VAULT is the same shape one asset over
  (`omerta-stock-layer-retirement.md`) — allocation-only, same asset both sides.

## 7b. Standing duty — reconcile the treasury Safe against what the vault owes

The vault (`omerta-stock-layer-retirement.md`) lets a player burn earned $OMR to claim allocation of
**ETH the treasury holds**. `allocated ≤ held` is enforced in code and alarmed nightly, and it proves the
vault never owes more than the books say **arrived**. It cannot prove the ETH is **still there** — the
treasury Safe is a wallet a human controls, and ETH spent out of it writes no row in this database.

So this is an operational duty, not a code guarantee:

- `GET /v1/mod/treasury` publishes **`safeMustHold`** — the ETH currently allocated to players. The
  /admin dashboard renders it beside the wall's ✓/⚠.
- **The treasury Safe's real balance must never fall below `safeMustHold`.** Spending down to it is
  spending players' allocation.
- Reconcile on the same cadence as any other treasury movement, and before any withdrawal from the Safe.

The vault is allocation-only today (nothing is delivered), so a shortfall is a broken promise rather than
a failed payment — which is exactly the window in which it is cheap to fix.

## 8. Rollback / kill switches
- Every contract is **pausable** by the Safe (`pause()`), stopping claims/bonds/fees without touching balances.
- The rails are **dormant-by-unsetting**: remove `CHAIN_RPC_URL` (or a specific address var) and that rail goes
  quiet — the off-chain game keeps running unaffected.
- The **withdrawal queue** (`chain_reserve`) never signs beyond `funded_omr`; a queued-but-unsigned withdrawal is
  cancellable (`POST /v1/withdraw/:id/cancel`, reverses the burn net-0). `sweep()` on VoucherClaim/OmertaBond can
  reclaim only the UNCOMMITTED tranche (never OMR backing outstanding obligations).
- **Stopping issuance** has two independent switches, either of which is one transaction from the Safe and
  neither of which touches a balance or a bonder's vested claim: `OMR.setMinter(address(0))` revokes the mint
  privilege at the token, and `OmertaBond.setMaxRate(0)` fails every new bond closed at the bond contract. Use
  the token-side one if the bond contract itself is what you distrust.
- **ROTATING THE VOUCHER SIGNER IS FOUR TRANSACTIONS, NOT ONE (red-team C1).** `VOUCHER_SIGNER_PK` is a
  single backend key and it signs for **four** contracts, each of which stores its own `signer` and must be
  rotated separately. There is no shared registry on purpose (one more contract, one more audit surface, one
  more single point of failure), so the containment is this list — and a PARTIAL rotation silently leaves a
  door open, with nothing on-chain to tell you which. On any suspicion, in this order:
  1. `VoucherClaim.pause()` · `OmertaBond.pause()` · `DynastyNFT.pause()` · `StreetDeed.pause()` — stops new
     issuance everywhere first, so the rotation is not a race. (`StreetDeed.redeem()` deliberately still works;
     a pause must never trap a holder's asset.)
  2. `setSigner(newSigner)` on **all four**: `VoucherClaim`, `OmertaBond`, `DynastyNFT`, `StreetDeed`.
  3. Rotate `VOUCHER_SIGNER_PK` on the API (the worker does not sign), redeploy, then unpause.
  Until step 2 completes on every one, pre-signed vouchers stay valid at whichever contract was missed, bounded
  only by that contract's own `dailyCap*` and `MAX_*_TTL` — so the blast radius of the key is the SUM of the
  four daily caps, which is the number to size them against rather than each in isolation.
- **RECOVERING A STRANDED DEED VAULT (founder-directed 2026-08-16).** Burning a Street Deed **freezes** its
  ERC-6551 vault, it never empties it: the account's address is a pure function of the tokenId, the tokenId is
  `keccak(NAME)`, and nothing ever deletes a `street_deeds` row or frees its unique name — so re-minting the
  same street restores control with the contents intact (`test_the_same_street_re_extracts_to_the_same_id_after_a_burn`).
  In the ordinary case **nobody has to act**: the re-import stays `pending` and `sweepDeedReimports` retries it
  every worker tick, forever, until the burner links a wallet or frees their deed slot.
  The case that never resolves is a burn from a wallet that will **never** link — a lost key, a redeem from the
  wrong address, a player who does not come back. Then real stock sits frozen at a known address with no route.
  - `GET /v1/mod/deeds/stranded` lists what is genuinely stuck (and how long it has waited).
  - `POST /v1/mod/deeds/recover {street}` signs a `DeedVoucher` for that street to **`DEED_RECOVERY_ADDRESS`**,
    the treasury holding address. Claim it from that wallet: it re-mints the SAME tokenId, which unfreezes the
    vault. Returning a recovered street to a player is a **separate, deliberate act** by whoever holds the
    treasury — deliberately not something this route can be aimed at.
  - Four walls, because the lever is strong: the destination is fixed (never caller-supplied), only a deed with
    a **recorded burn** still in the on-chain state qualifies (so it can never be a confiscation — and the
    contract backstops it, since `_safeMint` reverts on a live id), not before `DEED_RECOVER_AFTER_MS` (30d
    default — the wait is what distinguishes stranded from in-flight), and it **supersedes** the pending
    re-import so the sweep can never later hand the street to the burner while the treasury holds the NFT.
  - It is mod-gated, so every recovery lands in `mod_actions`. **Set `DEED_RECOVERY_ADDRESS` before you need
    it**; unset, the route refuses rather than guessing a destination.
- **VESTING IS A PRODUCT FEATURE, NOT A SECURITY CONTROL — do not count it as one.** There is deliberately no
  minimum `vestSeconds`, and adding one would buy nothing: `claim()` is intentionally NOT `whenNotPaused`, so
  pausing stops new bonds but never stops already-vested OMR being claimed — a vest is therefore not a window in
  which the Safe can intervene, only a window in which an attacker waits. And the blast radius is `dailyCapOMR`
  whatever the vest is: a vest changes WHEN the capped amount lands, not HOW MUCH. `npm run dials` sizes the cap
  on the assumption it is realised immediately, which is the conservative reading and stays correct with no
  minimum. The server signs the full `BONDS.VEST_HOURS` for honest bonders; a floor would only constrain them.
  (Decided in `AUDIT-oracle.md`.)

---
*Off-chain alpha ships independently of all of this — see `DEPLOY.md`. This runbook is the chain rail only, and
mainnet stays blocked on §0's three gates.*
