# OMERTÀ — Vendettas & Blood Feuds (design)

**Status: building.** Every death gets a story hook. When a street is killed by another PLAYER's
hand (a fire kill — not NPC contractors, not mods), the victim's heir inherits a **vendetta**
against the killer's bloodline. Rides the existing `kill_log` (account×account) and the estate;
adds ZERO new money flows — §10.4 untouched by construction.

## 1. The vendetta (account → account, one active per pair)

Created in `runEstate` when the death was a player fire-kill: `(avenger_account =
victim's, target_account = killer's, sworn = the dead street's name, expires = now +
VENDETTA_TTL_MS (7 days))`. A repeat kill refreshes the clock. The heir is notified at birth
("you owe blood"); active vendettas ride the character view (`vendettas: [{name — the target
bloodline's CURRENT street, sworn, expiresSeconds}]`). Because it binds ACCOUNTS, it survives
both sides' deaths — the debt passes down both bloodlines until settled or lapsed.

## 2. What a vendetta grants (status + access, never money)

1. **Settlement** — the avenger's bloodline fire-kills the target bloodline's current street
   inside the window: the vendetta is SETTLED. The kill pays `VENDETTA_REP_BONUS` (2×) feared-rep
   — and the bloodline-diminishing rule still applies, which is the anti-farm by construction:
   a FIRST revenge (1 prior kill against you → ÷2) nets exactly full base rep (2×/2); mutual
   kill-trading decays from there (2/3, 2/4…), so two accounts can't ping-pong rep forever.
   The multiplier does not stack with a directed contract's 1.5× (the larger applies). Settlement
   hits the public streets feed (`vendetta_settled`) and returns `vendetta: true` on the kill.
2. **Vengeance is exempt from the premium** — posting a DIRECTED contract on your vendetta
   target waives `DIRECTED_MIN` (the $10k exclusivity floor): any pot ≥ `BOUNTY_MIN` may name a
   hitman. Your money, your blood debt — the board takes vengeance at street rates. (The 2%
   take still applies; the house always wins.)

## 3. The blood-feud ledger — `GET /v1/feud/:characterId`

The public tally between MY bloodline and theirs, read from `kill_log`: kills each way, net
`bloodOwed` (positive = they owe us bodies), and any active vendetta in either direction. This is
the "the Fabrizis owe the Morettis two bodies" surface — pure reader, no new state.

## 4. Guardrails
- NPC hits and mod-kills never create vendettas (no killer street to swear against — and an NPC
  hit's payer stays anonymous).
- The rep bonus still requires the target ≥ `HITMAN_MIN_TARGET_LVL` and still excludes agents —
  all existing anti-farm floors hold; the diminishing interplay above closes the mutual-farm loop.
- Expiry is lazy (reads filter, the worker sweeps); a lapsed vendetta grants nothing.
- Numbers (`VENDETTA_TTL_MS` 7d, `VENDETTA_REP_BONUS` 2×) are founder sign-off levers — both pure
  status-axis, outside the signed economy.
