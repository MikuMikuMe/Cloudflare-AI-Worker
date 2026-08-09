-- Migration 0003: Access-owned persistent dashboard conversations.
-- Conversation content is intentionally separate from the stateless /v1 API.

CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT    PRIMARY KEY,
  owner_scope  TEXT    NOT NULL,
  owner_sub    TEXT    NOT NULL,
  owner_email  TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  last_model   TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  next_seq     INTEGER NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_owner_updated
  ON conversations (owner_scope, owner_sub, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id               TEXT    PRIMARY KEY,
  conversation_id  TEXT    NOT NULL,
  client_turn_id   TEXT    NOT NULL,
  seq              INTEGER NOT NULL CHECK (seq >= 1),
  role             TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT    NOT NULL,
  status           TEXT    NOT NULL CHECK (status IN ('complete', 'generating', 'interrupted', 'error')),
  model            TEXT    NOT NULL,
  metadata_json    TEXT,
  created_at       INTEGER NOT NULL,
  completed_at     INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  UNIQUE (conversation_id, seq),
  UNIQUE (conversation_id, client_turn_id, role)
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_order
  ON conversation_messages (conversation_id, seq ASC);

-- A conversation can have only one server-owned generation in flight.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_one_generation
  ON conversation_messages (conversation_id)
  WHERE role = 'assistant' AND status = 'generating';
