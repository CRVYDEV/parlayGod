# AUDIT — RED TEAM #6 (2026-08-17)

**Scope.** The sixth max-effort pass, run immediately after RT#5 merged, and aimed where the user pointed
it: **edges the game has not been combed through, and interactions — within the game, and between the
smart contracts.** Both halves needed the same discipline as RT#4/#5 — the prior reports are individually
thorough and collectively leave gaps in exactly two shapes: a surface nobody has swept *as a sweep*, and a
class established once and never taken to its edge.

**Method.** First-hand throughout; no fan-out. Nothing was called a finding before it was reproduced
against a running engine, and nothing was fixed before it was reproduced. F1 needed **real Postgres** (it
is a two-writer race, and pg-mem is a single caller); the wealth-leak sweep needed a **booted server with
two real characters**, because the question it asks — "does any board hand a stranger an exact figure?" —
cannot be answered by reading 172 route handlers.

**Result. No CRITICAL, no HIGH. Two findings — one latent-but-armed, one small-and-consistent — and six
lenses that came back clean.** Four mutations, each failing at its own named assertion.

---

## F1 (MED, latent) — the buyback's 12h timer was never re-checked under the lock

`runBuyback` (`src/worker.js`) is the tick that carves the street-tax pool into the redemption window. It
opens with a **cheap unlocked peek** at `street_tax`, exits if the 12h period is not up, and only then
takes `SELECT pool FROM street_tax … FOR UPDATE`.

The comment on that peek is careful and it is half the story:

> the authoritative pool value is re-read under the lock below, so a take landing between the peek and
> the lock is not lost.

It says nothing about `last_buyback`, and `last_buyback` is never re-read. So the **pool** is
authoritative under the lock and the **timer** is authoritative only on the unlocked peek. Two overlapping
workers — the deploy-overlap threat model that already justified an advisory lock for the wage epoch, the
population, the city leg, the NPC sweeps, the stock keeper and (RT#4 F1) both DEX bots — clear the peek
together, queue on the lock in turn, and the loser carves a **second time inside one period**.

**Reproduced on real Postgres**, with a third connection holding the `street_tax` lock so both workers are
guaranteed to park on it rather than interleave by luck:

```
FUND_BPS 3000 | A: {"toWindow":30000} B: {"toWindow":21000}
  ONE 12h period should fund at most 30000 — actually funded: 51000
```

**It is inert at the shipped value, and that is the shape of the finding rather than a reason to leave
it.** `EXCHANGE.FUND_BPS` is 10000, so the winner takes the whole pool and the loser's `floor(0 × 1.0)`
trips the `toWindow <= 0` guard on the next line:

```
FUND_BPS 10000 | worker A: {"toWindow":100000}  worker B: null
```

That is a cadence gate holding by an accident of an **unrelated founder lever**. `FUND_BPS` sat at 3000
until tokenomics v2 step 2 moved it, it is a signed lever that can move again, and this is the third time
this codebase has met a defect that a later lever change would arm (the family-yield lock cycle that step
2's own dial would have opened; the `runBuyback`-gated legacy pool merge). A gate whose correctness
depends on a number nobody is thinking about when they change it is not a gate.

**Fixed:** the authoritative read carries **both** halves and the due-check is re-applied under the lock.

**Regression** (`test/economy.js`) is in two parts, because pg-mem can drive one half and not the other.
Behavioural: every other buyback assertion in that suite passes `force`, which bypasses the timer
entirely — **so the cadence itself had no coverage at all** — and it now walks fresh → not due, backdated
→ carves once, immediately again → nothing. Structural: a **labelled** source tripwire for the concurrent
half, asserting the locked read carries `last_buyback` and that `BUYBACK_PERIOD_MS` is re-applied between
that read and the carve.

Two mutations, each caught by name: drop the locked due-check → *"re-check the 12h window under the lock,
or two overlapping workers both carve in one period"*; drop `last_buyback` from the locked SELECT →
*"the LOCKED read of street_tax must carry last_buyback — the peek above it is not authoritative"*.

---

## F2 (LOW) — the sixth vehicle handover kept the nitrous

Six statements re-point a car's `character_id`: a market buy-now, an auction settle, a loan collect, the
grace-forfeit sweep, a pink-slip race, and a theft. A car carries two kinds of flag that must not survive
a handover — **consent** (`race_limit`, `pink_slip`: the old owner offered *this car* on the strip or for
pinks, and the new owner agreed to neither) and a **consumable** (`nos`: charges the old owner paid for,
up to 3 at $8k each).

Five sites clear all three. `stealCar` cleared the two consent flags and kept the nitrous.

It reads deliberate, which is the interesting part: its own comment names *"the consent flags"*, so a
reader concludes the omission was considered. Nothing anywhere says a thief inherits the charges, and the
five siblings say the opposite. This is the **forgotten-sibling** class this project's gate matrix exists
for, and the consent half of the very same class was found by `AUDIT-street-races-step-two` — so this is
the second finding in one place.

Both readings of the right behaviour are defensible (on a market sale the seller was paid, so clearing
destroys value they were compensated for; on a theft the victim was not). What is not defensible is six
sites and five rules. Made consistent with the five, and the rule is now stated out loud at the site.

**Guarded**, because a note is not a guard: `test/gates.js` gained **THE HANDOVER LEDGER** — every
statement that re-points `cars.character_id` / `boats.character_id` must clear that class's flags, or be
waived with a reason. One waiver: the estate line, which moves only `minted_onchain` rows, and extraction
already refuses a listed or pledged row and clears the consent flags itself. Nine handovers found; an
anti-vacuity floor fails the check if the extractor stops seeing them.

Two mutations: restore the divergent theft → *"social/combat.js:816 keeps nos"*; break the extractor →
*"the handover scan found only 0 ownership transfer(s) — vacuous rather than clean"*.

---

## The lenses that came back clean

A red team that publishes only its hits cannot be audited. Six, with what each actually did.

### 1. Does any authed board hand a stranger another player's exact wealth?

The **anti-precise-kill-EV rule** — wealth is BANDED everywhere it is shown, never exact — has been
enforced per-surface at build time (the Wire dossier, the arena aggregate, the public profile, the beef
card) and **never swept as a sweep**. Reading 172 route handlers cannot answer it; a running server can.

Booted on pg-mem, two real characters, the mark given five collision-proof figures (`cash 8675309`,
`bank 7654321`, `omr 424243`, `staked 313373`, `bank_intransit 909091`), then **every authed non-mod
`GET /v1` route** called as the *stranger* and scanned for those literals.

Two vacuity controls, because a clean sweep of boards that never contained the mark proves nothing:

* the detector is proven live — the mark's own `/v1/me` returns **all five**;
* the sweep reports which boards **actually contained the mark**, and the answer is 12, including the
  streets roster, discovery, `/v1/live`, both leaderboards it places on, the identity portrait and its
  metadata, the feud ledger, the people history, the phone thread — and, after the probe was extended to
  buy them, the **paid** intel surfaces (a live wiretap, a dossier, a Street Wire subscription), which is
  where an exact figure would be most tempting to surface.

**Result: 164 of 172 answered 200, 12 contained the mark, zero leaked a figure.** Every 4xx is a
legitimate refusal (three retired routes, `no_deed`, `no_table`, the websocket upgrade), not a coverage
hole; three routes take a param the sweep cannot synthesise and are named rather than silently skipped.

### 2. The Bank cluster, read as a graph

`Denari` / `Transmuter` / `Alchemist` / `CollateralEscrow` / `FlashGuard` is the newest real-value system
and the **least-audited group** (1–4 reports each). Read as a graph — shared authorities, token flows, and
walls that span contracts — rather than file by file:

* **Two singular, fail-closed authorities.** `Denari.minter` is the Alchemist, `burner` the Transmuter,
  both `address(0)` at deploy. `burn(from, …)` skips the allowance check, which is safe **only** because
  the single burner pulls tokens into itself first — verified in `Transmuter.redeem`, which does exactly
  that (`safeTransferFrom` then `burn(address(this), …)`), so the header's caveat is honoured rather than
  merely written.
* **The §2.4 ordering holds.** `bufferHealthy()` gates `Alchemist.mint` and touches redemption nowhere:
  the protocol stops issuing before it stops paying. Redemption is deliberately **not** same-block
  guarded, and that is right — the arbitrageur who buys DNR at 0.98 and redeems at 1.00 is repairing the
  peg at their own risk.
* **The accounting-vs-fee interaction was chased and dissolved.** `principalOf` is decremented by *every*
  withdrawal, so a user who withdraws pure yield is left recorded as having less principal and the same
  harvestable yield — which looks like a performance fee charged on principal. Worked through end to end
  it is not: `totalAssets − principalOf` is **invariant** under a withdrawal, so the lifetime fee is the
  same 20% of the same 100 of yield whether the user withdraws first or not, and the equity figures agree
  to the unit in both orders (and in the withdraw-more-than-the-yield case).
* **No oracle on the borrow path** (denomination matching), no `liquidate()`, no pool and therefore no
  shares to round — RV finding #1 is unreachable rather than fixed. The LTV/fee coupling that a
  permissionless harvest can breach is already bounded at both setters.

### 3. Every ownership transfer excludes an extracted item

The inert-while-extracted rule (v3 step 7) is enforced at one point — `loadOwned` filters
`minted_onchain` cars out of `owned.cars` — so a rule that holds only where a path reads through that
cache is worth checking per path. `races.js` guards both sides of a wager and a pinks race explicitly;
`market.js:listCar` and `loans.js` pledge both read through `h.owned.cars`; `stealCar` and `stealBoat`
filter in SQL (and boat theft additionally excludes an at-sea hull and clears the rendezvous consent
flag). `chain.js:requestItemWithdraw` refuses a listed or pledged car before signing. No path reaches an
extracted item.

### 4. Absolute writes to `account_persistent` from an unlocked read

The class that produced the NPC-families F1 (a founder's cash writeback computed from an unlocked read,
clobbering a concurrent debit) applied to the account table. Every absolute-write site enumerated: the
single-party ones run under `withCharacter`, and one account has one living character, so two of them from
the same account serialize on that character's lock (the `giveVouch` argument). `maybeQualifyReferral` —
the one multi-account writer — locks both accounts `FOR UPDATE` in **sorted id order** and computes
`recruits` from the locked row, so two recruits qualifying for one recruiter serialize on the recruiter's
row and cannot cycle. `sweepCapoLicense` writes an absolute count it recomputes from scratch each tick, so
a lost update self-heals.

### 5. The shared `vouchers` table

RT#6's predecessor closed a kind-filter gap here (a StreetDeed voucher was reclaimable by the
VoucherClaim rail). Re-swept: five insert sites, every nonce drawn from `chain_reserve.next_nonce` under
`FOR UPDATE` so the space is globally unique across both contracts, and every reader kind-scoped —
including `cancelQueuedWithdraw`, whose guard is a JS `if (v.kind !== 'omr') throw` one line below the
SQL. *(That last one was a false positive from my own grep, whose 3-line SQL context window could not see
the guard. Recorded, because a finding produced by a tool you wrote and did not check is not a finding —
RT#2 filed 13 of these.)*

### 6. §10.4 reason classification

All 52 `$OMR` reason literals in `src/` classified: each is in the mint term, in the burn term generated
from `DESK.SINK_REASONS`, or a transfer between two **counted** `omrBuckets`. No orphan of the
`kitchen:module` class — a reason in the vocabulary but in neither term and moving value to a bucket
nobody sums, which is a stable, non-growing, invisible drift. All 43 NULL-`character_id` cash reasons
likewise owned by a check (the gang-treasuries check, one of the escrow checks, or a house take).

---

## Flagged, not changed

* **`ALCHEMIST_ASSET_DECIMALS` defaults to 6 and is trusted.** The contracts read decimals **off the
  token** (`IERC20Metadata(asset).decimals()`, checked in both constructors); the backend takes it from
  env. A market on an 18-decimal underlying deployed without setting it books the harvest fee **1e12 too
  large**, and the family-buyback keeper's per-currency budget is denominated in the same wrong unit, so
  the ledger stays self-consistent while disagreeing with reality. It is a config error no prover can see
  — the same class as `DEX_POOL_FEE`. The cheap hardening is to read `decimals()` off the configured asset
  at boot and refuse a mismatch, which would delete the knob; left as a note because it changes a startup
  path on a dormant rail.
* **`stealCar` inherits its sibling's rule by fiat.** Clearing the nitrous is now consistent, but whether
  a *theft* should destroy the charges or hand them over is a design call, not a correctness one. The
  guard enforces consistency, not a particular answer.
