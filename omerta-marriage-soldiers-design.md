# OMERTÀ — Dynastic Marriages & the Consigliere + Named Soldiers (founder picks #2 + #3)

Two content drops stealing proven loops: **Crusader Kings** (dynasties that matter to each
other) and **XCOM** (named hirelings with permadeath — the strongest attachment loop in games).
Both ride audited machinery; every number is a founder sign-off lever.

---

## Drop A — DYNASTIC MARRIAGES & THE CONSIGLIERE (CK3)

The Bloodline (Five Pillars #5) made each dynasty a solo trophy case. CK3's lesson: bloodlines
retain players when they're tied to OTHER bloodlines — a social web that outlives any one death.

### The marriage
- **Account-level** (dynasty × dynasty — the vendetta/feud_peace_offers pattern): survives death
  (the heirs remain in-laws), monogamous (one marriage per dynasty), never self.
- **Flow** — the pact pattern at the account level: `POST /v1/dynasty/propose/:characterId`
  (targets a LIVING street, resolves their account) → the other side
  `POST /v1/dynasty/accept/:accountId`. Either side can withdraw a pending offer.
- **The ceremony fee** — proposer pays `MARRIAGE.PROPOSE_COST` ($25k) at propose (non-refundable
  — the envoy was sent), acceptor pays `ACCEPT_COST` ($25k) at accept. Both are character_id'd
  cash SINKS `dynasty:ceremony` (a new `dynasty:` cash-vocabulary prefix; check (a) reconciles).
- **The wedding buries the feud** — on acceptance, all vendettas BOTH directions between the two
  accounts clear (the acceptPeace machinery), plus any pending peace offers. Real utility, zero
  §10.4 (vendettas are status).
- **What it grants (status + the scandal deterrent — no immunity, no power):**
  - Both bloodline halls show the alliance (spouse dynasty + steward); the streets feed announces
    the wedding; the boards carry a ring.
  - **THE SCANDAL** — a direct player kill (fire / shank / npc-hit payer, i.e. any `runEstate`
    with a `killerCh`) where the killer's dynasty is married to the victim's: the killer eats
    `MARRIAGE.SCANDAL` honor (−30, on top of everything else), the marriage dissolves on the
    spot, and the streets hear about it. Deliberately NOT a kill-block (no marriage-as-immunity
    for alt pairs — the deterrent is honor + the public shame, not a shield).
- **Divorce** — either side walks (`POST /v1/dynasty/divorce`): the initiator eats
  `MARRIAGE.DIVORCE` honor (−10, the mini-oathbreak), row deleted, feed. No fee.
- **Gates:** living characters both sides, Mad Dog can't propose OR accept (the diplomacy
  lockout), both dynasties unmarried.

### The Consigliere
- Each dynasty may name ONE adviser (another account, by living street):
  `POST /v1/dynasty/consigliere/:characterId` (costs `CONSIGLIERE_COST` $10k, `dynasty:consigliere`
  sink, paid at propose — the envoy again); the named party accepts
  (`POST /v1/dynasty/consigliere/accept/:accountId`) or it sits pending. Either side can end it.
- **Pure status both ways**: the appointer's hall shows their consigliere; the adviser's hall
  shows every house they counsel ("Consigliere to the House of X"). A famous adviser can counsel
  many houses (one PER house, the CK court-position shape). Zero gameplay power.

### §10.4 posture
Two enumerated character_id'd cash SINKS (`dynasty:ceremony`, `dynasty:consigliere`) — the
`dynasty:` prefix joins the cash vocabulary; check (a) reconciles automatically. No faucet, no
escrow, no refund path. Honor moves are status. Marriage/consigliere rows are account-level —
outside the estate wipe by construction (they ARE the persistence).

### Schema
- `dynasty_marriages (account_a, account_b PK sorted-pair, proposed_by, accepted, created_at)`
- `consiglieri (dynasty_account PK, adviser_account, accepted, created_at)`

---

## Drop B — NAMED SOLDIERS with PERMADEATH (XCOM)

Kitchen crew and heist crews are faceless numbers. XCOM proved named hirelings with traits and
permanent death create attachment nothing else matches. Soldiers are a NEW parallel layer — they
never touch the signed kitchen-crew economy.

### The loop
- **Recruit** (`POST /v1/soldiers/hire`) — `SOLDIERS.HIRE_COST` ($25k) cash SINK `soldier:hire`;
  a server-rolled noir NAME + ONE trait (rng-audited); roster cap `SOLDIERS.MAX` (3).
- **Assign** (`POST /v1/soldiers/:id/assign`) — ONE soldier rides as your "second" (`on_job`);
  unassign/dismiss freely. An INJURED soldier sits out (reads as unavailable).
- **They work** — the assigned, fit soldier assists three loops (single-touchpoint modifiers,
  the skills/decree precedent — each trait fires at exactly one site):
  - **§7.2 CRIME** — `wheelman` cuts a busted stint (`jailS ×(1−fx)`); success = +1 xp and the
    soldier takes `CUT_BPS` (5%) of the gross (shaved BEFORE the ledger row — the faucet only
    SHRINKS, strictly §10.4-safe, no new reason).
  - **THE SCORE (solo heist)** — `safecracker` shortens the cooldown (`HEIST_CD ×(1−fx)`) —
    pacing, never the pot; success = +1 xp.
  - **WORLD RAID** — `gunner` adds power (+N — raises hit odds on the reservoir-BOUNDED faucet;
    flagged for sim); a repel = the risky outcome.
- **They get hurt, they die** — a busted crime / failed raid: the soldier is INJURED
  (`INJURY_MS` 4h) and rolls `DEATH_P` (0.12; `SOLDIER_DEATH_P` TEST-ONLY env knob) — dead is
  DEAD (row kept, `alive=false`, cause recorded). `lucky` halves the death roll; `lookout`
  halves the injury chance.
- **They level** — xp per assisted job; `level = 1 + floor(xp/LVL_XP)`; trait strength scales
  `SCALE_PER_LVL` (+10%/level, capped at level 10). A veteran is genuinely better — and
  genuinely painful to lose.
- **The memorial** — `GET /v1/soldiers` lists the roster AND the fallen (name, trait, level,
  cause, date). Soldiers die with the street (estate-wiped, DISPOSITION 'wiped') — a fresh
  street hires fresh muscle.

### §10.4 posture
One enumerated character_id'd cash SINK (`soldier:hire` — the `soldier:` prefix joins the
vocabulary). The 5% cut is a pre-ledger shave (the crime faucet strictly shrinks — ledgered
amount == credited amount, zero new reason). The gunner trait is the one throughput-raising
lever (bounded by the World reservoir — sim + sign-off, the co-op-raid precedent). No wages in
step one (flagged: "the nut" recurring-sink pattern is the step-two lever if soldiers prove
too free to hold).

### Schema
- `soldiers (id PK, character_id, name, trait, xp, injured_until, on_job, alive, died_at,
  cause, hired_at)` + `ix_soldiers_char`. Estate: wiped.

### Consoles
- **Streets tab** — "Your Second" card: roster (name/trait/level/status chips), hire, assign
  radio, the memorial line.
- **Life tab (Bloodline section)** — the marriage card (spouse/pending/propose/divorce) + the
  consigliere card.

### Sign-off levers (all numbers)
`MARRIAGE.*` (PROPOSE/ACCEPT/CONSIGLIERE costs, SCANDAL −30, DIVORCE −10);
`SOLDIERS.*` (HIRE_COST, MAX, CUT_BPS, INJURY_MS, DEATH_P, XP/LVL curve, per-trait FX,
SCALE_PER_LVL/LVL_CAP). The gunner world-raid power bump is the one emission-adjacent lever —
sim before production.
