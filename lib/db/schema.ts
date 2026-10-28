import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mcpClients = sqliteTable("mcp_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  vendor: text("vendor"),
  supportStatus: text("support_status").notNull(),
  metadataUrl: text("metadata_url"),
  sourceUrl: text("source_url"),
  notes: text("notes"),
  isHidden: integer("is_hidden").notNull().default(0),
  hiddenReason: text("hidden_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const mcpProtocolObservations = sqliteTable("mcp_protocol_observations", {
  id: text("id").primaryKey(),
  clientName: text("client_name"),
  clientVersion: text("client_version"),
  identitySource: text("identity_source").notNull(),
  oauthIdentityId: text("oauth_identity_id"),
  phase: text("phase").notNull(),
  requestedVersion: text("requested_version"),
  headerVersion: text("header_version"),
  paramsVersion: text("params_version"),
  metaVersion: text("meta_version"),
  selectedVersion: text("selected_version"),
  outcome: text("outcome").notNull(),
  errorCode: integer("error_code"),
  errorMessage: text("error_message"),
  serverVersionsJson: text("server_versions_json").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  observationCount: integer("observation_count").notNull().default(1)
});

export type McpProtocolObservation = typeof mcpProtocolObservations.$inferSelect;

export const validationSessions = sqliteTable("validation_sessions", {
  id: text("id").primaryKey(),
  label: text("label"),
  createdAt: text("created_at").notNull()
});

export const oauthAttempts = sqliteTable("oauth_attempts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id"),
  issuer: text("issuer"),
  createdAt: text("created_at").notNull(),
  path: text("path").notNull(),
  method: text("method").notNull(),
  clientId: text("client_id"),
  redirectUri: text("redirect_uri"),
  responseType: text("response_type"),
  scope: text("scope"),
  state: text("state"),
  resource: text("resource"),
  codeChallenge: text("code_challenge"),
  codeChallengeMethod: text("code_challenge_method"),
  userAgent: text("user_agent"),
  clientName: text("client_name"),
  clientVersion: text("client_version"),
  classification: text("classification"),
  rawQueryJson: text("raw_query_json"),
  rawBodyJson: text("raw_body_json")
});

export const oauthClientRegistrations = sqliteTable("oauth_client_registrations", {
  clientId: text("client_id").primaryKey(),
  issuer: text("issuer"),
  clientName: text("client_name"),
  redirectUrisJson: text("redirect_uris_json").notNull(),
  rawBodyJson: text("raw_body_json").notNull(),
  lastSessionId: text("last_session_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const clientIdentityMappings = sqliteTable("client_identity_mappings", {
  identityId: text("identity_id").primaryKey(),
  productId: text("product_id").notNull().references(() => mcpClients.id),
  createdAt: text("created_at").notNull()
});

export const diagnosticConnections = sqliteTable("diagnostic_connections", {
  tokenHash: text("token_hash").primaryKey(),
  identityId: text("identity_id"),
  sessionId: text("session_id").notNull(),
  expiresAt: text("expires_at").notNull()
});

export const diagnosticAuthorizationCodes = sqliteTable("diagnostic_authorization_codes", {
  codeHash: text("code_hash").primaryKey(),
  issuer: text("issuer").notNull(),
  clientId: text("client_id"),
  redirectUri: text("redirect_uri"),
  sessionId: text("session_id").notNull(),
  createdAt: text("created_at").notNull()
});

export const cimdValidationResults = sqliteTable("cimd_validation_results", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull(),
  metadataUrl: text("metadata_url").notNull(),
  metadataFetchSuccess: integer("metadata_fetch_success").notNull(),
  metadataHttpStatus: integer("metadata_http_status"),
  metadataValid: integer("metadata_valid").notNull(),
  validationErrors: text("validation_errors"),
  validationWarnings: text("validation_warnings"),
  rawMetadataJson: text("raw_metadata_json"),
  createdAt: text("created_at").notNull()
});

export type McpClient = typeof mcpClients.$inferSelect;
export type OAuthAttempt = typeof oauthAttempts.$inferSelect;
export type OAuthClientRegistration = typeof oauthClientRegistrations.$inferSelect;
export type CimdValidationResult = typeof cimdValidationResults.$inferSelect;
export type ValidationSession = typeof validationSessions.$inferSelect;
