# OMERTÀ chain migration: Solana → Robinhood Chain (EVM)

M6 was originally specced (spec §11) against Solana. It is being rebuilt on
**Robinhood Chain** — an Arbitrum Orbit L2 (ETH gas; testnet chainId `46630`,
mainnet `4663`). The contracts are chain-agnostic EVM and deploy unchanged to
Arbitrum One / Base as fallback targets.

The off-chain game stays authoritative and value-conserving exactly as before
(spec §10.4). The chain only settles **withdrawals and ownership proofs**; the
"nothing mints" rule carries over verbatim into every contract.

## What changed vs. the old Solana plan

| Concern | Old (Solana, spec §11) | New (Robinhood Chain / EVM) |
|---|---|---|
| Contracts / tooling | Anchor programs (Rust) | Solidity 0.8.26 + Foundry (`omerta-contracts/`) |
| Voucher signature | Ed25519 signed `(account, kind, amount, nonce)` | **EIP-712** typed `Voucher`, ECDSA `secp256k1`, verified in `VoucherClaim.claim` |
| Token | SPL token | fixed-supply **ERC-20 + Permit** (`OMR.sol`), minted once to the treasury Safe |
| Gear NFTs | Metaplex Bubblegum cNFTs | **ERC-1155** (`GearVault.sol`), one tokenId per gear class, mint gated to `VoucherClaim` |
| Staking | off-chain (M2), on-chain planned | `OMRStaking.sol` — pre-funded reward pool, 50% APY ceiling, principal always withdrawable |
| Holdings verification | DAS API | EVM `balanceOf` (ERC-20) / `balanceOf(addr,id)` (ERC-1155) via RPC |
| Buyback bot | Jupiter (Squads multisig, Pyth prices) | an EVM DEX from the treasury Safe (bot design deferred to M6-B) |
| Wallet address | base58 (already validated in `growth.js:linkWallet`) | EVM `0x…` checksummed address; the signature-challenge + on-chain holdings check land with M6-B |
| Blast-radius model | server writes only `vouchers`; compromised bot can't mint gameplay value | unchanged intent: a compromised **signer** is bounded by the tranche + daily cap (OMR) **and a per-gearId supply cap (gear, fail-closed — see `AUDIT-contracts.md`)**, and revocable by the Safe |

## M6-A — on-chain (delivered, in `omerta-contracts/`)

`OMR` (inert ERC-20), `VoucherClaim` (the only bridge — replay-proof, deadline-
bound, daily-capped, pausable, tranche-funded), `GearVault` (mint gated to
VoucherClaim), `OMRStaking`. 15 Foundry tests incl. fuzz. Deploy via
`script/Deploy.s.sol`. See `omerta-contracts/README.md`.

## M6-B — the backend chain service (BUILT — `src/chain.js`, `test/chain.js`)

The backend half stays isolated: the chain service's only DB writes are the
`vouchers`, `chain_reserve`, and `wallet_challenges` tables plus the one
`withdraw:omr` ledger row (spec §11 blast-radius rule). Delivered:

1. **`vouchers` table + `POST /v1/withdraw`** (and `POST /v1/gear/:id/withdraw`) that
   debits the in-game balance through the normal ledger (`withdraw:omr`, a
   §10.4-legal $OMR burn recognized in `invariants.js`), allocates a server-unique
   `nonce` from the `chain_reserve` singleton, and signs an EIP-712 `Voucher` on
   **viem** in exact parity with `VOUCHER_TYPEHASH` / the domain
   `OmertaVoucherClaim`/`1` (chainId from `CHAIN_ID`, `verifyingContract` =
   `VOUCHER_CLAIM_ADDRESS`). `test/chain.js` recovers the signer from a real voucher
   to prove parity. `(voucher, signature)` is returned to the client.
2. **The full-reserve withdrawal queue (D1).** $OMR withdrawal signs only when
   `signedOutstanding + amount ≤ funded_omr`; otherwise the voucher is `queued`
   (already debited in-game, but unsigned — no double-spend). `POST /v1/mod/reserve/fund`
   adds a tranche and drains the queue FIFO; `GET /v1/withdraw/status` and
   `GET /v1/mod/reserve` expose the reserve ratio. Gear vouchers are **not**
   reserve-bounded (the contract's per-`gearId` supply cap bounds them). Deadlines
   are `now + 24h`, safely under the contract's `MAX_VOUCHER_TTL`.
3. **A `Claimed(nonce, …)` watcher** in the worker (viem `watchEvent`) that calls
   `markClaimed` to flip `claimed_onchain` and free the reserve. Dormant unless
   `CHAIN_RPC_URL` + `VOUCHER_CLAIM_ADDRESS` are set.
4. **SIWE wallet-link verification** (`POST /v1/wallet/challenge` → sign →
   `POST /v1/wallet/verify`, replacing the deferred DAS check
   `growth.js:linkWallet` noted) before the `ob_wallet` reward — enforces 0x
   checksummed + wallet uniqueness; a malformed signature is a clean 400.

Still deferred: **the buyback bot** (EVM DEX from the Safe — design + guardrails) and
the devnet deploy/wiring.

Env the service needs (placeholders in `.env.example`): `VOUCHER_SIGNER_PK`,
`VOUCHER_CLAIM_ADDRESS`, `CHAIN_ID`, `CHAIN_RPC_URL`.

## M6-C — inbound entry/revive fees (BUILT — `OmertaFees.sol`, `src/fees.js`)

The first value that flows *into* the chain boundary. Two flat native-ETH fees, both
forwarded straight to the developer wallet on-chain (nothing is custodied, nothing minted):

- **0.01 ETH mint (two-tier onboarding).** Anyone plays a free trial character; paying the
  mint fee grants a mint credit, and `POST /v1/character/mint` spends it to make the
  account `minted` — the permanent, on-chain-eligible tier. **Only a minted account can
  withdraw $OMR or take gear on-chain** (the M6-B withdrawal paths gate on it). Applies to
  agents too. The "made" status is mirrored onto the living character and carried to heirs
  through the estate.
- **0.10 ETH pre-paid revive insurance.** Grants a `respawn_token`; a killing blow (§7.7)
  consumes one to absorb the hit — full heal, keeps everything, the shooter's blow lands on
  nothing — instead of permadeath. Bought ahead of time because death is atomic (can't
  pause mid-transaction to collect a fee). Mod-kills bypass insurance by design.

Mechanism: `OmertaFees` (Safe-owned, ReentrancyGuard) enforces the exact fee, forwards the
ETH, and emits `MintFeePaid`/`RespawnFeePaid` with a monotonic nonce. The worker's fee
watcher (dormant unless `CHAIN_RPC_URL` + `OMERTA_FEES_ADDRESS`) calls
`fees.recordFeePayment`, idempotent on the nonce, which credits the paying wallet's account.
Pay-before-link is reconciled when the wallet links (SIWE). **Real ETH is out-of-band
value** — it never enters the §10.4 in-game conservation set, so `fees.js` writes no ledger
rows and a revive that skips the estate moves no in-game value.

Env (placeholders in `.env.example`): `OMERTA_FEES_ADDRESS`, `DEV_WALLET`, `MINT_FEE_WEI`
(0.01 ETH), `RESPAWN_FEE_WEI` (0.10 ETH). Fees are owner-settable on-chain post-deploy.
Deferred: devnet deploy + wiring, and `forge test` on the new `OmertaFees` suite (the
Foundry VM was not run this session).

## Before mainnet (non-negotiable)
Third-party audit of all four contracts **and** the signing service; counsel review
of Robinhood Chain ToS re: wagering-adjacent dApps; a Safe signer ceremony; and
daily-cap + tranche sizes set deliberately small for launch.
