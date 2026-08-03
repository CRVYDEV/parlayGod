# AUDIT — THE DESK (economy v3 steps 2–4)

*Point-in-time, 2026-08-03. Scope: `src/desk.js`, the recycle hook in `game.js:ledger`, the desk's
terms in `src/invariants.js`, the reserve-backing terms in `src/vig.js`, the mod routes and the
worker wiring. Four lenses: §10.4 and the desk identities; locks, concurrency and persist-clobber;
the ETH accounting, the comp gates and the four walls; exploit and grief.*

**Why this pass:** steps 2–4 are the newest real-value surface in the project — a mint reason, a
withdrawal-reserve credit, an oracle on the path, and a shelf that sells to players for ETH.

**Result: no CRITICAL, no HIGH. One finding (F1, LOW), fixed and mutation-verified.**

---

## Read this first: most of this pass was run against a STALE CHECKOUT

The local HEAD was four commits behind `origin`, and I did not check before starting. So the file I
audited was `131b6c0`, not what is deployed.

The consequence was not academic. I found, reproduced live and fixed what looked like a MED — a mod
comp buyback (no `txHash`) crediting `chain_reserve.funded_omr`, minting `desk:buyback`, and passing
every check, because `runDeskInvariants` compared the mint against the `desk_buys` row the comp had
just written and the Vig's `deskToReserve` counted that same row as its own backing. **All of that
was already fixed at `origin`**, in a commit whose base I had lost:

```js
const real = !!txHash;
…
if (real) {
  await client.query('UPDATE chain_reserve SET funded_omr = funded_omr + $1 … ');
}
```

…paired with `deskToReserve` counting `desk_buys WHERE real` only. **The shipped fix is also better
than the one I wrote.** Mine refused the whole call without a `txHash`; the shipped one gates the
reserve credit alone and lets a comp still stock the shelf, which is correct and is argued in the
code: the shelf credit is soft supply inside `omrBuckets` and QA needs inventory to test the sell
side, whereas `chain_reserve.funded_omr` is what `signVoucher` reads before signing a real on-chain
withdrawal, so crediting it *asserts that hard OMR arrived*. That is the line a comp must never be
able to cross, and it is drawn in exactly the right place. My version was discarded.

**The lesson, which is the same one this session recorded twice already: check the base before
auditing anything.** A stale checkout does not fail loudly — it produces a confident, reproducible,
well-evidenced finding about code nobody is running.

What follows is what survives on the real HEAD.

---

## F1 (LOW) — the desk going dark reached a log line and nothing else

The anchor is fail-closed: no price print, or one past `ORACLE_MAX_AGE_MS`, and no auction opens, in
either direction. That is correct and deliberate. It is also the desk's entire revenue mechanism
stopping — "revenue ≈ sink volume × price" goes to zero — while every §10.4 check stays green,
because nothing is wrong with conservation when nothing trades.

`openAuction`'s `stale_price` / `no_price` result was logged hourly and routed nowhere. A line
repeated every hour forever fails the same way silence does: nobody reads it. This project has built
this watchdog twice already — the WAL archiver and the bond-oracle keeper — and both route to
`alertDrift`, latched per episode, for exactly this reason.

**Fix:** a third sibling, same latch discipline. `no_lot` and `already` are NORMAL (a quiet sink day;
a second tick inside the same day) and never alarm. The regression is a labelled source tripwire —
the worker's loop is not unit-drivable — and it catches the realistic regression, which is renaming a
reason in `desk.js` and orphaning the watchdog silently. Mutation-verified: downgrading the alert to
a no-op fails by name.

---

## Verified clean

- **§10.4 across all three flows.** A recycle nets zero (the sink's −X and `desk:recycle`'s +X both
  ride the burn term; the value lands in the `desk_inventory` bucket). A sale nets zero (shelf and
  account are both inside `omrBuckets`; `desk:sale` is in neither term). A buyback moves both sides
  by the same amount. `desk:sale` and `desk:buyback` match no `SINK_REASONS` pattern, so neither
  leaks into the burn term.
- **The recycle's sign convention.** `desk:recycle` is written POSITIVE (`back = -amount`), which is
  what makes `lotSize`'s `returned` sum and the board's `recycledToday` read correctly. A negative
  convention would cancel in the burn term just as well and make the auction never open — a plausible
  wrong turn that was not taken.
- **Wall 2 (never sells what it does not hold)** holds by construction: one clamped subtraction,
  `min(want, lot remaining, shelf)`, with the shelf locked. Nothing else in the tree decrements
  `desk_inventory.balance`.
- **Wall 4 (never mints to buy back)**: the budget is `pol_fees` minus `desk_buys`, read under the
  shelf lock so two concurrent buys cannot each see the whole of it, and a comp books ZERO fees.
- **The Dutch clock** is clamped at both ends, so a late or early call cannot quote below the reserve
  — and the reserve IS the band's sell edge, so "will not clear below the band" is enforced by the
  clamp rather than by a second decision somebody could forget.
- **The 48h vest needs no timer**: a `desk:sale` credit is a positive $OMR row, and `tax.js`'s FIFO
  replay already prices it at the full early-exit surcharge. Asserted in the suite, not assumed.
- **Lock order** accounts → `desk_inventory` → `desk_auctions`, with the buyback taking
  `desk_inventory` → `chain_reserve` beneath it. The recycle path holds the account (or the gang row,
  for reserve-funded sinks) before touching the shelf, and nothing takes the shelf before an account,
  so there is no AB-BA against the ~60 sinks that feed it.
- **Idempotency** on `ref` for fills, fee episodes and buys, using the SELECT-then-INSERT idiom the
  sell-tax ingest documents (pg-mem does not report a suppressed conflict's rowCount), with a 23505
  fallback for the concurrent case.
- **Player reach:** none. Every mutating desk route is mod-gated; `GET /v1/desk` is a public read.

## Flagged, not changed

- **The anchor is somebody else's cadence.** `bandAnchor` reads the latest `vig_buyback` price print,
  so the desk's ability to trade at all depends on the Vig's buyback continuing to run. That is a
  deliberate single-oracle design, and F1 now makes a halt audible — but it is worth stating plainly
  that two revenue systems share one heartbeat.
- **The shelf clamp is currently unreachable** (the lot is already `min(…, shelf)`, and the shelf
  only falls by what that lot sells). Worth keeping as defence in depth; worth knowing it is not
  exercised by the happy path.
