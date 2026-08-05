# OMR on Uniswap v4 hooks — Ethereum mainnet

**Status: §11 steps 1 and 2 are BUILT** (`OmertaBond`'s four-way ETH split; `OmertaHook.sol` +
`test/OmertaHook.t.sol`, 19 tests against a REAL `PoolManager`). Steps 3–8 are not. Everything here
still sits behind the two standing gates (third-party audit of contracts + signer; legal counsel)
exactly like the rest of the chain track — and it *enlarges* the audit gate, see §7. Nothing is
deployed; the hook is inert code in a repo.

**Founder direction (2026-07-30):** evaluate replacing the ERC-20 transfer tax with a Uniswap v4
hook, preserving the same three-way economics (founder wallet, buyback/LP, RWA accumulation), and
write it up assuming **Ethereum mainnet** deployment "for longevity" rather than Robinhood Chain.

**Founder decisions since (2026-07-30), recorded inline below:**

- **Pool-local taxation is acceptable** (§4) — the tax becomes a property of one pool, defended by POL
  depth. The armed-at-zero ERC-20 backstop is retained (§4a), and §9.6 makes that retention matter
  considerably more than it first appears.
- **Take the cut in ETH, not OMR** (§2.1) — the core move is approved.
- **OMR may become an inert ERC-20** once the fee lives in the hook (§7.1).
- **Dynamic fees approved as a capability** (§2.4) — the *rate curve* itself is still its own sign-off.
- **Hook-native oracle approved** (§5) — scoped as its own contract, and see §9.2: it is on the bond
  mint path, so its cutover and the pool migration are one operation.

Still open: §10.2 (the RWA bridge), §10.3 (mainnet gas on withdrawals), §10.6 (age decay on-chain),
and the new §9.7 (the bond ETH split defect this raised).

---

## 0. What "mainnet for longevity" actually buys, and what it costs

The instinct is sound and worth stating plainly: mainnet is the Schelling point. The token still
exists in ten years whether or not any particular L2's sequencer, team or business does. v4 has been
live there since January 2026 (`PoolManager` at `0x000000000004444c5dc75cb358380d2e3de08a90`), every
aggregator indexes it, and the deployment question that dominates the Orbit-chain version of this
analysis simply disappears. For the *token* — the thing that must outlive everything else — mainnet
is the right answer.

But OMR is not only a token. It is the settlement layer for a game, and three consequences follow
that do not follow for a normal ERC-20. All three are addressed below; none is a blocker; the third
is the one that would be expensive to discover late.

1. **Per-action gas lands on players, not on us** (§8). The M6 withdrawal rail, gear claims and fee
   tollbooth were designed against L2 gas. On mainnet, a player withdrawing a small `$OMR` balance
   can pay more in gas than the withdrawal is worth.
2. **A hooked pool is a *pool*, not a *token* property** (§4). The ERC-20 tax is universal by
   construction. A hook tax is not. This is a real downgrade in enforcement and the doc does not
   pretend otherwise.
3. **The RWA leg goes cross-chain** (§6). The Robinhood tokenized stocks the float buys trade on
   Arbitrum / Robinhood Chain. A mainnet OMR means the tax collects WETH on mainnet and the stock
   purchase happens elsewhere. That is a bridge in the middle of the one accounting path whose whole
   selling point is "the game only ever owes stock it already owns."

---

## 1. What we have today, precisely

`OMR.sol` is an ERC-20 whose `_update` charges a tax when tokens move **into a registered AMM pair**:

```solidity
if (sellTaxBps > 0 && ammPairs[to] && from != address(0) && !taxExempt[from]) {
    uint256 tax = (value * sellTaxBps) / 10000;
    uint256 dev = (tax * taxDevBps) / sellTaxBps;
    uint256 rwa = (tax * taxRwaBps) / sellTaxBps;
    // LP takes the remainder — the three always sum to `tax`, no dust
}
```

Rates (`SELL_TAX`, kept in lockstep between `rules.tail.js` and the contract, both load-validated):

| slice | bps | destination |
|---|---|---|
| dev | 200 | founder revenue |
| rwa | 400 | the stock float (`rwa_revenue`) |
| lp | 300 | LP depth / buybacks |
| **total** | **900** | contract hard cap `MAX_SELL_TAX_BPS` = 1000 |

Off-chain, `rwa.js:recordSellTax(pool, { ref, omrTaxed, priceOmrPerEth, txHash })` books one row per
taxed episode, converts to an ETH-equivalent `gross` at the TWAP, splits it dev/rwa/lp with the
remainder rule on LP, and mirrors the RWA slice into `rwa_revenue` — **only when `txHash` is present**
(the anti-fabrication gate: a comp books zero revenue, because fake revenue buys real-looking units
and would defeat the `allocated ≤ held` wall).

### 1.1 The flaw this design exists to fix

**The tax is collected in OMR, but every downstream consumer needs ETH.**

The contract moves *OMR* to the dev, rwa and lp wallets. `recordSellTax` then *values* that OMR in
ETH. But valuing is not having: to actually pay the founder, buy a stock token, or deepen liquidity,
that OMR has to be **sold** — and each of those sales is itself sell pressure on the very pool being
taxed. The tax is reflexive. We tax a sell, and then, to realise the tax, we sell.

It also forces a hard deploy constraint (`CHAIN-DEPLOY.md`): canonical liquidity **must** be Uniswap
V2-compatible, because V3 rejects fee-on-transfer tokens and swaps must route through the
`*SupportingFeeOnTransferTokens` path. That constraint exists solely because the fee lives in
`_update`.

---

## 2. The v4 architecture

### 2.1 The core move

A v4 hook charges its fee **inside the swap**, and can charge it in **either currency**. Point it at
the quote side and the three slices arrive as **WETH, already**:

```
today:   swap(OMR → ETH) → OMR tax → 3 wallets hold OMR → [sell OMR for ETH] → dev / rwa / lp
v4:      swap(OMR → ETH) → hook takes WETH from the swap → dev / rwa / lp
```

The bracketed step — the reflexive one — disappears entirely. `rwa_revenue` is funded in the currency
it spends, with no oracle conversion anywhere in the accounting path.

### 2.2 Hook surface

Permissions in v4 are encoded in the **low 14 bits of the hook's address** (`Hooks.sol`):

```solidity
uint160 internal constant BEFORE_SWAP_FLAG               = 1 << 7;  // 0x80
uint160 internal constant AFTER_SWAP_FLAG                = 1 << 6;  // 0x40
uint160 internal constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3;  // 0x08
uint160 internal constant AFTER_SWAP_RETURNS_DELTA_FLAG  = 1 << 2;  // 0x04
```

`OmertaHook` needs, at minimum:

- `BEFORE_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG` — take the cut and return a `BeforeSwapDelta`.
- `AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG` — **strongly recommended**: `afterSwap` computes
  the fee on the *actual* output observed from `BalanceDelta`, which is the correct place for a fee
  on a partial or exact-output swap. `beforeSwap` overcharges in those cases.

**These flags are immutable.** They live in the address, so deployment requires address mining
(CREATE2 salt search), and the permission set can never be extended. Adding a callback later means a
**new hook and a liquidity migration**. Mine for the full set you might plausibly want — an unused
callback that reverts to the default is nearly free; a missing one is a migration.

### 2.3 The fee logic

```solidity
function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params,
                    BalanceDelta delta, bytes calldata hookData)
    internal override returns (bytes4, int128)
{
    // BUYS ARE FREE. Only a sell (OMR in, quote out) is taxed — the current contract's
    // `ammPairs[to]` semantics, expressed as a swap direction instead of a transfer destination.
    if (!_isSell(key, params)) return (BaseHook.afterSwap.selector, 0);

    uint256 out   = _quoteOut(delta);              // WETH the swapper is owed
    uint256 total = out * sellTaxBps / 10_000;     // <= MAX_SELL_TAX_BPS, same 1000 hard cap
    uint256 dev   = total * taxDevBps / sellTaxBps;
    uint256 rwa   = total * taxRwaBps / sellTaxBps;
    uint256 lp    = total - dev - rwa;             // THE REMAINDER RULE, unchanged

    // settle the three out of the hook's delta, in the QUOTE currency
    ...
    emit SellTaxTaken(_swapper(sender, hookData), PoolId.unwrap(key.toId()), total, dev, rwa, lp);
    return (BaseHook.afterSwap.selector, int128(uint128(total)));
}
```

Two invariants carry over unchanged and must be re-asserted in the hook's tests:

- **`MAX_SELL_TAX_BPS` (1000) stays a compile-time hard cap.** The Safe can never set a rate above it.
- **The remainder rule sits on the LP slice**, so the three always sum to the total with zero dust.
  Two of three round down; a "natural" third slice strands wei belonging to nobody. This is the same
  rule `recordSellTax` and `OmertaBond` already use and it should not be re-derived per contract.

### 2.4 Dynamic fees

With the dynamic-fee flag set on the pool, `beforeSwap` returns an LP fee override (the third element
of its `(bytes4, BeforeSwapDelta, uint24)` return). The tax stops being one global number and becomes
a per-swap decision. That unlocks, in rough order of value:

- **buy/sell asymmetry natively** — currently expressed as "buys are exempt"; it could be a real curve.
- **a launch taper** — a high initial sell rate decaying to the steady state on a published schedule.
- **volatility or depth scaling.**

Ship it at a **flat rate equal to today's 900 bps** and leave the machinery unused. A dynamic fee is a
new economic surface and belongs in its own sign-off with its own sim measurement, not smuggled in
with an infrastructure migration.

---

## 3. The `sender` problem, and what it would let us do

`IHooks.beforeSwap`/`afterSwap` take `address sender`. The NatSpec calls it "the initial msg.sender
for the swap call" — but that is the msg.sender **to the PoolManager**, which for any ordinary user
is the **router**, not the person. Uniswap documents an `IMsgSender(sender).msgSender()` pattern for
recovering the real initiator, with a try/catch for routers that don't implement it.

This matters because `CLAUDE.md` records, correctly, that age-based sell rates are **impossible at the
ERC-20 layer** — the token sees only `router → pool` and cannot know who is selling. That is why the
48h `EARLY_SELL_TAX_BPS` decay lives at the game boundary (`tax.js:earlySurcharge`, a FIFO replay of
the account's own `$OMR` ledger) rather than on-chain.

A hook gets **closer** to on-chain age decay. It does not get all the way there:

- `msgSender()` is a courtesy the router implements. Trusting it means maintaining an **allowlist of
  trusted routers**, and deciding what happens for an unknown one.
- The obvious failure mode is the one the oracle audit already taught us: a wall that stops
  contributing precisely when someone attacks it. An attacker routes through a contract that lies (or
  simply doesn't implement `msgSender()`), and the age tier silently resolves to "unknown".

**Recommendation: do not put age decay on-chain in v1.** Keep `tax.js:earlySurcharge` at the game
boundary where the ledger is authoritative and unfakeable, and treat the hook's view of the swapper as
a *telemetry* improvement — richer `SellTaxTaken` events — rather than a security control. Revisit
only if router `msgSender()` support becomes near-universal.

---

## 4. The real cost: pool-local enforcement

**This is the honest downside and it should drive the decision, not the upside.**

Today the tax is a property of the **token**. Every sell into every registered pair pays, and adding a
pair is a Safe action. There is no route around it that does not involve someone voluntarily not using
a pool.

With a hook, the tax is a property of **one pool**. Anyone can permissionlessly open an unhooked
OMR/WETH v4 pool, or a V2 pair, or a V3 pool, and trade **completely untaxed**. Nothing in the token
prevents it.

The defence is economic, not mechanical: **depth**. If the hooked pool is where the liquidity is, it
is where the best execution is, and aggregators route there. We are unusually well positioned for this
because `OmertaBond` already accumulates protocol-owned liquidity by design (`POL_BPS` 5000 of every
bond's ETH) — POL is exactly the moat this architecture needs, and it is already built and funded.

But it is a moat, not a wall, and it is weakest **at launch**, when POL is thinnest. Two mitigations:

**(a) Keep the ERC-20 tax as an armed-at-zero backstop.** Do not delete `_update`'s tax path. Ship it
set to 0 with the pair registry intact. If someone stands up a meaningful untaxed pool, the Safe arms
the universal tax and the bypass stops being profitable. The mechanism is already written and will
already have been audited; retaining it at zero costs nothing but the audit surface it already has.

**(b) Sequence POL before the migration.** Do not move the canonical pool to v4 until POL depth is
enough that a rival pool is not the better trade.

---

## 5. The oracle

`OmrTwapOracle` reads a **V2-style pair's cumulative price**. v4 pools do not expose that interface,
so the oracle must change with the pool. Two options:

1. **Hook-native oracle** — accumulate observations in the same hook (an `afterSwap` write). Removes
   the external keeper entirely, which also retires the operational dependency the watchdog from task
   #313 exists to monitor.
2. **Keep a thin V2 pair alive purely as the oracle source.** Ugly, and it splits liquidity for no
   trading benefit.

Option 1 is clearly right, with the caveats the oracle audit already established carried over
verbatim: **bound the observation window on both sides** (a multi-day interval closed one second ago
is one second "fresh" by a `lastUpdate` check — that was finding F2), and **fail closed** — an
unusable reading must make `priceCeiling()` revert, not return a stale number.

This is a second contract with its own audit surface, and it is on the bond mint path
(`OmertaBond` wall 4). It should be scoped as its own piece of work, not a footnote to the hook.

---

## 6. The cross-chain RWA leg — the consequence most likely to be missed

The R2 float buys **real Robinhood tokenized stocks**, which trade on **Arbitrum / Robinhood Chain**
(recorded in `CLAUDE.md`'s Sensitive design notes, and jurisdiction-gated: EU-facing, not for US
persons, so R3 extraction must be KYC'd *and* geofenced).

If OMR and its pool live on **mainnet**, then:

```
mainnet:   sell → hook → WETH (dev / rwa / lp slices)
                              │
                              ▼  BRIDGE
arbitrum:  rwa_revenue → buy bot → stock tokens → rwa_reserve
```

A bridge now sits inside the one accounting path whose entire thesis is **"the game only ever owes
stock it already owns"** (`runRwaInvariants`: `allocated ≤ held` per ticker). Bridged-but-not-yet-
arrived ETH is neither spent nor held. The invariant does not currently model an in-flight state.

Three ways to handle it, in order of preference:

1. **Book the RWA slice as revenue only on ARRIVAL** at the Arbitrum side. The bridge becomes invisible
   to the invariant — `rwa_revenue` simply increments later. This is the same discipline as the
   `txHash` anti-fabrication gate: revenue exists when it is *there*, not when it is *promised*. It
   costs latency and nothing else. **Recommended.**
2. Model an explicit `in_transit` bucket and extend `runRwaInvariants` to `spend ≤ revenue` where
   revenue excludes in-transit. More faithful, more surface.
3. Keep the RWA slice's *destination* on Arbitrum by taking that slice on Arbitrum — i.e. run the
   canonical pool on mainnet but a secondary on Arbitrum. Rejected: it re-fragments liquidity, which
   is the exact thing §4 says we cannot afford.

**Founder decision needed** (§10.2). Note this consequence exists whether or not we adopt v4 — it follows
from *mainnet*, not from *hooks* — but the migration is the natural moment to handle it.

---

## 7. Costs and risks

| item | assessment |
|---|---|
| **Audit clock** | Resets again, and *widens*. v4 hook auditing is a distinct specialty with its own attack surface (both Hacken and QuillAudits run dedicated v4-hook practices). We are already blocked on gate 2; this is a bigger gate 2. |
| **Address mining** | Required. Permission flags are in the address. Mine the full plausible set — a missing flag is a migration. |
| **Hook immutability** | The permission set is permanent. Logic can be made upgradeable behind the Safe, but that is its own risk decision and cuts against "credibly neutral for longevity". |
| **Mainnet gas on swaps** | Hook callbacks add gas per swap. v4's singleton + flash accounting is *cheaper* than v3/v2 as a baseline, which offsets much of it, but a taxed sell is not free. |
| **MEV** | Real on mainnet in a way it is not behind an L2 sequencer. A fee-taking hook is a known MEV surface; worth an explicit look during the hook audit. |
| **Backend churn** | `watcher.js` moves from the `SellTaxTaken` ERC-20 log to hook events. The RWA buy bot and Vig buyback move from V2 router calls to `@uniswap/v4-sdk` (`V4Planner`/`Actions`, `V4Quoter` for off-chain quoting, `PoolKey` + `hookData`). `recordSellTax`'s signature changes — it no longer needs `priceOmrPerEth`, because the slices arrive already denominated in ETH. |
| **LP fragmentation** | A hooked pool is a distinct pool; LPs must opt in. POL mitigates. |

### 7.1 What gets *simpler*

- **OMR becomes an inert ERC-20 again** (with the tax path armed at zero). That is a meaningful
  security win: v2 step 4 put tax logic into `_update` and reset the token's audit clock. A plain
  token is far easier to get signed off, and easier for integrators to trust.
- **The V2-compatibility deploy requirement dies.** V3/V4 routers, aggregators, every integrator.
- **One less oracle keeper** (§5).
- **`recordSellTax` loses its price argument** and with it a whole class of conversion error.

---

## 8. What this does not fix — mainnet gas on the game's own rails

Independent of hooks. The M6 rail was designed against L2 gas:

- `VoucherClaim.claim()` — a player redeeming a modest `$OMR` balance may pay more in mainnet gas than
  the withdrawal is worth. The full-reserve queue and the exit toll are unaffected in *logic*, but the
  **minimum economical withdrawal** rises by an order of magnitude, which cuts directly against the
  Street Wage's "a skilled player can earn a small living" thesis for small earners.
- `GearVault` ERC-1155 claims — same shape, worse ratio (gear is claimed per-item).
- `OmertaFees` — fine. A 0.01 ETH mint fee dwarfs its own gas.

**Options, none free:** batch/lazy claims; sponsor gas (a paymaster) for the withdrawal path; keep the
*game* rails on an L2 while the *token* lives on mainnet (canonical OMR on mainnet, a bridged
representation for the game — which reintroduces a bridge in the extraction path, the thing §6 is
already wrestling with); or accept a higher withdrawal minimum and say so honestly in the copy.

This deserves its own decision and is out of scope here, but it must not be discovered after the
mainnet commitment is made.

---

## 9. Bonds under the hook

**Founder question (2026-07-30):** "How do we keep bonds in the equation as well — the founder ability
to mint bonds in OMR in exchange for ETH for LP/Operations Cost."

Short answer: **the hook does not touch bonds, and that rail is already built and running.** But the
question surfaced three couplings, one convergence win, one genuinely sharp new risk, and one live
defect that both bond invariants are structurally blind to (§9.7).

### 9.1 They are different rails, and that is the point

| | bond | hook |
|---|---|---|
| market | **primary** — protocol ↔ bonder | **secondary** — holder ↔ holder |
| supply | **mints** new OMR (v2 step 4: the *only* mint) | moves existing OMR |
| ETH | paid in, forwarded in-tx to the treasury wallets | taken out of the swap |
| pool | never touches it | is the pool |

A bond does not swap and a swap does not mint, so the v4 migration is a change to the second column
that leaves the first alone. Nothing in §§1–8 removes, weakens, or reprices the bond rail.

The founder's framing — *mint OMR for ETH, spend the ETH on LP and operations* — is precisely
`OmertaBond`'s four-way split, answered numerically:

| slice | bps | destination | founder's framing |
|---|---|---|---|
| `POL_BPS` | 3750 | protocol-owned liquidity | **LP** |
| `DEV_BPS` | 1500 | dev wallet | **operations** |
| `VIG_BPS` | 2250 | Vig buyback → withdrawal reserve + prize pool | backs the player exit |
| `RWA_BPS` | 2500 | the stock float | the legit-money leg |

**LP + operations = 5250 bps of every bonded ETH**, already wired, already invariant-checked
(`runBondInvariants`), already deployable. The four walls that bound the mint — `dailyCapOMR`,
`MAX_DISCOUNT_BPS` 2000, `maxOmrPerEth` (fail-closed at 0), and the oracle's `priceCeiling()` — are
unchanged by v4, with the one exception in §9.2.

### 9.2 Coupling 1 — the oracle moves with the pool, and bonds fail closed when it does

This is the only **hard** dependency, and it is a sequencing trap rather than a design problem.

Wall 4 reads `OmrTwapOracle`, which reads a **V2-style pair's cumulative price**. §5 (now decided:
hook-native) replaces that. `OmertaBond.setOracle` repoints it — one Safe transaction — but the
contract is deliberately fail-closed: **no usable reading ⇒ `priceCeiling()` reverts ⇒ every bond
refuses.** That is correct behaviour (an oracle on a mint path must fail closed), and it means:

> **The oracle cutover and the pool migration are one operation from the bond's point of view.** A gap
> between them is a bond outage, not a degraded quote.

Sequencing, in order, none of it skippable:

1. Deploy the hook-native oracle against the new pool.
2. **Let it accumulate a full window** — a fresh oracle has no average, and §5's fail-closed rule means
   it correctly reports "no usable reading" until it does.
3. `setOracle` on the bond.
4. *Then* migrate liquidity.

Doing (4) before (3) points wall 4 at a pool that is no longer where price is discovered — which is
worse than an outage, because it still returns a number.

### 9.3 Coupling 2 — POL's destination changes shape

POL is 37.5% of every bond, and it is the moat §4 depends on. But **v4 has no LP token.** Liquidity is
a position inside the singleton `PoolManager`, opened via `modifyLiquidity` against a `PoolKey` — and
the `PoolKey` includes the hook address, so a v4 position is bound to *that* pool and that hook.

Three consequences:

- The POL deployment tooling changes (V2 `addLiquidity` → v4 position management).
- **POL already sitting in the old pair does not move itself.** Migrating it is a deliberate withdraw →
  redeploy, and it is the same work §4b already calls for, seen from the bond side.
- A v4 position has a **range**. Full-range is the honest default for POL — a concentrated position is
  a rebalancing commitment, and protocol-owned liquidity that nobody is rebalancing goes out of range
  and stops being the moat it was funded to be.

### 9.4 Coupling 3 — `dailyCapOMR` must be re-derived after migration

`npm run dials` sizes the daily cap at **≈5% of the pool's OMR reserve**, so that a full day's cap
dumped moves the price ≤10%. Its headline finding was that the damage is **price impact, not dilution**
— which makes the cap a function of *depth*, not of supply.

The migration changes which pool is canonical and (by §4b) deliberately changes its depth. So the cap
must be re-derived after migration and after any material POL change. That rule already exists; the
migration is a moment it must actually be applied rather than assumed.

### 9.5 The convergence win

Today the two ETH streams are different shapes: bond ETH **arrives as ETH**, tax "ETH" is really OMR
that must be sold to become ETH (§1.1). After the hook, both arrive as WETH, in the same slices, to the
same wallets:

- `recordSellTax` and `recordBond` converge on one shape. `recordBond` already books four ETH slices;
  `recordSellTax` loses its `priceOmrPerEth` argument (§7.1) and with it the conversion step.
- One remainder rule, one dust discipline, one treasury accounting story instead of two.

**Deliberately not proposed:** linking the fee rate to bond activity. Dynamic fees are approved as a
capability (§2.4), and "raise the sell fee while bonds are vesting" is the obvious next thought — but
coupling primary issuance to the secondary fee rate reintroduces exactly the reflexivity §1.1 exists to
remove. Keep the two rails independent.

### 9.6 The new risk: the bond flipper is the most motivated bypass-seeker on the chain

This is the sharpest interaction between bonds and pool-local enforcement (§4), and it is not obvious
until the arithmetic is done at today's actual numbers:

```
DISCOUNT_BPS 800  →  1 ETH bonds 1.08 ETH-worth of OMR
sell it back through the hooked pool, paying 900 bps
        1.08 × 0.91 = 0.983
```

**An immediate flip loses ~1.7%** — before five days of vest exposing it to price risk. So at 8/9:

> **The sell tax is what makes a bond a hold rather than an arbitrage.** That is load-bearing and, as
> far as I can find, nobody had written it down.

Two consequences follow, and the first is the strongest argument in this document for §4a:

1. **A bonder who finds an untaxed pool flips at +8%, near risk-free, at size, on a known schedule.**
   They are the single most motivated bypass-seeker OMR will have — an ordinary seller saves 9% on an
   unplanned trade; a bonder converts a losing flip into a profitable one, repeatedly, with capital
   they raised for the purpose. Pool-local enforcement hands them the discount. **The armed-at-zero
   ERC-20 backstop therefore protects the bond programme, not just the revenue line** — and the trigger
   for arming it is not "we lost some tax", it is "bonds have become an arbitrage".
2. `MAX_DISCOUNT_BPS` is 2000 against a 900 tax: at cap, a flip is **+9% guaranteed**. That cap is a
   rogue-signer backstop rather than a setting, but the relationship deserves to be a stated operating
   rule rather than an accident of two independently-chosen numbers:

   > **`DISCOUNT_BPS` must stay strictly below `sellTaxBps`.** Cheap, checkable, and it is what keeps
   > bonding a capital-formation instrument instead of a subsidy on selling.

   Worth a load-time assertion alongside the existing `SELL_TAX` sum check, and worth stating in the
   hook's own tests since the two constants will then live in different contracts.

**Gas footnote:** mainnet gas on `bond()` + `claim()` is fine, unlike §8's withdrawal problem. A bond is
a large, deliberate, infrequent purchase with a `MIN_PRINCIPAL_ETH` floor — the same reasoning that
makes `OmertaFees`' 0.01 ETH mint fee unproblematic. The gas concern in §8 is specific to small,
frequent, per-player claims.

### 9.7 The defect this question surfaced — the bond's RWA slice never arrives on-chain

`Bonded` emits `toPol, toDev, toVig`. **The contract has no RWA recipient at all** — its constructor
takes `polBps_`/`devBps_` and treats the remainder as Vig. But `recordBond`'s on-chain branch reads an
`onchainRwa` that the watcher cannot supply, because the event has no such field:

```js
const rwaEth = onchain ? round6(num(onchainRwa) || 0) : (real ? round6(eth * BONDS.RWA_BPS / 10000) : 0);
const vigEth = onchain ? round6(num(onchainVig))     : (real ? round6(eth - polEth - devEth - rwaEth) : 0);
```

So on the path that will actually run in production: **`rwaEth` is 0 on every real bond, and the
contract's whole 4750 bps remainder is booked as Vig revenue.** The signed split is 2250 Vig / 2500 RWA.

The ETH is not lost — it lands in `vigRecipient` — but it lands in the wrong place per the split the
founder signed, and the slice that goes missing is the one v2 §6 calls the float's **primary inflow,
the thing that keeps the stock float growing when DEX volume is thin.** Which is precisely the
"quiet market" this whole one-way-conversion design produces.

**Both invariants are blind to it, and that is the part worth dwelling on:**

- check (4) is `pol + dev + vig + rwa == principal` — Vig absorbs the missing slice *exactly*, so it
  sums to the principal and reconciles.
- `bond RWA slice == rwa_revenue` compares **0 to 0** and passes.

It would have surfaced months after mainnet as "why is the float empty?", with every check green. It is
the same shape as the guard failures the harnesses keep teaching: **a check that cannot fail reads
exactly like a clean bill of health.**

Chain-dormant today (no bond chain configured), so nothing is currently wrong in production. Two fixes,
and the choice is the founder's because it turns on wallet topology, not on code:

1. **Four-way split in the contract (recommended).** Add `rwaBps` + `rwaRecipient`, emit `toRwa`, and
   have the watcher and `recordBond` read it. It mirrors the existing three-way code exactly, it makes
   the contract the source of truth for all four slices (which is what `recordBond`'s comment already
   claims it is), and **the audit clock is resetting for the hook anyway**, so the marginal cost is
   close to zero. This is the moment to do it.
2. **Backend-only interim:** split the event's `toVig` by the signed 2250:2500 ratio. **Valid only if
   `vigRecipient` and the RWA buy bot share one custody.** If they don't, this books float backing
   against ETH the float does not hold — which is exactly the class `allocated ≤ held` exists to
   prevent, and exactly the discipline the `txHash` anti-fabrication gate enforces everywhere else.
   Not shipped for that reason.

---

## 10. Open decisions for the founder

1. ~~**Pool-local enforcement (§4)**~~ — **DECIDED (founder, 2026-07-30): accepted**, with the
   armed-at-zero ERC-20 backstop retained. §9.6 sharpens *why* that backstop matters.
2. ~~**The RWA bridge (§6)**~~ — **MOOT.** The founder retired the stock layer the day after this doc
   was written (`omerta-stock-layer-retirement.md`): the game acquires no tokenized equities and the
   treasury holds **ETH**. There is nothing to buy on Arbitrum, so there is no bridge in the
   accounting path, and §6 is obsolete rather than answered. What survives is the four ETH slices at
   their signed bps, with `rwa_revenue` repurposed as the treasury's inflow ledger — so the hook's
   third slice lands as WETH in the destination currency, which is *simpler* than the case §6 feared.
3. **Mainnet gas on withdrawals (§8)** — which mitigation, or accept a higher minimum? **OPEN.**
4. ~~**Dynamic fees (§2.4)**~~ — **DECIDED: the capability is approved.** Ship the machinery; ship the
   *rate* flat at 900 bps. The curve itself is a new economic surface and still wants its own sim
   measurement and BALANCE sign-off — approving the mechanism is not approving a schedule.
5. ~~**Oracle (§5)**~~ — **DECIDED: hook-native**, scoped as its own contract. See §9.2 — it sits on the
   bond mint path, so its cutover is not independent of the migration.
6. **Age decay on-chain (§3)** — hold at the game boundary (recommended)? **OPEN**, but note the hook
   as built takes the recommendation: it has no age logic, and adding any would be new logic in an
   immutable contract, i.e. a redeploy.
7. ~~**The bond ETH split (§9.7)**~~ — **BUILT (2026-07-31).** Four-way in the contract: `rwaBps` +
   `rwaRecipient`, `Bonded` emits `toRwa`, the watcher and `recordBond` read it, the remainder rule
   moved to the Vig so the four sum to the principal exactly, and `runBondInvariants` gained a
   per-bond "the slice reached the ledger" check — the one thing neither existing invariant could see.
   Deploy requirement: `rwaRecipient` must be a DIFFERENT key from `vigRecipient`, or the custody
   defect the backend interim was rejected for reappears with the books still reading correct.
8. **TWO HOOKS ARE PLANNED FOR ONE POOL, AND A `PoolKey` HOLDS EXACTLY ONE.** **ANSWERED 2026-08-02
   (SIGN-OFF D1 = A, the fold): one hook, four destinations — a new buy-side trade fee joins the sell
   tax in `OmertaHook`. NOT YET BUILT: the buy-fee RATE (proposed 20 bps) awaits founder confirmation
   (SIGN-OFF.md, THE SHEET REFRESHED Part A), and the contract change must land before an address is
   mined and the third-party audit runs.** The original fork, kept as the record: `omerta-uniswap-hooks-design.md` §2 specifies an
   `afterSwap`→Vig **trade-fee** hook — a small cut of *every* swap's ETH leg, funding the withdrawal
   reserve — and its BACKEND IS ALREADY BUILT AND DORMANT (`vig.js:recordTradeFee`,
   `watcher.js:syncTradeFees`, `TRADE_FEE_HOOK_ADDRESS`, the `TradeFeePaid(nonce, amountWei)` adapter).
   `OmertaHook` is a different fee with different economics: sells only, 900 bps, dev/rwa/lp — **the
   Vig is not among its slices.** They are not variants of each other and they cannot both be the hook
   for the canonical pool. Three ways out, in order of preference:
   1. **Fold** — one hook, four destinations: keep the sell tax as-is and add the trade fee as its own
      rate on all swaps, emitting both events so the built Vig rail needs no change. Recommended, but
      it is a NEW FEE ON BUYS, which is an economic surface and wants its own sign-off, so it is not
      done here.
   2. **Retire the trade fee** and accept that the Vig is funded only by fees/store/bonds. Cheapest,
      and it costs a revenue line that was designed to widen `extraction ≤ inflow` headroom.
   3. Run the trade-fee hook on a second pool. Rejected for the same reason §4 rejects fragmenting
      liquidity — that pool would be the *untaxed* one and §9.6 says who would find it first.

Also decided in passing: **the cut is taken in ETH** (§2.1 — the core move), and **OMR may become an
inert ERC-20** with its tax path armed at zero (§7.1).

## 11. Sequencing, if it goes ahead

Nothing below starts before the founder answers §10, and nothing deploys before the two standing gates.

1. ~~**`OmertaBond` four-way ETH split (§9.7)**~~ — **DONE (2026-07-31).** See §10.7.
2. ~~`OmertaHook.sol` + Foundry suite~~ — **DONE.** 19 tests, `forge test` 128/128 across the suite
   (was 109/109), incl. a 512-run dust fuzz. **They run against a real `PoolManager` with real
   liquidity and real swaps**, not a mock, so the fee is measured against what a swapper actually
   received. Everything §11.2 asked for is asserted, and four things the sketch did not anticipate
   turned up in the building and are worth reading before the audit:

   - **The pool gate is the security property, not the fee.** A hook address is part of a `PoolKey`,
     so *anyone* can create a pool that uses this hook — and then swap against themselves in an
     (OMR, WORTHLESS) pool and emit a real `SellTaxTaken` with a real transaction hash. That is
     fabricated revenue wearing the exact credential the backend's anti-fabrication gate trusts.
     `beforeInitialize` therefore reverts unless one side is OMR and the other is a Safe-approved
     quote. Without it the whole event stream is forgeable by a stranger for the price of gas.
   - **The fee ACCRUES and is swept separately**, rather than being forwarded in-tx like `OmertaFees`.
     That precedent is right for a tollbooth and wrong for a hook: three pushes inside a swap means
     any one recipient reverting on receipt **bricks the pool**. Pool liveness must not depend on a
     wallet's behaviour. `sweep` is permissionless, pays only the Safe-set recipients, and a broken
     recipient now costs a failed sweep instead of a market outage (regression-tested).
   - **An immutable hook has to ship every seam its own roadmap needs.** Permissions live in the
     address and the logic has no proxy, so step 3's oracle could not have been wired to this pool
     later at all. The hook therefore ships an `observer` seam (called fail-safe, gas-stipended) and
     a mined `beforeSwap` + fee-override slot, both unused today.
   - **Exact-output sells are taxed in OMR, not the quote**, and this is stated rather than hidden.
     `afterSwap` can only take a delta on the *unspecified* currency, which is the output for an
     exact-input swap (the upgrade, and where all router volume is) and the input for an exact-output
     one. Charging in `beforeSwap` instead would fix the denomination and break partial fills, which
     §2.2 already warned about. The honest reading: that path is at **parity with the ERC-20 tax it
     replaces** — taxed, in the worse currency — and it is not a bypass.

   Also decided while building, and worth an auditor's eye: **there is no pause.** A hook that can
   revert `beforeSwap` can halt a public market; the only lever is the rate, and zero stops the fee
   rather than the pool. And the §9.6 operating rule is asserted in **two** places — the Foundry
   suite (contract side) and `preflight.js` (a WARNING, following the PLEX-rail precedent, because a
   mispriced relation should not take a live server down).
3. Hook-native oracle, with the F2 both-sided window bound and fail-closed semantics carried over.
4. Address mining for the flag set; deterministic deploy script.
5. Backend: `watcher.js` hook-event sync; `recordSellTax` signature change; bots onto `@uniswap/v4-sdk`.
   `test/rwa.js` + `test/watcher.js` extended. **§10.4 is untouched by all of this** — the sell tax is
   real-value accounting and writes zero `transactions` rows; that property must be re-asserted, not
   assumed.
6. POL seeding into the hooked pool ahead of migration (§4b), then the POL position migration (§9.3).
7. **Oracle cutover before liquidity migration** (§9.2), with a full accumulation window between deploy
   and `setOracle`. Re-derive `dailyCapOMR` against the new depth afterwards (§9.4, `npm run dials`).
8. Third-party audit — **contracts, hook and signer**. Then legal. Then deploy.

---

## References

- [IHooks (v4-core)](https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IHooks.sol)
- [Hooks library — permission flags](https://github.com/Uniswap/v4-core/blob/main/src/libraries/Hooks.sol)
- [BeforeSwapDelta guide](https://docs.uniswap.org/contracts/v4/reference/core/types/beforeswapdelta-guide)
- [Custom accounting](https://developers.uniswap.org/docs/protocols/v4/guides/custom-accounting)
- [Swap hooks](https://developers.uniswap.org/docs/protocols/v4/guides/hooks/swap-hooks)
- [Accessing msg.sender inside a hook](https://docs.uniswap.org/contracts/v4/guides/accessing-msg.sender-using-hook)
- [Auditing Uniswap v4 hooks (Hacken)](https://hacken.io/discover/auditing-uniswap-v4-hooks/)
- [v4 hooks and security (QuillAudits)](https://www.quillaudits.com/research/uniswap-development/uniswap-v4/uniswap-v4-hooks-and-security)
- [v4 SDK](https://docs.uniswap.org/sdk/v4/overview) · [V4Quoter](https://github.com/Uniswap/v4-periphery/blob/main/src/lens/V4Quoter.sol)
- [Mainnet PoolManager](https://etherscan.io/address/0x000000000004444c5dc75cb358380d2e3de08a90)
