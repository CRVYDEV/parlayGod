# THE FLOAT — the RWA reserve rebuild (R2, redesigned)

> ## ⛔ RETIRED 2026-07-31 — SUPERSEDED BY `omerta-stock-layer-retirement.md`
> The founder removed the stock layer: **the treasury holds ETH; nothing buys, holds, allocates or
> delivers real shares.** There is no vault, no reserve, no buy bot and no `allocated ≤ held`. The four
> ETH slices this doc created **survive at their bps** — only the destination changed, from a buy bot to
> a treasury Safe (`src/treasury.js`, formerly `src/rwa.js`). Everything below is HISTORY: read it for
> why the design was shaped this way, not for what the code does.

**Founder-directed 2026-07-23.** Supersedes the R2 sketch in `omerta-rwa-portfolio-design.md`.
The founder's diagnosis — "the OMR → tokenized-stocks conversion doesn't really work" — is correct,
and this doc records why, and the redesign that replaces it. Founder approved all three forks:
$OMR-burn-only entry rail; two-tier book (paper + vaulted); funding = Store 20% + a new gameplay-fee
slice.

## 1. Why direct OMR→stock conversion is unsound

1. **A burn funds nothing.** Burned $OMR brings no external value in. Real stock must be bought with
   real money; if shares are "bought" with a burn, either they stay fake, the treasury silently eats
   the cost (unbounded drain), or the game promises stock it doesn't own (Ponzi-shaped liability).
2. **The fake price breaks backing.** R1's deterministic §7.11 hash price ≠ the Uniswap price. Any
   backed share priced off the hash is either free money for players or a treasury hole.
3. **It collapses the legal wall.** $OMR convertible into securities on demand makes $OMR itself a
   securities-purchasing instrument — dragging the whole token into the regulated zone instead of
   confining it to one KYC'd exit gate.

## 2. The principle (already load-bearing elsewhere)

**The game only ever owes stock it already owns.** This is the full-reserve withdrawal queue
(`signedOutstanding ≤ funded_omr`) and the OmertaBond anti-Ponzi cap (`committed ≤ capacity`),
applied to the RWA side. Everything is denominated in **token UNITS, never dollars** — price
movement can never create a shortfall because the liability is a unit count, not a value promise.

## 3. The flow

```
ETH taxes ──► rwa_revenue (accounting bucket, out-of-band)
                 │  spend ≤ revenue (the Vig discipline)
                 ▼
        THE BUY BOT (mainnet; mod-driven param here)
        swaps ETH → real tokenized stock on Uniswap → the company Safe
                 │  every buy logged (units, eth, price, txHash)
                 ▼
        rwa_reserve — THE FLOAT (per-ticker units held + cost basis)
                 │  allocated ≤ held  (THE anti-Ponzi invariant)
                 ▼
        rwa_vault — the player's VAULTED BOOK (account-level, survives death)
                 ▲
   players claim from the float by burning earned $OMR at the REAL oracle price
   (rwa:vault — $OMR is the RATIONING TICKET; the ETH taxes were the FUNDING)
                 │
                 ▼  (R3, legal-gated: KYC + geofence)
        extraction delivers the actual token — trivially safe: it's already held
```

**The reframe:** players never convert $OMR into stock. They spend earned $OMR to claim allocation
from a float that spender ETH already paid for. The burn is deflationary; the real value was funded
by revenue; if the float is empty, claims wait for the next buyback — never an IOU.

## 4. Funding — the ETH tax map

| Source | Slice | Status |
|---|---|---|
| Store packages | `STORE.SPLIT_BPS.rwa` 20% | **already built** (`rwa_revenue`, dormant — accumulating) |
| Gameplay fees (mint/respawn/reroll) | `FEE_RWA_BPS` **10%** (new, env) | this drop — carved from the FOUNDER share (Vig stays 60%; founder 40%→30%) |
| Bonds | none | deliberately untouched (POL/Dev/Vig back withdrawals) |

Booked ONLY for real on-chain payments (`txHash` gate — the AUDIT-full-system-v2 D-MED2 discipline);
a comp/QA record injects zero RWA revenue.

## 5. The two-tier book

- **The paper book** (`portfolios`) — everything built to date: hash-priced status shares, dynasty
  names + crest tiers, landmarks, the $OMR dividend pool, leaderboards, heist/season grants. Pure
  status, zero real-world liability, unchanged. Shares bought at fake prices are never
  grandfathered into real claims.
- **The vaulted book** (`rwa_vault`) — the backed layer. Priced at the REAL oracle
  (`last_price_eth` per unit × the Vig buyback's OMR-per-ETH TWAP; PLEX floor pre-market). Claims
  clamp to the float's available units. No sell, no cash-out until R3 (the wall holds).

Dividends stay on the paper book (the sink-fed $OMR pool as audited) — the vaulted book's payoff IS
the real backing, not a yield.

## 6. Anti-abuse + the Law surface

- **Rationing:** per-account rolling-24h claim cap (`CLAIM_DAILY_OMR`, the D3 wash-bucket pattern on
  `account_persistent.vault_used/vault_at`) so a whale can't sweep a fresh float in one call.
- **The RICO graduation applies:** vault claims ride the SAME cumulative `rwa_used` window as paper
  invests (structuring-proof), draw `SCRUTINY_HEAT`, and are safehouse-blocked (P1.3) — moving big
  money into legit fronts is a visible act whichever book it lands in. Jailed-gated.
- **Per-ticker reserve-row lock** (`rwa_reserve FOR UPDATE`) serializes concurrent claims so two
  buyers can't both read the last unit (chars → accounts → leaf, canonical).

## 7. Invariants (`runRwaInvariants`, `GET /v1/mod/rwa`)

1. **spend ≤ revenue** — Σ buys.eth ≤ Σ rwa_revenue.rwa_eth (the Vig root cap).
2. **allocated ≤ held** per ticker — Σ rwa_vault.units ≤ rwa_reserve.units (THE anti-Ponzi check).
3. **held == Σ buys.units** per ticker (no phantom float).
4. **cost basis == Σ buys.eth** per ticker.
Plus real-vs-simulated unit reporting: pre-mainnet ALL buys are simulated (`real=false`, no txHash);
before R3 extraction ever ships, simulated units must be reconciled against actual Safe holdings —
the invariant view makes the gap visible, never hidden.

## 8. What is deliberately NOT built

- **Direct ETH→shares purchase** — makes the game a securities dealer at the point of sale (KYC at
  entry, the heaviest surface). Rejected; entry stays in-game.
- **The real Uniswap bot + Safe custody** — mainnet milestone, gated on legal counsel + the
  third-party audit (the M6/bond dormant pattern). This drop is the complete off-chain core.
- **R3 extraction** — unchanged: KYC'd + geofenced (no US persons per Robinhood's product terms),
  capped by the player's vaulted units, reserve-backed by construction.
- **Never by chance** — unchanged: no RNG/loot/casino path touches either book.

## 9. Levers (founder sign-off)

`FEE_RWA_BPS` 1000 · `CLAIM_DAILY_OMR` 500 · `CLAIM_MIN_OMR` 5 · the oracle floor
(`STORE.PLEX_FLOOR_OMR_PER_ETH`, shared) · buyback cadence/size (bot). No earnings/appreciation
marketing until counsel clears wording (the standing wall).
