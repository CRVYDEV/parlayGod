# RED TEAM #9 — the contract boundary

**Scope (founder-directed):** *"another comprehensive red team to cover any edge cases we might have
missed on any interactions with smart contracts."* So this pass looks at the SEAM rather than at either
side of it: what the backend encodes, decodes, signs, restates and configures against what the contracts
actually declare and enforce. RT#1–#8 read the contracts (signer rotation, cap mappings, the pause
matrix, the Bank cluster as a graph, the shared `vouchers` table, ownership handover); none of them
crossed the two sides field by field.

First-hand throughout. Nothing is called a finding until it is reproduced against the source or a running
engine, and two candidates that looked like findings **died on checking** — both recorded below, because a
red team that publishes only its hits cannot be audited.

**Result: no CRITICAL, no HIGH. Three MED, four lenses clean, four mutations each failing at its own
named assertion.**

---

## F1 (MED) — the chain performs a split the backend restates, and nothing ever compared them

`OmertaFees.vigBps` and `OmertaBond.polBps`/`devBps`/`rwaBps` are **`immutable`**. They are set by hand at
a deploy the script does not cover (8 of 16 contracts aren't in `Deploy.s.sol`; `OmertaBond` alone takes
**twelve** constructor arguments, three of them adjacent same-typed bps and four of them adjacent
same-typed `address payable` recipients). The backend carries its own copy of the same numbers. Nothing —
no invariant, no reader, no control-room entry — ever read the contract's side.

The two halves fail differently, which is why the fix reports them separately rather than summing:

* **`OmertaFees.vigBps` vs `VIG_BPS` is the sharp one.** `MintFeePaid(payer, nonce, amount)` carries the
  **gross alone** — no split — so `recordFeePayment` → `recordVigRevenue` **DERIVES** the share from the
  backend lever (`vig.js:116`, `grossEth * (bps ?? VIG_BPS) / 10000`). A divergence directly mis-books
  `vig_revenue`, which is what `runVigBuyback` spends and `fundReserve` credits, i.e. the funding source
  of the withdrawal reserve. **Every existing check sums either way**, because they all compare figures
  derived from the same restated number.
* **`OmertaBond.*Bps` vs `BONDS.*` is the quiet one.** Here the booking is event-authoritative (`Bonded`
  carries `toPol`/`toDev`/`toRwa`/`toVig` and `recordBond` books what the event says — deliberately, and
  correctly), so the ACCOUNTING is safe. What diverges silently is the router's DECLARED waterfall.

The realistic trigger is not a typo but the **env flip**: `deploy/fee-splits.env` is the signed Path A
configuration and the code defaults are the pre-Path-A values, so the backend and the contract agree only
if that file is applied — on **both** the api and the worker — in lockstep with the constructor args. Miss
it on the worker (where `recordFeePayment` runs, off the watcher) and the contract forwards 25% while the
backend books 60%, permanently, immutably, with nothing red.

**Fixed.** `chain.js:onchainSplits()` reads the contract's own public immutables (no lever knowledge, so
that file stays free of the economy constants — a restatement there is the class preflight's own ledger
exists to stop); `vig.js:splitParity()` does the comparison where the levers live; the worker checks it
hourly beside the oracle-keeper watchdog, latched per episode, alarming through `alertDrift`. Dormant and
unreachable never alarm (not knowing is not the same as broken). The `chainparams` control-room entry that
mirrored the backend bps against `read: null` now reads `polBps`, so the immutable side is visible to an
operator *before* the first payment rather than after.

It can only fire once per deploy — the contract side cannot move. That once is the whole point.

## F2 (MED) — the identity NFT had no entrance

`DynastyNFT` mints **only** against a server-signed EIP-712 `MintVoucher` and has **no owner mint** (a
deliberate wall). Nothing in `src/`, `test/` or `tools/` signed one: `grep` for `OmertaDynasty`,
`MintVoucher` or any dynasty signing config returned **zero** hits.

The forgotten-sibling class, on the four contracts that share one signer key:

| contract | domain | backend signer |
|---|---|---|
| `VoucherClaim` | `OmertaVoucherClaim` | `signVoucher` |
| `StreetDeed` | `OmertaStreetDeed` | `requestDeedWithdraw` |
| `OmertaBond` | `OmertaBond` | `quoteBond` |
| `DynastyNFT` | `OmertaDynasty` | **— none —** |

It fails CLOSED, which is why it is MED and not worse: nothing is stealable, the product simply does not
work. What makes it worth finding now is that **the exit half was complete and looked complete** — the
`Minted` and `Transfer` watchers, the token registry, the portrait freeze, the metadata route, EIP-2981
royalties — and both the runbook (*"Backend activation (BUILT 2026-08-15)"*) and the build log (*"every
on-chain contract has its complete backend … no code left to write on the rails"*) said so. On the deploy
path as written, an audit is paid for and a contract is deployed that no one can ever use.

**Fixed.** `chain.js:requestDynastyMint` + `POST /v1/identity/mint`, mirroring `requestDeedWithdraw`. The
gate is the founder's own recorded answer (2026-08-16, *"retrofit every existing minter"*): a made account
with a SIWE-proven wallet, **one token per account ever** — enforced on both horizons, a token the watcher
has already recorded and a voucher signed but not yet claimed, because the contract has no per-account cap
(its walls are the nonce, the deadline and the daily rate). A lapsed voucher needs no sweep: nothing was
debited, and the pending check filters on the deadline, so the entrance simply re-opens.

RT#8's `VOUCHER_CLAIM_KINDS` allowlist earned its keep one drop later — the new `dynasty` kind is
invisible to the VoucherClaim reclaim rail **by construction**, which is exactly why that fix was an
allowlist and not a denylist. Asserted, not assumed.

**Guarded.** `test/docs.js` already required every signer-bearing contract to appear in the rotation
runbook and to take its daily cap as a constructor argument. It now also requires each to have a backend
route that signs for it, matched on the **EIP-712 domain name** — the one string a signing path cannot
avoid naming, where the type name and the route path are both free choices. Catalog-or-declare, on the
other side of the same key.

## F3 (MED) — the stock keeper guessed a token's decimals, and the quiet direction is the dangerous one

`STOCK_TOKEN_DECIMALS`, `|| 18`, used at two sites — reading a deed vault's balances for the pre-purchase
disclosure, and **sizing the real `StockVault.deliver` transfer**. `STOCK_TOKEN_ADDRESSES` is a ticker→token
**map**, so one number was wrong the moment two tickers disagreed, and a tokenized equity is not reliably
18dp.

This is the class **AUDIT-red-team-six** established and did not sweep: *a value copied off-chain that the
chain already knows.* That pass deleted `ALCHEMIST_ASSET_DECIMALS` and replaced it with a read of the
token's own `decimals()`, fail-closed, no fallback — and `watcher.js` still carries that implementation
verbatim. This instance survived beside it.

The failure is asymmetric and the survivor is the bad one:

* **over-sending REVERTS** at the ERC-20 (the vault does not hold it) — loud, safe;
* **under-sending SUCCEEDS.** Set 6 against an 18dp token and `parseUnits('5', 6)` moves five millionths
  of a millionth of a share, while `confirmStockDelivered` books the **staged** `row.units` — so the
  ledger says five shares were delivered. `allocated ≤ held` and `delivered ≤ allocated` both stay green
  because both compare ledger numbers to ledger numbers, and §3.3's gateless push means there is no claim
  step where anybody would notice.

**Fixed.** `tokenDecimals(client, address)` — per-token, cached case-insensitively, bounded to `[0,18]`
(mirroring the contracts' own `require`), and it **throws** on a read failure rather than falling back,
for the reason its sibling states: a fallback is the guessed number wearing a hat. On the read path the
throw joins the existing per-token `catch` and reports `units: null` (unreadable ≠ empty); on the send path
it releases the keeper's claim and retries. The knob is **deleted**, not merely unread — from `preflight.js`
and from the runbook — so a stale value cannot quietly come back.

---

## The lenses that came back clean

**A/C — ABI parity, every signature both sides.** All 14 event signatures the backend declares, crossed
against the ~80 the contracts declare, on **type, indexed-ness and positional parameter name**. Twelve
match a contract declaration exactly. The two that match none are external and were verified against
their real sources rather than waved through: `ModifyLiquidity` against `v4-core`'s `IPoolManager` (its
`PoolId indexed id` is a `bytes32` value type — the backend's `bytes32 indexed id` is correct) and
`Transfer` against OpenZeppelin's `IERC721`. One cosmetic drift (`HarvestFeeTaken`'s third parameter is
`assets` on-chain and `amount` in the backend declaration) — names do not enter the topic hash and viem
decodes positionally, so it is inert.

The positional-name check is what makes this lens worth running: the sharp risk is a **same-typed
adjacent swap**, invisible to a type comparison. `Bonded` has six adjacent non-indexed `uint256`;
`Delivered` has two adjacent `address indexed`; `Extracted` has two adjacent `string`. A swap in any of
them would show as a positional name drift, and exactly one drift exists, in the field that is not one.

**B — deploy-script constructor parity.** Every `new X(...)` in `Deploy.s.sol` against the declared
constructor: all 8 correct on arity and semantically aligned on order (`safe`→`owner_`,
`devWallet`→`feeRecipient_`, `vigWallet`→`vigRecipient_`). The residual is not the script but its
absence: **8 of 16 contracts are hand-deployed**, which is what F1 is downstream of.

**E — the EIP-712 domain sweep.** All four `verifyingContract`-bearing contracts, domain string and struct
field list, both sides. Three match exactly; the fourth is F2. The four domain names are all distinct, so
a voucher for one can never be replayed against another — RT#2 established that and it still holds with a
fifth kind added.

**Contract coverage.** Every contract has some backend half; only `CollateralEscrow` has none, and it is
internal to the Bank cluster rather than something the backend addresses.

## The two that dissolved

**The runbook's bond split "contradicts itself."** `CHAIN-DEPLOY` says deploy
`polBps=7500, devBps=1500, rwaBps=500` and, eight lines later, *"keep them in lockstep with the backend
`BONDS.*`"* — which is `3750/1500/2500`. Those cannot both be satisfied, and the first read is that one is
stale. Checking instead of stopping there: `BONDS.*` are **env-backed** (`BOND_POL_BPS` etc.),
`deploy/fee-splits.env` is the signed Path A configuration setting exactly `7500/1500/500`, and
`tools/validate-fee-splits.js` holds it to `fee-splits.json`. The runbook is consistent by design; the
code defaults are simply the pre-flip values. **What survives is not the contradiction but its shadow** —
the env flip and the immutable constructor args are two independent manual acts with nothing crossing
them, which is F1.

**`polBps` "is read by the backend."** My own sweep reported `✓ read` for all three bond bps. It was a
false CLEAN from my own tool: the regex matched the string `polBps` anywhere in `src/`, and
`bonds.js:387` has `polBps: BONDS.POL_BPS` — an object **key** on the board, not a contract read.
Enumerating the real `functionName:` reads showed the truth (17 functions, none of them a split). *A
finding produced by a tool you wrote and did not check is not a finding — and neither is a clean bill of
health.*

## Process notes

**My constructor-parity probe reported two false arity mismatches**, because its comment-stripper ate
`https://` inside a **string literal** — every URL default in the deploy script. Replaced with a
string-aware stripper before reading a single result. The same shape (a naive `//` strip) would silently
mis-read any file with a URL in it.

Five `zz*` probe files written and deleted before committing. Every mutation ran on a scratchpad copy
(`cp` out, `cp` back), never `git checkout`, with uncommitted work in the same files.
