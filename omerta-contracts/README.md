# OMERTÀ Contracts — M6-A

Four contracts for Robinhood Chain (Arbitrum Orbit L2, ETH gas; testnet chainId 46630, mainnet 4663). Chain-agnostic EVM — deployable unchanged to Arbitrum One/Base as fallback. See `omerta-chain-migration-evm.md` in the backend repo for the architecture.

| Contract | Role |
|---|---|
| `OMR.sol` | Fixed-supply ERC-20 + Permit. No owner, no mint. Inert by design. |
| `VoucherClaim.sol` | THE bridge. EIP-712 vouchers signed by the game server; replay-proof, deadline-bound, daily-capped, pausable, tranche-funded. Nothing mints. |
| `GearVault.sol` | ERC-1155 gear (one tokenId per gear class). Mints only via VoucherClaim. |
| `OMRStaking.sol` | 14% APY (owner-set, 50% hard ceiling), pre-funded reward pool, principal always withdrawable. |

## Test & deploy
```
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts   # first run only
forge test           # 15 tests incl. fuzz (tranche invariant, tampering, replay, caps)
export SAFE=0x... SIGNER=0x... RPC=https://robinhood-testnet.g.alchemy.com/v2/KEY
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $DEPLOYER_PK
```

## Server-side signing parity (for M6-B, viem)
The chain service must produce signatures `VoucherClaim.claim` accepts:
```ts
import { privateKeyToAccount } from 'viem/accounts';
const account = privateKeyToAccount(process.env.VOUCHER_SIGNER_PK);
const signature = await account.signTypedData({
  domain: { name: 'OmertaVoucherClaim', version: '1', chainId: 46630,
            verifyingContract: VOUCHER_CLAIM_ADDRESS },
  types: { Voucher: [
    { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' },
    { name: 'kind', type: 'uint8' }, { name: 'gearId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ] },
  primaryType: 'Voucher',
  message: { to, amount, kind, gearId, nonce, deadline },
});
```
`nonce` = the `vouchers.nonce` column (server-unique). Store `signed_payload`, hand `(voucher, signature)` to the client, watch `Claimed(nonce,...)` to set `claimed_onchain`.

## Before mainnet (non-negotiable)
Third-party audit of all four contracts + the signing service; counsel review of Robinhood Chain ToS re: wagering-adjacent dApps; Safe signer ceremony; daily cap + tranche sizes set deliberately small for launch.
