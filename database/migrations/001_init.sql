-- M1 core tables (docs/08-technical/02). Future-milestone tables created now so schema is stable.
CREATE TABLE IF NOT EXISTS accounts (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jobs (
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id      TEXT NOT NULL,
  level       INT NOT NULL DEFAULT 1,
  exp         INT NOT NULL DEFAULT 0,
  rebirth_count INT NOT NULL DEFAULT 0,
  stat_str    INT NOT NULL DEFAULT 0,   -- allocated points only (base comes from config)
  stat_dex    INT NOT NULL DEFAULT 0,
  stat_con    INT NOT NULL DEFAULT 0,
  stat_int    INT NOT NULL DEFAULT 0,
  unspent_points INT NOT NULL DEFAULT 0,
  mastery_milestones INT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, job_id)
);

CREATE TABLE IF NOT EXISTS account_state (
  account_id     BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  current_job_id TEXT NOT NULL DEFAULT 'novice',
  gold           BIGINT NOT NULL DEFAULT 0 CHECK (gold >= 0),
  diamond        BIGINT NOT NULL DEFAULT 0 CHECK (diamond >= 0),
  arena_coin     BIGINT NOT NULL DEFAULT 0 CHECK (arena_coin >= 0),
  wb_medal       BIGINT NOT NULL DEFAULT 0 CHECK (wb_medal >= 0),
  current_map    TEXT NOT NULL DEFAULT 'town',
  tutorial_flags JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS skills_unlocked (
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  skill_id   TEXT NOT NULL,
  PRIMARY KEY (account_id, skill_id)
);

CREATE TABLE IF NOT EXISTS items (
  id            BIGSERIAL PRIMARY KEY,
  account_id    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL,
  rarity        TEXT NOT NULL DEFAULT 'common',
  enhance_level INT NOT NULL DEFAULT 0,
  equipped_slot TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_account ON items(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_equipped ON items(account_id, equipped_slot) WHERE equipped_slot IS NOT NULL;

CREATE TABLE IF NOT EXISTS battles (
  battle_id    UUID PRIMARY KEY,
  account_id   BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  seed         BIGINT NOT NULL,
  data_version TEXT NOT NULL,
  result       JSONB NOT NULL,
  total_damage BIGINT NOT NULL DEFAULT 0,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_battles_account ON battles(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  account_id    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency      TEXT NOT NULL,
  delta         BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reason        TEXT NOT NULL,
  ref_id        TEXT,
  source        TEXT NOT NULL DEFAULT 'game',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id, created_at DESC);
