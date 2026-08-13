# THE BROKERS — treasury-funded RWA rewards to NFT holders

Founder-directed 2026-08-10. Funding source: **the treasury slice** (founder decision). Denomination:
**tokenized stocks, in the Stonkbrokers pattern** (founder decision, made after the alternatives and
their costs were laid out).

Supersedes nothing. It *reverses* part of `omerta-stock-layer-retirement.md` (2026-07-31), which is a
founder call and is recorded as such in §6.

---

## 1. The reference, accurately

StonkBrokers is a 4,444-item collection on Robinhood Chain — our chain — and the mechanism the
founder is pointing at is specific enough to copy properly rather than approximate:

- Each NFT is an **ERC-6551 token-bound account**: the NFT literally owns a wallet, seeded with
  tokenized stock (TSLA, AMZN) at mint.
- **Protocol fee income is converted into tokenized stock and dropped to those bound accounts.**
  Funding is cited as 70% of Anvil AMM transaction fees, triggered by a user "Clock In" action.
- Rewards are **not automatic for holders**. You must spend STONKBROKER tokens to *activate* the NFT
  into the distribution set. Five tiers, 66,666 → 1,666,666 tokens, weights 1× → ~3.33×.

Three things in that are worth taking, and one is worth *not* taking.

**Take:** the bound account (the reward has somewhere to live that travels with the NFT), the
activation burn (holding is not enough — you must commit to be paid, which is a token sink), and
fee-income-as-funding rather than a promise from treasury reserves.

**Do not take: activation weighting alone is WEALTH-weighted.** Their weight is a pure function of
how many tokens you burn, so the largest holder is by construction the largest earner, and the
mechanism rewards capital rather than participation. We already have the fix for that, built and
merged this week.

---

## 2. What we already have, and how well it fits

This is unusually well-matched to existing machinery. Almost nothing here is new invention:

| Stonkbrokers piece | Ours | Status |
|---|---|---|
| ERC-6551 bound account | The Dynasty NFT's token-bound account | **Designed, not built** (`omerta-identity-nft-design.md`) |
| Activation burn in the project token | A `$OMR` burn through the `spendOmr` till | Machinery exists; the sink is new |
| "Clock In" trigger | **`ACTIVITY`** — the metric merged in #29 | **Built** |
| Fee income as funding | The **treasury slice** — 10% of gameplay fees, 25% of bonds, 20% of Store, 4% of the sell tax, accruing in `rwa_revenue` | **Built** |
| `allocated ≤ held` | `runTreasuryInvariants` | **Built** — ETH arm *and* per-ticker units (step 2, done) |

**The ACTIVITY fit is the important one.** Their "Clock In" is a button; ours is a measured,
Sybil-resistant, fail-closed score over throttled actions with a breadth gate and agent exclusion.
Using it as the second weighting term turns a wealth-weighted airdrop into a **play-weighted** one,
which is both a better game and a materially better posture on every other axis.

---

## 3. The architecture

```
treasury ETH (rwa_revenue)  ──▶  the buy keeper  ──▶  per-ticker reserve  ──▶  epoch allocation
   4 existing slices              (TWAP-bounded,          (allocated ≤ held,        │
   no promise attached)            fail-closed)            per ticker)              ▼
                                                                        the NFT's bound account
                                                                                    ▲
                                          weight = activationTier × activityScore ──┘
```

**Epochs, not streams.** Allocation runs once per epoch (weekly) over a snapshot, because a
continuously-streamed balance is far harder to reason about, to audit, and to stop. An epoch that has
not run yet can be cancelled; a stream cannot.

### 3.1 The weight, which is the whole design

```
weight(nft) = activationMult(tier) × activityScore(owner, epoch)
```

- `activationMult` — the Stonkbrokers half. A tiered `$OMR` burn, weights 1× → ~3×. **A sink**, which
  the late-game economy wants anyway.
- `activityScore` — the half they do not have. Linear in effort, capped per account only by the
  breadth **gate** (never a cap — a cap is Sybil-*positive*, see the #29 reasoning), agents and NPC
  residents excluded at source.
- **A zero on either term is a zero.** An unactivated NFT earns nothing; an activated NFT owned by
  somebody who did not play earns nothing. That second one is the sentence that makes this a game
  mechanic rather than a yield product, and it should not be softened later.

### 3.2 The walls

1. **`allocated ≤ held`, PER TICKER, in units.** The game may only ever owe stock it already holds.
   This is the wall the retirement removed by holding ETH; buying stock again brings it back, and it
   must be re-denominated in units per ticker — a cash-value version silently permits owing more
   units than exist when a price moves.
2. **Never by chance.** Both weight terms are deterministic. No RNG anywhere in acquisition,
   allocation, or delivery. This is a standing project rule and it is what keeps the mechanism out of
   loot-box territory entirely.
3. **The keeper is fail-closed and TWAP-bounded** — the `OmrTwapOracle` / bond-dial discipline: a
   stale or absent price halts buying rather than defaulting to a number, and a per-buy price
   continuity bound (a generous multiple of the last print) makes a fat-finger or a leaked key unable
   to buy at an absurd rate. Anything else is a free option on the treasury.
4. **The treasury cannot be spent past what arrived.** `ethToSpend ≤ received − alreadySpent`, the
   `runVigBuyback` root cap, applied to the treasury ledger.
5. **Comps book zero.** A mod/QA path may exercise the mechanism but must record no revenue and no
   holdings — the anti-fabrication gate that already guards the Vig, the Store, bonds and the desk.
   Fabricated backing is invisible to precisely the check that is supposed to catch it.

### 3.3 DECIDED — stock lands in the bound account, and there is no claim gate

**Founder decision, 2026-08-10, taken after the alternatives and their costs were put in front of
them twice.** Stock accrues STRAIGHT into the NFT's ERC-6551 account, Stonkbrokers-style, and there
is no gate at delivery.

The case for it is real and was not a close call on product grounds: it is the proven model, the NFT
visibly *contains* value, delivery is atomic and trustless with no claim process, nothing sits
unclaimed in a protocol contract, and the NFT sells self-contained.

**What was argued against it and rejected — recorded so the tradeoff is not rediscovered later as a
surprise:**

1. **The NFT becomes a bearer instrument for securities.** Any marketplace buyer acquires the stock
   with no KYC, no geofence and no jurisdiction check. Against the one hard operational fact here —
   Robinhood's tokenized stocks are EU-facing and not offered to US persons — this routes them to US
   persons by default, with no off switch.
2. **It is the irreversible direction.** Claim-then-deliver could always have become bearer later;
   bearer cannot become gated, because once stock is in freely-trading TBAs it is gone. That
   asymmetry was the recommendation's whole basis.
3. **It contradicts our own entitlement wall.** `omerta-identity-nft-design.md` states *"the token is
   a tradeable trophy; the game entitlement is account-bound and never read off a balance."* That rule
   does not survive this decision, and that doc should be amended rather than left contradicting
   reality.
4. **The floor becomes a function of contents rather than utility** — the cheap end of the order book
   becomes drained NFTs and contents-vs-floor arbitrage, the same dynamic the identity-NFT design
   already flagged for the entitlement.

**The consequence that changes what gets built, and the reason it is written here rather than only in
a commit message:** with no claim gate, **`allocated <= held` is the only wall left** between the
treasury and a bad delivery. It stops being one check among several and becomes load-bearing, so it is
built FIRST, in per-ticker UNITS (a cash-value version silently permits owing more units than exist
the moment a price moves), and watched nightly by `alertDrift` rather than merely asserted in a test.

---

## 4. What this does NOT touch

The founder's funding decision keeps every existing wall intact, and that is worth stating plainly:

- **Withdrawals are unaffected.** The Vig still funds the reserve; `extraction ≤ inflow` holds exactly
  as before. This was the alternative that would have broken it, and it was not chosen.
- **§10.4 is unaffected.** Treasury ETH and tokenized stock are out-of-band real value; they write no
  `transactions` rows, exactly like `fees.js`. The activation burn IS in-game and rides the existing
  `$OMR` sink vocabulary.
- **No new emission.** Nothing here mints `$OMR`; the activation tier only burns it.

---

## 5. Order of work

1. **The gate, before code.** §6.
2. ~~Re-denominate `runTreasuryInvariants` to per-ticker units and restore the `allocated ≤ held`
   wall.~~ **DONE.**
3. ~~The activation tiers + burn (in-game, shippable independently, a pure `$OMR` sink).~~ **DONE.**
4. ~~The epoch allocator, computing weights off `ACTIVITY` — off-chain, dormant, no delivery.~~
   **DONE.**
5. ~~The buy keeper — chain-dormant behind the standing gates.~~ **DONE** (`runStockBuyback`,
   `POST /v1/mod/treasury/keeper`). It reads `stockBudget()` for its root cap (wall 4) and writes
   through `recordStockBuy`, so wall 5 (comps book zero) and idempotency are inherited rather than
   reimplemented. **Wall 3 was its job and deliberately not step 2's:** `recordStockBuy` ingests a
   fill that already happened on-chain, and refusing to record a real fill would make the books
   disagree with the chain rather than prevent anything (the `recordBond` lesson).
   **The multiple is now sized** — `npm run keeper-dials`, recorded in BALANCE.md § THE KEEPER'S
   WALLS: **2× the last real print, 0.2× floor, halt past a 30d-old print, refuse a first buy.** The
   sizing produced a finding worth carrying into step 7: the multiple does NOT bound the damage
   (wall 4 does), and buying few units for much ETH leaves `allocated ≤ held` perfectly true — so
   this is a wall precisely because no check can see it. The first cut scaled the bound with the gap
   and had to be discarded: it reaches 26× at a quarter, and a bound that widens with staleness is
   not fail-closed.
6. The Dynasty NFT + ERC-6551 bound accounts. **The OFF-CHAIN half is DONE** — `src/portrait.js`,
   `test/portrait.js`, `GET /v1/identity/:characterId/portrait.svg` and the ERC-721-shaped metadata
   at `GET /v1/identity/:characterId`, pointing at no token. That is `omerta-identity-nft-design.md`
   §5's phase 1 + phase 2, which that doc sequences first *because they carry no gate at all* and
   because the portrait is the thing the token would point at, so the ordering costs nothing.
   **The CONTRACT half is correctly still waiting**, on two independent gates: an OPEN
   launch-checklist row (the dynasty design's §7.2 makes the contract conditional on two of them; one
   is cleared, the other re-opened when the published tranche schedule changed what it covers), and the
   third-party audit batch — which the dynasty design says to **batch, not dribble**, so writing
   `DynastyNFT` now would start that clock for one contract instead of the set.
   The build corrected three of the design's own slots; the reasons are recorded in the identity
   doc's §3 banner, and one of them was a defect that doc had already flagged and nobody had acted
   on: the frame slot cited **`dynastyTierOf`, which no longer exists** (retired with the Portfolio at
   D11). The suite now asserts it is gone, so the frame cannot be re-sourced back to a dead symbol.
7. Delivery. **Last**, and only after 1.

Steps 2–5 are done, and step 6's off-chain half with them. What remains is step 6's CONTRACT (gated
on that open row and on assembling the audit batch) and delivery (step 7) — and step 7 is the one
gated on the launch checklist, which is why the order was arranged this way: everything above it moves real ETH
into real holdings without a single share changing hands or being promised to anybody. The portrait
is the clearest case for that ordering: it is the whole player-visible half of the flagship asset,
and it shipped without touching a gate.

### 5.1 What step 2 actually built, and the one thing it found

The wall is back in `src/treasury.js`, in two arms, both inside `runTreasuryInvariants` — which was
*already* wired into the worker's nightly `alertDrift`, so the new checks inherited the alarm the
moment they existed rather than needing their own.

- **`allocated ≤ held (<TICKER>, units)`, one check per ticker.** Not a summed one: stocks are not
  fungible and a delivery is made in a *specific* ticker, so a summed check would let the treasury owe
  TSLA it does not hold as long as it held enough AMZN.
- **`allocateStock` is the only writer of the owed side, and it clamps.** The invariant is the
  *detector*; the clamp is the *prevention*, and with §3.3's no-gate delivery a detector that fires
  the next night is too late — the units are already in a freely-trading bound account. The clamp
  reads-then-writes, so it is only as good as its serialization: verified against **real Postgres**
  by racing two allocations of 8 against a reserve of 10 — they came back **8 + 2**, not 8 + 8. The
  suite cannot show that (pg-mem is single-caller, so it exercises the arithmetic and Postgres
  exercises the lock), which is the same split the ETH pool lock already lives under.
- **A comp books ZERO units.** The `txHash` gate matters more here than anywhere else it appears:
  everywhere else a comp merely fails to credit revenue, but here the fabricated quantity *is the
  wall's input*, so a QA fill that booked units would raise the delivery ceiling with no asset behind
  it — invisible to precisely the check meant to catch it.

**The thing it found, which was not in the plan.** `rwa_revenue` is an *inflow* ledger: it records
what arrived and nothing about what leaves. So the moment the keeper converts treasury ETH into
stock, the Safe holds less ETH and **no existing number moves**. The ETH vault would have gone on
quoting availability out of ETH that was already spent, allocating it to players, with
`allocated ≤ held` reading green throughout. The ETH arm is therefore
`allocated + spent ≤ held (ETH)` — the spend term inside the comparison, not beside it — and
`stockBudget()` exposes the same figure as the keeper's root cap, so ETH already promised to a
player's vault line is not the keeper's to spend. Reopening the stock layer would have quietly
weakened the wall the retirement was written to strengthen.

**Two things the existing guards caught, both worth recording.** The first cut *replaced* the ETH
check with the spend-aware one, and two suites that look it up by name went red. Renaming them would
have been the cheap fix; emitting **both** is the better one, because the two ways the ETH arm can
break have different owners — `allocated ≤ held` breaching is a claim-path bug in the vault, while
`allocated + spent ≤ held` breaching *while the first holds* is an overspending keeper. One check
catches both and tells whoever is woken by the alarm nothing about which they are looking at.

The second was a `test/tokenomics.js` assertion reading `holds === 'eth'` with the words *"it does
not buy stock"* — a statement of fact from the retirement that this design reverses. A test pinning a
reversed decision protects nothing, so the fact was updated rather than defended; what was kept is
the part that still holds and still matters, which is that **the player-facing vault rail stays
denominated in ETH alone**. The treasury holding stock for this distribution never puts a player's
claim into an asset the game would have to cash-settle — that separation was the retirement's central
point and it survives intact.

---

## 6. What this reverses, and what the gate is for

The founder cleared this to be built (this session, and the standing directive in `CLAUDE.md`). This
section exists because the next reader needs the facts in one place.

**What is being reversed.** `omerta-stock-layer-retirement.md` retired stock acquisition on
2026-07-31 with recorded reasons: it deleted the project's one gated surface, removed the KYC and
geofencing requirements, and stopped R2/R3 being carried milestones. This design reopens that.

**What a precedent does and does not establish.** StonkBrokers is doing this, visibly, at scale, on
the same chain. That is real evidence about what infrastructure exists and how it is received. **It
is not a clearance, and "they did it first" has never been a defence.** Worth saying plainly once so
nobody mistakes a citation for a green light.

**Three concrete facts that do not go away:**

1. **Buying an asset and distributing it to token holders on the strength of holding the token is the
   hardest version of this to defend.** A launch-checklist row already covers revenue distribution to
   holders as the sharpest surface in the project. Weighting by *play* rather than by holdings
   genuinely helps — effort is not passive — and the activation burn is a purchase rather than a
   payout. Neither makes the question go away.
2. **Jurisdiction is an operational constraint.** Robinhood's tokenized stocks are EU-facing and not
   offered to US persons. A US-controlled treasury acquiring and distributing them raises questions a
   precedent project does not answer for us, and delivery realistically needs geofencing and KYC at
   the boundary — which is exactly the machinery the retirement deleted.
3. **A bearer-instrument NFT (§3.3) is the sharpest version of all of the above**, because the asset
   then moves on a secondary marketplace with no gate at all.

**The recommendation, made once:** get the §3.3 fork and the delivery boundary onto the launch
checklist *before* step 7, not after. Everything in steps 2–6 can be built, tested and merged
meanwhile without a single share changing hands, which is why the order of work is arranged that way.

---

## Sources

- [StonkBrokers](https://stonkbrokers.io/)
- [What are StonkBrokers NFTs — Airdrop Alert](https://airdropalert.com/blogs/what-are-stonkbrokers-nfts-robinhood/)
- [NFTs turning into stock tokens? What exactly is StonkBrokers? — Odaily](https://www.odaily.news/en/post/5212003)
- [Robinhood Chain NFTs see surge in activity — KuCoin](https://www.kucoin.com/news/flash/robinhood-chain-nfts-surge-in-activity-seven-projects-hit-1500-eth-in-trading-volume)
