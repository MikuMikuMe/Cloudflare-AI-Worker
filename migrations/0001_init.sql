-- Migration 0001: API keys + usage accounting
-- Keys are NEVER stored in plaintext. We store a SHA-256 hex digest and a short
-- display prefix so the dashboard can show "sk-cfai-a1b2…" without holding the secret.

CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  name          TEXT    NOT NULL,
  key_hash      TEXT    NOT NULL UNIQUE,
  key_prefix    TEXT    NOT NULL,
  owner_email   TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER,
  request_count INTEGER NOT NULL DEFAULT 0,
  total_tokens  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash  ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys (owner_email);

-- Daily rollup keeps write volume tiny (one upsert per key per day) instead of
-- one row per request, which protects the 100k/day free-tier write budget.
CREATE TABLE IF NOT EXISTS usage_daily (
  day               TEXT    NOT NULL,
  key_id            TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  requests          INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key_id, model)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_day ON usage_daily (day);
