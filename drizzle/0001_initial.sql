CREATE TABLE IF NOT EXISTS mcp_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  vendor TEXT,
  support_status TEXT NOT NULL,
  metadata_url TEXT,
  source_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_sessions (
  id TEXT PRIMARY KEY,
  label TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  created_at TEXT NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  client_id TEXT,
  redirect_uri TEXT,
  response_type TEXT,
  scope TEXT,
  state TEXT,
  resource TEXT,
  code_challenge TEXT,
  code_challenge_method TEXT,
  user_agent TEXT,
  classification TEXT,
  raw_query_json TEXT,
  raw_body_json TEXT
);

CREATE TABLE IF NOT EXISTS cimd_validation_results (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  metadata_url TEXT NOT NULL,
  metadata_fetch_success INTEGER NOT NULL,
  metadata_http_status INTEGER,
  metadata_valid INTEGER NOT NULL,
  validation_errors TEXT,
  validation_warnings TEXT,
  raw_metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_attempts_session_id ON oauth_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_oauth_attempts_client_id ON oauth_attempts(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_attempts_created_at ON oauth_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_cimd_results_attempt_id ON cimd_validation_results(attempt_id);
