# FIRST CONTACT + TONIGHT IN THE CITY (design)

Two founder-directed moves from the thin-gaps assessment. The game is a deep multiplayer built for a
population it has never met: the progression harness lands a plausible solo player at level 33 in a week
having never touched another human, and today a newcomer's FIRST contact with a real player is almost
always negative (jumped, robbed, contracted). These two moves fix the cold-start hook.

---

## MOVE 2 — TONIGHT IN THE CITY (`src/events.js`, `GET /v1/events`)

**The gap:** the game has genuinely anticipation-worthy SCHEDULED events — the boxing main event, the poker
tournament, the grand prix, the stakes, the futurity, the server-wide megaproject — but every one is buried
inside its own tab. Nothing tells a player "there's a title fight closing in 20 minutes, put money on it."
Retention lives on anticipation, and there was none a player could SEE.

**What it is:** a read-only aggregator of the OPEN scheduled events with their close time (or progress) and a
one-tap jump. `cityEventBoard(client)` runs a handful of cheap queries — each event system already has an
`open`/`booked`/`building` status + a `resolves_at` (or `progress`/`target`) — and returns a ranked list of
`{ kind, title, subtitle, closesSeconds | progress, tab }`. **§10.4-FREE by construction** — reads only, no
ledger vocabulary; the test proves it by counting zero rows.

**Sources (v1):** boxing main events (`boxing_bouts status='booked'`), the poker tournament
(`poker_tournaments status='open'`), the grand prix (`grand_prix status='open'`), the stakes
(`stakes_races status='open'`), the futurity (`futurities status='open'`), and the megaproject
(`megaprojects status='building'`, surfaced as a progress %). Each carries its pool/pot so a player sees the
size of what's on. All escrow windows, so a live pool is real money already committed — the "be there" hook.

**Surface:** a **TONIGHT IN THE CITY** strip near the top of Home (the returning-player command center), each
event a compact card with a live countdown + a jump to its tab. Deliberately hidden when nothing is open (the
empty-state honesty rule — never a dead "no events" card).

**Levers:** none — pure read. Deferred: the daily draws (numbers, the track card, the weekly fight) as an
"also today" line; a per-event "notify me when it's closing" ping.

---

## MOVE 1 — THE MENTOR (`src/mentor.js`, the positive first interaction)

**The gap:** the ROLODEX lets a newcomer FIND people and crews let them GROUP, but nothing gives two
strangers a reason to help each other in session one — and the first real-player contact is almost always
someone TAKING from them. There is no positive-sum first handshake. THE MENTOR is that handshake: a veteran
takes a newcomer under their wing, ASYNC (an offer + an accept, never real-time matchmaking — a low-pop game
cannot do sync matchmaking, which is the very cold-start we're solving).

**Why async + why status-weighted:** a mentor tie forms whenever both are online at different times (offer →
accept). The mentor's reward is primarily STATUS (a `proteges_raised` legend + a leaderboard), because in
THIS game status boards ARE the endgame motivator (City Standing, hitman rep) AND status is Sybil-proof by
the game's own posture — no payout attaches, so farming alts as protégés buys the mentor nothing. That keeps
the interaction pure positive-sum with almost no farm vector.

**The flow:**
- A newcomer (`level ≤ PROTEGE_MAX_LVL` 10, no mentor yet, human) flags `seeking a mentor`
  (`characters.seeking_mentor`, the LFG pattern — direct SQL, dies with the street; a fresh heir isn't
  seeking until they say so). They surface on the discovery board's newcomers/seeking list.
- A veteran (`level ≥ MENTOR_MIN_LVL` 20, human) offers (`POST /v1/mentor/offer/:characterId`) → the newcomer
  is notified. Gates: target is a seeking newcomer, no existing mentor, not self, not the same account, the
  veteran's active-protégé cap (`MENTOR_ACTIVE_MAX` 3). The crew-invite discipline.
- The newcomer accepts (`POST /v1/mentor/accept/:mentorCharacterId`) → the `mentorships` tie forms (account-
  keyed, PK on protégé — ONE mentor ever; survives death), both notified ("X took you under their wing" /
  "Y accepted"). Anti-Sybil the REFERRAL posture: agents excluded at both ends, same-account blocked,
  same-IP FLAGGED (telemetry, not blocked — the shared-house/dorm case is legit).

**The rewards (mutual, bounded):**
- **Protégé** — an onboarding CASH bonus at level milestones 5/10/15 (`mentor:protege`, the onboarding-faucet
  pattern: character_id'd, once-ever-per-milestone via a `claimed_mask`, level-real). Small
  (`MENTOR_MILESTONES` ~$2k/$4k/$6k = $12k lifetime), bounded by real leveling × once-ever, so the total
  faucet is ≤ $12k × (new accounts that reach level 15 WITH a mentor) — petty and self-limiting (the
  onboarding/career faucet scale). A **founder sign-off lever**, sim-probed.
- **Mentor** — STATUS ONLY: `account_persistent.proteges_raised` bumps when the protégé GRADUATES (reaches
  `GRADUATE_LVL` 20 through real play — days of grind per unit, so an alt farm is deeply unprofitable),
  ranked `MENTOR_RANKS` on `GET /v1/leaderboard/mentors`. No mentor cash → no farm incentive.

**The relationship feeling:** both are notified at every protégé milestone (the positive loop). The tie shows
on Home under YOUR PEOPLE (mentor ↔ protégés). Deferred (step two): a "your protégé was attacked"
notification so the mentor can go settle it — the literal "had my back" moment; a mentor gift; a mentor perk.

**§10.4:** `mentor:` joins the cash vocabulary — one faucet, `mentor:protege`, character_id'd, so the
per-character cash check reconciles it. The mentor legend + seeking flag + graduation move no value (status).
The test proves the vocabulary is closed and the faucet reconciles.

**Levers (founder sign-off):** `MENTOR_MIN_LVL`, `PROTEGE_MAX_LVL`, `GRADUATE_LVL`, `MENTOR_ACTIVE_MAX`,
`MENTOR_MILESTONES` (the protégé faucet — the one to sim), `MENTOR_RANKS`. Pinned in `test/levers.js`, tabled
in BALANCE.md.
