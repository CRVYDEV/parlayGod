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
   *"Batch, not dribble" (`omerta-dynasty-machine-design.md`) means the scope must be KNOWN before it
   is sent. Enumerated 2026-08-11; `forge test` **185/185** green on this exact set.*

   **In the batch — 14 contracts + 1 interface, 2,584 lines, every one carrying tests:**

   | subsystem | contracts | the thing to attack |
   |---|---|---|
   | the $OMR rail | `OMR`, `VoucherClaim`, `GearVault`, `OMRStaking`, `OmertaFees` | the mint path (rule 2) and the two supply caps that survive a minter swap |
   | issuance | `OmertaBond`, `OmrTwapOracle`, `GenesisOracle`, `IOmrOracle` | the four walls, and specifically that 3 and 4 COMPOSE rather than substitute |
   | the market | `OmertaHook` | the pool gate, the `afterSwap` delta, the absence of a pause |
   | THE BANK | `Denari` (the DNR debt token, né `nUSD`), `CollateralEscrow`, `Alchemist`, `Transmuter`, `FlashGuard` | that no oracle sits on the borrow path and no `liquidate()` exists anywhere — the design's central claim, and the class that cost Inverse ~$21M twice |

   **NOT in the batch, each for a different reason** — worth stating, because "we forgot it" and "we
   deliberately held it" look identical from outside:
   - **`DynastyNFT` + the ERC-6551 wiring** — *written? no.* Held on an OPEN launch-checklist row: the
     published tranche schedule changed what that row is about, and its answer can change a
     contract-level constant (whether an uncapped collection with published escalating pricing holds
     up). Writing it first risks auditing the wrong contract.
   - **`StockVault` (delivery)** — *written? no.* Brokers step 7, gated on the **claim-rail parameters**
     (the eligibility list + verification depth), which are still owed even though the surface itself is cleared.
   - **`MerkleDistributor`** — *written? no.* Only exists under launch **D1 variant (a)**; variant (b)
     (in-game SIWE credit, the recommendation) needs no contract at all. Do not write it before D1.

   **The boundary this draws, and the founder's call:** that row is externally blocked, so holding the whole
   batch for `DynastyNFT` holds the chain rail — withdrawals, bonds, fees, the hook, the Bank — behind
   a question only the launch review can answer. Sending what is written now and the NFT later is **two**
   engagements, which is the minimum reachable given that block; it is not the dribble the discipline
   warns about. **`GenesisOracle` was written specifically so it would not become a third** — it is
   launch-blocking (the genesis window bonds before the pool its TWAP would read exists), it carries no
   launch gate at all, and it was the one contract the launch plan needed that nobody had enumerated.
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
   **What is live TODAY is narrower than either framing suggests, and that is the operative fact:** the
   treasury BUYS and the wall (`allocated ≤ held`, per ticker, in units) holds, but **nothing is
   delivered to anybody** — `StockVault` is unwritten and there is no claim route to find. The ETH
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
      GearVault, OMRStaking, OmertaFees, OmertaBond, OmrTwapOracle, GenesisOracle, OmertaHook + THE BANK (185 tests, seven fuzzes).
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
- [ ] **Arm the DEX sell tax (after the pool exists):** `OMR.setTaxRecipients(devWallet, rwaWallet, lpWallet)` →
      `setExempt` for the POL manager + OmertaBond + VoucherClaim + the Safe → `setPair(pool, true)` →
      `setSellTax(bps, devBps, rwaBps)` — the total is hard-capped at 10% and defaults to 0 = off; LP takes
      the remainder after dev + rwa. **Path A: ship `setSellTax(900, 200, 160)`** (dev 200 / rwa 160 / lp
      remainder), matching `deploy/fee-splits.env`'s `SELL_TAX_RWA_BPS=160`. The **community slice (240 bps
      of trade) is a BACKEND carve** in `recordSellTax` — it is NOT a 4th on-chain recipient, so the
      community's ETH physically sits in the LP wallet and is drawn by the family-buyback keeper; wire that
      keeper's source wallet as part of the wallet topology (same class as the treasury/Vig key separation
      in §0.5). Only transfers INTO registered pools are taxed; buys and wallet transfers are clean. **HARD REQUIREMENT: the canonical pool must be
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
- [ ] Backend: set `ALCHEMIST_ADDRESS` + `ALCHEMIST_ASSET` + `ALCHEMIST_ASSET_DECIMALS` so the worker
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
| `ALCHEMIST_ADDRESS` (+ `ALCHEMIST_ASSET`, `ALCHEMIST_ASSET_DECIMALS`) | THE BANK's harvest-fee sync → `bank_revenue` | only when the bank market ships |
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
      steps above; the sell-tax `setSellTax(900,200,160)` matches too, with the 240-bps community as a
      backend carve.

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
  - **Wire before arming:** `setRecipients(dev, rwa, lp)` → `setAllowedQuote(quote, true)` for each quote
    currency the Safe is willing to HOLD (the empty allow-list is the deploy default, and until it is set
    NO pool can be created on this hook at all) → `initialize` the pool → `setSellTax(900, 200, 160)`
    (Path A — rwa 400→160; the 240-bps community slice is a backend carve, see the OMR sell-tax step above).
    `setObserver` once the hook-native oracle exists.
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
- **The POL-pairing bot** (pairs the bonded ETH into the OMR-ETH pool) and **the DEX buyback bot** (the real
  TWAP source that replaces the manual `mod/vig/buyback` price).
- **The on-chain Store** — `OmertaFees.payForPackage` + a `StorePaid` watcher. The Store is off-chain/mod-driven
  today; the on-chain paywall is the mainnet Store milestone.
- **Liquidity bonds** (LP-token deposits) — launch-gated (§0.3). **R2/R3 (the real-stock buy bot, the
  reserve backing Dynasty shares, and the verified on-chain extraction) are RETIRED, not deferred** — the
  founder removed the stock layer 2026-07-31 (`omerta-stock-layer-retirement.md`); the treasury holds ETH
  and nothing in the game owes anybody a share.

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
