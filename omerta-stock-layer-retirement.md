# Retiring the stock layer — the vault is backed with ETH

**Founder-directed 2026-07-31.** Supersedes `omerta-rwa-float-design.md` (R2/R3) and the R2/R3 half of
`omerta-rwa-portfolio-design.md`. R1 — the in-game Portfolio — is **unchanged and stays**.

---

## The decision

> "Instead of buying back RWA stock the treasury can hold ETH instead." → **the stock layer goes away.**
> …then, the same day: **"keep the vault and back it with ETH."**

The game will not acquire, hold, allocate or deliver real tokenized equities. The ETH slices that were
earmarked to buy stock accumulate in the treasury as ETH — and **the vault stays**, re-denominated so
that a player burns earned $OMR to claim allocation of that ETH rather than of stock.

## Why this is the right shape (and why the alternatives were not)

The wall that made the float safe was **`allocated ≤ held`** — the game only ever owes stock it already
owns. That worked because both sides of the ledger were the same asset: the vault owed *units*, the
reserve held *units*.

So "the treasury holds ETH" is only coherent if the vault stops owing stock. The three readings were:

| | what it means | verdict |
|---|---|---|
| **A** | drop the stock layer entirely; treasury accumulates ETH; **no vault** | first cut, then amended |
| **A′** | drop the stock layer; **keep the vault, denominated in ETH** | **chosen** (founder, same day) |
| **B** | keep the vault owing STOCK, hold ETH to cover it | rejected — see below |
| **C** | hold ETH, buy stock just-in-time at redemption | rejected — same break as B |

**B and C were rejected on substance, not preference.** Handing someone a stock token you own is a
transfer of an asset you hold. Paying out the *value* of a stock you do not hold is a cash-settled
contract for difference — a derivative, and a materially worse legal posture than the thing it replaces.
Both also break the wall mechanically: if the stock runs and ETH does not, the treasury is short exactly
when players claim.

**A′ — the founder's amendment: "keep the vault and back it with ETH."** The first cut removed the vault
along with the stock, on the reasoning that "the treasury holds ETH" is only coherent if nothing owes
stock. That reasoning is correct and A′ satisfies it — because what the vault owes changes with what
backs it. **The vault stays; both sides of the ledger become ETH.**

This is not a weaker version of A. It is a *stronger* version of the original float, because
`allocated ≤ held` never depended on the asset being stock — it depended on the asset being **the same
on both sides**. ETH-for-ETH restores that property exactly and removes the only thing that could ever
have broken it: a second asset whose price could move. Nothing acquires stock, nothing owes stock, and
the securities surface is gone just as completely as under A.

**What A buys.** It deletes the only securities event in the project. No buy bot, no per-ticker reserve,
no stock oracle, no KYC gate, no geofencing, and R2/R3 stop being carried milestones. It also resolves a
question that existed *before* any player was involved: Robinhood's tokenized stocks are EU-facing and
not for US persons, so a US-controlled treasury holding them was its own problem.

**What A costs, honestly.** "The mob goes legit and retires into blue chips" loses its real-world anchor.
ETH is not going legit — it is the same crypto risk in a different ticker. That narrative cost is real
and is accepted deliberately.

**What A′ does not cost.** Nothing was ever delivered to a player, and nothing is now: the vault
**allocates**, it does not pay out. There is no transfer, no withdrawal and no on-chain path — delivery
is a separate decision with its own legal question and is deliberately unbuilt (R3 was the same shape).
What the ETH re-denomination removes is the thing that made delivery *hard*: handing someone ETH the
treasury holds is a transfer of an asset you own, not a securities event.

---

## The cut: remove the promise, keep the accounting

The surgical line is **anything that creates an obligation goes; anything that records an inflow stays.**

### Removed

| what | why |
|---|---|
| `runRwaBuyback` + `POST /v1/mod/rwa/buy` | the buy bot's seat — **nothing needs buying now**: the backing asset (ETH) arrives directly from the four revenue slices |
| `rwa_reserve`, `rwa_buys` tables | the per-ticker stock holding and its purchase history; both existed only to serve the bot |
| the per-ticker stock oracle, `RWA_MAX_PRICE_JUMP`, the cross-ticker budget lock | all of them guarded the bot's price input. With no bot and no second asset, the only price on the path is the OMR/ETH oracle the Vig already publishes |
| `runRwaInvariants`' bot checks (`held == Σ buys`, cost basis) | nothing is bought; `held` **is** the revenue ledger |
| any acquisition, holding or delivery of real equities | the securities surface, entirely |

### Kept, repointed

| what | now means |
|---|---|
| `claimVaulted` + `GET`/`POST /v1/vault*` + the console card | **the vault, denominated in ETH.** Burn earned $OMR, claim allocation out of what the treasury holds. Every gate is unchanged: minted-only, jailed, the rolling-24h per-account cap, and the RICO graduation on the shared `rwa_used` window with its heat and safehouse block. |
| `allocated ≤ held` | **the anti-Ponzi wall, in its strongest form** — ETH on both sides, so no price movement can put the treasury short. The `rwa_vault` table becomes `eth_vault (account_id PK, eth, cost_omr)`; account-level, so it still survives death. |
| `TREASURY.CLAIM_MIN_OMR` / `CLAIM_DAILY_OMR` / `CLAIM_WINDOW_MS` | the claim levers, unchanged — they meter **$OMR**, not the backing asset, so the re-denomination did not touch them. |
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

**The invariant.** `runTreasuryInvariants` keeps `allocated ≤ held` — now in ETH on both sides, which
is the whole argument for A′ in one line — plus the sell-tax episode reconciliation. The bot checks
(`held == Σ buys`, cost basis) are gone because nothing is bought: `held` is the revenue ledger itself.

**What is deliberately NOT built.** Delivery. The vault is an allocation ledger; no ETH leaves the
treasury through it and there is no route that makes it. Building one is its own decision — and unlike
the stock version, it is a decision about transferring an asset the treasury actually owns.

**Open question, flagged not decided.** The Portfolio uses real tickers (AAPL, TSLA, GLD, HOOD, NVDA,
SPCX, AMZN, GME) for a purely fictional collectible with a made-up price. That was defensible while a
real-stock rail existed behind it. With the rail gone, the honest options are (a) keep them as flavour,
or (b) move to fictional tickers, which removes any implication that a player owns something. Founder
call; not made here.

**What this does not change.** The withdrawal reserve, the Vig, the full-reserve queue, the Street Wage
endowment, the Window, POL — all untouched. The one real-value exit a player has is unaffected.
