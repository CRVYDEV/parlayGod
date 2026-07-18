# AUDIT — The Pen (three-lens red-team)

A full-effort red-team over THE PEN (step one) and its interactions with the existing systems, with
special focus on the new lethal **jailhouse shank** vector. Three independent lenses ran in parallel:
(1) the shank / death / estate / PvP vector, (2) §10.4 ledger conservation + concurrency/locks, (3)
Pen internals + cross-system (jail sources, bust-out, the Law, safehouse/witpro/respawn). Every
finding was re-verified against the code before fixing. All fixes are in-commit with a regression per
fix; **suite 19/19 + sim drift-0** after.

## Fixed (verified defects)

**MED — a PROTECTED inmate could shank with impunity** (`pen.js` `shank`; internals lens). The
`payProtection` window is framed (code + design doc) as "the in-jail safehouse" — the analogue of the
street safehouse, which is a signed **shield, not a bunker** (P1.3: `safeHoused(ch)` actor-guards block
the safe player's OWN offense in `fire`/`jump`/`hitContract`). The shank checked `penSafe(victim)` but
had NO `penSafe(ch)` ACTOR guard, so a player could pay $15k, become un-shankable for 2h, and then
freely clear the yard with zero retaliation risk — exactly the bunker abuse P1.3 exists to prevent.
**Fix:** `if (penSafe(ch)) throw 'safe'` early in `shank`, mirroring the street guards. Regression: a
protected attacker is turned away.

**MED — a shank BURNED open bounty escrow instead of paying it** (`pen.js` `shank`; shank lens). A
landed shank ran `runEstate` directly (like the hired `npcHit`) with no `claimBounty` — so an open
kill contract on the victim was destroyed as a `death:bounty` burn rather than paid. But a shank is a
DIRECT player kill (your own hand), which is the `fire` case, not the hired-NPC case: a random $5k
shiv burning a funder's $200k escrow (and a hunter's search) is a grief vector, and a contract killer
who gets their mark jailed and shanks them *should* collect. **Fix:** the shank now
`claimBounty(['hospitalize', 'kill'])` before the estate (like `fire`) — the wet work is paid, the
escrow isn't wasted. Cash only; still no loot/chop/feared-rep. §10.4-clean (a funder can't collect
their own pot — the `bounty_contributors` lock-out). Regression: a shank pays out a $100k open kill
contract to the shanker.

**LOW — `bribeGuard` treated `seconds: 0` as "unspecified"** (`pen.js` `bribeGuard`; §10.4 lens). A
client passing `{seconds: 0}` (a plausible UI default) fell through to "buy the whole sentence" — an
unexpectedly large charge (the ledger stayed exact, so a footgun, not drift). **Fix:** ABSENT
(null/undefined/"") means buy-it-all; an EXPLICIT non-positive/NaN value is a clean `seconds` 400.
Regression: `seconds: 0` is rejected.

**LOW — the yard roster showed furthest-sentence-first** (`pen.js` `penBoard`; internals lens).
`ORDER BY jail_until DESC` biased the board toward long-timers, hiding the more actionable
closest-to-walking rivals past the LIMIT 30. **Fix:** `ASC` (closest to release first). No security
change (the roster returns only id/name/level/gang — no sentences/cash/location).

## Verified CLEAN (negative results on record)

- **The shank vs `fire`/`npcHit`:** respawn ordering correct (skips the street bodyguard — not
  inside — but keeps the respawn token before the estate); persist-clobber clean (no raw SQL to the
  killer's row; `runEstate` gets `{killerCh}` so the `guarded_by`/witness-collapse relief mirror onto
  the in-memory killer); the shiv-consume writes `pen_contraband` (not the character row) and targets
  the killer while the estate wipes the victim's — no clobber, no race; gates re-checked under the
  `FOR UPDATE` lock (already-dead → clean `no_target`, no double-estate); `vendetta: true` swears the
  feud; NO rep is farmable (zero `awardHitmanRep` — a shank is -EV to farm).
- **§10.4:** every Pen cash movement is exactly ledgered with a `character_id` (`pen:work` faucet +
  `pen:commissary`/`pen:protection`/`pen:bribe` sinks → the `street_tax.pool` buffer, the
  `mod:confiscate` precedent); the shank moves no currency (contraband is ownership); `pen:` is in the
  cash vocabulary only; no input drives a mint or negative (`bribeGuard`'s `cut` is always `1 ≤ cut ≤
  left`; `workYard` floors at "just walked"); contraband uses correct absolute writes (the pg-mem INT
  quirk).
- **Sentence math / races:** `insideOnly` guarantees `jail_until` non-null + future; `accrue` never
  clears a sentence (only the Bureau raid SETS one); the gate + mutation are one locked txn (no
  lapsed-sentence TOCTOU); the heir is a fresh row (indicted_at/heat_exposure/pen_safe_until/witpro
  all default null — a RICO-jailed-then-shanked victim's Law state doesn't follow the bloodline);
  bust-out serializes on the victim `FOR UPDATE`; idempotency inherited from the global hook.
- **Locks:** solo actions `withCharacter` → `street_tax` singleton (characters → accounts →
  singleton, the global order); the shank `withTwoCharacters` touches no singleton; the roster read is
  unlocked read-only (the `/v1/gangs` precedent).

## Flagged for founder sign-off (NOT patched — ground rule #1)

- **`pen:work` faucet magnitude** — earning while jailed is new, but it's bounded (energy-gated + the
  sentence self-releases), so it's *more* bounded than crime; whether $200–600/15 energy is priced
  right is a balance lever.
- **A shank scores 0 war points** and applies **no NPC-standing consequences** (`bearGrudges`, the Doc
  rivalry) that a `fire`-kill does. Defensible as designed — a jailhouse shank is a quiet, dishonorable
  killing (no fixer glory, no public grudges, no war glory) — but whether the lethal-layer-decides-wars
  interlock and the "who you know remembers who you whack" system should reach the yard is a design
  call. Left as-is.
- **No `shoot_cd_until` analog** — the shank is soft-limited by energy (25) + the $5k shiv + the
  `KILL_ADD_S` sentence extension; a yard-clearing spree needs multiple simultaneously-jailed shivved
  rivals (rare). A per-shank cooldown is a cheap add if the founder wants it.

Net: no §10.4 drift, no persist-clobber, no double-estate, no reserve/escrow leak. Two MED
consistency defects (the protection bunker + the burned escrow) and two LOW hardening items closed
with regressions. `node tools/sim.js` + `npm test` green (19/19, drift-0).
