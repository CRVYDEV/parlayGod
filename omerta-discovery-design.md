# THE ROLODEX — player discovery (design)

## The gap

Every social system now EXISTS — crew, family, contacts, rivals, marriage, bodyguard, and the read-only
Cast/Story/Situation cohesion layer — but **they all assume you already know who to talk to.** Verified
in the tree:

- A **crew invite is by exact name** (`inviteToCrew` resolves `WHERE name=$1`) — you must already know it.
- The **Wet Work roster (`/v1/streets`)** is the top 100 living characters **by respect** — whales, not
  your peers.
- The **contact book** is EARNED through interacting — a bootstrap you can't use before you've met anyone.

So a new or mid player who wants to team up has **no front door**: no "who's around my level," no
"looking for a crew" flag, no fresh-blood board. In a game launching near-empty — where the progression
harness lands a plausible solo player at level 33 having never met another human — the connective tissue
is all built but there's no way to FIND people. THE CREW (the 2–4 player unit) is the sharpest example:
it exists, but nobody can form one unless they already know a name.

## What THE ROLODEX is (and is NOT)

A **§10.4-free read layer + one LFG toggle.** It is NOT a new pillar and it moves no value: three lists of
HUMANS and a "looking for a crew" flag. It makes the just-built social machinery **reachable by
strangers**, which is the whole point in a low-population game.

- **NO ledger surface** — the whole drop is READS + a boolean. The `discovery:` word appears in no
  vocabulary; the test proves it by counting rows.
- **HUMANS ONLY** — a crew cannot include an NPC resident and an agent is excluded from the social front
  door (`NOT c.is_npc AND NOT a.agent_flag`). Residents are already findable on the streets roster; this
  surface is for people you can actually team with. If you are genuinely alone the lists are empty — the
  TRUE state, and the empty-state honesty rule.

## The surface

`GET /v1/discovery` (`discoveryBoard`) returns three lists, each a public card
(`{id, name, level, district, gangTag, lfg, hasCrew}` — **no account UUID**, the rivals/cast discipline):

1. **`looking`** — the recruit list: humans who flagged LFG (within a freshness window), **crewless**, near
   your level, ordered by closeness. The highlight the console leads with.
2. **`peers`** — everyone near your level (whether or not they're looking; the looking-ones are de-duped
   out), so you can reach out to anyone. Surfaces `lfg` / `hasCrew` chips.
3. **`newcomers`** — the newest humans, ANY level, ordered by `created_at DESC`. The front door that's
   never empty while anyone at all has joined — a veteran welcomes a newbie, a new player sees other new
   players even when nobody's in their band.

Plus `me: { level, lfg, inCrew, band }`.

`POST /v1/discovery/lfg {on}` (`setLfg`) — advertise you're open to a crew, or take the flag down. A
`characters.lfg` boolean + a `lfg_at` freshness stamp, written by **direct SQL** (outside
persistCharacter's positional UPDATE — the `active_at` pattern, clobber-safe). Dies with the street: a
fresh heir is not looking until they say so, which is correct. No new table — discovery is reads over
`characters` + a toggle.

The **connect action reuses THE CREW**: if you're in a crew, a crewless discovery row gets a one-tap
"invite" (the existing `POST /v1/crew/invite {name}`); if you're not, the surface points you at the Crew
screen to start one. No new mechanic — discovery is the missing FRONT DOOR to machinery that already
works.

## Level band → respect band

Discovery filters by a LEVEL band (`DISCOVERY.BAND` ±10) so a fresh player sees PEERS, not the top-100
whales the streets roster shows. The SQL filters on respect, so the band is turned into a respect band via
the inverse of the signed pacing curve (`respect(L) = D·(L−1)²`, `respectAtLevel` local to the module).
Ordering by closeness uses **squared distance** (`(respect − mine)²`), not `ABS` — pg-mem implements no
`abs()`, and squared distance is monotonic in |distance| so it orders identically in both engines.

## Levers (founder sign-off)

`DISCOVERY.BAND` (10), `LIMIT` (24), `LFG_TTL_MS` (7d). All pure pacing/scope — no faucet, nothing to
sim. Pinned in `test/levers.js`, tabled in BALANCE.md.

## Console

A **"Find People"** screen folded under the existing Family group (next to The Crew — the conservative nav
call while the screen-reach beacon gathers data), plus a nudge on THE SITUATION ("N near you are looking
for a crew"). The LFG toggle, the recruit list with one-tap invite (when you lead/belong to a crew),
peers, and fresh blood.

## Step two (BUILT)

- **ONLINE-NOW presence** — each discovery card carries `online`, derived from the WS registry
  (`wsClients`, a Map of connected account → sockets). The route passes `[...wsClients.keys()]` into
  `discoveryBoard` (the board has no socket access); the human-list query selects `account_id` INTERNALLY
  to derive `online`, and the `card` mapper drops it — so presence surfaces but the account UUID never
  does. "Who can I actually reach right now" is the strongest teaming signal.
- **CREW RECRUITING + JOIN REQUESTS** — the push half. A crew leader flags the crew `recruiting`
  (`POST /v1/crew/recruiting {on}`), and the discovery board gains a **`crews`** list (recruiting,
  non-full crews whose member level RANGE overlaps your band; your own crew excluded; a flat query + JS
  fold, the /v1/gangs pg-mem precedent). A solo player **asks to join** (`POST /v1/crew/request/:crewId`
  — the invite twin, `crew_requests`); the leader sees pending requests on the crew board and
  **accepts** (`POST /v1/crew/request/:characterId/accept`) or **declines**
  (`DELETE /v1/crew/request/:characterId`), keyed on the requester's CURRENT living character (resolved
  to their account — the kickMember shape; no account UUID leaves). Accept is the acceptInvite discipline
  (lock the crew row, re-check the cap). So the market is two-sided: solo players flag LFG (pull for
  invites), crews flag recruiting (pull for requests), either side can initiate. Account-keyed →
  survives death; the worker sweep tidies stale invites AND requests on the shared TTL. Zero §10.4.

## Step three (BUILT)

- **FILTERS** — `GET /v1/discovery?district=X&nofam=1&online=1` narrows the three human lists.
  **district** ("who's near me AND where I can reach them") and **nofam** (unaffiliated players — better
  crew recruits than someone already in a 20-man family) filter in SQL, PRE-LIMIT (correct — a match
  beyond the cap is still found); **online** ("who can I reach right now", pairs with the presence chip)
  is a post-filter, since `online` is derived from the socket set, not a column. The SQL filter is built
  **dynamically** (the clause + its params appended only when active) rather than a fixed
  `($n::text IS NULL OR …)` — pg-mem's type inference breaks on a bound NULL and mis-typed the
  neighbouring numeric params. The applied filters are echoed back (`filters`) so the console shows the
  active state; crews are unfiltered (a group isn't in one district and isn't online/offline). Console:
  a filter row (district dropdown from `rules.districts`, "no family" + "online now" checkboxes, a clear
  button) that re-fetches; the filter state is module-scoped so it survives a background re-render.

## Deferred

The two-sided market + presence + filters cover the discovery surface. Further ideas if the alpha shows
demand: a level sub-band slider (finer than the fixed ±10), and a "saved search" that pings you when a
new player matches.
