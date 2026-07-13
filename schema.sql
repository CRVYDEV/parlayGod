-- OMERTÀ backend — M1 schema (see omerta-backend-spec.md §3)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  auth_provider TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_ip TEXT, last_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_persistent (
  account_id TEXT PRIMARY KEY,
  prestige INT NOT NULL DEFAULT 0,
  omr NUMERIC NOT NULL DEFAULT 0,
  staked NUMERIC NOT NULL DEFAULT 0,
  rewards NUMERIC NOT NULL DEFAULT 0,
  wallet_address TEXT,
  recruits INT NOT NULL DEFAULT 0,
  onboard TEXT NOT NULL DEFAULT '{}',
  checkins_lifetime INT NOT NULL DEFAULT 0,
  referred_by TEXT, ref_paid BOOLEAN NOT NULL DEFAULT false,
  agent_flag BOOLEAN NOT NULL DEFAULT false,
  deaths INT NOT NULL DEFAULT 0
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
  heist_at TIMESTAMPTZ,
  season INT NOT NULL,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  treasury NUMERIC NOT NULL DEFAULT 0,
  omr_reserve NUMERIC NOT NULL DEFAULT 0,
  ammo_bank INT NOT NULL DEFAULT 0,
  lifetime_tribute NUMERIC NOT NULL DEFAULT 0,   -- standing for buyback payouts
  wars_won INT NOT NULL DEFAULT 0,               -- +10,000 standing each
  weekly_week INT,
  weekly_progress NUMERIC NOT NULL DEFAULT 0,
  weekly_done BOOLEAN NOT NULL DEFAULT false,
  war_with TEXT,
  war_until TIMESTAMPTZ,
  war_score_us INT NOT NULL DEFAULT 0,
  war_score_them INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- role is the source of truth for command: 'boss' | 'underboss' | 'capo' | 'soldier'
CREATE TABLE IF NOT EXISTS gang_members (
  gang_id TEXT NOT NULL,
  character_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'soldier',
  PRIMARY KEY (gang_id, character_id)
);
CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  holder_gang TEXT,
  garrison NUMERIC NOT NULL DEFAULT 0,
  seized_at TIMESTAMPTZ
);
INSERT INTO districts (id) SELECT 'docks'     WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='docks');
INSERT INTO districts (id) SELECT 'neon'      WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='neon');
INSERT INTO districts (id) SELECT 'foundry'   WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='foundry');
INSERT INTO districts (id) SELECT 'brick'     WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='brick');
INSERT INTO districts (id) SELECT 'canal'     WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='canal');
INSERT INTO districts (id) SELECT 'cathedral' WHERE NOT EXISTS (SELECT 1 FROM districts WHERE id='cathedral');
CREATE TABLE IF NOT EXISTS bounties (
  target_character TEXT PRIMARY KEY,
  amount NUMERIC NOT NULL,
  posted_by TEXT NOT NULL,                       -- character id; never paid to the poster
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS searches (
  hunter TEXT PRIMARY KEY,                       -- one active contract each (§5.2)
  target TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  status INT NOT NULL,
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
-- Seed the singletons once (idempotent; virtual pool ≈ $500 / $OMR).
INSERT INTO amm_pool (id, cash_reserve, omr_reserve)
  SELECT 1, 10000000, 20000 WHERE NOT EXISTS (SELECT 1 FROM amm_pool);
INSERT INTO street_tax (id, pool, fund)
  SELECT 1, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM street_tax);
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
