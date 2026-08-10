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
| `allocated ≤ held` | `runTreasuryInvariants` | **Built, in ETH** — must be re-denominated per ticker |

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

### 3.3 The fork the founder should decide, not me

**Does the stock land in the NFT's bound account, or is it a claim the account can pull?**

Stonkbrokers puts it in the bound account, so it transfers with the NFT. That is the model as asked
for, and it is the default here. But note what it does to our own stated rule: the identity-NFT design
says *"the token is a tradeable trophy; the game entitlement is account-bound and never read off a
balance,"* and stock in the bound account makes the NFT a **bearer instrument for securities** —
sold on a marketplace, the stock goes with it. That is a bigger step than a claim model, and it is the
single design decision here that a securities lawyer will care about most.

Recorded as the default (matching the instruction), flagged as the thing to raise with counsel first.

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

1. **Counsel, before code.** §6.
2. Re-denominate `runTreasuryInvariants` to per-ticker units and restore the `allocated ≤ held` wall.
3. The activation tiers + burn (in-game, shippable independently, a pure `$OMR` sink).
4. The epoch allocator, computing weights off `ACTIVITY` — off-chain, dormant, no delivery.
5. The buy keeper — chain-dormant behind the standing gates.
6. The Dynasty NFT + ERC-6551 bound accounts (currently design-only).
7. Delivery. **Last**, and only after 1.

Steps 3 and 4 are buildable now and are genuinely useful on their own: the activation sink helps the
economy, and the allocator can compute and publish weights long before anything is delivered.

---

## 6. The legal record — stated once, and honestly

The founder has asserted counsel approval and accepted the risk in writing (this session, and the
standing directive in `CLAUDE.md`). This section is not a re-litigation of that; it exists because the
next reader needs the facts in one place.

**What is being reversed.** `omerta-stock-layer-retirement.md` retired stock acquisition on
2026-07-31 with recorded reasons: it deleted the only securities event in the project, removed the
KYC and geofencing requirements, and stopped R2/R3 being carried milestones. This design reopens that.

**What a precedent does and does not establish.** StonkBrokers is doing this, visibly, at scale, on
the same chain. That is real evidence about enforcement *appetite* and about what infrastructure
exists. **It is not a legal opinion, and "they did it first" has never been a defence.** Worth saying
plainly once so nobody mistakes the citation for a clearance.

**Three concrete facts that do not go away:**

1. **Buying an asset and distributing it to token holders on the strength of holding the token is the
   classic profit-expectation fact pattern.** Counsel row A11 already assesses revenue distribution to
   holders as the clearest securities leg in the project. Weighting by *play* rather than by holdings
   genuinely helps that argument — effort is not passive — and the activation burn is a purchase
   rather than a dividend. Neither makes the question go away.
2. **Jurisdiction is an operational constraint, not an opinion.** Robinhood's tokenized stocks are
   EU-facing and not offered to US persons. A US-controlled treasury acquiring and distributing them
   raises questions a precedent project does not answer for us, and delivery realistically needs
   geofencing and KYC at the boundary — which is exactly the machinery the retirement deleted.
3. **A bearer-instrument NFT (§3.3) is the sharpest version of all of the above**, because the
   security then moves on a secondary marketplace with no gate at all.

**The recommendation I am obliged to make, once:** get the §3.3 fork and the delivery boundary in
front of counsel *before* step 7, not after. Everything in steps 2–6 can be built, tested and merged
meanwhile without a single share changing hands, which is why the order of work is arranged that way.

---

## Sources

- [StonkBrokers](https://stonkbrokers.io/)
- [What are StonkBrokers NFTs — Airdrop Alert](https://airdropalert.com/blogs/what-are-stonkbrokers-nfts-robinhood/)
- [NFTs turning into stock tokens? What exactly is StonkBrokers? — Odaily](https://www.odaily.news/en/post/5212003)
- [Robinhood Chain NFTs see surge in activity — KuCoin](https://www.kucoin.com/news/flash/robinhood-chain-nfts-surge-in-activity-seven-projects-hit-1500-eth-in-trading-volume)
