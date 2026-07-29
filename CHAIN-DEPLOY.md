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

1. **`forge test` passes on a real Foundry toolchain. ✅ EXECUTED 2026-07-23 — 73/73 PASS; 77/77 after
   tokenomics v2 step 4** (incl. both 512-run fuzzes: OMR sell-tax conservation + the OmertaBond
   anti-Ponzi bound) via the official
   npm-distributed forge 1.7.1 in the sandbox (`cd omerta-contracts && ./run-forge-test-sandboxed.sh`
   — forge-std/OZ from npm, solc via a solc-js 0.8.26 stdio shim: the emscripten build of the SAME
   compiler version+commit as native). The run surfaced and fixed a latent test-harness class (inline
   `_sign(...)` staticcalls consuming `vm.prank`/`vm.expectRevert` in OmertaBond.t.sol — 14 tests +
   one silently false-passing fuzz, all now genuinely exercising the contract). BELT-AND-BRACES: the
   third-party audit should re-run `./run-forge-test.sh` on an open-internet machine with NATIVE solc
   as part of its own verification — but the Foundry-VM gate itself is now green.
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
3. **Legal counsel sign-off** on the Risk-to-Earn / RWA line (see the "Sensitive design notes" in `CLAUDE.md`
   and the R2/R3 gating in `omerta-rwa-portfolio-design.md`). Jurisdiction/KYC/geofence for any RWA extraction.

Devnet + testnet rehearsal may proceed now. **Mainnet is blocked on 1 + 2 + 3.**

---

## 1. Build + test the contracts
- [ ] `cd omerta-contracts && ./run-forge-test.sh` → all `[PASS]` (Gate 0.1). Suite: OMR, VoucherClaim,
      GearVault, OMRStaking, OmertaFees, OmertaBond (incl. fuzz).
- [ ] No-Foundry compile path (artifacts for the deployer/e2e): `node tools/compile-contracts.js` → writes
      `omerta-contracts/out-js/` (used by `tools/chain-e2e.js`). Artifacts are gitignored — they must never
      drift from source; recompile before every deploy.

## 2. Deploy order + wiring (Safe-owned from deploy — no hot-deployer window)
Deploy with the deployer key, then immediately hand ownership to the Safe (§3). Mirror `tools/chain-e2e.js`
PHASE 1 for the exact calls/args.
- [ ] **`OMR(treasurySafe)`** — founding supply `100_000_000e18` minted once to the Safe. **No longer a
      fixed-supply token** (tokenomics v2 §4): it has ONE mint path, the `minter` address, which ships
      **unset (= minting off)** and is armed deliberately below. There is no owner mint.
- [ ] **`GearVault(safe)`** — ERC-1155; mint gated to VoucherClaim (set in the next step); per-`gearId` supply
      caps set by the Safe (set caps BEFORE signing any gear voucher — an uncapped id is fail-closed).
- [ ] **`VoucherClaim(omr, gearVault, signer, safe, dailyCapOMR)`** — the only $OMR bridge. Then
      `gearVault.setMinter(voucherClaim)` so gear mints route through it.
- [ ] **`OMRStaking(omr, safe)`** — pre-funded reward pool; principal always withdrawable.
- [ ] **`OmertaFees(devWallet, safe, mintFeeWei, respawnFeeWei)`** — the ETH tollbooth. Fees:
      `MINT = 0.01 ETH`, `RESPAWN = 0.10 ETH`, `reroll` defaults to `mintFee` (owner-settable). Forwards ETH to
      the dev wallet in-tx; custodies nothing.
- [ ] **`OmertaBond(safe, signer, omr, polBps=3750, devBps=1500, polRecipient, devRecipient, vigRecipient,
      dailyCapOMR, maxOmrPerEth)`** — POL bonding with the four-way ETH split (37.5% POL / 15% dev wallet /
      22.5% Vig / 25% RWA-float; the RWA slice is mirrored off-chain by the backend from the `Bonded` event,
      the on-chain forward is POL + dev + Vig). **This contract MINTS** — see below. Keep
      `polBps`/`devBps`/`maxDiscountBps` in lockstep with the backend `BONDS.*` in `src/rules.js`.
      **Run `npm run dials` FIRST for the two cap arguments** — they derive from LIVE POOL DEPTH and are
      not fixed numbers. At a 100-ETH pool it gives `dailyCapOMR` **~27,000 OMR/day** (≈5% of the pool's
      OMR reserve, sized so a full day's cap dumped moves the price ≤10%) and `maxOmrPerEth` **~15,000**
      (3× the launch price — a circuit breaker, not a price). Re-run it whenever POL materially deepens
      and raise the cap with it.
- [ ] **`OmrTwapOracle(safe, omrWethPair, omr, period)`** — WALL 4's price feed, deployed AFTER the pool
      exists (it reads that pool's cumulative price). `period >= MIN_PERIOD` (10 min); **30 min
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
      but it does mean **the keeper is a production dependency, not a nice-to-have**.
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
      the remainder after dev + rwa. Ship the backend's `SELL_TAX` values (900 total = 200 dev / 400 rwa /
      300 lp) so the two layers agree about where the money went. Only transfers INTO registered pools are
      taxed; buys and wallet transfers are clean. **HARD REQUIREMENT: the canonical pool must be
      Uniswap V2-COMPATIBLE** (sell-taxed tokens need the *SupportingFeeOnTransferTokens router path;
      Uniswap V3 does not support them). RESOLVED (verified July 2026): Uniswap deployed **v2, v3, v4 +
      UniswapX on Robinhood Chain at its July 1, 2026 mainnet launch** — so a V2 pool is available. Still
      CONFIRM ON-CHAIN at deploy: pull the addresses from Uniswap's deployment docs
      (developers.uniswap.org → Robinhood Chain deployments) and run `node tools/check-dex.js` against
      the live RPC (probes bytecode + the right view calls; prints a go/no-go verdict for the taxed pool).

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
| `TRADE_FEE_HOOK_ADDRESS` | the afterSwap→Vig trade-fee sync | only when the DEX hook ships |
| `MINT_FEE_ETH` / `RESPAWN_FEE_ETH` | the PLEX price quote | ETH-denominated; keep == the contract fees |
| `WALLETCONNECT_PROJECT_ID` | the console's **WalletConnect (mobile)** option — the ONLY way a phone can link a wallet (desktop browser wallets are auto-discovered via EIP-6963 and need nothing) | a PUBLIC WalletConnect/Reown project id, free from https://dashboard.reown.com; unset ⇒ the console hides the option. Surfaced in `/v1/rules`. Not chain-gated: linking is a signature, so the chain is requested as OPTIONAL and a wallet that has never heard of the OMERTÀ chain still connects |
| `PLEX_MINT_OMR` / `PLEX_RESPAWN_OMR` | PLEX floor prices | sign-off levers |
| `VIG_BPS` / `VIG_RESERVE_BPS` / `VIG_MAX_PRICE_JUMP` | Vig split + the buyback price-sanity bound | — |

**`ALLOW_MOD_REAL_REVENUE` — leave UNSET/off in production.** It is a QA-only flag that lets the mod
comp/simulate routes inject *real* revenue; in prod the ONLY legitimate real-revenue source is a real on-chain
event carrying a txHash (fees, trade fees, `Bonded`). With it off, a comp books zero POL/Vig — no fabricated,
unbacked reserve. (Red-team D-MED2.)

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
      `Bonded` fires, `💱 trade-fee sync` if the hook is live) and the cursors persist (`chain_cursor`).
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
- **The POL-pairing bot** (pairs the bonded ETH into the OMR-ETH pool) and **the DEX buyback bot** (the real
  TWAP source that replaces the manual `mod/vig/buyback` price).
- **The on-chain Store** — `OmertaFees.payForPackage` + a `StorePaid` watcher. The Store is off-chain/mod-driven
  today; the on-chain paywall is the mainnet Store milestone.
- **Liquidity bonds** (LP-token deposits), **R2** (real-RWA buy bot + reserve backing Dynasty shares), **R3**
  (KYC'd on-chain RWA extraction) — all legal-gated (§0.3).

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
