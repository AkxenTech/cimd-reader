CREATE TABLE IF NOT EXISTS mcp_protocol_observations (
  id TEXT PRIMARY KEY NOT NULL,
  client_name TEXT,
  client_version TEXT,
  identity_source TEXT NOT NULL,
  phase TEXT NOT NULL,
  requested_version TEXT,
  header_version TEXT,
  params_version TEXT,
  meta_version TEXT,
  selected_version TEXT,
  outcome TEXT NOT NULL,
  error_code INTEGER,
  error_message TEXT,
  server_versions_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1
);
