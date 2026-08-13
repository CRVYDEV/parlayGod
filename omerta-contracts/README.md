# OMERTÀ Contracts — M6-A

Contracts for Robinhood Chain (Arbitrum Orbit L2, ETH gas; testnet chainId 46630, mainnet 4663). Chain-agnostic EVM — deployable unchanged to Arbitrum One/Base as fallback. See `omerta-chain-migration-evm.md` in the backend repo for the architecture.

| Contract | Role |
|---|---|
| `OMR.sol` | ERC-20 + Permit. Founding supply `100_000_000e18` to the Safe, plus **ONE mint path**: a single `minter` address (the OmertaBond contract), set only by the owner and evented. **No owner mint** — the Safe chooses who may mint and can revoke it in one transaction (`setMinter(0)`), but cannot itself print. Also carries the owner-armed DEX **sell tax** (transfers INTO registered `ammPairs` only; split three ways dev/rwa/lp in-transfer; 10% compile-time hard cap; default 0). ⚠ Before tokenomics v2 step 4 this token was fixed-supply and inert — see `CLAUDE.md` rule 2 for what replaced that property. |
| `VoucherClaim.sol` | THE bridge. EIP-712 vouchers signed by the game server; replay-proof, deadline-bound, daily-capped, pausable, tranche-funded. Nothing mints. |
| `GearVault.sol` | ERC-1155 gear (one tokenId per gear class). Mints only via VoucherClaim, which is **fail-closed**: a gearId only mints up to a per-class supply cap the Safe sets (`vc.setGearSupplyCap`). |
| `OMRStaking.sol` | 14% APY (owner-set, 50% hard ceiling), pre-funded reward pool, principal always withdrawable. |
| `OmertaFees.sol` | The inbound entry/revive fee rail (§11). Forwards each exact ETH fee straight to the dev + Vig wallets in the same tx; custodies nothing, mints nothing; emits a nonce'd event the backend watches. |
| `IOmrOracle.sol` / `OmrTwapOracle.sol` | WALL 4's price feed. A Uniswap V2 cumulative-price **TWAP** (never spot — spot on a mint path is flash-loanable), behind a minimal swappable interface so the mint path stays reviewable and the feed can follow the canonical pool. `PERIOD` has a compile-time floor so a 30-second "TWAP" cannot be deployed; reports **no usable reading** until a full period has closed; `update()` is permissionless and **must be poked at least once per `maxOracleAge`** or bonding halts (a deliberate failure direction, and a real operational dependency). |
| `OmertaBond.sol` | The Reserve Bond (Protocol-Owned Liquidity; design `omerta-reserve-bond-design.md`). ETH in → DISCOUNTED OMR out, vested linearly; the ETH is split (POL + dev + Vig) and forwarded in-tx (custodies no ETH). **THE ONLY MINT IN THE SYSTEM** (tokenomics v2 §4 — the Safe-funded tranche it used to draw on is gone). FOUR walls replace the tranche and all four must survive review: `dailyCapOMR` (with no tranche, this is the entire blast radius of a leaked quote-signer, and 0 means UNLIMITED), `MAX_DISCOUNT_BPS` (2000, compile-time), `maxOmrPerEth` (an ABSOLUTE post-discount mint-RATE ceiling, **fail-closed at 0**), and the **accretion `oracle`** (a TWAP the signed quote's claimed market price must agree with, also fail-closed). **The property to review is the COMPOSITION of the last two**: the effective bound is `MIN(maxOmrPerEth, oracle x (1+tolerance) / (1-discount))`, so a manipulated oracle can only ever TIGHTEN what may be minted, never loosen it — which is what makes a price feed safe on a mint path. Setting tolerance and `MAX_DISCOUNT_BPS` to zero makes the wall the design's literal "accretive-only" rule; at non-zero values it is a bounded, market-tracking dilution ceiling, and should be described as that rather than as accretion. The payout is minted at BOND time, keeping `committedOMR <= omr.balanceOf(this)` true at every instant — so `sweep` still cannot touch OMR backing an outstanding bond and a claim can never fail for want of balance. EIP-712 server-signed quotes (the VoucherClaim signer discipline); `MAX_VEST`/`MAX_QUOTE_TTL` backstops (a leaked-then-rotated signer's far-future quotes can't stay bondable); Safe-owned, pausable; `sweepETH` rescues any stray ETH to the Safe (the OmertaFees pattern). |

| `OmertaHook.sol` | The Uniswap **v4 sell tax**, charged INSIDE the swap (economy v3 step 6; design `../omerta-v4-hook-design.md`). Same economics as `OMR.sol`'s transfer tax — dev/rwa/lp, same 900 bps, same 10% compile-time cap, same remainder-on-LP rule — but taken in the **quote currency**, which removes the reflexivity: the old tax collected OMR that had to be SOLD to pay anyone, and each of those sales was pressure on the pool being taxed. **BUYS ARE FREE.** Three properties an auditor should attack first: (1) `beforeInitialize` is a **pool gate** — anyone can create a pool naming this hook, so without it a stranger could stand up an (OMR, WORTHLESS) pool and emit real `SellTaxTaken` logs with real tx hashes, i.e. fabricated revenue wearing the credential the backend's anti-fabrication gate trusts; (2) the fee **accrues and is swept separately** rather than forwarded in-tx like `OmertaFees`, deliberately — three pushes inside a swap means one reverting recipient bricks the pool; (3) **there is no pause**, because a hook that can revert `beforeSwap` can halt a public market — the only lever is the rate. Permissions are mined into the address (`HOOK_FLAGS`, checked in the constructor) and are IMMUTABLE, which is why an unused `beforeSwap`/fee-override slot and an `observer` seam ship on day one. Exact-OUTPUT sells are taxed in OMR rather than the quote (v4 only lets `afterSwap` touch the unspecified currency) — parity with the tax it replaces, documented, not a bypass. |

## Test & deploy
```
./run-forge-test.sh  # one-shot: installs Foundry + deps, builds, runs the suite (recommended)
```
or manually:
```
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts   # first run only
forge test           # 128 tests incl. five 512-run fuzzes (anti-Ponzi, sell-tax conservation, the
                     #   four-wall mint-rate bound, TWAP decode overflow, hook fee-split dust)
export SAFE=0x... SIGNER=0x... RPC=https://robinhood-testnet.g.alchemy.com/v2/KEY
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $DEPLOYER_PK
```
> The suite **also runs inside the sandboxed build environment** — `./run-forge-test-sandboxed.sh`
> (forge from the official npm dist, forge-std/OZ from npm, solc via a solc-js 0.8.26 stdio shim:
> the same compiler version+commit as native, plus `@uniswap/v4-core` for the hook). First executed
> 2026-07-23 at 73/73; **128/128 green** after the v4 hook. The runner now prefers the NATIVE solc
> binary when `binaries.soliditylang.org` is reachable — and needs it: the emscripten build runs out
> of heap compiling v4's `PoolManager`, so on a shim-only box every suite runs EXCEPT
> `OmertaHook.t.sol`. The third-party audit should still re-run `./run-forge-test.sh` on an
> open-internet machine with NATIVE solc as part of its own verification.

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
Third-party audit of all eight contracts + the signing service; launch review of Robinhood Chain ToS re: wagering-adjacent dApps; Safe signer ceremony; VoucherClaim's daily cap + OMR tranche, OmertaBond's `dailyCapOMR` + `maxOmrPerEth`, and the **per-gearId supply caps** (gear is fail-closed — no class mints until the Safe caps it) all set deliberately small for launch.

⚠ **Point the auditor at tokenomics v2 step 4 explicitly.** Until 2026-07-29 this suite's headline
property was "nothing mints", and every prior review leaned on it. OMR now has a mint path and bonds
use it. What must be reviewed as new: `OMR.minter` (single path, owner-set, no owner mint),
OmertaBond's four walls, and `OmrTwapOracle`. **The single highest-value thing to attack is the
composition of walls 3 and 4** — a price feed on a mint path is normally the softest link, and the
claim here is that it cannot be: `maxOmrPerEth` is checked independently, so a manipulated oracle can
only tighten the bound. Break that and the mint is unbounded. Also worth attacking: the TWAP itself
(pool depth vs window length), and the keeper dependency (`update()` must be poked within
`maxOracleAge` or bonding halts).

## Internal red-team pass (see `../AUDIT-contracts.md`)
Patched: gear mints are now bounded per class (was uncapped — a compromised signer could mint unlimited gear); GearVault is Safe-owned from deploy (no hot-deployer window); a `MAX_VOUCHER_TTL` deadline backstop; and the signer snippet no longer hardcodes a chainId. The OMR rail, EIP-712/replay, reentrancy, and staking pool-separation were reviewed and found sound. Accepted-as-designed (Safe is root of trust): sweep/pause, global daily-cap contention, APY-change retroactivity. The suite compiles clean (solc 0.8.26 + OZ 5.6.1 + forge-std, 0 warnings) but the producing environment had no `forge` — run `forge test` locally to execute the VM assertions.
