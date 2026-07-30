# OMERTÀ — STREET LIFE (task #318)

Founder directive (2026-07-30, verbatim): "There should be more tasks located in each area that
send you on quests to gain xp and levels. Certain tasks should push you into conflict or meet
other players. Once you meet a new player you can have their phone number. Players phone numbers
should have to be discoverable via meeting or intel. As you rack up different players or NPCs met
they can give you quests or you get notified to fulfill requests. The broadcast button at the top
doesn't make sense or fit in at the moment. Repurpose and expand usecase or remove."

Three systems + one removal. All numbers are founder sign-off levers, pinned in `test/levers.js`
and tabled in `BALANCE.md § STREET LIFE`.

## 1. WORD ON THE STREET — the district quest boards (`src/corner.js`)

Every district posts `CORNER.PER_DAY` (3) tasks a day, drawn per `(district, day)` off the §7.11
seed hash — TOWN-WIDE per district (everyone standing there sees the same work), from that
district's flavored pool of EXISTING `bumpDaily` kinds (`CORNER.POOLS` — zero new counting
surface, the trainer-drill rule). Every draw GUARANTEES one CONFLICT kind (`jump`/`bust` — the
founder's "push you into conflict or meet other players"; a jump IS a meeting, see §2; if the
seed came up all-quiet the last slot becomes a seeded conflict pick).

Flow (the hustle baseline-delta rule): ACCEPT at the district (snapshots `daily_progress.counters`
— a morning's stockpiled jobs can't pre-pay a task) → do the work anywhere it happens → CLAIM at
the district. The claim pays `CORNER.CASH` ($400, ledgered **`corner:job`** — a character_id'd
§10.4 faucet, check (a) reconciles) + `CORNER.RESPECT` (15 — the XP; respect IS levels).

**The faucet is HARD-bounded**: `CORNER.MAX_DAY` (5) claims per street per day ACROSS districts
(counted at claim time) → **$2,000/day + 75 respect/day ceiling** (sim P9.26 prints it every
run). Petty by design — the POINTER around the map + the respect drip are the product (the
social-tasks posture). `corner_jobs` dies with the street (estate wipe + DISPOSITION).

## 2. THE BLACK BOOK — discoverable phone numbers (`src/contacts.js` + hooks)

A DM now requires HOLDING the target's number (`sendDm` throws `no_number` — after the blocks
gate, before the flood brake). Numbers are EARNED three ways, recorded in `contacts`
(account-keyed BOTH sides — the dm_blocks posture: a number follows the bloodline, the book
survives death by construction, no character_id column so the estate wipe never sees it):

- **MEETING** (`how: met`, MUTUAL) — any COMPLETED two-party action: ONE hook in
  `withTwoCharacters` after `fn` succeeds (a jump, a hire, a fade, a duel, a repay… a refused
  approach — a thrown gate — is not a meeting). Both sides walk away with the other's number.
- **INTEL** (`how: intel`, ONE-WAY) — a paid wiretap (`placeTap`) or dossier (`pullDossier`)
  carries the mark's number; the watched party never gets the watcher's.
- **CALLED** (`how: called`, one-way) — ringing someone reveals YOUR number to them (they can
  call back). Recorded when a DM lands.

The console: the phone's compose picker is the BOOK (never the roster); the Wet Work roster's 📱
is gated (📵 + "no number — meet them or tap them" for strangers). Zero §10.4 (a number is not
a currency).

## 3. THE CALL — contact requests (`src/contacts.js`)

The founder's "as you rack up players or NPCs met they can give you quests or you get notified to
fulfill requests": the worker (`generateContactCalls`, bounded `CONTACTS.GEN_PER_TICK` 4/tick,
ONE open call per street — the `contact_calls` PK) picks players with NPC-resident contacts and
has one of THEIR contacts ring them (a `contact_call` notify + the phone's open-call card):

- **freight** — "bring N units of X to my district" — pays `qty × goodPriceOf × 1.15`
  (`CALL_FREIGHT_PREMIUM_BPS`), the goods really change hands (absolute cargo writes both sides).
- **visit** — "come see me" — a `CONTACTS.VISIT_TIP` ($750) tip.

**The recycle-only rule (§10.4)**: the pay comes from THE CONTACT'S OWN POCKET, checked at
generation (an unaffordable freight demotes to a visit; a broke contact asks for nothing) and
clamped at fulfilment (robbed blind since they rang → the request VOIDS, `broke`). Fulfilment is
two-party (`withTwoCharacters` — sorted locks, so the pay can't clobber a concurrent
`residentAct`), both legs ledgered **`contact:freight`/`contact:visit`** with counterparty — a
pure transfer netting zero (test-pinned), bounded by the P9.21 npc:seed stock. Zero new faucet.
Requests lapse in `CALL_TTL_MS` (24h, `sweepCalls`); `contact_calls` dies with the street.

## 4. THE BROADCAST BUTTON — REMOVED (founder option: "or remove")

The permanent 📣 top-bar button selling your own legend never fit the chrome. The share loop
lives where it earns its place: the share-a-win brag prompts (fire on rare, genuinely brag-worthy
results) and My Profile's Contact box — both carry the `?ref` deep link, so the §7.13 growth loop
is untouched. `POST /v1/broadcast/shared` stays (the brag prompts still beacon it).

## Bounds & §10.4 summary

| flow | reason | kind | bound |
|---|---|---|---|
| corner claim | `corner:job` | cash FAUCET (character_id'd) | MAX_DAY × CASH = $2k/day/street |
| call fulfil | `contact:freight` / `contact:visit` | cash TRANSFER (both legs, counterparty) | the contact's own pocket (npc:seed stock) |
| the book | — | zero §10.4 | — |

## Deferred (step two, founder picks)

Player-to-player calls (a player posts a request their contacts can fulfil — needs an escrow
surface, the bounty discipline); corner CHAINS (multi-day district storylines — the errand-chain
machinery); a contact-count status ladder ("the connected man"); resident contacts whose requests
scale with standing (the Underworld tie-in).
