# NetNet Capital — competitive research and what OMERTÀ should (and should not) take from it

**Date:** 2026-08-21. **Requested by the founder:** "Research https://app.netnet.capital/#/manifesto
and see if we can make any improvements to our tokenomics / game design based on what they have done.
Search for all insights."

**Method.** The manifesto page itself is a client-rendered SPA (the fetchable shell carries only the
title "NetNet Shareholder Services"), so the substance was pulled from their full documentation at
docs.netnet.capital — all 20 pages were read: the fund mechanism, founding offering, fee schedule,
treasury/NAV, Real World Bonds, WinNET, CLIMB INC., Superstore (+ policy), COINflip, SPACEX INVADERS,
MSFT FLIGHT SIMULATOR, TURBO, the Lombard Credit Facility, the futures test desk, management
compensation, risk factors, and the founding shareholder guide. Every claim below about NetNet is
sourced from those pages. **Nothing in this document is a change to OMERTÀ** — per ground rule #1,
every candidate is a founder decision; the recommendations are ranked and each carries its §10.4 /
recorded-rule analysis.

---

## 1. What NetNet is

NetNet Capital Management issues **NET**, a reserve-backed token in the OlympusDAO v1 lineage
(token + rebasing staked token + treasury + bonds), rebuilt in modern Solidity, on **Robinhood
Chain — our chain**. It presents itself as a satirical 1990s corporation ("Shareholder Services",
software-box pack openings, a corporate-ladder game) and its actual differentiator is **zero
discretion**: emissions, buybacks, premium sales, bond pricing and fees are formulas in immutable
code, every operational entrypoint is permissionless, and the risk docs disclose their own
weaknesses (including a 1-of-1 admin key they admit is weaker than the standard they recommend).

The load-bearing numbers:

- **Floor invariant:** every NET is backed by ≥ 1 USDG of risk-free value at all times; no protocol
  operation may decrease NAV (two disclosed exceptions, both bounded).
- **Premium-gated emissions:** staking dividend rate = `R_MAX × clamp((P−1)/(K−1), 0, 1)` where
  `P = price/NAV`, `R_MAX` 0.45%/8h epoch, `K` 1.75. **Zero emission at or below NAV** — supply only
  prints when the market pays a premium, and a reserve cap clamps it so backing can never fall below
  the floor.
- **Two-sided standing quotes around NAV:** a permissionless buyback bid at NAV − 1.5% (all NET
  received is burned; 1% of liquid reserves per epoch), and a PremiumSeller that mints-and-sells
  small clips into the pool only above **2.0× NAV** — deliberately above the 1.75× emissions
  full-throttle point so the treasury never competes with its own emissions.
- **Fail-closed TWAP oracle** (30 min–4 h validity window; everything reverts outside it).
- **A stack of gambling "desks" in tokenized stock** (Superstore packs, COINflip, reverse-Plinko,
  crash game), each with **published odds ladders at a stated EV** (90% board return + 5% fee),
  drand distributed randomness verified on-chain, permissionless settlement, and manager-capital
  bankrolls that are contractually walled off from the treasury.
- **WinNET**, a prize-savings draw: principal preserved, prizes funded *exclusively* by the vault's
  own staking yield, 5% of each jackpot burned, and a **"Bonus Draw Balance"** system — weight, not
  money — granted by published formulaic schedules (streaks, check-ins, referrals, time-locks).
- **Management comp** = options struck at the 1 USDG floor (exercise pays *into* the treasury),
  capped at 15% of float, plus a trading-fee share that decays 4% → 0 over 30 days, forever.

## 2. Where OMERTÀ is already at or beyond parity

Worth stating first, because most of NetNet's engineering discipline is machinery this project
already has — often in a stronger form:

| NetNet | OMERTÀ equivalent | Verdict |
|---|---|---|
| Fail-closed TWAP, no fallback price | `OmrTwapOracle` fail-closed, `MAX_WINDOW_MULT` discard-not-average, vault/desk refuse on stale | Parity (ours also survives keeper outages spanning a move) |
| Per-epoch capacity caps everywhere (buyback 1%/epoch, bond epoch caps) | Daily caps on every rail (bond `dailyCapOMR`, the DAILY OFFERING, desk lot, VoucherClaim cap) | Parity |
| "Backing never decreases" invariants, checked on-chain | §10.4 + 31 invariant checks + the anti-Ponzi walls (`allocated ≤ held`, full-reserve queue, `committed ≤ capacity`) | Parity — ours is broader (it covers the whole game economy, not just the token) |
| Treasury/game-bankroll separation ("the house fund is never protocol funds") | Den book vs street tax vs reserve vs treasury, each its own checked bucket | Parity |
| Honest EV disclosure ("THE APY COLUMN IS ARITHMETIC, NOT A PROMISE") | The no-earnings-promise copy rules, BALANCE.md, the tokenhealth board | Parity internally — but see recommendation E: theirs is *public* |
| Gas sponsorship for email/passkey users | Guest auth — no wallet needed at all to play | Ours is better for onboarding |
| Sell-tax with mapped-pair fee logic + admitted v3/v4 bypass | v4 hook charging in ETH inside the swap, pool-gated | **Ours is structurally better** — their fee-on-transfer tax has an admitted permanent bypass (v4/UniswapX "not taxable at all, and never will be") and breaks router integrations; our hook is the fix for exactly that class |
| Streak / check-in / referral-drip retention grants | THE STREAK + milestones, daily check-in, §7.13 referrals + the spark | Parity |
| RWA sleeve honestly excluded from backing | Treasury `safeMustHold` attestation, comps book zero | Parity |

The genuinely different DNA: NetNet is a **fund with games attached** (the token IS the product;
everything prices off NAV), OMERTÀ is a **game with a token attached** (cash and $OMR deliberately
severed; the game never promises the token anything). That difference decides most of what follows.

## 3. Recommended — ranked, each a founder decision

### A. Time-lock tiers on staked $OMR (from WinNET's lock boosts) — the strongest fit

NetNet: a 7-draw lock = 1.5× draw weight, a 30-draw lock = 2×; early unlock forfeits the boost,
cancels streak credits, and pays 1% of principal into the prize pool.

Why it lands here: sim **P9.36** measured OMERTÀ's one open equilibrium question and found **hold
demand is CAPPED per player** — the MADE_LADDER rungs are absolute thresholds (60/180/450/900
staked), so a rational player stakes exactly to the rung they want and not one $OMR more, while the
sinks are recurring. A **time**-commitment axis is the missing second dimension: locking staked $OMR
for 7/30/90 days could multiply the CITY LEG activity weight (or grant a ladder-rung discount),
with an early-unlock penalty. It deepens float commitment — the thing THE FLOAT drop exists for —
with **zero new emission** (a weight multiplier on an existing pool-bounded redistribution, and the
city leg's linearity/Sybil-neutrality survives: multiplying a linear weight by a per-account lock
factor stays split-neutral, since a farm can lock N accounts as easily as one but gains nothing by
splitting). One interaction to design deliberately: a locked stake must still be LOOTABLE at the
committed rate (`OMR_LOOT_COMMITTED`), or the lock becomes the safe harbour v3 step 5 deliberately
retired. §10.4: a lock flag + weight — no ledger surface; the penalty (if adopted) is a transfer
into the city pool.

### B. $OMR-collateralized loans (from the Lombard Credit Facility) — float utility without a sale

NetNet lets holders borrow stablecoin against staked NET, with three ideas worth copying:
collateral is valued at `clamp(TWAP × 0.90, NAV, 5×NAV)` so **credit expands near backing and
mutes in melt-ups** (their "euphoria governor"); **collateral is never re-lent** and keeps earning
dividends while posted; and the leverage loop's fees structurally finance the dividend program.

OMERTÀ's P2P loan rail already takes CARS as collateral (`loans.collateral_min`, the pledge lock,
seizure on default). Extending the same audited machinery to **staked $OMR as pledgeable
collateral** gives the token a use that requires HOLDING it — a hold-demand vector P9.36 says the
economy lacks — and deepens the trust-pricing market the loans sign-off framed. The severance
survives: the pledge is an ownership lock, seizure on default is a $OMR **transfer** to the lender
(the car-seizure precedent — never a conversion), and the staked collateral keeps its city-leg
weight while posted (their "never re-lent" insight). §10.4: a lock flag + on-default a transfer;
no new faucet. Design note: the pledged stake must stay loot-exposed at the committed rate and the
lender inherits a normal $OMR balance, not a protected one.

### C. A progressive jackpot in the Den (from CLIMB's reseeding pot) — cash-only

CLIMB's jackpot takes no fee, seeds from forfeits, pays **50% to the winner and reseeds 50%** — a
pot that never empties and grows visibly, which is the strongest anticipation mechanic in their
whole stack. OMERTÀ has many one-shot pools (tournament, GP, futurity) but **no persistent
progressive pot anywhere**. A den progressive — fed by a small slice of the existing PvE edge
(inside the audited `den profit` book, never minted on top), displayed on the Den tab and the
events strip, hit by a long-odds side condition on existing games (e.g. a numbers exact-match
bonus), paying 50% and reseeding 50% — is a pure redistribution of already-collected edge.
**CASH ONLY** (the Den's hard line holds), one new escrow-style identity check (the boxing-bet
escrow twin), and the TONIGHT IN THE CITY strip gets a permanently ticking number.

### D. Consolation prizes from the same seed (WinNET) — near-miss retention at zero pool cost

From the same revealed seed, WinNET draws five extra names who each get bonus **draw weight** —
"weight, not money," expiring after 14 draws, inert without a real deposit. This is a
Sybil-resistant near-miss mechanic that costs the prize pool nothing. OMERTÀ's existing lotteries
(the numbers, the weekly fight, the futurity, the tournament) pay winners and tell everyone else
nothing. A consolation tier paying **status or next-draw weight** (never cash/$OMR) to N
non-winners drawn from the same already-audited seed is a cheap retention add with zero §10.4
surface. Their expiry rule (unused weight lapses) and the "inert without a real stake" rule are
both worth keeping verbatim.

### E. A public risk-factors page — their best non-mechanical idea

NetNet's `/risks` page is genuinely good: it discloses thin liquidity as a choice, admits the
1-of-1 key is weaker than the 2-of-3 they recommend, states "if the market pays no premium, the
dividend pays nothing indefinitely," and ends with "the complete list is unwriteable." For a
real-money game, this register *builds* trust rather than spending it — and it is exactly the
posture OMERTÀ's copy rules already mandate internally (no promises, honest terms). OMERTÀ's
player-facing surfaces state individual terms well (the pad, the nut, the extraction-not-open
guard) but there is **no single honest risk page**: thin launch liquidity, the 9% sell tax, the
48h surcharge, the full-reserve queue meaning withdrawals can QUEUE, "$OMR is never earned by
grinding," death is real, the Safe as root of trust. One codex page + a docs.js-style guard that
its claims track the live levers (the F6 pad-copy precedent). Cheap, high-trust, and it
strengthens the legal posture rather than risking it.

### F. Seed-commitment publication for the §7.11 draws — provable fairness on the cheap

NetNet's entire fairness story is drand: the randomness doesn't exist at bet time, anyone can
verify it, settlement is permissionless, and a withheld beacon rolls the pool over intact. OMERTÀ
is server-authoritative by design (rng_audit is the right architecture for a game), but the
deterministic §7.11 surfaces (the numbers draw, the fight card, the track, season mods, prime
time) are only "verifiable after" *if the seed is shared*. Publishing a **daily commitment**
(e.g. `hash(MARKET_SEED + day)` posted in advance, seed slice revealed after the draw) makes
"the house couldn't have rigged tonight's numbers" a checkable claim instead of an assertion —
material credibility for a game with real-money extraction, at near-zero cost. For the FUTURE
on-chain products, adopt their liveness patterns wholesale: **permissionless settlement with a
small reveal bounty** (their 20 bps), **bettor-exclusive void** on outage, **no fallback seed**.
Our keeper-driven rails already alarm on silence; a permissionless path beside the keeper removes
the liveness dependency entirely.

### G. A published "backing ratio" gauge — operator-facing first

NetNet's NAV is their headline number. OMERTÀ deliberately has no NAV (the token is not a fund
share), but the *shape* — one number that says "every withdrawable token is backed, and by how
much" — is worth surfacing: `reserve funded_omr ÷ (signed outstanding + queued)` already exists in
the vig invariants and the tokenhealth board reads the queue. Recommendation: promote a single
**backing/queue gauge** on /admin (done in spirit; make it the headline) and DECIDE deliberately
whether any of it goes public. Caution: publishing a NAV-like figure on a game token can read as
investment framing — NetNet can do it because they *are* a fund; for OMERTÀ this is a
copy-rules/counsel question, so operator-facing by default.

### H. Countercyclical formulaic dials — an option, not a recommendation

NetNet's PremiumSeller (mint-and-sell only above 2× NAV, clip-sized, TWAP-bounded) and their
credit clamp are both **countercyclical formulas where OMERTÀ has GM hand-set dials** (THE DAILY
OFFERING, desk lot sizing). The desk already has half of this (the band, the reserve, the Dutch
clock); a formulaic "sell more into genuine euphoria" upper leg (lot size scaling above the band
ceiling) would complete the symmetry. OMERTÀ chose human-in-the-loop deliberately (the DAILY
OFFERING is the GM's throttle on the only mint), so this is a philosophy fork, not a gap: their
ordering insight — **the treasury's sell threshold must sit above any emission throttle so the
protocol never competes with itself** — is worth keeping in mind if OMERTÀ ever adds a
price-responsive emission anywhere.

## 4. Rejected — with the recorded rule each one breaks

These are NetNet's most distinctive mechanics, and each collides with a decision this project has
already made and recorded. Listed so they are not re-litigated by accident:

> **AMENDED 2026-08-21 (founder-directed, same day as this doc): items #2 and #3's blocking rules
> were RETIRED** — the Den's "cash only, never $OMR" line and the game-wide never-by-chance rule
> (see SIGN-OFF.md § THE 2026-08-21 RETIREMENTS). A $OMR-denominated den product and randomized
> paid products are now designable. What survives is fact, not rule: the EU/UK loot-box exposure
> and the launch checklist's counsel rows on chance-distributed real assets are external, so any such
> build publishes its odds and clears counsel. Items #1 and #4–#7 stand as written.

1. **Premium-gated rebasing emissions (the core OHM mechanism).** Supply printed against market
   premium is the "discredited half" of OlympusDAO that OMERTÀ's bond design explicitly kept out
   (the reserve bond took POL acquisition WITHOUT the reflexive mint). NetNet's version is more
   honest than 2021 OHM (RFV-capped, floor-backed, zero below NAV) — but OMERTÀ retired its last
   scheduled faucet (the Street Wage) to make "no faucet" a checkable wall, and v3's thesis is
   revenue-via-recycling, not yield-via-premium. Re-introducing ANY premium-triggered mint reverses
   wall 1. Their reserve-cap discipline is the one part worth remembering if a backed emission is
   ever revisited.
2. **Gambling desks denominated in tokenized stock / RWA prizes by chance** (Superstore, COINflip,
   SPACEX INVADERS, FLIGHT SIMULATOR). Directly violates two standing OMERTÀ rules: the Den's hard
   line (**cash only, never $OMR** — a fortiori never a real asset) and **never distribute the
   real asset by chance** (the R3/stock-machine rule: sell deterministic, drop random). NetNet
   leans into being a casino on real equities; OMERTÀ's entire securities posture is built on NOT
   being that. Their *disclosure* discipline (published ladders, stated EV, bidirectional
   basis-point tests) is the adoptable part and OMERTÀ's den already meets it internally.
3. **A chance-based allocation of the city-leg / any wage-like payout** (the WinNET shape applied
   to our pool). Forbidden verbatim by the standing sensitive note: the wage "must NEVER become
   discretionary or chance-based." The consolation-weight idea (D) survives because it moves
   status/odds, never money.
4. **An on-chain standing buyback floor ("the fund is the buyer below NAV").** A permanent public
   bid at a stated price is a value commitment — strong for a fund, wrong for a game token whose
   copy rules forbid price promises. OMERTÀ's analogs (the in-game Window, the desk's band buyback
   budgeted by POL fees) are budget-bounded and deliberately promise nothing.
5. **The 15% perpetual anti-dilution team option.** Elegant construction (struck at the floor,
   paid into the treasury) — and their own risk page calls it "persistent, recurring NAV drag."
   OMERTÀ has no team token allocation at all; founder revenue is declared fee splits through the
   money router. Adopting any team option would be a step backward for our posture. Same for the
   decaying fee share — our splits are already declared and fixed.
6. **TURBO knock-out notes / leveraged products.** No randomness, pure leverage on tokenized
   equities. Out of scope and out of theme; it would also put a derivative inside the boundary the
   stock-layer retirement was written to keep clean.
7. **Total immutability as the product** ("the only way to change policy is deploy a different
   fund"). OMERTÀ is a server-authoritative live game; its recorded posture is Safe-as-root-of-trust
   with published levers and sign-off discipline. Their model is credible for a fund and unworkable
   for a game that ships content weekly. No change — but their *narrowness* principle (the one
   permissioned surface is add-only) matches disciplines OMERTÀ already applies (append-only pins,
   allowlists-not-denylists).

## 5. Smaller observations worth having on file

- **"Weight, not money"** is a good general vocabulary for Sybil-safe rewards: bounded, expiring,
  inert-without-a-real-stake multipliers. OMERTÀ's status axes follow the same logic; the phrase is
  a useful test for any future reward ("is this weight, or is it money?").
- **The jackpot burn** (5% of every WinNET prize burned) — in OMERTÀ's economy a "burn" recycles to
  the desk, so the analog of "every prize event also shrinks/recycles supply" already exists
  structurally; nothing to do.
- **Their fee-bypass admission** is a quiet endorsement of our v4-hook migration: they concede
  fee-on-transfer cannot tax v4/UniswapX "and never will," and lean on owned depth as the real
  defense — the exact reflexivity problem our hook design §1 named and fixed.
- **Their 1-of-1 admin key disclosure** is a reminder for CHAIN-DEPLOY: our runbooks assume a Safe;
  the honest-disclosure move if launch ships with fewer signers than recommended is to say so, as
  they did.
- **Escrowed-position games** (CLIMB: resignation returns 80%, termination forfeits to the pot,
  "total loss is an ordinary outcome" stated up front) — OMERTÀ already builds games this way
  (heist stakes, GP escrow, the contest forfeit share); parity, but their up-front phrasing of the
  expected outcome is the disclosure register recommendation E should borrow.
- **The futures desk's loss waterfall** (trader margin → vault equity → clearing reserve →
  auto-deleverage, "the Treasury is never in the waterfall") is a clean template if OMERTÀ ever
  builds a player-underwritten product — file beside the loan-house deferral.

## 6. Suggested order, if the founder wants builds

1. **E (risk page)** — cheapest, pure copy + a guard, strengthens posture before launch.
2. **A (lock tiers)** — answers a measured open question (P9.36); design one page, sim the weight
   effect, sign the levers.
3. **D (consolation weight)** — small, zero §10.4, rides existing seeds.
4. **C (progressive den jackpot)** — one escrow check + a visible number on the events strip.
5. **B ($OMR-collateral loans)** — the deepest build; rides the audited loan rail.
6. **F (seed commitments / permissionless settlement patterns)** — F's in-game half is cheap; the
   on-chain half folds into the mainnet milestone.
7. **G/H** — decide, don't default.

None of these move a signed lever; every one that touches money names its §10.4 shape above and
would follow the standard pipeline (design note → build → mutation-verified tests → BALANCE.md
levers → founder sign-off).
