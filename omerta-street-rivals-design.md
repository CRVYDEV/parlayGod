# OMERTÀ — The Street War & The Rivals Ledger

*(founder-directed 2026-07-30: "Crimes should also directly target the assets of users at random —
PvP. For example Rob Player X's Laundromat. I also want the introduction of a Rivals system to track
crimes and players that have shown malice to you. Cars should be able to get stolen + all other
assets." The direction is the sign-off for the CLASS; every number below is a founder sign-off
lever.)*

## 0. The design constraint that makes this shippable

Every asset crime in this drop is a **redirect or an ownership move — never new emission**:

- Robbing a front takes a cut of its **PENDING income** — the audited shakedown/inside-job
  mechanism: the owner keeps the rest pending, the venue clock advances by only the stolen share,
  so total per-venue emission stays bounded by the SAME signed `incomePerHr` curve whoever banks
  it. §10.4-neutral by construction.
- Stealing a car moves a **row** — cars conserve by row count (the chop/pink-slip/market-seize
  precedent), no ledger row, no currency.
- The Rivals ledger moves **nothing** — pure intel over events the victim already witnessed.

So the drop adds ZERO faucets, needs zero invariant-vocabulary changes beyond one new reason riding
an existing prefix, and cannot widen the sim-audited balance. What it changes is WHO holds value —
which is the founder's intent: the streets should be able to reach your stuff.

## 1. Rob a front — "hit the register" (`business:rob`)

The shakedown's petty sibling, sharing ONE parameterized core (`extortFront` — the
resetFrontToNewOwner lesson: a copied block is how the sackEmpire rake-cursor drifted):

| | SHAKEDOWN (existing, signed) | ROB (new) |
|---|---|---|
| cut of pending | 30% | `RIVALS.ROB_RATE_BPS` **1500** (15%) |
| energy | 15 | `ROB_ENERGY` **8** |
| heat (win or lose) | 10 | `ROB_HEAT` **6** |
| contest | muscle + cunning/2 (extortion is muscle) | **cunning + speed/2** (robbery is stealth — a different build wins) |
| a failed attempt | health loss (security beats you up) | **JAIL** `ROB_JAIL_S` **300** (it's a crime — you get pinched) |
| ledger | `business:shakedown` | `business:rob` (rides the `business:` prefix — zero invariant change) |

**The shared per-venue window:** rob and shakedown both stamp and respect `businesses.shakedown_at`
(`SHAKEDOWN_CD_MS` 8h) — one PvP visit per venue per window whatever the verb, so total per-venue
extraction is bounded at max(30%) per 8h exactly as the signed shakedown audit assumed. Discovery:
the streets roster surfaces each mark's `fronts` as `{id, kind, name}` — EXISTENCE, never the books
(the anti-precise-kill-EV info rule; pending/scrutiny stay private to the owner).

## 2. Steal a car — grand theft, PvP (`stealCar`)

`POST /v1/streets/:targetId/steal {carId}` — withTwoCharacters, then the car row `FOR UPDATE`
(chars→cars, the races.js order). A WIN **transfers the row** to the thief (clearing
`race_limit`/`pink_slip` — the AUDIT-street-races-step-two consent-bypass class, same as every other
transfer site) and stamps the victim's shield; a LOSS is jail (`THEFT_JAIL_S` 600) and the victim is
told who tried. Heat `THEFT_HEAT` 10 win or lose. Rng-audited.

**The contest — expensive iron protects itself:**
`p = clamp(BASE_P 0.35 + (cunning + speed/2)/STAT_SCALE 300 − sqrt(carVal)/ALARM_DIV 3000, MIN_P 0.05, MAX_P 0.7)`
— a $5k beater is very stealable (~0.45 for a mid thief), a $250k mid car ~0.3, an apex car floors
at 0.05 (alarms, garages, drivers). `CAR_THEFT_P` is a TEST-ONLY roll knob (the BUSINESS_RAID_P
precedent — never in production).

**Grief bounds (each one load-bearing):**
- **The thief's clock is the GTA clock** — a player theft consumes `gta_at` exactly like a street
  boost, so PvP theft is bounded by the same signed §7.5 pacing (no new farm cadence).
- **The victim's shield** — `characters.car_stolen_at` (direct-SQL): a player loses at most ONE car
  per `VICTIM_SHIELD_MS` (24h) to theft, however many thieves try.
- **Garage room** — a thief at `GARAGE_CAP` is refused (unlike a market win: theft is opportunism,
  not a purchase).
- **Excluded iron** — listed (Black Market) and pledged (loan collateral) cars are escrow-locked
  and cannot be stolen (the findCar discipline).
- **Victim gates** — level ≥ `VICTIM_MIN_LVL` (8, rookie protection — shared with rob),
  hospitalized off-limits, family omertà, witness protection.

## 3. THE RIVALS LEDGER — who has shown you malice

`rival_events (victim_account, aggressor_account, kind, detail, at)` — **ACCOUNT-keyed both sides**
(malice follows the bloodline: your heir remembers who robbed you, and the aggressor's heir carries
the name — the vendetta/dm_blocks posture; no character_id column, so the estate wipe never touches
it by construction). `recordRival` is best-effort under a SAVEPOINT (the collection_log discipline —
a failed intel write must never roll back a landed jump).

**The info-economy rule, load-bearing:** rivals records ONLY acts where the existing notify already
NAMES the aggressor to the victim — jump, shakedown, rob, car theft, hostile takeover, the inside
job, a fire-kill. It never reveals what the game hides (anonymous contracts, NPC-hit payers, taps
stay hidden; the $OMR peek/trace stay the only piercers).

`GET /v1/rivals`: aggregated per aggressor bloodline — total incidents, counts by kind, last
incident, and their CURRENT living street (name/level/district — resolved at read, the feud-ledger
pattern) for revenge targeting. Worker sweep drops rows past `RETENTION_D` (90). Console: **YOUR
RIVALS** on Wet Work (the malice board with jump/search/contract shortcuts) + a RIVAL chip on the
streets roster. Zero §10.4; zero teeth in step one (revenge pays through the EXISTING rails —
contracts, vendettas, duels — pointed at a name you now remember).

## 4. Roadmap (step two+, founder picks)

- **Trunk goods robbery** (ownership move, the convoy-hijack shape on foot).
- **Boat theft** at the docks; **racer/fighter sabotage** (pacing, not ownership).
- **Residents as marks** — give NPC residents fronts/cars so the asset-crime loop is live in an
  empty alpha (each needs its own recycle-only §10.4 reasoning, the population step-two rule).
- **Revenge teeth** — a rep/honor bonus for striking a recorded rival (the vendetta 1.5× shape) —
  a lever with real power, so its own sign-off.
- **Rival-aware surfaces** — the coach naming your newest rival; the Wire discounting intel on them.

## 5. §10.4 & balance record

`business:rob` joins the ledger as an attacker-character_id'd row under the existing `business:`
prefix — check (a) reconciles, no vocabulary change; the redirect is bounded by the signed income
curve (the shakedown argument verbatim, at half the rate on the same shared window, so the
per-venue extraction BOUND is unchanged). Car theft writes no ledger row and conserves cars by row
count. Rivals moves nothing. **No new faucet → no new sim probe**; the levers land in
`RIVALS.*` (rules tail), pinned in test/levers.js, tabled in BALANCE.md.

## 6. Step-one red-team note (2026-07-30, in-build)

Checked at build time rather than in a separate report (a step-one drop with mutation-verified
tests; the four lenses' findings were all absorbed into the build itself):

- **Locks**: `stealCar` = characters (withTwoCharacters) → cars `FOR UPDATE` — the races.js order,
  and cars are terminal leaf writes everywhere, so acyclic. `extortFront` = characters → the
  business row — the audited shakedown shape verbatim (one core, two verbs). `recordRival` is a
  leaf insert under whatever lock the action already holds; `rivalsBoard` is unlocked reads through
  the guarded client (the D1 tripwire); `sweepRivals` is a single unlocked DELETE.
- **§10.4**: proven in test/economy.js — a theft writes ZERO ledger rows and conserves cars by row
  count; the rob's `business:rob` redirect reconciles per character; the sim stays drift-0.
- **pg-mem lessons paid**: a SAVEPOINT-first recordRival silently recorded NOTHING (probe-once-cached,
  the logCollect discipline); `= ANY($1::uuid[])` returns zero rows (JOIN + JS dedup).
- **Mutations**: three, each failing at its own NAMED assertion — the rob rate, the consent-flag
  clearing on transfer, and the win-path recordRival (which first SURVIVED via loss-path rows until
  a pinned `COUNT(*)==1` was added right after the forced win).
- **Accepted (step-one posture)**: no revenge teeth (the ledger is memory; revenge pays through the
  existing rails), residents hold no fronts/cars yet (the asset-crime loop is player-vs-player until
  population step two), and the roster's `fronts` existence-only surface is the deliberate
  info-economy line.

## 7. Step two — BUILT (2026-07-30, founder: "Build step two")

All five §4 items shipped: **trunk robbery** (`POST /v1/streets/:id/trunk` — a goods ownership move
capped by the robber's free trunk space, 24h victim shield, jail on a miss), **boat theft**
(`POST /v1/streets/:id/boat` — docks-only, the CAR_THEFT p-curve with boat cost as the alarm value,
the SHARED vehicle shield + GTA clock, rendezvous flag cleared on transfer), **sabotage**
(`POST /v1/streets/:id/sabotage` — one random fit racer/fighter laid up, booked fighters untouchable,
12h shield), **residents as marks** (band-priced beaters counted into car conservation via
`rng_audit npc:car` grant/retire rows; sleepy-joint fronts at `FRONT_INCOME_BPS` of the catalog curve
realizing only through the rob/shakedown/inside redirects — the Sacking skips npc victims; dinghies;
recycle-only freight via the real `goods:buy` rail), **revenge teeth** (`RIVALS.REVENGE_HONOR` on a
net-owed strike, judged before recording, kills excluded) and **rival-aware surfaces** (the coach's
someone-moved-on-you rung off a 48h `loadOwned` window; the Wire's half-price rival tap). Five
mutations verified by name; sim P9.25 measures every marks ceiling (and sized `FRONT_INCOME_BPS`
1000→500 before ship); §10.4 drift-0. Remaining ideas (step three, founder picks): revenge teeth
with REAL power (a rep bonus — its own sign-off), resident-owned speakeasies/racers, and the
"always-PvP crime" variant flagged in BALANCE (converting the crime faucet into a transfer).
