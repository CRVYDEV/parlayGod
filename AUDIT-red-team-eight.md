# AUDIT — RED TEAM #8 (2026-08-17)

**Scope.** The eighth max-effort pass. RT#7's thesis was that the shape these reports keep leaving open
is *a class this project has already established, applied where it was discovered, and never swept to
its edge* — so this pass aimed at three more of those, plus the one question nobody had asked directly:
**can the §10.4 alarm actually fail?**

**Method.** First-hand throughout; no fan-out. Nothing was called a finding before it was reproduced
against a running engine, and nothing was fixed before it was reproduced. Two of the lenses needed a
**booted server driving real routes** (a stored-XSS sweep and a prototype-key sweep are both about what
reaches storage, which is not answerable by reading the handlers), and the contract lens needed a **real
Foundry VM**, because a contract's shipped behaviour cannot be reasoned about from prose.

**Result. No CRITICAL, no HIGH. Three findings (one MED, two LOW-MED), three lenses clean.** Seven
mutations, each failing at its own named assertion.

---

## F1 (MED) — an object index is not an allowlist

`if (!CATALOG[userInput]) throw` reads like a membership test and is not one. Every JavaScript object
inherits `__proto__`, `constructor`, `toString`, `valueOf` and `hasOwnProperty`, and **each of those
indexes truthy** — so the gate passes for exactly those five keys and the value flows on to whatever the
handler does with it.

Eleven such gates exist. Five take user input, and **two were live defects**, both reproduced by driving
the real route:

| route | key | before |
|---|---|---|
| `POST /v1/kitchen/module/:mod` | `__proto__` | **500** — reached the `lab_${modId}` COLUMN NAME |
| `POST /v1/mastery/trait/:trackId` | `__proto__` | **200**, and it WROTE `trait_id='__proto__'` |

The mastery one is the sharper of the two and it is not a 500 — it is silent, permanent data loss. The
level-50 trait is the capstone of an entire mastery track and is **once ever**; the write lands, the
`chosen` gate then blocks the real choice forever, and the trait that got stored matches neither
`virtuoso` nor `dynast`, so it grants nothing. A player who fat-fingers it — or an agent probing the API,
which this game invites — destroys the deepest reward in the Trades pillar and cannot undo it.

**Injection was never possible, and that is precisely what made the gate look adequate.** A quoted
payload is not a prototype key, so `KITCHEN.MODULES["x'; DROP TABLE characters--"]` is `undefined` and
the gate catches it — verified. Only the five inherited names get through, and none of them contains a
quote. So the reachable damage is a 500 and a bad write, not a database.

The other three (`business.SPECS`, `career.CHECKS`, `growth.CHECKS`) were saved by a *different* gate
happening to run first — a tier check, a catalog `.find()`. That is an accident, not a design, so all
five were fixed the same way: **`Object.hasOwn`**, which is the predicate the code meant all along.

### The guard

The class earns one because `CATALOG[key]` is an idiom, not a mistake — there are eleven of them and the
twelfth will be written by somebody who has not read this report. `test/gates.js` gained **THE CATALOG
LEDGER**: every gate must use `Object.hasOwn` or be waived with a reason that is a property of the key
(a numeric index into our own array, an integer column read back out of our own row, a route name the
server itself emitted). Six are waived; five are enforced.

**The extractor had to learn BOTH forms**, and getting that wrong would have been the vacuity trap in a
new costume: a scanner that only knows the *broken* shape stops counting a site the moment it is fixed,
so the guard shrinks silently to nothing as the tree gets healthier. It saw 6 gates before that was
fixed and 11 after.

---

## F2 (LOW-MED) — one poison stream starved the other ten, and bypassed RT#4's own fix

The worker's main tick fans out to ~60 jobs and isolates each with `safe()`. The **chain-sync tick** did
not: eleven watcher syncs, the stock delivery keeper and the two DEX bots all sat inside one try/catch
ending `} catch (e) { console.error('chain sync error', e.message); }`.

The consequence is the recorded failure mode one level up. RT#4 F2 had already found that an unbookable
fill wedged the DEX buyback and took POL pairing down with it, and fixed that by `safe()`-wrapping each
bot — **but an outer catch defeats an inner one it encloses**, so a throw in the *first* sync skipped
every job below it, the two individually-wrapped bots included. The fee stream wedges and the bond sync,
the deed transfers, the delivery keeper and both real-money keepers stop with it, every tick, quietly.

It is provable by control flow rather than by live repro (the viem source is built inside the worker's
own start block with no seam), and it is chain-dormant today — every branch is gated on an address env —
which is exactly why fixing it pre-mainnet is free.

**The fix has a second half that is easy to get wrong, and I got it wrong first.** `safe()` returns
`null` on failure, and eleven of these call sites immediately dereference the result (`c.processed`). So
the first version of the fix turned a *contained* failure into an uncontained `TypeError` in the very
next statement — landing in the same outer catch the wrap exists to avoid. Both halves are now guarded.

### The guard

`test/gates.js` gained **THE ISOLATION LEDGER**: inside the worker's main block, every awaited
`sync*`/`run*`/`sweep*` job must be wrapped in `safe()`, and every wrapped result must be read
null-safely. 76 jobs, all isolated.

The deref half is scoped from the binding to the read rather than to a single line, because a guard takes
four different shapes here (`if (r) …r.toWindow`, `if (s?.converted > 0) …s.season`, `arch && arch.state`,
and a deref inside an `if (oh && …) {` block) and a narrower rule reported all four as findings. Stated
scope limit: a deref that falls *outside* an earlier guard's block reads as guarded — the shape this
catches is bind-then-deref, which is the one that shipped.

---

## F3 (LOW-MED) — six contracts hand ownership over in one step

Ten of the sixteen contracts inherit `Ownable2Step`; six inherited plain `Ownable` — `OMR`,
`OmertaHook`, `Alchemist`, `Transmuter`, `Denari`, `GenesisOracle`. **No reason is stated anywhere**;
it is an accident of authoring order, and the ten that are two-step are the newer ones. The
forgotten-sibling shape again.

Single-step `transferOwnership` to a wrong address is unrecoverable in one transaction. The owner is a
Safe in every case, so the realistic failure is not an attacker — it is a typo'd address that N signers
approve, which is precisely what a nominate-then-accept handshake exists to catch. **`OMR` is the one
that matters most**: its owner holds `setMinter`, the only mint in the system and its own emergency stop
(`setMinter(0)`), plus every sell-tax knob. Lose it and the minter can never be rotated or zeroed again.

**The deliberate escape hatch survives the change, which is what made it safe to make.** OMR's NatSpec
promises "the Safe can renounce ownership to freeze the configuration forever", and `Ownable2Step`
overrides `transferOwnership` and `_transferOwnership` but **not** `renounceOwnership` — so renouncing
still takes effect immediately, in one step. Both halves are now behavioural Foundry tests rather than a
claim: a nominee must accept, a typo'd nominee is still correctable, and renounce still lands at once.

Free to do now only because the third-party audit has not run; after it, the same change costs a
re-audit — the argument the bond fourth-slice and the cap-constructor fix were both made on.
**`test/docs.js`** now fails if a seventeenth ownable contract ships single-step.

---

## Mutation record

| # | Mutation | Result |
|---|---|---|
| M1 | un-isolate one chain sync | `worker job(s) run outside safe(): syncBondEvents()` |
| M2 | drop one `?.` on a wrapped result | ``safe() returns NULL … - b at line 445`` |
| M3 | revert `MASTERY.TRAITS` to a bare index | `a prototype key (__proto__) is refused like any other non-trait` |
| M4 | revert `KITCHEN.MODULES` to a bare index | `a prototype key (__proto__) is a clean refusal, never a 500` |
| M5 | revert a catalog gate, guard's view | `catalog membership tested by INDEX … mastery.js:76` |
| M6 | plant a waiver for a gate that does not exist | `catalog gate waiver(s) for a gate that no longer exists: gone.js:NOPE` |
| M7 | revert `OMR` to single-step `Ownable` | `CAUGHT: OMR.sol` |

Two notes worth keeping.

**M6 first appeared to survive, and the reason was ORDER, not the check.** Renaming a waiver removes
protection from a real gate, so the *bare-index* assertion fires before the stale-waiver one ever runs.
A stale-waiver check can only be verified by ADDING a bogus waiver, never by renaming a live one.

**M1's anti-vacuity floor was verified organically.** The first version of the isolation ledger anchored
on `export async function startWorker`, which does not exist — the ticks live inside a main-module guard
— and the floor caught it (`found only 1 job call(s)`) rather than passing over code it never read.

---

## Clean lenses

Recorded because a red team that publishes only its hits cannot be audited.

**1. Invariant vacuity — can the §10.4 alarm actually fail?** This is the check every other check leans
on, and nobody had asked it as a sweep. For each of the 31 checks emitted on an empty server, the
minimal violation it claims to catch was planted (a balance bumped with no ledger row; a ledger row with
no balance; a bogus reason; a fresh row under a retired reason; an extra car) and then undone.
**31 of 31 fired, and 31 of 31 restored.** A second probe crossed the emitted set against the `push()`
sites in the source: 31 declared, 31 emitted, so no check is silently skipped on a quiet server either.
The alarm is load-bearing, not decorative.

**2. Client stored XSS.** The console has no escape helper and 103 `innerHTML` sites, so its safety
rests entirely on write-time stripping (`cleanText`). Sixteen player-controlled string fields were driven
through their real routes with `<img src=x onerror=alert(1)>`; **14 of 16 reached the string guard and
0 stored raw markup** (the two unreached paths are covered by source, with their guards cited). The first
run of this probe was **vacuous and was rebuilt**: 11 of 13 fields bounced at a precondition (`level`,
`no_estate`, `no_club`, `no_target`, `omr`) without ever reaching the validation — the recorded RT#4
lesson, hit again. Recorded as a fragility rather than a finding: one missed `cleanText` on a new field
is stored XSS, and nothing in the tree would catch it.

**3. Interpolated SQL.** `pgquery` prepares 2,971 static statements and structurally cannot see the
interpolated ones. All **95 interpolations inside a query template** were enumerated and traced to their
assignment. Every one resolves to a placeholder list (`$1,$2,…`), a ternary over two literals, a
module constant, or an allowlisted column name — **no user string reaches SQL text**. The three that
build a *column name* from a request field (`boxing.js`, `stable.js`, `kitchen.js`) are each gated by a
catalog membership test first, which is what turned this lens into F1: the gates were right in intent and
wrong in predicate.

---

## Verification

- full suite **99 files ✅ / 0 assertion errors**
- `node tools/sim.js` — §10.4 **drift-0** across every check
- `forge test` — **305/305** (was 303; +2 ownership tests)
- `npm run pgquery` — **2971** statements parse and type-resolve on real Postgres
- `npm run pgcheck` — **43/43** on a **fresh** database
- `node --check` on every touched `src/` and `test/` file

**Process.** Six probe files written and deleted before committing. Every mutation ran on a scratchpad
copy (`cp` out, `cp` back), never `git checkout`, with uncommitted work in the same files.
