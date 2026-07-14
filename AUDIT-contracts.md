# OMERTÀ M6-A (Solidity) — Security Audit — 2026-07

An adversarial red-team pass over the four Robinhood Chain contracts
(`omerta-contracts/`). Two specialists swept the bridge/token and the
gear/staking/deploy surface; every finding was re-verified against the source.

**Environment caveat:** `forge` could not be installed here (egress policy blocks the
installer + GitHub release binaries). The whole suite (`src` + `test` + `script`) **was
compiled clean** — 0 warnings — with `solc 0.8.26` + OpenZeppelin v5.6.1 + forge-std, so
the patches and new tests are type-correct. But solc only *compiles*; the Foundry VM
(cheatcodes/assertions) was **not executed**, so the test assertions are runtime-unverified.
Run `forge test` locally (the 15 prior tests + the new gear-cap / deadline cases) before
the third-party audit.

## Patched

| # | Severity | Contract | Finding | Fix |
|---|----------|----------|---------|-----|
| F-1 | **HIGH** | VoucherClaim / GearVault | Gear mints were uncapped and untranched — the daily cap + tranche bound `KIND_OMR` only, so a compromised signer could mint unlimited ERC-1155 gear of any (even unknown) class. This broke the suite's own "bounded blast radius" thesis for the gear leg. | Gear is now **fail-closed**: a per-`gearId` lifetime supply cap the Safe sets (`setGearSupplyCap`); a class with cap 0 cannot mint, and mints are counted against the cap. Bounds gear the way the tranche bounds OMR. |
| F-6 | MED-HIGH | Deploy / GearVault | The deploy script owned GearVault to the **deployer EOA** and two-step-transferred to the Safe, so a hot deployer/CI key controlled `setMinter` (→ unlimited gear) until — and forever if — the Safe accepted. The other three contracts own to the Safe directly. | GearVault is now constructed owned by the Safe; the deployer never holds mint authority. The Safe wires the minter + gear caps in its ceremony (minter unset = mint impossible, so no exposed window). |
| F-5 | LOW | VoucherClaim | `deadline` had no upper bound, so a leaked-then-rotated key's pre-signed far-future vouchers stayed claimable indefinitely. | Added a `MAX_VOUCHER_TTL` (30 days) backstop in `claim`, tightening the leaked-key window. |
| F-3 | MED (docs) | README (M6-B guidance) | The viem signing snippet hardcoded `chainId: 46630`; deploying to Robinhood **mainnet 4663** / Arbitrum One / Base (all "supported unchanged") would make every claim revert `bad signature`, because the on-chain EIP-712 domain uses the real chainId. | Snippet now derives `chainId` from the RPC (`publicClient.getChainId()`) with a warning never to hardcode it. |

New regression tests in `test/Omerta.t.sol`: `test_gear_uncapped_class_reverts`,
`test_gear_cap_enforced`, `test_set_gear_cap_only_owner`, `test_deadline_too_far_reverts`.

## Reviewed and found SOUND (both specialists, independently)

- **OMR rail / "never mints":** OMR claims are `safeTransfer` of pre-funded balance; draining past the tranche reverts and rolls back the nonce + daily total. Fuzz-pinned.
- **EIP-712:** typehash ↔ struct ↔ `abi.encode` ↔ viem snippet parity is exact; OZ `EIP712` re-derives the domain separator per (chainId, verifyingContract), so **no cross-chain or cross-contract replay** even at an identical address.
- **Signatures:** OZ v5 `ECDSA.recover` rejects malleable high-`s` and reverts (never returns `address(0)`) on bad input; `signer` is required non-zero; nonce set before any external call (checks-effects-interactions) + `nonReentrant`.
- **Reentrancy on the gear path:** `gear.mint` → `onERC1155Received` cannot re-enter `claim` (guarded) or touch the OMR cap / redirect funds; all state written before the call.
- **Front-running a claim:** `to` is signed, so an unrestricted `msg.sender` can only deliver value to the intended recipient at their own gas.
- **Staking:** `balance == totalStaked + rewardPool` holds; claims can never reach principal, unstakes never reach the pool; principal always withdrawable under a dry pool; no first-stake epoch bug; no overflow (checked math, values far within uint256); `uint64` timestamp safe to year ~2554; `fundRewards` permissionless is harmless (pulls the caller's own OMR); no share-inflation/first-depositor attack (absolute accounting).
- **OMR.sol:** fixed supply minted once to the Safe; no owner, no mint/pause; permit domain chain-bound. Inert as designed.
- **Deploy funding gap:** until the Safe funds the tranche/pool, claims simply revert; nothing at risk.

## Accepted as designed / documented (NOT patched — Safe is the root of trust)

Per the subtree's `CLAUDE.md` rule 5, these are audit-surface decisions for humans, or
are inherent to the trusted-Safe model; changing them unilaterally (or shipping an
unverified reward-math rewrite) would be worse than documenting:

1. **`sweep` / `pause` (VoucherClaim):** the Safe can pull the tranche or halt claims, stranding pending vouchers. Inherent to the tranche model; the Safe is the declared root of trust. Optionally route through a timelock.
2. **Global daily cap contention (F-2):** the OMR daily cap is one global bucket, so a single large claim can consume the day's headroom and delay (not brick — the tx reverts and rolls back) others. The **server controls issuance**, so keep per-day signed OMR below the cap; add a per-recipient sub-cap later if per-user fairness is needed on-chain.
3. **UTC-day boundary (F-4):** the cap resets at 00:00 UTC, so ~2× is drainable around the boundary — still bounded by the tranche.
4. **APY-change retroactivity (M-1, OMRStaking):** `setApy` re-rates each position's un-accrued elapsed time at the new rate (over- or under-paying past time; front-runnable by a `_accrue`-triggering call). Bounded by `MAX_APY_BPS` and the reward pool (can't mint). The robust fix is a MasterChef-style `accRewardPerStaked` accumulator — a substantial rewrite deliberately deferred rather than shipped unverified.
5. **Fee-on-transfer assumption (M-2):** staking credits the requested amount, not the received amount — safe only because OMR is a standard no-fee ERC-20 (it is). Documented assumption.
6. **`setMinter` repointable, no on-chain gear supply reads, all-or-nothing reward claim, no staking `sweep`** (L-1..L-4): owner-trust / UX niceties; optional timelock on `setMinter` and a floor-guarded staking `sweep` are reasonable future adds.
7. **`setSigner` rotation invalidates outstanding old-key vouchers** — the desired emergency behavior; the runbook should re-issue legitimate outstanding vouchers after a rotation.

**Bottom line:** the OMR value rail was already airtight; this pass closed the one hole
that broke the suite's own thesis — **uncapped gear minting** — and removed the
**hot-deployer mint-authority window**, plus two smaller hardenings. Run `forge test`
locally to confirm, and keep the third-party audit before mainnet.
