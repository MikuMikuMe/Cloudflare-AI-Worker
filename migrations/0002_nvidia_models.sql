-- Migration 0002: daily NVIDIA free-endpoint model index
-- The catalog is metadata only. NVIDIA credentials and model traffic never
-- pass through D1.

CREATE TABLE IF NOT EXISTS nvidia_models (
  id            TEXT PRIMARY KEY,
  created       INTEGER NOT NULL DEFAULT 0,
  owned_by      TEXT NOT NULL,
  free_endpoint INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  last_seen_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nvidia_models_active ON nvidia_models (active);
