# OMERTÀ — Interaction Audit (contracts × Risk-to-Earn features)

Three source-verifying red-team agents ran over every seam between the newest work and the
existing systems: (1) the off-chain RTE features (Phase 1 loot/laundering/safehouse, B2 bank cap,
Phase 3 territory rackets + gear-loot) × the PvP/economy layer; (2) the Phase 2 Vig × the
chain/withdrawal layer; (3) the Solidity suite × the backend signer/watcher. This records what was
**fixed in-commit** (correctness) and what is **flagged** (design calls / pre-mainnet chain items).

Test bar after fixes: full suite **9/9** green, stable; worker boots. `forge test` still could not
run (no toolchain in this environment — contract findings are read-verified, and `forge test` +
a third-party audit remain a hard gate before mainnet, unchanged).

---

## Fixed in this pass (correctness)

- **HIGH — withdrawal gate let extraction exceed inflow after a claim** (`src/chain.js`). The gate
  used `signedOutstanding` (signed AND NOT claimed), but `funded_omr` is cumulative-ever and is never
  decremented on claim — so a claimed voucher freed signing room the reserve never gave back, letting
  cumulative signed exceed cumulative funded (fund 100 → sign+claim A=100 → sign B=100 against an
  empty tranche). Added `committedOutstanding` (signed OR claimed) and use it in the `requestWithdraw`
  and `drainQueue` gates; `reserveStatus.available` = funded − committed-ever. Regression in
  `test/chain.js` proves a claim does NOT re-open room. Two independent agents converged on this.
- **MED–HIGH — queued vouchers signed with a stale deadline** (`src/chain.js` `drainQueue`). A
  voucher that sat queued past its request-time 24h TTL was signed already-expired (the contract
  rejects it; the in-game $OMR was already burned). `drainQueue` now recomputes the deadline at
  sign time and re-signs/updates the row with it.
- **HIGH (latent) — OmertaFees forwarded 100% to dev while the Vig backend booked a 60% split**
  (`omerta-contracts/src/OmertaFees.sol`). The design/impl mismatch: on-chain the Vig wallet got
  nothing, so once wired the buyback would deploy phantom revenue. Implemented the on-chain
  dev/Vig split (`vigBps` immutable, set at deploy == backend `VIG_BPS`; `vigRecipient` rotatable;
  `_forward` splits both legs in the same tx, still custodies/mints nothing; existing
  MintFeePaid/RespawnFeePaid events unchanged for watcher parity; new `FeeSplit` event). Deploy
  script + Foundry tests updated (split test, bad-bps/zero-vig ctor guards); vigBps 0 preserves
  the pre-split 100%-to-dev behaviour.
- **HIGH (concurrency) — concurrent Vig buybacks could double-spend the same unspent revenue**
  (`src/vig.js` `runVigBuyback`). The spend-basis reads had no serializing lock. Added
  `SELECT … FROM vig_prize_pool WHERE id=1 FOR UPDATE` as the first statement (matching `payPrizes`),
  so two concurrent buybacks can't each spend the full unspent revenue → over-fund the reserve.
- **MED — `establishRacket` read stale cached turf and never locked the district** (`src/territory.js`).
  A racket could be established on turf lost to a concurrent seizure (an orphaned, unseizable
  operation still paying its old owner). Now locks + re-reads the `districts` row (district → gang,
  the seizeDistrict order) and validates current ownership.
- **LOW — gear-loot roll logged to `rng_audit` only on success** (`src/social.js`). Ground rule #3
  wants all randomness logged; hoisted the `rngLog` out of the chance branch so every roll is
  recorded.

## Verified sound (checked, no action)

The off-chain composition is clean: **loot fires only on an actual kill** (bodyguard/respawn/
safehouse all return before the loot block; NPC/mod kills don't loot); **cash loot × runEstate
nets zero** (loot carved out of the burn, killer +loot / victim −loot); **$OMR loot** is an
account→account transfer in neither the mint nor burn term; **gear loot** can't PK-collide (skips
types the killer owns), never touches on-chain-minted gear, and keeps the estate report + killer
view honest; **territory §10.4** reconciles (establish sink / income faucet), no double-collect;
seizure/dissolution forfeit no ledgered value; laundering + safehouse actor-guards + the B2 bank
cap all correct. On the chain side: EIP-712 parity, no cross-kind voucher replay, claim/expiry/
pause/daily-cap gates, OMR fixed-supply/no-mint, staking pool separation, watcher event parity,
fee + Vig-revenue idempotency, PLEX burn↔grant atomicity, prize backing, wei→ETH safety, and the
hard-$OMR/in-game-$OMR separation are all sound.

---

## Flagged — not patched

**Pre-mainnet chain items** (dormant until wired; on the third-party-audit gate):
- **`VoucherClaim.sweep` is invisible to the backend** (no `Swept` watcher) — a sweep while
  vouchers are outstanding desyncs `funded_omr` from the real tranche. Fix before wiring: watch
  `Swept` and decrement `funded_omr`, or operationally forbid sweep below committed-outstanding.
- **On-chain `gearId` is derived from `MARKET` array position** (`chain.js` `gearNumId`) — a
  non-append reorder of the rules table would silently remap gear classes and their supply caps.
  Pin explicit tokenIds in the rules table before minting gear on mainnet.
- **`OMRStaking.fundRewards` is unpermissioned** — harmless (only increases payouts from the
  caller's own funds), noted for doc accuracy vs the NatSpec.
- **`fundReserve` runs after the Vig txn commits** (`vig.js` buyback + payPrizes) — a post-commit
  failure records the allocation but under-funds the reserve (safe direction: less extraction, never
  more; a stuck prize/allocation, not a leak). Optional: fold into the same txn or add a
  reconcile-shortfall job.

**Design calls (founder sign-off, ground rule #1 — not code bugs):**
- **`whack:loot` has no target-level floor** — intentional (killing is +EV), no §10.4 leak (every
  path is a ledgered transfer, and 75%/80% still burns to the estate), but a colluding pair can
  *concentrate* extractable gear/$OMR from disposable alts onto one minted main before extracting.
  Inefficient and mints nothing, but if the Vig extraction math assumes alts can't feed a main,
  consider a per-bloodline loot cap or a level floor on loot.
- **Latent `territory_rackets ↔ gangs` lock-order mismatch** between dissolution (territory→gang)
  and collect/seize (gang→territory) — currently unreachable (the shared `districts` lock serializes
  seize vs dissolution; collect-vs-dissolution can't co-occur), left as-is to avoid introducing a
  new `districts ↔ gangs` inversion; a defensive reorder is the follow-up if dissolution ever
  becomes reachable by a non-sole member.
