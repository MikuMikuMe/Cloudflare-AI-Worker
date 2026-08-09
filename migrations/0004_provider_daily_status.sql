-- Migration 0004: short-lived provider status confirmed by authoritative
-- upstream errors. This closes the analytics-lag window after Workers AI
-- rejects a request for daily quota exhaustion.

CREATE TABLE IF NOT EXISTS provider_daily_status (
  provider    TEXT    NOT NULL,
  day_utc     TEXT    NOT NULL,
  state       TEXT    NOT NULL CHECK (state IN ('quota_exhausted')),
  reason_code TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (provider, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_provider_daily_status_expires
  ON provider_daily_status (expires_at);
