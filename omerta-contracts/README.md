# OMERTÀ Contracts — M6-A

Contracts for Robinhood Chain (Arbitrum Orbit L2, ETH gas; testnet chainId 46630, mainnet 4663). Chain-agnostic EVM — deployable unchanged to Arbitrum One/Base as fallback. See `omerta-chain-migration-evm.md` in the backend repo for the architecture.

| Contract | Role |
|---|---|
| `OMR.sol` | Fixed-supply ERC-20 + Permit. No owner, no mint. Inert by design. |
| `VoucherClaim.sol` | THE bridge. EIP-712 vouchers signed by the game server; replay-proof, deadline-bound, daily-capped, pausable, tranche-funded. Nothing mints. |
| `GearVault.sol` | ERC-1155 gear (one tokenId per gear class). Mints only via VoucherClaim, which is **fail-closed**: a gearId only mints up to a per-class supply cap the Safe sets (`vc.setGearSupplyCap`). |
| `OMRStaking.sol` | 14% APY (owner-set, 50% hard ceiling), pre-funded reward pool, principal always withdrawable. |
| `OmertaFees.sol` | The inbound entry/revive fee rail (§11). Forwards each exact ETH fee straight to the dev + Vig wallets in the same tx; custodies nothing, mints nothing; emits a nonce'd event the backend watches. |
| `OmertaBond.sol` | The Reserve Bond (Protocol-Owned Liquidity; design `omerta-reserve-bond-design.md`). ETH in → DISCOUNTED OMR out, vested linearly; the ETH is split (POL + Vig) and forwarded in-tx (custodies no ETH). **Nothing mints**: the payout TRANSFERS from a Safe-funded tranche — `committedOMR + payout <= omr.balanceOf(this)` is enforced at bond time, so total OMR bonded out is hard-capped by the funded balance (the Olympus reflexive-mint failure mode is structurally excluded). EIP-712 server-signed quotes (the VoucherClaim signer discipline); `MAX_DISCOUNT_BPS`/`MAX_VEST`/`MAX_QUOTE_TTL` backstops (a leaked-then-rotated signer's far-future quotes can't stay bondable); Safe-owned, pausable; `sweep` can pull only the UNCOMMITTED OMR tranche, never OMR backing outstanding bonds; `sweepETH` rescues any stray ETH to the Safe (the OmertaFees pattern). |

## Test & deploy
```
./run-forge-test.sh  # one-shot: installs Foundry + deps, builds, runs the suite (recommended)
```
or manually:
```
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts   # first run only
forge test           # 29 tests incl. a 512-run fuzz (tranche invariant, tampering, replay, caps)
export SAFE=0x... SIGNER=0x... RPC=https://robinhood-testnet.g.alchemy.com/v2/KEY
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $DEPLOYER_PK
```
> `forge test` has never executed inside the sandboxed build environment (Foundry's install
> hosts are egress-blocked there) — run it on any machine with open internet before the
> third-party audit. The suite compiles clean (solc 0.8.26 + OZ 5.6.1 + forge-std, 0 warnings).

## Server-side signing parity (for M6-B, viem)
The chain service must produce signatures `VoucherClaim.claim` accepts:
```ts
import { privateKeyToAccount } from 'viem/accounts';
const account = privateKeyToAccount(process.env.VOUCHER_SIGNER_PK);
const chainId = await publicClient.getChainId(); // NEVER hardcode: the on-chain EIP-712
                                                 // domain uses the deployed chain's id, so a
                                                 // wrong constant makes every claim revert
const signature = await account.signTypedData({
  domain: { name: 'OmertaVoucherClaim', version: '1', chainId,
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

### OmertaBond quote signing (backend `src/bonds.js` parity — mainnet wiring)
The bond service signs `BondQuote`s the contract accepts; domain `OmertaBond`/`1`, chainId from the live
chain (never hardcode), `verifyingContract` = the deployed `OmertaBond`. **On-chain/off-chain must not
drift:** the contract's immutable `polBps`/`devBps` == the backend `BONDS.POL_BPS`/`BONDS.DEV_BPS`, and `MAX_DISCOUNT_BPS` (2000) ==
`BONDS.MAX_DISCOUNT_BPS`. The backend prices `payout = principal × priceOmrPerEth / 1e18 × 1e4/(1e4−discountBps)`
(the exact integer math the contract recomputes), watches `Bonded(bondId, payer, nonce, principal, payout, toPol, toDev, toVig)`
→ `recordBond` (attributes/reconciles the bonder), and the `bond_reserve` tranche mirrors the on-chain
`committedOMR ≤ omr.balanceOf(bond)` cap.
```ts
const signature = await account.signTypedData({
  domain: { name: 'OmertaBond', version: '1', chainId, verifyingContract: OMERTA_BOND_ADDRESS },
  types: { BondQuote: [
    { name: 'payer', type: 'address' }, { name: 'principal', type: 'uint256' },
    { name: 'priceOmrPerEth', type: 'uint256' }, { name: 'discountBps', type: 'uint256' },
    { name: 'vestSeconds', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' } ] },
  primaryType: 'BondQuote',
  message: { payer, principal, priceOmrPerEth, discountBps, vestSeconds, nonce, deadline },
});
```

## Before mainnet (non-negotiable)
Third-party audit of all four contracts + the signing service; counsel review of Robinhood Chain ToS re: wagering-adjacent dApps; Safe signer ceremony; daily cap + OMR tranche + **per-gearId supply caps** (gear is fail-closed — no class mints until the Safe caps it) all set deliberately small for launch.

## Internal red-team pass (see `../AUDIT-contracts.md`)
Patched: gear mints are now bounded per class (was uncapped — a compromised signer could mint unlimited gear); GearVault is Safe-owned from deploy (no hot-deployer window); a `MAX_VOUCHER_TTL` deadline backstop; and the signer snippet no longer hardcodes a chainId. The OMR rail, EIP-712/replay, reentrancy, and staking pool-separation were reviewed and found sound. Accepted-as-designed (Safe is root of trust): sweep/pause, global daily-cap contention, APY-change retroactivity. The suite compiles clean (solc 0.8.26 + OZ 5.6.1 + forge-std, 0 warnings) but the producing environment had no `forge` — run `forge test` locally to execute the VM assertions.
