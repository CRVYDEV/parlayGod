# AUDIT — the accretion oracle (OmrTwapOracle + OmertaBond wall 4 + the backend clamp)

**Date:** 2026-07-29
**Scope:** `omerta-contracts/src/OmrTwapOracle.sol`, `omerta-contracts/src/IOmrOracle.sol`,
`OmertaBond`'s wall 4 (`setOracle` / `priceCeiling` / the `bond()` check), and `src/chain.js`'s
`makeBondPriceReader` + the `quoteBond` clamp.
**Verdict:** no CRITICAL. **Two real findings, one per layer, both fixed and mutation-verified.**
Forge **107/107**, suite green, sim drift-0.

---

## Why this pass exists

Tokenomics v2 step 4 deleted the property every prior contract audit of this suite rested on —
"nothing mints". Bonds now mint, and four walls stand between a leaked quote-signer and unbounded
supply. Wall 4 (the oracle) is the newest, the only one that reads state it does not own, and the
only one with a moving part off-chain. It shipped with a design flag attached and without an
adversarial pass. This is that pass, plus the two items the sizing harness (`npm run dials`) left
hanging.

The threat model is unchanged from the dials work and is worth restating because it decides what
counts as a finding: **one attacker who holds the quote-signer key**, can sign any quote, but must
still PAY the ETH and must still SELL the OMR. Anything that lets them mint at a better rate than
the walls intend is a finding. Anything that merely halts bonding is not — halting is the designed
failure direction.

---

## The property being defended

Wall 4 is not "the oracle is right". It is the **composition**:

```
effective bound = MIN( maxOmrPerEth , oraclePrice x (1 + tolerance) / (1 - discount) )
```

`maxOmrPerEth` is an absolute Safe-set number the oracle cannot touch. So a manipulated oracle can
only ever TIGHTEN the bound, never loosen it: pushing the feed UP buys an attacker nothing (the
static ceiling still binds), and pushing it DOWN only stops bonding. That asymmetry is the whole
guarantee, and it is why walls 3 and 4 must never be collapsed into one.
`test_oracle_CANNOT_LOOSEN_the_static_ceiling` fails if anyone ever does.

I re-derived this from the deployed source rather than from the header comment, because a comment
asserting an invariant is not the invariant. It holds: `bond()` checks `maxOmrPerEth` and
`priceCeiling()` independently, in sequence, with no early return between them.

---

## F1 (MED, backend) — the clamp rounded ITSELF over the ceiling

**`src/chain.js:quoteBond`.** When the bond chain is live, `quoteBond` clamps a too-high price down
to something the contract will accept, specifically so a player never receives a quote whose
`bond()` reverts. It clamped to the **ceiling**:

```js
if (price > onchain.ceiling) price = round6(onchain.ceiling);
```

`round6` **rounds**. It rounds *up* whenever the seventh decimal is ≥ 5 — which for an arbitrary
ceiling is about half the time. A price one micro-unit above the ceiling fails
`if (q.priceOmrPerEth > ceiling) revert PriceAboveOracle(...)`.

**Measured: 50.0% of random plausible prices** (over 200,000 samples — and 50% is also the
theoretically correct answer, since rounding a uniformly-distributed residue rounds up half the
time; an earlier small-sample figure of 49.1% was noise). So roughly every OTHER clamped quote would have
reverted on-chain — on the exact code path whose only job is to prevent exactly that. The player
sees a successful signature from a healthy-looking server and a failed transaction, with no signal
distinguishing it from a genuinely rejected bond.

Nobody mints anything they shouldn't, which is why this is MED and not HIGH. But it is a
liveness defect in the mint path's own guard rail, and it would have surfaced on mainnet as
intermittent, unexplained bond failures — the worst class to debug, because it is
price-dependent and therefore looks random.

**Fix — clamp to the oracle PRICE, not the ceiling:**

```js
if (price > onchain.oraclePrice) price = round6(onchain.oraclePrice);
```

The tolerance band (default 500 bps) is now entirely headroom, so rounding cannot breach the
ceiling at any plausible magnitude. This also resolves the sizing pass's open question about clamp
direction, in the conservative direction: the ceiling is the *most generous* price the wall
permits, so clamping there resolved every disagreement between our feed and the chain's toward MORE
OMR per ETH. On a mint path the default should be the tighter number.

**Regression** (`test/chain.js`): the clamp only runs against a live bond chain, which is dormant in
the suite, so the test pins the ARITHMETIC that makes the fix correct — 20,000 random prices, asserting
that clamping to the ceiling breaches it thousands of times and clamping to the oracle price breaches
it zero times. Mutation-verified: restore the old target and the assertion fails naming the breach rate.

---

## F2 (MED, contract) — an unbounded window let a dead price be published as fresh

**`OmrTwapOracle.update()`.** `PERIOD` was a MINIMUM with no maximum. `update()` closed whatever
interval had elapsed and stamped `lastUpdate = block.timestamp`.

The consumer's defence against a bad reading is `maxOracleAge`. But that check measures **when the
average was computed**, not **what period it covers**. A multi-day interval closed one second ago is
one second old by that measure, and reports an average of prices that no longer exist.

**Measured on the real contract**, in `test_F2_a_past_spike_can_no_longer_contaminate_a_long_window`:
keeper down for nine days across a run to 20,000 that then crashed back to 5,000, and the oracle
reported **19,998** — four times spot, stamped fresh, invisible to the staleness check.

Three things made this exploitable rather than merely wrong:

1. **`update()` is permissionless** (deliberately — a keeper-gated poke means a lost key freezes the
   bond product). So whoever pokes **chooses the moment the window closes**, and an attacker will
   choose the moment most favourable to them.
2. **The high price costs the attacker nothing to create.** Ordinary volatility during an outage
   does the work. This is the part that distinguishes it from normal TWAP manipulation, where the
   attacker must hold the price against arbitrageurs for the full window and pay for the privilege.
3. **A keeper outage is the expected trigger**, and an outage is exactly when nobody is watching.

What it buys: a higher `oraclePrice`, hence a higher `priceCeiling()`. Wall 3 (`maxOmrPerEth`) still
binds absolutely — which is precisely the composition argument, and why this is MED rather than
HIGH. Wall 4 would simply have stopped contributing at the moment it was most needed.

**Fix — bound the window on both sides.** An interval longer than `PERIOD * MAX_WINDOW_MULT` (4) is
**discarded, not averaged**: re-baseline the snapshot, set `priceAverage = 0` and `lastUpdate = 0`
(so `consult()` reports the interface's "no usable reading" and `OmertaBond` reverts), and emit
`Rebaselined(window)` so the outage is visible rather than silent. Fail-closed; recovery is one
honest `PERIOD`.

`MAX_WINDOW_MULT = 4` is three consecutive missed pokes. By that point the reading is already stale
to the consumer under any sane `maxOracleAge`, so the wall costs nothing in normal operation.

**Regressions** (`OmrTwapOracle.t.sol`): four —
`test_F2_a_past_spike_can_no_longer_contaminate_a_long_window` (the scenario above),
`test_F2_recovery_is_one_honest_window` (a discarded window leaves the feed UNAVAILABLE, not
stale-but-nonzero, and one honest period restores it),
`test_F2_the_very_first_poke_is_bounded_too` (a long first window after deployment is discarded like
any other — the bound is not something the seeded snapshot exempts), and
`test_F2_the_boundary_is_inclusive_so_a_normal_late_poke_still_works` (exactly `4 x PERIOD` is
accepted; only beyond it is discarded, so an ordinarily-late keeper is not punished).

**Mutation-verified**: disabling the bound fails three of the four, naming the exact contaminated
figure — `19998842681891829334156` wei-per-ETH (**19,998.84**) against a spot of 5,000. The fourth is
the boundary test, which asserts the ACCEPTED side and so correctly still passes: a mutation that
removes a restriction cannot fail a test that checks something is permitted. Worth stating, because
"3 of 4 failed" would otherwise read as an incomplete mutation.

**Process note worth keeping.** The F2 mutation appeared to SURVIVE on the first attempt. It had
not: `grep -c "test_F2_"` returned **0** — the regressions were never written, because I ran
`cd omerta-contracts && python3 - <<'PY'` from *inside* `omerta-contracts`, the `cd` failed, and
`&&` short-circuited the edit away. The three tests that did run were exploratory probes that only
`emit`, so they survive any mutation. Same lesson the harnesses keep teaching, in a new costume: **a
check that cannot fail reads exactly like a clean bill of health.** The re-added block asserts its
own marker is present before writing.

Also: my first F2 probe scenario was simply wrong — a ten-day window at a *sustained* price reports
correctly, because the average of a constant is that constant. The finding needs an outage that
SPANS a move and then reverts. Constructing the right scenario was most of the work.

---

## The two items the sizing pass left hanging — decided

**Clamp direction (ceiling vs price).** Resolved by F1 above: clamp to the price. Conservative
direction, and it is also the only one that is arithmetically safe.

**A minimum vest — DO NOT ADD ONE.** `vestSeconds >= 1` is legal, and an attacker's own quote picks
it, so the daily cap is realised essentially immediately. The tempting conclusion is that a
`MIN_VEST` would slow an attacker down and buy response time. It would not, for two reasons found by
reading the contract rather than reasoning about it:

- **`claim()` is deliberately not `whenNotPaused`.** Pausing stops new bonds; it does not stop
  vested OMR being claimed. So a vest is not a window in which the Safe can intervene — it is only a
  window in which the attacker waits.
- **The blast radius is `dailyCapOMR`, and that is true whatever the vest is.** A vest changes *when*
  the capped amount lands, not *how much*. Sizing already treats the cap as realised immediately,
  which is the conservative assumption and stays correct with no minimum vest.

Adding one would buy a false sense of a security control while making honest bonds worse (the server
signs the full 120h for real bonders; a floor only constrains the honest path). **Vesting is a
product feature here, not a security control, and the value of writing that down is that nobody
later counts it as one.** Recorded in `CHAIN-DEPLOY.md` next to the dial recommendations.

---

## Verified clean

- **The composition.** `maxOmrPerEth` and `priceCeiling()` are checked independently in `bond()`;
  no path skips one. A manipulated oracle cannot loosen the static ceiling. (Existing test; re-read
  against source.)
- **Fail-closed at every oracle failure mode.** Unset (`OracleUnset`), zero reading
  (`OracleUnavailable`), stale (`OracleStale`), reverting (bubbles). None is a free pass; all four
  halt bonding rather than open it. `_oraclePrice()` has no default-return branch.
- **The decode cannot silently corrupt.** `Math.mulDiv` for the UQ112x112 → wei conversion; the
  naive `avg * 1e18` overflows uint256 for large averages and would corrupt the exact number the
  mint wall reads. Covered by `testFuzz_price_decode_survives_extremes`, which fuzzes the OMR
  reserve across the whole plausible range up to `type(uint112).max / 2` and checks the decode
  against a ratio computed independently of the fixed-point path — a point test at one large value
  would not have been enough.
- **Wrapping arithmetic is correct and load-bearing.** V2 cumulatives are *allowed* to overflow and
  the DIFFERENCE stays right across the wrap; the `unchecked` blocks are the two places where that
  is the point rather than an optimisation. Both are the V2 periphery's own idiom.
- **Counterfactual accrual matches V2's periphery.** A pair only writes its cumulative on a touch,
  so a quiet pool's stored value lags; skipping the forward-accrual would silently shorten every
  window by however long the pool sat idle. `_currentCumulativePrices` does it, and reverts
  `NoReserves` on an empty pool rather than dividing by zero.
- **Side selection is derived, not trusted.** The constructor reads `token0()`/`token1()` and works
  out which cumulative has OMR in the numerator, rather than taking a caller-supplied flag. A
  non-OMR pair reverts `NotOmrPair`.
- **The first window reads UNAVAILABLE, not zero-price.** `priceAverage` stays 0 until an update
  closes a full period, so a freshly-deployed oracle halts bonding instead of quoting free OMR.
- **`PERIOD` has a compile-time floor** (`MIN_PERIOD` 10 minutes). A 30-second "TWAP" is a spot price
  wearing a TWAP's name, and this contract exists to prevent that.
- **The backend reader is read-only and fail-closed.** `makeBondPriceReader` returns null when the
  bond chain is unconfigured (so the clamp is simply absent off-chain), and any RPC failure in
  `quoteBond` becomes a clean `oracle` GameError rather than a signed quote that cannot land.
- **No §10.4 surface.** The oracle, wall 4 and the clamp move no in-game value and write no
  `transactions` rows. Sim drift-0 confirms.

---

## Flagged, not changed

- **The keeper is an operational dependency with no in-repo monitor.** `update()` must be poked at
  least once per `maxOracleAge` or bonding halts. That failure direction is right, but a silent halt
  is indistinguishable from low demand. The backup watchdog is the precedent for how this should
  eventually be watched (`archiverHealth` → `alertDrift`); worth doing before mainnet, not before
  the third-party audit. **BUILT 2026-07-30** — `chain.js:bondOracleHealth` (a pure classifier +
  RPC plumbing that resolves the oracle off the bond's own `oracle()` getter, no new env), checked
  hourly by the worker with the latched-per-episode alert discipline, flagging `keeper-late` at
  2× PERIOD (lead time — bonding still works) and `down` when `priceCeiling()` reverts; surfaced
  on `GET /v1/mod/bonds` + the /admin Chain panel.
- **`MAX_WINDOW_MULT` is a compile-time constant, not a Safe-set dial.** Deliberate — it is a wall,
  and a settable wall is a wall an attacker with the owner key can move. But it does mean an
  operator running a deliberately slow keeper cadence must set `PERIOD` accordingly rather than
  loosening the multiplier. Documented in the contract header.
- **The dials remain pool-depth-dependent** (see `npm run dials`). Nothing in this pass changes
  that: the strongest available action for these walls is still POL depth, not a setting.

---

## Standing gates (unchanged by this pass)

`forge test` is green (gate 1). Mainnet remains blocked on **gate 2 — third-party audit of contracts
AND signer**, whose clock step 4 reset by deleting the "nothing mints" property, and **gate 3 —
the launch checklist**. An auditor must be pointed explicitly at what was deleted and at the four walls
that replaced it; this report is part of that packet.
