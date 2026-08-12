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
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const validationSessions = sqliteTable("validation_sessions", {
  id: text("id").primaryKey(),
  label: text("label"),
  createdAt: text("created_at").notNull()
});

export const oauthAttempts = sqliteTable("oauth_attempts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id"),
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
export type CimdValidationResult = typeof cimdValidationResults.$inferSelect;
export type ValidationSession = typeof validationSessions.$inferSelect;
