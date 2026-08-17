# AUDIT — the third max-effort red team

**Date:** 2026-08-17
**Base:** `43b2fa8` (PR #65 merged — the second red team's seven fixes)
**Method:** first-hand throughout. Nothing was called a finding until it had been reproduced against a
running engine. Nothing was fixed before it was reproduced.

**Result: no CRITICAL. One HIGH, two MED. Three lens sweeps came back clean and are recorded as such,
because a red team that publishes only its hits cannot be audited.**

---

## Why these surfaces

The first two passes concentrated on the systems that were then newest — deeds, the pen, THE FIRSTS,
the hook, npcwar — and on the contract graph. This one was aimed deliberately somewhere else, at two
kinds of gap the previous reports leave open by construction:

- **Modules that appear in ZERO audit report.** `grep -l` across all eighty-odd `AUDIT-*.md` files
  returns nothing for `citywire`, `dexbot` or `stockdeliver`. Two of those move real value.
- **Classes the previous passes established but did not sweep to their edges.** The
  forgotten-gate class has produced more findings here than any other; `token_version` had been
  mapped to three of the four authenticated paths and not the fourth.

---

## F1 (HIGH) — a revoked token still opens a live websocket

**`src/server.js`**

There are four ways a bearer token is accepted: the `auth` preHandler, the guarded-mutation path,
`POST /v1/auth/x/start` (fixed by the previous pass), and the **websocket**. The first three check
`token_version`. The fourth verified the signature and read `status` — and stopped there.

Two halves, and each one defeated the other's remedy:

- `POST /v1/auth/logout-all` — the self-serve answer to *"someone has my session"* — bumped
  `token_version` and killed REST. **The thief's already-open `me` socket kept streaming**: every
  notification, every kill, every payday, indefinitely.
- `POST /v1/mod/revoke` **did** cut live sockets (`closeAccountSockets`) — but with no check at
  connect time, the same dead token reconnected immediately. One reconnect defeated it.

Reproduced end to end against a booted server: open a socket, call `logout-all`, watch REST 401 while
the socket stays up, then open a **second** socket on the revoked token and receive the hello frame.

**Fix — both halves, because either alone is defeated by the other:** the connect handler now carries
the `tv` claim through and closes `4008 token_revoked` on a mismatch, and `logout-all` cuts live
sockets exactly as `mod/revoke` already did.

**Regression** (`test/security.js`): the live socket opens; `logout-all` returns 200; the *already
open* socket is cut with 4008; REST 401s; a fresh socket on the same token is refused 4008; a
`mod/revoke`'d token likewise cannot reconnect.
**Mutations:** drop the connect-time check → *"a REVOKED token cannot open a new websocket"* fails.
Drop the `closeAccountSockets` call → *"logout-all CUTS the already-open socket"* fails (`0` vs
`4008`).

---

## F2 (MED) — the street deed name accepted homoglyphs, zero-width and bidi

**`src/deeds.js`**

`claimDeed` validated markup, length and case-folded uniqueness — and its own comment claimed it
validated *"like a living-street name"*, which it did not. **Every other name field in the game
carries the R8 guard `/^[\w .,'&-]+$/`.** This one did not.

It matters *more* here than on a display name, for three reasons specific to this asset:

1. `tokenId = keccak256(bytes(name))` — the name **is** the permanent on-chain identity. Two names
   that look identical to a person are two different tokens forever.
2. Uniqueness is `name_lc`, and case-folding does nothing to a Cyrillic `а`. Reproduced: with
   `Mulberry Row` already claimed, `Mulbеrry Row` (one Cyrillic `е`) claimed cleanly as a second,
   visually identical street.
3. The deed trades on a secondary market and real stock is deliverable into its vault. A buyer
   compares a name.

Also reproduced as claimable: a zero-width joiner inside a name, an RTL override, and emoji.

**Fix:** the R8 charset guard, with a message that says what is allowed.

**Regression** (`test/deeds.js`): the Cyrillic look-alike is refused; a loop refuses zero-width, bidi
and emoji; markup is refused *outright*; and `"St. Mark's Row & Vine"` still claims 200.
**Mutation:** drop the guard → *"a Cyrillic look-alike of a claimed street is refused, not minted as a
second identical one"* fails.

**A note on the regression, because the first version of it broke.** The pre-existing test claimed
`Nine <b>Fingers</b> Row` and asserted the stripped result. After the guard, that string contains `/`
and is refused — so the test failed. The guard was **not** weakened to accommodate it; the test now
asserts the stronger property, which is what the change actually buys: markup is *refused* rather
than silently mangled into a name the player never chose and can never change.

---

## F3 (MED-HIGH) — a staged delivery outlived its deed

**`src/stockdeliver.js`**

`stageStockDelivery` re-resolves the delivery target on every call — correctly — and then, on the
**duplicate** path, threw that answer away and returned the row as it stood. The keeper's claim
(`UPDATE ... RETURNING`) then read the **stale** `tba` off that row and sent there.

The window is ordinary, not exotic. A send that does not land leaves the row `pending` **by design**
(`send_failed` releases the claim so it retries), and a deed can be sold in that window.

Reproduced end to end: stage against deed 777, fail the send, sell 777 on-chain, extract 888, re-run
the keeper — and **real stock went to 777's vault**, which now belongs to the buyer. The seller's
allocation was marked delivered. Nothing anywhere reported a problem: the walls are denominated in
**units**, and *who received them is not a quantity*.

**This is the class the previous pass examined and dissolved** — and that write-up is still correct
about what it checked. It checked the *resend-within-window* path, where two independent walls hold
(the plan drops the account; `stageStockDelivery` refuses `no_target`). It did not check the
**re-target-after-a-sale** path, which re-enters the same pending row with a *valid* new target. Both
walls pass, and the row is stale.

**Fix:** refresh a still-`pending` row's target in place. Only `pending` — `delivered` is history and
`simulated` is a comp. An in-flight send is unaffected (it captured its address via the claim's
`RETURNING`), and only one send can ever land anyway (`StockVault.usedDeliveryId`).

**Regression** (`test/stockdeliver.js`): the held delivery goes out to the deed the account **now**
holds, never the one they sold, and the row itself is refreshed so the record matches where it went.
**Mutation:** drop the refresh → *"to the deed A NOW holds — never the one they sold"* fails, with
`0x…309` (777) against `0x…378` (888).

---

## Lenses that came back clean

### Lens A — persist-clobber

A mechanical sweep of `persistCharacter` (67 positional columns) and `persistAccount` (18) against
every `UPDATE characters ... SET` / `UPDATE account_persistent ... SET` in `src/`. Every overlap is
either headless (a third party's row, written under its own lock), a worker job in its own
transaction, or a direct-SQL column deliberately kept **off** the positional list. **No clobber.**

### Lens C — XSS on the public HTML/SVG surfaces

Thirteen keyless surfaces (`/u/:name`, `/beef/:a/:b`, the four card types and their `.png` twins,
`/v1/avatar/:seed`, the deed plate, the identity portrait, `/deed/:tokenId`) probed with
`"><script>1</script>` in every path segment and in `?ref`. **Every one escaped.** The portrait and
plate routes render untrusted player strings and both go through the shared `esc` from `cards.js` —
which is exactly why it is shared rather than copied.

### Lens D — `citywire`

Verified public-safe rather than assumed: every `WIRE` event type maps to a streets event the whole
city already sees, no formatter emits a dollar figure, an anonymous hit stays anonymous, `@everyone`
is unreachable because every name charset in the game blocks `@`, and the bus listener is idempotent
per process. **Clean.**

### Lens F — the Solana ed25519 leg

The design is sound: the challenge binds the account **and** a nonce, has a TTL, is consumed on
success, and the latch matches the base58 address **verbatim** (lowercasing would orphan an
allocation forever — the previous pass's M2). 256 hostile input pairs through `verifySolSig`:
**0 throws, 0 non-boolean returns, no false TRUE.**

---

## Flagged, not changed

- **A burned deed's ERC-6551 account still exists**, so `re-import → in-game sale → re-extract` hands
  the buyer whatever sits in that vault, and the in-game market has no on-chain visibility of it.
  Carried from the previous pass; the disclosure rail (`deedVaultRecord` / the buy-confirm live read)
  is the mitigation that shipped, and whether stock-bearing deeds should trade in-game **at all**
  remains a founder call.
- **`penSafe` and `inHole`** are now both scoped to the sentence; the remaining pen shields are
  bounded by their own clocks and were re-read here without a finding.

---

## Process notes

- Five probe files (`zz*.mjs`) were written and **deleted before committing**. The previous pass
  left a reproduced HIGH in an untracked scratch file for a whole session and found it only by
  reading `git status`; that is now a fixed step rather than a lesson.
- All four mutations were run on scratchpad copies (`cp` backup, `cp` restore), never `git checkout`,
  because uncommitted work was present in the same files.
