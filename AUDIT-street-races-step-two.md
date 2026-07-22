# AUDIT — Street Races step two (PINK SLIPS + NITROUS)

A focused three-lens red-team over the step-two drop (`src/races.js` `pinkSlipRace`/`buyNos`/`spendNos`
+ the NOS threading + the console + the four ownership-transfer sites it touches on): §10.4/conservation,
concurrency/locks/persist-clobber, and death/estate/PvP + cross-system exploit chains. Every finding
re-verified against source before the fix; a regression added. Suite 31/31 + sim drift-0.

**No CRITICAL/HIGH. One MED consent-bypass fixed in-commit (a pre-existing step-one class, amplified by
step two).**

## Fixed in-commit

**MED (cross-system, consent bypass) — the race flags survived an ownership change.** `listCar`
(`market.js`) rejects only a `listed`/`pledged` car — NOT a car with `race_limit` set (offered for a
cash wager) or `pink_slip` set (offered for pinks). And the FOUR car-ownership-transfer sites
(`market.js` buy-now + auction-settle; `loans.js` collateral collect + sweep-forfeit) cleared only
`listed`/`pledged` on transfer, leaving the race flags intact. So the exploit chain was: flag a car for a
$50k wager (or pinks) → market-list it (accepted) → a buyer buys it → the car arrives at the BUYER still
flagged, unlisted → it appears on the strip, raceable **without the new owner's consent**. The pinks
flavour is an unconsented car-LOSS window; the `race_limit` flavour (the pre-existing step-one class) is
worse — the new owner is exposed to a **cash loss up to a wager limit they never set** if a challenger
races their car and it loses. **Fix:** every ownership-transfer site now clears `race_limit=NULL,
pink_slip=false` on the `UPDATE cars SET character_id=…` (mirroring what `pinkSlipRace` already does on its
own transfer) — a bought or seized car is never on the strip until the new owner opts in themselves.
Regression: a car flagged for a wager + pinks, market-listed and bought, arrives with both flags cleared
and off the strip.

## Verified CLEAN (the deep lenses' negative results)

- **§10.4 / conservation** — a pink-slip race moves ZERO currency (a pure `UPDATE cars SET
  character_id`; cars conserve by ROW COUNT — no INSERT/DELETE, no boost/melt/fence/death event → the
  `car conservation` check is untouched; no `race:pink` ledger row exists). NITROUS is a character_id'd
  cash SINK on the existing `race:` prefix (`race:nos`) → the per-character cash check reconciles with
  ZERO `invariants.js` change; `spendNos` never mints power for a charge you don't hold
  (`Number(car.nos||0) <= 0` guard). The GARAGE_CAP bypass on a pink win is intentional (the
  market-win/collateral-seize precedent) and breaks no invariant (cap is enforced only in `buyCar`).
- **Concurrency / locks** — `pinkSlipRace` runs under `withTwoCharacters` (both char rows → both account
  rows, sorted) then locks the two CAR rows sorted `FOR UPDATE` — the SAME chars→accounts→cars order as
  `raceChallenge`; `races.js` is still the only `cars … FOR UPDATE` in the tree, so the order is acyclic.
  The opponent's car-ownership is re-read UNDER the car lock (a concurrent transfer would have needed the
  opponent's char lock, which we hold) — no TOCTOU. NOS writes on a car are serialized behind the OWNER's
  own `withCharacter`/`withTwoCharacters` char lock (only the owner touches their car's `nos`), so the
  absolute-write `cars.nos` can't be clobbered. Cars are never in `persistCharacter`'s positional column
  list → no persist-clobber (the SQL write is authoritative; the in-memory `h.owned.cars` push/filter is
  cosmetic for the response).
- **Death / estate / PvP** — `pink_slip`/`nos` are booleans/ints ON the car row (not pointers), wiped with
  the garage in `runEstate`; a car won via pinks is the winner's ordinary car, wiped normally on their
  death. No dangling-pointer surface. The two-party char locks serialize a pink race against the
  opponent's own actions (raceNpc/buyNos/death), so a car can't transfer out mid-action.
- **Exploit / grief** — a pink race requires the OWNER to `pink_slip`-list their car (consent) + the
  CHALLENGER to name their own staked car (consent, + a client confirm); no forced participation. The
  WHEEL credit keeps the `WHEEL_MIN_LVL` anti-Sybil floor on the LOSER (a pink win over a fresh alt earns
  nothing), and a pink loss costs a REAL car — self-limiting. A marked man can't warehouse via `pink_slip`
  (the flag doesn't lock the car — chop/melt/fence still work; only `listed`/`pledged` lock it). NOS can
  only be bought/burned on a car you own (`raceable`), and only the ACTOR's car is nitrous-boosted (the
  passive owner's is never touched without consent).

## Flagged (NOT patched — accepted / design calls)

- **Near-tax-free car transfer via a deliberate pink loss** — two consenting players can move a car's
  ownership for $0 (deliberately lose a pink race). §10.4-clean (cars aren't currency), and NOT a new
  path: the market already allows near-free car gifting (list at the minimum bid, the friend buys it — the
  2% take is on a tiny hammer price). Bounded by the variance risk + the per-driver cooldown. Accepted.
- **The PvE purse faucet + the casino:pvp collusion posture** — unchanged from step one (BALANCE.md flags).
  NOS adds a cash SINK, not a faucet, so it only helps extraction-≤-inflow.

Suite 31/31 + sim drift-0.
