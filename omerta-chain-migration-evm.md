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

## M6-B — the backend chain service (NOT yet built)

The backend half stays isolated: the chain service's only DB write is the
`vouchers` table (spec §11 blast-radius rule). Planned work:

1. `vouchers` table + a `POST /v1/withdraw` (and `/gear/:id/mint`) that debits the
   in-game balance through the normal ledger, allocates a server-unique `nonce`,
   and signs an EIP-712 `Voucher` on **viem** in exact parity with
   `VOUCHER_TYPEHASH` / the domain `OmertaVoucherClaim`/`1` (snippet in
   `omerta-contracts/README.md`). Hand `(voucher, signature)` to the client.
2. A watcher on the `Claimed(nonce, …)` event that flips `claimed_onchain`.
3. Wallet-link verification: an EVM sign-in-with-Ethereum challenge (replaces the
   deferred DAS check `growth.js:linkWallet` notes) before the `ob_wallet` reward.
4. The buyback bot (EVM DEX from the Safe) — design + guardrails.

Env the service will need (placeholders in `.env.example`): `VOUCHER_SIGNER_PK`,
`VOUCHER_CLAIM_ADDRESS`, `CHAIN_ID`, `CHAIN_RPC_URL`.

## Before mainnet (non-negotiable)
Third-party audit of all four contracts **and** the signing service; counsel review
of Robinhood Chain ToS re: wagering-adjacent dApps; a Safe signer ceremony; and
daily-cap + tranche sizes set deliberately small for launch.
