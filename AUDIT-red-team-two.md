# RED TEAM #2 — game + contracts (2026-08-16)

The second max-effort pass, run immediately after `AUDIT-full-red-team.md` merged (`ca8505a`). Same
discipline, and it is the discipline that matters more than the lens list: **every candidate was
reproduced first-hand against a running engine before it was called a finding, and nothing was fixed
before it was reproduced.** That rule caught two false positives in the previous pass — one of which
had already had a fix written for it — so it is applied here without exception. Three of the seven
findings below were reproduced on **real Postgres** and one on a real `PoolManager` with a real pool,
because neither pg-mem nor reading can exercise them at all.

**No CRITICAL. Four HIGH, two MED, one LOW-MED** — three in the game, one in the contracts. Every fix carries a regression that fails *by name*
under mutation; the mutations were run on scratchpad copies, never by restoring from git.

---

## H1 — a street could be sold in the city and taken on-chain by the same man (HIGH)

`listDeed` refuses an on-chain deed. `requestDeedWithdraw` refuses a listed one. Both gates are
individually correct, and **neither could see the other**: `listDeed` read the deed row *unlocked*
(`loadDeed`) while `requestDeedWithdraw` read it `FOR UPDATE`. So the two interleaved — list read a
clean deed, extract locked it and set `onchain_token_id`, and list's later `UPDATE` wrote `sale_price`
on top of a row that was by then extraction-pending.

`buyDeed` then had no `onchain_token_id` guard, because that state was believed unreachable.

Reproduced end to end on real Postgres, driving both routes concurrently:

1. the deed ends up **both** listed and extraction-pending
2. a buyer pays **$500,000** and the deed row transfers to him
3. the seller still holds a **signed voucher** and claims the NFT
4. `markDeedExtracted` re-keys the row to `onchain:<token>` — and the buyer is left with **no street,
   no legend and no cash**, while the seller has both the money and the NFT

**Fixed in two places, deliberately.** `listDeed` now locks the row (same `characters → street_deeds`
order every other writer here already uses, so no new lock edge) — that closes the cause. And `buyDeed`
refuses a pending deed — that is the wall, and it belongs at the **point of disposal** rather than only
at the point of listing: a wall at the cause alone would trust that no future writer of `sale_price`
ever gets it wrong.

Re-run after the fix, the two serialise and extract correctly refuses `listed`.

## H2 — a revoked token could still bind an attacker's X identity to the victim's account (HIGH)

`POST /v1/auth/x/start` called `req.jwtVerify()` directly instead of going through the `auth`
preHandler. **A verified signature is not a usable token**: the preHandler is where the ban check and
the `token_version` revocation check live, and both were skipped here.

An authed start is an `upgrade` — it permanently binds an X identity to that account. So a token
already killed by `logout-all` (the self-serve response to *"I think someone has my session"*) could
still be used to take the account over for good. Reproduced: `GET /v1/me` answers `401 token_revoked`
while the OAuth start answers `200` with `purpose: upgrade` bound to the victim.

**Fixed** by checking status and `token_version` before honouring the binding. A dead token **demotes
to an unauthed start rather than 401ing** — a stale bearer left in localStorage must not lock a
returning player out of signing in.

## H3 — two worker sweeps leaked their pooled connection, permanently (HIGH)

Of 109 `pool.connect()` sites in `src/`, exactly two never released: the loops in `sweepNpcWars` and
`sweepFamilyAggro` — including three siblings a few hundred lines below them in the same file that do
it correctly.

A leaked pooled connection is **permanent and cumulative**, so the damage is not proportional to the
mistake. Measured on real Postgres at `max=3` with 5 due rows: three leaked, the fourth threw
`timeout exceeded when trying to connect`, and a following job then failed the same way. In production
that is the **worker going dark** — and the worker is the sole source of the nightly §10.4 sweep, the
drift alarm, the backup watchdog and every timed settlement. A dark worker is indistinguishable from a
quiet night.

**Fixed** with `finally { client.release(); }` in both, and — because this is a class, not two lines —
`test/gates.js` gained **THE CONNECTION LEDGER**: every `pool.connect()` in `src/` must release before
its enclosing function ends. It deliberately does *not* require the release be in a `finally` (some
sites legitimately hold across a job — the advisory-lock pattern), and it carries an anti-vacuity floor
so a broken extractor reports as a failure rather than as zero problems.

## H4 — the yard boss's protection followed you onto the street (HIGH)

`penSafe` gates `fire`, `jump`, `npcHit`, `shank`, the wanted-hunter and the NPC-family strike, and the
window was bounded only by the wall clock. `PROTECTION_MS` is 2h; a sentence can be minutes.

Reproduced: a 3-minute sentence, buy protection for **$15,000**, walk out, and `jump` and `npcHit` both
refuse `protected` — **while the mark pulls jobs freely**. Against the signed safehouse, which costs
$25,000 *minimum* for 4h and also stops you acting (the P1.3 "shield, not bunker" rule). The yard shield
was a cheaper safehouse with none of its cost.

Its sibling `inHole` **was already capped at `jail_until`** by an earlier audit for exactly this reason
— this one was missed.

**Fixed** at the shared predicate, so all eight gate sites inherit it. Scoping the *predicate* rather
than shortening the stored window keeps what a player paid for (re-jailed inside it, they are still
covered) while it can never reach the street. `payProtection`'s own actor guard still reads true inside.

## H5 — a free level-1 alt was a $48,000/day faucet (LOW-MED as cash; HIGH as a Sybil multiplier)

Claiming a deed is free and ungated **by design** — Phase 1 is pure status, and naming your street is a
good day-one moment. The corner take hung off it with no floor at all.

Reproduced: a brand-new level-1 account holding $500 claims a street for $0 and draws **$48,000/day** —
96× its starting cash, forever, for no play. Ten alts, $480,000/day.

Two things make it a defect rather than the accepted petty-faucet posture (cash is non-extractable
since the severance, so this is not a real-money hole):

- **the system contradicted itself** — level 8 to *muscle* a corner, level 1 to *own* one and collect
  from it, while every sibling income system carries a floor (speakeasy 15, business fronts 15, boxing
  8, port 6, races 3)
- **the sim's own model is wrong under it** — P9.37 sizes this as "ONE deed per account, linear in the
  playerbase", an assumption Sybil multiplication breaks

**Fixed** with `DEEDS.CORNER_MIN_LVL` (8, matching the shakedown) on the **money**, not the claim — so
a new player still names their street and builds its legend, and the take keeps accruing so nothing is
destroyed by waiting. Exactly the `LOAN.WANTED_MIN_LVL` shape: below the floor a defaulter is still
WANTED, just with no pool cash on his head. The board mirrors the till (`canCollect`), so the card can
never advertise a take the server refuses.

A new founder sign-off lever — pinned, and tabled in BALANCE.md.

## H6 — a shank thrown from a hospital bed (MED)

`shank` refuses a shank *on* a man in the infirmary ("They're in the infirmary — out of reach") and had
no gate on the **attacker** being in one. The actor gate is near-universal — boxing, business, casino,
convoy, deeds, duels and heists all carry it — and the game's most lethal verb was the one without it.

Reachable with no exploit at all: `sweepLaw` force-busts an offline player whatever condition he is in,
and a lost breakout is a beating. Reproduced.

**Fixed** beside the other actor gates.

## H7 — THE FIRSTS admitted scenery and bots (MED)

`claimFirst` excluded nobody. Every sibling status axis excludes NPC residents and agent accounts by
name — **including `mastery.js`'s own Trades leaderboard, which ranks the same achievement one rung
down** — and a FIRST is strictly worse to lose than a leaderboard place: a board position is re-taken
tomorrow, a first is **consumed and gone from the human game forever**.

Both halves reproduced. A **resident** took `mastery:wetwork` through a real duel (`duels.js` bumps the
winner's mastery headlessly when the passive lister wins) and the board reads `holder: <resident>`
permanently — expensive to drive on purpose, but a grief nobody can undo, held by a character the
server itself spawned and will later retire. An **agent** is the reachable half: agents are first-class
players who may automate 24/7, so they cross `MAX_LVL` long before a human. Reproduced with one crime.

**Fixed** — both still earn everything (xp, levels, ranks, their own agent board); they just do not
consume a one-per-server-ever trophy. One line to delete if an agents-vs-humans race is ever wanted.

## C1 — a fee could be armed into unset wallets, and the sweep then burned it (HIGH, contracts)

`OmertaHook.setSellTax` and `setAntiSnipe` both refuse while any recipient is `address(0)`.
**`setSurge` did not** — and the deploy order arms the surge *before* the wallets.

The consequence is not a missed payment. `sweep` is permissionless **by design** (a stalled Safe must
not strand fees) and `currency.transfer` to `address(0)` **burns**. Reproduced on a real `PoolManager`
with a real pool and a real swap: on a fresh hook with every recipient unset, the surge charged a real
fee, **4.75 ETH accrued, and a permissionless sweep sent every wei of it to `address(0)`,
irrecoverably** — from a hook the Safe had armed in the ordinary order, with nobody doing anything
wrong.

**Fixed in two places.** `setSurge` gets the guard its two siblings already had — that asymmetry is
what made it a bug rather than a design choice. And `sweep` refuses while a recipient is zero: a
reverting sweep leaves the fees where they are, recoverable the moment the Safe sets the wallets,
which is the conservative direction and the one guard that does not depend on having enumerated every
accrual path.

**The sweep guard is deliberately UNREACHABLE defence in depth, and the contract says so rather than
leaving a reader to wonder** — with all three setters closed and `setRecipients` refusing a zero, no
armed fee can accrue unwired. That is the desk shelf-clamp situation exactly: worth keeping, and worth
being honest that the happy path does not exercise it. The regression asserts the three setters
(mutation-verified: strip the surge guard and it fails) and asserts the unreachability rather than
faking a path to it.

**This one is also a process finding, and the worse half.** It was reproduced *in the previous
session*, left in an untracked `ZZRefute.t.sol`, and found only because `git status` showed an
untracked file before committing. The previous pass's own process note warned about exactly this
("a scratch file named to sort last is easy to leave behind, and one of them was the most interesting
thing in the pass") — and it happened again, on a HIGH, in an immutable contract that is in the
pre-audit batch. It was also silently inflating the Foundry count (301 vs SPEC's 300), which is how
close it came to shipping as a docs discrepancy instead of a finding.

---

## Verified clean, and recorded so the sweep is not repeated

- **the §10.4 reason vocabulary is complete** — every reason written anywhere in `src/` resolves under
  a `KNOWN_REASONS` prefix, and every omr/cash bucket is a member of its currency's set. *My own
  classifier reported 13 false orphans first*, from two bugs in the classifier: apostrophes inside
  comments broke its string-literal pairing, and it used exact matching where the real check uses
  `startsWith`. All 13 dissolved on a corrected re-run. **A finding produced by a tool you wrote and
  did not check is not a finding.**
- the shipment cap's agent/resident symmetry
- the DISPOSITION guard's documented scope limits (account-keyed tables are outside it *by
  construction*, not by omission)
- `markDeedExtracted`, `applyDeedReimport` and the recovery path all release their clients correctly

## Process notes worth keeping

- **A dirty database reads exactly like a code defect.** A probe failed on `name_taken` from a *prior*
  run's rows; the rule is a fresh database per run, and it cost time here for the second time.
- **`git checkout` to revert a mutation destroys uncommitted work.** Mutations were run on `cp`
  backups throughout.
- A duplicate `import` of `hospitalized` (already imported ten lines below) surfaced only at runtime —
  `node --check` after every import edit.
