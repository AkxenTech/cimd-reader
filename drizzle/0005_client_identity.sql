ALTER TABLE oauth_attempts ADD COLUMN issuer TEXT;
ALTER TABLE oauth_client_registrations ADD COLUMN issuer TEXT;
ALTER TABLE mcp_clients ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_clients ADD COLUMN hidden_reason TEXT;
ALTER TABLE mcp_protocol_observations ADD COLUMN oauth_identity_id TEXT;
CREATE TABLE IF NOT EXISTS client_identity_mappings (
  identity_id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES mcp_clients(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diagnostic_connections (
  token_hash TEXT PRIMARY KEY NOT NULL,
  identity_id TEXT,
  session_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diagnostic_authorization_codes (
  code_hash TEXT PRIMARY KEY NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT,
  redirect_uri TEXT,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_identity ON oauth_attempts(issuer, client_id);
CREATE INDEX IF NOT EXISTS idx_protocol_identity ON mcp_protocol_observations(oauth_identity_id);
