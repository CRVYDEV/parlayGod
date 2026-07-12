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
