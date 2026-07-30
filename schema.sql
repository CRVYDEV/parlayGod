-- OMERTÀ backend — M1 schema (see omerta-backend-spec.md §3)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  auth_provider TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_ip TEXT, last_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, auth_subject)   -- one account per real identity (audit: no dup-identity race)
);
CREATE TABLE IF NOT EXISTS account_persistent (
  account_id TEXT PRIMARY KEY,
  prestige INT NOT NULL DEFAULT 0,
  omr NUMERIC NOT NULL DEFAULT 0,
  staked NUMERIC NOT NULL DEFAULT 0,
  rewards NUMERIC NOT NULL DEFAULT 0,
  -- Make-Risk-Pay: unstaked principal UNBONDS for UNSTAKE_CD_MS before it is liquid — during the
  -- window it earns no yield and IS lootable (whack:loot), so the stake→extract path always has
  -- an exposure window. Released to `omr` lazily on accrual once unbond_at passes.
  unbonding NUMERIC NOT NULL DEFAULT 0,
  unbond_at TIMESTAMPTZ,
  wallet_address TEXT,
  recruits INT NOT NULL DEFAULT 0,
  onboard TEXT NOT NULL DEFAULT '{}',
  checkins_lifetime INT NOT NULL DEFAULT 0,
  referred_by TEXT, ref_paid BOOLEAN NOT NULL DEFAULT false,
  ref_spark BOOLEAN NOT NULL DEFAULT false,  -- the stepped EARLY referral payout fired (before full qualification)
  ref_l2_paid BOOLEAN NOT NULL DEFAULT false,  -- the tier-2 "family tree" finder's fee (to the grandrecruiter) fired for THIS account's qualification
  agent_flag BOOLEAN NOT NULL DEFAULT false,
  -- THE POPULATION: an NPC resident's account. The agent_flag TWIN — the account-level exclusion hook
  -- for the human-only surfaces (the Street Wage above all: a resident drawing emission would be theft
  -- from the endowment). Most other leaderboards need no change, since they rank by legend columns a
  -- resident never accrues — but any FUTURE step that gives residents a legend must exclude them on
  -- that board at the same time.
  npc_flag BOOLEAN NOT NULL DEFAULT false,
  deaths INT NOT NULL DEFAULT 0,
  -- §11 real-ETH entry fees (paid on-chain to OmertaFees, forwarded straight to the dev
  -- wallet — never in-game currency, never touches the §10.4 ledger). `minted` = paid the
  -- 0.01 ETH mint fee (the two-tier gate: only minted accounts can withdraw/mint gear).
  -- `mint_credits` / `respawn_tokens` are unspent on-chain payments the watcher credited.
  minted BOOLEAN NOT NULL DEFAULT false,
  mint_credits INT NOT NULL DEFAULT 0,
  respawn_tokens INT NOT NULL DEFAULT 0,
  -- unspent paid stat RE-ROLLS (0.01 ETH each on-chain → RerollFeePaid → the watcher credits one);
  -- spent via POST /v1/character/reroll to re-roll the living character's (total-conserved) build.
  reroll_credits INT NOT NULL DEFAULT 0,
  -- M7 Phase 2 — the assassin's LEGEND (account-level, survives death like prestige/$OMR):
  -- lifetime feared-reputation (the "most feared" ladder) + lifetime confirmed kills.
  hitman_rep BIGINT NOT NULL DEFAULT 0,
  kills INT NOT NULL DEFAULT 0,
  boxing_wins INT NOT NULL DEFAULT 0,   -- lifetime fighter wins across the stable (a career legend that SURVIVES DEATH — the hitman-rep precedent)
  racer_wins INT NOT NULL DEFAULT 0,    -- lifetime racing-animal wins across the stable (a career legend that SURVIVES DEATH — the boxing-legend precedent)
  cartel_damage NUMERIC NOT NULL DEFAULT 0,   -- (World step two) lifetime cash looted from NPC rival families — THE WAR EFFORT (status, survives death)
  intel_ops INT NOT NULL DEFAULT 0,   -- (Wire step two) lifetime intel actions run — THE SPYMASTER (status, survives death)
  race_wins INT NOT NULL DEFAULT 0,   -- STREET RACES: lifetime race wins — THE WHEEL legend (status, survives death — the boxing-legend precedent)
  smuggled NUMERIC NOT NULL DEFAULT 0,   -- THE PORT step three: lifetime contraband value landed (clean collect + piracy take) — THE SMUGGLER'S LEGEND (status, survives death)
  -- NOTE: characters.active_at (Skills step two — shared skill-active cooldown) is added on the characters table below
  -- THE DYNASTY: the account-level RWA book survives death, so it's a generational fund — name it
  -- (a $OMR vanity sink). The name outlives every character and heads the legit-legend leaderboard.
  dynasty_name TEXT,
  -- THE LAW Phase 4 — the informant's mark. Set the moment an account turns state's evidence
  -- (`flip`): a permanent badge that FOLLOWS THE BLOODLINE (the heir carries it, like prestige) and
  -- makes the account a contract magnet — it VOIDS FAMILY OMERTÀ (fire/npcHit/postBounty on a rat
  -- ignore the family check, so even their own family — and the whole town, via the waived
  -- directed-contract floor — can hunt them). Pure status — no §10.4 surface.
  rat BOOLEAN NOT NULL DEFAULT false,
  -- THE STORE (ETH revenue packages) — account-level entitlements a real-ETH purchase grants. Both
  -- SURVIVE DEATH (a paid-for benefit carries to the heir, the `minted` precedent). `pass_until` is
  -- the Season Pass window; `patron` is the permanent ETH-patron status badge. NEITHER is §10.4
  -- currency — the Store grants only entitlements/access/status, so it writes zero `transactions` rows.
  pass_until TIMESTAMPTZ,
  patron BOOLEAN NOT NULL DEFAULT false,
  wire_pending_days INT NOT NULL DEFAULT 0,  -- Store wire window bought with no living character (audit): parked here, applied at the next character's birth so a paid benefit is never dropped

  -- THE LEDGER (Season Pass reward track): a daily-claim track unlocked while the pass is active.
  -- pass_tier = highest tier claimed THIS season (reset when a fresh pass season starts); pass_at =
  -- the last claim (the ~daily cooldown). Account-level → the track survives death (the heir keeps
  -- claiming what the pass paid for). Rewards are status/consumables + a backed prize-pool $OMR stipend.
  pass_tier INT NOT NULL DEFAULT 0,
  pass_at TIMESTAMPTZ,
  -- THE DYNASTY FUND (RWA dividends + tiers): rwa_invested = cumulative $OMR ever invested (monotonic
  -- — drives the status tier ladder, never decreases). dividend_at = the last dividend claim (the
  -- ~daily cooldown). Dividends are paid from the sink-fed rwa_dividend_pool (a §10.4 transfer, never
  -- a mint — the stake-pool precedent), so holding RWA becomes a productive, generational asset.
  rwa_invested NUMERIC NOT NULL DEFAULT 0,
  dividend_at TIMESTAMPTZ,
  -- the Ledger's $OMR stipend is ACCRUED here at claim (in the same txn as the tier advance — never
  -- lost), then paid down from the backed prize pool by settlePassStipend (pool-bounded). Decoupling
  -- the durable owe from the pool payout means an empty/contended pool never consumes a reward and a
  -- payout failure never mis-advances the track (the stake-pool "pending, no forfeit" precedent).
  pass_owed NUMERIC NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  generation INT NOT NULL DEFAULT 1,
  alive BOOLEAN NOT NULL DEFAULT true,
  respect BIGINT NOT NULL DEFAULT 0,
  energy NUMERIC NOT NULL DEFAULT 50,
  nerve NUMERIC NOT NULL DEFAULT 10,
  health NUMERIC NOT NULL DEFAULT 100,
  cash NUMERIC NOT NULL DEFAULT 500,
  bank NUMERIC NOT NULL DEFAULT 0,
  muscle INT NOT NULL DEFAULT 5,
  cunning INT NOT NULL DEFAULT 5,
  speed INT NOT NULL DEFAULT 5,
  jail_until TIMESTAMPTZ,
  hosp_until TIMESTAMPTZ,
  loc TEXT NOT NULL DEFAULT 'docks',
  path TEXT,
  title TEXT,
  streak INT NOT NULL DEFAULT 0,
  checkin_day INT NOT NULL DEFAULT 0,
  lc_crime INT NOT NULL DEFAULT 0,
  ammo INT NOT NULL DEFAULT 25,
  cb INT NOT NULL DEFAULT 0,
  heat NUMERIC NOT NULL DEFAULT 0,
  trade_rep BIGINT NOT NULL DEFAULT 0,
  gta_at TIMESTAMPTZ,
  gun TEXT,
  vest TEXT,
  shoot_cd_until TIMESTAMPTZ,
  busts INT NOT NULL DEFAULT 0,
  lab TEXT,
  crew INT NOT NULL DEFAULT 0,
  crew_paid_at TIMESTAMPTZ,                         -- recurring sinks: crew wages ("the nut") accrue off this clock; unpaid past the window the crew downs tools
  heist_at TIMESTAMPTZ,
  season INT NOT NULL,
  -- §11 two-tier: mirrors account_persistent.minted onto the living street (and its heirs)
  -- so the character view can show "made" status. Account-level `minted` is the gate truth.
  minted BOOLEAN NOT NULL DEFAULT false,
  -- M7 Phase 2 — this STREET's kills this season (the fresh, contestable board); resets on
  -- season rollover and starts at 0 for an heir (dies with the man, unlike the account legend).
  season_kills INT NOT NULL DEFAULT 0,
  -- FIVE PILLARS #1 — HONOR ↔ INFAMY (−100..+100): the Fable identity axis, moved by deeds at
  -- existing sites (repay/save/settle vs welsh/rat/shank/oathbreak). NUMERIC so set-based clamped
  -- arithmetic (GREATEST/LEAST) is pg-mem-safe. Dies with the street; the heir echoes ×0.25.
  honor NUMERIC NOT NULL DEFAULT 0,
  npchit_at TIMESTAMPTZ,                          -- M7 Phase 3: NPC-hitman hire cooldown
  safe_until TIMESTAMPTZ,                          -- M7 Phase 4: safehouse — untargetable by fire/NPC-hit
  guard_price NUMERIC,                             -- M7 Phase 4: bodyguard-for-hire listing (NULL = not offering)
  fade_limit NUMERIC,                              -- Den step 2: open back-room dice challenge limit (NULL = not fading)
  poker_limit NUMERIC,                             -- Den step 3: open heads-up poker challenge limit (NULL = not dealing)
  -- D3: per-account daily cap on the PUBLIC wash route (a token bucket, like a business front's
  -- launderCapDay — heat was the only brake and it decays in minutes)
  wash_used NUMERIC NOT NULL DEFAULT 0,
  wash_at TIMESTAMPTZ,
  -- L3b — THE SHIELD CAP: a rolling-window token bucket on total safehouse TIME per day (the wash-bucket
  -- twin), so the earned survival shield can't keep a whale permanently off-grid. Refills
  -- SAFEHOUSE_DAILY_CAP_MS per day; entering a safehouse charges the granted stay against it.
  safehouse_used NUMERIC NOT NULL DEFAULT 0,
  safehouse_at TIMESTAMPTZ,
  -- R1 audit F1: rolling-window cumulative $OMR invested into the Portfolio (the wash-bucket twin),
  -- so structuring (many sub-threshold buys) still draws RICO scrutiny once the window sum crosses.
  rwa_used NUMERIC NOT NULL DEFAULT 0,
  rwa_at TIMESTAMPTZ,
  respec_at TIMESTAMPTZ,                           -- D7: 24h between stat respecs (opposed rolls are shape-sensitive)
  guarded_by TEXT,                                 -- M7 Phase 4: my hired bodyguard's character id
  guarded_until TIMESTAMPTZ,                       -- M7 Phase 4: protection window (one absorb, then consumed)

  -- D2b: rolling racket/front income budget (a refilling token bucket of income-eligible
  -- ms). Caps total racket income to RACKET_DAILY_CAP hours/day regardless of how often a
  -- player touches an action, closing the "collect every <8h → ~24h/day" multiplier.
  -- Seeded at OFFLINE_CAP_MS so a first collect still yields the normal 8h burst.
  racket_credit_ms BIGINT NOT NULL DEFAULT 28800000,
  bank_credit_ms BIGINT NOT NULL DEFAULT 28800000,   -- Risk-to-Earn B2: daily bank-interest budget (seeded at OFFLINE_CAP_MS)
  -- Make-Risk-Pay: fresh deposits stay "in transit" for BANK_CLEAR_MS — the courier hasn't reached
  -- the vault, so a fire-kill loots CASH_LOOT_RATE of them too (cleared lazily on accrual).
  bank_intransit NUMERIC NOT NULL DEFAULT 0,
  bank_intransit_at TIMESTAMPTZ,
  -- THE LAW — the rap sheet. `heat_exposure` is the investigation meter: heat sustained above
  -- LAW.WATCH builds it lazily (§7.1, the business-scrutiny precedent), it bleeds passively, and
  -- crossing LAW.INDICT_AT files an indictment (`indicted_at` latch). A lawyer `retainer_until`
  -- softens the bust; `jury_bought` is a one-shot conviction-P cut for the current case; a rat's
  -- `witpro_until` is a state-funded untargetable relocation window. All reset with the street
  -- (the heir's row is fresh) — only the account-level `rat` badge follows the bloodline.
  heat_exposure NUMERIC NOT NULL DEFAULT 0,
  indicted_at TIMESTAMPTZ,
  retainer_until TIMESTAMPTZ,
  jury_bought BOOLEAN NOT NULL DEFAULT false,
  witpro_until TIMESTAMPTZ,
  world_raid_at TIMESTAMPTZ,                       -- THE LIVING WORLD P2: per-character NPC-raid cooldown
  pen_safe_until TIMESTAMPTZ,                      -- THE PEN: in-jail protection window (paid the yard boss — can't be shanked)
  hole_until TIMESTAMPTZ,                          -- THE PEN step two: solitary (a caught shank) — no yard actions, untouchable
  pen_faction TEXT,                                -- THE PEN step five: the yard crew this inmate runs with (cover from shanks; only functional while jailed)
  shank_at TIMESTAMPTZ,                            -- THE PEN: per-attacker shank cooldown (SIGN-OFF Tier 3) — direct-SQL, outside persistCharacter
  train_at TIMESTAMPTZ,                            -- PACING: per-session gym cooldown — direct-SQL, outside persistCharacter
  mission_at TIMESTAMPTZ,                          -- PACING: cooldown between mission claims (stops the ladder cascading) — direct-SQL
  welsher BOOLEAN NOT NULL DEFAULT false,          -- LOAN SHARKING: defaulted on a debt — can't borrow again (dies with the street)
  wanted_until TIMESTAMPTZ,                         -- LOAN step 4: WANTED — a defaulter under active pursuit (omertà stripped + NPC hunters + a pool bounty) until it lapses or they square up
  envelope_until TIMESTAMPTZ,                       -- THE ENVELOPE: standing graft to the cops — investigation meter builds slower while current (a $OMR sink)
  wire_until TIMESTAMPTZ,                           -- THE WIRE: the Street Wire premium-intelligence subscription window (a $OMR sink)
  wire_tier INT NOT NULL DEFAULT 0,                 -- THE WIRE step five: the active subscription TIER (0 none/lapsed; 1 Street Wire, 2 Wire Room, 3 Switchboard) — written by direct SQL (the disinfo_until pattern, off the persist positional UPDATE)
  disinfo_until TIMESTAMPTZ,                        -- THE WIRE step three: DISINFORMATION — while current, any WIRETAP reading you gets cooked private signals (a $OMR sink; an informant sees through it)
  active_at TIMESTAMPTZ,                            -- SKILLS step two: shared cooldown across capstone-unlocked ACTIVE abilities
  race_at TIMESTAMPTZ,                              -- STREET RACES: per-driver race cooldown (written by direct SQL, outside persist — the active_at pattern)
  port_used NUMERIC NOT NULL DEFAULT 0,             -- THE PORT: contraband bought in the rolling 24h supply window (the D3 wash-cap token bucket; direct SQL, outside persist)
  port_at TIMESTAMPTZ,                              -- …the window's start marker
  contraband NUMERIC NOT NULL DEFAULT 0,           -- THE PORT step four: warehoused landed contraband (BOOK VALUE at route.sell) — fenced later at a drifting price; direct SQL, dies with the street (heir starts at 0)
  berths INT NOT NULL DEFAULT 0,                    -- THE PORT step four: rented harbor slips — +1 fleet cap each; direct SQL
  is_npc BOOLEAN NOT NULL DEFAULT false,            -- THE POPULATION: an NPC resident (the convoys.is_npc precedent). A REAL character on every board — jumpable/contractable/robbable through the same audited paths — but excluded from the human-only surfaces (the wage, City Standing, ops, the funnel)
  npc_seed NUMERIC NOT NULL DEFAULT 0,              -- THE TURNOVER (step three): what a resident ARRIVED with. Lets the worker tell a resident who was BORN poor from one players have picked clean — a plain cash floor can't, and would respawn the cheap bands forever. Direct-SQL only (never in persistCharacter's positional UPDATE)
  last_accrued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── M2 street-side possessions (spec §3.2) ──
CREATE TABLE IF NOT EXISTS cars (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  trim_id TEXT NOT NULL,
  dmg INT NOT NULL DEFAULT 0,
  plate TEXT,                                    -- M8 vanity plate (display only, $OMR sink)
  listed BOOLEAN NOT NULL DEFAULT false,         -- Black Market escrow: the row STAYS (car conservation counts rows); melt/fence/repair reject it
  pledged BOOLEAN NOT NULL DEFAULT false,        -- Loan step 2: pledged as loan collateral — locked like `listed` (findCar/list reject); seized to the lender on default
  tune INT NOT NULL DEFAULT 0,                    -- STREET RACES: engine tune level (a cash-sink progression that adds race power)
  race_limit INT,                                 -- STREET RACES: listed to race for a wager up to this (consent-by-listing, the fade/bout pattern); NULL = not on the strip
  pink_slip BOOLEAN NOT NULL DEFAULT false,       -- STREET RACES step 2: offered for PINKS — the winner of a pink-slip race TAKES this car (ownership transfer, §10.4-neutral, cars conserve by row count). Cleared on a race/transfer.
  nos INT NOT NULL DEFAULT 0,                      -- STREET RACES step 2: nitrous charges (a per-car consumable — buy at a cash sink, spend one for a one-race power bump; absolute writes, pg-mem-safe)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- THE PORT — maritime smuggling. A boat is an ownable vessel (bought like a car): a hold (cargo scale) +
-- speed (Coast Guard evasion). A run stores its state on the row (run_until = at sea; NULL = docked). Boats
-- can be impounded/sunk (the row deleted) and die with the street (the runEstate wipe).
CREATE TABLE IF NOT EXISTS boats (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  run_until TIMESTAMPTZ,                          -- at sea until this; NULL = docked
  run_route TEXT,                                 -- the active route (risk tier)
  run_hold INT NOT NULL DEFAULT 0,                -- cargo units this run
  run_cost NUMERIC NOT NULL DEFAULT 0,            -- what the cargo cost (the fine + loss-at-risk basis)
  run_escort BOOLEAN NOT NULL DEFAULT false,      -- an escort was hired (cuts interdiction)
  hull INT NOT NULL DEFAULT 0,                    -- step two: naval upgrade — +cargo hold per level
  engine INT NOT NULL DEFAULT 0,                  -- step two: naval upgrade — +knots per level
  rendezvous BOOLEAN NOT NULL DEFAULT false,      -- step two: docked + open to receive a mid-sea handoff (consent-by-listing)
  -- NOTE: step four warehouse (characters.contraband) + berths (characters.berths) are on the characters table below
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_boats_char ON boats (character_id);
-- step two: PIRACY — one interception attempt per pirate per live run (cleared when a boat's run starts/ends/moves)
CREATE TABLE IF NOT EXISTS port_intercepts (
  boat_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY (boat_id, character_id)
);
CREATE TABLE IF NOT EXISTS character_items (
  character_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, item_id)
);
CREATE TABLE IF NOT EXISTS character_rackets (
  character_id TEXT NOT NULL,
  racket_id TEXT NOT NULL,
  PRIMARY KEY (character_id, racket_id)
);
CREATE TABLE IF NOT EXISTS character_assets (
  character_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  PRIMARY KEY (character_id, asset_id)
);
CREATE TABLE IF NOT EXISTS character_cargo (
  character_id TEXT NOT NULL,
  good_id TEXT NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, good_id)
);
-- NFT gear is ACCOUNT-side (survives death, spec §3.2)
CREATE TABLE IF NOT EXISTS account_gear (
  account_id TEXT NOT NULL,
  gear_id TEXT NOT NULL,
  minted_onchain BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, gear_id)
);

CREATE TABLE IF NOT EXISTS character_guns (
  character_id TEXT NOT NULL,
  gun_id TEXT NOT NULL,
  PRIMARY KEY (character_id, gun_id)
);

-- ── M3 social systems (spec §3.3) ──
CREATE TABLE IF NOT EXISTS gangs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tag TEXT NOT NULL UNIQUE,
  color TEXT,                                    -- M8 crest color, '#rrggbb' (display only, $OMR sink)
  seal INT NOT NULL DEFAULT 0,                   -- M8 family seal tier (display only; bought from omr_reserve)
  foundation INT NOT NULL DEFAULT 0,             -- THE FOUNDATION: family charity tier (bought from omr_reserve; public status + softens members' RICO conviction odds)
  treasury NUMERIC NOT NULL DEFAULT 0,
  omr_reserve NUMERIC NOT NULL DEFAULT 0,
  ammo_bank INT NOT NULL DEFAULT 0,
  lifetime_tribute NUMERIC NOT NULL DEFAULT 0,   -- standing for buyback payouts
  wars_won INT NOT NULL DEFAULT 0,               -- +10,000 standing each
  territory_earned NUMERIC NOT NULL DEFAULT 0,   -- (Territory step two) lifetime territory-racket income — THE EMPIRE (gang status)
  -- econ pass (audit: purchasable Commission standing): the CHAMBER ranks by THIS SEASON's showing
  -- (reset at rollover) — parked lifetime wealth no longer owns the head seat. The buyback family
  -- split keeps the lifetime formula (a different, signed surface). NUMERIC (pg-mem INT-arith quirk).
  season_tribute NUMERIC NOT NULL DEFAULT 0,
  season_wars NUMERIC NOT NULL DEFAULT 0,
  season INT NOT NULL DEFAULT 0,                 -- lazy rollover marker (the character pattern)
  weekly_week INT,
  weekly_progress NUMERIC NOT NULL DEFAULT 0,
  weekly_done BOOLEAN NOT NULL DEFAULT false,
  war_with TEXT,
  war_until TIMESTAMPTZ,
  war_score_us INT NOT NULL DEFAULT 0,
  war_score_them INT NOT NULL DEFAULT 0,
  -- THE DYNASTY FUND (family layer): the gang RWA book earns a ~daily dividend to the reserve
  -- (dividend_at = the cooldown; the stake-pool transfer, never a mint). rwa_invested = cumulative
  -- $OMR the FAMILY has invested (monotonic → the family crest tier). dynasty_name = the family fund's
  -- name (a $OMR vanity sink; heads the family-legit leaderboard). All §10.4-clean / status.
  dividend_at TIMESTAMPTZ,
  rwa_invested NUMERIC NOT NULL DEFAULT 0,
  dynasty_name TEXT,
  -- FIVE PILLARS #2/#3: oathbreaker_until = the mark a family wears after breaking a sworn pact
  -- (can't propose new treaties while marked — trust is priced). sov_points = lifetime sovereignty
  -- points from razing rival strongholds (NUMERIC, arith-safe; pure status, the war-effort twin).
  oathbreaker_until TIMESTAMPTZ,
  sov_points NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- role is the source of truth for command: 'boss' | 'underboss' | 'capo' | 'soldier'
CREATE TABLE IF NOT EXISTS gang_members (
  gang_id TEXT NOT NULL,
  character_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'soldier',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),   -- THE FOUNDATION step two: the bust-soften only helps members who joined BEFORE their indictment (freeload gate)
  PRIMARY KEY (gang_id, character_id)
);
CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  holder_gang TEXT,
  garrison NUMERIC NOT NULL DEFAULT 0,
  seized_at TIMESTAMPTZ,
  npc_holder TEXT            -- THE OCCUPATION (World step five): an apex NPC outfit garrisons this core district; a family must LIBERATE it (seizeDistrict) — the perk is dormant until then
);
INSERT INTO districts (id) SELECT 'docks'     WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='docks');
INSERT INTO districts (id) SELECT 'neon'      WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='neon');
INSERT INTO districts (id) SELECT 'foundry'   WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='foundry');
INSERT INTO districts (id) SELECT 'brick'     WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='brick');
INSERT INTO districts (id) SELECT 'canal'     WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='canal');
INSERT INTO districts (id) SELECT 'cathedral' WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='cathedral');
-- THE OCCUPATION (World step five): the apex outfits garrison 5 of 6 core districts on a FRESH map. schema.sql
-- re-runs on EVERY boot, so the guard must occupy ONLY a PRISTINE district — `seized_at IS NULL` (never taken).
-- A district that was liberated then freed by gang dissolution has holder_gang/garrison reset to NULL/0 but
-- KEEPS seized_at (set at liberation), so it stays unowned + freely-seizable and is NOT re-occupied on a later
-- reboot (audit E1). cathedral stays free — the fallback on-ramp. Keep this mapping in lockstep with rules.js
-- WORLD.OCCUPATION.
UPDATE districts SET npc_holder='dockrats' WHERE id='docks'   AND holder_gang IS NULL AND npc_holder IS NULL AND garrison=0 AND seized_at IS NULL;
UPDATE districts SET npc_holder='zappa'    WHERE id='brick'   AND holder_gang IS NULL AND npc_holder IS NULL AND garrison=0 AND seized_at IS NULL;
UPDATE districts SET npc_holder='kryl'     WHERE id='canal'   AND holder_gang IS NULL AND npc_holder IS NULL AND garrison=0 AND seized_at IS NULL;
UPDATE districts SET npc_holder='moreau'   WHERE id='foundry' AND holder_gang IS NULL AND npc_holder IS NULL AND garrison=0 AND seized_at IS NULL;
UPDATE districts SET npc_holder='volkov'   WHERE id='neon'    AND holder_gang IS NULL AND npc_holder IS NULL AND garrison=0 AND seized_at IS NULL;
-- Contract board (M7 Phase 1). One escrow pot per (target, kind):
--   'hospitalize' — collectible by a winning jump OR a completed kill
--   'kill'        — collectible ONLY by a completed hit (fire); a premium contract
-- reason + expiry are surfaced on the board; expired pots are refunded to their funders.
CREATE TABLE IF NOT EXISTS bounties (
  target_character TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'kill',
  amount NUMERIC NOT NULL,
  posted_by TEXT NOT NULL,                       -- character id of the FIRST poster (display only)
  anon BOOLEAN NOT NULL DEFAULT false,           -- hide the poster on the board
  reason TEXT,
  -- M7 Phase 2 directed contract: a named hitman has an EXCLUSIVE window (until opens_at) to
  -- fulfil it; after that it auto-escalates to open (anyone). NULL hitman = open from the start.
  hitman TEXT,
  opens_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  posted_by_gang TEXT,                           -- M7 Phase 4: set when the pot was OPENED by a family contract (board shows the family)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_character, kind)
);
-- Every account that funded a pot + how much (so a cancel/expiry refunds each fairly, and
-- none of them can collect it — closes the top-up-overwrites-posted_by self-pay bypass).
-- M7 Phase 4: a family contract's share rides the same table with contributor = the GANG id and
-- funder_gang = true — refunds go to the treasury, and NO member of the funding family collects.
CREATE TABLE IF NOT EXISTS bounty_contributors (
  target_character TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'kill',
  contributor TEXT NOT NULL,                     -- funder's character id (or gang id when funder_gang)
  amount NUMERIC NOT NULL DEFAULT 0,             -- their tracked share of the pot (for refunds)
  funder_gang BOOLEAN NOT NULL DEFAULT false,    -- true = contributor is a gang id; refund → treasury
  PRIMARY KEY (target_character, kind, contributor)
);
-- SIGN-OFF 2.4 — FAMILY-CONTRACT LAUNDERING. The funder lockout in claimBounty matched the killer's
-- CURRENT gang, so leave → kill for the pot → rejoin routed gang treasury into a personal wallet.
-- This snapshots who was in the funding family at the moment family money went in; that roster is
-- locked out for the pot's life regardless of where anyone's membership stands when the shot lands.
-- Re-snapshotted on every top-up, so a member who joins before the NEXT tranche is covered too.
-- Torn down wherever the pot is (claim, cancel, refund/expiry sweep, the target's estate).
CREATE TABLE IF NOT EXISTS bounty_gang_roster (
  target_character TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'kill',
  gang_id TEXT NOT NULL,
  character_id TEXT NOT NULL,                    -- a made man of the funding family at funding time
  PRIMARY KEY (target_character, kind, character_id)
);
-- M7 Phase 2 — one row per confirmed gameplay kill. Drives repeat-bloodline rep diminishing
-- (killer_account × victim_account) and the kill feed. victim_account = the bloodline (heirs
-- keep the account); rep is what the killer earned (0 for rookie targets / agents).
CREATE TABLE IF NOT EXISTS kill_log (
  id TEXT PRIMARY KEY,
  killer_account TEXT NOT NULL,
  victim_account TEXT NOT NULL,
  victim_name TEXT NOT NULL,
  rep INT NOT NULL DEFAULT 0,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_kill_log_bloodline ON kill_log (killer_account, victim_account);
CREATE TABLE IF NOT EXISTS searches (
  hunter TEXT PRIMARY KEY,                       -- one active contract each (§5.2)
  target TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- THE WIRE — the intelligence terminal. A wiretap is a time-boxed surveillance a watcher places on a
-- target (a $OMR sink); while live it reveals the target's Law heat / wealth-ops / whether they're
-- hunting the watcher. Reads filter expires_at + join to `alive`, so a dead party's wire goes silent;
-- the worker sweeps expired rows. Pure intel — no §10.4 currency beyond the intel:* $OMR burn.
CREATE TABLE IF NOT EXISTS wiretaps (
  watcher_character TEXT NOT NULL,
  target_character TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- step four THE WATCHDOG: once-per-tap push-alert flags (a SUBSCRIBED watcher is pushed when the
  -- tapped mark crosses into a noteworthy state) — reset on a tap place/refresh (a fresh surveillance)
  alerted_hunt BOOLEAN NOT NULL DEFAULT false,
  alerted_wanted BOOLEAN NOT NULL DEFAULT false,
  alerted_indicted BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (watcher_character, target_character)
);
CREATE INDEX IF NOT EXISTS ix_wiretaps_target ON wiretaps (target_character);
-- THE WIRE step three: a standing HUMAN source on a rival — a recurring $OMR retainer that reads deeper
-- than a wiretap AND sees through DISINFORMATION (a mole can't be fed lies like a bug). (Disinformation
-- itself is a per-character window on characters.disinfo_until.)
CREATE TABLE IF NOT EXISTS wire_informants (
  watcher_character TEXT NOT NULL,
  target_character TEXT NOT NULL,
  paid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watcher_character, target_character)
);
CREATE INDEX IF NOT EXISTS ix_wire_informants_target ON wire_informants (target_character);
-- THE WIRE step five: THE STANDING WATCH — an enrollment the worker uses to AUTO-RENEW a wiretap on a
-- mark (burning intel:watch from the watcher's $OMR each cycle, bounded by balance + the sub tier's
-- watchSlots). Persists across a tap's lapse (a tap row is deleted on expiry; this survives so the worker
-- re-places it). Gated on an active subscription; dies with either party (the runEstate wipe).
CREATE TABLE IF NOT EXISTS wire_watches (
  watcher_character TEXT NOT NULL,
  target_character TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watcher_character, target_character)
);
CREATE INDEX IF NOT EXISTS ix_wire_watches_target ON wire_watches (target_character);
-- NAMED LANDMARKS — one dedicable plaque per district, held by the highest $OMR flex. Pure STATUS
-- (display-only, outside §10.4 and the sim-audited balance — the seal/estate precedent): dedicating
-- BURNS the paid $OMR (a deflationary sink, vanity:landmark), a bigger flex takes the plaque over. The
-- name borne is the ACCOUNT's dynasty name (or the living street) — account-level, so it survives death.
CREATE TABLE IF NOT EXISTS landmarks (
  district_id TEXT PRIMARY KEY,
  holder_account TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  dedicated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Escrowed Exchange order book (§5.4): cb | ammo | item; product is rejected.
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_character TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INT NOT NULL,
  unit_price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  type TEXT NOT NULL,                            -- attack|attempt|whacked|busted|witness|sale|estate|war
  payload TEXT NOT NULL DEFAULT '{}',
  delivered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── M4 the Kitchen (spec §3.2, §7.10) ──
CREATE TABLE IF NOT EXISTS makings (
  character_id TEXT NOT NULL,
  drug_id TEXT NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, drug_id)
);
-- quality is the weighted average across merged batches
CREATE TABLE IF NOT EXISTS stash (
  character_id TEXT NOT NULL,
  drug_id TEXT NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  quality NUMERIC NOT NULL DEFAULT 1,
  PRIMARY KEY (character_id, drug_id)
);
-- one batch at a time per character
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL UNIQUE,
  drug_id TEXT NOT NULL,
  qty INT NOT NULL,
  done_at TIMESTAMPTZ NOT NULL
);

-- ── M4 growth (spec §3.2/§3.3, §7.13, §12, §10.3) ──
CREATE TABLE IF NOT EXISTS missions_done (
  character_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  PRIMARY KEY (character_id, mission_id)
);
-- The $OMR half of a mission reward pays ONCE PER ACCOUNT, not per character —
-- $OMR survives death, so a per-character check would re-mint it on every heir
-- (audit: mission $OMR is minted directly, not drawn from the fund).
CREATE TABLE IF NOT EXISTS mission_omr_claimed (
  account_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  PRIMARY KEY (account_id, mission_id)
);
CREATE TABLE IF NOT EXISTS daily_progress (
  character_id TEXT NOT NULL,
  day INT NOT NULL,
  counters TEXT NOT NULL DEFAULT '{}',
  claimed TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (character_id, day)
);
CREATE TABLE IF NOT EXISTS referrals (
  recruit_account TEXT PRIMARY KEY,
  recruiter_account TEXT NOT NULL,
  qualified_at TIMESTAMPTZ
);
-- daily "Spread the Word" social tasks: one claim per (account, day, task). Day-partitioned +
-- self-cleaning conceptually; petty cash faucet to grow organic word-of-mouth + referral volume.
CREATE TABLE IF NOT EXISTS social_claims (
  account_id TEXT NOT NULL,
  day INT NOT NULL,
  task_id TEXT NOT NULL,
  -- THE 4-HOUR STAND (founder-directed anti-abuse): a share is REGISTERED first (paid=false,
  -- posted_at stamped, proof stored), and pays only when claimed again after SOCIAL_MATURE_MS
  -- (4h) — in live verify mode the stored proof is re-checked against X (post deleted → no pay).
  -- A registration unclaimed for 48h lapses (the pending window in growth.js).
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid BOOLEAN NOT NULL DEFAULT false,
  proof TEXT,
  PRIMARY KEY (account_id, day, task_id)
);
CREATE TABLE IF NOT EXISTS telemetry (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id TEXT,
  event TEXT NOT NULL,
  props TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS bans (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT,
  by_mod TEXT,
  until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── M5 alpha hardening (spec §5, §10.2) ──
CREATE TABLE IF NOT EXISTS idempotency (
  account_id TEXT NOT NULL,
  key TEXT NOT NULL,
  status INT NOT NULL,        -- 0 = reserved/in-flight; else the stored HTTP status
  body_hash TEXT NOT NULL,    -- binds the key to one request body (audit: reject key reuse w/ different body)
  response TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  uses_left INT NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── M6-B chain service (spec §11, EVM) — the ONLY chain-facing state ──
-- A withdrawal debits the in-game $OMR ledger immediately (no double-spend), then
-- either SIGNS an EIP-712 voucher (if the funded reserve covers it) or QUEUES (full
-- reserve: the chain never owes more than the Safe has funded into VoucherClaim).
CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,                          -- 'omr' | 'gear'
  amount NUMERIC NOT NULL DEFAULT 0,           -- whole $OMR for omr; 1 for gear
  gear_id TEXT,                                -- gear class id (gear kind)
  nonce BIGINT NOT NULL UNIQUE,                -- server-unique uint256 nonce (replay guard)
  to_address TEXT NOT NULL,                    -- recipient EVM address
  deadline BIGINT NOT NULL,                    -- unix seconds (server signs short, < MAX_VOUCHER_TTL)
  status TEXT NOT NULL DEFAULT 'queued',       -- queued | signed | claimed
  signed_payload TEXT,                         -- JSON {voucher, signature}
  claimed_onchain BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Reserve accounting + nonce counter. funded_omr mirrors the OMR the Safe has funded
-- into the VoucherClaim tranche on-chain; the backend never signs beyond it.
CREATE TABLE IF NOT EXISTS chain_reserve (
  id INT PRIMARY KEY,
  funded_omr NUMERIC NOT NULL DEFAULT 0,
  next_nonce BIGINT NOT NULL DEFAULT 1,
  last_funded_at TIMESTAMPTZ
);
INSERT INTO chain_reserve (id, funded_omr) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM chain_reserve);
-- Sign-in-with-Ethereum challenges (wallet link, §4 EVM — replaces the deferred DAS check).
CREATE TABLE IF NOT EXISTS wallet_challenges (
  account_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- §11 inbound real-ETH fees. One row per on-chain OmertaFees payment, keyed by the
-- contract's monotonic `nonce` (idempotent against watcher re-delivery / reorg replay).
-- `credited` = the in-game entitlement (mint_credit / respawn_token) was granted; a payment
-- from an unlinked wallet lands with account_id NULL and is reconciled when its wallet links.
-- The ETH itself never touches this DB — the contract forwarded it to the dev wallet.
CREATE TABLE IF NOT EXISTS fee_payments (
  nonce BIGINT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'mint' | 'respawn'
  payer_address TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  tx_hash TEXT,
  account_id TEXT,
  credited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fee_payments_payer ON fee_payments (payer_address) WHERE NOT credited;
-- THE STORE (ETH revenue packages) — the fee_payments twin for arbitrary Store SKUs. A player pays
-- an ETH price to the OmertaFees tollbooth (dormant on-chain), the watcher observes a StorePaid event
-- and calls recordStorePurchase. Idempotent on nonce (a re-delivered event is a no-op). If the payer's
-- wallet is linked the entitlement is granted now; else the row waits (account_id NULL) until
-- reconcileStore runs at link. §10.4-neutral — the grant is an entitlement/access/status, never currency.
CREATE TABLE IF NOT EXISTS store_payments (
  nonce BIGINT PRIMARY KEY,
  sku TEXT NOT NULL,                  -- a STORE.PACKAGES id
  payer_address TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  tx_hash TEXT,
  account_id TEXT,
  granted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_store_payments_payer ON store_payments (payer_address) WHERE NOT granted;
-- A log of every entitlement the Store granted (history + the ops feed). Not a §10.4 ledger — no
-- currency moves; the durable state is on account_persistent (pass_until/patron/mint_credits/…).
CREATE TABLE IF NOT EXISTS store_grants (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  ref BIGINT,                         -- the store_payments nonce (comps use a synthetic nonce)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_store_grants_account ON store_grants (account_id);
-- step-three cosmetics: account-level ownership of a cosmetic decor STYLE (a Store entitlement, the
-- patron-badge precedent — SURVIVES DEATH). Display-only; applied to the owner's club (speakeasies.decor_style).
CREATE TABLE IF NOT EXISTS store_cosmetics (
  account_id TEXT NOT NULL,
  style TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, style)
);
-- THE RWA RESERVE ACCOUNTING (R2, DORMANT) — the rwa share of Store revenue is recorded here and
-- NEVER spent until R2 (a real RWA reserve backing the Dynasty shares) ships (legal-gated). This is
-- the accounting seat R2's buy-bot will draw on — the vig_revenue twin on the RWA side. Out-of-band
-- real value (like vig_revenue): zero §10.4 rows. Idempotent on (source, ref).
CREATE TABLE IF NOT EXISTS rwa_revenue (
  source TEXT NOT NULL,               -- 'store'
  ref TEXT NOT NULL,                  -- the Store payment nonce
  rwa_eth NUMERIC NOT NULL,           -- the rwa share (gross × RWA_BPS)
  spent_eth NUMERIC NOT NULL DEFAULT 0, -- R2 (dormant): always 0 until the buy-bot ships
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ref)
);
-- §11 watcher cursor: last on-chain block fully processed per event stream ('fees','claimed').
-- Lets the worker resume after downtime (getLogs backfill from here) instead of losing events
-- that fired while it was down, and stay `confirmations` behind head so a reorg can't be acted on.
CREATE TABLE IF NOT EXISTS chain_cursor (
  stream TEXT PRIMARY KEY,
  last_block BIGINT NOT NULL DEFAULT 0
);

-- ── Risk-to-Earn Phase 3: TERRITORY RACKETS (productive, seizable capital) ──
-- The asset that makes wars fight over income, not just a treasury cut. ONE racket per district,
-- owned by whoever holds the turf: established on your own turf, income accrues to the owning
-- family's treasury (lazy, collected on demand), and on a district seizure it TRANSFERS to the
-- victor. `minted_onchain` is the dormant Phase-3 chain layer (tradeable NFT — deferred).
CREATE TABLE IF NOT EXISTS territory_rackets (
  district_id TEXT PRIMARY KEY,
  owner_gang TEXT NOT NULL,
  tier INT NOT NULL DEFAULT 1,
  last_income_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  upkeep_at TIMESTAMPTZ NOT NULL DEFAULT now(),      -- recurring sinks: the operation's pad accrues off this clock (treasury pays); reset on pay/upgrade/seizure
  kind TEXT NOT NULL DEFAULT 'numbers',              -- (step three) the operation's BUSINESS: numbers (safe) / protection (med) / smuggling (hot) — income tilt + Bureau-crackdown risk
  scrutiny NUMERIC NOT NULL DEFAULT 0,               -- (step three) Bureau attention: grows from operating a hot type, decays; a crackdown seizes pending + fines the treasury
  scrutiny_at TIMESTAMPTZ NOT NULL DEFAULT now(),    -- the scrutiny clock (reset on a raid + on seizure — a seized op isn't born hot)
  fortitude INT NOT NULL DEFAULT 0,                  -- (step four) defense level — bought from the treasury; each level lowers a RIVAL raid's success (not the signed Bureau math)
  raid_cd_until TIMESTAMPTZ,                         -- (step four) per-racket cooldown after a rival raid attempt (win or lose) — protects the owner from being ground down
  specialist TEXT,                                   -- (step five) a family made-man assigned to run this operation: passive fortitude + scrutiny resistance (a status role, no §10.4)
  spec_power INT NOT NULL DEFAULT 0,                 -- snapshot of the specialist's effStat at assign (the fortitude-bonus basis; re-assign to refresh)
  op_at TIMESTAMPTZ,                                 -- (step five) last special-operation timestamp (the per-racket op cooldown)
  op_ghost_until TIMESTAMPTZ,                        -- (step five) smuggling "Ghost the Route" — the scrutiny-accrual-suppressed window
  established_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  minted_onchain BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_territory_owner ON territory_rackets (owner_gang);

-- ── Business Empire (late-game, personal, upgradeable, launder-capable) ──
-- Per-INSTANCE character property (unlike the flat character_assets one-row-per-id): a premium
-- legit front with its own tier, a lazy income clock (last_collect_at) capped at BUSINESS_CAP_MS,
-- and a per-day private-laundering window (launder_used within launder_at + 24h). One row per owned
-- front; one front per (character, kind). Income → pocket cash (business:income); buy/upgrade are
-- cash sinks (business:buy / business:upgrade). Laundering rides the existing swap:buy ledger.
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  tier INT NOT NULL DEFAULT 1,
  last_collect_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  launder_used NUMERIC NOT NULL DEFAULT 0,
  launder_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- step two (risk layer): laundering draws Bureau SCRUTINY (decays hourly off scrutiny_at);
  -- past the threshold a lazy raid roll can seize pending income + levy a fine. shakedown_at
  -- is the per-venue cooldown on rival extortion attempts.
  scrutiny NUMERIC NOT NULL DEFAULT 0,
  scrutiny_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shakedown_at TIMESTAMPTZ,
  inside_at TIMESTAMPTZ,                            -- Heist step 2: per-venue INSIDE JOB cooldown (stamped win or lose)
  rake_cursor NUMERIC NOT NULL DEFAULT 0,           -- Den step 2: den volume already rakeback-claimed (casino kind only)
  upkeep_at TIMESTAMPTZ NOT NULL DEFAULT now(),     -- recurring sinks ("the pad"): upkeep accrues off this clock; pay resets it, upgrade squares it
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (character_id, kind)
);
CREATE INDEX IF NOT EXISTS ix_businesses_character ON businesses (character_id);

-- ── THE SPEAKEASY: the social hub (omerta-speakeasy-design.md) ──
-- ONE club per district (district_id PK, the territory-racket pattern), owned by a character. The base
-- bar take accrues lazily (income_at, capped 24h) → the owner's pocket. Prestige (stored) is bumped by
-- rounds + bottles and floored by the decor tier; it ranks the nightlife. Dies with the proprietor's
-- street (the business precedent). §10.4: all cash flows carry a character_id (speakeasy: vocabulary).
CREATE TABLE IF NOT EXISTS speakeasies (
  district_id TEXT PRIMARY KEY,
  owner_character TEXT NOT NULL,
  name TEXT,
  tier INT NOT NULL DEFAULT 0,                      -- decor tier (0 = The Backroom, as opened)
  prestige NUMERIC NOT NULL DEFAULT 0,             -- bumped by rounds/bottles, floored by tier — the nightlife rank
  income_at TIMESTAMPTZ NOT NULL DEFAULT now(),    -- base bar-take accrual clock (lazy, capped)
  -- step two — the Prohibition RAID (the business-raid pattern): NOTORIETY accrues from the club's illicit
  -- activity (the back-room table + patronage), decays hourly; past the threshold the owner's collect rolls
  -- a lazy raid that seizes pending income + fines the owner + SHUTTERS the club (shut_until).
  notoriety NUMERIC NOT NULL DEFAULT 0,
  notoriety_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shut_until TIMESTAMPTZ,
  -- step three — the P2P BUYOUT: the owner lists a sale price (a consensual transfer, districts clear
  -- without a death); a buyer completes it via a taxed cash transfer (the round pattern). null = not for sale.
  sale_price NUMERIC,
  -- step three — the ETH COSMETIC DECOR tier: a display-only club skin (Store entitlement, account-level
  -- unlock in store_cosmetics, applied here). null = the stock look. Pure display — zero gameplay effect.
  decor_style TEXT,
  -- step four — the STANDOVER (a hostile forced-sale, an instant muscle contest): a per-club cooldown after
  -- any standover attempt (win or lose) so a club can't be leaned on back-to-back. null = fair game.
  standover_cd_until TIMESTAMPTZ,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_speakeasies_owner ON speakeasies (owner_character);
-- the guest list: who frequents each club, what they've spent, whether they're a REGULAR (status).
CREATE TABLE IF NOT EXISTS speakeasy_patrons (
  district_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  visits INT NOT NULL DEFAULT 0,
  spent_cash NUMERIC NOT NULL DEFAULT 0,
  spent_omr NUMERIC NOT NULL DEFAULT 0,
  last_at TIMESTAMPTZ NOT NULL DEFAULT now(),       -- per-(patron,club) round cooldown
  -- step two anti-grief (audit HIGH-1): a per-(patron,club) daily notoriety BUDGET (token bucket) caps how
  -- much heat ONE patron can add to a club below the raid threshold — so no single account can force a raid;
  -- a hot club needs genuine distinct traffic (a busy den). Legit play is uncapped; only the heat it adds is.
  noto_used NUMERIC NOT NULL DEFAULT 0,
  noto_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (district_id, character_id)
);
CREATE INDEX IF NOT EXISTS ix_speakeasy_patrons_char ON speakeasy_patrons (character_id);

-- THE FIGHT CIRCUIT (omerta-fight-circuit-design.md): a manager signs ONE contender — a persistent owned
-- asset with stats + a W/L record — and stakes them in PvP bouts (the casino:pvp transfer pattern). Dies
-- with the street (joins the runEstate wipe). bout_limit = consent-by-listing (the fade/bodyguard pattern).
-- THE FIGHT CIRCUIT (step two: THE STABLE) — a manager runs MANY fighters (BOXING.STABLE_MAX), so
-- the PK is a per-fighter id and character_id is the (non-unique) manager.
CREATE TABLE IF NOT EXISTS fighters (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,        -- the manager (a stable = many fighters per manager)
  name TEXT NOT NULL,
  power INT NOT NULL,
  chin INT NOT NULL,
  speed INT NOT NULL,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  injured_until TIMESTAMPTZ,        -- a lost bout lays the fighter up (no spam)
  bout_limit NUMERIC,               -- the stake this fighter will take (null = not taking bouts)
  exhib_at TIMESTAMPTZ,             -- per-fighter cooldown on NPC exhibition bouts
  booked_until TIMESTAMPTZ,         -- (step three) locked into a scheduled MAIN EVENT until it resolves
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fighters_char ON fighters (character_id);
CREATE INDEX IF NOT EXISTS ix_fighters_wins ON fighters (wins DESC);
-- THE STABLE: player-owned racing animals (dogs & horses) — the boxing-stable pattern under The Track's
-- betting card. Own many per owner; each has speed/stamina/heart, a record, an injury clock, a consent
-- listing (race_limit) + a per-racer circuit cooldown. Racers DIE WITH THE STREET (the fighters precedent).
CREATE TABLE IF NOT EXISTS racers (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,        -- the owner (a stable = many racers per owner)
  kind TEXT NOT NULL,               -- 'dog' (greyhound) | 'horse' (racehorse)
  name TEXT NOT NULL,
  speed INT NOT NULL,
  stamina INT NOT NULL,
  heart INT NOT NULL,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  injured_until TIMESTAMPTZ,        -- a lost race lays the animal up (no spam)
  race_limit NUMERIC,               -- the wager this racer will take in a PvP match race (null = not listed)
  circuit_at TIMESTAMPTZ,           -- per-racer cooldown on the PvE circuit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_racers_char ON racers (character_id);
CREATE INDEX IF NOT EXISTS ix_racers_wins ON racers (wins DESC);
-- THE STAKES (Stable step two): a scheduled marquee race owners enter their racer into — the Grand-Prix/
-- poker-tournament escrow twin on the animal side. A CASH buy-in escrows into a purse; the worker races
-- every live entrant's SNAPSHOTTED form and pays the top places net of rake (a pure redistribution). One
-- OPEN stakes at a time (stakes_state.current); a new one materializes on the next entry after the last
-- settles. §10.4: a `stakes escrow` check (pool == Σ buyin − win − refund − take − death).
CREATE TABLE IF NOT EXISTS stakes_races (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open',    -- open → resolved | refunded
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolves_at TIMESTAMPTZ NOT NULL,       -- registration closes here; the worker settles after
  pool INT NOT NULL DEFAULT 0             -- Σ escrowed buy-ins
);
CREATE TABLE IF NOT EXISTS stakes_entries (
  race_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  buyin INT NOT NULL,
  racer_name TEXT NOT NULL,               -- the entered racer's name (for display; the racer isn't escrowed)
  kind TEXT NOT NULL,
  form INT NOT NULL,                      -- the racer's form snapshotted at entry (the race is form + rand(VARIANCE))
  place INT,                             -- final placing, filled at settle
  PRIMARY KEY (race_id, character_id)
);
CREATE TABLE IF NOT EXISTS stakes_state ( id INT PRIMARY KEY, current TEXT );
INSERT INTO stakes_state (id, current) SELECT 1, NULL WHERE NOT EXISTS (SELECT 1 FROM stakes_state);
-- the world TITLE BELT (step two): one champion, taken by beating the holder in a PvP bout. Pure status.
CREATE TABLE IF NOT EXISTS boxing_title (
  id INT PRIMARY KEY,
  holder_fighter TEXT, holder_char TEXT, holder_name TEXT, since TIMESTAMPTZ,
  defenses INT NOT NULL DEFAULT 0,   -- (step four) the reign: successful title defenses since winning it
  last_defense TIMESTAMPTZ,          -- (step four) the mandatory-defense clock — an inactive champ is stripped
  -- (step five) THE CALLOUT — the #1 contender forces a mandatory title challenge; the champ accepts
  -- (books a title main event) or DUCKS it past the deadline and forfeits the belt to the challenger.
  callout_fighter TEXT, callout_char TEXT, callout_deadline TIMESTAMPTZ
);
INSERT INTO boxing_title (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM boxing_title);
-- THE MAIN EVENT (step three): a SCHEDULED prestige bout the crowd bets on. No principal cash wager —
-- the fighters fight for the belt/legend/record; the money is the SPECTATOR pot (a CASH parimutuel).
-- The worker resolves it at window close (the auction-settle model — single-writer, no player lock races).
CREATE TABLE IF NOT EXISTS boxing_bouts (
  id TEXT PRIMARY KEY,
  a_char TEXT NOT NULL, a_fighter TEXT NOT NULL, a_name TEXT NOT NULL,
  b_char TEXT NOT NULL, b_fighter TEXT NOT NULL, b_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',   -- booked → resolved / cancelled
  winner_fighter TEXT,                     -- set at resolution
  a_form INT, b_form INT,                  -- (R34) form SNAPSHOTTED at booking — resolve reads these, NOT live
                                           -- stats, so a manager can't train up in the betting-close→worker-settle
                                           -- gap and rig the parimutuel (the Grand-Prix/stakes/futurity precedent).
  opens_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolves_at TIMESTAMPTZ NOT NULL,        -- betting closes + the worker resolves after this
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_boxing_bouts_status ON boxing_bouts (status);
-- one CASH bet per (bout, bettor) on one of the two fighters — escrowed into the pot (boxing:bet).
CREATE TABLE IF NOT EXISTS boxing_bets (
  bout_id TEXT NOT NULL,
  bettor_char TEXT NOT NULL,
  fighter TEXT NOT NULL,          -- which fighter they backed
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bout_id, bettor_char)
);
CREATE INDEX IF NOT EXISTS ix_boxing_bets_bout ON boxing_bets (bout_id);

-- ── The Gambling Den: the Numbers (daily lottery tickets; dice are stateless) ──
-- One ticket per street per day; resolves lazily against the day's seed-drawn number when
-- claimed. CASH ONLY (stake ledgered casino:bet:numbers, a win casino:win:numbers) — the Den
-- never touches $OMR by design (see omerta-gambling-den-design.md §1).
CREATE TABLE IF NOT EXISTS numbers_tickets (
  character_id TEXT NOT NULL,
  day INT NOT NULL,
  pick INT NOT NULL,
  stake INT NOT NULL,
  PRIMARY KEY (character_id, day)
);
-- Den step two: the weekly FIGHT book (one bet per street per week; resolves lazily at week end
-- against the seed draw — unless the family holding neon FIXED it) and the fix record itself.
CREATE TABLE IF NOT EXISTS fight_bets (
  character_id TEXT NOT NULL,
  week INT NOT NULL,
  side TEXT NOT NULL,               -- 'a' (the favorite) | 'b' (the dog)
  stake INT NOT NULL,
  PRIMARY KEY (character_id, week)
);
CREATE TABLE IF NOT EXISTS fight_fixes (
  week INT PRIMARY KEY,
  gang_id TEXT NOT NULL,
  winner TEXT NOT NULL
);
-- THE TRACK: a daily race card (greyhounds + horses). One WIN bet per race per street per day,
-- resolved lazily the next day against the seed-drawn winner (the numbers/fight pattern). CASH only.
CREATE TABLE IF NOT EXISTS track_bets (
  character_id TEXT NOT NULL,
  day INT NOT NULL,
  race TEXT NOT NULL,               -- 'dogs' (greyhounds) | 'horses'
  runner INT NOT NULL,              -- the field index they backed
  stake INT NOT NULL,
  odds NUMERIC,                     -- (step three) the fixed odds LOCKED at bet time (a bookmaker's board); null = pre-step-three, falls back to the field odds
  bet_racer_id TEXT,                -- (audit HIGH) the identity of the runner backed: a player racerId, or NULL for an NPC. If a strong racer is ENTERED at the post AFTER the bet, the NPC you backed is SCRATCHED → the bet refunds (not paid the stale longshot price)
  PRIMARY KEY (character_id, day, race)
);
-- THE TRACK step three: a player enters a fit racer into the day's card, taking one of the last
-- PLAYER_SLOTS posts of its kind's race. Its FORM is snapshotted (the racer isn't escrowed — race/breed/
-- sell it after); the merged field (NPC + player entries) is what the town bets on. The worker banks the
-- racer's win the next day (status only). One entry per character per race per day.
CREATE TABLE IF NOT EXISTS track_entries (
  day INT NOT NULL,
  race TEXT NOT NULL,               -- 'dogs' | 'horses'
  post INT NOT NULL,                -- the field index (0-based) this racer occupies
  character_id TEXT NOT NULL,       -- the owner (for the legend + notify)
  racer_id TEXT NOT NULL,           -- the entered racer (may be gone by settle — bred/sold/dead; the snapshot stands)
  racer_name TEXT NOT NULL,
  form INT NOT NULL,                -- the racer's form snapshotted at entry (drives its win weight)
  settled BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (day, race, character_id)
);
CREATE INDEX IF NOT EXISTS ix_track_entries_open ON track_entries (day, race);
-- THE FUTURITY (Track step four): a scheduled marquee race where owners NOMINATE player-owned racers
-- and the WHOLE TOWN bets parimutuel on the field (the boxing-main-event twin, on the racing side —
-- distinct from THE STAKES where owners buy in and compete for the pooled buy-ins). At most one OPEN
-- futurity at a time (futurity_state.current); a new one materializes on the next nomination after the
-- last settles. Each runner's FORM is snapshotted (not escrowed); the worker races the field at window
-- close and pays the parimutuel pool. futurity_runners/futurity_bets are self-contained snapshots →
-- EXCLUDED from the estate wipe (a dead nominator's runner is scratched-refunded at resolve; a dead
-- bettor's escrow burns).
CREATE TABLE IF NOT EXISTS futurities (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open',   -- open | resolved | scrapped
  resolves_at TIMESTAMPTZ NOT NULL,
  pool NUMERIC DEFAULT 0,                 -- the parimutuel BET escrow (nomination fees are NOT here — they burn to buyback)
  winner_racer TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS futurity_runners (
  futurity_id TEXT NOT NULL,
  racer_id TEXT NOT NULL,
  character_id TEXT NOT NULL,             -- the owner (for the purse + legend + notify)
  racer_name TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- 'dog' | 'horse'
  form INT NOT NULL,                      -- snapshotted at nomination (drives its finishing chance)
  place INT,
  PRIMARY KEY (futurity_id, character_id) -- one nomination per owner per card (no field-stuffing)
);
CREATE INDEX IF NOT EXISTS ix_futurity_runners ON futurity_runners (futurity_id);
CREATE TABLE IF NOT EXISTS futurity_bets (
  futurity_id TEXT NOT NULL,
  bettor_char TEXT NOT NULL,
  racer_id TEXT NOT NULL,                 -- the runner backed
  amount NUMERIC NOT NULL,
  PRIMARY KEY (futurity_id, bettor_char)  -- one bet per bettor per card
);
CREATE TABLE IF NOT EXISTS futurity_state ( id INT PRIMARY KEY, current TEXT );
INSERT INTO futurity_state (id, current) SELECT 1, NULL WHERE NOT EXISTS (SELECT 1 FROM futurity_state);
-- Den step two: lifetime den stake volume (a COUNTER, not a money bucket — no §10.4 impact).
-- Casino-business owners earn rakeback against the volume that flowed since their cursor.
CREATE TABLE IF NOT EXISTS den_volume (
  id INT PRIMARY KEY,
  total NUMERIC NOT NULL DEFAULT 0,
  -- econ pass (audit: mint-on-top): the house's REALIZED edge (Σ PvE stakes − Σ PvE payouts, may run
  -- negative on a bad night) and what has been tipped out of it (street cuts + rakeback). Every
  -- distribution is capped at profit − distributed − open liability, so the den never emits beyond
  -- what the players actually lost. Both mirror the ledger exactly (§10.4 den checks).
  profit NUMERIC NOT NULL DEFAULT 0,
  distributed NUMERIC NOT NULL DEFAULT 0
);
INSERT INTO den_volume (id, total) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM den_volume);

-- Den step three: BLACKJACK — a stateful PvE hand (one live hand per street at a time). The bet is
-- taken (and profit-booked) at deal; the hand persists across hit/stand/double calls (each its own
-- atomic txn) until it resolves, when the payout (if any) is credited. Cards are drawn from an
-- infinite deck (independent, unpredictable — the same server-authoritative RNG as dice) and stored
-- as comma-separated rank ints (1=Ace, 11/12/13=J/Q/K). Dies with the street (runEstate wipe).
CREATE TABLE IF NOT EXISTS blackjack_hands (
  character_id TEXT PRIMARY KEY,
  bet INT NOT NULL,
  dbl BOOLEAN NOT NULL DEFAULT FALSE,   -- doubled down (bet is staked twice, one card, auto-stand)
  player TEXT NOT NULL,                 -- the player's cards, comma-separated rank ints
  dealer TEXT NOT NULL                  -- the dealer's cards (only the up-card is revealed until stand)
);

-- Den step four: THE POKER TOURNAMENT — a scheduled, escrow-funded, worker-resolved showdown (the
-- boxing main-event pattern). Players buy in during an open window (each buy-in ESCROWS into the
-- pool); the worker deals every live entrant an independent 7-card hand and pays the top places a
-- share of the pool net of a house rake — a competitive CASH redistribution (no new emission). At
-- most one OPEN tournament at a time (poker_state.current); a new one materializes on the next entry
-- after the last resolves. §10.4: a new escrow check (pool == Σ buyin − win − take − refund − death).
CREATE TABLE IF NOT EXISTS poker_tournaments (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open',    -- open → resolved | refunded
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolves_at TIMESTAMPTZ NOT NULL,       -- registration closes here; the worker settles after
  pool INT NOT NULL DEFAULT 0             -- Σ escrowed buy-ins (a convenience mirror of the entries)
);
CREATE TABLE IF NOT EXISTS poker_entries (
  tournament_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  buyin INT NOT NULL,
  place INT,                             -- final placing, filled at settle
  hand TEXT,                             -- the dealt best-hand name, filled at settle
  PRIMARY KEY (tournament_id, character_id)
);
CREATE TABLE IF NOT EXISTS poker_state ( id INT PRIMARY KEY, current TEXT );
INSERT INTO poker_state (id, current) SELECT 1, NULL WHERE NOT EXISTS (SELECT 1 FROM poker_state);

-- STREET RACES step 3 — THE GRAND PRIX: a scheduled, worker-resolved CASH parimutuel (the poker-tournament
-- twin, on the races side). At most one OPEN grand prix at a time (grand_prix_state.current); a new one
-- materializes on the next entry after the last settles. §10.4: a `grand prix escrow` check (pool == Σ
-- buyin − win − refund − take − death). The entrant's car POWER is SNAPSHOTTED at entry (the car isn't
-- escrowed — only the cash buy-in is — so it can be freely used/sold after; you race the form you entered).
CREATE TABLE IF NOT EXISTS grand_prix (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open',    -- open → resolved | refunded
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolves_at TIMESTAMPTZ NOT NULL,       -- registration closes here; the worker settles after
  pool INT NOT NULL DEFAULT 0             -- Σ escrowed buy-ins (a convenience mirror of the entries)
);
CREATE TABLE IF NOT EXISTS grand_prix_entries (
  gp_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  buyin INT NOT NULL,
  power INT NOT NULL,                     -- the car's race power snapshotted at entry (the race is power + rand(VARIANCE))
  place INT,                             -- final placing, filled at settle
  PRIMARY KEY (gp_id, character_id)
);
CREATE TABLE IF NOT EXISTS grand_prix_state ( id INT PRIMARY KEY, current TEXT );
INSERT INTO grand_prix_state (id, current) SELECT 1, NULL WHERE NOT EXISTS (SELECT 1 FROM grand_prix_state);

-- VENDETTAS: a player fire-kill swears the victim's bloodline (ACCOUNT) against the killer's —
-- surviving both sides' deaths until settled (a revenge fire-kill, 2x rep) or lapsed. One active
-- vendetta per pair (a repeat kill refreshes the clock). Zero money flows — pure status + the
-- directed-floor waiver. Design: omerta-vendetta-design.md.
CREATE TABLE IF NOT EXISTS vendettas (
  avenger_account TEXT NOT NULL,
  target_account TEXT NOT NULL,
  sworn TEXT NOT NULL,                 -- the dead street's name (who this is for)
  kills INT NOT NULL DEFAULT 1,        -- step two: how many times the target's line has bled the avenger's — the ESCALATION counter (deeper feud → longer TTL + a higher tier)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (avenger_account, target_account)
);
-- step two: THE SIT-DOWN — a consensual peace offer between two bloodlines. The proposer offers; the
-- other bloodline accepts to clear BOTH-direction vendettas (a non-violent exit from a blood feud).
CREATE TABLE IF NOT EXISTS feud_peace_offers (
  from_account TEXT NOT NULL,
  target_account TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_account, target_account)
);

-- THE LAW Phase 4 — informants. A `flip` (turning state's evidence) creates a witness: the case
-- they seed against `target_character` adds `seed` exposure to that mark. If the WITNESS is
-- killed (a fire on the rat), the case collapses — runEstate subtracts the seed back off every
-- target they named and clears any indictment it caused. Pure status/exposure — no §10.4 currency.
CREATE TABLE IF NOT EXISTS informants (
  id TEXT PRIMARY KEY,
  witness_character TEXT NOT NULL,
  witness_account TEXT NOT NULL,
  target_character TEXT NOT NULL,
  target_account TEXT NOT NULL,
  seed NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE PEN — prison contraband: what an inmate is holding (a shiv for the yard). Bought from the
-- corrupt guard (a cash sink); ownership, not a §10.4 currency. Dies with the man (runEstate wipe).
CREATE TABLE IF NOT EXISTS pen_contraband (
  character_id TEXT NOT NULL,
  item TEXT NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, item)
);
-- THE PEN step four — the CO-OP BREAKOUT (the crew-heist pattern, inside): a jailed leader stakes a
-- cutkit; jailed inmates join off the board; the leader calls the go — one roll for the whole crew
-- (odds scale with crew size). Win = everyone's sentence clears + everyone WANTED; loss = the whole
-- crew eats the hole + a longer stretch. §10.4-clean (the cutkit is contraband, not currency).
CREATE TABLE IF NOT EXISTS pen_breaks (
  id TEXT PRIMARY KEY,
  leader_character TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',   -- planning | done | abandoned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pen_break_members (
  break_id TEXT NOT NULL,
  character_id TEXT NOT NULL UNIQUE,         -- one active break per inmate (the heist precedent)
  ratted BOOLEAN NOT NULL DEFAULT false,     -- (step five) the silent flag — a snitch tips the guards; never surfaced by name
  PRIMARY KEY (break_id, character_id)
);

-- LOAN SHARKING — the Shylock. An OPEN row is an escrowed offer (principal held like a bounty pot);
-- a TAKEN row is an ACTIVE debt (principal already with the borrower). Escrow (SUM principal WHERE
-- status='open') reconciles against the loan:* ledger (§10.4). `rate` is the interest fraction; the
-- outstanding debt is principal×(1+rate). Numbers are founder sign-off levers.
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  lender_character TEXT NOT NULL,
  borrower_character TEXT,                          -- NULL while open (offered, untaken)
  principal NUMERIC NOT NULL,
  rate NUMERIC NOT NULL,
  hours INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',              -- open | active | repaid | collected | cancelled
  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,
  offered_to TEXT,                                  -- step 2: directed (trust-line) offer — only this borrower can take (NULL = open board)
  collateral_min NUMERIC NOT NULL DEFAULT 0,        -- step 2: a SECURED offer requires a car worth ≥ this (0 = unsecured)
  collateral_car TEXT,                              -- step 2: the pledged car id once taken (NULL = none); seized to the lender on default
  for_sale NUMERIC                                  -- step 3: the paper market — the current lender's ASK price on this active loan (NULL = not for sale)
);

-- THE LIVING WORLD Phase 2 — NPC rival families. One SERVER-WIDE row per fixture: `strength` is a
-- shared cash reservoir the whole player base grinds down together (positive-sum co-op); it
-- regenerates lazily toward the fixture max on `strength_at`. A raid loots a bounded slice
-- (world:raid — a ledgered cash faucet capped by the reservoir/regen). Seeded lazily on first touch.
CREATE TABLE IF NOT EXISTS world_npcs (
  npc_id TEXT PRIMARY KEY,
  strength NUMERIC NOT NULL,
  strength_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enraged_until TIMESTAMPTZ,  -- (step two) a routed cartel is on high alert — defends +ENRAGE_DEF for a window
  held_by_gang TEXT,          -- (step three) THE FRONTIER: the family that last ROUTED this outfit controls its turf (toppled on the next rout)
  held_since TIMESTAMPTZ,     -- when the current family took the frontier
  garrison NUMERIC NOT NULL DEFAULT 0, -- (step four) the holding family's defense budget on the outpost — a rival INVADES by outbidding it
  tribute_at TIMESTAMPTZ      -- (step four) last frontier-tribute collection (lazy accrual anchor; the held outfit pays its overlord a bounded, capped tribute)
);
-- (step six) THE UPRISING: a seed-drawn day where an outfit rises up. Materialized when the worker first
-- sees the day (idempotent, PK on day); RESOLVED once the day has passed (the reckoning — a held-but-
-- undefended outpost is reclaimed by the rebelling outfit). A tiny audit/idempotency ledger, not a money
-- surface. status: 'active' (rising / awaiting the reckoning) → 'resolved'.
CREATE TABLE IF NOT EXISTS world_uprisings (
  day INT PRIMARY KEY,
  npc_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

-- THE FRONTIER — co-op crew raids on the apex outfits (step three). The crew-heist pattern applied
-- to a WORLD raid: a leader opens the op, made raiders join off the board, the leader calls the go
-- and ONE roll decides it for the whole crew — the reservoir slice splits like a heist pot
-- (world:raid, the SAME bounded faucet as a solo raid, just shared). No stake (the cost is each
-- raider's own energy/ammo/heat at execute); a stale plan is swept, nothing to refund.
CREATE TABLE IF NOT EXISTS world_raids (
  id TEXT PRIMARY KEY,
  npc_id TEXT NOT NULL,
  leader_character TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',   -- planning | done | abandoned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS world_raid_members (
  raid_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY (raid_id, character_id)
);
CREATE INDEX IF NOT EXISTS ix_world_raid_members_char ON world_raid_members (character_id);

-- CREW HEISTS (THE BIG SCORE): the game's first co-op content. One row per job; members join
-- off the open board; the leader executes when full. The stake is sunk at plan (refunded only
-- on pre-execution disband); the take/jail/rat outcomes are ledgered per member (heist:crew*).
CREATE TABLE IF NOT EXISTS crew_heists (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  leader_character TEXT NOT NULL,
  target_business TEXT,                      -- step two: the INSIDE JOB's mark (a player's front)
  status TEXT NOT NULL DEFAULT 'planning',   -- planning | done | abandoned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crew_heist_members (
  heist_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'crew',         -- step two: the JOB role (brains/muscle/wheelman/gun) — each claimed once
  ratted BOOLEAN NOT NULL DEFAULT false,     -- the silent flag — never surfaced by name
  PRIMARY KEY (heist_id, character_id),
  UNIQUE (heist_id, role)                    -- defense in depth: a seat can never double even if a future writer skips the heist row lock
);
CREATE INDEX IF NOT EXISTS ix_heist_members_char ON crew_heist_members (character_id);

-- SMUGGLING CONVOYS: bulk goods in transit — visible, ambushable, turf-sheltered. One active
-- convoy per character; the manifest lives in convoy_cargo (goods are ownership, not §10.4
-- currency); the only money flow is the convoy:guards cash sink. Design: omerta-convoys-design.md.
CREATE TABLE IF NOT EXISTS convoys (
  id TEXT PRIMARY KEY,
  owner_character TEXT,                       -- NULL for an NPC convoy (step three — worker-run trucking players can hijack)
  is_npc BOOLEAN NOT NULL DEFAULT false,      -- step three: a worker-spawned NPC convoy (no owner; despawns on arrival)
  owner_gang TEXT,                            -- snapshot at depart (turf defense bonus)
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'loading',     -- loading | transit | done | lost
  guards INT NOT NULL DEFAULT 0,              -- the tier's defense value (fee already sunk)
  ambushed BOOLEAN NOT NULL DEFAULT false,    -- true once any attempt happened
  -- step two: up to MAX_AMBUSHES attempts per convoy (each fight WEARS the guards down for the
  -- next); insured freight stamps the base value LOST to hijacks here and the owner claims the
  -- pool-capped payout lazily at collect (the owner's row is never touched by an ambush).
  ambushes INT NOT NULL DEFAULT 0,
  insured BOOLEAN NOT NULL DEFAULT false,
  insured_loss NUMERIC NOT NULL DEFAULT 0,
  departed_at TIMESTAMPTZ,
  arrives_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_convoys_owner ON convoys (owner_character);
CREATE TABLE IF NOT EXISTS convoy_cargo (
  convoy_id TEXT NOT NULL,
  good_id TEXT NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  PRIMARY KEY (convoy_id, good_id)
);
-- step two: one ambush attempt per CHARACTER per convoy (the convoy-wide cap is convoys.ambushes)
CREATE TABLE IF NOT EXISTS convoy_ambushes (
  convoy_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY (convoy_id, character_id)
);
-- step two: the freight-insurance pool — a zero-sum cash bucket (premiums in `convoy:insure`,
-- payouts out `convoy:payout`, payouts CAPPED at the pool so collusion can only redistribute
-- what shippers paid in — the stake_pool precedent). §10.4 check: pool = premiums − payouts.
CREATE TABLE IF NOT EXISTS convoy_insurance (
  id INT PRIMARY KEY,
  pool NUMERIC NOT NULL DEFAULT 0
);
INSERT INTO convoy_insurance (id, pool) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM convoy_insurance);

-- THE COMMISSION: the top-5 families vote weekly on a city decree (active the FOLLOWING week,
-- tallied lazily). One vote per family per week, changeable; votes are public. No money moves.
CREATE TABLE IF NOT EXISTS commission_votes (
  week INT NOT NULL,
  gang_id TEXT NOT NULL,
  decree TEXT NOT NULL,
  -- step two (audit-hardened): the family's STANDING at cast time (re-casting refreshes it).
  -- The tally ranks the week's frozen ballots by this stamp and derives weights SEATS..1 from
  -- the rank, counting only the top SEATS ballots — so the electorate is bounded at the seat
  -- count and stale "I held the head seat for a minute" ballots rank where they belong.
  standing NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (week, gang_id)
);
-- Commission step two: the head of the table (seat 1's BOSS) may kill the sitting decree once
-- per week. Public record — the veto and who cast it show on the board. No money moves.
CREATE TABLE IF NOT EXISTS commission_vetoes (
  week INT PRIMARY KEY,
  gang_id TEXT NOT NULL,
  decree TEXT NOT NULL
);

-- THE BLACK MARKET: P2P trade for cars (auction — single standing bid, optional buy-now) and
-- trade goods (fixed-price, district-pinned pickup so the market can't teleport freight past
-- the convoy game). Items escrow at list (cars flag `cars.listed`, the row stays for the
-- conservation count; goods deduct from the trunk into the row). Cash escrow = the standing
-- bid, reconciled by the §10.4 `market escrow` check. Design: omerta-market-design.md.
CREATE TABLE IF NOT EXISTS market_listings (
  id TEXT PRIMARY KEY,
  seller_character TEXT NOT NULL,     -- the POSTER (for kind='order' that's the buyer)
  kind TEXT NOT NULL,                 -- 'car' | 'good' | 'order' (step two: standing WTB)
  car_id TEXT,                        -- kind='car'
  good_id TEXT,                       -- kind='good' | 'order'
  qty INT NOT NULL DEFAULT 0,         -- good: units escrowed OUT of the trunk; order: units still WANTED (absolute writes — pg-mem INT quirk)
  filled_qty INT NOT NULL DEFAULT 0,  -- order: units delivered by sellers, sitting in the warehouse until the buyer claims
  district TEXT,                      -- good/order: the dock (buyer/seller must stand there)
  price NUMERIC NOT NULL,             -- goods/orders: unit price; cars: the minimum bid
  buy_now NUMERIC,                    -- cars: optional instant price
  reserve NUMERIC,                    -- cars (step two): hidden reserve — under it the hammer never falls
  bid NUMERIC,                        -- the single standing bid (cars; NULL = open)
  bidder TEXT,                        -- who holds it (their cash is escrowed via market:bid)
  status TEXT NOT NULL DEFAULT 'live',-- live | sold | cancelled | expired
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_market_seller ON market_listings (seller_character);
CREATE INDEX IF NOT EXISTS ix_market_status ON market_listings (status);

-- SKILLS & SPECIALIZATIONS: the character build layer. Points derive from level (never stored —
-- no currency, no §10.4 surface); owned skills die with the street (estate wipe). Design:
-- omerta-skills-design.md.
-- THE UNDERWORLD: per-character standing (0-100) with the named NPC cast. A pure status axis
-- (no §10.4 surface); earned actor-side at each loop's touchpoints, gift-greasable only below
-- GIFT_CAP. Dies with the street. Design: omerta-underworld-design.md.
CREATE TABLE IF NOT EXISTS npc_standing (
  character_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  standing NUMERIC NOT NULL DEFAULT 0,
  touched_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- last business — idle standings cool (lazy decay on read)
  PRIMARY KEY (character_id, npc_id)
);

-- Underworld step two: the daily LEAD — the first business each day with your best fixture
-- pays bonus standing, once. One row per claimed day (old rows are inert; wiped with the street).
-- Step four: `streak` = consecutive claimed days as of this row (yesterday's streak + 1).
CREATE TABLE IF NOT EXISTS npc_leads (
  character_id TEXT NOT NULL,
  day INT NOT NULL,
  npc_id TEXT NOT NULL,
  streak INT NOT NULL DEFAULT 1,
  PRIMARY KEY (character_id, day)
);

-- Underworld audit #3: per-fixture per-day accumulated RAW-bump standing gain, for the daily
-- cap (lead/errand bonuses are exempt and not counted here). Old rows are inert; wiped at death.
CREATE TABLE IF NOT EXISTS npc_gain (
  character_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  day INT NOT NULL,
  gained INT NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, npc_id, day)
);

-- Underworld step four: GRUDGES with teeth — a fixture holding one caps your tier with them
-- (no tier-3 service) until squared by penance. Count > 0 = grudged. Dies with the street
-- (the fixtures forgive the dead; the standing loss still echoes via bloodline memory).
CREATE TABLE IF NOT EXISTS npc_grudges (
  character_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  count INT NOT NULL DEFAULT 0,
  since TIMESTAMPTZ NOT NULL DEFAULT now(), -- step five: the healing clock — one grudge fades per GRUDGE_DECAY_DAYS; any write restarts it
  PRIMARY KEY (character_id, npc_id)
);

-- Underworld step five: the ERRAND CHAIN — a fixture's storyline: do their drawn daily task
-- on CHAIN_STEPS separate days for a big standing jump. One active chain per street
-- (character PK); starting a new one replaces the old (the half-done job is dropped).
CREATE TABLE IF NOT EXISTS npc_errands (
  character_id TEXT PRIMARY KEY,
  npc_id TEXT NOT NULL,
  step INT NOT NULL DEFAULT 0,
  started_day INT NOT NULL,
  last_day INT
);

-- Underworld step four: the weekly FAVOR — one per street per week, claimed from any
-- un-grudged tier-3 fixture (a resource package, never money).
CREATE TABLE IF NOT EXISTS npc_favors (
  character_id TEXT NOT NULL,
  week INT NOT NULL,
  npc_id TEXT NOT NULL,
  PRIMARY KEY (character_id, week)
);

CREATE TABLE IF NOT EXISTS character_skills (
  character_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  learned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, skill_id)
);

-- D4: NPC-hit per-TARGET cooldown — one rival can no longer be repeat-reset every 6h by a whale
-- cycling their payer cooldown (each attempt stamps the pair, win or lose).
CREATE TABLE IF NOT EXISTS npc_hits (
  payer TEXT NOT NULL,
  target TEXT NOT NULL,
  last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (payer, target)
);

-- ── R1 — THE PORTFOLIO ("going legit"): personal + family RWA / blue-chip holdings ──
-- Account-level (keyed on account_id, NOT character_id) so it SURVIVES DEATH — the "legit money is
-- untouchable" retirement fantasy (never in the runEstate wipe; the heir inherits the book). PURE
-- STATUS in R1: `shares` is a ticker-denominated collectible (not a §10.4 currency), `cost_omr` the
-- lifetime $OMR spent (display cost basis). The only ledgered flow is the 'rwa:invest' $OMR burn.
CREATE TABLE IF NOT EXISTS portfolios (
  account_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  shares NUMERIC NOT NULL DEFAULT 0,
  cost_omr NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, ticker)
);
-- The FAMILY book: the gang's legit holdings — a seize-resistant status flex bought by the boss/
-- underboss from the family $OMR reserve (the seal precedent). Dies with a dissolved family.
CREATE TABLE IF NOT EXISTS gang_portfolios (
  gang_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  shares NUMERIC NOT NULL DEFAULT 0,
  cost_omr NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (gang_id, ticker)
);

-- ── THE ESTATE ("the compound"): the deep personal $OMR sink + "home" display ──
-- Account-level (keyed on account_id) so it SURVIVES DEATH — the heir inherits the compound (the
-- Portfolio precedent, never in the runEstate wipe). PURE STATUS: tier + comma-joined feature ids +
-- lifetime $OMR sunk (the "estate value"). The only ledgered flow is the 'estate:*' $OMR burn.
CREATE TABLE IF NOT EXISTS estates (
  account_id TEXT PRIMARY KEY,
  name TEXT,
  tier INT NOT NULL DEFAULT 0,
  features TEXT NOT NULL DEFAULT '',        -- comma-joined feature ids (pg-mem-safe; avoid arrays)
  spent_omr NUMERIC NOT NULL DEFAULT 0      -- lifetime $OMR sunk into the estate (a status figure)
);

-- ── THE AUCTION HOUSE ("the sit-down"): the competitive, recurring $OMR sink ──
-- A live auction row exists once a lot gets its first bid. `current_bid` on status='live' rows IS the
-- $OMR escrow bucket (the bounty/loan/market-escrow twin, on the $OMR side — added to omrBuckets so
-- $OMR conservation stays exact; reconciled by the 'auction escrow' invariant). bidder = account_id
-- ($OMR is account-level → survives death, so a bid needs no death handling). Settled by the worker.
CREATE TABLE IF NOT EXISTS auctions (
  lot_id TEXT PRIMARY KEY,                  -- '<week>:<slot>'
  week INT NOT NULL,
  archetype TEXT NOT NULL,
  current_bid NUMERIC NOT NULL DEFAULT 0,
  bidder TEXT,                              -- account_id of the standing top bidder
  status TEXT NOT NULL DEFAULT 'live',      -- 'live' | 'settled'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Won lots — account-level trophies (survive death; the heir inherits the collection).
CREATE TABLE IF NOT EXISTS auction_wins (
  account_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  archetype TEXT NOT NULL,
  name TEXT NOT NULL,
  serial TEXT NOT NULL,
  price NUMERIC NOT NULL,
  won_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, lot_id)
);

-- ── Risk-to-Earn Phase 2: THE VIG (real-revenue redistribution accounting) ──
-- A real-value ledger SEPARATE from the §10.4 in-game set: it tracks real ETH revenue in and the
-- HARD (on-chain ERC-20) $OMR the buyback bought with it — never in-game currency. Amounts are in
-- ETH / $OMR units (not wei) to stay inside JS-safe-integer range for the accounting math; the
-- real bot does the actual DEX swap on mainnet, this mirrors it. The invariant (src/vig.js
-- runVigInvariants) proves "extraction ≤ inflow": funded reserve + prize pool ≤ $OMR bought ≤
-- revenue-backed. Dormant until the chain is wired (M6 pattern) — nothing extracts here.
CREATE TABLE IF NOT EXISTS vig_revenue (
  source TEXT NOT NULL,               -- 'fee' (mint/respawn); later 'cosmetic' | 'rent' | 'pass'
  ref TEXT NOT NULL,                  -- idempotency key within source (the fee nonce, …)
  kind TEXT,                          -- 'mint' | 'respawn' | …
  gross_eth NUMERIC NOT NULL,         -- the full real-ETH payment
  vig_eth NUMERIC NOT NULL,           -- the Vig's share (gross × VIG_BPS); the rest is dev revenue
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ref)
);
CREATE TABLE IF NOT EXISTS vig_buyback (
  id TEXT PRIMARY KEY,
  eth_spent NUMERIC NOT NULL,         -- ETH the bot spent buying $OMR (≤ unspent Vig revenue)
  omr_bought NUMERIC NOT NULL,        -- hard $OMR acquired on the DEX
  price_omr_per_eth NUMERIC NOT NULL, -- the execution price (test: a param; mainnet: TWAP)
  to_reserve NUMERIC NOT NULL,        -- $OMR routed to the withdrawal reserve (funds extraction)
  to_prize NUMERIC NOT NULL,          -- $OMR routed to the season prize pool
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vig_prize_pool (
  id INT PRIMARY KEY,
  balance NUMERIC NOT NULL DEFAULT 0, -- unpaid hard $OMR available for season prizes
  paid_total NUMERIC NOT NULL DEFAULT 0
);
INSERT INTO vig_prize_pool (id, balance) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM vig_prize_pool);

-- THE RESERVE BOND (omerta-reserve-bond-design.md) — Protocol-Owned Liquidity via a disciplined treasury
-- bond. Real-value / OUT-OF-BAND (the fees.js precedent): these tables + vig_revenue(source='bond') are the
-- ONLY writes; §10.4 (in-game `transactions`) is untouched. The chain layer (the OmertaBond contract + a
-- Bonded watcher) is DORMANT, mainnet-gated on legal + audit. Numbers are founder sign-off levers.
CREATE TABLE IF NOT EXISTS bonds (
  id TEXT PRIMARY KEY,
  nonce BIGINT UNIQUE NOT NULL,        -- idempotency (the on-chain Bonded nonce; comps use a synthetic nonce)
  account_id TEXT,                     -- the bonder (null = parked for reconcile-at-link, the Store precedent)
  payer_address TEXT,                  -- the depositing wallet (for reconcile-at-link when the bond pre-dates the link)
  principal_eth NUMERIC NOT NULL,      -- real ETH deposited
  payout_omr NUMERIC NOT NULL,         -- treasury OMR owed to the bonder (discounted), vested linearly
  oracle_price NUMERIC NOT NULL,       -- OMR-per-ETH at bond time (mainnet: the DEX TWAP; here a param)
  discount_bps INT NOT NULL,           -- the bonder's incentive (≤ MAX_DISCOUNT_BPS)
  claimed_omr NUMERIC NOT NULL DEFAULT 0,
  vest_ms BIGINT NOT NULL,             -- linear vesting window
  tx_hash TEXT,                        -- the on-chain Bonded tx (null = a mod comp/QA bond: no REAL-ETH accounting)
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bonds_account ON bonds (account_id);
-- the tranche: the treasury's budgeted OMR for bonding (the anti-Ponzi cap — committed can never exceed it),
-- + the POL ETH acquired (paired into the OMR-ETH pool on mainnet).
CREATE TABLE IF NOT EXISTS bond_reserve (
  id INT PRIMARY KEY,
  capacity_omr NUMERIC NOT NULL DEFAULT 0,   -- the budgeted OMR the treasury will bond out (set via mod/bond/fund)
  committed_omr NUMERIC NOT NULL DEFAULT 0,  -- Σ payout_omr of all bonds (invariant: ≤ capacity_omr)
  pol_eth NUMERIC NOT NULL DEFAULT 0,         -- Σ POL share of bonded ETH (deepens the OMR-ETH pool on mainnet)
  dev_eth NUMERIC NOT NULL DEFAULT 0,         -- Σ dev share of bonded ETH (founder revenue — forwarded in-tx on-chain; recorded here)
  rwa_eth NUMERIC NOT NULL DEFAULT 0,         -- Σ stock-float share of bonded ETH (v2 §6; mirrored as rwa_revenue source='bond')
  next_nonce BIGINT NOT NULL DEFAULT 1        -- monotonic quote-nonce allocator (OmertaBond's usedNonce space; independent of chain_reserve)
);
INSERT INTO bond_reserve (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM bond_reserve);
-- the bond QUOTE SIGNER's ledger: each server-signed EIP-712 BondQuote (the piece the on-chain OmertaBond
-- contract's bond() accepts). Persisting the quote lets the Bonded watcher recover the EXACT price/discount
-- the event omits (it emits only the resolved payout + POL/Vig split). nonce is the on-chain replay key.
CREATE TABLE IF NOT EXISTS bond_quotes (
  nonce BIGINT PRIMARY KEY,            -- the OmertaBond usedNonce key (allocated from bond_reserve.next_nonce)
  account_id TEXT,                     -- the requester (for the record; the payer wallet is the on-chain identity)
  payer_address TEXT NOT NULL,         -- the quote is bound to this wallet (contract enforces msg.sender == payer)
  principal_eth NUMERIC NOT NULL,      -- ETH the bonder deposits (== msg.value on-chain)
  price NUMERIC NOT NULL,              -- OMR-per-ETH at quote time (the oracle TWAP)
  discount_bps INT NOT NULL,           -- the bonder's incentive (≤ MAX_DISCOUNT_BPS)
  payout_omr NUMERIC NOT NULL,         -- the discounted OMR the quote pays out (for display/pre-check)
  vest_seconds BIGINT NOT NULL,        -- linear vesting window (≤ MAX_VEST)
  deadline BIGINT NOT NULL,            -- unix seconds the quote is valid until (≤ MAX_QUOTE_TTL)
  signature TEXT NOT NULL,             -- the server's EIP-712 signature over the quote
  status TEXT NOT NULL DEFAULT 'quoted', -- 'quoted' | 'bonded' (set when the Bonded watcher records it)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bond_quotes_account ON bond_quotes (account_id);

-- ── M2 economy singletons (spec §3.4, §7.12) ──
-- Constant-product AMM, single row, row-locked on every swap.
CREATE TABLE IF NOT EXISTS amm_pool (
  id INT PRIMARY KEY,
  cash_reserve NUMERIC NOT NULL,
  omr_reserve NUMERIC NOT NULL
);
-- Street-tax accumulator + event fund; the 12h buyback drains `pool`.
-- THE POPULATION step three (THE TURNOVER): the city renews itself by retiring residents players
-- have picked clean, which makes `npc:seed` a RECURRING faucet. This singleton is its ceiling — a
-- per-day HEADCOUNT of replacements, not a dollar budget: every retirement is what creates the
-- vacancy a fresh seed pays for, whereas metering dollars would let the day-one fill of an empty
-- city (~48 seeds replacing nobody) eat the whole allowance before anyone had been robbed.
CREATE TABLE IF NOT EXISTS population_state (
  id INT PRIMARY KEY,
  day INT NOT NULL DEFAULT 0,       -- the day the counter belongs to (rolls it over lazily)
  retired INT NOT NULL DEFAULT 0    -- residents replaced so far that day
);
INSERT INTO population_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS street_tax (
  id INT PRIMARY KEY,
  pool NUMERIC NOT NULL DEFAULT 0,
  fund NUMERIC NOT NULL DEFAULT 0,
  last_buyback TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Risk-to-Earn Phase 4: BACKED EMISSION. The soft-$OMR pool staking rewards are paid FROM (a
-- transfer, not a mint) — funded by a slice of the 12h buyback (cash sinks → $OMR → yield), so
-- staking stops being an unbounded mint and becomes redistribution bounded by economic activity.
CREATE TABLE IF NOT EXISTS stake_pool (
  id INT PRIMARY KEY,
  balance NUMERIC NOT NULL DEFAULT 0,   -- soft $OMR available to pay staking rewards
  lifetime_funded NUMERIC NOT NULL DEFAULT 0,
  lifetime_paid NUMERIC NOT NULL DEFAULT 0
);
-- THE DYNASTY FUND dividend pool (a §10.4 $OMR bucket, the stake_pool twin): fed by a slice of every
-- personal RWA invest (dividend:fund — a TRANSFER, not a burn) and paid out to holders as dividends
-- (dividend:omr — a TRANSFER, both sides inside omrBuckets). So RWA becomes a productive asset that
-- pays a $OMR yield, bounded by what invests fund (pool-capped, the stake-pool "backed emission" rule).
CREATE TABLE IF NOT EXISTS rwa_dividend_pool (
  id INT PRIMARY KEY,
  pool NUMERIC NOT NULL DEFAULT 0,
  lifetime_funded NUMERIC NOT NULL DEFAULT 0,
  lifetime_paid NUMERIC NOT NULL DEFAULT 0
);
-- The FAMILY dividend pool is SEPARATE from the personal one (cross-system audit MED): family invests
-- fund it, family reserves draw it — so collective/seizable reserve $OMR can NEVER reach a personal
-- account through the dividend (the "no reserve→personal path" guarantee), and the family dividend is
-- genuinely funded by the family's OWN investing. Same shape, same §10.4 bucket treatment.
CREATE TABLE IF NOT EXISTS rwa_family_dividend_pool (
  id INT PRIMARY KEY,
  pool NUMERIC NOT NULL DEFAULT 0,
  lifetime_funded NUMERIC NOT NULL DEFAULT 0,
  lifetime_paid NUMERIC NOT NULL DEFAULT 0
);
-- Seed the singletons once (idempotent; virtual pool ≈ $500 / $OMR).
-- Time-boxed RECRUITMENT DRIVE ("the push") — a mod-started window during which referral CASH
-- payouts multiply. A singleton; inactive when `until` is null/past (mult reads as 1).
CREATE TABLE IF NOT EXISTS referral_push (
  id INT PRIMARY KEY,
  until TIMESTAMPTZ,
  mult NUMERIC NOT NULL DEFAULT 1
);
INSERT INTO amm_pool (id, cash_reserve, omr_reserve)
  SELECT 1, 10000000, 20000 WHERE NOT EXISTS (SELECT 1 FROM amm_pool);
INSERT INTO referral_push (id, mult) SELECT 1, 1 WHERE NOT EXISTS (SELECT 1 FROM referral_push);
INSERT INTO street_tax (id, pool, fund)
  SELECT 1, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM street_tax);
INSERT INTO stake_pool (id, balance) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM stake_pool);
INSERT INTO rwa_dividend_pool (id, pool) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM rwa_dividend_pool);
INSERT INTO rwa_family_dividend_pool (id, pool) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM rwa_family_dividend_pool);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  character_id TEXT,
  account_id TEXT,
  currency TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  counterparty TEXT
);
CREATE TABLE IF NOT EXISTS rng_audit (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  character_id TEXT,
  action TEXT NOT NULL,
  roll NUMERIC NOT NULL,
  outcome TEXT NOT NULL
);

-- ── Indexes & integrity (audit hardening) — after all tables exist ──
-- No two LIVING characters may share a name (referral codes resolve by name, §7.13).
CREATE UNIQUE INDEX IF NOT EXISTS ux_char_name_alive ON characters (name) WHERE alive;
-- (red-team R13) One LIVING character per account is serialized in the POST /v1/character handler by an
-- account-row FOR UPDATE lock (a partial UNIQUE(account_id) WHERE alive would be the DB-level backstop,
-- but it trips pg-mem's `account_id = ANY(...)` query planner in the referral path — the lock is the
-- pg-mem-compatible + codebase-idiomatic fix, the withCharacter pattern).
-- (red-team R7 DoS) the keyless broadcast routes (GET /card, /u, /v1/u) resolve a name
-- case-insensitively via lower(c.name)=lower($1); the unique index above is case-sensitive so it
-- couldn't serve them → a seq-scan of characters on every unauthenticated card/profile/unfurl hit.
CREATE INDEX IF NOT EXISTS ix_char_lower_name ON characters (lower(name));
-- Hot paths that would otherwise full-scan under load: the Streets board, gang
-- rosters, the exchange, and the nightly §10.4 ledger sweep.
CREATE INDEX IF NOT EXISTS ix_char_respect ON characters (respect);
CREATE INDEX IF NOT EXISTS ix_gang_members_gang ON gang_members (gang_id);
CREATE INDEX IF NOT EXISTS ix_listings_created ON listings (created_at);
CREATE INDEX IF NOT EXISTS ix_tx_currency_reason ON transactions (currency, reason);
CREATE INDEX IF NOT EXISTS ix_tx_character ON transactions (character_id);
CREATE INDEX IF NOT EXISTS ix_rng_action ON rng_audit (action);
-- (red-team R16) funnelStats filters telemetry by event ('broadcast_share'/'first_week_step'); without
-- this the admin dashboard's 15s poll seq-scanned the whole (fastest-growing) telemetry table twice.
CREATE INDEX IF NOT EXISTS ix_telemetry_event ON telemetry (event);
CREATE INDEX IF NOT EXISTS ix_notif_char_undelivered ON notifications (character_id) WHERE NOT delivered;
-- one wallet address binds to at most one account (§4)
CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_address ON account_persistent (wallet_address) WHERE wallet_address IS NOT NULL;

-- THE STREET WAGE (the value-creation pivot) — per-character epoch snapshots. One row per living
-- character: `epoch` is the last epoch this character was processed in, `respect` the respect at
-- that moment. The next epoch's wage = respect gained since. The epoch stamp is the idempotency
-- latch (a re-run of the same epoch finds no character stamped epoch-1 and pays nothing twice).
CREATE TABLE IF NOT EXISTS wage_snapshots (
  character_id TEXT PRIMARY KEY REFERENCES characters(id),
  epoch BIGINT NOT NULL,
  respect NUMERIC NOT NULL DEFAULT 0
);

-- THE DEV FUND — the founder's revenue bucket on the real-value boundary (a §10.4 $OMR bucket,
-- the stake_pool twin). Fed by the withdrawal exit toll's dev share (tax:dev); claimed to the
-- founder's own account via POST /v1/mod/dev/claim (tax:dev:claim — a bucket transfer, never a mint).
CREATE TABLE IF NOT EXISTS dev_fund (
  id INT PRIMARY KEY,
  omr NUMERIC NOT NULL DEFAULT 0,
  lifetime NUMERIC NOT NULL DEFAULT 0
);
INSERT INTO dev_fund (id, omr, lifetime) SELECT 1, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM dev_fund);

-- THE TROLL BOX (founder-directed): public city chat + family-only rooms. Pure talk — zero §10.4
-- surface. `name` is a snapshot so history survives death/rename; channel = 'city' or a gang id.
-- Retention is the worker's 7-day sweep; death disposition: ledger (a dead man's words stand).
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES characters(id),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_chat_channel_at ON chat_messages (channel, at);

-- ONE-CLICK X SIGN-IN: OAuth2 PKCE state (single-use, 15-min TTL, swept by the worker). An authed
-- start binds the state to the guest account for a claim-in-place upgrade; the bearer never rides a URL.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  purpose TEXT NOT NULL,
  account_id TEXT,
  invite TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══ THE FIVE PILLARS (content expansion): diplomacy, sovereignty, campaigns, bloodline ═══

-- #2 DIPLOMACY — formal treaties between families. Sorted-pair PK (gang_a < gang_b); a row is a
-- PENDING proposal until `accepted`, then active until `until`. Breaking an active pact early is
-- the OATHBREAK (gangs.oathbreaker_until + boss honor). Rows die with either family (dissolution).
CREATE TABLE IF NOT EXISTS gang_relations (
  gang_a TEXT NOT NULL,
  gang_b TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pact',
  proposed_by TEXT NOT NULL,                     -- the proposing gang's id (the OTHER side accepts)
  accepted BOOLEAN NOT NULL DEFAULT false,
  until TIMESTAMPTZ,                             -- set at accept: now + DIPLOMACY.PACT_MS
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (gang_a, gang_b)
);

-- #2 COALITIONS — the EU4 anti-hegemon: bosses band together against a DOMINANT family. While a
-- coalition holds ≥ COALITION_MIN member families, members get the war-chest + seize discounts vs
-- the target. Expires (lazy-filtered + worker-swept); dies with the target or a member (rows pruned).
CREATE TABLE IF NOT EXISTS coalitions (
  id TEXT PRIMARY KEY,
  target_gang TEXT NOT NULL,
  formed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS coalition_members (
  coalition_id TEXT NOT NULL,
  gang_id TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (coalition_id, gang_id)
);

-- #3 SOVEREIGNTY — one stronghold per held district (the territory-racket shape). The garrison
-- stiffens the district's seize outbid EXCEPT during the daily vulnerability window, when a rival
-- boss can SIEGE it down a tier (razed at 0 — destruction, never a transfer: anti-snowball).
-- Upkeep accrues on its own clock with the EU4 overextension multiplier; unpaid 3d → crumbling
-- (garrison 0). Razed on district seizure + on dissolution.
CREATE TABLE IF NOT EXISTS sov_structures (
  district_id TEXT PRIMARY KEY,
  gang_id TEXT NOT NULL,
  tier INT NOT NULL DEFAULT 1,
  window_hour INT NOT NULL DEFAULT 0,            -- UTC hour the 2h vulnerability window opens
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  upkeep_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  siege_cd_until TIMESTAMPTZ                       -- legacy (retired): the cooldown is now PER-ATTACKER
);

-- #3 SOVEREIGNTY — the siege cooldown is scoped PER (attacker gang, district), NOT per structure,
-- so one family (or a friendly alt) can't burn the single daily window/24h slot to SHIELD a hold
-- from every other attacker (audit HIGH-1). Each attacker is still throttled 24h; a hated hegemon
-- still faces many families' sieges (the anti-snowball contest). Cleared when the structure is razed.
CREATE TABLE IF NOT EXISTS sov_siege_cooldowns (
  district_id TEXT NOT NULL,
  gang_id TEXT NOT NULL,                           -- the ATTACKER
  cd_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (district_id, gang_id)
);

-- #4 CAMPAIGNS — authored quest chains from the Underworld fixers. Progress advances on the
-- existing bumpStanding ACTION stream (the errand precedent) + explicit choices; the one-time
-- reward is claimed (the missions pay-once precedent). Death disposition: WIPED (a fresh street
-- walks the stories again — the roguelike spine).
CREATE TABLE IF NOT EXISTS campaign_progress (
  character_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  step INT NOT NULL DEFAULT 0,
  done INT NOT NULL DEFAULT 0,                   -- progress within the current task step
  branch TEXT,                                   -- the choice taken (colors the finale + reward)
  completed BOOLEAN NOT NULL DEFAULT false,
  claimed BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, campaign_id)
);

-- #5 THE BLOODLINE — the dynasty's death record, written by runEstate at every death.
-- ACCOUNT-level (no character_id — it IS the record of the dead, outside the estate wipe by
-- construction); survives forever. Epithets/titles derive at read (pure status).
CREATE TABLE IF NOT EXISTS bloodline (
  account_id TEXT NOT NULL,
  generation INT NOT NULL,
  name TEXT NOT NULL,
  died_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cause TEXT,                                    -- killer's name, or THE COMMISSION / the Law
  level INT NOT NULL DEFAULT 1,
  kills INT NOT NULL DEFAULT 0,                  -- that street's season kills at death
  honor NUMERIC NOT NULL DEFAULT 0,              -- honor at death (feeds the epithet)
  PRIMARY KEY (account_id, generation)
);
CREATE INDEX IF NOT EXISTS ix_relations_b ON gang_relations (gang_b);
CREATE INDEX IF NOT EXISTS ix_coalition_target ON coalitions (target_gang);
CREATE INDEX IF NOT EXISTS ix_sov_gang ON sov_structures (gang_id);

-- ═══ MARRIAGES & SOLDIERS (founder picks #2+#3) ═══
-- DYNASTIC MARRIAGE — account×account (the vendetta pair pattern), SURVIVES DEATH (the heirs stay
-- in-laws). Monogamous: at most one accepted row per account (enforced in code under the char lock).
CREATE TABLE IF NOT EXISTS dynasty_marriages (
  account_a TEXT NOT NULL,                        -- sorted pair (a < b)
  account_b TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_a, account_b)
);
-- DIVORCE TOMBSTONES (audit MED-2/LOW): a divorced-or-scandaled pair leaves a record so (1) the
-- SCANDAL still fires on a kill within MARRIAGE.SCANDAL_GRACE_MS of the split (closes the
-- divorce-one-action-before-the-kill dodge) and (2) the same pair can't re-marry inside the window
-- (slows marry/divorce vendetta-laundering cycles). Upserted on every accepted-marriage split.
CREATE TABLE IF NOT EXISTS dynasty_divorces (
  account_a TEXT NOT NULL,
  account_b TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_a, account_b)
);

-- THE CONSIGLIERE — each dynasty names ONE adviser (another account); pure status both ways.
CREATE TABLE IF NOT EXISTS consiglieri (
  dynasty_account TEXT PRIMARY KEY,               -- the house doing the naming
  adviser_account TEXT NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_consiglieri_adviser ON consiglieri (adviser_account);

-- NAMED SOLDIERS (XCOM) — recruited muscle with one trait; assist jobs, take a cut, get injured,
-- DIE for good (alive=false rows stay as the memorial). Death disposition: WIPED (they die with
-- the street — a fresh street hires fresh muscle).
CREATE TABLE IF NOT EXISTS soldiers (
  id TEXT PRIMARY KEY,                            -- crypto.randomUUID() in code (the loans/convoys convention)
  character_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trait TEXT NOT NULL,
  xp INT NOT NULL DEFAULT 0,
  injured_until TIMESTAMPTZ,
  on_job BOOLEAN NOT NULL DEFAULT false,          -- the assigned "second" (at most one per street)
  alive BOOLEAN NOT NULL DEFAULT true,
  died_at TIMESTAMPTZ,
  cause TEXT,
  hired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_soldiers_char ON soldiers (character_id);

-- ═══ SECRETS & THE COLLECTION (founder picks #7+#8) ═══
-- BLACKMAIL & SECRETS (CK3 intrigue) — dirt as a HELD asset. Holder = the spy's STREET (dies with
-- them, estate-wiped); target = the mark's ACCOUNT (dirt on a dead street is worthless — deleted at
-- the mark's estate). TTL'd; `demand`/`extort_deadline` set while an extortion window is open.
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  holder_character TEXT NOT NULL,
  target_account TEXT NOT NULL,
  target_name TEXT NOT NULL,                      -- the street the dirt was dug on (display)
  kind TEXT NOT NULL,
  demand NUMERIC,
  extort_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_secrets_target ON secrets (target_account);
-- the per-(digger, target) shovel cooldown
CREATE TABLE IF NOT EXISTS digs (
  character_id TEXT NOT NULL,
  target_account TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, target_account)
);

-- THE COLLECTION — the account-level "ever owned / ever done" completion ledger. Survives death,
-- selling, seizure (the Pokédex compulsion). Pure status — the log moves no value.
CREATE TABLE IF NOT EXISTS collection_log (
  account_id TEXT NOT NULL,
  category TEXT NOT NULL,
  item_id TEXT NOT NULL,
  first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, category, item_id)
);

-- ═══ THE FLOAT (omerta-rwa-float-design.md) — the full-reserve RWA layer. Out-of-band REAL value
-- (the vig/bond/fees precedent): these tables move no §10.4 currency except the rwa:vault $OMR burn,
-- which rides the existing rwa:% vocabulary. Everything is denominated in token UNITS so price
-- movement can never create a shortfall; allocated ≤ held is the anti-Ponzi invariant.
CREATE TABLE IF NOT EXISTS rwa_reserve (
  ticker TEXT PRIMARY KEY,            -- PORTFOLIO.TICKERS id
  units NUMERIC NOT NULL DEFAULT 0,   -- tokenized-stock units the treasury holds (the float)
  eth_spent NUMERIC NOT NULL DEFAULT 0, -- cost basis
  last_price_eth NUMERIC NOT NULL DEFAULT 0, -- the oracle at the last buy (ETH per unit)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rwa_buys (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  eth NUMERIC NOT NULL,               -- ETH spent (≤ unspent rwa_revenue at buy time)
  units NUMERIC NOT NULL,             -- units bought = eth / price_eth
  price_eth NUMERIC NOT NULL,         -- oracle price (mainnet: the Uniswap TWAP)
  tx_hash TEXT,                       -- the real swap tx; NULL = simulated (QA / pre-mainnet)
  real BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- the VAULTED book — account-level (SURVIVES DEATH, the portfolios precedent; never estate-wiped)
CREATE TABLE IF NOT EXISTS rwa_vault (
  account_id UUID NOT NULL,
  ticker TEXT NOT NULL,
  units NUMERIC NOT NULL DEFAULT 0,
  cost_omr NUMERIC NOT NULL DEFAULT 0, -- lifetime $OMR burned into this line (display)
  PRIMARY KEY (account_id, ticker)
);
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS vault_used NUMERIC NOT NULL DEFAULT 0; -- rolling-24h claim bucket
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS vault_at TIMESTAMPTZ;

-- THE CELLPHONE (founder-directed): a personal inbox + player-to-player DIRECT MESSAGES. Pure
-- talk — zero §10.4 surface (no currency ever rides a DM). ACCOUNT-keyed on BOTH sides (the
-- troll-box name-snapshot discipline, lifted to the bloodline: threads survive death/rename —
-- the heir inherits the phone; no character_id column, so the estate wipe never touches it).
-- Retention: the worker's 30-day sweep (talk is ephemeral, not a ledger).
CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  from_account UUID NOT NULL,
  to_account UUID NOT NULL,
  from_name TEXT NOT NULL,          -- sender's street name at send time (snapshot)
  to_name TEXT NOT NULL,            -- recipient's street name at send time (snapshot)
  body TEXT NOT NULL,
  seen BOOLEAN NOT NULL DEFAULT false,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dm_to_seen ON dm_messages (to_account, seen);
CREATE INDEX IF NOT EXISTS ix_dm_from_at ON dm_messages (from_account, at);

-- CELLPHONE step two: BLOCKED LINES. Account-level both sides (a block outlives death — you
-- blocked the bloodline, not the street; the heir stays blocked until you relent). `name` is a
-- display snapshot at block time (the dm name-snapshot discipline). Zero §10.4 surface.
CREATE TABLE IF NOT EXISTS dm_blocks (
  blocker_account UUID NOT NULL,
  blocked_account UUID NOT NULL,
  name TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_account, blocked_account)
);

-- THE MEGAPROJECT (founder pick #1 — the WoW AQ-gate server event): the city announces a monument,
-- the whole base pools cash/goods/$OMR toward a massive target. Every contribution is a SINK
-- (§10.4-positive); completion permanently changes the city (the skyline) + an eternal plaque.
-- One 'building' row at a time; the deterministic PK makes a concurrent materialize a clean 23505.
CREATE TABLE IF NOT EXISTS megaprojects (
  id TEXT PRIMARY KEY,                 -- '<monumentId>:<seq>'
  monument TEXT NOT NULL,              -- MEGAPROJECT.MONUMENTS id
  seq INT NOT NULL,                    -- build order (count of monuments completed before it)
  target NUMERIC NOT NULL,
  progress NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'building',   -- building | complete
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
-- the plaque: ACCOUNT-level (survives death — a DYNASTY raised this; the Portfolio precedent).
-- No character_id column → outside the estate wipe + DISPOSITION guard by construction.
CREATE TABLE IF NOT EXISTS megaproject_contributions (
  project_id TEXT NOT NULL,
  account_id UUID NOT NULL,
  contributed NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, account_id)
);
-- (red-team B3) the plaque's hot reads: top-N by contribution + the rank count
CREATE INDEX IF NOT EXISTS ix_megacontrib_top ON megaproject_contributions (project_id, contributed DESC);

-- THE DUELING LADDER (slate #5 — the ranked ELO circuit): consent-by-listing PvP duels on the
-- audited casino:pvp taxed transfer; the rating is pure status. duel_elo/duel_limit are
-- DIRECT-SQL columns (never in the positional persist — clobber-safe, absolute writes).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS duel_elo INT NOT NULL DEFAULT 1000;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS duel_limit INT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS duel_at TIMESTAMPTZ;  -- challenger cooldown (direct-SQL col)
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS duel_wins INT NOT NULL DEFAULT 0; -- lifetime legend (survives death)
-- the duel log: ACCOUNT-pair keyed for the anti-Sybil K-diminishing (a fresh alt street doesn't
-- reset the pair); no character_id → outside the estate wipe + DISPOSITION guard by construction.
CREATE TABLE IF NOT EXISTS duels (
  id TEXT PRIMARY KEY,
  account_a UUID NOT NULL,           -- sorted pair (a < b)
  account_b UUID NOT NULL,
  winner_account UUID NOT NULL,
  day INT NOT NULL,                  -- dayOf() at the duel (the per-day pair diminishing window)
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_duels_pair_day ON duels (account_a, account_b, day);

-- CLUE SCROLLS (slate #4 — the RuneScape treasure trail): a rare crime drop starts a multi-step
-- riddle hunt derived from the §7.11 seed; the final dig opens a CASKET (a bounded cash faucet).
-- One active scroll per street; it DIES with the street (DISPOSITION: wiped).
CREATE TABLE IF NOT EXISTS clue_scrolls (
  character_id TEXT PRIMARY KEY REFERENCES characters(id),
  salt TEXT NOT NULL,                -- the deterministic seed for every step of THIS hunt
  step INT NOT NULL DEFAULT 1,
  steps INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE characters ADD COLUMN IF NOT EXISTS clue_at TIMESTAMPTZ;      -- post-casket drop cooldown (direct-SQL col)
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS caskets INT NOT NULL DEFAULT 0; -- lifetime legend (survives death)

-- ── ESTATE STEP TWO: THE STAFF & THE GALA (design omerta-deep-deferred-design.md §A) ──
-- The household: account-level staff (survive death with the compound). Wages accrue LAZILY on the
-- estate's single household clock (estates.staff_paid_at — the business-pad/crew-nut pattern) and
-- are settled all-or-nothing as an `estate:staff` $OMR burn. Unpaid past the walk window the staff
-- WALK (rows deleted, arrears cleared — you stiffed them, they left; rehire from scratch).
CREATE TABLE IF NOT EXISTS estate_staff (
  account_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  hired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, staff_id)
);
ALTER TABLE estates ADD COLUMN IF NOT EXISTS staff_paid_at TIMESTAMPTZ;  -- the household wage clock
ALTER TABLE estates ADD COLUMN IF NOT EXISTS gala_until TIMESTAMPTZ;     -- the live gala window
ALTER TABLE estates ADD COLUMN IF NOT EXISTS galas_hosted INT NOT NULL DEFAULT 0;
ALTER TABLE estates ADD COLUMN IF NOT EXISTS gala_best INT NOT NULL DEFAULT 0; -- biggest turnout (status)
-- THE GALA's guest list: one attendance per guest per gala (the gala is keyed by its window end).
-- Account-level both sides (pure status, survives death); guest name snapshotted (the chat pattern).
CREATE TABLE IF NOT EXISTS gala_guests (
  host_account TEXT NOT NULL,
  guest_account TEXT NOT NULL,
  gala_key TIMESTAMPTZ NOT NULL,     -- = the gala's gala_until (identifies the party)
  guest_name TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (host_account, guest_account, gala_key)
);
CREATE INDEX IF NOT EXISTS ix_gala_guests_host ON gala_guests (host_account, gala_key);

-- ── COMMISSION STEP THREE: PROPOSALS WITH DEPOSITS (design omerta-deep-deferred-design.md §B) ──
-- A seated family stakes a treasury CASH deposit to put a decree on the week's ballot. The deposit
-- is ESCROW (ledgered commission:proposal, character_id NULL, counterparty=gang — the family-contract
-- pattern): the proposal matching the tally-enacted decree REFUNDS at settle (commission:refund);
-- the rest FORFEIT to the street-tax pool (commission:forfeit). Rows survive dissolution (the escrow
-- must settle — a dead family's deposit forfeits, the dead-funder precedent).
CREATE TABLE IF NOT EXISTS commission_proposals (
  week INT NOT NULL,
  gang_id UUID NOT NULL,
  decree TEXT NOT NULL,
  deposit NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | refunded | forfeited
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (week, gang_id)
);

-- ── THE LOAN HOUSE (Shylock step five, design omerta-deep-deferred-design.md §C) ──
-- The backed NPC lender: a sink-fed cash pool (half of every P2P loan vig + mod funding from the
-- confiscation pool + its own interest/seizures). THE WALL: the house lends ONLY what the pool
-- holds (full-reserve — an NPC lender that mints cash to lend is a net inflation faucet on default,
-- the audits' standing rule). House loans are normal `loans` rows with lender_character='HOUSE'
-- (the bounty_contributors sentinel precedent — every characters JOIN naturally excludes them).
CREATE TABLE IF NOT EXISTS loan_house (
  id INT PRIMARY KEY CHECK (id = 1),
  pool NUMERIC NOT NULL DEFAULT 0
);
INSERT INTO loan_house (id, pool) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- ── CASINO STEP FIVE: RING POKER (design omerta-deep-deferred-design.md §D) ──
-- True multi-way hold'em on the blackjack_hands stateful precedent + one structural rule that makes
-- it atomic-architecture-native: THE TABLE IS AN ESCROW — cash moves ONLY at sit-down
-- (casino:ring:sit) and cash-out (casino:ring:leave); stacks/bets/pots live in these rows, so no
-- action ever locks another player's character row. THE TABLE ROW LOCK IS THE MUTEX for all of its
-- seat rows (every mutation path — actions, estate, sweep — locks the table first). Raises are
-- capped at the smallest live stack (table-stakes simplified: everyone can always call → NO side
-- pots). Rake is carved from the pot (casino:ring:take — half → street tax, half burns, the
-- audited casino:pvp split). A dead player's stack burns (casino:ring:death, the dead-funder rule).
CREATE TABLE IF NOT EXISTS poker_tables (
  id TEXT PRIMARY KEY,
  bb INT NOT NULL,                     -- the table stake (everyone antes the big blind — ante poker)
  street TEXT,                         -- NULL = no live hand | preflop | flop | turn | river
  deck TEXT,                           -- JSON [[rank,suit],…] — the undealt remainder
  board TEXT,                          -- JSON [[rank,suit],…] — community cards
  pot NUMERIC NOT NULL DEFAULT 0,
  current_bet NUMERIC NOT NULL DEFAULT 0,
  acting_seat INT,
  act_deadline TIMESTAMPTZ,
  hand_no INT NOT NULL DEFAULT 0,
  last_result TEXT,                    -- JSON summary of the last hand (public — shown at the rail)
  last_action_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS poker_ring_seats (
  table_id TEXT NOT NULL,
  seat INT NOT NULL,
  character_id TEXT NOT NULL,
  name TEXT NOT NULL,                  -- snapshot (the chat pattern)
  stack NUMERIC NOT NULL,
  hole TEXT,                           -- JSON [[rank,suit],[rank,suit]] — REDACTED from every other seat
  in_hand BOOLEAN NOT NULL DEFAULT false,
  bet_street NUMERIC NOT NULL DEFAULT 0,
  acted BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (table_id, seat)
);
CREATE INDEX IF NOT EXISTS ix_ring_seats_char ON poker_ring_seats (character_id);
-- THE BRACKET (multi-table elimination): the existing tournament escrow, run in ROUNDS of heats.
ALTER TABLE poker_tournaments ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'showdown';
ALTER TABLE poker_tournaments ADD COLUMN IF NOT EXISTS round INT NOT NULL DEFAULT 0;
ALTER TABLE poker_tournaments ADD COLUMN IF NOT EXISTS next_round_at TIMESTAMPTZ;
ALTER TABLE poker_entries ADD COLUMN IF NOT EXISTS eliminated BOOLEAN NOT NULL DEFAULT false;

-- ── DUELS TIER-4 DEEPENING (design omerta-tier1-deepening-design.md §1) ──
-- duel_style: the chosen weapon stance (direct-SQL, off the positional persist — clobber-safe).
-- duel_titles: lifetime season championships (account-level → survives death, the boxing-belt legend).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS duel_style TEXT;   -- brawler | gunslinger | fencer (NULL = no stance yet)
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS duel_titles INT NOT NULL DEFAULT 0;

-- ── CREW HEISTS TIER-4 DEEPENING (design omerta-tier1-deepening-design.md §2) ──
-- cased: a member cased the job (bounds the casing success bonus); crew_heists.fenced: this plan banks
-- a standard score as HOT LOOT (fenceable book value) instead of cash. heist_loot: a character's hot-loot
-- book value (NOT a §10.4 currency — the Port contraband twin; fenced via heist:fence, loot-able on a
-- fire-kill). heists_pulled: lifetime successful heists (account-level → survives death, the crew legend).
ALTER TABLE crew_heist_members ADD COLUMN IF NOT EXISTS cased BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crew_heists ADD COLUMN IF NOT EXISTS fenced BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS heist_loot NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS heists_pulled INT NOT NULL DEFAULT 0;

-- ── CLUE SCROLLS TIER-4 DEEPENING (design omerta-tier1-deepening-design.md §3) ──
-- tier: the trail tier rolled at drop (easy→master) — sets the step count, casket band, relic rarity.
ALTER TABLE clue_scrolls ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'easy';

-- ── SOVEREIGNTY TIER-4 DEEPENING (design omerta-tier1-deepening-design.md §5) ──
-- income_at: the lazy income clock (a held stronghold yields tribute to the treasury, the territory pattern).
ALTER TABLE sov_structures ADD COLUMN IF NOT EXISTS income_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── SOLDIERS TIER-4 DEEPENING (design omerta-tier1-deepening-design.md §6) ──
-- soldiers_led: lifetime successful jobs led with an assigned soldier (account-level → survives death,
-- the commander legend). Bumped in game.js soldierResult on a successful assist.
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS soldiers_led INT NOT NULL DEFAULT 0;

-- ── THE KITCHEN TIER-4 DEEPENING (design omerta-tier2-deepening-design.md §1) ──
-- LAB MODULES: a purity/yield/stealth upgrade axis layered on the lab tier (read off the character row
-- in cook/collect/accrual; written by direct SQL → clobber-safe). product_moved: lifetime GROSS product
-- moved (account-level → survives death, the KINGPIN legend — pure status, outside §10.4).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS lab_purity INT NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS lab_yield INT NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS lab_stealth INT NOT NULL DEFAULT 0;
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS product_moved NUMERIC NOT NULL DEFAULT 0;

-- ── ASSETS & RACKETS TIER-4 DEEPENING (design omerta-tier2-deepening-design.md §2) ──
-- level: a per-racket upgrade level (0..UP_MAX) multiplying its accrual income (a cash sink to buy).
-- tycoon_earned: lifetime racket + front income earned (account-level → survives death, THE TYCOON
-- legend — pure status, outside §10.4; the racket:income cash still rides its ledgered faucet).
ALTER TABLE character_rackets ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 0;
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS tycoon_earned NUMERIC NOT NULL DEFAULT 0;

-- ── THE MEGAPROJECT TIER-4 DEEPENING (design omerta-tier2-deepening-design.md §3) ──
-- monument_built: lifetime $-value contributed to monuments (account-level → survives death, THE
-- BUILDER legend). gangs.monument_built: the FAMILY that put up the money (the competitive
-- family-build meta; dies with the family). All pure STATUS — the contribution cash/goods/$OMR still
-- rides its §10.4 sink. (The Architect crown is derived at read from the skyline — no cross-account
-- write under the megaprojects singleton lock, so no deadlock surface.)
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS monument_built NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE gangs ADD COLUMN IF NOT EXISTS monument_built NUMERIC NOT NULL DEFAULT 0;

-- ── THE FIVE PILLARS TIER-4 DEEPENING — the HONOR legend (design omerta-tier2-deepening-design.md §4) ──
-- honor_peak / honor_low: the bloodline's high-water mark of honor and its deepest infamy (account-level
-- → survives death; honor itself dies with the street + echoes 25% to the heir). Pure STATUS — the honor
-- legend axis. Bumped in honor.js:bumpHonor (the account is held under the caller's char lock).
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS honor_peak NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS honor_low NUMERIC NOT NULL DEFAULT 0;

-- ── CONVOYS TIER-4 DEEPENING (design omerta-tier3-deepening-design.md §Convoys) ──
-- THE TEAMSTER / THE HIGHWAYMAN legends: lifetime value delivered clean / hijacked off the roads
-- (account-level → survive death, the port-smuggled precedent; pure STATUS, outside §10.4).
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS freight_delivered NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS freight_hijacked NUMERIC NOT NULL DEFAULT 0;
-- THE RIG: one buyable hauler per character (armor→guard-def, engine→transit); dies with the street.
CREATE TABLE IF NOT EXISTS rigs (
  character_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  armor_lvl INT NOT NULL DEFAULT 0,
  engine_lvl INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- the weekly Road Boss / Teamster-of-the-Week contest log (account-keyed → survives death; worker-swept ~8d).
CREATE TABLE IF NOT EXISTS convoy_hauls (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value NUMERIC NOT NULL DEFAULT 0,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_convoy_hauls_win ON convoy_hauls (kind, at);
CREATE INDEX IF NOT EXISTS ix_convoy_hauls_acct ON convoy_hauls (account_id, at);

-- TIER C (omerta-transport-depth-design.md): per-(character, lane) ROUTE NOTORIETY — a heat that grows
-- each run of the same lane and decays lazily (the business-scrutiny pattern), pushing route variety.
-- route_key namespaces the loop: 'convoy:<origin>:<dest>' (a directional land lane) / 'port:<routeId>'
-- (a sea route). EMISSION-SAFE (raises convoy ambush exposure / port interdiction only). Dies with the street.
CREATE TABLE IF NOT EXISTS route_notoriety (
  character_id TEXT NOT NULL,
  route_key TEXT NOT NULL,
  notoriety NUMERIC NOT NULL DEFAULT 0,
  noted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, route_key)
);

-- THE UNDERWRITER (Reserve Bond Tier-4): the earn-in-game backer-prestige axis. pledged_omr is a
-- $OMR-burn-fed account legend (survives death, ranked); bond_charter is the sequential cosmetic seal.
-- Both written by DIRECT SQL only (OFF persistAccount's positional list — the pledged-columns discipline).
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS pledged_omr NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS bond_charter INT NOT NULL DEFAULT 0;

-- THE PATRON PROGRAM (Store Tier-4): patron_spent is the lifetime ETH-equivalent contribution meter
-- (bumped only on REAL contributions — a txHash'd ETH purchase or a PLEX burn; status, survives death);
-- pass_seasons is the Ledger prestige (lifetime tracks completed). Both DIRECT SQL only (OFF persistAccount).
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS patron_spent NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS pass_seasons INT NOT NULL DEFAULT 0;

-- BUSINESS EMPIRE Tier-4: THE LAUNDERER legend (lifetime cash washed through own fronts; survives death,
-- account-level, OFF persistAccount → clobber-safe) + per-front SPECIALIZATION (build-identity, dies with
-- the street via the businesses estate wipe) + the hostile-takeover per-front cooldown.
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS laundered_lifetime NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS spec TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS spec_at TIMESTAMPTZ;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS takeover_cd_until TIMESTAMPTZ;

-- THE COMMISSION Tier-4: THE STATESMAN (lifetime political capital, survives death, ranked; DIRECT SQL
-- only, OFF persistAccount → clobber-safe) + THE OVERRIDE (seated floor families override the head veto).
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS statecraft NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE commission_proposals ADD COLUMN IF NOT EXISTS proposer_account TEXT; -- bumps this account's statecraft on ENACT
CREATE TABLE IF NOT EXISTS commission_overrides (
  week INT NOT NULL, gang_id TEXT NOT NULL, PRIMARY KEY (week, gang_id)
);

-- THE ESTATE & AUCTION HOUSE Tier-4: THE COLLECTOR legend (lifetime + this-season $OMR sunk into
-- prestige — status, survives death; DIRECT SQL only, OFF persistAccount → clobber-safe; NUMERIC += pg-mem-safe)
-- + the PLAYER-CONSIGNMENT resale market (a $OMR bidder→seller transfer with a house TAKE that BURNS).
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS prestige_sunk NUMERIC NOT NULL DEFAULT 0; -- lifetime $OMR sunk into estate+auction prestige (Collector legend)
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS season_sunk NUMERIC NOT NULL DEFAULT 0;   -- this-season prestige spend (Patron crown; reset in runSeasonRollover)
ALTER TABLE auction_wins ADD COLUMN IF NOT EXISTS listed BOOLEAN NOT NULL DEFAULT false;           -- the trophy is on the block (no double-list; the consignment escrow discipline)
CREATE TABLE IF NOT EXISTS auction_consignments (
  id TEXT PRIMARY KEY,                       -- app-generated (crypto.randomUUID)
  seller_account TEXT NOT NULL,
  trophy_lot_id TEXT NOT NULL,               -- the auction_wins.lot_id being resold (unique per historical lot)
  archetype TEXT NOT NULL,
  name TEXT NOT NULL,
  serial TEXT NOT NULL,
  reserve NUMERIC NOT NULL,
  current_bid NUMERIC NOT NULL DEFAULT 0,    -- on status='live' rows this IS the $OMR escrow (added to omrBuckets)
  bidder TEXT,                               -- account_id of the standing top bidder
  status TEXT NOT NULL DEFAULT 'live',       -- 'live' | 'sold' | 'unsold' | 'cancelled'
  closes_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_consign_live ON auction_consignments (status, closes_at);
CREATE INDEX IF NOT EXISTS ix_consign_seller ON auction_consignments (seller_account);

-- ═══ X API CALL BUDGET — the answer is cached, so retries cost credits once ═══════════════════
-- Every X read costs against a paid tier, and the two verification paths were both unbounded on
-- RETRY: a follow check paginates up to 5 pages and a player who has not followed burns all five and
-- can click again immediately; a post check whose tweet is gone re-asks on every attempt. Neither is
-- abuse — it is what a confused player does — but it is where the credits actually go.
--
-- So a check's ANSWER is remembered for a window and served from here. Keyed per (account, kind), so
-- one player's spam cannot spend another's budget. Only NEGATIVE answers need storing: a positive
-- follow marks the task claimed forever, and a paid share is marked paid — neither is ever re-asked.
CREATE TABLE IF NOT EXISTS x_checks (
  account_id TEXT NOT NULL,
  kind       TEXT NOT NULL,               -- 'follow' | 'post'
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind)
);

-- ── TOKENOMICS v2 (2026-07-27) ────────────────────────────────────────────────────────────────────
-- THE EXCHANGE. Cash → OMR is gone, so the constant-product AMM cannot survive: a one-directional
-- AMM drains its cash side monotonically and shuts itself. This replaces it — burn OMR, receive cash
-- from a pool that only real cash sinks feed, at a published rate, clamped to what was funded.
-- `lifetime_funded`/`lifetime_paid` are what the `exchange pool backed` invariant reconciles.
-- the redemption window's per-account rolling-24h cap (the D3 wash-bucket pattern, on the account).
-- Direct-SQL columns: absent from persistAccount's positional UPDATE, so they cannot be clobbered.
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS exchange_used NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE account_persistent ADD COLUMN IF NOT EXISTS exchange_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS exchange_pool (
  id INT PRIMARY KEY,
  balance NUMERIC NOT NULL DEFAULT 0,        -- cash available to pay redemptions
  lifetime_funded NUMERIC NOT NULL DEFAULT 0,
  lifetime_paid NUMERIC NOT NULL DEFAULT 0
);
INSERT INTO exchange_pool (id) VALUES (1) ON CONFLICT DO NOTHING;

-- THE FAMILY YIELD. What individual staking rewards and personal RWA dividends are repurposed into:
-- a pot distributed to the top families by standing, so family politics carries a real economic
-- prize and OMR has a reason to be held by an organisation rather than sold by a person.
CREATE TABLE IF NOT EXISTS family_yield_pool (
  id INT PRIMARY KEY,
  balance NUMERIC NOT NULL DEFAULT 0,        -- soft $OMR awaiting distribution
  lifetime_funded NUMERIC NOT NULL DEFAULT 0,
  lifetime_paid NUMERIC NOT NULL DEFAULT 0
);
INSERT INTO family_yield_pool (id) VALUES (1) ON CONFLICT DO NOTHING;

-- THE FLOAT, RE-SOURCED (v2 step 3). Bond ETH gains a fourth destination — the stock float — because
-- the DEX tax alone scales with trading volume and the one-way conversion is designed to produce a
-- quiet market. Recorded alongside pol/dev; the same ETH also lands in rwa_revenue (source='bond'),
-- which is what the buy bot actually draws on, so `bond ETH split == principal` reconciles.
ALTER TABLE bond_reserve ADD COLUMN IF NOT EXISTS rwa_eth NUMERIC NOT NULL DEFAULT 0;

-- THE DEX SELL-TAX LEDGER — one row per taxed episode (a `SellTaxTaken` log on mainnet; a mod/QA
-- simulate until step 4 arms the contract). The tax is charged in OMR at the pool, so an episode
-- records both the OMR taken and the ETH it was valued/realized at, then splits that ETH three ways
-- (SELL_TAX.DEV/RWA/LP_BPS). Only the RWA slice is mirrored into rwa_revenue (source='tax'); the dev
-- and LP slices are recorded here for reconciliation and for the founder's revenue view. Out-of-band
-- real value like vig_revenue/rwa_revenue: ZERO §10.4 rows. `real` marks a genuine on-chain episode —
-- a simulate books the episode but NO revenue, so a comp can never fabricate float backing (the
-- store/bond txHash discipline).
CREATE TABLE IF NOT EXISTS sell_tax_events (
  ref TEXT PRIMARY KEY,                       -- the log key (txHash:logIndex on-chain; a mod ref off it)
  omr_taxed NUMERIC NOT NULL,                 -- OMR the contract carved out of the sell
  price_omr_per_eth NUMERIC NOT NULL,         -- what it was valued at (the TWAP the bot realized)
  gross_eth NUMERIC NOT NULL,                 -- omr_taxed / price
  dev_eth NUMERIC NOT NULL DEFAULT 0,
  rwa_eth NUMERIC NOT NULL DEFAULT 0,         -- mirrored into rwa_revenue (source='tax') when real
  lp_eth NUMERIC NOT NULL DEFAULT 0,
  tx_hash TEXT,
  real BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════ THE TRADES (mastery expansion, omerta-mastery-design.md) ═══════════════
-- Per-street use-XP tracks — RuneScape farming pointed at the verbs the game already has.
-- NUMERIC on purpose (the pg-mem INT-arithmetic quirk register); writes are absolute values
-- computed in JS under the char lock (the npc_standing/bumpStanding discipline). XP is NOT a
-- currency: zero transactions rows, zero §10.4 surface. Dies with the street (runEstate wipe)
-- with a MASTERY.HEIR_KEEP_BPS echo to the heir — the founder-signed death rule.
CREATE TABLE IF NOT EXISTS masteries (
  character_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  xp NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, track_id)
);

-- The lifetime legend — account-level, survives death whole (the hitman-rep/season-kills duality:
-- the street's LEVEL is the contestable face, the bloodline's lifetime XP is the monument).
-- Status only: rank titles + the leaderboard, zero gameplay power.
CREATE TABLE IF NOT EXISTS mastery_legend (
  account_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  xp NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, track_id)
);

-- THE TRADES step two: the level-50 trait choice (one of two per track, permanent, dies with the
-- street — the estate wipes it; the DYNAST trait is read at the estate BEFORE the wipe to deepen
-- that track's heir echo). Pure status/modifier state — never a currency.
CREATE TABLE IF NOT EXISTS character_traits (
  character_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  trait_id TEXT NOT NULL,
  PRIMARY KEY (character_id, track_id)
);

-- PATHS v2: the career-switch cooldown clock (direct-SQL column, off persistCharacter's positional
-- UPDATE — the respec_at pattern). XP-rate arbitrage (home ×1.5 / rival ×0.6) made the 25 $OMR burn
-- too cheap a throttle on its own.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS path_at TIMESTAMPTZ;

-- THE TRADES step four (stats by use): the rolling daily token bucket metering use-trained stat
-- points (the D3 wash / port supply pattern — used decays continuously over 24h). Direct-SQL
-- columns, off persistCharacter's positional UPDATE.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS statuse_used NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS statuse_at TIMESTAMPTZ;

-- THE REGIMEN (omerta-training-expansion-design.md): five trainable DISCIPLINES beyond the three
-- core stats, each ONE named touchpoint. XP is not a currency (zero §10.4 surface); trained on the
-- SAME gym cooldown clock as the core stats (breadth, never rate). DIES WITH THE STREET.
CREATE TABLE IF NOT EXISTS character_disciplines (
  character_id TEXT NOT NULL,
  discipline TEXT NOT NULL,
  xp INT NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, discipline)
);
-- the NPC trainer drills — one per fixture per day (seed-drawn), claimed once. Progress is READ
-- from daily_progress.counters (zero new counting surface). Dies with the street.
CREATE TABLE IF NOT EXISTS npc_drills (
  character_id TEXT NOT NULL,
  day INT NOT NULL,
  npc TEXT NOT NULL,
  PRIMARY KEY (character_id, day, npc)
);

-- THE HUSTLE — the daily three-stop job chain (crime-loop interactivity). One row per street per
-- day; `step` is the NEXT stop to claim (0..2, 3 = paid); `baseline` snapshots the day's action
-- counters when the legwork stop opens so the required action is verified as a DELTA. Dies with
-- the street (estate wipe) — the heir draws fresh work.
CREATE TABLE IF NOT EXISTS hustles (
  character_id TEXT NOT NULL,
  day INT NOT NULL,
  step INT NOT NULL DEFAULT 0,
  baseline TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (character_id, day)
);

-- PEN step six: the daily yard-character conversation — once per (inmate, day). Dies with the
-- street (estate wipe); the seed-drawn cast lives in PEN.YARD_CAST (rules tail).
CREATE TABLE IF NOT EXISTS pen_talks (
  character_id TEXT NOT NULL,
  day INT NOT NULL,
  PRIMARY KEY (character_id, day)
);

-- THE CAREER (task #308): once-ever-per-ACCOUNT claim latches for the post-First-Week progression
-- ladder. Account-level BY DESIGN — the ladder survives death (the heir keeps the climb; the
-- once-ever bound is what caps the career: cash faucet at its lifetime total per account), so this
-- table is NEVER estate-wiped (the first_week/onboard posture).
CREATE TABLE IF NOT EXISTS career_claims (
  account_id UUID NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (account_id, task_id)
);

-- THE STREET WAR + THE RIVALS LEDGER (omerta-street-rivals-design.md, founder-directed).
-- rival_events is ACCOUNT-keyed on BOTH sides (malice follows the bloodline — the vendetta/dm_blocks
-- posture; no character_id column, so the estate wipe never touches it by construction). It records
-- ONLY acts whose existing notify already NAMES the aggressor to the victim — the info-economy rule.
CREATE TABLE IF NOT EXISTS rival_events (
  id UUID PRIMARY KEY,
  victim_account UUID NOT NULL,
  aggressor_account UUID NOT NULL,
  kind TEXT NOT NULL,                              -- jump | shakedown | rob | car_theft | takeover | kill
  detail JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rival_events_victim ON rival_events (victim_account, at DESC);
-- the victim's car-theft shield: a player loses at most ONE car per window to theft, however many
-- thieves try (direct-SQL under the withTwoCharacters victim lock — outside persistCharacter's list)
ALTER TABLE characters ADD COLUMN IF NOT EXISTS car_stolen_at TIMESTAMPTZ;
-- STREET WAR step two: the trunk-robbery + sabotage victim shields (one landed robbery / one landed
-- sabotage per victim per window, however many attackers try — the car_stolen_at posture; direct
-- SQL on the locked victim row, outside persistCharacter's positional list)
ALTER TABLE characters ADD COLUMN IF NOT EXISTS trunk_robbed_at TIMESTAMPTZ;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS sabotaged_at TIMESTAMPTZ;

-- ═══ STREET LIFE (task #318) — the black book, the corner, the call ═══
-- THE BLACK BOOK: phone numbers are DISCOVERABLE, never free. ACCOUNT-keyed both sides (the
-- dm_blocks/rival_events posture): a number follows the bloodline — the heir keeps the line and
-- your book survives death by construction (no character_id column → outside the estate wipe).
-- how: 'met' (any completed two-party action), 'intel' (a tap/dossier), 'called' (they rang you
-- first — a caller reveals their own number).
CREATE TABLE IF NOT EXISTS contacts (
  owner_account TEXT NOT NULL,
  contact_account TEXT NOT NULL,
  how TEXT NOT NULL,
  met_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_account, contact_account)
);
-- migration seed: pre-gate DM threads mean both parties already have each other's line
INSERT INTO contacts (owner_account, contact_account, how)
  SELECT DISTINCT from_account::text, to_account::text, 'called' FROM dm_messages ON CONFLICT DO NOTHING;
INSERT INTO contacts (owner_account, contact_account, how)
  SELECT DISTINCT to_account::text, from_account::text, 'called' FROM dm_messages ON CONFLICT DO NOTHING;
-- WORD ON THE STREET: per-district daily tasks; accept snapshots the daily counters (the hustle
-- baseline rule — stockpiled morning work can't pre-pay a task). Dies with the street.
CREATE TABLE IF NOT EXISTS corner_jobs (
  character_id TEXT NOT NULL,
  day INT NOT NULL,
  district TEXT NOT NULL,
  slot INT NOT NULL,
  baseline TEXT NOT NULL,
  claimed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (character_id, day, district, slot)
);
-- THE CALL: one open request per street from an NPC contact (freight run / come-see-me), paid from
-- the CONTACT'S OWN cash (recycle-only — the population step-two rule). Dies with the street.
CREATE TABLE IF NOT EXISTS contact_calls (
  character_id TEXT PRIMARY KEY,
  npc_character TEXT NOT NULL,
  kind TEXT NOT NULL,
  good_id TEXT,
  qty INT,
  district TEXT NOT NULL,
  pay NUMERIC NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
