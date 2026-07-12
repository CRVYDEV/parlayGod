# OMERTÀ — Backend Specification v1.0

**Source of truth:** `omerta-game-v24.jsx` (the audited browser prototype). Every rule, formula, and constant in this document is derived from that file; where this spec and the prototype disagree, the prototype's *intent* wins and the discrepancy should be raised.
**Audience:** the engineer(s) building the production server — whether a contractor or a Claude Code session.
**Status:** ready to build. All demo-scaled timers are listed with their production values in §9.

---

## 1. Goals & non-goals

**Goal:** a server-authoritative rebuild. The client becomes a display and input device; every rule, roll, balance, and timer lives on the server. Nothing the client sends is trusted beyond "the player pressed this button with these parameters."

**Non-goals for v1:** data migration from prototype saves (alpha starts fresh); mobile apps (the web client is responsive); on-chain settlement (the Solana service in §11 ships in phase 2 behind the same API).

**The one-sentence security model:** if a player edits their client, the worst they can do is render wrong numbers to themselves.

## 2. Recommended stack

| Layer | Choice | Rationale |
|---|---|---|
| API server | Node.js + TypeScript (Fastify or NestJS) | Same language as the prototype; formulas port 1:1 |
| Database | PostgreSQL 15+ | Relational fits the schema; row locks fit the economy |
| Cache/ephemeral | Redis | Rate limits, session cache, websocket presence, cooldown checks |
| Realtime | WebSocket (single gateway) | Streets feed, inbox push, gang chat-adjacent events |
| Jobs | A worker process + `pg_cron` or BullMQ | Buyback (12h), season rollover, telemetry rollups |
| Auth | X OAuth 2.0, Privy, guest sessions | Mirrors the prototype's three sign-in paths |
| Chain service | Isolated Node service, no DB write access except `vouchers` | Blast-radius containment (§11) |

**Two architectural principles that shape everything below:**

1. **Lazy accrual, not global ticks.** The prototype ticks every 3 s in the browser. The server must NOT run a loop over all players. Instead, every time-dependent quantity (energy, nerve, health, jail, racket income, staking rewards, heat decay, crew sales, batch completion) is computed on demand from `last_accrued_at` when the player is next touched (by their own request or by someone targeting them). §7.1 defines the accrual function precisely.
2. **Double-entry money.** Every cash/$OMR movement writes to a `transactions` ledger with a source and sink. The audit invariant from v23 — *value transfers, it is never minted* — becomes a nightly job that sums the ledger and alerts on drift. The only legal mints are the enumerated faucets (crime payouts, racket income, check-ins, onboarding, bust rewards, mission rewards); the only legal burns are the enumerated sinks.

## 3. Database schema

Types abbreviated; all tables get `created_at`/`updated_at`. `NUMERIC(20,2)` for cash, `NUMERIC(20,6)` for $OMR.

### 3.1 Identity & account

```sql
accounts (
  id UUID PK,
  auth_provider TEXT CHECK (IN ('x','privy','guest')),
  auth_subject TEXT,              -- provider user id
  email TEXT NULL,
  created_ip INET, last_ip INET,  -- dupe detection (§10.3)
  status TEXT DEFAULT 'active' CHECK (IN ('active','banned','shadow')),
  UNIQUE (auth_provider, auth_subject)
)

-- One LIVING character per account; death creates a new row (the heir),
-- account-level fields carry over per the Estate rules (§7.9).
characters (
  id UUID PK,
  account_id UUID FK -> accounts,
  name TEXT NOT NULL,             -- carries across deaths (the bloodline)
  generation INT DEFAULT 1,       -- increments per death
  alive BOOL DEFAULT true,
  -- vitals & progression (street-side: reset on death)
  respect BIGINT DEFAULT 0, energy NUMERIC DEFAULT 50, nerve NUMERIC DEFAULT 10,
  health NUMERIC DEFAULT 100, cash NUMERIC(20,2) DEFAULT 500, bank NUMERIC(20,2) DEFAULT 0,
  muscle INT DEFAULT 5, cunning INT DEFAULT 5, speed INT DEFAULT 5,
  jail_until TIMESTAMPTZ NULL, hosp_until TIMESTAMPTZ NULL,
  loc TEXT DEFAULT 'docks',
  path TEXT NULL CHECK (path IN ('gun','ledger','kitchen')),
  title TEXT NULL,
  gun TEXT NULL, vest TEXT NULL, ammo INT DEFAULT 25, cb INT DEFAULT 0,
  streak INT DEFAULT 0, checkin_day INT DEFAULT 0, heist_at TIMESTAMPTZ NULL,
  gta_at TIMESTAMPTZ NULL, shoot_cd_until TIMESTAMPTZ NULL, busts INT DEFAULT 0,
  heat NUMERIC DEFAULT 0, lab TEXT NULL, crew INT DEFAULT 0, trade_rep BIGINT DEFAULT 0,
  season INT NOT NULL,
  last_accrued_at TIMESTAMPTZ DEFAULT now(),   -- §7.1
  UNIQUE (account_id) WHERE alive              -- one living character
)

-- Account-level persistence (survives death — "the wallet & the name"):
account_persistent (
  account_id UUID PK FK,
  prestige INT DEFAULT 0,
  omr NUMERIC(20,6) DEFAULT 0, staked NUMERIC(20,6) DEFAULT 0,
  rewards NUMERIC(20,6) DEFAULT 0, stake_started_at TIMESTAMPTZ NULL,
  wallet_address TEXT NULL,
  recruits INT DEFAULT 0,                       -- recruiter ladder (v24)
  onboard JSONB DEFAULT '{}',                   -- First Week claims (v24)
  checkins_lifetime INT DEFAULT 0,
  referred_by UUID NULL, ref_paid BOOL DEFAULT false,
  agent_flag BOOL DEFAULT false,                -- 🤖 badge; excluded from referral payouts
  deaths INT DEFAULT 0
)
```

### 3.2 Inventory & possessions (street-side)

```sql
character_items    (character_id FK, item_id TEXT, qty INT)          -- consumables (inv)
character_guns     (character_id FK, gun_id TEXT)                    -- owned iron
character_rackets  (character_id FK, racket_id TEXT, PRIMARY KEY both)
character_assets   (character_id FK, asset_id TEXT, PRIMARY KEY both)
character_cargo    (character_id FK, good_id TEXT, qty INT)          -- trade goods trunk
cars               (id UUID PK, character_id FK, model_id TEXT, trim_id TEXT, dmg INT)
makings            (character_id FK, drug_id TEXT, qty INT)
stash              (character_id FK, drug_id TEXT, qty INT, quality NUMERIC)  -- weighted avg q
batches            (id UUID PK, character_id FK UNIQUE, drug_id TEXT, qty INT, done_at TIMESTAMPTZ)
-- NFT gear is ACCOUNT-side (survives death):
account_gear       (account_id FK, gear_id TEXT, minted_onchain BOOL DEFAULT false, PRIMARY KEY both)
missions_done      (character_id FK, mission_id TEXT, PRIMARY KEY both)
daily_progress     (character_id FK, day INT, counters JSONB, claimed JSONB)
```

### 3.3 Social systems

```sql
gangs (
  id UUID PK, name TEXT UNIQUE, tag TEXT UNIQUE, boss_account UUID FK,
  treasury NUMERIC(20,2) DEFAULT 0, omr_reserve NUMERIC(20,6) DEFAULT 0,
  ammo_bank INT DEFAULT 0,
  weekly_task_id TEXT, weekly_progress BIGINT DEFAULT 0, weekly_week INT,
  war_with UUID NULL, war_until TIMESTAMPTZ NULL,
  war_score_us INT DEFAULT 0, war_score_them INT DEFAULT 0
)
gang_members  (gang_id FK, character_id FK UNIQUE, role TEXT CHECK (IN ('soldier','capo','underboss','boss')))
districts     (id TEXT PK, holder_gang UUID NULL, garrison NUMERIC DEFAULT 0, seized_at TIMESTAMPTZ)
bounties      (target_character UUID PK, amount NUMERIC, posted_by UUID, reason TEXT)
listings      (id UUID PK, seller UUID, item_kind TEXT, item_id TEXT, qty INT, unit_price NUMERIC, escrowed BOOL)
searches      (hunter UUID PK, target UUID, started_at TIMESTAMPTZ)   -- one active contract each
notifications (id UUID PK, character_id FK, type TEXT, payload JSONB, delivered BOOL DEFAULT false)
  -- replaces the prototype's inbox_*; types: attack, attempt, whacked, busted,
  -- witness, sale, ref — payloads identical to v24's event objects
referrals     (recruit_account UUID PK, recruiter_account UUID, qualified_at TIMESTAMPTZ NULL)
```

### 3.4 Economy & integrity

```sql
transactions (
  id BIGSERIAL PK, at TIMESTAMPTZ DEFAULT now(),
  character_id UUID NULL, account_id UUID NULL,
  currency TEXT CHECK (IN ('cash','omr','cb','ammo')),
  amount NUMERIC,                 -- signed
  reason TEXT,                    -- 'crime:jewelry', 'swap:buy', 'whack:chop', 'tax', ...
  counterparty UUID NULL,         -- other character in transfers (nullable for faucets/sinks)
  ref_id UUID NULL                -- listing/bounty/etc.
)
amm_pool     (id INT PK CHECK (id=1), cash_reserve NUMERIC, omr_reserve NUMERIC)  -- row-locked on swap
street_tax   (id INT PK CHECK (id=1), pool NUMERIC, fund NUMERIC, last_buyback TIMESTAMPTZ)
vouchers     (id UUID PK, account_id FK, kind TEXT, amount NUMERIC, nonce TEXT UNIQUE,
              signed_payload TEXT, claimed_onchain BOOL DEFAULT false)             -- §11
seasons      (n INT PK, starts DATE, ends DATE)
rng_audit    (id BIGSERIAL, at TIMESTAMPTZ, character_id UUID, action TEXT, roll NUMERIC, outcome TEXT)
telemetry    (id BIGSERIAL, at TIMESTAMPTZ, account_id UUID, event TEXT, props JSONB)
bans         (account_id FK, kind TEXT, reason TEXT, by_mod TEXT, until TIMESTAMPTZ NULL)
```

**Indexes that matter:** `characters(respect DESC) WHERE alive` (the Streets), `characters(loc)`, `notifications(character_id) WHERE NOT delivered`, `transactions(character_id, at)`, `listings(item_kind)`, `cars(character_id)`.

---

## 4. Authentication & sessions

- **X OAuth 2.0** and **Privy** produce `(auth_provider, auth_subject)`; **guest** creates a device-bound account upgradeable later (preserving the account row, so possessions survive the upgrade).
- Sessions: short-lived JWT (15 min) + refresh token. The JWT carries `account_id` only; the server resolves the living character per request.
- **Agent API keys:** separate key type per account, rate-limited harder (§10.2), sets `agent_flag = true` permanently (referral exclusion, 🤖 badge). One human account may hold agent keys; the *account* is flagged, matching v24's rule.
- Social-task verification (First Week): X follow via OAuth'd relationship check; Discord join via bot member lookup; GitHub star via API. Each verifies **once**, writes `onboard`, and pays through the normal transaction path.

## 5. API surface

All endpoints REST + JSON under `/v1`. Every mutating endpoint: authenticated, idempotency-key header honored, rate-limited (§10.2), and returns the full updated character view (client re-renders from response; no client-side math).

**Convention:** `⏱` = subject to lazy accrual before executing (§7.1). `🎲` = server RNG, logged to `rng_audit`.

### 5.1 Character & progression
| Method & path | Body | Effect |
|---|---|---|
| `GET /me` | — | Full character + account view (the only "state" the client ever has) ⏱ |
| `POST /character` | `{name, referralCode?}` | Create character; resolve referral code (= recruiter's character name) to `referrals` row |
| `POST /crimes/:id` | — | ⏱🎲 Crime resolution per §7.2 |
| `POST /train/:stat` | — | ⏱ Gym per §7.3 |
| `POST /heal` | — | ⏱ Doc: cost `(100−health)×15×rankDocMult` |
| `POST /checkin` | — | ⏱ Daily check-in per §7.4 |
| `POST /heist` | — | ⏱🎲 Daily Score (8h cooldown) |
| `POST /missions/:id` | — | Validate reqs (incl. `trade` ≥ trade_rep), pay once |
| `POST /path` | `{path}` | First pick $10,000 at level ≥5; switch 25 $OMR |
| `POST /onboard/:taskId/claim` | — | First Week claim; social tasks verify per §4 first |
| `POST /travel/:district` | — | $250; sets `loc` |
| `POST /items/:id/use` | — | Apply `fx` (hp/en/nv/cool/jail0) with caps |

### 5.2 Garage & violence
| Endpoint | Effect |
|---|---|
| `POST /garage/boost` | ⏱🎲 GTA per §7.5 (cooldown 300 s, cap 12 cars) |
| `POST /garage/:carId/melt` | Melt per §7.5; 25% tithe → gang `ammo_bank` + treasury credit $30/round, atomically |
| `POST /garage/:carId/repair` | 🎲 cost `dmg% × carVal × 0.2`; success `(rare?50:100)−dmg`% |
| `POST /garage/:carId/fence` | `carVal × 0.5 × condition × eventFenceMult`, 2% take |
| `POST /streets/:targetId/jump` | ⏱🎲 Fight per §7.6; notification to victim |
| `POST /streets/:targetId/search` | Start hit contract; **3 h** production timer |
| `POST /streets/:targetId/fire` | `{rounds}` ⏱🎲 Hit resolution per §7.7 — same-district check against victim's live `loc` |
| `POST /streets/:targetId/bust` | 🎲 Bust per §7.8 |
| `POST /streets/:targetId/bounty` | `{amount≥500}` escrow +2% take; paid to hospitalizer/killer, never the poster |
| `POST /armory/gun/:id/buy` · `/equip` · `POST /armory/vest/:id` · `POST /armory/ammo` | Purchases; vest is $OMR burn |

### 5.3 The Kitchen
| Endpoint | Effect |
|---|---|
| `POST /kitchen/makings/:drugId` | `{qty}` price `makingsPriceOf × eventMkMult`; trade-rank gate |
| `POST /kitchen/lab/upgrade` | Sequential tier; Facility/Cathedral burn $OMR |
| `POST /kitchen/cook` | `{drugId, qty}` starts batch (cap, makings, 1 📦/20 units); **prod timers = demo×12** |
| `POST /kitchen/collect` | 🎲 fire roll then quality roll per §7.10 |
| `POST /kitchen/deal` | `{drugId, qty}` ⏱🎲 price/heat per §7.10; nerve 1 per 10 units |
| `POST /kitchen/crew/hire` | $50k × (crew+1), max 5 |
| `POST /kitchen/laylow` | $5,000 + 25 energy → −25 heat |
| `POST /kitchen/cleanpapers` | 10 $OMR → heat 0 |

### 5.4 Economy
| Endpoint | Effect |
|---|---|
| `POST /bank/deposit` · `/withdraw` | Interest accrues lazily: 2% per 12 h on banked |
| `GET /exchange` · `POST /exchange/list` · `POST /exchange/:id/buy` · `DELETE /exchange/:id` | Escrowed order book; 2% take on fill; **product (drugs) is rejected as item_kind** |
| `GET /market/prices` | Deterministic goods/demand/makings prices for the current 4 h block (server-computed, §7.11) |
| `POST /goods/buy` · `/sell` | District prices × turf ±5% × event × Ledger +5% |
| `POST /workshop/craft/:id` · `POST /workshop/ammo` | Crate + cash sinks |
| `POST /assets/:id/buy` · `/sell` | Sell-back at 70% |
| `POST /rackets/:id/buy` | Level-gated |
| `POST /swap` | `{direction, amount}` §7.12 — row-lock `amm_pool`, min $500, 2% take |
| `POST /stake` · `/unstake` · `/claim-rewards` | 14% APY, lazily accrued on account row |
| `POST /gear/:id/mint` | $OMR burn → `account_gear`; phase 2 also enqueues cNFT mint |

### 5.5 Family
`POST /gangs` (found: level ≥5, $25k) · `POST /gangs/:id/apply` · `/accept` · `/kick` · `/promote` · `POST /gangs/leave` · `POST /gangs/tribute {amount}` · `POST /gangs/war/:targetGangId` ($10k, 30 min prod: consider 24 h — flag for design call) · `POST /districts/:id/seize` (treasury cost `max(30000, garrison×1.5)`).
Weekly tasks progress server-side via the same actions that call `bumpFamilyTask` in v24 (tribute, jump, crime, melt, gta, deal, recruit).

### 5.6 Realtime (WebSocket channels)
- `streets` — top-100 board diffs, kill/bust feed (public)
- `me` — notifications push (replaces the 20 s inbox poll)
- `gang:{id}` — treasury/war/weekly updates

## 6. The server-side rule set — global formulas

All constants live in one `rules.ts` module, exported as data, mirroring the prototype's tables verbatim (CRIMES, CARS×TRIMS, GUNS, VESTS, DRUGS, KITCHENS, TRADE_RANKS, PATHS, RACKETS, ASSETS, MARKET, CONSUMABLES, GOODS, CITY_EVENTS, DAILY_POOL, FAMILY_TASKS, MISSIONS, RANKS, DISTRICTS, ONBOARD_TASKS, RECRUIT_MILESTONES — 350+ entries, copy them from v24, do not retype).

```
level        = floor(sqrt(respect / 4)) + 1
maxEnergy    = 50 + 2×level + assetEnergyCap        maxNerve = 10 + level
regen / min  : energy +40 (+20 at rank Runner+), nerve +20 (+20 on Cathedral Hill turf),
               health +20            (prototype tick ×3 s → per-minute equivalents)
rankPayoutMult = 1.05 (Hustler+) × 1.10 (Mob Boss+)
eff(stat)    = base + Σ owned gear boosts + Σ asset boosts
```

## 7. The server-side rule set — per-system resolution

### 7.1 Lazy accrual (runs before any ⏱ action, and on `GET /me`)
```
dt        = now − last_accrued_at   (cap dt at 8 h for income/crew, uncapped for regen decay)
energy    = min(maxEnergy, energy + regenRate×dt)
nerve     = min(maxNerve,  nerve  + nerveRate×dt)
health    = min(100, health + 20×dt_min)
jail/hosp = timestamp comparisons, no state change needed
bank     += bank × 0.02 × (dt / 12 h)
cash     += racketIncomePerMin × dt_min(≤8h) × ledgerMult(1.1) × eventRacketMult
rewards  += staked × 0.14 / (365×24×60) × dt_min          -- production: real APY, not demo-accelerated
heat      = max(0, heat − 1×dt_min×eventHeatDecay) then + crew heat (below)
CREW:     units = min(stashTotal, crew × dt_min(≤8h)); sell cheapest lines first at
          base × quality × 0.8 (use demand=1.0 for offline windows);
          heat += drug.heat × units × 0.1; trade_rep += proceeds
RAID:     while heat>60 over the window: P = (heat−60)/2000 per minute →
          roll once per accrued window with 1−(1−p)^minutes; on raid:
          stash ×= uniform(0.30,0.60), jail = 60–120 s, heat −= 40, notification
BATCH:    if batch.done_at ≤ now, leave for explicit /collect (fire roll happens there)
last_accrued_at = now  — all inside one transaction with the action itself
```

### 7.2 Crimes
```
chance  = min(0.97, base + cunning×0.004 + speed×0.002 + gangLevel×0.02
              + brickYardsTurf×0.02 + rankSuccessBonus)
success: pay uniform(cash range) × canalRow(+10%) × rankPayoutMult × eventJobPay
         respect × eventCrimeRep; crates: P = (0.25+nerve×0.02)×eventCbMult×docksTurf(1.5)
         → 1+floor(nerve/8);  makings drop: P=0.15, random unlocked line, 1+floor(nerve/6)
fail:    jail = c.jail × eventJailMult × rankJailMult(0.8 at Soldier+)
```

### 7.3–7.4 Gym & dailies
Train: 10 energy; gain `max(1, round(uniform(1,3) × 200/(200+stat)))`.
Check-in: `$250×level + $100×level×min(streak,7)` +20 energy; a missed day **halves** the streak. Daily jobs: 3 drawn by `(day + 2i) mod pool` — deterministic, no storage of the draw needed.

### 7.5 Garage
Boost: cooldown 300 s, 10 energy, `P = min(0.9, 0.35 + speed×0.01 + cunning×0.005 + eventBoostAdd)`; fail → jail 15–30 s. Roll model by weight, trim by weight, dmg uniform 0–60. Melt yield `max(5, round(model.melt × trim.melt × (1−dmg/150)))`; if in gang: 25% of rounds → `ammo_bank`, treasury += tithe×$30 (same transaction).

### 7.6 Jumps
```
atk = (muscle + speed×0.5 + gunFp×0.4 + rankAtkBonus) × gunPath(1.1) + uniform(0,25)
def = (their muscle + speed×0.5 + fp×0.4) + uniform(0,25)
win: steal min($25k, pocket × (0.15 + war 0.10 + eventStealAdd)); crates ≤3;
     respect ×eventJumpRep ×war(2); victim hosp 3 min + notification; war score++
25 energy, 5 rounds; blocked: same gang, target hosp'd, self, health<20
```

### 7.7 Hit contracts (production timers)
Search **3 h** (one active); fire: gun equipped, 40 energy, rounds ≥50, same district as victim's **live** loc, `shoot_cd` clear, victim not hosp'd/same-family.
```
btk       = (250 + 80×victimLevel + 12×victimMuscle) × vestMult
jam       : P = 1−gun.rel → burst ×0.75
effective = rounds × (0.7 + fp/50) × jamMult × gunPath(1.15)
KILL  → respect +max(10, 2×lvl); chop = floor(victimFleetValue × 0.40) cash
        (computed from the victim's actual cars rows — value-conserving, AUDIT R5);
        bounty pays if poster ≠ shooter; victim gets 'whacked' notification;
        witnesses: 3 random online-recent characters get 'witness';
        victim death runs §7.9 SERVER-SIDE immediately (not on their next login)
MISS  → shoot_cd = **2 h**; victim notified with shooter's name, dmg 5–15
```

### 7.8 Busting
`P = clamp(0.7 − remaining/400 + busts×0.03 + eventBustAdd, 0.10, 0.90)`; reward `$500 + $15×remaining_s`, +3 respect, busts++; fail → 180 s jail. No self-busts.

### 7.9 Death — The Estate (server-side, atomic)
On kill: mark character `alive=false`; convert `floor(level/2)` → account prestige; create heir row (`generation+1`), cash `= 500 + 100×prestige`; remove from gang; clear bounty. **Account keeps:** omr, staked, rewards, wallet, gear, prestige, recruits, onboard, checkins, deaths+1. **Dies:** everything on `characters` + street tables (cars, stash, makings, rackets, assets, cargo, guns, items, missions, batch). The estate report is returned as a notification payload.

### 7.10 The Kitchen
Cook: rank-gated, batch cap by kitchen, 1 📦/20 units, duration `mins×12` (prod). Collect: fire `P = kitchen.fire` → batch lost, −20 hp, +5 heat; else `q = clamp(0.7 + cunning×0.004 + kitchen.q + kitchenPath(0.15) + uniform(−0.1,0.1), 0.6, 1.6)`, stash merges with weighted-average quality.
Deal: `unit = base × demand(drug,district) × quality × eventDrugDemand × (1+tradeRankBonus)`; heat `+ drug.heat × units × 0.1 × eventDrugHeat × kitchenPath(0.75)`; 2% take; trade_rep += gross; nerve 1/10 units.

### 7.11 Deterministic markets
Goods prices, drug demand, and makings prices all derive from `hash01(key + ":" + block + ":" + SEED)` where `block = floor(epoch_hours/4)`. Port `hash01` byte-for-byte; keep `SEED` server-secret per season so nobody precomputes future blocks. `GET /market/prices` returns the current block's numbers so the client never computes them.

### 7.12 Swap & buyback
Constant-product AMM, single row, `SELECT … FOR UPDATE`:
`out = reserveOut − k/(reserveIn + amountIn)`; min swap $500; 1% dev + 1% street tax each direction (taken in cash before/after the curve, as in v24). Buyback every 12 h (worker): pool buys $OMR through the same curve; 50% → event fund, 50% split pro-rata across top-25 gangs into `omr_reserve`; remainder → fund.

### 7.13 Referrals & recruiting (v24)
Qualification check runs server-side whenever a referred character crosses any of: level 8, 40 jobs, 3 check-ins, $25k net worth — all four required, once ever per account. Then atomically: recruiter +$10,000 (+3 $OMR **only if** street-tax fund ≥ 4), recruit +$5,000, `recruits++`, milestone payouts (1/3/5/10/25 → cash/fund-$OMR/titles), gang weekly `recruit` progress, both notified. `agent_flag` accounts are excluded on both sides. Same-IP recruiter/recruit pairs auto-flag for review (§10.3).

## 8. City events, seasons, ranks
Event of day = `CITY_EVENTS[day mod 16]`, day = UTC date number — pure function, no storage. Season = 28-day windows from a fixed epoch; rollover worker converts level→prestige and resets respect for all living characters (batched). Ranks/perks: identical table; all perk applications are shown inline in §7 formulas.

## 9. Demo → production timer table

| System | Demo (v24) | Production |
|---|---|---|
| Hit search | 10 min | **3 h** |
| Failed-shot cooldown | 5 min | **2 h** |
| GTA boost cooldown | 300 s | 300 s (unchanged) |
| Cook times | 10–45 min | **×12** (2–9 h) |
| Staking display | accelerated | real 14% APY |
| War duration | 30 min | design call: 30 min vs 24 h — decide in alpha |
| Regen, jail, hospital, price blocks, buyback (12 h), season (28 d) | unchanged | unchanged |

## 10. Integrity, anti-cheat, moderation

**10.1 Validation doctrine.** Every endpoint re-derives cost, gate, and cooldown from DB state; client-sent numbers are only *choices* (which crime, how many rounds), never *values*. All multi-party actions (jump, whack, bust, exchange fill, tithe, war) are single DB transactions with row locks on both parties.

**10.2 Rate limits (Redis, per account):** human keys ~1 mutating action/s burst 5; agent keys 1/3 s hard (mirrors the prototype's agent cadence); swaps 6/min; searches 1 active. 429 with retry-after.

**10.3 Dupe/IP controls (the IG lesson):** log account↔IP pairs; flag transfers (exchange fills, tribute, bounty claims, referral qualification) between same-IP accounts for review; penalty-points model → shadow list → mod action. Mod endpoints: ban, mod-kill (runs §7.9 without a killer), confiscate, and a read-only audit view over `transactions` + `rng_audit`.

**10.4 Ledger invariants (nightly job):** Σ cash across characters + gang treasuries + escrows − Σ(faucets) + Σ(sinks) = 0 within rounding; $OMR conservation across accounts + AMM reserve + fund + reserves; car count conservation (boost is the only faucet, melt/fence/death the only sinks). Alert on drift > $1.

## 11. Solana service (phase 2, isolated)
Off-chain remains authoritative for gameplay; the chain settles **withdrawals and ownership proofs**. Signed-voucher flow: server writes `vouchers` row + Ed25519-signs `(account, kind, amount, nonce)`; player claims on-chain; program verifies signature + nonce; a watcher marks `claimed_onchain`. cNFT gear mints via Metaplex Bubblegum on `gear/:id/mint`; holdings verified via DAS on wallet link. Buyback bot executes through Jupiter from a Squads multisig; Pyth prices SOL legs. The service can read the DB and write ONLY `vouchers` — a compromised bot cannot mint gameplay value.

## 12. Telemetry (alpha priorities)
`session_start/end`, `first_week_step`, every economy transaction (already the ledger), `crime_attempt{id,success}`, `kill{rounds,btk}`, `raid`, `deal{drug,units,heat}`, `referral_qualified`, `death`, `season_convert`. Dashboards: D1/D7 retention by First-Week completion depth; $-faucet/sink balance per day; kill frequency; heat distribution; path distribution.

## 13. Build plan (suggested)
1. **M1 — skeleton (1–2 wk):** auth, `GET /me`, accrual engine, crimes/gym/bank/travel. *Playable solo loop.*
2. **M2 — economy (1–2 wk):** garage, workshop, exchange, goods, rackets/assets, swap+buyback worker, ledger invariants.
3. **M3 — social (2 wk):** gangs, wars, turf, jumps, bounties, notifications, websocket, hit contracts + death, busting.
4. **M4 — Kitchen + growth (1–2 wk):** full §7.10, paths, trade ranks, First Week (with real OAuth verifies), referrals, telemetry, mod tools.
5. **M5 — alpha hardening:** rate limits, invariant alerts, backups, invite codes. → closed alpha.
6. **M6 — chain service** per §11, devnet first, third-party audit before mainnet.

---
*End of specification. Companion artifacts: `omerta-game-v24.jsx` (rules source), The Codebook v23 (player-facing numbers).*
