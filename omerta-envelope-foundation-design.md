# The Envelope & The Foundation — going-legit $OMR sinks on the Law surface

Two recurring $OMR sinks that buy **legitimacy** — the counterweight to the RICO antagonist
(`omerta-law-rico-design.md`). Founder-directed (2026-07-19). Both are **new levers on the Law
surface**, so every number is a founder sign-off lever (ground rule #1) — sim + BALANCE.md sign-off
before production. They are NOT retunes of any signed BALANCE.md surface.

They form a clean personal/collective pair — the Law-side answer to Estate (personal) + Auction
(competitive):

| | The Envelope | The Foundation |
|---|---|---|
| Scale | **Personal** (per character) | **Family** (per gang) |
| Theme | The standing graft you slip the cops | The charitable front that launders the family's reputation |
| Sink | `law:envelope` $OMR burn (account bucket) | `foundation:tier` $OMR burn (gang `omr_reserve` bucket) |
| Effect | Your investigation meter builds **slower** while paid up | Every family member's **conviction odds** drop at trial |
| Precedent | The lawyer retainer (a time-boxed window) | The family seal (sequential reserve-funded ladder) |

## The Envelope — "keep the envelope current"

A **proactive, standing** protection, distinct from the reactive one-shot `bribe` (which knocks a
band off an *already-hot* meter). Pay `LAW.ENVELOPE_OMR` (15) $OMR to keep the envelope current for
`LAW.ENVELOPE_MS` (7 days). While `envelopeActive(ch)`, the investigation meter's **gain** in
`accrual.js` is scaled by `LAW.ENVELOPE_GAIN_MULT` (0.5) — the cops bury half your file, so a case
builds at half speed. It is **not immunity**: a truly reckless player pinned at heat 100 still builds
toward an indictment, just slower (the "never a certainty" ethos — the safehouse/npchit precedent).

- Single touchpoint: the exposure GAIN term in `accrual.js` (the skills/decree modifier precedent).
  The BLEED is untouched.
- A **$OMR sink** (the game's late-game need), through the `spendOmr` till → `law:envelope` burn.
  Paying while already current extends from the later of now / the current end (the retainer
  precedent: pay twice → two windows).
- Gates: blocked while `jailed` (no reaching the beat cop from a cell) — but NOT safehouse-blocked
  (paying a standing arrangement is not the same as *meeting* a cop face-to-face, which is what the
  D2 bribe/launder gate models; the envelope is a wire, not a sit-down).
- Surfaced on `GET /v1/law` (`envelope { active, seconds, cost, gainMult }`) and the console Law tab.
- Route: `POST /v1/law/envelope`.

## The Foundation — the family charity

A tiered institution bought **sequentially** by the boss/underboss from the gang's `omr_reserve`
(the `buySeal` precedent, exactly). `FOUNDATION.TIERS` ladder (Community Fund 60 → Youth League 180
→ City Trust 500 → The Institute 1200 → The Legacy 3000 $OMR), each burn `foundation:tier` against
the reserve (counterparty = the gang id, no `character_id` — the seal burn precedent).

Two faces:
1. **Public philanthropy status** — `gangs.foundation` (int tier), a badge everywhere the family is
   shown (`me.gang`, `GET /v1/gangs`, `GET /v1/gangs/:id` incl. `nextFoundation`) + a status
   `GET /v1/leaderboard/foundation` (the hitmen/portfolio board precedent).
2. **Launders the family's collective RICO exposure** — the family's charity buys its members
   softer trials. The tier's `bustMult` (0.97 → 0.75) multiplies **every member's** conviction
   probability in `bustProbOf`. This is the ONE gameplay touchpoint; it has real power (not pure
   status), so — like the jury/retainer — it is a **Law lever**, not a signed-balance surface.

### Threading the tier into `bustProbOf`
`bustProbOf(ch, now, foundationTier = 0)` gains a third arg. It is sourced at the two call sites that
already compute conviction odds:
- **Online** (`lawBoard` display + `demandTrial`): from `h.owned.gang?.foundation` (the loaded gang
  row) — but `resolveBust` may run headless, so it queries.
- **Offline + online bust** (`resolveBust`, shared by `demandTrial` and the `sweepLaw` worker): a
  small `familyFoundationTier(client, ch.id)` lookup (`gang_members` ⋈ `gangs`) — the bust path is
  rare, so the extra query is cheap and covers the offline whale the worker force-busts.
- The `LAW_BUST_P` test knob still pins the roll deterministically (it bypasses `bustProbOf`
  entirely), so the Foundation's odds-effect is unit-tested through `bustProbOf`/`lawBoard`, not the
  forced roll.

The min-clamp floor in `bustProbOf` is unchanged, so the Foundation discount can reduce odds toward
that existing floor but never below it (a bounded discount that composes with retainer/jury).

## §10.4
- `law:envelope` → joins the `omr` KNOWN_REASONS + `omrBurns` (an account-bucket burn, like
  `law:jury`).
- `foundation:` → joins the `omr` KNOWN_REASONS + `omrBurns` (a gang-reserve burn; the reserve is
  already an `omrBuckets` bucket, so conservation stays exact with one new burn term — the seal
  precedent, zero formula changes to check (d) beyond the burn term).
- No new faucet, no new bucket, no cash movement. The Law only DRAINS — both features help
  extraction-≤-inflow.

## Tests
- `test/law.js` (envelope): the gain-mult modifier (a hot character builds exposure at half rate
  while paid), the $OMR sink (ledgered `law:envelope` burn, window extends on re-pay), the jailed
  gate, the board surface, and `spends == ledgered burns`.
- `test/social.js` (foundation): the boss-only rank gate, sequential Wax→…-style tiers with exact
  reserve deltas, the empty-reserve rejection, the badge on all three gang views, the leaderboard,
  the `bustProbOf` odds drop (a member's conviction odds fall with the family's tier), and
  `spends == ledgered foundation: burns`.

## Deferred (step two)
- Envelope: a per-district / per-precinct envelope (pay the cops where you *operate*); an
  agent-flagged premium.
- Foundation: bleed the family's members' heat passively (the accrual decay boost, sourced from the
  family tier — a second touchpoint); a philanthropy Commission-standing angle; naming the
  Foundation (a `vanity:`-style status burn).
