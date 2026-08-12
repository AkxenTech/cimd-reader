CREATE TABLE IF NOT EXISTS oauth_client_registrations (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris_json TEXT NOT NULL,
  raw_body_json TEXT NOT NULL,
  last_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_client_registrations_updated_at ON oauth_client_registrations(updated_at);
