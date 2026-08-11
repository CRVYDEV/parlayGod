# AUDIT-night-contracts.md — Solidity red-team, 2026-08-11

Scope: `omerta-contracts/src/*.sol` (15 files, 2,653 lines), read against `omerta-contracts/CLAUDE.md`.
Baseline before starting: **191/191 forge tests green** (native solc 0.8.26, `run-forge-test-sandboxed.sh`).

Method: every finding below was reproduced against the real contracts in a **scratchpad copy** of the
repo (`/tmp/.../scratchpad/rt`) so the tree under audit was never modified. No file in
`/home/user/parlayGod/omerta-contracts` was edited. PoC output is quoted verbatim.

**Nothing found is a theft of user funds or an unbounded mint.** The four bond walls hold, the
oracle can only tighten, nothing mints outside `OmertaBond`, and the escrow custody model is sound.
The two MEDs are (1) a genuine invariant break introduced by today's harvest fee at high-LTV
settings that are explicitly permitted by the compile-time constants, and (2) a trust surface on the
borrow path that the design documents as a *loss* risk when it is also a *mint* risk.

---

## Findings, ranked

| # | Sev | Contract | One line |
|---|-----|----------|----------|
| F1 | **MED** | `Alchemist.sol` | The harvest fee removes collateral with no matching debt reduction, so at `ltvBps > BPS − harvestFeeBps` a permissionless `harvest` pushes a healthy borrower under the collateralisation check. Proven, with a fee-0 control proving the fee is the sole cause. |
| F2 | **MED** | `Alchemist.sol` | `vault.convertToAssets` **is** on the borrow path; a compromised/upgradeable ERC-4626 sleeve mints unbacked nUSD, and the only bound (`mintPerDayCap`, `redeemPerDayCap`) **fails OPEN at the deploy default of 0**. |
| F3 | LOW-MED | `Alchemist.sol` | A withdrawal does not consume yield — `principalOf` is cut by the full amount — so `harvest` bills a "performance fee on yield" at a moment the escrow provably holds none. *Aggregate-correct; my theft hypothesis was disproven — see the retraction.* |
| F4 | LOW | `Alchemist.sol` | The `take + fee > yield_` line documented "defence in depth; unreachable by the above" **is reachable**. It is load-bearing; a future cleanup deleting it would draw principal out of the escrow. |
| F5 | LOW | `Alchemist.sol` | `feeRecipient` misconfiguration (the Alchemist itself, or the Transmuter) permanently strands assets — the Alchemist has no rescue path. |
| F6 | LOW | `OmertaBond.sol` | If `polBps+devBps+rwaBps == 10000` exactly and `vigRecipient` is unset, the remainder rule sends dust wei to `address(0)` (burned) instead of reverting — the constructor permits that combination. |
| F7 | INFO | `Alchemist.sol` / `Bank.t.sol` | The file's headline supply-level invariant is already only true on the no-harvest path, independent of the fee. The fuzz that pins it never calls `harvest` or `withdraw`. |

---

## F1 — MED — the harvest fee breaks the per-user collateralisation invariant

**Where.** `src/Alchemist.sol:282-336` (`harvest`), specifically the fee draw at `:323`
(`e.withdraw(take + fee, address(this))`) against the debt reduction at `:324`
(`debtOf[user] = d - asDebt`). `harvest` performs **no** post-state health check — contrast
`withdraw` at `:218` and `mint` at `:235`, which both enforce `debtOf <= maxDebtOf`.

**The mechanism.** A harvest removes `take + fee` of collateral and reduces debt by `take` only.
So the ceiling falls by `(take+fee) × ltv` while the debt falls by `take`. With `take = net` and
`take + fee ≈ take/(1−f)`, the position gets *less* healthy whenever

```
ltvBps > BPS − harvestFeeBps
```

Before today's change this could not happen: harvest moved `yield_` and cleared `yield_ × scale` of
debt, a 1:1 move, and since `ltv ≤ 1` the ceiling always fell by no more than the debt did. **The
fee is the first path in this contract by which collateral leaves a position without an equal debt
reduction.**

Both constants permit it: `MAX_LTV_BPS = 9_000` (`:47`) and `MAX_HARVEST_FEE_BPS = 3_000` (`:55`)
sum to 12,000. At the shipped default fee of 2,000 (`:83`), any `ltvBps > 8_000` is exposed. The
deploy default `ltvBps = 5_000` (`:64`) is safe, so this is a latent configuration hazard rather
than a live bug — but `setLtvBps` accepts 9,000 without complaint and nothing relates the two knobs.

**Attack / failure sequence** (verified, `test_F2_harvest_pushes_a_healthy_borrower_under_the_invariant`):

1. Safe sets `ltvBps = 9_000` (legal — `MAX_LTV_BPS`) and `harvestFeeBps = 2_000` (the default).
2. Alice deposits 1,000 USDC; next block mints 900 nUSD — exactly at the ceiling.
3. The sleeve earns 100 USDC. The ceiling rises to 990; Alice mints the 90 of headroom.
   Position is healthy: `debt == maxDebt`.
4. **Anyone** — `harvest` is permissionless by design (`:278-281`) — calls `harvest(alice)`.

Measured output:

```
F2 debt   before harvest : 989999999100000000000     (989.99 nUSD)
F2 maxDebt before harvest: 989999999100000000000     healthy, exactly at LTV
F2 debt   after harvest  : 909999999100000000000     (909.99 nUSD)
F2 maxDebt after harvest : 900000000000000000000     (900.00)  ← UNDERCOLLATERALISED by ~10
```

**The control that proves the fee is the cause** (`test_CONTROL_F2_with_fee_zero`) — identical
sequence with `setHarvestFee(0, feeDest)`:

```
CTRL debt   after harvest: 890000000100000000000
CTRL maxDebt after harvest: 900000000000000000000    ← healthy. The fee is the sole cause.
```

**Impact, stated without inflation.** There is no liquidation, so nothing cascades. The borrower is
frozen out of `mint` and `withdraw` until fresh yield restores the ceiling (it self-heals, since
subsequent harvests reduce debt against a constant ceiling), and the breach is bounded to roughly
one yield cycle's `(ltv − (1−f)) × Y` because an underwater position cannot re-max. Systemically the
backing does not fall by the full amount either — of the collateral removed, `take` lands in
Transmuter reserves and only `fee` leaves. What is broken is precisely the property the file's
header names as "THE INVARIANT THIS FILE EXISTS TO HOLD" (`:36-38`), and it is broken **by a third
party, at no cost to them, with no vault loss** — i.e. outside the one exception CLAUDE.md §8
records as known and accepted.

**Why the tests miss it.** `testFuzz_supply_never_exceeds_collateral_times_ltv`
(`test/Bank.t.sol:154-193`) fuzzes deposits, borrows and `ltv` across the full `1..MAX_LTV_BPS`
range — but **it never calls `harvest` and never calls `withdraw`**. Its whole body is
deposit → mint → assert. The harvest-fee tests (`:305-405`) all run at the fixture's `ltvBps = 5_000`,
below the 8,000 threshold, and none of them asserts anything about the post-harvest health of the
position. The two suites are individually thorough and the gap is exactly where they meet.

**Minimal fix.** Relate the two knobs at both setters — the same "a stolen key cannot" discipline the
file already applies with its compile-time ceilings:

```solidity
error FeeBreaksLtv();

function setLtvBps(uint16 bps) external onlyOwner {
    if (bps > MAX_LTV_BPS) revert LtvTooHigh();
    if (uint256(bps) + harvestFeeBps > BPS) revert FeeBreaksLtv();
    ...
}

function setHarvestFee(uint16 bps, address recipient) external onlyOwner {
    if (bps > MAX_HARVEST_FEE_BPS) revert FeeTooHigh();
    if (uint256(ltvBps) + bps > BPS) revert FeeBreaksLtv();
    ...
}
```

That is exact: `ltv + f ≤ 1` is precisely the condition under which the ceiling never falls faster
than the debt. Alternative (stronger, more invasive): cap `fee` inside `harvest` at whatever keeps
`debtOf <= maxDebtOf` post-move, which preserves both knobs at their maxima and simply under-charges
at the margin — the same fail-safe direction `feeRecipient == address(0)` already takes (`:297`).

A regression should assert the *control* alongside the breach, or it will pass for the wrong reason.

---

## F2 — MED — `convertToAssets` is on the borrow path, and the only bound defaults to OFF

**Where.** `src/CollateralEscrow.sol:95-97` → `src/Alchemist.sol:175-184` (`collateralOf` →
`maxDebtOf`) → `:235` (`if (newDebt > maxDebtOf(msg.sender)) revert Undercollateralised;`).

`Alchemist.sol:18-22` says "THERE IS NO ORACLE IN THIS FILE, AND THAT IS THE HEADLINE… a price that
is never read cannot be manipulated". `CollateralEscrow.sol:91-94` defends the same point:
"`convertToAssets` is the vault's own accounting and is not a price feed we read for a borrow
decision."

That argument is right about *price* risk and wrong about *trust* risk. `maxDebtOf` — the number
that decides how much nUSD may be issued — is `vault.convertToAssets(vault.balanceOf(escrow))`, an
arbitrary value returned by an external contract. Denomination matching removes the exchange-rate
leg; it does not remove the fact that a third-party contract's return value gates issuance.

**Why this is not just the accepted §2.6 sleeve risk.** CLAUDE.md §8 and
`test_a_vault_loss_breaks_the_invariant_and_the_protocol_stops_issuing` frame the sleeve as a
**loss** risk — the vault reports *less*, the invariant breaks, the buffer floor halts issuance, and
holders are protected by "stop issuing, honour what is backed". That framing is complete for a
loss and silent on the opposite direction. A vault that reports **more** does not halt anything: it
raises every escrow's ceiling and lets the attacker mint nUSD against collateral that does not
exist, then redeem it 1:1 at the Transmuter for real underlying that other users repaid. Most
production ERC-4626 sleeves (Morpho, Maple — the two the design names) are **upgradeable proxies**,
so "the vault's own bookkeeping" is a value the sleeve's admin can set.

**FlashGuard does not bound it.** L1 separates entry from exit, not inflation from borrowing: the
attacker deposits in block N and inflates + mints in block N+1. L0 is the claim being disputed. That
leaves L5, the flow caps — and:

```solidity
// Alchemist.sol:101-102
uint256 public mintPerBlockCap;   // default 0
uint256 public mintPerDayCap;     // default 0
// Transmuter.sol:81-82
uint256 public redeemPerBlockCap; // default 0
uint256 public redeemPerDayCap;   // default 0
// FlashGuard.sol:116-117
if (perBlockCap != 0 && f.inBlock > perBlockCap) revert PerBlockCapExceeded();
if (perDayCap  != 0 && f.inDay   > perDayCap)   revert DailyCapExceeded();
```

**Zero means the cap is off.** This is deliberate and documented (`FlashGuard.sol:98-100`), and it is
the opposite polarity to every other wall in this repo: `OmertaBond.maxOmrPerEth`,
`GearVault.cap`, `NUSD.minter` and `OmertaBond.oracle` are all fail-**closed** at zero, and
`OmertaBond`'s header explicitly reasons that "a deploy that forgets it is a deploy with no daily
wall — set it." The bank's caps fail **open** at zero, and the shared test fixture
(`test/Bank.t.sol:65-95`) never sets them, so the suite's normal posture is an unmetered market.

So on a default deploy, the bound on an inflating sleeve is: nothing until reserves run out.

**Why the tests miss it.** `EvilVault` (`test/Bank.t.sol:36-48`) is a reentrancy probe, not a lying
one — it re-enters during `_withdraw` and is correctly refused. No test deploys a vault that
over-reports `convertToAssets`. `test_a_vault_loss...` covers the loss direction only.

**Minimal fix.** Two parts, neither of which changes the no-oracle design:

1. Make the market's own caps fail-closed like every sibling wall, or (less invasive, and enough)
   add the mint/redeem cap seeding to the documented deploy sequence in CLAUDE.md §8 beside the
   buffer-seed requirement, and pin it the same way — a `test_an_unmetered_market_is_refused`-shaped
   guard, since the buffer-seed precedent shows this project treats a deploy requirement that only
   lives in prose as insufficient.
2. Record in CLAUDE.md §8 that the sleeve must be **non-upgradeable, or governed by the same Safe** —
   because the accepted risk is currently written as "the sleeve may lose money" and the real
   statement is "the sleeve's admin can set our borrowing ceiling."

A cheap defence-in-depth if wanted: track a per-escrow high-water `convertToAssets` and cap the
per-block growth used by `maxDebtOf` (yield is slow; inflation is not). That is a real design change
and should not be made reactively.

---

## F3 — LOW-MED — a withdrawal does not consume yield (`principalOf` under-states cost basis)

**⚠ Retraction first, because the honest version matters more than the alarming one.** I opened this
as "the user escapes the fee on withdrawn yield and is later billed on their principal — a theft."
**That is wrong and I disproved it before reporting.** I worked the two orderings end to end:

- honest: `harvest` (fee `f·Y`, debt −`(1−f)Y`) then `withdraw(Y)`;
- exploit: `withdraw(Y)` (fee 0) then `harvest`;

and they land on **identical** collateral, debt, wallet and fee-recipient balances. The fee is
*deferred and mislabeled*, not escaped: because `principalOf` is cut by the full withdrawal, the
`yield_` reading is unchanged by a withdrawal, so the same amount stays billable and is charged on
the next harvest. Aggregate lifetime fee is `f ×` real yield either way. The escrow also floors at
net deposits rather than dipping below them. There is **no over-charge and no loss**.

**What is nonetheless wrong.**

```solidity
// Alchemist.sol:214-215
uint256 p = principalOf[msg.sender];
principalOf[msg.sender] = assets >= p ? 0 : p - assets;
```

Withdrawals are booked principal-first. Withdrawing *yield* therefore reduces recorded principal by
the yield amount, and `yield_ = total − p` (`:289`) reads the same number afterwards. Verified
(`test_F1_withdrawing_yield_escapes_the_fee_and_bills_principal`):

```
F1 collateral after yield: 1099999999
F1 principal after yield : 1000000000
F1 collateral after wdraw: 999999999      ← escrow now holds exactly what alice deposited
F1 principal  after wdraw: 900000000
F1 PHANTOM yield read    :  99999999      ← the book still claims ~100 USDC of harvestable yield
F1 fee paid so far       :         0
F1 fee taken FROM PRINCIP:  19999999      ← ~20 USDC billed as a "performance fee"
```

At the moment of that harvest the escrow contained no yield whatsoever, and 20 USDC of what was
unambiguously principal left the protocol to `feeRecipient`.

**Consequences that are real:**

1. **The disclosure rule breaks.** `Alchemist.sol:70-77` calls §2.2's rule load-bearing: the UI must
   show the projected payoff date "from the LIVE REALISED, POST-FEE yield", and "charging the fee
   and quoting a pre-fee date would be the dishonest version of this." Any client computing realised
   yield or a cost basis from `principalOf` — the only figure the contract exposes for it — is wrong
   by the amount of every past withdrawal that came out of yield.
2. **It widens F1's window.** A harvest that removes collateral without a matching debt reduction can
   now fire against a position whose owner correctly believes they hold no yield at all.
3. `Harvested` / `HarvestFeeTaken` (`:110`, `:116`) are the events CLAUDE.md says the backend books
   protocol revenue from — and they will attribute a fee to yield that did not exist at that block.

**Why the tests miss it.** No test in `Bank.t.sol` calls `withdraw` and `harvest` on the same
position. The withdraw tests (`:207-211`, `:225-229`, `:658-666`) never harvest; the harvest tests
(`:283-405`) never withdraw.

**Minimal fix** — net yield first, which is what the accounting means:

```solidity
e.withdraw(assets, msg.sender);
uint256 remaining = e.totalAssets();
uint256 p = principalOf[msg.sender];
if (p > remaining) principalOf[msg.sender] = remaining;  // yield absorbed the withdrawal first
```

This makes `yield_` fall by the yield actually taken out and leaves principal intact when the
withdrawal is covered by yield. Note it changes *when* the fee is charged (a user who withdraws
their yield genuinely stops owing a fee on it) — which is the correct reading of the contract's own
rule at `:78-82` ("the fee is proportional to the yield actually MOVED to service debt").

---

## F4 — LOW — the "unreachable" clamp is reachable and load-bearing

**Where.** `src/Alchemist.sol:312-321`:

```solidity
//   Both branches satisfy `take + fee <= yield_`:  … Integer division rounds the fee DOWN,
//   which only widens the margin.
uint256 fee = feeBps == 0 ? 0 : (take * feeBps) / (BPS - feeBps);
if (take + fee > yield_) fee = yield_ - take; // defence in depth; unreachable by the above
```

The comment is wrong in both directions. `net = Y − floor(Y·f/B)` rounds the *deduction* down, so
`net` is rounded **up**, and `fee = floor(net·F/(B−F))` can then recover the full proportional
amount — giving `take + fee = Y + 1`. Verified on the real contract
(`test_F3_the_defence_in_depth_clamp_is_load_bearing`), first hit in a 20-unit search window:

```
F3 realised yield_       : 9989
F3 net (take)            : 7992
F3 proportional fee      : 1998
F3 take+fee UNCLAMPED    : 9990      ← one unit MORE than the yield
F3 actual fee (clamped)  : 1997
```

The debt-bound branch has the same property (`take = ceil(d/scale) ≤ net` ⟹
`take + fee ≤ Y + B/(B−F)`).

**Impact today: none** — the clamp catches it and the protocol under-charges by ≤1 asset unit. The
finding is the comment. This codebase's own recorded failure mode is a later "cleanup" deleting a
branch labelled unreachable; here that would make `e.withdraw(take + fee, …)` draw one unit of
principal out of the escrow on every harvest that lands on such a yield.

**Minimal fix.** Change the comment to state the clamp is load-bearing and give the counterexample,
and pin it with an assertion (`take + fee <= yield_` after the clamp) so the line cannot be removed
silently. `testFuzz_the_fee_never_exceeds_the_yield_it_came_from` (`test/Bank.t.sol:385-397`) already
covers the *outcome* — it passes with or without the clamp only because the clamp exists — so the
regression should target the branch, not the outcome.

---

## F5 — LOW — a misconfigured `feeRecipient` strands assets permanently

`setHarvestFee` (`Alchemist.sol:155-160`) validates only the bps. `address(0)` is handled as a
deliberate fail-safe (`:85-91`, and `test_an_unset_recipient_fails_SAFE...` proves it). Two other
values are not:

- `feeRecipient = address(alchemist)` — the fee accumulates in the Alchemist, which has **no** sweep,
  rescue or owner withdrawal. The assets are unrecoverable.
- `feeRecipient = address(transmuter)` — the assets land in the Transmuter but `reserves` is a
  variable, never `balanceOf` (`Transmuter.sol:37-41`, `:75-76`), so they are ignored forever: they
  neither back redemptions nor can be withdrawn.

Minimal fix: reject both in `setHarvestFee` (`if (recipient == address(this) || recipient ==
address(transmuter)) revert`). Cheap, and it makes the fail-safe story complete rather than partial.

---

## F6 — LOW — bond remainder dust to `address(0)`

`OmertaBond.sol:210` requires a non-zero `vigRecipient` only when
`polBps + devBps + rwaBps < 10000` (mirrored in `setRecipients`, `:400`). If the three sum to
**exactly** 10000, `vigRecipient` may be zero — but `toVig = msg.value − toPol − toDev − toRwa`
(`:355`) is the floor-division remainder and is generally **non-zero** (up to 2 wei). The forward at
`:359` then executes `address(0).call{value: dust}("")`, which succeeds on the EVM and burns the ETH.

Not exploitable and not a live configuration (the shipped split is 3750/1500/2500). Worth one line
because the remainder rule is specifically documented as existing "so the four shares sum to the
principal EXACTLY … or a wei goes unowned" (CLAUDE.md §2), and this is the one arrangement where a
wei goes unowned anyway. Minimal fix: require `vigRecipient != address(0)` unconditionally, or
`if (toVig > 0 && vigRecipient == address(0))` fold the dust into POL.

---

## F7 — INFO — the headline supply-level invariant is already harvest-sensitive, fee or no fee

Separate from F1, and I flag it so the F1 fix is not mis-scoped. `harvest` reduces `debtOf` and moves
underlying to the Transmuter **without burning any nUSD** — repayment-in-underlying is deliberate
(`Alchemist.sol:244-249`). So the *supply-level* statement `Σ supply ≤ Σ collateral × LTV` is broken
by an ordinary harvest at zero fee. Control (`test_CONTROL_supply_level_with_fee_zero`):

```
CTRL supply    : 989999999100000000000
CTRL maxBacked : 900000000000000000000
CTRL reserves  : 500099999999            ← the backing moved to the Transmuter, it did not leave
```

This is defensible — the backing moved venue rather than disappearing — but it means the invariant as
literally written at `Alchemist.sol:36-38` is only true on the no-harvest path, and the fuzz that
pins it never harvests. The accurate system-level statement is
`Σ supply ≤ Σ collateral × LTV + reserves`. Recommend restating the header and, if the fuzz is
extended to harvest (it should be, for F1), asserting the accurate form. **F1 is the per-user check
`debtOf ≤ maxDebtOf`, which the fee breaks and zero fee does not — that one is a real regression and
must not be dismissed as an instance of this.**

---

## Attacked and found SOUND

Listed because the negative results are the load-bearing half of a review of walls.

### `Alchemist` — the new harvest fee (priority 1)

- **Fee is charged only on what services debt.** `fee = take·F/(B−F)` with `take ≤ ceil(d/scale)`
  (`:303-320`), so a user who repays to zero, accrues a year of yield, then takes a small loan is
  billed proportional to the *debt cleared*, not the standing balance. The management-fee
  antipattern the header disavows (`:78-82`) is genuinely absent.
- **Debt clamp (`asDebt > d`) arithmetic.** Verified both branches: `take = ceil(d/scale)`, clamped
  down to `net`, `asDebt` re-clamped to `d`. `take ≥ 1` always (since `net ≥ 1` whenever `yield_ ≥ 1`
  for any `F ≤ 3000`), so `transmuter.fund(take)` can never hit its `ZeroAmount` revert. Rounding is
  in the protocol's favour throughout.
- **Zero recipient disables the fee** rather than reverting `ERC20InvalidReceiver` — the fail-safe is
  real, and it is checked before the multiplication (`:297`) so no path can divide by `BPS − feeBps`
  with `feeBps` unset.
- **Reentrancy through `asset.safeTransfer(feeRecipient, fee)` (`:327`).** CEI is respected: the
  escrow withdrawal and `debtOf[user] = d − asDebt` both land before the transfer. Every
  state-changing entry point on the Alchemist (`deposit`, `withdraw`, `mint`, `repay`, `harvest`) is
  `nonReentrant` and OZ 5.x shares one guard slot per contract, so a hostile recipient cannot
  re-enter any of them. Re-entering `Transmuter.redeem` mid-harvest reads pre-`fund` reserves — no
  advantage. The escrow itself is `onlyController`.
- **Reentrancy through the ERC-4626 `withdraw` (`:323`)** — same guard, and `EvilVault` already pins
  it.
- **Fee-on-transfer collateral.** Fails **closed** at the first deposit rather than corrupting
  accounting: `deposit` transfers to the escrow (`:200`) then `deployToVault(assets)` (`:201`)
  approves and deposits the *pre-fee* figure, which the escrow no longer holds, so the vault's
  `safeTransferFrom` reverts. No residual accumulates, so nothing silently drifts. (A token that
  *switches* fees on later degrades to a deposit DoS with existing positions still withdrawable —
  also fail-closed.)
- **Dust fee avoidance.** `fee = 0` for `take ≤ 3` at 20% — a user could in principle harvest at
  3-unit granularity to pay nothing. At USDC's 6dp that is $0.000003 per transaction; the gas
  dominates by many orders of magnitude. Not economically reachable.
- **`principalOf` is never written by `harvest`** — correct, since harvest only ever removes yield;
  the double-charge that would follow from decrementing it does not exist.
- **Vault-donation inflation of `maxDebtOf`.** A flash-loaned donation to the shared ERC-4626 lifts
  every escrow's `convertToAssets` pro-rata, but the attacker recovers only their `s/S` share and the
  post-`withdraw` LTV check (`:218`) blocks pulling the donation back out while the debt stands. Not
  profitable. (Distinct from F2, which is the vault *lying*, not the pool *moving*.)

### `NUSD` / `CollateralEscrow` / `Transmuter` (priority 2) — every documented claim verified true in code

- **"No oracle on the borrow path, no `liquidate()` anywhere."** `grep -rn liquidat src/` returns
  three comment hits and no function. Confirmed true (with F2's caveat about what `convertToAssets`
  actually is).
- **"No pooled shares."** `CollateralEscrow` holds the external vault's shares at a per-user address;
  there is no internal share type, no share arithmetic, and no shared denominator anywhere in the
  bank. RV finding #1 is genuinely unreachable rather than fixed.
- **"The escrow has no sweep."** The whole surface is `deployToVault`, `withdraw`, `withdrawAll`,
  `totalAssets` — the first three `onlyController`, `controller` immutable and set to `msg.sender` at
  construction (so only the deploying Alchemist). `owner` is recorded but granted no authority, which
  the code matches. `withdrawAll` is currently unreachable (the Alchemist never calls it) — harmless,
  since it is `onlyController`.
- **"`setMinter(0)` halts issuance without halting redemption."** Structurally independent:
  `NUSD.mint` gates on `minter` (`:72-75`), `NUSD.burn` on `burner` (`:81-84`), and `Transmuter.redeem`
  touches only the latter. Both fail-closed at zero via the explicit `|| x == address(0)` clause, so
  a zeroed slot cannot be spoofed by a zero-address caller.
- **"The buffer floor gates mint, never redeem."** `bufferHealthy()` has exactly **one** call site in
  the entire tree: `Alchemist.sol:230`, inside `mint`. Confirmed by grep.
- **"`redeem` carries no same-block guard and no caller allowlist."** True (`Transmuter.sol:163`) —
  neither `notSameBlockAsEntry` nor `onlyAllowedCaller` is applied, and the flow caps are the bound.
  The stated reasoning holds.
- **Reserves are a variable, never `balanceOf`** (L7). `fund` (`:144-150`) and `redeem` (`:174`) are
  the only writers; a direct token donation is ignored, so it cannot fake buffer health or move the
  redemption rate.
- **`NUSD.burn` without an allowance check** is safe as scoped: the sole burner pulls tokens into
  itself (`Transmuter.sol:178`) before burning its own balance (`:179`). CEI is respected — reserves
  fall and the burn happens before `asset.safeTransfer` (`:181`).
- **Decimal handling.** `scale` derived from the token at construction in both contracts, `d <= 18`
  enforced; `redeem` rounds *down* in the protocol's favour and refuses sub-unit dust rather than
  burning it for nothing (`:167-168`); `repay` rounds *up* (`:262`). All in the correct direction.
- **Constructor wiring.** The Alchemist cross-checks `vault.asset()`, `transmuter.asset()` and
  `transmuter.debtToken()` against its own immutables (`:137-139`) — a mismatched deploy cannot exist.

### `OmertaBond` + `OmrTwapOracle` (priority 3)

- **The oracle can only tighten.** Wall 4 bounds the *claimed price* (`:314-315`); wall 3 bounds the
  *post-discount rate* against `maxOmrPerEth` (`:325`) and is evaluated independently, from a Safe-set
  storage value the feed cannot touch. Effective bound is the MIN. Pushing the feed up leaves wall 3
  binding; pushing it down only halts bonding. Composition is intact and
  `test_oracle_CANNOT_LOOSEN_the_static_ceiling` + `testFuzz_mint_rate_never_exceeds_either_ceiling`
  pin it.
- **All four walls fail closed.** `maxOmrPerEth == 0` reverts (`:325`); `oracle == address(0)` or
  `maxOracleAge == 0` reverts (`:275`); a zero, stale or reverting feed each reverts by a distinct
  named error inside a `try/catch` that cannot fall through to a success path (`:279-285`);
  `discountBps > MAX_DISCOUNT_BPS` (2000, compile-time) reverts before any arithmetic, so
  `10000 − discountBps` can never approach zero.
- **The four-way ETH split sums exactly.** `toPol/toDev/toRwa` are floor divisions and
  `toVig = msg.value − toPol − toDev − toRwa` (`:350-355`); the constructor enforces
  `polBps+devBps+rwaBps <= 10000` (`:206`), so `toVig ≥ 0` and the four sum to `msg.value` by
  construction. `polBps/devBps/rwaBps` are `immutable` — the on-chain/off-chain drift rule holds.
  (F6 is the one edge.)
- **`committedOMR <= balanceOf(this)`.** The payout is minted at bond time (`:345`) and `sweep`
  subtracts `committedOMR` before comparing (`:415`), so a sweep can never strand a claim; `claim`
  decrements the commitment by exactly what it transfers (`:371-373`).
- **Replay / quote abuse.** Nonce consumed before signature-dependent work (`:307`), `msg.sender ==
  q.payer` (a quote is not transferable), `msg.value == q.principal`, `MAX_VEST` and `MAX_QUOTE_TTL`
  both bound a leaked-then-rotated signer's pre-signed inventory.
- **TWAP.** `MIN_PERIOD` compile-time floor; `update()` permissionless but cannot be poked early;
  the **both-sided** window bound discards an over-long interval and re-baselines to
  `priceAverage = 0` / `lastUpdate = 0` (`:129-136`), so a post-outage poke reports *unavailable*
  rather than a stale-but-fresh-stamped average — `OmertaBond` turns the zero into a revert. The
  wrapping cumulative subtraction is correctly `unchecked` and the counterfactual accrual matches V2
  periphery. `_decode` uses `mulDiv` for the 512-bit intermediate.
- **`GenesisOracle`** returns `(0,0)` past `validUntil` and for `price == 0`, riding the interface's
  own "unavailable" signal rather than a second code path. Its deviation from the `updatedAt` contract
  is documented and cannot loosen anything, since the explicit window bounds it more tightly than an
  age check would.

### `OMR` + `OmertaHook` (priority 4)

- **Sell tax, three ways, remainder on LP, both layers.** `OMR.sol:168-170` and
  `OmertaHook.sol:347-349` are byte-equivalent in structure; `dev + rwa + lp == tax` exactly.
  `MAX_SELL_TAX_BPS = 1000` is compile-time in both. `setSellTax` refuses `devBps + rwaBps > bps` and
  refuses arming with an unset recipient; `setTaxRecipients` refuses zeroing while the tax is armed —
  so an armed tax can never reach a zero address.
- **Only sells are taxed.** `OMR._update` requires `ammPairs[to] && from != address(0) &&
  !taxExempt[from]` — mints, burns, buys and wallet transfers all move 1:1.
- **The hook's pool gate.** `beforeInitialize` (`:262-269`) requires exactly one side to be OMR
  (`zeroIsOmr == oneIsOmr` catches both "neither" and the impossible "both") **and** the other side to
  be a Safe-allowed quote. `allowedQuote` starts empty, so until the Safe acts no pool can be created
  on this hook at all. The fabricated-revenue attack the header describes is closed.
- **Fee-currency derivation.** `feeOnCurrency0 = amountSpecified < 0 ? !zeroForOne : zeroForOne` is
  correct for v4's convention (negative = exact input ⟹ unspecified is the output). It is derived
  from `zeroForOne` rather than `zeroIsOmr` — the comment at `:331-334` explains why, and the
  reasoning is right: the two are equal only because of the sell guard directly above.
- **No path bricks the pool.** The fee accrues into `owed[currency]` and is pushed by a separate
  permissionless `sweep` that can only pay Safe-set recipients; `_observe` is `try/catch`'d with a
  bounded gas stipend; there is no pause and `beforeSwap` returns unconditionally. `int128(uint128(total))`
  cannot overflow (`total ≤ base/10 ≤ 2^128/10 < int128.max`).
- **`sweep` effects-before-interactions** (`delete owed[currency]` at `:248` before the transfers).

### `VoucherClaim` / `GearVault` / `OMRStaking` / `OmertaFees` (priority 5) — nothing mints outside bonds

Enumerated every `_mint` in `src/`:

| Site | Gate |
|---|---|
| `OMR.sol:98` | constructor only, to the treasury Safe |
| `OMR.sol:119` | `msg.sender == minter && minter != 0` — no owner mint |
| `NUSD.sol:74` | `msg.sender == minter && minter != 0` — no owner mint |
| `GearVault.sol:70` | `msg.sender == minter` **and** the per-`gearId` lifetime cap, fail-closed at 0 |

- `VoucherClaim` **transfers** pre-funded OMR only (`omr.safeTransfer`), bounded by the UTC daily cap;
  gear goes through `GearVault.mint`, so the authoritative cap lives on the durable asset and survives
  a bridge swap (G-MED-1 holds). `VoucherClaim.gearSupplyCap` is a pre-flight only; a mismatch between
  the two fails closed at the vault.
- `OMRStaking` pays only from `rewardPool`, which is incremented solely by `fundRewards` and checked
  against the claim amount; principal is tracked separately and always withdrawable. `MAX_APY_BPS`
  compile-time. No mint path.
- `OmertaFees` forwards each exact fee in-tx (CEI + `nonReentrant`), custodies nothing, mints nothing;
  `vigBps` is `immutable`; `sweep` routes to `owner()` rather than a recipient.

### FlashGuard

`onlyAllowedCaller` correctly avoids `tx.origin` (ERC-4337 / Privy compatibility, and the check would
not work anyway). L1's one-block separation is applied to `mint` and `withdraw` and deliberately not
to `repay`, `harvest` (inbound / debt-reducing) or `redeem` (peg defence). `_meter` uses checked
arithmetic on purpose. All correct as designed — see F2 for the one polarity concern.

---

## Accepted by design (raised, not a finding)

- **The mint flow cap is global, not per-user** (`Alchemist.sol:103`, `:232`). An adversary with
  collateral can consume the day's mint budget and block all borrowing. Cost is capital, not money.
  This is inherent to a flow cap as a backstop, and per-user caps would weaken the bound it exists to
  provide. Noted only so it is a decision rather than a surprise.
- **`VoucherClaim.sweep` has no over-sweep guard** (unlike `OmertaBond.sweep`). Correct: vouchers are
  signed off-chain and nothing on-chain is committed against, so there is no figure to protect.
- **`harvest` is permissionless.** Right call — it is what makes the loan self-repaying. The problem
  in F1 is the fee's effect on the position's health, not the openness of the call.

---

## Verification artifacts

PoC lives at `<scratchpad>/rt/test/RedTeamPoC.t.sol` (scratchpad copy only — deliberately **not**
added to the repo). Five tests, all passing against unmodified `src/`:

```
[PASS] test_F1_withdrawing_yield_escapes_the_fee_and_bills_principal()   (F3 above)
[PASS] test_F2_harvest_pushes_a_healthy_borrower_under_the_invariant()   (F1 above)
[PASS] test_F3_the_defence_in_depth_clamp_is_load_bearing()              (F4 above)
[PASS] test_CONTROL_F2_with_fee_zero()                                   (proves the fee is F1's sole cause)
[PASS] test_CONTROL_supply_level_with_fee_zero()                         (F7)
```

Repo suite re-confirmed green and unmodified: `191 tests passed, 0 failed`.

---

## RESOLUTION (2026-08-11, same session — every finding closed or accepted with a reason)

| # | Verdict | What shipped |
|---|---|---|
| F1 | **FIXED** | `_assertLtvFeeCompatible` called from BOTH `setLtvBps` and `setHarvestFee` + `error LtvFeeIncompatible`. The pair cannot be walked into a breach from either side. The headline fuzz now bounds LTV by the PAIR ceiling rather than `MAX_LTV_BPS` alone, so it tests the reachable space. |
| F2 | **ACCEPTED, now stated at the field** | Two halves. *(a)* `convertToAssets` is SLEEVE trust, not price risk — the same assumption CLAUDE.md rule 8 already records ("a yield-vault loss breaks the invariant and nothing restores it"); the answer to a bad sleeve is the buffer floor's stop-issuing ordering, not an oracle, which is the class this market exists to avoid. *(b)* The mint flow caps fail **OPEN** at zero while `maxOmrPerEth` and the gear caps fail closed. Deliberate: a fail-closed cap here would let a forgotten setter brick borrowing for everyone, and this market already has one silent-omission deploy step (the buffer seed) — two is one too many. Both now documented at the declaration and as a checklist item in CHAIN-DEPLOY §2b. |
| F3 | **RETRACTED by the lens** | Disproved end to end before reporting: the two orderings land on identical balances. The fee is deferred and mislabeled, never escaped. No change. |
| F4 | **FIXED** | The clamp is reachable and the comment claiming otherwise is gone, replaced by the arithmetic showing *why*: `net` is computed with a floored fee, so dividing it back out overshoots by up to `1/(1-f)`, which rounds into a whole unit at dust scale. The fuzz's lower bound went from `1 * M` to **1 wei** — it had excluded the only regime that reaches the clamp, which is the recorded *"a lever measured in the wrong RANGE"* class. `test_the_dust_clamp_is_reachable` pins it, and **its first cut was itself vacuous** (four wei rounds away in the escrow before the clamp is reached, so it passed under mutation); it now asserts its own precondition. Widening the fuzz also surfaced a genuine edge — a wei of vault yield can round away entirely — so it measures what the escrow **realised** rather than what was minted to the vault. |
| F5 | **FIXED, and a worse bug found alongside it** | The reported half (`feeRecipient` = this contract or the Transmuter silently swallows the fee) is guarded by `BadFeeRecipient`, with `address(0)` still the deliberate off switch. But the push itself was the bigger problem: the fee was `safeTransfer`'d **inside the permissionless `harvest`**, so on a USDC market — which has a live blocklist — one un-receivable recipient would brick the self-repaying mechanism for **every borrower**, not just the treasury. That is precisely the failure `OmertaHook` accrues-rather-than-forwards to avoid (CLAUDE.md rule 7: mechanism liveness must never depend on a wallet's behaviour). The fee now accrues and a permissionless `sweepFees` pushes it. Mutation-verified: restoring the in-tx push makes the harvest revert `USDC: blocked`. The suite models USDC's real blocklist rather than a "rejecting recipient" contract, because a plain ERC-20 transfer never calls its receiver — only the token can refuse. |
| F6 | **FIXED** | `vigRecipient != address(0)` is now required **unconditionally**, in the constructor and the setter. The `< 10000` condition exempted exactly the arrangement that still forwards dust, and a forward to `address(0)` succeeds on the EVM and burns it — defeating the remainder rule in the one case it was written for. |

All four fixes carry a regression that fails **by name** under mutation. `forge test`: **198 passed,
0 failed** (from 191 at the time of the report), incl. seven 512-run fuzzes.

**One process note worth keeping.** Three separate checks in this batch were vacuous on their first
cut — the dust-clamp test (the yield rounded away before reaching the clamp), the F5 mutation (a plain
ERC-20 push to a contract does not revert, so "a rejecting recipient" tested nothing), and the fuzz
bound that had hidden F4 for the life of the file. Each read exactly like a clean bill of health.
