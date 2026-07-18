# AUDIT — the chain rail, on-chain + interactions (max-effort, five-lens red-team)

A five-lens parallel red-team over the ENTIRE §11 chain boundary — the five Solidity contracts
(`OMR`, `VoucherClaim`, `GearVault`, `OMRStaking`, `OmertaFees`), the backend that signs/ingests/
reconciles (`chain.js`, `fees.js`, `watcher.js`), and the deploy/trust model (`Deploy.s.sol`, SIWE).
Every finding was re-verified against the real source before any change. **The Solidity itself is
sound — no mint, no forgery, no replay, no reentrancy, fail-closed gear, immediate signer revocation,
no hot-deployer window.** All the real defects live in the OFF-CHAIN half (the backend that couples
to the chain), and the sharpest is a genuine double-spend. Fixed in-commit with regressions; the
go-live prover (`tools/chain-e2e.js`) now proves the marquee fix against a **real EVM** (28 steps).

## Lenses
1. VoucherClaim + OMR withdrawal rail (EIP-712/replay/nonce/cap/parity)
2. GearVault + OMRStaking (minter gate, fail-closed cap, pool/principal isolation, APY ceiling)
3. OmertaFees + backend fee ingestion (tollbooth, idempotency, double-credit surface)
4. The full-reserve queue + extraction-≤-inflow accounting (`chain.js` reserve model)
5. Trust model + SIWE + deploy (signer blast radius, ownership, cross-chain replay)

Three independent lenses (1, 2, 4) converged on the SAME top issue — the reclaim-vs-claim race —
which is the strongest signal a finding is real.

---

## Fixed in-commit (regression per fix; all in `src/chain.js` / `src/fees.js`, none in the Solidity)

### CRITICAL — reclaim-vs-claim double-spend (lens 1 F-3 = lens 2 MED-1 = lens 4 F1; CONFIRMED, real-EVM regression)
`reclaimExpiredVouchers` reversed a signed-unclaimed voucher purely on the **wall clock**
(`deadline + RECLAIM_GRACE_SEC`), which is NOT proof the watcher saw a claim. If the watcher/RPC
stalled past the grace while a **real `claim()` landed on-chain**, reclaim refunded the burned $OMR
(or restored the gear's `minted_onchain=false`) — so the player held the ERC-20 tokens **and** the
refunded $OMR (or the tradeable NFT **and** the in-game gear): a true mint, extraction > inflow. And
§10.4 is **structurally blind** to it — the `−withdraw:omr` burn and the `+withdraw:omr` refund net to
zero inside the ledger, so the nightly `$OMR conservation` check stays "exact" while real value was
duplicated. The reserve accounting is the *only* guard at this boundary, and this is precisely what
the bug corrupts. **Fix:** the contract exposes a public `usedNonce(nonce)` getter — the on-chain
truth. `reclaimExpiredVouchers` now consults it (`makeChainReader()`, viem `readContract`) BEFORE any
refund: a used nonce means the voucher was CLAIMED → record the claim the watcher missed
(`markClaimed`) and never refund; an RPC error → SKIP the voucher this tick (fail safe — a delayed
refund is recoverable, a double-spend is not); a dormant chain (no RPC) keeps the legacy time-grace
(no real vouchers exist). Plus a **detector** in `markClaimed`: a `Claimed` event for an already-
EXPIRED voucher now fires a loud §10.4 chain-boundary alarm (defense in depth). Regressions:
`test/chain.js` proves an on-chain-claimed voucher is reconciled-not-refunded (mock reader both
branches); `tools/chain-e2e.js` **phase 7b proves it against a real EVM** — a genuinely-claimed
voucher forced back to signed+expired reads `usedNonce()==true` and refuses the refund.

### MED — `recordFeePayment` swallowed EVERY insert error as "duplicate" → a real-money payment could vanish (lens 3 F1; CONFIRMED)
The bare `catch` meant to absorb the `nonce` PK collision (23505) absorbed **any** INSERT error
(timeout, serialization failure, a future constraint), returned normally, and let the watcher advance
its cursor past a payment that was never recorded — unrecoverable lost ETH with no entitlement.
**Fix:** swallow ONLY 23505 (`ROLLBACK` + `{duplicate:true}`); rethrow everything else so the outer
handler rolls back and the cursor does NOT advance (the window re-scans idempotently next tick).

### MED — `chainConfig` fail-closed: no more testnet/zero default (lens 1 F-5 + lens 5 F1; CONFIRMED)
`chainId` defaulted to `46630` (testnet) and `verifyingContract` to the zero address. A missing/wrong
`CHAIN_ID` or `VOUCHER_CLAIM_ADDRESS` in production signed vouchers under the WRONG EIP-712 domain →
every on-chain `claim()` reverts `VC: bad signature` while the backend already burned the $OMR — a
total, invisible withdrawal outage (and a violation of the project's own anti-hardcode rule). **Fix:**
`chainConfig()` now throws `chain_unconfigured` when either is unset/zero — no signing against a wrong
domain (parity with `signerAccount()`). Regression asserts the throw + recovery.

### MED — daily-cap blindness: a single over-cap withdrawal was structurally unclaimable forever (lens 1 F-1; CONFIRMED)
The backend signed OMR vouchers with zero awareness of the contract's `dailyCapOMR`. A single
withdrawal whose amount alone exceeds the cap burns the $OMR and signs a voucher whose `claim()`
reverts `VC: daily cap` on EVERY day forever. **Fix:** `requestWithdraw` rejects up-front any single
amount over the (wei-denominated) `DAILY_CAP_OMR` env before burning. The per-day *accumulation* (many
small claims filling the UTC-day cap → transient griefing) stays a documented liveness item — it's
recoverable via reclaim and the on-chain claim-day vs backend sign-day mismatch makes exact backend
tracking unreliable. Regression: an over-cap request errors `daily_cap` with no burn.

### LOW — reclaim batch isolation (lens 4 F3; CONFIRMED)
The per-voucher `catch` re-threw, aborting the whole reclaim batch on one poison row (against the
worker's own `safe()` per-row-isolation philosophy). **Fix:** log + `continue`; each refund is already
its own txn, so there's no partial-state risk.

### LOW — `reconcileFees` case-insensitive match (lens 3 F4; CONFIRMED, behaviour-preserving)
The claim UPDATE matched `payer_address` exactly while `sweepUncreditedFees`'s discovery JOIN matched
case-insensitively. Harmless today (both sides store checksummed addresses) but a fragile coupling: a
future differently-cased write would make a row forever uncreditable AND spin the sweep. **Fix:**
`lower()=lower()` to match the sweep.

### LOW — gearNumId append-only pin (lens 2 MED-2; CONFIRMED latent)
The on-chain ERC-1155 `tokenId` is a gear's 1-based MARKET position, and the Safe keys
`gearSupplyCap[n]`/`gearMinted[n]` by that number. A MARKET reorder/insert on a future re-extract
would silently re-point every cap AND change the tokenId of gear players already hold. **Fix:** a
`test/chain.js` regression pins the known head (`brasspin=1 … dice=4`) so any reorder breaks CI loudly
— a re-extract must only APPEND. (A frozen explicit map is the fuller fix; the pin is the cheap guard.)

---

## Verified CLEAN — the Solidity core (high-value negatives, each traced)
- **Nothing mints.** `VoucherClaim` only `safeTransfer`s pre-funded OMR; `OMR` has no mint path beyond
  the one-shot constructor, no owner, no pause. Gear "mints" 1155s only behind the fail-closed cap.
- **Replay/parity airtight.** Nonce is global across OMR+gear (single `chain_reserve.next_nonce`),
  checked+set before any transfer; `nonReentrant`; CEI correct. Domain binds chainId + verifyingContract
  → no cross-chain / cross-redeploy replay. EIP-712 field order + units match the backend exactly (the
  devnet `recoverTypedDataAddress` proof corroborates).
- **Gear fail-closed + CEI.** cap 0 ⇒ unmintable; `gearMinted` only increments and can't exceed cap;
  nonce marked used before `gear.mint`, so `onERC1155Received` can't re-enter to replay or bypass the cap.
- **Staking sound.** Rewards pay only from a separately-accounted `rewardPool`; principal always
  withdrawable even with a dry pool; first-stake does NOT accrue from epoch 0; APY hard-capped at 50%.
  (Currently DORMANT — the live backend stakes off-chain; on-chain `OMRStaking` is a reserve property.)
- **OmertaFees.** Custodies/mints nothing, forwards the exact `msg.value`, exact-fee reverts, CEI +
  `nonReentrant`, no `receive`/`fallback`. Backend credit is idempotent (nonce PK + atomic
  claim-then-credit); no double/triple-credit across record/reconcile/sweep; no spoofing (credit bound
  to SIWE-proven wallet, event `payer` is the on-chain `msg.sender`).
- **Deploy trust.** Every contract Safe-owned from birth — NO hot-deployer window. Gear fail-closed
  across the deploy gap (minter unset until the Safe wires it). Signer rotation is IMMEDIATE
  (`setSigner` invalidates every outstanding old-key voucher at once — the 30-day TTL is only a
  secondary backstop, not the revocation mechanism). Signer key never logged.
- **Reserve accounting.** The `funded`/`committed-ever` full-reserve gate is correctly serialized
  (every signer holds the `chain_reserve` row `FOR UPDATE` across read-decide-write); a claim never
  re-opens signing room; reorg-safe (`CHAIN_CONFIRMATIONS` behind head, idempotent `markClaimed`).

---

## FLAGGED — pre-mainnet, NOT patched here (with rationale)

### Contract hardenings (require a Foundry-capable session — `forge test` is unrunnable here)
- **`require(cap > 0)` in VoucherClaim constructor + `setDailyCap`** (lens 1 F-4): `dailyCapOMR = 0`
  disables the per-day throttle entirely — a compromised signer could drain the whole tranche in one
  tx (still tranche-bounded, nothing mints, but the defense-in-depth layer is gone). Aligns with the
  contracts' own CLAUDE rule "don't remove the daily cap."
- **`require(m != address(0))` in `GearVault.setMinter`** (lens 5 F3): no validation; a mis-set minter
  silently bypasses the fail-closed cap (Safe-trust boundary).

  These change deployed bytecode; editing contracts we can't run the Foundry suite against, right
  before the third-party audit, is itself a risk. Batch them into the forge-capable session that runs
  `omerta-contracts/test` (the still-unexecuted pre-audit gate), then re-run `chain-e2e.js`.

### Backend hardenings (bigger changes / Phase-2-gated)
- **SIWE → real EIP-4361** (lens 5 F2): the link message is a bespoke string with no domain, expiry,
  or the linked address bound in the signed payload → a phishable account-substitution vector (bounded
  today by the single-use 10-min nonce + wallet-uniqueness index). A half-migration is worse than a
  clear flag; do the full EIP-4361 (domain/URI/chain-id/issued-at/expiration-time + bind the recovered
  address) as its own pass.
- **`fundReserve` on-chain reconciliation** (lens 4 F2 + lens 1 F-2): `funded_omr` is bumped by a mod
  route with no on-chain proof; a fat-finger or a failed/reorged funding tx lets the backend over-sign
  vouchers the tranche can't honor. Add a periodic job that reads `OMR.balanceOf(VoucherClaim)` and
  alarms when `funded − claimed > balance + margin`. (Same class as the accepted `sweep` foot-gun —
  a sweep must be paired with a backend `funded_omr` decrement.)
- **Vig-split runtime parity** (lens 3 F2): backend `VIG_BPS` vs on-chain immutable `vigBps` is a
  deploy-time human promise; decode the on-chain `FeeSplit(nonce,toDev,toVig)` and record/assert `toVig`
  authoritatively. Phase-2 (the Vig) is dormant, so this is gated with it.
- **Withdrawal destination policy** (lens 5 F4): withdraw goes to any caller-supplied address, not
  necessarily the SIWE-linked wallet (the `minted` flag is the gate, not wallet ownership). Previously
  flagged as a policy call in `AUDIT-gameplay-chain.md`; decide "own wallet only" vs "arbitrary" and
  enforce or document.

### Accepted-as-designed (Safe = root of trust, per omerta-contracts/CLAUDE.md)
`sweep`/`pause`, global daily-cap contention, a reverting fee recipient bricking the rail until the Safe
rotates it, permissionless `fundRewards` (benign donation), double mint-fee stranding a credit, and
contract-wallet payers being unlinkable (UX foot-guns).

---

## Result
1 CRITICAL (double-spend) + 3 MED + 3 LOW fixed in-commit, all in the backend coupling layer — the
Solidity was clean. Regressions per fix; the go-live prover now demonstrates the CRITICAL fix on a
real EVM. Suite 20/20; `chain-e2e.js` 28/28. Pre-mainnet gates unchanged: run `forge test` (with the
two flagged contract hardenings), full EIP-4361 SIWE, the reserve-reconciliation job, and the
third-party audit of contracts AND signer.
