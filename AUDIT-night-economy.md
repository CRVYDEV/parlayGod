# AUDIT-night-economy.md — economy red-team, §10.4 conservation and the faucet perimeter

**Date:** 2026-08-11 · **Scope:** the §10.4 conservation claim end-to-end — every `ledger()` reason
across `src/`, the mint/burn/transfer classification, every escrow identity, the `txHash`
anti-fabrication gates, and the newest un-audited money surfaces.
**Method:** static sweep of all 429 `reason:` sites + 19 direct `INSERT INTO transactions` sites,
cross-referenced against `KNOWN_REASONS` / `omrMints` / `DESK.SINK_REASONS`; then live PoCs against a
booted server for every reported finding. `node tools/sim.js` run to completion (§10.4 holds).

**Result: no CRITICAL, no HIGH, and no conservation drift.** The core claim survives the attack —
I could not find another `kitchen:module`. Two real findings, both in the *faucet perimeter* rather
than in conservation, both **empirically demonstrated end-to-end**, plus one LOW documentation defect
and one latent hazard worth a guard.

---

## Ranked findings

| # | Sev | What | Where |
|---|-----|------|-------|
| F1 | **MED** | `primetime:happy` cash faucet is **not agent-excluded** — both siblings in the same file are, and two docs claim it is | `src/primetime.js:142` |
| F2 | **LOW-MED** | `mentor:protege` gates agents at *formation* only, and `agent_flag` is player-flippable at any time → an agent draws the full $20,000 | `src/mentor.js:62`, `:88` |
| F3 | **LOW** | Four comments still describe recycled sinks as "burned / leaves supply / deflationary" — false since economy v3 step 2 | `exchange.js:27,137`, `treasury.js:393`, `auction.js:89,104`, `invariants.js:291` |
| F4 | **LOW (latent)** | The recycle hook is one-directional; `withdraw:omr` is the only sink with a refund path *and* the only `NOT_RECYCLED` one. A future refundable sink mints silently. No guard asserts this. | `src/game.js:126` |

---

## F1 — `primetime:happy` is not agent-excluded (MED)

### The defect

`buyRound` pays a cash faucet with no `agent_flag` check:

```js
// src/primetime.js:142
export async function buyRound(ch, client, h) {
  ...
  if (levelOf(Number(ch.respect)) < PRIME_TIME.RALLY_MIN_LVL) throw new GameError('rookie', ...);
  ...
  if (s.pt.mode === 'value') {
    const cash = PRIME_TIME.HAPPY_CASH;
    ch.cash = Number(ch.cash) + cash;
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: 'primetime:happy', ... });  // :157
```

Its two siblings in the same file **are** excluded — `primetime:rally` and `primetime:siege` both
settle through the worker, which filters at `src/primetime.js:226`:

```js
if (!r.alive || r.agent_flag) continue;
```

Happy hour pays *immediately* rather than at settle, so there is no settle to filter at — and the
gate was never added to the paying function. Neither the route (`src/server.js:2210`) nor
`withCharacter` supplies one.

### Two documents assert the gate exists

- `src/invariants.js:62-65`, describing the `primetime:` vocabulary entry: *"level-floored,
  **agent-excluded**"*.
- `CLAUDE.md`, PRIME TIME step two: *"a bounded faucet `primetime:happy` … level-floored,
  **agent-excluded**, character_id'd"*.

### Proof (live server, agent created through the real public route)

```
agent-key: 200 …                       # POST /v1/auth/agent-key
agent_flag now: true
  round 1: 200 { … "cash":800 }
  round 2: 200 { … "cash":800 }
  round 3: 200 { … "cash":800 }
  round 4: 400 {"error":"done"}
AGENT drew from primetime:happy → 2400 (rows: 3)

# control, same agent, same night, sibling mechanic:
rally answer: 200 {"answered":true,"mode":"value"}
rally settle for the same agent: {"paid":0}
AGENT drew from primetime:rally → 0
```

The control in the same run is what makes this a *sibling asymmetry* rather than a design choice.

### Which invariant catches it

**None, and none should.** `primetime:happy` is a correctly-classified, correctly-`character_id`'d
cash faucet: check (a) `character cash` reconciles it exactly, and `reason vocabulary` accepts it.
§10.4 is doing its job — this is a **policy** gate (who may draw a faucet), which conservation is
structurally blind to. That is precisely why the two prior fixes of this class (R28 F1
`crew:objective`, R28 F5 `streak:daily`) were needed and why they were enforced *in code*, not by
the sweep.

### Severity

MED rather than HIGH: bounded at `HAPPY_ROUNDS (3) × HAPPY_CASH (800)` = **$2,400 per agent per
happy-hour night**, level-floored at 5, and cash has been non-extractable since tokenomics v2
severed cash → $OMR. It is graded MED rather than LOW because it is a **stated invariant that is
false**, in the exact class this project has already fixed twice, and because the agent surface is
one this game deliberately markets to (`AGENTS.md`, `/arena`) — the population is expected to grow.

### Minimal fix

One line, matching `streak.js:30` and `crew.js:371` verbatim, inside `buyRound` before the counter
is written:

```js
if (h.acct?.agent_flag) throw new GameError('agent', 'Agent accounts do not buy rounds.');
```

Placed before the `primetime_happy` write so a refused agent does not burn a round. Regression:
assert an agent gets `error:'agent'` on `POST /v1/primetime/round` while a human is paid
`HAPPY_CASH`; mutation-verify by deleting the line.

---

## F2 — `mentor:protege` gates agents at formation, not at payout (LOW-MED)

### The defect

`offerMentor` gates **both** sides correctly:

```js
// src/mentor.js:46
if (!me || !me.human) throw new GameError('no', 'Not available.');   // agents don't mentor
// src/mentor.js:50
if (!t.human) throw new GameError('not_human', 'You can only mentor a real newcomer.');
```

But `acceptMentor` (`src/mentor.js:62`) — the function that actually **forms the tie** — checks
neither side's humanity, and `claimMentor` (`src/mentor.js:88`) — the function that actually **pays
the faucet** — has no agent gate at all.

The whole defence therefore rests on the offer gate holding for the lifetime of the offer. It does
not: `POST /v1/auth/agent-key` flags **the caller's own existing account**, permanently, at any
moment —

```js
// src/server.js:761-762
app.post('/v1/auth/agent-key', { preHandler: auth }, async (req) => {
  await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [req.user.sub]);
```

— so the state the offer gate checked is mutable after the check.

### Exact failure sequence (proven)

```
offer  : 200                                      # both parties human — offer row lands
kid agent_flag: true                              # POST /v1/auth/agent-key on the kid's own account
re-offer to the agent: {"error":"not_human"}      # control: a FRESH offer is correctly refused
accept : 200                                      # ...but accept never re-checks
tie rows: 1
claim  : 200 {"cash":20000}
AGENT drew from mentor:protege → 20000 | ledger rows: { c: 1, s: 20000 }
```

The `re-offer` line is the control: the system *knows* this account must not be a protégé and says
so, one call before it lets it become one.

`MENTOR.MILESTONES` totals **$20,000** (2k/4k/6k/8k at levels 5/10/15/20), once ever per protégé
account via `claimed_mask`. The mentor side of the same hole (a veteran flipping to agent after
offering) is harmless — the mentor's reward is status only and the leaderboard already excludes
agents (`src/mentor.js:215`).

### Which invariant catches it

**None.** `mentor:protege` is character_id'd and bounded by the bitmask, so check (a) reconciles it
and `reason vocabulary` accepts it. Same class as F1: a policy gate, invisible to conservation.

### Why the test suite missed it

`test/mentor.js:97-100` tests **only** the agent-as-*mentor* path, through `offerMentor`:

```js
assert.equal((await call('POST', `/v1/mentor/offer/${kid2.id}`, { token: bot.token })).body.error, 'no',
  "an agent can't take a protégé");
```

There is no agent-as-*protégé* case at accept or at claim.

### Severity

LOW-MED: $20,000 lifetime per protégé account, cash (non-extractable), and it needs a human veteran
at level ≥ 20 to offer first. It is not merely theoretical — the flip is a single public route call
with no cost — and it is the *general* form of F1: **`agent_flag` is player-mutable, so any agent
gate enforced at formation rather than at payout is bypassable.**

I checked every other faucet against that rule and the rest are clean: `streak:daily` and
`streak:milestone` gate at claim (`streak.js:30`), `crew:objective` at claim (`crew.js:371`),
`primetime:rally`/`:siege` at settle (`primetime.js:226`), the referral payouts re-read `agent_flag`
under the lock at payout (`game.js:1968`, `:2082`), and the Capo licence reads it at sweep. Mentor
is the sole outlier.

### Minimal fix

Gate at the **payout**, where the other four gate, rather than patching accept (which would only
move the race):

```js
// src/mentor.js, top of claimMentor
if (h.acct?.agent_flag) throw new GameError('agent', 'Agent accounts do not draw the protégé stipend.');
```

Optionally also add `if (!(await whoIs(client, ch.id))?.human) throw …` in `acceptMentor` for
defence in depth — but the claim-side gate is the one that closes it.

---

## F3 — four comments describe recycled sinks as destroyed (LOW)

Since economy v3 step 2, a reason in `DESK.SINK_REASONS` no longer destroys the token: `ledger()`
hands it to `desk_inventory` and writes a paired `desk:recycle` row (`src/game.js:126-132`). Four
load-bearing comments still describe the pre-step-2 behaviour, on reasons that **are** in
`SINK_REASONS` and **do** recycle:

| Site | Claim | Reality |
|---|---|---|
| `src/exchange.js:27` | "`window:burn` is an $OMR BURN (omrBurns)" | in the burn *term*, but recycles to the shelf |
| `src/exchange.js:137` | `// the rest leaves supply` | it goes to the desk and is resold |
| `src/treasury.js:393` | "so the burn is pure deflation" (`rwa:vault`) | `rwa:%` is in `SINK_REASONS` → recycles |
| `src/auction.js:89,104` | "the winning bid BURNS" / "escrow → gone" | `auction:win` recycles |
| `src/invariants.js:291` | "auction:win … leaves escrow and the game (deflationary)" | same |

**The §10.4 classification in every case is correct** — each is in `omrBurns`, and the paired
`desk:recycle` row cancels it inside the same term so conservation is exact (verified: buckets net
zero, expected net zero). This is purely a prose defect, but it is the recorded
`laundering.ammSpot` class: a comment that stayed true-looking after the thing it described was
replaced. An operator reasoning about supply from these comments would conclude the game is
deflationary on its largest sinks when it is in fact recycling them — which is the *opposite* of the
founder's explicit revenue-over-deflation call.

**Fix:** reword to "a SINK — it leaves the player and goes to the desk shelf to be resold (economy
v3 step 2); it rides the burn term and its paired `desk:recycle` row cancels it."

---

## F4 — the recycle hook is one-directional and nothing guards it (LOW, latent)

`ledger()` recycles only on `amount < 0`:

```js
// src/game.js:126
if (currency === 'omr' && amount < 0 && recyclesToDesk(reason)) { … desk_inventory += -amount … }
```

So a **positive** row carrying a recycled sink reason would credit a bucket *and* reduce `omrBurns`
while the desk keeps the earlier recycle — a real mint. I swept every `currency:'omr'` ledger call
for positive amounts on sink reasons; there are exactly six, all `withdraw:omr`
(`chain.js:287` cancel, `chain.js:507` reclaim), and `withdraw:omr` is the **one** member of
`DESK.NOT_RECYCLED` — so the reversal is safe.

But the `NOT_RECYCLED` comment justifies the exclusion *solely* on the on-chain double-spend
argument and never mentions the refund path, and `test/desk.js:72-83` pins membership without
asserting the property. The safety is real but **incidental to the stated reason**. The first sink
reason that gains a refund path (an estate feature refund, a bond-pledge unwind, a consignment-fee
reversal) mints silently.

**Fix (a guard, not a patch):** in `ledger()`, refuse a positive `omr` amount whose reason
`recyclesToDesk` — `throw new GameError('sink_reversal', …)` — or, cheaper, add a test asserting
`DESK.SINK_REASONS.filter(recyclesToDesk)` never appears with a positive amount anywhere in `src/`
(the sweep in this audit, made permanent).

---

## Structural recommendation

Both F1 and F2 are the **forgotten-gate class** that `test/gates.js` exists to abolish — and that
file has five families, none of which is about faucets:

```js
// test/gates.js:152
const FAMILIES = [
  'street crime (offensive PvP)', 'PERSON crime (the mark must be reachable)',
  'collect income', 'debt enforcement', 'extraction / parking money out of reach' ];
```

A sixth family closes the whole class:

> **`agent-excluded cash faucet`** — every function that writes a positive `cash` ledger row for a
> reason in an enumerated faucet set must read `agent_flag` **at the point of payment**, with the
> same catalog-or-declare completeness rule the existing families use (a new faucet must join the
> family or be exempted with a stated reason).

That would have caught both findings on its first run, exactly as check 5 and check 7 of
`test/client.js` each caught a live defect on theirs.

---

## What I attacked and found SOUND

### 1. The `kitchen:module` hunt — clean

I extracted all **274 distinct reason literals** plus 45 template/dynamic reasons from every
`reason:` site in `src/`, resolved the templates, and classified each against the vocabulary, the
mint term and the generated burn term.

- **Vocabulary is complete.** Every literal matches a prefix in `KNOWN_REASONS` for some currency.
  The 15 non-matches are all non-ledger `reason:` fields (`no_price`, `stale_price`, `talked`,
  `lender_dead`, `budget`, `dust`, …) — verified individually at their call sites; none reaches
  `transactions`.
- **Every $OMR transfer lands in a counted bucket.** I traced all 14 transfer-classified reasons to
  their destination: `auction:bid/refund/consign` ↔ `auctionEscrow`; `tax:dev` → `dev_fund`;
  `tax:buyback` → `family_yield_pool` (`tax.js:101-104`); `tax:dev:claim` `dev_fund` → account;
  `family:weekly` and `daily:all` → out of `street_tax.fund`; `gang:tribute` → `gangs.omr_reserve`;
  `yield:window` → `family_yield_pool` (`exchange.js:130-135`); `yield:family` pool → reserve;
  `desk:sale` shelf → account; `whack:loot` account → account. Every one of those tables is inside
  `omrBuckets`. **No `kitchen:module` clone.**
- **No missing bucket.** I enumerated every table that could hold soft $OMR and matched it against
  `omrBuckets`. `vig_prize_pool` and `chain_reserve.funded_omr` are correctly *excluded* — they hold
  hard, on-chain-backed $OMR, and `prize:omr` correctly mints the soft counterpart.
  `account_persistent.rewards` and `pass_owed` are owed-figures, not balances, paid by an enumerated
  mint. Nothing else holds soft $OMR.
- **The inverse attack is clean too** (F4 above): no positive-amount row carries a recycled burn
  reason.

### 2. NULL-`character_id` cash rows — every one is covered

These are invisible to check (a), so each needs a dedicated check. I enumerated all **59** of them
and matched each to its check: 24 to the gang-treasuries check (b), and the rest to
`commission escrow`, `bounty escrow`, `market escrow`, `loan escrow`, `favor escrow`,
`turf contest escrow`, `loan house pool`, `boxing bet escrow`, `poker tourney escrow`,
`ring poker escrow`, `grand prix escrow`, `stakes escrow`, `futurity escrow` and `den distributions`.
The residue (`loan:vig`, `loan:paper`, `casino:take`, `mod:confiscate`) are sinks into
`street_tax.pool`, which is deliberately not a §10.4 cash bucket — their paired character rows are
what check (a) reconciles, and they net correctly.

### 3. `txHash` anti-fabrication gates — all held

Every mod/QA route that could book real revenue passes its caller-supplied `txHash` through
`modRealTxHash` (`src/routes/modtools.js:29`), which strips it unless `ALLOW_MOD_REAL_REVENUE=on`
(preflight-classified TEST_ONLY, `src/preflight.js:40`). I checked all **10** such routes — stock
keeper, stock buy, sell tax, harvest fee, desk buyback, POL fees, desk fill, bond, and both store
paths. `splitRevenue` (`store.js:30`) has no internal gate but is only ever called behind
`if (txHash)` at `store.js:163`. A comp books zero units *and* zero ETH in `recordStockBuy`
(`treasury.js:143-144`) — the sharpest instance, since there the fabricated quantity is the wall's
own input.

The one remaining unbacked-reserve route, legacy `POST /v1/mod/reserve/fund`, **is** caught: it
raises `chain_reserve.funded_omr` with no matching source, which breaks `reserve fully backed`
(`vig.js:278`, `funded <= toReserve + prizePaid + deskToReserve`). Verified the desk term is gated
`WHERE real` on **both** halves so the sandwich catches rather than absorbs a comp-funded reserve.

### 4. The escrow identities — term-for-term against the code

I read the write paths for each and confirmed the identity closes:
`favors` (post/pay/take/refund/death/loot), `district_bids` (stake/refund/burn — including the
dissolved-family and winner-burn branches at `gangs.js:660-677`), `loans` + `loan_house`
(fund/vig/repay/seize/take signs all consistent), `auctions` + `auction_consignments`
(bid/refund/win/consign/take, with the outbid refund correctly split in-memory for a self-raise and
direct-SQL for a third party at `auction.js:73-79`), plus bounty, market, boxing, tournament, ring,
grand prix, stakes and futurity. The exact-reason matches for the tournament/futurity/ring sit
*under* the `casino:bet:%`/`casino:win:%` den-book LIKE patterns, so no competitive pool touches the
PvE house book — confirmed by enumerating every `casino:` reason against both patterns.

### 5. Every real-value invariant is actually wired to the alarm

All seven runners fire on the worker tick with `alertDrift` (`worker.js:534-564`): ledger, vig, bond,
treasury, desk, exchange, router. No check-nobody-reads.

### 6. Direct `INSERT INTO transactions` sites (bypassing `ledger()`)

All 19 checked. None writes a negative `omr` row with a `SINK_REASONS` reason, so none silently
skips the recycle. `desk.js:207` (`desk:sale`) and `desk.js:323` (`desk:buyback`) correctly bypass
the hook — a sale is a transfer and a buyback is a mint, neither should recycle.

### 7. Other spot checks

- `crime:take` (`game.js:1670`, `:1755`) — both legs `character_id`'d, netting exactly zero; the
  `SKIP LOCKED` debit cannot pay more than it took.
- `heist:hire` / `world:hire` — character_id'd sinks; hired NPCs forfeit their share.
- `claimVaulted` charge arithmetic — a clamped claim can never charge more than asked (`eth < wanted`
  ⇒ `floor(eth·perEth) ≤ amt`); the zero-unit burn is refused before any $OMR moves.
- `redeem`'s remainder rule — `cut + burn == omr` exactly, with the intermediate `round6` re-round
  that stops a full-balance redemption failing its own guard.
- `spendOmr`'s negative/NaN guard (`vanity.js:23`) holds for all 40 call sites.
- `node tools/sim.js` — completes green, "§10.4 holds exactly over an entirely earned economy".

---

## Not findings (checked and dismissed)

- **`tax:dev:claim`** looks like a mod route minting $OMR; it is a `dev_fund` → account transfer
  between two counted buckets, and `router.js:198` holds `dev_fund` to `Σ tax:dev − Σ tax:dev:claim`.
- **`POST /v1/mod/emission/fund`** moves `street_tax.fund` → `stake_pool` with no ledger row —
  correct, both are inside `omrBuckets`.
- **`corner:job` / `hustle:payoff` / `career:*` / `firstblood:reward` / `clue:casket`** are not
  agent-excluded either, but unlike F1/F2 no sibling, comment or doc claims they are, and each is
  hard-bounded (per-day PK, once-ever latch, or drop-gated). Recording them as *policy calls for the
  founder*, not defects — though the F1/F2 fix family above would force the decision onto the record.

---

## RESOLUTION (2026-08-11, same session)

| # | Verdict | What shipped |
|---|---|---|
| F3 | **FIXED** | Four load-bearing comments still described recycled sinks as destroyed — `exchange.js` ("the rest leaves supply", and the header calling `window:burn` an `omrBurns` burn), `treasury.js` ("the burn is pure deflation"), `auction.js` ("the winning bid BURNS", "burn the winning bid — the only $OMR the auction removes") and `invariants.js` ("leaves escrow and the game (deflationary)"). The CLASSIFICATION was right — they sit in the burn TERM so conservation stays exact — but the economics are the opposite of what the prose said: since v3 step 2 every one of these reasons is in `DESK.SINK_REASONS`, so a paired `desk:recycle` row hands the value to the shelf, which sells it back for ETH at the daily auction. Each now states both halves (it counts in the burn term; the value goes to the house, not the fire), which is the difference between a maintainer preserving the revenue model and one "fixing" it back into deflation. |
| F4 | **FIXED** | The recycle hook's `amount < 0` guard is now pinned. It is one clause in one `if`, easy to lose in a refactor, and losing it is expensive in a way conservation cannot see: a sink reason can appear on a POSITIVE row (a refund, a reversal, a mis-signed credit in a new caller), and the hook would then credit the shelf **while the player is also credited** — the same $OMR in two places, with both legs inside counted buckets so `$OMR conservation` stays green throughout. `test/desk.js` block (4b) writes exactly that row and asserts the shelf, its lifetime counter and the `desk:recycle` ledger all stay untouched. Mutation-verified: dropping the guard fails by name with the balances (`30 → 5`). |

The same drift was swept in the PLAYER-facing copy in the same pass: `docs/WIKI.md` and
`public/wiki.html` each described the auction's winning bid as reducing supply and the Family Yield's
cut as going to families "instead of leaving supply". Both now say what actually happens.

**The class worth keeping.** A comment that describes retired economics is not a documentation
problem — it is a future defect, because the next maintainer reads it and acts on it. Both of these
were describing the world before the founder's revenue-over-deflation call, sitting immediately beside
the code that implements the opposite.
