# Economy v3 — finishing wall 1: re-source the mission ladder off the desk's shelf

*Founder-directed 2026-08-03 ("re-source it"). Design only — NOT built. Every number and line
reference below was verified at source on the day this was written, not recalled.*

---

## What wall 1 says, and the two mints that survive it

`omerta-economy-v3-design.md` §9.1's first wall is **no faucet: zero mint reasons that pay a
player**. That is what makes "extraction ≤ inflow" an identity the ledger *exhibits* rather than a
constraint the full-reserve queue has to *enforce*.

`src/invariants.js:255` defines the mint set exactly:

```sql
reason LIKE 'mission:%' OR reason='prize:omr' OR reason LIKE 'emission:%' OR reason='desk:buyback'
```

- **`emission:%`** — retired in step 1, and the `emission faucet retired` check asserts it stays zero.
- **`desk:buyback`** — credits the SHELF, never a player. Paired with hard OMR entering the reserve.
- **`prize:omr`** (`src/vig.js:180-183`) — pays a player, but it is **backed**: bounded by the prize
  pool the Vig bought with real revenue, and the same amount moves to the withdrawal reserve in the
  same transaction. Structurally the argument the code already accepts for `desk:buyback`. It
  violates wall 1's *wording*, not its *intent*. **Leave it. Document it.**
- **`mission:%`** — the genuine one. Unbacked, and it pays a player.

## The measurement

Nine missions pay $OMR, **220 total, once per ACCOUNT, ever** (`mission_omr_claimed`,
`src/growth.js:137-139` — per-account rather than per-character precisely so an heir cannot re-mint
it):

| level | id | $OMR | mission |
|---|---|---|---|
| 14 | m4 | 5 | The Dockside Heist |
| 28 | m16 | 5 | The Insurance Job |
| 32 | m6 | 10 | The Long Con |
| 40 | m27 | 20 | Pure |
| 50 | m19 | 15 | The Judge's Calendar |
| 60 | m8 | 25 | The Velvet Coup |
| 70 | m28 | 60 | The King of Appetites |
| 75 | m22 | 30 | One Perfect Season |
| 100 | m24 | 50 | The Hundred-Year Deed |

> **SUPERSEDED 2026-08-10 (the mechanism, not the conclusion).** The mint is now **ETH only** —
> `payPlex('mint')` refuses and there is no `PLEX_MINT_OMR`, because minting is the Sybil bound and
> the extraction gate, so it gets one rail at one published price. The free path did not go with it:
> **m4 now GRANTS a mint credit outright** (`reward.mintCredit`), which is a stronger promise than the
> price-match below — it is a FACT rather than an arithmetic coincidence between two numbers that
> could drift apart, and it stays true at any token price. The paragraph is kept because the reasoning
> is why the free path had to survive the retirement at all.

**The first rung was load-bearing.** `PLEX_MINT_OMR` was 5 (`src/vig.js:29`) and m4 paid exactly 5 at
level 14. That is not coincidence — `src/game.js:1139` is a coach rung reading *"You can get made
for free … you can pay for it with $OMR you earned in game (5 $OMR), not just ETH. Earn it on the
mission ladder: 'The Dockside Heist'."* **The mission mint IS the free path to being made**, which
is the answer to the tester who asked "we can't earn OMR in game anymore?". Retiring it outright
would retire that answer; re-sourcing keeps it.

## The lie this uncovered (fix as part of the build, not before)

`docs/WIKI.md:178-183`, mirrored into the served `public/wiki.html`, tells players in bold:

> **Nothing you do in the game creates $OMR.** There is no wage, no yield and no drip … the game now
> has no printer at all. Every $OMR in the city was **bought with real money** by somebody … A
> nightly job asserts that no new $OMR appeared, so this is a fact you can check rather than a
> promise.

Today that is **false** — the ladder mints 220 per account for playing — and the last sentence is
the worst of it: the nightly check (`emission faucet retired`) asserts only that `emission:%` is
zero. It does not cover `mission:%`. **The docs point players at a proof that does not prove the
claim**, while the game's own coach teaches them how to create $OMR.

Do not fix the copy before the mechanic. After re-sourcing the claim becomes true as written, so
patching it now would only have to be un-patched.

---

## The build

### 1. `desk.js` — a shelf payer

Export `payFromShelf(client, accountId, want, reason)`. Mirrors `fillAuction`'s sale
(`src/desk.js:195-208`) exactly:

```
lock desk_inventory FOR UPDATE
paid = min(want, balance)
UPDATE desk_inventory SET balance = balance - paid, lifetime_paid = lifetime_paid + paid
one ledger row: (accountId, 'omr', +paid, reason)
return { paid, short: want - paid }
```

**Lock order is already correct and must stay so**: `accounts → desk_inventory` (`desk.js:48-52`).
The mission claim runs inside `withCharacter`, which already holds the character and account rows,
so taking the shelf after is in order. Taking the shelf *first* anywhere would be an AB-BA against
every sink in the game.

**Do not write `account_persistent.omr` by SQL here when called from inside `withCharacter`** — the
account row is persisted from memory and a direct write would be clobbered. The caller adds to
`h.acct.omr`; this function only moves the shelf and writes the row. (`fillAuction` writes SQL
because it runs standalone with its own COMMIT. Different context, different rule.)

### 2. `growth.js` — spend the shelf instead of minting

At `src/growth.js:136-144`, replace the mint with `payFromShelf(..., 'desk:mission')` and add
`h.acct.omr += paid`.

**Keep `mission_omr_claimed` inserted unconditionally**, and owe the shortfall — see below. Do not
gate the claim on the shelf: a mission is once-only (`missions_done`), so refusing the $OMR leg
would destroy the reward permanently.

### 3. The dry shelf — owe it, never lose it

On day one of an alpha the shelf is EMPTY, so without this the free path is dead exactly when it
matters most. Use **the pass-stipend pattern verbatim** (`src/pass.js` — it exists, is audited, and
solved this identical problem): accrue the shortfall as `account_persistent.mission_omr_owed` in the
SAME transaction as the claim, and add a worker sweep that pays owed balances down as the shelf
refills. A dry shelf must never fail the claim.

**Operationally**: seed the shelf at launch with a mod call, and say so in DEPLOY.md. Otherwise
every early player is owed rather than paid, which is correct but feels broken.

### 4. §10.4 — three notes, one of them a trap

- **`desk:mission` needs NO vocabulary change.** `'desk:'` is already a recognised omr prefix
  (`src/invariants.js:78`), and the reason appears in neither `omrMints` (:255) nor the burn term —
  so it is a **transfer by construction**, exactly like `desk:sale`.
- **THE TRAP: `mission:%` must STAY in `omrMints`.** Historical rows really were mints. Reclassifying
  them would drift conservation on any live database by the entire historical mission volume. This is
  the step-2 recycle lesson in its second costume: the old reason keeps its meaning, the NEW payments
  use a new reason.
- **`desk inventory backed` must be extended.** It currently asserts
  `balance == lifetime_in + lifetime_bought − lifetime_sold` (:303). Adding a drain without adding
  its accumulator BREAKS it — hence `lifetime_paid`, subtracted there, plus a
  `desk mission payouts ledgered` check (`lifetime_paid == Σ desk:mission`) mirroring
  `desk sales ledgered` (:319). Two checks because they fail differently: the balance can drift from
  its own books, and the books can drift from the ledger.

### 5. Make the nightly claim true

Add the `emission faucet retired` twin: **no `mission:%` row inside the last day**. That is what
turns the wiki's "a fact you can check rather than a promise" into a true sentence. It will fail
until step 2 lands, which is the correct ordering.

### 6. Copy

Only after the above: `docs/WIKI.md` and `public/wiki.html` become true as written. The coach rung
at `game.js:1139` still works — it should, because the player still earns 5 $OMR from The Dockside
Heist; it just comes off the shelf now.

---

## Mutations that must fail by name

1. `mission:%` dropped from `omrMints` → conservation drifts by the historical volume.
2. `lifetime_paid` not subtracted in `desk inventory backed` → the shelf drifts from its books.
3. The shelf decrement removed while the credit stays → `desk mission payouts ledgered` fires.
4. The owed accrual removed with a dry shelf → the player silently loses the reward.

## What this does NOT fix

`prize:omr` still pays a player. It is backed and bounded, so the honest resolution is to restate
wall 1 as *"no UNBACKED mint reaches a player"* and let the Vig's two-sided reserve-backing pair be
the proof — not to pretend the mint is not there.
