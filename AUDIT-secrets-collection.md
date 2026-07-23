# AUDIT — Blackmail & Secrets + The Collection (founder picks #7 + #8)

Two independent red-team lenses over the drop (`src/secrets.js`, `src/collection.js`, the fifteen
touchpoints, routes, estate wiring, worker sweep), every finding re-verified against source before
any fix. **No CRITICAL, no HIGH.** §10.4 is exact across the drop: `secret:hush` is the audited
bodyguard/speakeasy-round taxed transfer byte-for-byte, `intel:dig` an enumerated $OMR burn under
the existing `intel:%` vocabulary, secrets hold **zero escrow** (a demand is just a number — the
estate DELETE, the sweep, and expiry all move zero value), and the Collection has **zero §10.4
surface** by construction.

- Lens A: §10.4 conservation / lock order / persist-clobber
- Lens B: exploit / grief / Sybil / info-leak / death / cross-system

## Fixed in-commit (regression per behavioural fix)

### MED-1 — `sweepSecrets` lock-order inversion (secret → char; everything else is chars → secret)
The deadline sweep locked the secret row FOR UPDATE **before** the mark's character row, while
`payHush`/`exposeSecret` (withTwoCharacters chars first) and `runEstate` (victim char first, then
the secrets DELETE) all acquire the other way. A buzzer-beating pay vs the sweep — or a fire-kill's
estate vs the sweep — was an AB-BA window (masked by the per-row txn + `contention` retry, but the
exact class AUDIT-sim fixed in the bounty sweep with "characters-before-pot"). **Fix:** the sweep
now locks the mark's char row FIRST (from the pre-scanned immutable `target_account`), then the
secret FOR UPDATE with a re-verify — the bounty-sweep pattern. The module's lock-order comment now
matches the code.

### F1 (LOW) — `collectionLeaderboard` counted raw log rows; the board counts catalog membership
An off-catalog `collection_log` row (a retired item, a future bad call site) would push a
leaderboard `have` above `total` (pct > 100%) and make the board and leaderboard disagree. Not
reachable today (all fifteen call sites pass server-validated catalog ids), but fail-open. **Fix:**
the leaderboard tallies only `(category, item_id)` pairs present in `collectionCatalog()` — board
and leaderboard now agree by construction. Regression: an injected bogus row is not counted.

### LOW-1 — `logCollect`'s try/catch could not deliver "never blocks the flex" in real Postgres
The insert runs inside the caller's live action txn at ~15 sites; in Postgres ANY errored statement
aborts the enclosing txn (25P02), so a swallowed error would leave the action's remaining queries
failing — the opposite of the comment's guarantee (and at the two worker sites — auction settle,
loan forfeit — a deterministic error would permanently fail that settle row). **Fix:** the insert
now runs under a `SAVEPOINT` with `ROLLBACK TO SAVEPOINT` on error; pg-mem can't parse SAVEPOINT,
so support is probed once and cached — there the bare insert runs (safe: pg-mem doesn't poison a
txn on a failed statement). ON CONFLICT keeps the dup path error-free in both engines.

### LOW-2 — `digSecret` logged a fake roll to `rng_audit`
The dig outcome is fully deterministic (the mark's real dirt, or disinfo hides it), but a
`Math.random()` was drawn and logged as if it decided the result — misrepresenting a deterministic
mechanic in the audit trail. **Fix:** the audit row now records roll 0 + a "(deterministic)" tag.

### LOW-3 — a $1–$2 demand made the holder's hush net ≤ 0
`extortSecret` allowed `demand ≥ 1`; with `ceil` on the two 1% takes, demand=1 netted the holder
−$1 (§10.4 still reconciled — purely self-inflicted — but the audited precedents floor their
prices). **Fix:** `SECRETS.DEMAND_MIN` ($100, a new sign-off lever, the BODYGUARD_MIN_PRICE
precedent). Regression: a $1 demand throws `amount`.

### LOW-4 — `runEstate` comment/code mismatch on `digs`
The comment claimed dig cooldowns *targeting* the dead account are deleted; only the dead
*digger's* rows are (the wipe loop). The persisting target-side cooldown is actually protective —
the heir shares the account, so everyone who just dug the dead street waits out the 24h before
digging the heir. **Fix:** comment corrected to state the intent (a bloodline-level throttle; the
7-day hygiene sweep reaps the rows).

Also added from Lens B's coverage-gap list: a **dead-holder board regression** (extort, mod-kill
the holder → the mark's `onMe` empties via the `alive` JOIN — the threat dies with the man).

## Verified clean

- **§10.4:** `secret:hush` mark −demand / holder +net, both character_id'd with counterparty,
  matching the in-memory deltas exactly; 1% tax → `street_tax.pool` (singleton locked LAST), 1%
  dev off-ledger — structurally identical to `visitSpeakeasy`. `secret:` in the cash vocabulary;
  `intel:dig` in both the omr vocabulary and the burn term; the burn sits after every gate (a
  gated-out dig can't burn); the empty-dig burn is the documented npchit-fee posture. The test
  proves delta-0 across the hush window.
- **Persist-clobber:** `heat_exposure` is in `persistCharacter`'s positional list — `exposeSecret`
  bumps it in-memory on the LOCKED second character (rides the positional persist); the sweep
  writes it absolutely under the char row lock. Double-expose impossible (every path FOR UPDATEs
  the secret and re-verifies existence; the race loser sees no row).
- **TOCTOU:** the routes' unlocked pre-resolve of the counterparty is fully re-verified under the
  locks (holder match, target match, demand set); a deleted secret / dead holder resolves to a
  clean `no_secret`. Demand integrity validated under the secret's FOR UPDATE; `payHush` charges
  the STORED demand — no negative/over-cap window.
- **Death both directions:** `runEstate` deletes `secrets WHERE holder_character OR
  target_account`; a dead holder's demand also drops off the board via the `alive` JOIN. The
  Collection is account-keyed and correctly ABSENT from the estate wipe (survives death by
  construction). `digs` is in the wipe loop; the 7-day hygiene sweep can never resurrect a
  cooldown.
- **Disinformation defeats the dig, un-pierceable** — checked before `juiciestSecret`,
  prospective-only (already-held secrets persist), consistent with the wire posture.
- **Banded-wealth rule holds** — `moneybags` reveals only a `bank ≥ $500k` boolean (surfaced only
  when there's no juicier dirt), coarser than the wire's wealth bands. No exact figure anywhere.
- **The hush is a strictly-worse collusion rail than existing ones** — 2% taxed like
  `bodyguard:hire` but ALSO capped at `hushCap` (≤$250k), one per secret per 7d, and requiring the
  mark to actually hold real dirt + be extorted first. Not a new untaxed pipe.
- **Boards:** flat queries + JS tally (pg-mem-safe), agents excluded, un-extorted secrets invisible
  to the mark (the layered info economy), top-20 bounded.
- **All fifteen Collection call sites** verified post-success inside the actor's own locked txn
  (the two worker sites hold the relevant char locks per their sweep disciplines); `logCarCollect`
  only reads — no new lock edges.

## Flagged for founder sign-off (NOT patched — ground rule #1)

1. **Expose-without-extort is instant** — a holder can dig then immediately expose, no pay window.
   Bounded and judged intended (real dirt required, 10 $OMR per digger, one per holder per target,
   24h dig cooldown; a 5-ring day tops out at 125 exposure vs `INDICT_AT` 3000 — doesn't even reach
   "watched" from clean, and only bites actual criminals). The `exposeHeat` set (12–25) is the dial.
2. **A late-window extortion can expire quietly** — extorting inside the last 24h of the 7-day TTL
   can let `expires_at` pass before the deadline sweep fires, so the threat evaporates without the
   exposure. Self-inflicted (the holder controls timing); TTL-bounds-everything is the intent.
3. **No actor gates on secrets.js** — dig/extort/expose are remote surveillance (the Wire posture);
   `payHush` moves cash from lockup/a safehouse where the cash-moving siblings gate. Paying hush is
   defensive, not offense/extraction, so D2/P1.3 arguably don't apply — founder taste call.
4. **`payHush` accepts a payment after the deadline but before the sweep tick** — benevolent;
   no double-resolution is possible (pay deletes the row; the sweep re-verifies under FOR UPDATE).
5. **Multi-holder demand stacking** — MAX_HELD/one-per-target are per-holder, so five diggers can
   each hang a demand on one genuinely-dirty mark. Each paid 10 $OMR for real dirt; the pressure is
   the point. `MAX_HELD`/`DIG_OMR` are the dials.

## Remaining test-coverage notes (non-blocking)
Not yet exercised: 5-holder simultaneous stacking, extort-then-instant-expose timing, the
near-TTL quiet expiry, the `moneybags` kind path. All are behaviorally specified above; add on the
next touch of the module.
