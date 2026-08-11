# THE FAMILY DIVIDEND — redirecting the treasury toward the family layer (Path A + the split)

**Status: DESIGN LOCKED (founder-directed 2026-08-11: "Lock this in"). NOT BUILT.**
This is the shape a future build works from. Enacting it is a sign-off + contract-re-audit build,
NOT a silent lever retune — several slices are on-chain immutables (see §5). The interactive source
of truth for the numbers is `public/fee-flows.html` (published artifact); this doc is its rationale
and wiring.

---

## 1. THE DECISION

Point **more real revenue at the family layer** — the deepest social system in the game — so family
competition becomes the endgame's center of gravity. Do it as **Path A** (route the redirected value
through a buyback into in-game $OMR, never real ETH to a gang), and **keep a smaller treasury** so the
backed vault, the cold-ETH reserve trust story, and the individual "go legit" exit all survive.

The rejected alternatives, recorded so they stay rejected:
- **Path B (real ETH to families):** distributing real money to in-game groups by competitive standing
  reads as a gambling payout / money transmission. The whole point of keeping the family yield in
  **$OMR** was to stay clear of exactly this line. Do NOT build without counsel.
- **Kill the treasury entirely:** also deletes the individual ETH exit (THE VAULT / "go legit") and the
  growing cold reserve that is a *backing/trust signal* for a real-money-adjacent token. The split keeps
  both.

---

## 2. THE LOCKED FEE STRUCTURE

Destination **structure-share** (each source counts as one unit split by its bps — a shape view, not a
dollar-volume claim), before → after:

| Destination | Now (production) | Locked target |
|---|---|---|
| Operations (dev wallet) | 29.7% | 29.7% |
| Community (family yield) | ~11% | **21.2%** |
| POL (liquidity depth) | ~13% | 19.8% |
| **Vig** (withdrawal reserve) | ~19% | **10.0%** |
| **Treasury** (backed vault + cold reserve) | ~27% | **10.0%** |
| Desk-buyback (POL-fee budget) | 12.5% | 9.4% |

The per-source bps (the actual levers), production → target. **Bold** = touches an on-chain immutable
(§5); everything else is a backend earmark.

| Source | Currency | Production split | Locked split |
|---|---|---|---|
| Gameplay fees (mint/respawn/reroll) | ETH | vig 6000 · treasury 1000 · ops 3000 | vig 2500 · treasury 1000 · **community 1500** · ops 5000 |
| The Store (packages) | ETH | vig 4000 · treasury 2000 · ops 4000 | vig 2500 · treasury 1000 · **community 1500** · ops 5000 |
| **Reserve bonds (principal)** | ETH | pol 3750 · vig 2250 · treasury 2500 · ops 1500 | **pol 7500 · vig 500 · treasury 500 · ops 1500** |
| **DEX sell tax (9%)** | ETH | ops 2222 · treasury 4444 · pol 3334 | **ops 2222 · treasury 1778 · community 2666 · pol 3334** |
| Desk Dutch auction | ETH | pol 5000 · ops 5000 | pol 5000 · ops 5000 *(unchanged)* |
| POL trading fees | ETH | desk-buyback 10000 | desk-buyback 7500 · **vig 2500** |
| Bank harvest fee (20%) | USDC | treasury 10000 | treasury 3720 · **community 6280** |
| $OMR exit toll (2%) | $OMR | ops 5000 · community 5000 | ops 5000 · community 5000 *(unchanged)* |

Two mechanical notes recorded when the numbers were set:
- Vig and Treasury each land at **exactly 10.0%** of the structure. Getting there is asymmetric — Vig
  needed +3.1% (funded from the desk buyback budget), Treasury only +0.9% (funded from the family
  share). So **only ~1% came off community, not the full 2%** a naive read would suggest; a full 2%
  would push Treasury past 10%.
- The bonds row stays **POL-heavy (75%)** on purpose and gets **no** family redirect — liquidity depth
  is the binding constraint on the daily bond cap (`tools/bond-dials.js`), so bleeding it to families
  undermines the bond program's own purpose.

---

## 3. THE THREE MOVES

1. **The split rebalance** — reweight the existing per-source slices (backend levers + two contracts).
2. **Path A — the family buyback (NEW mechanism):** the redirected value flows to a `community` earmark,
   a keeper spends it on $OMR off the DEX, and the bought $OMR credits `family_yield_pool`. This is the
   only genuinely new machinery. See §4.
3. **The polfees → Vig diversion (a rule relaxation):** POL trading fees stop feeding the buyback budget
   *exclusively*. See §6.

---

## 4. PATH A — THE FAMILY BUYBACK (the meat)

**The wall it crosses:** the treasury holds **ETH/USDC**; the family yield pays **$OMR** (an in-game
pool, `family_yield_pool`, distributed 5-4-3-2-1 across the top seasonal-standing families). You cannot
wire ETH into a $OMR pool — it needs a conversion. Path A is that conversion, and it is deliberately the
**exact shape of `runVigBuyback`** (the Vig's ETH → buys $OMR off the DEX → funds the withdrawal
reserve), so the discipline is already audited:

1. Every `community`-earmarked ETH slice (fee, store, sell-tax) accumulates in a **community revenue
   ledger** (a new `source='community'`-tagged bucket, sibling to `vig_revenue` / `rwa_revenue`). The
   USDC harvest community slice accumulates in its own underlying.
2. A keeper — **`runFamilyBuyback`**, the `runVigBuyback` twin — spends the UNSPENT community revenue on
   $OMR off the canonical pool (mainnet: the real DEX; off-chain-first: a mod/QA param, `txHash`-gated
   like every real-value ingest). The root cap is `ethToSpend ≤ revenue − alreadySpent`.
3. The bought $OMR credits `family_yield_pool`, ledgered **`yield:buyback` — an EXACT new reason in
   `omrMints`** (never the `yield:%` prefix: `yield:window`/`yield:family` are genuine transfers and
   must stay out of both terms). *[CORRECTED at build time, 2026-08-11 — the first draft of this line
   said the credit "needs no new mint reason", which was WRONG: the credit has no counted-bucket
   debit, so an unclassified reason crediting `family_yield_pool` is precisely the `kitchen:module`
   silent-drift class. The soft credit is a mint admissible exactly to the extent the hard token
   really arrived — the `desk:buyback` shape — which conservation cannot see, so
   `runFamilyBuybackInvariants` asserts credited == bought over real rows.]*
   `payFamilyYield` then distributes it (the existing mechanism, untouched).

**§10.4 posture (the load-bearing part):** the bought $OMR is *already-circulating* supply pulled into
the pool with real ETH — in-game it books as the `yield:buyback` mint above, backed one-for-one by the
hard purchase the invariant reconciles. So Wall 1 (no faucet paying a PLAYER from nothing) holds in
substance — nobody is paid unbacked supply — and the extraction discipline
extends by construction: **the family pool can never distribute more $OMR than the buyback bought**
(the `prize pool ≤ bought` shape). A new real-value invariant, **`runFamilyBuybackInvariants`**
(the `runVigInvariants` twin), asserts `distributed ≤ bought` and the split-exactness, wired into the
worker's nightly `alertDrift` beside vig/bond/desk/treasury/bank.

**Why this keeps the regulatory posture:** families receive **in-game $OMR**, extractable only through
the same throttled withdrawal rail as everything else. No real ETH ever reaches a gang. That is the
entire reason Path A is chosen over Path B.

---

## 5. ON-CHAIN — WHAT RESETS THE AUDIT CLOCK

Only **two** rows touch contract immutables. Both are cheaper to change **now** (pre-mainnet, before the
third-party audit batch) than after — doing it now costs nothing; after audit it means paying to
re-audit.

- **Reserve bonds** (`OmertaBond.sol`): the four-way ETH split (POL/VIG/TREASURY/DEV) is forwarded in-tx
  and its bps are immutable. Reweighting to 7500/500/500/1500 is a contract change. Keep the four-way
  shape (do NOT drop a recipient); the load-time sum guard + the `Bonded` event's four-slice emit stay.
- **DEX sell tax** (`OmertaHook.sol` v4 hook + `OMR.sol` ERC-20 backstop): today a **three-way** split
  (dev/rwa/lp). The target splits the rwa slice into **treasury + community**, i.e. a **four-way** hook
  split, which needs a new on-chain recipient — the **community-buyback wallet** (a Safe/EOA the §4
  keeper drains). Reweight + new recipient = contract change. `MAX_SELL_TAX_BPS` (1000) is unchanged and
  still the compile-time ceiling; `DISCOUNT_BPS < sellTaxBps` still holds.

Everything else — fees, store, auction, harvest, toll, polfees — is a **backend earmark** (recorded in
the ledgers, the ETH physically custodied per the existing OmertaFees/router plumbing), changed by env
levers with **no contract change**.

**Custody rule (do not skip):** the sell-tax community recipient and the community-buyback keeper wallet
must be the **same** address (or the keeper must control it), or the ledger books family backing against
ETH the keeper cannot spend — the `allocated ≤ held` class of drift, one system over. Same discipline as
the bond four-slice fix (CLAUDE.md §0.5): a slice's on-chain recipient and its off-chain consumer share
one custody.

---

## 6. DESIGN FLAGS (each the founder's call, recorded here so it is not silent)

- **The polfees → Vig diversion relaxes "Wall 4."** The desk buyback budget is currently POL-fees-*only*
  (it is how the desk restocks its shelf without minting). Routing 25% of POL fees to the Vig reserve is
  legitimate but relaxes that exclusivity. **Alternative if you want the rule kept pure:** fund Vig's
  +3% by shaving the fee/store **Operations** slices instead (e.g. ops 5000→4700 on fee+store) — same
  10/10 Vig/Treasury result, buyback budget untouched. Flagged as a one-line swap.
- **The split ratio (treasury vs community).** ~40/60 kept-vs-redirected on the ETH sources is the main
  dial. More to community = a bigger family prize but a thinner backed reserve / trust signal; more to
  treasury = the reverse. The artifact is where this is tuned.
- **Snowball / concentration.** A much bigger family pool amplifies the top-family concentration the
  audits repeatedly flag (standing is buyable via lifetime tribute; the econ-pass already made seats
  *seasonal* to blunt this). If the family pool grows a lot, **pair it with a stronger seasonal-standing
  reset** so the pool does not entrench one dynasty.
- **The trust-signal cost.** A continuously-drained treasury stops accumulating the visible cold ETH
  reserve that reads as "the token is backed." The split keeps a treasury (10%), so the signal survives
  smaller — but it is a real cost of pointing revenue at families, worth stating.

---

## 7. SCOPE — DECIDED vs GATED

**Decided (this doc):** the target fee structure above is the shape to build to.

**Gated before it ships:**
1. **Founder sign-off on the lever changes** — this moves many signed levers (VIG_BPS, STORE.SPLIT_BPS,
   BONDS.*, SELL_TAX.*, and adds a community earmark). Ground rule #1: not a silent retune.
2. **The contract re-audit batch** — the two on-chain immutables (§5) reset the third-party audit clock
   mainnet is already gated on. Batch them with any other pending contract work; do not dribble.
3. **The community-buyback keeper build** (§4) — a new worker keeper + ledger + invariant, off-chain
   first / chain-dormant (the `runVigBuyback` / M6 pattern). No new §10.4 mint reason.

---

## 8. BUILD ORDER (when green-lit)

1. **Backend earmark + keeper, chain-dormant** — add the `community` revenue earmark, `runFamilyBuyback`
   (mod/QA-param priced until the DEX bot), `runFamilyBuybackInvariants`, and re-derive the router
   `waterfall()` from the new levers. Zero new regulatory surface. Sim + `runRouterInvariants` green.
   **✅ BUILT 2026-08-11** (`src/community.js`, `test/community.js` — every lever ships 0, production
   byte-identical until step 2; the §4 mint-reason correction above landed with it).
2. **The lever changes** — the fee/store/auction/harvest/toll/polfees earmarks (env), sign-off recorded
   in BALANCE.md. Re-sim the whole cash + real-revenue economy (the whole point of the router is that a
   slice move is on the record).
3. **The two contracts** (§5) — bond reweight + the four-way sell-tax hook with the community recipient;
   `forge test` green; into the audit batch.
4. **The DEX keeper + custody wiring** — mainnet, behind the audit + counsel gates.

The regulatory line stays: **families are paid in in-game $OMR, funded by a real-revenue buyback; never
real ETH to a gang.**
