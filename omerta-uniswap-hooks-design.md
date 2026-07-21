# OMERTÀ × Uniswap — DEX strategy + the afterSwap→Vig fee hook (design)

Status: **DESIGN ONLY. Chain-dormant, mainnet-gated on legal counsel + a third-party contract audit
+ `forge test`** (the M6 posture). Nothing here is wired into the critical path. This doc is the
plan; the hook is the one piece worth prototyping first.

Companion to: `omerta-phase2-vig-design.md` (the Vig), `omerta-phase4-emission-design.md` (backed
emission), `omerta-rwa-portfolio-design.md` (R2/R3 tokenized stocks on Uniswap), `omerta-reserve-bond-design.md`
(POL acquisition), and the chain migration doc `omerta-chain-migration-evm.md`.

---

## 0. Why Uniswap is already in the plan

We're not deciding *whether* to use Uniswap — three built/planned pieces already land on it:
- **The Vig buyback** spends real ETH revenue on hard $OMR "on an EVM DEX (not Jupiter)" — that DEX is
  Uniswap on Robinhood Chain. `runVigBuyback` already reads `price_omr_per_eth` "= the DEX TWAP" (vig.js:33).
- **Protocol-Owned Liquidity**: `OmertaBond` acquires POL and the 12h buyback carves `AMM_LP_BPS` (25%)
  into POL — "paired into the pool on mainnet." That pool is a Uniswap OMR/ETH pool.
- **The RWA layer** (R2/R3): the founder confirmed the tickers are *real Robinhood tokenized stocks
  trading on Uniswap* (Arbitrum / Robinhood Chain). R2's buy-bot swaps ETH → the stock token on Uniswap;
  the backing price is the live Uniswap TWAP.

So the question this doc answers is: **how do we use Uniswap — and specifically v4 hooks — deliberately,
to strengthen the invariants we already fought for**, rather than incidentally.

The single invariant everything must preserve is unchanged: **cumulative $OMR players can withdraw ≤
cumulative $OMR the Vig bought with real revenue** (extraction ≤ inflow), enforced by the full-reserve
withdrawal queue (chain.js) fed only by `runVigBuyback`. Every idea below either helps that invariant or
is out-of-band of it — none loosens it.

---

## 1. The staged ladder (ranked by fit / risk)

Ship in this order; each rung is independently useful and the risk rises as you climb.

**Rung 1 — Uniswap IS the oracle (no new code).** Canonicalise the OMR/ETH v3/v4 pool's **TWAP** (not
spot) as the price source for `plexQuote` (vig.js:44 already reads the latest buyback price) and the R2
RWA backing price. This removes the last hand-set price parameter and makes PLEX/backing manipulation-
resistant. Zero contract surface — it's a read.

**Rung 2 — Concentrated POL (v3 range, or a v4 range position).** The bonds + the `AMM_LP_BPS` carve
already build POL. Provide it **concentrated around spot** instead of full-range: the same treasury ETH
gives players a far deeper, lower-slippage cash-out — which is the entire Risk-to-Earn promise (the earner
gets a clean exit). It's *protocol-owned*, so impermanent loss is the protocol's, and it's backing, not
speculation. No hook code — just how the treasury LPs.

**Rung 3 — the afterSwap→Vig fee hook (THE PROTOTYPE — §2 below).** A v4 pool for OMR/ETH whose
`afterSwap` hook skims a small fee to the Vig, so **every secondary-market trade of extracted $OMR fuels
the redistribution + reserve** ("traders fund earners"). It's the deferred "new ETH revenue sources" item
made automatic, and it's real inflow → *more* extraction headroom.

**Rung 4 — the beforeSwap circuit-breaker (hardening).** A `beforeSwap` hook on the OMR pool adds on-chain
defense-in-depth for the invariant we care most about: a per-epoch net-OMR-outflow rate-limit (mirroring
`DAILY_CAP_OMR`) + a pause on extreme price deviation (which also shields the buyback bot from being
sandwiched right before it executes). Moves a slice of the off-chain safety on-chain / trustless.

**Rung 5 — counsel-gated pieces of R2/R3.** (a) A `beforeSwap` KYC/geofence hook on the *stock* pool that
checks an on-chain attested allowlist (KYC'd, non-US) before permitting a swap that delivers a security
token — the "one regulated extraction boundary" enforced on-chain. (b) Surfacing a player's real LP
position as the apex "going legit" status trophy in the Estate/Portfolio. **Both are securities-law
designs, not features to ship** — same wall as R2/R3 (legal counsel + audit).

**Explicitly OUT:** do NOT move the in-game cash↔$OMR AMM (`amm_pool`, a DB table) on-chain — it's
server-authoritative and "cash" isn't a token, deliberately. Do NOT replace `OmertaBond` with a v4
custom-curve bonding hook — the dedicated contract keeps the "no reflexive mint, tranche-capped" property
legible and separately auditable; a hook would obscure exactly what we fought to keep obvious.

---

## 2. The afterSwap→Vig fee hook (the prototype)

### Thesis
Today the Vig is fed only by *gameplay* ETH fees (mint / respawn / Store). But once $OMR is extractable it
will *trade* — and that trading volume is currently value that leaves the system. A v4 hook turns it into
fuel: skim a small fee on OMR/ETH swaps, route it to the Vig, and the buyback converts it to reserve +
prize $OMR. **Spenders fund earners → traders fund earners too**, and because it's real ETH inflow, it
widens the `extraction ≤ inflow` headroom rather than touching it.

### On-chain shape (DESIGN SKETCH — not deployed, pre-audit)
A v4 hook contract, Safe-owned, that on `afterSwap` takes `HOOK_FEE_BPS` of the swap's ETH leg, forwards
it straight to the fee/Safe wallet in the same tx (custodies nothing — the `OmertaFees` tollbooth
pattern), and emits a monotonic-nonce event. It mints nothing and never touches $OMR supply.

```solidity
// ILLUSTRATIVE ONLY — pre-audit, chain-dormant. Mirrors OmertaFees (forward-in-tx, custody nothing,
// monotonic nonce) + the v4 hook interface. The real thing needs the full IHooks surface, flash-
// accounting-correct fee take, reentrancy guards, an owner fee setter (0 = disable), and pausability.
contract OmertaTradeFeeHook is BaseHook, Ownable2Step {
    uint256 public feeBps;            // Safe-settable; 0 disables the skim (fail-open to normal trading)
    address public feeWallet;         // the dev/Vig wallet (the ETH numéraire lands here, like OmertaFees)
    uint256 public nonce;             // monotonic — the off-chain idempotency key
    event TradeFeePaid(uint256 indexed nonce, uint256 amountWei);

    function afterSwap(/* v4 params */) external override onlyPoolManager returns (bytes4, int128) {
        uint256 fee = _ethLegDelta() * feeBps / 10_000;   // take from the ETH leg only (the numéraire)
        if (fee > 0) {
            _forward(feeWallet, fee);                      // CEI: forward in-tx, custody nothing
            emit TradeFeePaid(++nonce, fee);               // the watcher's source='trade' event
        }
        return (BaseHook.afterSwap.selector, 0);
    }
}
```

**Fee denomination.** Take the fee on the **ETH leg** (the numéraire) so it flows through the existing
ETH-denominated Vig rail verbatim. *(Noted v2 optimisation: taking the fee in $OMR instead would let it
fund the reserve directly with hard $OMR — no buyback swap, no slippage on the fee — but it needs a
distinct accounting path since `vig_revenue` is ETH-denominated. Ship the ETH version first; it reuses
everything.)*

### Backend integration (reuses the built rail — near-zero new code)
The event is observed by a **dormant watcher** (the `watcher.js` pattern — `getLogs` over a persisted
cursor, `CHAIN_CONFIRMATIONS` behind head, idempotent), which calls the EXISTING:

```js
recordVigRevenue(client, { source: 'trade', ref: nonce, kind: 'trade', amountWei });  // vig.js:56
```

`recordVigRevenue` already: converts wei→ETH, splits `VIG_BPS`, and is idempotent on `(source, ref)` — a
re-delivered log is a no-op (vig.js:62). Then `runVigBuyback` spends the now-larger unspent Vig revenue on
$OMR → `RESERVE_BPS` to the reserve, the rest to the prize pool (vig.js:79). **No new tables, no new
accounting** — `source='trade'` just joins `'fee'`/`'store'`/`'bond'` in the same `vig_revenue` sums, and
`runVigInvariants` (vig.js:178) reconciles unchanged because it sums by column, not by source.

**Security posture — inherit the D-MED2 discipline (this session's fix):** real-ETH revenue is booked
ONLY from the on-chain watcher observing a genuine `TradeFeePaid` log (which carries the real tx). A mod /
QA route must never be able to inject `source='trade'` revenue except behind `ALLOW_MOD_REAL_REVENUE=on`,
exactly like fees/store/bonds — else a comp could fabricate unbacked reserve and blind `runVigInvariants`.
Wire the trade watcher through the same gate.

### Config (env, founder sim + sign-off levers — the vig.js pattern)
- `HOOK_FEE_BPS` — the skim off each swap's ETH leg (small; the pool's LP fee tier is separate and larger).
- Reuse `VIG_BPS` (60%) for the dev/Vig split, or add `TRADE_VIG_BPS` if a trade fee should split
  differently from a gameplay fee (a trade fee arguably goes 100% to the flywheel — recommend
  `TRADE_VIG_BPS=10000` since there's no "business" counterparty on a trade). One-line addition.

---

## 3. Invariants the hook must preserve (the review checklist)

1. **Nothing mints $OMR.** The hook takes a *fee* from existing swap flow; the $OMR that later backs the
   reserve is *bought* by the buyback with that fee's ETH via the existing rail. OMR supply is untouched
   (fixed-supply, per the contract CLAUDE.md). ✓
2. **`extraction ≤ inflow` is strengthened, never loosened.** Trade fees are NEW real inflow →
   larger `revenueIn` → larger `unspent` → the buyback can fund *more* reserve. The root cap
   `ethToSpend ≤ revenueIn − alreadySpent` (vig.js:91) is unchanged. `runVigInvariants` check (1)
   `spend ≤ revenue` and check (4) `extraction ≤ reserve` hold by construction. ✓
3. **§10.4 in-game is untouched.** Trade-fee ETH and the bought $OMR are out-of-band real value, OUTSIDE
   the in-game conservation set — `recordVigRevenue` writes ZERO `transactions` rows (only `vig_revenue`).
   The in-game §10.4 sweep stays drift-0. (The only §10.4 touch in the whole Vig is the PLEX burn, and it's
   unchanged.) ✓
4. **Idempotent + real-only.** The watcher's `(source='trade', ref=nonce)` is idempotent; revenue is booked
   only from a real observed log; the mod-fabrication path is gated (D-MED2). ✓
5. **The hook cannot brick the pool.** A reverting `afterSwap` halts trading. The hook must be minimal,
   non-reverting on the happy path, CEI + `nonReentrant` on the fee-forward (forward to a trusted Safe
   wallet only, custody nothing — the OmertaFees pattern), gas-cheap (a transfer + an event), and carry an
   owner `feeBps=0` kill-switch + pausability. This is the whole risk of the idea and where the audit
   spend goes.

---

## 4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hook reverts → pool bricked | Minimal hook; happy-path never reverts; `feeBps=0` disables; pausable; heavy fuzz + the Foundry suite before mainnet |
| Reentrancy via the ETH forward | CEI + `nonReentrant`; forward only to the trusted Safe/fee wallet; custody nothing |
| Buyback sandwiched pre-execute | The bot already uses TWAP + slippage caps (vig design); Rung-4 circuit-breaker adds a deviation pause |
| Gas tax on every swap | Keep `afterSwap` to a transfer + emit; the fee itself is a small bps |
| v4 not deployed on Robinhood Chain | **Reality check FIRST** (§5). If only v3 exists, the fee needs a custom router / v3 protocol-fee mechanism (no hooks) — more work, ships later |
| Fabricated `trade` revenue via a mod route | Inherit the D-MED2 gate: real revenue only from the watcher; mod path behind `ALLOW_MOD_REAL_REVENUE=on` |
| Fee is a "trading tax" that thins volume | `HOOK_FEE_BPS` is a small sign-off lever; measure realised volume vs the flywheel contribution before raising it |

---

## 5. Deploy / audit gates (the standing walls)

- **Confirm v4's `PoolManager` is live on Robinhood Chain (Arbitrum Orbit L2).** v3 is far more widely
  deployed; if v4 isn't there, Rungs 1/2/5 (oracle, concentrated POL, and even the KYC-pool via a v3
  permissioned periphery) still work, but the afterSwap hook (Rung 3) does not — it becomes a v3 custom-
  router fee take. This is the first thing to verify before any hook work.
- The hook is **new critical-path Solidity** → the existing mainnet gate applies: `forge test` on a
  Foundry-capable box (still un-run — Foundry egress-blocked here) + the third-party contract audit that
  already gates the whole chain layer. Budget the hook into that audit; don't ship it separately.
- Chain-dormant until `CHAIN_RPC_URL` + the pool/hook addresses are set (the M6 pattern). The backend
  watcher stays inert until then, exactly like the fee/store/bond watchers.

---

## 6. Recommended sequencing (concrete)

1. **Now (free):** canonicalise the OMR/ETH TWAP as the oracle for `plexQuote` + R2 backing (Rung 1) — a
   read, no contract change.
2. **With the mainnet POL work:** provide the bond/`AMM_LP_BPS` POL as a concentrated range (Rung 2) — a
   treasury-ops decision, no hook.
3. **First hook to build + audit:** `OmertaTradeFeeHook` (Rung 3) — small, on-thesis, turns trading
   volume into reserve backing; wire the watcher → `recordVigRevenue(source='trade')` behind the D-MED2
   gate; add `HOOK_FEE_BPS`/`TRADE_VIG_BPS` env levers + a `test/` scenario proving `runVigInvariants`
   stays green with a `trade` source in the mix.
4. **Next hardening:** the `beforeSwap` circuit-breaker / outflow rate-limit (Rung 4).
5. **Counsel-gated, with R2/R3:** the KYC/geofence stock-pool hook + LP-as-status (Rung 5).

The prototype target is #3: it's the smallest hook that pays for its own audit by making the Vig
self-sustaining on real market activity — the strongest possible version of "spenders fund earners."
