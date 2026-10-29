-- Reviewed historical identities only. New registrations are never mapped by their reported names.
CREATE TABLE IF NOT EXISTS data_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);

WITH reviewed(client_id, identity_id, product_id, name, category) AS (VALUES
  ('dcr-pi', 'db49a47e0193baa70754d8bcfab693f95be65b47281bb03a3dbecd60895a539e', 'pi', 'Pi', 'CLI'),
  ('dcr-codex', 'af0935e378ffda0c54ed593d0044dc719fed19402edda7eb9413f5091c487023', 'codex-cli', 'Codex CLI', 'CLI'),
  ('dcr-cursor', '595fc8311be9b6e31de7cf122040ea08cb34ce8a545db6026b693f7768f0cce2', 'cursor', 'Cursor', 'IDE'),
  ('dcr-devin-cli', '9ed1432a10414447176f8069dcb05e88f8e530329d776f076650f8dc8d658228', 'devin-cli', 'Devin CLI', 'CLI'),
  ('dcr-windsurf', '4c7f5d1cc460ac3555da4c5ae7a62a1432ef38276a5c7900946b9aeef4e622ad', 'windsurf', 'Windsurf', 'IDE'),
  ('dcr-builder', '807be4fe721a88a12ce1bd759e41e1a8d4cfc3aa5d427ecffc25f3f389532631', 'builder', 'Builder', 'Tool'),
  ('dcr-bolt', 'c234493827a25d56591fba4b0fa742fb4a6dc5214a0e18b0d0aa04da590ddfcb', 'bolt', 'Bolt', 'Tool'),
  ('dcr-replit-mcp-connector', 'e16b96a9ad774df50e2d4114c4bcd48a038c220dbb4a2d75338337c2b32033a2', 'replit-mcp-connector', 'Replit MCP Connector', 'Tool'),
  ('dcr-mcp-use-inspector', '4085a221beddb6a6361dc3ab677a85b7c037d2cade4e31caa5f053d5993cf6c5', 'mcp-use-inspector', 'mcp-use Inspector', 'Debugger')
)
INSERT OR IGNORE INTO mcp_clients (id, name, category, support_status, created_at, updated_at)
SELECT product_id, name, category, 'unknown', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM reviewed
WHERE EXISTS (SELECT 1 FROM oauth_attempts a WHERE a.issuer IS NULL AND a.client_id = reviewed.client_id)
  AND NOT EXISTS (SELECT 1 FROM data_migrations WHERE id = '0006_legacy_client_associations');

WITH reviewed(client_id, identity_id, product_id, name, category) AS (VALUES
  ('dcr-pi', 'db49a47e0193baa70754d8bcfab693f95be65b47281bb03a3dbecd60895a539e', 'pi', 'Pi', 'CLI'),
  ('dcr-codex', 'af0935e378ffda0c54ed593d0044dc719fed19402edda7eb9413f5091c487023', 'codex-cli', 'Codex CLI', 'CLI'),
  ('dcr-cursor', '595fc8311be9b6e31de7cf122040ea08cb34ce8a545db6026b693f7768f0cce2', 'cursor', 'Cursor', 'IDE'),
  ('dcr-devin-cli', '9ed1432a10414447176f8069dcb05e88f8e530329d776f076650f8dc8d658228', 'devin-cli', 'Devin CLI', 'CLI'),
  ('dcr-windsurf', '4c7f5d1cc460ac3555da4c5ae7a62a1432ef38276a5c7900946b9aeef4e622ad', 'windsurf', 'Windsurf', 'IDE'),
  ('dcr-builder', '807be4fe721a88a12ce1bd759e41e1a8d4cfc3aa5d427ecffc25f3f389532631', 'builder', 'Builder', 'Tool'),
  ('dcr-bolt', 'c234493827a25d56591fba4b0fa742fb4a6dc5214a0e18b0d0aa04da590ddfcb', 'bolt', 'Bolt', 'Tool'),
  ('dcr-replit-mcp-connector', 'e16b96a9ad774df50e2d4114c4bcd48a038c220dbb4a2d75338337c2b32033a2', 'replit-mcp-connector', 'Replit MCP Connector', 'Tool'),
  ('dcr-mcp-use-inspector', '4085a221beddb6a6361dc3ab677a85b7c037d2cade4e31caa5f053d5993cf6c5', 'mcp-use-inspector', 'mcp-use Inspector', 'Debugger')
)
INSERT OR IGNORE INTO client_identity_mappings (identity_id, product_id, created_at)
SELECT identity_id, product_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM reviewed
WHERE EXISTS (SELECT 1 FROM oauth_attempts a WHERE a.issuer IS NULL AND a.client_id = reviewed.client_id)
  AND NOT EXISTS (SELECT 1 FROM data_migrations WHERE id = '0006_legacy_client_associations');

INSERT OR IGNORE INTO data_migrations (id, applied_at) VALUES ('0006_legacy_client_associations', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
