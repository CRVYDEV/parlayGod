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
  deaths INT NOT NULL DEFAULT 0,
  -- §11 real-ETH entry fees (paid on-chain to OmertaFees, forwarded straight to the dev
  -- wallet — never in-game currency, never touches the §10.4 ledger). `minted` = paid the
  -- 0.01 ETH mint fee (the two-tier gate: only minted accounts can withdraw/mint gear).
  -- `mint_credits` / `respawn_tokens` are unspent on-chain payments the watcher credited.
  minted BOOLEAN NOT NULL DEFAULT false,
  mint_credits INT NOT NULL DEFAULT 0,
  respawn_tokens INT NOT NULL DEFAULT 0,
  -- M7 Phase 2 — the assassin's LEGEND (account-level, survives death like prestige/$OMR):
  -- lifetime feared-reputation (the "most feared" ladder) + lifetime confirmed kills.
  hitman_rep BIGINT NOT NULL DEFAULT 0,
  kills INT NOT NULL DEFAULT 0,
  boxing_wins INT NOT NULL DEFAULT 0,   -- lifetime fighter wins across the stable (a career legend that SURVIVES DEATH — the hitman-rep precedent)
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
  npchit_at TIMESTAMPTZ,                          -- M7 Phase 3: NPC-hitman hire cooldown
  safe_until TIMESTAMPTZ,                          -- M7 Phase 4: safehouse — untargetable by fire/NPC-hit
  guard_price NUMERIC,                             -- M7 Phase 4: bodyguard-for-hire listing (NULL = not offering)
  fade_limit NUMERIC,                              -- Den step 2: open back-room dice challenge limit (NULL = not fading)
  -- D3: per-account daily cap on the PUBLIC wash route (a token bucket, like a business front's
  -- launderCapDay — heat was the only brake and it decays in minutes)
  wash_used NUMERIC NOT NULL DEFAULT 0,
  wash_at TIMESTAMPTZ,
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
  welsher BOOLEAN NOT NULL DEFAULT false,          -- LOAN SHARKING: defaulted on a debt — can't borrow again (dies with the street)
  wanted_until TIMESTAMPTZ,                         -- LOAN step 4: WANTED — a defaulter under active pursuit (omertà stripped + NPC hunters + a pool bounty) until it lapses or they square up
  envelope_until TIMESTAMPTZ,                       -- THE ENVELOPE: standing graft to the cops — investigation meter builds slower while current (a $OMR sink)
  wire_until TIMESTAMPTZ,                           -- THE WIRE: the Street Wire premium-intelligence subscription window (a $OMR sink)
  disinfo_until TIMESTAMPTZ,                        -- THE WIRE step three: DISINFORMATION — while current, any WIRETAP reading you gets cooked private signals (a $OMR sink; an informant sees through it)
  active_at TIMESTAMPTZ,                            -- SKILLS step two: shared cooldown across capstone-unlocked ACTIVE abilities
  race_at TIMESTAMPTZ,                              -- STREET RACES: per-driver race cooldown (written by direct SQL, outside persist — the active_at pattern)
  port_used NUMERIC NOT NULL DEFAULT 0,             -- THE PORT: contraband bought in the rolling 24h supply window (the D3 wash-cap token bucket; direct SQL, outside persist)
  port_at TIMESTAMPTZ,                              -- …the window's start marker
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

-- VENDETTAS: a player fire-kill swears the victim's bloodline (ACCOUNT) against the killer's —
-- surviving both sides' deaths until settled (a revenge fire-kill, 2x rep) or lapsed. One active
-- vendetta per pair (a repeat kill refreshes the clock). Zero money flows — pure status + the
-- directed-floor waiver. Design: omerta-vendetta-design.md.
CREATE TABLE IF NOT EXISTS vendettas (
  avenger_account TEXT NOT NULL,
  target_account TEXT NOT NULL,
  sworn TEXT NOT NULL,                 -- the dead street's name (who this is for)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (avenger_account, target_account)
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
  owner_character TEXT NOT NULL,
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
  pol_eth NUMERIC NOT NULL DEFAULT 0          -- Σ POL share of bonded ETH (deepens the OMR-ETH pool on mainnet)
);
INSERT INTO bond_reserve (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM bond_reserve);

-- ── M2 economy singletons (spec §3.4, §7.12) ──
-- Constant-product AMM, single row, row-locked on every swap.
CREATE TABLE IF NOT EXISTS amm_pool (
  id INT PRIMARY KEY,
  cash_reserve NUMERIC NOT NULL,
  omr_reserve NUMERIC NOT NULL
);
-- Street-tax accumulator + event fund; the 12h buyback drains `pool`.
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
-- Hot paths that would otherwise full-scan under load: the Streets board, gang
-- rosters, the exchange, and the nightly §10.4 ledger sweep.
CREATE INDEX IF NOT EXISTS ix_char_respect ON characters (respect);
CREATE INDEX IF NOT EXISTS ix_gang_members_gang ON gang_members (gang_id);
CREATE INDEX IF NOT EXISTS ix_listings_created ON listings (created_at);
CREATE INDEX IF NOT EXISTS ix_tx_currency_reason ON transactions (currency, reason);
CREATE INDEX IF NOT EXISTS ix_tx_character ON transactions (character_id);
CREATE INDEX IF NOT EXISTS ix_rng_action ON rng_audit (action);
CREATE INDEX IF NOT EXISTS ix_notif_char_undelivered ON notifications (character_id) WHERE NOT delivered;
-- one wallet address binds to at most one account (§4)
CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_address ON account_persistent (wallet_address) WHERE wallet_address IS NOT NULL;
