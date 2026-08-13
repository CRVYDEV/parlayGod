# OMERTÀ — The Portfolio ("Going Legit"): RWA / blue-chip holdings

**Status: R1 (off-chain, no stock) — SPEC + BUILD. R2/R3 are RETIRED, not gated** — the founder
removed the stock layer on 2026-07-31 (`omerta-stock-layer-retirement.md`): the treasury holds ETH and
the game never acquires or owes a real share. **R1 below is current and unchanged**; every R2/R3 passage
is history. One open founder question the retirement raises: R1 uses real ticker symbols for a purely
fictional collectible, which was defensible while a real rail existed behind it — keep them as flavour,
or move to fictional tickers.

The narrative apex of the game's own laundering arc. Every mob story ends the same way: the
crook who goes legit — dirty street cash washed up the ladder into legitimate, untouchable, real
holdings (Corleone into Vegas real estate, Lansky quietly moving skim into blue chips). OMERTÀ
already built the entire on-ramp — laundering (cash → $OMR), the Business Empire ("going legit"
fronts), the Law/RICO (getting caught moving money is already a risk surface). **Real-world assets
(RWA stock — AAPL / TSLA / SPCX, the tickers Robinhood Chain natively settles) are simply the top
rung of that ladder.** Not a bolt-on: the missing capstone.

## The three models (why R1 is the earn-in-game / graduate-to-real model)

| Model | Player holds | Legal weight | Role |
|---|---|---|---|
| A — real tokenized equity | real AAPL tokens in-wallet | heaviest (a real stock *distribution*) | the R3 destination |
| B — synthetic price-tracker | a cashable number that tracks the stock | deceptively heavy (a *derivative*) | avoided |
| C — earn-in-game, graduate-to-real | in-game credits, later *extracted* to a real token | one gated boundary | **this build** |

Model C is the exact architecture already shipped for $OMR: earn freely off-chain (a game
mechanic, no stock); the *only* moment a real asset exists is a single, eligibility-gated, verified,
on-chain extraction (the voucher → reserve → claim rail already built + CI-tested). The full-reserve queue
(`signedOutstanding + amt ≤ funded_omr`) already guarantees **extraction ≤ reserve** — point that
same invariant at an RWA reserve and every credit is 1:1 backed. It is "the Vig, but the prize is
fractional AAPL instead of $OMR."

## Phasing (R1 carries the same risk profile as everything shipped this year — none)

- **R1 — buildable now, ZERO extraction surface (THIS DOC).** The in-game Portfolio: ticker-
  denominated credits bought by burning clean $OMR, tracked by a deterministic server-authoritative
  price (the §7.11 seed machinery). **Pure STATUS** — no sell, no cash-out — so shares touch no
  the applicable rules (the hitman-rep / family-seal precedent: a status axis *outside* §10.4
  and outside the sim-audited balance). Ships the whole fiction, the earning loop, the family book,
  the death-proof retirement fantasy, the leaderboard. Gathers data.
- **R2 — the real reserve, still no distribution.** A `RWA_BPS` slice of real ETH fee revenue funds
  a buy bot that acquires real fractional RWA into a reserve wallet; the in-game credits become
  *backed* (the full-reserve invariant). We *hold* assets; players do not yet extract. **Gated on
  the launch checklist.**
- **R3 — extraction: the one gated event.** The verified on-chain claim, through Robinhood's own
  broker-dealer rails (their verification, custody, reporting and issuance — *not* ours; OMERTÀ is a
  rewards program distributing THROUGH Robinhood, never an independent issuer). **Hard-gated on the
  Robinhood partnership + the third-party audit that already gates mainnet.**

**WHAT THE RWAs ACTUALLY ARE (founder clarification, 2026-07-19).** The tickers (AAPL / TSLA / SPCX /
HOOD / …) are **Robinhood's tokenized stocks — real ERC-20 tokens trading on Uniswap** (the `stocks`
category, on Arbitrum / Robinhood Chain), NOT abstract collectibles. This makes R2/R3 concrete:
- **R2's buy-bot swaps ETH → the actual stock-token on the Uniswap pool** and holds it in the reserve
  wallet; "backed 1:1" means the reserve literally holds the same token the in-game credit represents.
  The backing price is the **live Uniswap pool price (a TWAP)** — the same oracle the Vig buyback bot
  already reads for $OMR. (`RWA_BPS` of ETH revenue → this swap.)
- **R3's extraction delivers that real Uniswap-traded token to the player's own wallet** — a genuine
  stock transfer, hence the eligibility gate below.
- **The R1 in-game price stays the deterministic §7.11 hash (a PROXY), NOT the live Uniswap price** —
  deliberately. A display price that TRACKS a real security's live price weakens the "pure status,
  outside the applicable rules" posture that keeps R1 shippable everywhere; the hash proxy is the safer
  choice until R2 introduces the real oracle behind the identity verification boundary. (Open decision if the founder
  wants R1 to "feel real" — flagged, a founder call.)
- **Eligibility is a hard gate, not a nicety.** Robinhood's tokenized stocks are offered to EU
  customers and are **restricted by the issuer** (as of the knowledge cutoff — the launch review
  confirms current status). So R3 extraction must be **eligibility-gated**; an ineligible account
  can play + earn + hold the in-game status fully but can never cross the extraction boundary.
  R1 (status only) has no such restriction — it ships to everyone.

The three hard rules the whole design respects, so R3 stays inside the lines:
1. **Never distribute stock by chance.** Every RNG/loot/casino layer stays in cash/$OMR; RWA
   acquisition is a *purchase* or an *earned/vested/skill* payout only — never a spin-to-win.
2. Receiving stock has consequences for the recipient, so the eligibility gate is mandatory — the
   partner's own verification is what makes this plausible at all.
3. The gated surface is confined to that one extraction boundary (the $OMR model).

---

## R1 — what ships this build

### Fiction
The family accountant turns your clean money into legitimate blue-chip holdings — a book that
outlives your street. Buy in with laundered $OMR (you don't buy blue chips with street cash — you
buy them with clean money); the book is **legit, so it can't be looted, seized, or lost when your
character dies** (it survives to the heir, like prestige). RWA becomes the ultimate safe harbour —
the retirement account earned by surviving.

### Why it strengthens the core game (not just a finance bolt-on)
- **A deep $OMR sink.** Every prior burn was one-time or capped; a kitted veteran's $OMR pools into
  staking. The Portfolio is an *uncapped, permanent* $OMR burn — deflationary, and it *helps*
  extraction-≤-inflow (the Risk-to-Earn sustainability math) by construction.
- **A death-proof endgame store + a graceful exit.** Solves a flagged balance problem (endgame
  wealth has nowhere legit to go). Gives whales a reason to keep grinding (build the book) and a
  reason to eventually get out alive with a portfolio (retention + churn/exit lever).
- **Family politics.** The family book is a seize-resistant status flex — a war chest wars can't
  loot.

### Tickers & price (`PORTFOLIO` rules-tail block)
Three tickers, ticker-flavored to districts (fiction only): **AAPL** (old money — the tech district
washes here), **TSLA** (the docks & wheelmen), **SPCX** (the high-risk moonshot). Each has a `base`
(day-0 display floor) and a `drift` (± band). `tickerPriceOf(id, day)` = `base × (1 ± drift·hash)`
via `hash01('rwa:'+id+':'+day+':'+MARKET_SEED)` — deterministic per UTC day, server-authoritative,
unpredictable without the seed, verifiable after. **Display-only: the price moves no value** (no
sell in R1), so it never touches §10.4. All numbers are founder sign-off levers.

### State (account-level → survives death)
- `portfolios (account_id, ticker)` PK — `shares NUMERIC`, `cost_omr NUMERIC` (lifetime $OMR spent,
  the display cost basis). Keyed on **account_id, not character_id**, so it is *never in the
  runEstate wipe* — the heir inherits the book. That IS the retirement mechanic.
- `gang_portfolios (gang_id, ticker)` PK — the family book. Bought by the boss/underboss from the
  family $OMR **reserve** (the seal precedent). Dies with a dissolved family.

### Actions (`src/portfolio.js`)
- `GET /v1/portfolio` (`portfolioBoard`) — the market (all tickers: price, day-change %, blurb),
  your book (per-ticker shares/price/book value/cost basis + totals), and the family book if you're
  in a gang (holdings + reserve + whether you can invest).
- `POST /v1/portfolio/invest {ticker, omr}` (`invest`) — burn $OMR → `shares += omr/price` at
  today's price. A §10.4 $OMR **BURN** `rwa:invest` through the vanity `spendOmr` till.
- `POST /v1/gangs/portfolio/invest {ticker, omr}` (`familyInvest`) — boss/underboss burns from the
  family reserve (gang row locked, the `buySeal` pattern) → the family book. §10.4 burn `rwa:invest`
  (reserve bucket, character_id NULL + counterparty = gang, like `vanity:gang:seal`).

### §10.4 treatment
Shares are **not a currency** (a status collectible — the hitman-rep / seal precedent) → zero new
bucket, zero faucet, and the deterministic price moves no value. The **only** ledgered flow is the
`rwa:invest` $OMR burn:
- `rwa:` joins the `omr` KNOWN_REASONS vocabulary.
- `rwa:invest` joins `omrBurns` in `invariants.js`. Personal burns leave `account_persistent.omr`;
  family burns leave `gangs.omr_reserve` — both already inside `omrBuckets`, so `$OMR conservation`
  (`omrBuckets == 20000 + mints − burns`) stays exact with zero formula change beyond the new term.

### Surfaced
- Character `view` gains a `portfolio` summary (holdings + total book value).
- `GET /v1/gangs/:id` gains the family `portfolio`.
- `GET /v1/leaderboard/portfolio` — the biggest legit books (a status leaderboard, the hitmen-board
  precedent; book value computed in JS from the deterministic price).
- `runEstate` report `kept.portfolio` — the heir is shown the book that survived (the fantasy, made
  legible at the moment of death).

### Tests (`test/portfolio.js` — the 21st suite)
Price determinism + daily drift; invest burns $OMR exactly (spends == ledgered `rwa:invest` burns) +
share math; min/ticker gates; family reserve invest + rank gate + empty-reserve rejection; **death
survival** (heir keeps the book — a two-character kill scenario); the board + leaderboard; and the
`$OMR conservation` §10.4 check holding with `rwa:invest` as a burn. Full suite must stay green +
`node tools/sim.js` drift-0.

## R1 step two — EARNED exposure (BUILT)
Each keeps the "never by chance" rule (earned/vested/skill, never a chance draw for stock). Shared
helper `grantShares` — a $OMR-worth status grant, cost basis 0, no §10.4 (shares aren't a currency).
- **The big-score cut** (`heists.js`): a completed STANDARD crew heist parks `SCORE_CUT_PER_LVL × avg
  crew level` $OMR-worth of AAPL for every crewman — granted ON TOP of the audited cash pot (a status
  kickback; the sim-audited payout is untouched), account-level (survives death). A deterministic cut
  of a skill-influenced win, not a random draw.
- **The season prize** (`worker.js:runSeasonRollover`): the top `SEASON_PRIZES` grinders by respect
  (snapshotted before the reset) win SPCX — a skill-RANKED status grant (500/250/100 $OMR-worth).
- **The RICO graduation** (`invest`): a big legit move (≥ `SCRUTINY_MIN_OMR`) draws `SCRUTINY_HEAT`
  (the launder-heat precedent, feeds the Law meter) and is safehouse-blocked (P1.3); small buys are
  unwatched. Going legit in a big way is an exposed act — ties the Portfolio to the Law antagonist.

The console **"Going Legit"** tab (`public/index.html`) surfaces the whole layer.

## Still deferred (R1 step three / R2)
An automatic "Envelope" tithe skim on taxed flows; convoy-arrival / war-spoils cuts (trivial
`grantShares` extensions of the big-score hook). R2 (real RWA reserve backing) and R3 (verified on-chain
extraction) remain launch-gated.
