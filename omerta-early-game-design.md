# THE EARLY GAME — levels 1 to 30

**Founder direction (2026-08-01):** *"We want to really smooth out the user experience levels 1-30 to
get them hooked on the game. The coach has to be really guiding users through every possible next
step quest to earn XP & cash to advance through the game. Focus the next session on expanding the
breadth and depth of content a user experiences at the early levels to get them hooked. Explore
factors we can add to help achieve our goals."*

This is the diagnosis first, because the measured shape of the problem is not where I would have
guessed it was, and it changes what is worth building.

---

## 1. WHAT A PLAYER ACTUALLY MEETS, LEVEL BY LEVEL

Every level gate in the game, binned. `★` is a whole system opening.

| lvl | what opens |
|---|---|
| 1 | 2 crimes, the gym, the bank, the garage, daily contracts, the corner, the hustle |
| 2 | crime · Run numbers · **MISSION** Prove Yourself |
| 3 | crime · Lift a case · **MISSION** The Message · ★ **Street Races** |
| 4 | crime · Shake down a shopkeeper · **MISSION** The Collection Run · ★ **Crew Heists** · cartel · The Dock Rats |
| 5 | crime · Roll a drunk · ★ **found a family** · ★ **Dueling ladder** · ★ **the Street Wage** |
| 6 | **MISSION** The Witness Problem · ★ **The Port** · ★ **The Stable** |
| 7 | crime · Hijack a delivery truck |
| 8 | **MISSION** Silence the Rat · heist · The Payroll Office · cartel · The Zappa Crew · ★ **The Fights** |
| 9 | crime · Fence stolen furs |
| 10 | **MISSION** The Warehouse Ledger · ★ **The Loan House** |
| 11 | crime · Rob a back-room poker game |
| 12 | **MISSION** Debt of Honor · heist · The Inside Job · race · Midnight Run · ★ **Grand Prix** |
| 13 | crime · Rig the card game |
| 14 | **MISSION** The Dockside Heist |
| 15 | **MISSION** The Taste Test · ★ **your first FRONT** · heist · The Jewel Heist · ★ **Speakeasy** |
| 16 | crime · Torch a warehouse · **MISSION** The Long Drive · lane · Open Water |
| **17** | **— nothing —** |
| **18** | **— nothing —** |
| 19 | crime · Blackmail an alderman |
| 20 | **MISSION** Squeeze the Squeeze · heist · The Bank Vault · cartel · Kryl · hostile takeover |
| **21** | **— nothing —** |
| 22 | crime · Hit an armored car · **FRONT** Restaurant |
| **23** | **— nothing —** |
| **24** | **— nothing —** |
| 25 | **MISSION** Sit at the Table |
| 26 | crime · Empty a jewelry exchange · heist · The Armored Car |
| **27** | **— nothing —** |
| 28 | **MISSION** The Insurance Job |
| **29** | **— nothing —** |
| 30 | crime · Union payroll · **FRONT** Nightclub · race · The Ghost Circuit |
| **31** | **— nothing —** |

**Levels 1–16 are dense** — fifteen of sixteen levels deliver something, and **ten whole systems
open**. That half is in good shape and is not where the work is.

**Levels 17–31 are the cliff: seven of fifteen levels deliver nothing at all.** From the harness,
that band is roughly **hours 2.5 to 7** of play — exactly the window where a player either commits
or drifts.

---

## 2. THREE NUMBERS THAT NAME THE PROBLEM

**(a) The content cliff.** 7 empty levels out of 15, each ~20 minutes of play.

**(b) The coach cliff.** The ladder is 33 rungs, but the guiding ones are a strict chain of **one-time
milestones** — get strapped, trade winds, the kitchen, a crew score, the den, the fights, the races,
your first front, going legit, the port, the wire, blood on the ledger. A player who follows the
coach clears the last of them around level 22 and the coach falls to its tail: bank your cash, full
tank, find a crew, still running solo. **Not one rung points at repeatable work.** The thing designed
to always have a next step runs out of next steps at exactly the level the content does.

**(c) Verb monotony.** Measured at level 22: one 45-minute sitting of the best crime is ~22 runs and
**~693 respect**; a level in that band costs 430. So crime alone clears roughly a level and a half a
sitting — and **every repeatable daily loop in the game put together pays 75 respect**, which is
**5% of a day of crime clicking**. The hustle pays 0 respect. The trainer drills pay 0. The career
ladder pays 0. Corner envelopes pay 15 each.

So from 17 to 30 the game is, in the plainest terms: **click one crime button for about five days,
through eight levels that hand you nothing, with a coach that has stopped talking.**

---

## 3. THE HONEST DISAGREEMENT

The direction says "expand the breadth and depth of content." The measurement says **breadth at the
early levels is not the shortage** — ten systems are open by level 16, and the standing audit finding
across this whole project is that breadth already exceeds depth. Opening an eleventh system at level
18 would make it worse: another tab, another thing not to understand, in the band where the player is
already carrying more than they can hold.

What 17–30 is short of is **reasons and rewards inside the systems the player already has**, and a
coach that keeps pointing at them. That is the shape of everything proposed below. Where I do propose
breadth it is **content inside an existing system** (missions, crimes), never a new pillar.

---

## 4. THE FACTORS

Ranked by leverage per unit of risk. F1 is the direct answer to the founder's sentence about the
coach and needs no economy change at all.

### F1 — THE COACH BECOMES A LIVE WORK BOARD  *(no new faucet, no balance risk)*

Today the tail is four generic nudges. Instead, once the milestone chain is done, the coach draws
from **work that is already on the table, already pays, and is currently invisible**:

| rung | already exists | pays |
|---|---|---|
| "3 daily contracts are unclaimed" | `daily_progress` | cash |
| "tonight's hustle is at the Docks" | `hustles` | level-scaled cash |
| "the corner here has an envelope ready" | `corner_jobs` | cash + respect |
| "2 career tasks are ready to collect" | `career_claims` | cash |
| "a mission came off cooldown" | `mission_at` | the biggest respect chunk in the game |
| "Mickey's drill: train twice more" | `npc_drills` | discipline XP |
| "you're carrying a clue scroll" | `clue_scrolls` | a casket |
| "your front has a day's take waiting" | `businesses` | cash |
| "the crew's nut is due" | `crew_paid_at` | prevents a loss |

Every one of these is real state the server already tracks and the player currently has to go
looking for. Each rung names **what it pays**, so the player learns what is worth doing. It never
runs dry, because it refills daily.

Mechanically this is the loadOwned UNION gaining a few branches (the rivals-rung precedent, one
release ago) and `coachLadder` reading them. **Zero §10.4 surface** — it points at faucets, it does
not create one.

**This is the single highest-leverage item and it is the literal answer to "guiding users through
every possible next step quest to earn XP & cash."**

### F2 — THE DAILY LOOPS PAY RESPECT, NOT JUST CASH  *(signed-curve adjacent — sim + sign-off)*

F1 makes the daily work visible; this makes it *matter*. Today a player who does everything the game
offers in a day — corner, hustle, drills, career, dailies — advances their level by **5% of what
clicking one crime does**. That is why the band feels like one button: it is one button.

Give the daily loops a respect component sized so that a player who works the whole daily board gets
a **meaningful fraction** of a level's progress from it — enough that variety competes with grinding,
nowhere near enough to bypass the pacing pass. Rough shape: the full daily board worth ~a third of a
sitting's crime respect.

**This touches the pacing curve the founder signed**, so it is a lever, it gets measured in
`tools/playthrough.js` before and after, and it does not ship without the number being seen.

### F3 — FILL THE SEVEN DEAD LEVELS WITH MISSIONS  *(breadth, inside an existing system)*

Missions are the game's authored narrative content and the one thing that pays cash *and* respect
*and* a title. The ladder has 28 of them with holes at exactly 17, 18, 21, 23, 24, 27, 29, 31.
Filling those holes means **every level from 2 to 31 has a story beat.**

`MISSIONS` is machine-owned (`rules.generated.js`), so this is the prototype-edit + re-extract path —
the car-catalog precedent. Respect is a signed curve, so the added rungs get sim'd.

### F4 — THE LEVEL-UP MOMENT  *(hook; the §10.4-free version is the one to build)*

**BUILT (the §10.4-free version).** Crossing a level refills energy and nerve to their newly-raised
caps, so the moment you go up you can keep playing; the cine names the street rank when it changes
and otherwise what this level OPENED, read off the published catalogs rather than a hand-written map.
Measured with `npm run playthrough`: 2h level 14 → **16**, 5h 23 → **25**, 10h 39 → **43** (≈10%
faster, front-loaded into the band it is meant to smooth). `PACING.LEVEL_UP_REFILL` is the lever.
The paying version was NOT built — a new faucet needs its own sim and sign-off, and the refill
already buys the feeling.

Levelling up is currently a number changing on a bar. For a game trying to hook someone, the moment
you go up should be *an event*: the cinematic the client already has, a named street rank, and
something in your hand.

Two versions:
- **§10.4-free (recommended):** a full energy + nerve refill, a discipline packet, a Collection mark,
  the rank name. Moves no currency, needs no sign-off, still lands the beat.
- **Paying:** small cash per level. A new faucet — bounded (once ever per street, 30 levels) but it
  needs sim + sign-off, and the free version already buys most of the feeling.

### F5 — A REASON TO COME BACK TOMORROW  *(retention)*

A day-streak: come back N days running, the reward escalates. The game already has day-keyed tables
to hang it on and a `daily_progress` row per day. **Cash only** (the v24 social-reward rule), bounded,
and it resets on a missed day. This is the cheapest retention mechanic in the genre and the game has
none.

### F6 — SURFACE THE TRADES ON THE STREETS SCREEN  *(depth that already exists, unadvertised)*

**BUILT.** The character view carries a compact `trades` twin of the mastery board (computed off the
same helpers, on the view because `loadOwned` already holds the XP map — so it costs zero extra
queries and zero extra round trips), the Streets screen leads with the two tracks it feeds (larceny
from every job, commerce from every lot of freight), and the coach names a trade the moment it is
ONE level short of a milestone perk — rare, and it self-clears by playing that loop.

Mastery XP accrues from level 1 on every action, and the perks at 10/25/40 are real. It lives on the
Life tab and **the coach has never mentioned it**. Putting the relevant track's progress bar on the
Streets screen turns 200 crime clicks from repetition into visible progress toward a perk — which is
the whole psychological difference between a grind and a ladder. Client + one coach rung; no economy.

---

## 5. WHAT I RECOMMEND, AND IN WHAT ORDER

1. **F1 — the coach as a live work board.** ✅ BUILT.
2. **F6 — Trades on the Streets screen.** ✅ BUILT.
3. **F4 (free version) — the level-up moment.** ✅ BUILT.
4. **F3 — seven missions in the dead levels.** Real content; prototype + re-extract; sim'd.
5. **F2 — daily loops pay respect.** The one that most changes how the band *feels*, and the one that
   touches a signed curve — so it goes last, measured before and after, as a founder call.
6. **F5 — the day streak.** Retention, but it does nothing for a player who is *already* in the
   session; it is the follow-up, not the opener.

Everything above is levels 17–30 first. Levels 1–16 measure healthy and are left alone apart from
what F1/F4/F6 give them for free.

**Measurement:** `npm run playthrough` is the instrument. Today it reads level 14 at 2h, 24 at 5h,
39 at 10h, with 8 empty levels in the band and 18 coach rungs that all clear. Every item above gets
re-measured against that, and the numbers go in BALANCE.md.
