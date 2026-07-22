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

1. **`forge test` passes on a real Foundry toolchain.** The build sandbox egress-blocks Foundry's hosts, so
   the suite has only ever been *compiled* here (`tools/compile-contracts.js`, solc 0.8.26, 0 warnings) — never
   run. On any machine with open internet: `cd omerta-contracts && ./run-forge-test.sh` (installs Foundry, pins
   OZ v5.6.1 + forge-std v1.9.6, runs `forge test -vvv --fuzz-runs 512`). Every test must read `[PASS]`.
2. **A third-party audit of the CONTRACTS *and* the off-chain EIP-712 signer.** The signer (`src/chain.js`) is
   as security-critical as the contracts — it mints withdrawal authority. Audit both.
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
- [ ] **`OMR(treasurySafe)`** — fixed-supply `100_000_000e18` minted once to the Safe. Inert; no mint fn.
- [ ] **`GearVault(safe)`** — ERC-1155; mint gated to VoucherClaim (set in the next step); per-`gearId` supply
      caps set by the Safe (§ set caps BEFORE signing any gear voucher — an uncapped id is fail-closed).
- [ ] **`VoucherClaim(omr, gearVault, signer, safe, dailyCapOMR)`** — the only $OMR bridge. Then
      `gearVault.setMinter(voucherClaim)` so gear mints route through it.
- [ ] **`OMRStaking(omr, safe)`** — pre-funded reward pool; principal always withdrawable.
- [ ] **`OmertaFees(devWallet, safe, mintFeeWei, respawnFeeWei)`** — the ETH tollbooth. Fees:
      `MINT = 0.01 ETH`, `RESPAWN = 0.10 ETH`, `reroll` defaults to `mintFee` (owner-settable). Forwards ETH to
      the dev wallet in-tx; custodies nothing.
- [ ] **`OmertaBond(omr, signer, polRecipient, vigRecipient, safe, polBps=6000, maxDiscountBps=2000, maxVest,
      dailyCapOMR)`** — POL bonding; the tranche cap is `committedOMR + payout ≤ omr.balanceOf(this)` (never
      mints). Keep `polBps`/`maxDiscountBps` in lockstep with the backend `BONDS.*` in `src/rules.js`.
- [ ] **Fund the on-chain tranches (a plain OMR transfer — the contracts NEVER mint):** transfer OMR from the
      Safe into `VoucherClaim` (backs signed withdrawal vouchers) and into `OmertaBond` (backs bond payouts).
      The contract's `balanceOf` IS its cap.

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
| `WALLETCONNECT_PROJECT_ID` | the console's **WalletConnect (mobile)** option (Robinhood Wallet / MetaMask Mobile) | a public WalletConnect Cloud project id; unset ⇒ the console hides the option. Surfaced in `/v1/rules`; set `CHAIN_ID` too so it requests the right chain |
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
- [ ] `POST /v1/mod/bond/fund` → set `bond_reserve.capacity_omr` to match the OMR held by `OmertaBond`.
      NOTE: the `Bonded` watcher **bypasses** this backend tranche cap on ingest (the contract already enforced
      its own identical cap), so a real bond is always recorded and can never stall the sync cursor — but you
      must keep `capacity_omr` funded to match, or `GET /v1/mod/bonds` (`runBondInvariants`) reports the
      shortfall. Same discipline for `runVigInvariants` / `GET /v1/mod/vig` (extraction ≤ inflow).

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

---
*Off-chain alpha ships independently of all of this — see `DEPLOY.md`. This runbook is the chain rail only, and
mainnet stays blocked on §0's three gates.*
