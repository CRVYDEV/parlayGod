# AUDIT — THE BANK's nUSD market (`NUSD` / `CollateralEscrow` / `Alchemist` / `Transmuter`)

**Point-in-time**, 2026-08-10, against the contracts as committed in this change. Design:
`omerta-bank-protocol-design.md` §2.1–2.5, §5. Toolchain: solc 0.8.26, `forge test` **177/177**
(from a 128 baseline), seven 512-run fuzzes.

This is a self-review of code written in the same session, so its weakest point is obvious and worth
stating first: **an author auditing their own contracts finds the bugs they were already capable of
seeing.** Every finding below was caught by writing a test that tried to break the thing, or by
mutating the guard and checking a test failed — not by re-reading and feeling satisfied. The
residual risk is the class I cannot see from inside, which is what the third-party audit is for.
**Nothing here is deployed, wired, or reachable from the backend.**

---

## The structural claims, and what actually holds them

| Claim | Held by | Proven by |
|---|---|---|
| No oracle on the borrow path | Denomination matching — the borrow decision reads no price at all | Structural: no price feed is imported or called in `Alchemist` |
| No liquidations, at any price | There is no `liquidate()` to call | Structural |
| RV finding #1 (whale share advantage) unreachable | No pool to divide — one escrow per user, holding the external vault's shares | `test_one_users_yield_does_not_touch_another` |
| `Σ nUSD ≤ Σ collateral × LTV` | Checked after every issuance and every withdrawal | `testFuzz_supply_never_exceeds_collateral_times_ltv` (512 runs) |
| The atomic round trip is impossible | `FlashGuard` L1 — entry and exit cannot share a block | `test_deposit_and_borrow_in_the_same_block_reverts`, `test_the_atomic_round_trip_is_impossible` |
| Stop issuing before you stop paying | The buffer floor gates `mint`, never `redeem` | `test_a_thin_buffer_halts_issuance_but_never_redemption` |
| A stolen Safe key cannot raise the ceilings | `MAX_LTV_BPS`, `MIN_BUFFER_FLOOR_BPS` are compile-time | `test_ltv_has_a_compile_time_ceiling`, `test_the_buffer_floor_has_a_compile_time_minimum` |
| No owner mint, no blacklist, no confiscation | Absent by construction | `test_the_owner_cannot_mint` |

Each of the four load-bearing guards was **mutation-verified**: delete it and a named test fails.

| Mutation | Caught by |
|---|---|
| Remove the LTV check in `mint` | `test_borrowing_past_ltv_reverts`, **and** the headline fuzz (after it was fixed — see F5) |
| Remove `notSameBlockAsEntry` from `mint` | `test_deposit_and_borrow_in_the_same_block_reverts` |
| Read `balanceOf` instead of tracked `reserves` | `test_a_donation_cannot_fake_buffer_health` |
| Remove the buffer gate on issuance | `test_a_thin_buffer_halts_issuance_but_never_redemption` + the bootstrap test |

---

## Findings

### F1 (MED, fixed) — the redemption allowlist contradicted the peg defense it sat next to

`Transmuter.redeem` carried `onlyAllowedCaller`. Its own header argues, at length, that redemption
arbitrage is the mechanism keeping the peg honest and must not be blocked — and **most redemption
arbitrage is executed by contracts.** So the guard would have blocked the defense while reading as
protection. The header and the modifier were arguing opposite sides three lines apart.

Removed, with the reasoning recorded at the call site so it is not "hardened" back in. Flow caps stay:
a cap bounds the *size* of a drain without gating *who* may repair the peg, which is the right tool
for that path.

### F2 (MED, fixed) — an unseeded market bricks after exactly one borrow

Found by a test failing for a reason I had not predicted. At zero supply `requiredBuffer()` is zero,
so the first borrow always passes; the instant supply is non-zero the floor demands real backing, and
reserves are fed **only** by `repay()` and `harvest()`, which require existing debt. An unseeded
market therefore accepts one borrow and then refuses every further mint — a deadlock that looks
exactly like a healthy configuration from the outside.

Fixed as a **stated deploy requirement plus a test that proves the requirement exists**
(`test_an_unseeded_market_bricks_after_one_borrow`), so deleting the seed step from a deploy script
fails CI rather than surfacing on mainnet. Deliberately **not** fixed by exempting early borrows in
code: an exemption is a window in which the protocol issues claims it cannot honour, which is the
precise ordering §2.4 exists to forbid.

### F3 (MED, fixed) — the constructor trusted its own wiring

`Alchemist` accepted any `IERC4626` without checking its underlying is our asset, and any Transmuter
without checking it shares our asset and debt token. These are **immutables**, so a mismatch cannot be
corrected after deploy. Now checked at construction (`test_a_mismatched_vault_cannot_be_deployed`).

### F4 (LOW, fixed) — a reentrancy test that tested nothing

The suite declared a `Reenterer` contract and never used it. Replaced with an `EvilVault` that
re-enters through the **actual external call surface** — the yield vault during withdrawal — since a
bespoke fallback contract would have exercised a path that does not exist in this system.

### F5 (LOW-MED, fixed) — the headline fuzz was partially vacuous

Caught by mutation, not by reading. `testFuzz_supply_never_exceeds_collateral_times_ltv` only ever
minted amounts it had **already checked were legal**, so deleting the LTV guard left it green — the
invariant test was blind to the check it exists to protect. It now *attempts* the over-borrow and
asserts the revert. Re-verified: the strengthened fuzz catches the mutation on its own.

This is the fourth distinct appearance in this project of *a check that cannot fail reads exactly
like a clean bill of health*, and the first inside a fuzz test.

---

## Known and accepted, not defects

**A yield-vault loss breaks the headline invariant, and nothing restores it.** Denomination matching
removes *price* risk, which is what kills liquidations. It does not remove the risk that a Morpho or
Maple sleeve loses principal (§2.6). When that happens `Σ supply ≤ Σ collateral × LTV` is false,
outstanding nUSD is under-backed, and there is **no liquidation to close the gap — by design**, since
adding one reintroduces the oracle-on-the-borrow-path class that cost Inverse ~$21M.

What protects holders instead is the Transmuter: redemption pays from real, tracked reserves, first
come first served, and the floor halts issuance the moment backing thins. The answer to a bad sleeve
is *"stop issuing, honour what is backed,"* not *"seize somebody's collateral."* Pinned by
`test_a_vault_loss_breaks_the_invariant_and_the_protocol_stops_issuing` so it is a recorded decision
rather than a surprise.

**Overpayment is refused rather than banked.** A negative debt balance is a claim on the protocol and
this batch issues none, so `repay` clamps at zero and takes only what is owed.

**Escrows are unrecoverable by anyone.** No sweep, no rescue, no owner withdrawal. Tokens sent
directly to an escrow by mistake are lost — the correct trade for a contract whose entire job is
custody, since a sweep is how an escrow becomes a rug vector.

---

## Not built in this batch

`RateController` (free-debt share targeting) and `RevenueSplitter` (the three-way split, with the NFT
leg gated at zero behind launch-checklist rows A11) are specified in design §5 and deliberately out of scope
here. The free/paid debt modes of §2.3 are likewise not implemented: this batch ships the borrow,
redeem and self-repay core, and every position in it is "on the books" with no interest.

## Before this is deployed

1. **Third-party audit** — the standing gate. This document is one author's self-review.
2. **The buffer-seed step** must be in the deploy script (F2), and `rwaRecipient`-style wiring
   verified distinct where it matters.
3. `nETH` is a second instance of the same contracts against ETH/wstETH, not a parameter change.
4. The keeper that calls `harvest()` follows the bond-oracle keeper discipline already in this repo:
   single-writer under an advisory lock, fail-closed, watched by `alertDrift` — *a silent keeper reads
   exactly like a quiet day*, and this codebase has paid for that lesson twice.
