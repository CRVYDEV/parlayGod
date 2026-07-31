# Retiring the stock layer — the treasury holds ETH

**Founder-directed 2026-07-31.** Supersedes `omerta-rwa-float-design.md` (R2/R3) and the R2/R3 half of
`omerta-rwa-portfolio-design.md`. R1 — the in-game Portfolio — is **unchanged and stays**.

---

## The decision

> "Instead of buying back RWA stock the treasury can hold ETH instead." → **the stock layer goes away.**

The game will not acquire, hold, allocate or deliver real tokenized equities. The ETH slices that were
earmarked to buy stock now simply accumulate in the treasury as ETH.

## Why this is the right shape (and why the alternatives were not)

The wall that made the float safe was **`allocated ≤ held`** — the game only ever owes stock it already
owns. That worked because both sides of the ledger were the same asset: the vault owed *units*, the
reserve held *units*.

So "the treasury holds ETH" is only coherent if the vault stops owing stock. The three readings were:

| | what it means | verdict |
|---|---|---|
| **A** | drop the stock layer; treasury accumulates ETH; no vault | **chosen** |
| **B** | keep the vault, back it with ETH | rejected — see below |
| **C** | hold ETH, buy stock just-in-time at redemption | rejected — same break as B |

**B and C were rejected on substance, not preference.** Handing someone a stock token you own is a
transfer of an asset you hold. Paying out the *value* of a stock you do not hold is a cash-settled
contract for difference — a derivative, and a materially worse legal posture than the thing it replaces.
Both also break the wall mechanically: if the stock runs and ETH does not, the treasury is short exactly
when players claim.

**What A buys.** It deletes the only securities event in the project. No buy bot, no per-ticker reserve,
no stock oracle, no KYC gate, no geofencing, and R2/R3 stop being carried milestones. It also resolves a
question that existed *before* any player was involved: Robinhood's tokenized stocks are EU-facing and
not for US persons, so a US-controlled treasury holding them was its own problem.

**What A costs, honestly.** "The mob goes legit and retires into blue chips" loses its real-world anchor.
ETH is not going legit — it is the same crypto risk in a different ticker. That narrative cost is real
and is accepted deliberately.

**What A does not cost.** Nothing was ever delivered to a player. R1 is status-only by design, and the
vault's claim rail — though built and callable — was **inert**: `claimVaulted` clamps to units available,
and the reserve is empty until the buy bot runs, which needs mainnet. This retires a promise, not a
working feature.

---

## The cut: remove the promise, keep the accounting

The surgical line is **anything that creates an obligation goes; anything that records an inflow stays.**

### Removed

| what | why |
|---|---|
| `claimVaulted` + `POST /v1/vault/claim` + `GET /v1/vault` | the player-facing claim on stock — the obligation itself |
| `runRwaBuyback` + `POST /v1/mod/rwa/buy` | the buy bot's seat; nothing buys stock now |
| `rwa_vault`, `rwa_reserve`, `rwa_buys` tables | what players were owed, what was held, what was bought |
| `runRwaInvariants`' unit checks (`allocated ≤ held`, `held == Σ buys`, cost basis) | nothing is allocated, so there is nothing to reconcile |
| `RWA_FLOAT.CLAIM_*` levers | no claim rail |
| the console "The Float" card | no product behind it |

### Kept, repointed

| what | now means |
|---|---|
| `rwa_revenue` (+ its four sources) | **the treasury's ETH inflow ledger, by source.** Still worth knowing what came in and from where. The table name is historical; renaming it is migration risk for no benefit, and the column comment says so. |
| `recordSellTax` + `sell_tax_events` | unchanged — records the on-chain sell tax episode and its slices |
| `BONDS.RWA_BPS` (2500) | the treasury's share of bond ETH. **The on-chain fourth slice built in `e598b6b` stands** — `rwaRecipient` becomes the treasury Safe rather than a buy bot. |
| `SELL_TAX` rwa slice (400 bps) | the treasury's share of the DEX sell tax |
| `STORE.SPLIT_BPS.rwa` (2000) | the treasury's share of Store revenue |
| `RWA_FLOAT.FEE_RWA_BPS` (1000) | the treasury's share of gameplay fees |

**The four slices keep their bps.** Changing them is a separate balance decision, and folding them into
POL/Dev/Vig would silently move real money between destinations. They now point at a treasury.

### Untouched

**R1, the Portfolio** (`src/portfolio.js`) — the in-game "going legit" status layer: `invest`, the
deterministic §7.11 hash price, the dividend pools (`rwa_dividend_pool`,
`rwa_family_dividend_pool` — these are **in-game $OMR**, not the float), dynasty naming, tiers,
landmarks, the leaderboards. It was always pure status with no sell and no cash-out, and it stays exactly
that. The `rwa:invest` / `rwa:dynasty` $OMR burns and the `dividend:` transfers are unchanged, so §10.4
is untouched on that side.

---

## Consequences worth stating

**The keys.** The founder ruled the Vig wallet and the stock-buy bot are separate keys. With no bot, the
fourth recipient becomes a **treasury Safe** — which should be the coldest key in the system and must
still be distinct from `vigRecipient`. The separation argument gets stronger, not weaker: a treasury that
only ever receives has no reason to share a key with anything that spends.

**The invariant that remains.** `runRwaInvariants` keeps only what is still meaningful: revenue is
recorded by source, and the bond slice that was booked matches what reached the bucket. There is no
`allocated ≤ held` because nothing is allocated — and that absence is the point, not a gap.

**Open question, flagged not decided.** The Portfolio uses real tickers (AAPL, TSLA, GLD, HOOD, NVDA,
SPCX, AMZN, GME) for a purely fictional collectible with a made-up price. That was defensible while a
real-stock rail existed behind it. With the rail gone, the honest options are (a) keep them as flavour,
or (b) move to fictional tickers, which removes any implication that a player owns something. Founder
call; not made here.

**What this does not change.** The withdrawal reserve, the Vig, the full-reserve queue, the Street Wage
endowment, the Window, POL — all untouched. The one real-value exit a player has is unaffected.
