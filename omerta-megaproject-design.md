# OMERTÀ — THE MEGAPROJECT (founder pick #1)

Steals the most famous server event in MMO history — WoW's Ahn'Qiraj gate opening — and lands it
on audited machinery. The city announces a MONUMENT; every player and family pools value toward a
massive collective target; when it completes the city PERMANENTLY changes and the contributors'
names go on the plaque forever, tiered by share. The game's first server-wide shared goal.

Every number below is a founder sign-off lever.

## Why it fits (the economics)

Every contribution is a **SINK** — §10.4-positive by construction:
- **Cash** burns: `megaproject:cash`, a character_id'd cash sink (check (a) reconciles per character).
- **$OMR** burns through the one audited burn primitive (`vanity.js:spendOmr`, account bucket):
  `megaproject:omr` — joins the omr vocabulary + the `omrBurns` term. Deflationary; helps
  extraction ≤ inflow.
- **Trade goods** are deleted from the trunk — goods are NOT a §10.4 currency (the convoy/market
  precedent), so this is a pure ownership sink; their credit is priced at the CATALOG BASE value
  (never the district-shocked price — donations are location-free, so the §7.11 arbitrage surface
  cannot leak in; buying cheap somewhere and donating is just an efficient way to buy status,
  which is the point).
- **NOTHING is minted, ever.** Completion pays no currency. Zero new faucet, zero emission.

$OMR credit rate: `MEGAPROJECT.OMR_RATE` ($500/$OMR — the genesis AMM rate). Deliberately a FIXED
lever, not the live AMM spot: deterministic, unmanipulable (a spot-linked rate would invite
pump-donate-dump around the pool), and re-tunable by the founder if spot drifts far.

## The loop

1. **The announcement.** One monument under construction at a time, drawn in order from the
   authored `MEGAPROJECT.MONUMENTS` catalog (Cathedral Restoration → Grand Casino → Founder's
   Bridge → The Colossus of the Docks). The board shows the current one — or the NEXT one before
   the first brick (computed from the catalog; the row materializes on the first contribution,
   the poker-tournament pattern; the deterministic PK `<monument>:<seq>` makes a concurrent
   double-materialize a clean 23505 → `contention` retry, the auction-F1 precedent).
2. **Contribute** — `POST /v1/megaproject/cash {amount}` / `/goods {goodId, qty}` / `/omr {amount}`.
   Gates: jailed (no writing checks from lockup); floors `MIN_CASH` $100 / `MIN_OMR` 1 / qty ≥ 1.
   Contributions CLAMP to what the monument still needs (cash exactly; goods to the fewest units
   that cover it; $OMR to 6dp) — nobody overpays into a finished wall. Safehouse is deliberately
   NOT gated: donating is neither an offense nor extraction (the money is GONE — a burn can't
   shelter value; the P1.3/D2 walls are untouched).
3. **The ledger of names.** `megaproject_contributions` is ACCOUNT-level (PK project × account) —
   the plaque survives death (the Portfolio/Collection precedent; a dynasty raised this). Names
   resolve at read: the living street, else the dynasty name, else the last known street.
4. **Milestones.** Crossing 25/50/75% fires a streets event (the whole city sees the scaffolding
   rise). Fired at contribution time — no worker, no cron (§7.1 lazy).
5. **Completion.** The contribution that crosses the line completes it in the SAME transaction:
   status → complete, a `megaproject_complete` streets event, the top contributor is notified as
   THE ARCHITECT, and the monument joins **the skyline** — a permanent section on `GET /v1/city`
   (and the City tab) listing every raised monument + its architect forever. The next monument
   is announced on the next board read.

## The plaque (pure status)

Tiers computed at read from share ranking (`MEGAPROJECT.TIERS`): **The Architect** (rank 1) →
**Foreman** (top 3) → **Patron** (top 10) → **Builder** (any contribution). Display-only —
no gameplay power, outside the sim-audited balance (the hitman-rep argument).

**Deliberately deferred (founder sign-off):** a completed monument granting a small district perk.
That would touch the signed turf-perk surface — it ships only as an explicitly signed-off follow-up,
if ever. Step one is pure status + sinks.

## Schema

- `megaprojects (id PK '<monument>:<seq>', monument, seq, target NUMERIC, progress NUMERIC,
  status building|complete, started_at, completed_at)` — one 'building' row at a time.
- `megaproject_contributions (project_id, account_id, contributed NUMERIC, PK pair)` —
  account-level, never estate-wiped (no character_id → outside the DISPOSITION guard by
  construction).

## Locks & §10.4

- withCharacter (actor char + account) → the `megaprojects` row `FOR UPDATE` (a singleton-class
  row, locked LAST — the canonical characters → … → singletons order; contribution upsert rides
  under it, so concurrent donations serialize on the monument and the crossing contribution is
  the unique completer).
- Vocabulary: `megaproject:` joins the cash AND omr `KNOWN_REASONS`; `megaproject:omr` joins
  `omrBurns`. No new bucket, no escrow (contributions are burns, not held value — nothing to
  refund, no death handling, no §10.4 check beyond the vocabulary + the existing per-character
  cash and $OMR-conservation checks, which reconcile both sinks automatically).

## Console

The City tab leads with THE MEGAPROJECT: the monument card (blurb + progress bar + remaining),
three contribute forms (cash / trunk goods / $OMR with the rate shown), the plaque (top
contributors with tiers + your share), and THE SKYLINE (every completed monument). `describe()`
humanizes contributions + completion; `/v1/rules` gains a `megaproject` block.
