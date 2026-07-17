# The Law / RICO / Informants (design)

## 1. Why
Heat exists but the Law barely does. Today `characters.heat` is a single 0–100 number that
decays lazily (§7.1, ~1/min), climbs on deals, `fire` (`FIRE_HEAT` 20), `npcHit` (`NPC_HIT_HEAT`),
laundering (`LAUNDER_HEAT` 15) and shakedowns, and has exactly ONE consequence — the Kitchen's
Bureau raid (heat > 60 → a roll to seize the drug stash, `accrual.js`). So a non-Kitchen whale —
the safehoused landlord, the territory boss, the convoy shipper — generates heat with no downstream
and treats the number as noise. There is no arc: no investigation that builds, no case that lands,
no forfeiture that hurts, no courtroom, no reason to fear the FBI the way the genre's whole third act
is about fearing the FBI.

The Law is the missing PvE antagonist. It should be the state-run mirror of the PvP contract board:
a pressure that accrues from everything you do, escalates on its own clock, and can take the one thing
the game currently can't touch outside of PvP death — your **banked, safehoused wealth**. It closes
the sim-audit's standing complaint (the safehoused-landlord passive stack is ~25× the riskiest loop
because nothing reaches a man who never surfaces) with a threat that reaches a man precisely BECAUSE
he sits still and rich. And it turns the heist "rat" seed and `fire`'s witness notifications into a
full informant economy — the darkest, most on-theme mechanic the game can have: to save yourself, you
give up the family.

Grounded in what already exists: the heat number and its decay, the Bureau-raid roll, jail/busting
(`jail_until`, `bustSelf`), `runEstate` (the forfeiture-at-death precedent), `mod/confiscate`
(the §10.4-clean asset-seizure precedent — clamp to pocket, ledger to a confiscation buffer), the
streets feed + notifications, and the deterministic `cityEventOf` crackdown events.

## 2. The through-line: heat is now HEAT (a per-character rap sheet)
Nothing about how heat ACCRUES changes (sim-audited surfaces stay put, ground rule #1). What changes
is what it FEEDS. Heat becomes the input to a lazy state machine — the rap sheet — that every player
already carries. Read on touch (§7.1), no cron:

```
CLEAN → WATCHED (heat crosses WATCH, e.g. 40) → INVESTIGATION (heat sustained past 60) → INDICTED → (bust)
```

Each stage is a lazy computation off `heat`, a new `heat_days` exposure accumulator, and a
`rap_stage`/`rap_at` pair on the character — exactly the recurring-sink shape (own clock, computed on
read, materialized on the next touch). The stage gates access to the mechanics below; it never mints
or moves value by itself.

## 3. Phase 1 — Investigation & the two escapes (bribery + the lawyer)
The first shippable slice adds STAKES to heat without any new seizure — a pure sink layer that gives
the rich something dangerous to spend against, and makes the existing heat number legible.

- **The investigation meter.** A new `heat_exposure` accumulator banks "heat × minutes above WATCH"
  lazily (§7.1, on every action) — heat that spikes and decays costs little; heat held high builds a
  case. This is the state-side analogue of the business `scrutiny` accumulator (`business.js`), which
  is the proven precedent for a lazy risk meter that only extraction/activity feeds.
- **The heat (bribe the beat cop).** `POST /v1/law/bribe` — pay a wealth-scaled cash SINK
  (`law:bribe`, `bribeCost = max(BRIBE_MIN, exposure × BRIBE_BPS)`) to knock `heat_exposure` down a
  band. A recurring, wealth-scaling drain that the busiest (hottest) players pay most — the pad, but
  owed to the city instead of the family. Blocked from a safehouse (D2 — bribery is an exposed act,
  like laundering).
- **The lawyer (retainer).** `POST /v1/law/retainer` — a longer, pricier cash SINK (`law:retainer`)
  that buys a standing modifier: while retained, the Phase-2 bust rolls at a reduced probability and
  forfeiture at a reduced rate. The white-collar hedge — the endgame player pays the lawyer so the
  raid, when it comes, takes less. Retainer is time-boxed (its own clock) so it's recurring, not
  buy-once.
- **`GET /v1/law`** — the public rap sheet: your stage, exposure, bribe quote, retainer status, and
  the active `cityEventOf` crackdown modifier (below). Closes the discoverability gap the audits keep
  flagging.

§10.4: two new cash sinks (`law:bribe`, `law:retainer`), a new `law:` vocabulary prefix in
`invariants.js`, all `character_id`'d so check (a) reconciles. Nothing new is minted or seized in
Phase 1 — it is purely a metered sink on a number that already exists. All numbers
(`WATCH`, `BRIBE_MIN`, `BRIBE_BPS`, retainer cost/duration/discount) are founder sign-off levers.

Crackdown tie-in: `cityEventOf` already ships `crackdown` / `sweep` / `visit` events. Phase 1 reads
them — a crackdown day multiplies exposure gain (and `visit`, the commissioner's PR day, decays it) —
so the Living World's weather already drives the Law's pressure with zero new plumbing.

## 4. Phase 2 — RICO, the bust & asset forfeiture (the reach into the vault)
This is the payload: the first PvE mechanic that can take BANKED wealth, closing the safehoused-hoard
gap. It is deliberately the state analogue of a PvP `fire`-kill — but where a kill loots pocket +
in-transit (Make-Risk-Pay), the FEDS take the bank.

- **The indictment.** Sustained INVESTIGATION past a threshold (exposure ≥ `INDICT_AT`) flips
  `rap_stage` to INDICTED lazily. Indictment is visible on `GET /v1/law` and notified — the game tells
  you the case is coming, so a rich player has a window to bribe/lawyer/lay low/liquidate (converting
  losable bank into extractable $OMR via the wash house — deliberately routing them INTO the exposed
  laundering act, another Make-Risk-Pay loop).
- **The bust.** Resolved lazily on the indicted player's next touch (the kitchen-raid precedent),
  OR forced by the nightly worker so an offline indicted whale can't dodge by never logging in — the
  Law reaches the absent man specifically. One roll, `P = clamp(bustP(exposure) × retainerDiscount ×
  crackdownMult, MIN, MAX)`, rng-audited.
- **Forfeiture (the §10.4 heart).** On a landed bust the state seizes `FORFEIT_RATE` of
  **pocket + bank** (NOT staked $OMR — staking is the sim-audited safe harbour, and NOT on-chain-minted
  gear — it's already extracted, the Phase-3 gear-loot precedent), ledgered as a SINK to the
  confiscation buffer using the **exact `mod/confiscate` pattern already in the code**
  (`server.js:704` clamps to pocket and ledgers `mod:confiscate` → `street_tax.pool`). Forfeiture is a
  §10.4-clean sink: value moves to the tax pool (→ buyback → staking yield / protocol liquidity), it
  is never destroyed unaccounted. New reason `law:forfeit` (cash) reaches pocket THEN bank (the raid-fine
  precedent in `business.js`). A bust also jails the character (`jail_until`, the existing lockup) and
  zeroes exposure (the case is spent) — you can be busted again, but the sheet resets.
- **Not death.** A bust is NOT `runEstate` — the street survives, keeps its stats/skills/gear-in-play,
  loses liquid wealth + time. Death stays a PvP/`npcHit` outcome. This keeps the Law as an economic
  antagonist (drains the hoard) distinct from the lethal layer (ends the man).

§10.4: `law:forfeit` cash sink → the confiscation buffer (the audited `mod:confiscate` sink target);
the buffer already reconciles. Staked $OMR and minted gear are provably out of reach. All numbers
(`INDICT_AT`, `FORFEIT_RATE`, `bustP` curve, jail term) are founder sign-off levers — and because this
seizes banked wealth, this phase specifically wants a sim pass (extraction-vs-inflow, whale drain rate)
before production.

## 5. Phase 3 — the courtroom (turn the bust into a play)
An indictment shouldn't be a coin flip you watch. Phase 3 makes the window between INDICTED and the
bust a set of PLAYER CHOICES — the genre's third act, and more $OMR/cash sinks:

- **Plea vs trial.** `POST /v1/law/plea` — accept a certain, smaller forfeiture + a fixed jail term
  now (a sink `law:plea`), OR roll the trial (the Phase-2 bust probability — acquittal costs nothing,
  conviction takes the full `FORFEIT_RATE` + longer jail). The classic risk choice: eat a known loss
  or gamble on the jury.
- **Buy the jury.** `POST /v1/law/jury` — a large one-time $OMR or cash sink (`law:jury`) that cuts
  trial conviction probability once. The endgame lever: the man with a war chest beats the rap. Priced
  as a real dent so it doesn't trivialize the threat.
- **Witness tampering.** If the case was built on an informant (Phase 4), a directed action to
  discredit/eliminate the witness — ties the courtroom back into the PvP contract board (a kill on the
  rat collapses the case). This is where the Law loop and the hitman loop meet.

§10.4: `law:plea`, `law:jury` — cash and/or $OMR sinks in the existing vocabularies (the casino/vanity
precedent for cash-and-$OMR player-choice sinks). No new mint. Numbers are sign-off levers.

## 6. Phase 4 — informants & witness protection (the darkest sink of all)
The endgame of the Law is the endgame of the genre: the flip. Grounded in two seeds already in the
code — the heist "**rat**" (`heists.js`, a member silently blows the job for a cut) and `fire`'s
witness notifications (a kill already tells the streets/victim).

- **Getting flipped (the state's offer).** An INDICTED player facing a bad trial can turn state's
  evidence: `POST /v1/law/flip`. The deal: the case is DROPPED (exposure → 0, no forfeiture, reduced
  jail) — but you must **name a name**. Flipping builds a case against a chosen family member/rival
  (adds a large chunk to THEIR `heat_exposure`, seeding their indictment) and burns your standing:
  a permanent account-level `rat` badge (the anti-referral-payout exclusion precedent — a status flag
  that follows the bloodline), forfeited family membership, and — the teeth — you become a **contract
  magnet**: the design already has vendettas and the contract board, so a rat is fair game with a
  waived directed floor (the vendetta-waiver precedent) to anyone in the family you betrayed.
- **Witness protection (the soft reset).** A flipped player can enter WITPRO: a one-time protected
  window (untargetable like a paid safehouse, but state-funded) during which they can relocate — a
  soft identity reset (new living name, the vanity-rename machinery; kill_log/bounties key on account
  id so the rat badge and blood debts still follow, exactly as renames don't dodge them today). The
  price is the family: you can never rejoin the one you burned, and the badge is forever.
- **The informant as a game object.** A flip creates an `informants` row (the witness) that the
  Phase-3 courtroom reads — killing the witness (a `fire` on the rat inside the window) collapses the
  case they seeded, which is why witness protection exists and why a rat is hunted. The whole thing is
  a closed PvP loop: the state pressures you → you flip → you seed a case on a rival AND paint a target
  on yourself → they hunt the rat → the case dies with the witness. Zero new value flows — it's all
  status, access, exposure-seeding, and existing PvP death.

§10.4: informant/flip mechanics move NO currency (exposure is not a §10.4 quantity; the rat badge and
WITPRO are status/access) — §10.4 is untouched by construction, the Commission/vendetta precedent for a
pure-status pillar. The only ledgered events are the sinks already defined in Phases 1–3. Numbers
(flip's exposure transfer, WITPRO duration, jail reductions) are sign-off levers.

## 7. §10.4 summary (the whole pillar)
- **New cash sinks:** `law:bribe`, `law:retainer`, `law:forfeit`, `law:plea` — all `character_id`'d,
  new `law:` prefix in the cash vocabulary. `law:forfeit` targets the existing confiscation buffer
  (the `mod:confiscate` precedent), so the buffer→buyback→yield loop is where seized wealth goes —
  redistributed, never burned unaccounted.
- **Optional $OMR sink:** `law:jury` (if priced in $OMR) — added to `omrBurns`, the vanity/respec
  precedent.
- **No new faucet.** The Law only DRAINS. This is deliberate — it's the counterweight to the
  Risk-to-Earn faucets, the sink that makes sitting on a hoard dangerous. Extraction-vs-inflow is
  helped, never hurt, by this pillar.
- **No mint.** Forfeiture transfers to the tax pool; flip/informant move only status and exposure.
  Staked $OMR and minted gear are provably untouchable.

## 8. Phasing & sign-off
1. **Phase 1** (investigation meter + bribe + lawyer + `GET /v1/law`) — pure sink layer, no seizure,
   ships first, lowest risk, immediate wealth-drain value.
2. **Phase 2** (RICO bust + forfeiture) — the payload; wants its own sim pass because it reaches
   banked wealth.
3. **Phase 3** (courtroom: plea/trial/jury/tampering) — deepens the choice, more sinks.
4. **Phase 4** (informants/WITPRO) — the status-only capstone; closes the PvP loop.

Every number in this document is a **founder sign-off lever** (ground rule #1) — proposed defaults to
be sim-audited and signed into BALANCE.md before production, exactly like every economy drop. Nothing
here retunes a signed lever; heat's ACCRUAL surfaces are untouched — the Law only adds consequences
downstream of the number the game already tracks.
