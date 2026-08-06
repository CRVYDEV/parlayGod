# THE CREW — the lightweight social unit (design)

## The gap

The game is rich at two social SCALES and empty between them. Verified in the tree (`grep`): there is no
squad/crew/clique concept and no friend/ally tie between individuals. Everything is one of:

- **The FAMILY (a gang)** — found/join for $25k, up to 20 members, turf, tribute, the Commission, wars.
  A real commitment with obligations.
- **One-to-one** — marriage, consigliere, bodyguard, rivals, contacts.

There is **nothing in between**, and the progression harness lands in exactly that void: a plausible solo
player reaches level 33 having never met another human, and the two "social" coach rungs point either at
the heavyweight family or at a one-shot crew heist. Chat has the same hole — only `city` / `family` / `DM`
channels exist; no small-group room.

## What THE CREW is (and is NOT)

A **2–4 player mutual-aid pact**. Low commitment, opt-in, no obligations. It is the on-ramp between "solo
and lonely" and "run a 20-person family," and it is the piece that gives the just-shipped Cast/Story/
Situation cohesion layer something COLLECTIVE to do (that layer is currently read-only — you can *see* your
people, not act with a small group).

It is **NOT a new pillar** (the standing audit finding is "breadth exceeds depth"). It is connective tissue
for the pillars that exist, scoped to **status + coordination**, riding already-audited rails. Explicitly:

- **NO shared treasury**, no turf, no Commission, no wars, no new escrow — so **zero new §10.4 surface**.
- **NOT immunity** — a crew is mutual RESTRAINT, not protection from the world. A contract on a crewmate's
  head is still collectable by everyone else; the crew only stops crewmates from killing each other.

## Step one (this drop)

**Account-keyed** (`crews`, `crew_members`, `crew_invites`) — a crew is between PEOPLE, not streets, so it
**survives death** (the heir stays in the crew), like `contacts` / `dynasty_marriages` / `dm_blocks`. No
estate wipe, no DISPOSITION entry (account-keyed tables are outside the wipe by construction).

1. **Lifecycle** — `createCrew` (name, cap `CREW.MAX_MEMBERS` 4, level ≥ `MIN_LEVEL` 3), `inviteToCrew`
   (leader/member invites a living player), `acceptInvite` / `declineInvite`, `leaveCrew`, `kickMember`
   (leader only). Leader leaves → oldest remaining member succeeds; empty crew is deleted (the `removeMember`
   pattern). One crew per account.
2. **THE CREW ROOM** — a small-group chat channel (`chat_messages` channel = the crew id), the missing tier
   between DM and family. Reuses `postChat`/`readChat` verbatim; a `crew:{id}` WS subscription so it's live.
3. **THE BOARD** — `crewBoard`: your crewmates with their live public state (name, level, district, family,
   online-ish), plus pending invites. This is the collective surface THE SITUATION was missing.
4. **BREAKABLE NON-AGGRESSION** — crewmates can't kill each other. A single shared `crewShield(h, victim)`
   applied at the four direct player-initiated attack paths that already carry family omertà — **fire, jump,
   npcHit, shank** — with the SAME exceptions omertà carries: a **rat** or a **WANTED** crewmate forfeits it
   (a fugitive is fair game on every PvP path — the audited rule). Breaking it is free: leave the crew.
   Deliberately NOT applied to `postBounty` (posting a contract is indirect — the third-party killer isn't
   shielded, so a crew is never immunity) nor the property crimes (robbing a crewmate's front is a betrayal
   you can answer) — both are step-two candidates, documented so the scope is a decision not an omission.
5. **Console** — a "The Crew" screen folded **under the existing Family group** (no 26th top-level tab — the
   conservative nav call while the reach beacon gathers data), and a crew card on THE SITUATION.

§10.4: **nothing moves value** — the whole drop is status + talk + a combat gate. The `crew:` word appears
in no ledger vocabulary. Proven by a zero-ledger-rows assertion across the lifecycle test.

## Levers (founder sign-off)

`CREW.MAX_MEMBERS` (4), `MIN_LEVEL` (3), `NAME_MAX` (24), `INVITE_TTL_MS` (72h). All pure pacing/scope —
no faucet, so nothing to sim. Pinned in `test/levers.js`, tabled in BALANCE.md.

## Deferred (step two)

- **The crew pot** — a convenience for co-funding a contract as `bounty_contributors` (already possible today
  via the open contract board; the crew makes it one action). This is where the "co-funded contracts" idea
  lands, on the AUDITED bounty-escrow rail — its own §10.4 reasoning, so its own drop.
- **A crew activity feed** — routing crewmates' `ACTIVITY_WIRE` acts to the crew channel.
- Extending non-aggression to `postBounty` / property crimes if the alpha shows crews want it.
- A crew status leaderboard (the hitman-rep posture — pure status, agents excluded).
