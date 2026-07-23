# OMERTÀ — Blackmail & Secrets + The Collection (founder picks #7 + #8)

Two drops: **Crusader Kings intrigue** on the Wire (dirt as a HELD asset — dig, extort, expose)
and the **Pokémon/Steam completion ledger** (an account-level "ever owned / ever done" index).
Every number is a founder sign-off lever.

---

## Drop A — BLACKMAIL & SECRETS (CK3 intrigue, the Wire's fourth layer)

The Wire reads live signals (taps/dossiers). Secrets are different: **leverage you HOLD** — a
recorded piece of dirt with a shelf life, and two ways to spend it.

### The loop
1. **DIG** (`POST /v1/wire/dig/:targetId`) — burn `SECRETS.DIG_OMR` (10, `intel:dig` — rides the
   existing `intel:` $OMR vocabulary + burn term, ZERO invariant change; the spymaster rank
   discount applies and the dig bumps `intel_ops`). The server inspects the mark's REAL state and
   uncovers the juiciest ACTUAL secret present (never fabricated):
   - `launderer` — "The Wash Records" (recent wash-cap usage)
   - `killer` — "The Bodies" (season kills ≥ 1)
   - `cook` — "The Kitchen Books" (a stash on the shelf / a lab)
   - `moneybags` — "The Second Ledger" (bank ≥ $500k — BANDED, never an exact figure)
   A clean mark (or one under DISINFORMATION — the counter-intel triad: cooked books beat the
   shovel) yields `nothing`; the fee burns win or lose (the npchit-fee posture — an operation,
   not a read). Gates: self/same-account, `DIG_CD_MS` 24h per (digger, target), `MAX_HELD` 5,
   one live secret per (holder, target).
2. **HOLD** — the secret is a row (`secrets`): holder = the SPY'S STREET (dies with them —
   estate-wiped), target = the mark's ACCOUNT, TTL `TTL_MS` 7d. Dirt on a street that dies is
   worthless (deleted at the mark's estate — the heir starts clean).
3. **EXTORT** (`POST /v1/secrets/:id/extort {demand}`) — name your price (≤ the kind's
   `hushCap`); the mark is notified and has `EXTORT_WINDOW_MS` (24h) to PAY or the secret blows.
4. **PAY THE HUSH** (`POST /v1/secrets/:id/pay`, two-party) — the mark pays the demand: the
   standard taxed transfer (`secret:hush` both sides — mark −demand, holder +98%; 1% street tax
   → the buyback, 1% dev off-ledger — the bodyguard/speakeasy-round pattern EXACTLY, so no new
   untaxed value pipe). The secret is consumed (paid off). `secret:` joins the cash vocabulary.
5. **EXPOSE** (`POST /v1/secrets/:id/expose`, two-party — or the worker at the deadline) — burn
   the leverage publicly: the mark's **RICO investigation meter** (`heat_exposure`) jumps by the
   kind's `exposeHeat` (the Port `BUST_EXPOSURE` precedent — a NEW Law lever, §10.4-free), the
   streets feed carries the story, the secret is consumed. So the extortion threat is REAL:
   hush money or the Bureau's file thickens.

### §10.4 posture
`intel:dig` rides the existing intel burn term (zero change). `secret:hush` is the audited taxed
two-party transfer (both rows character_id'd → check (a) reconciles; the 1% pool credit is the
non-§10.4 street_tax bucket, the 1% dev is off-ledger — byte-for-byte the speakeasy:round
mechanism). Exposure moves NO value (a meter + a feed item). No escrow anywhere.

### Anti-grief bounds
Cost per dig + a per-pair cooldown + the held cap + the TTL; the mark always gets the pay/expose
choice window; exposure heat is a bounded one-shot on a meter that bleeds; disinformation is a
real defense; secrets die with the spy AND with the mark's street.

### Schema
`secrets (id, holder_character, target_account, target_name, kind, demand, extort_deadline,
created_at, expires_at)` + `digs (character_id, target_account, at — the per-pair cooldown)`.
Estate: both wiped by holder character_id (DISPOSITION 'wiped'); secrets targeting the dead
street's account deleted in runEstate.

---

## Drop B — THE COLLECTION (Pokémon/Steam completion)

An account-level ledger of everything a bloodline has EVER touched — survives death, selling,
seizure. Pure STATUS (zero §10.4 — the log moves no value). The "gotta catch 'em all" compulsion
pointed at content that already exists.

### Categories (8, each with clean touchpoints)
| category | total | logged at |
|---|---|---|
| crimes | the 29 CRIMES | first successful pull of each job |
| districts | 6 | travel |
| cars | the 60-car catalog | any acquisition (boost + every ownership-transfer site) |
| guns | the gun catalog | armory buy |
| drugs | the 8 lines | first cook of each |
| boats | the 6-boat yard | boatyard buy |
| goods | the trade-goods catalog | street buy |
| fixtures | the 6 Underworld names | standing reaches tier 1 (25) |

`collection_log (account_id, category, item_id, first_at)` PK — `logCollect()` is a one-line
`INSERT … ON CONFLICT DO NOTHING` at each site (src/collection.js imports nothing from game.js —
acyclic). `GET /v1/collection` is the board (per-category have/total + item checklists);
`GET /v1/leaderboard/collection` ranks completion % (agents excluded — the boards precedent).
Console: "The Collection" section on The Estate tab (the trophy-room fantasy).

### Sign-off levers
`SECRETS.*` (DIG_OMR, DIG_CD_MS, TTL_MS, EXTORT_WINDOW_MS, MAX_HELD, per-kind hushCap +
exposeHeat — the exposeHeat set is the one Law-surface lever, the BUST_EXPOSURE precedent).
The Collection has none (pure status, no rewards — completion is its own flex).
