# reference/ — audit-ready contract drafts (NOT compiled, NOT deployed)

This directory holds Solidity that is **deliberately outside the verified build**.
`tools/compile-contracts.js` globs `omerta-contracts/src/*.sol` only, so nothing here
is compiled, `forge test`ed, or bytecode-verified in this repo. These files do **not**
count as shipped, audited contracts — they are drafts that carry a real external
toolchain dependency this environment cannot satisfy.

## OmertaTradeFeeHook.sol

The afterSwap→Vig fee hook from `omerta-uniswap-hooks-design.md` §2: a Uniswap **v4**
hook on the OMR/ETH pool that skims a small fee off each swap's ETH leg, forwards it to
the Vig wallet in-tx (custody nothing, mint nothing), and emits
`TradeFeePaid(nonce, amountWei)` — so **every secondary-market trade of extracted $OMR
funds the redistribution pool** ("traders fund earners").

### Why it can't be built/tested here
1. **Uniswap v4 dep tree** — needs `@uniswap/v4-core` + `@uniswap/v4-periphery`
   (`BaseHook`, `IPoolManager`, `PoolKey`, `BalanceDelta`, `Currency`, `Hooks`, the
   flash-accounting `take`/`settle` surface). Not vendored here.
2. **Mined hook address (load-bearing)** — a v4 hook encodes its permission bits in the
   low bits of its **address**. An `afterSwap` hook must be CREATE2-deployed to an
   address whose flag bits match `getHookPermissions()`, or `PoolManager` rejects it at
   `initialize`. That is a Foundry `HookMiner` deploy-script concern — unrepresentable
   and unverifiable in a backend repo.
3. **Foundry** — `forge`'s GitHub-release binaries are egress-blocked in this
   environment (the standing suite residual), so even the `src/` contracts here are
   compiled via `tools/compile-contracts.js` (solc-js) and **`forge test` has not run**.

### What IS built, dormant, and tested (the off-chain half)
The backend rail this hook feeds is complete and green against a mock source:

| piece | file | proves |
|---|---|---|
| watcher stream | `src/watcher.js` `syncTradeFees` (stream `'trades'`, gated by `TRADE_FEE_HOOK_ADDRESS`) | confirmation-depth (reorg-safe), downtime backfill, cursor advance, idempotent replay — `test/watcher.js` |
| revenue rail | `src/vig.js` `recordTradeFee` → `recordVigRevenue(source='trade')` | VIG_BPS split, source+ref idempotency, §10.4 neutrality — `test/vig.js` |
| split invariant | `src/vig.js` `runVigInvariants` | `spend ≤ revenue` absorbs `source='trade'` unchanged |

**Security note (why there is no mod fabrication surface):** unlike fees/store/bonds,
there is **no mod route** that books `source='trade'` revenue. The on-chain watcher
observing a genuine `TradeFeePaid` log is the *sole* producer, so the D-MED2
`ALLOW_MOD_REAL_REVENUE` gate does not even apply here — the fabrication surface is zero
by construction.

### Pre-mainnet gate for this contract
Over and above the standing whole-suite gate (`forge test` must pass + third-party
audit of contracts **and** the signer):
1. resolve the v4 deps and get it compiling under Foundry;
2. write the `HookMiner` deploy script (mined address matching `afterSwap`-only
   permissions);
3. `forge test` the five §7-C properties (exact-fee skim, forward-to-wallet,
   monotonic nonce, pause = no-op-not-revert, access control), mirroring the
   `OmertaFees` test shape;
4. include it in the third-party audit.

Keep every constant in lockstep with the backend exactly as `OmertaFees`/`OmertaBond`
do — `MAX_FEE_BPS` is an immutable audit backstop; the off-chain `VIG_BPS` splits the
`amountWei` the log carries, so on-chain and off-chain never drift.
