import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  cimdValidationResults,
  mcpClients,
  oauthAttempts,
  validationSessions
} from "@/lib/db/schema";
import type { McpClient, OAuthAttempt } from "@/lib/db/schema";

function parseBodyJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clientAliases(client: McpClient) {
  const aliases = new Set([client.id, client.name, client.vendor ?? ""]);

  if (client.id === "codex-cli") {
    aliases.add("codex");
    aliases.add("codex cli");
    aliases.add("openai codex");
  }

  if (client.id === "claude-code") {
    aliases.add("claude");
    aliases.add("claude code");
  }

  return [...aliases].map(normalize).filter(Boolean);
}

function canonicalClientKey(value: string | null | undefined) {
  const normalized = normalize(value);
  if (!normalized) return null;

  if (normalized.includes("claude")) return "claude-code";
  if (normalized.includes("codex") || normalized.includes("openai codex")) return "codex-cli";
  if (normalized.includes("mcpjam") || normalized.includes("mcp jam")) return "mcpjam-inspector";
  if (normalized.includes("visual studio code") || normalized.includes("vs code") || normalized === "vscode" || normalized.includes("vscode dev")) return "vscode";
  if (normalized.includes("github copilot") || normalized === "copilot") return "github-copilot";

  return normalized.replace(/\s+/g, "-");
}

function displayClientType(value: string | null | undefined) {
  const normalized = normalize(value);
  if (!normalized) return "Unknown client";
  if (canonicalClientKey(value) === "mcpjam-inspector") return "MCPJam Inspector";
  if (canonicalClientKey(value) === "codex-cli") return "Codex CLI";
  if (canonicalClientKey(value) === "claude-code") return "Claude Code";
  if (canonicalClientKey(value) === "vscode") return "VS Code";
  if (canonicalClientKey(value) === "github-copilot") return "GitHub Copilot";

  return value?.trim() || "Unknown client";
}

function registeredClientName(attempt: OAuthAttempt) {
  const body = parseBodyJson(attempt.rawBodyJson);
  return typeof body?.client_name === "string" ? body.client_name : null;
}

function validationMetadataName(attempt: OAuthAttempt, results: (typeof cimdValidationResults.$inferSelect)[]) {
  const result = results.find((item) => item.attemptId === attempt.id);
  if (!result?.rawMetadataJson) return null;

  try {
    const metadata = JSON.parse(result.rawMetadataJson) as Record<string, unknown>;
    return typeof metadata.client_name === "string" ? metadata.client_name : null;
  } catch {
    return null;
  }
}

function dcrAttemptMatchesClient(attempt: OAuthAttempt, client: McpClient) {
  if (attempt.path !== "/register") return false;
  const name = normalize(registeredClientName(attempt));
  if (!name) return false;

  return clientAliases(client).some((alias) => name === alias || name.includes(alias) || alias.includes(name));
}

function cimdAttemptMatchesClient(attempt: OAuthAttempt, client: McpClient, results: (typeof cimdValidationResults.$inferSelect)[]) {
  if (attempt.classification !== "cimd") return false;
  const normalizedClientId = normalize(attempt.clientId);
  const metadataName = normalize(validationMetadataName(attempt, results));

  return clientAliases(client).some((alias) => normalizedClientId.includes(alias) || metadataName === alias || metadataName.includes(alias));
}

function directAttemptMatchesClient(attempt: OAuthAttempt, client: McpClient, results: (typeof cimdValidationResults.$inferSelect)[]) {
  const directIds = [client.id, client.metadataUrl].filter(Boolean);
  return directIds.includes(attempt.clientId) || cimdAttemptMatchesClient(attempt, client, results);
}

function resultForAttempt(attempt: OAuthAttempt | null, results: (typeof cimdValidationResults.$inferSelect)[]) {
  if (!attempt) return null;
  return results.find((result) => result.attemptId === attempt.id) ?? null;
}

function observedBehavior(attempt: OAuthAttempt | null) {
  if (!attempt) return "unknown";
  if (attempt.path === "/register") return "dcr";
  if (attempt.classification === "dcr" || attempt.clientId?.startsWith("dcr-") || attempt.clientId === "dcr-test-client-id") return "dcr";
  return attempt.classification ?? "unknown";
}

function observedEvidence(attempt: OAuthAttempt | null) {
  if (!attempt) return "No OAuth traffic observed yet.";
  const version = attempt.clientVersion ? ` (${attempt.clientVersion})` : "";
  const client = attempt.clientName ? `${attempt.clientName}${version}` : null;
  if (attempt.path === "/register") {
    const name = registeredClientName(attempt);
    return `${name ?? client ?? "Client"} dynamically registered and received client_id ${attempt.clientId ?? "unknown"}.`;
  }
  if (attempt.classification === "cimd") return `${client ? `${client} authorization used` : "Authorization used"} client_id metadata URL ${attempt.clientId}.`;
  if (attempt.classification === "static") return `${client ? `${client} authorization used` : "Authorization used"} static client_id ${attempt.clientId ?? "unknown"}.`;
  if (observedBehavior(attempt) === "dcr") return `${client ? `${client} authorization used` : "Authorization used"} dynamically registered client_id ${attempt.clientId ?? "unknown"}.`;
  if (attempt.classification === "mcp") return `${client ?? "MCP client"} initialized the authenticated MCP session.`;
  return `Latest OAuth event was ${attempt.method} ${attempt.path}.`;
}

export async function getClientsWithLatestSignals() {
  const clients = await db.select().from(mcpClients).orderBy(mcpClients.name);
  const attempts = await db.select().from(oauthAttempts).orderBy(desc(oauthAttempts.createdAt));
  const results = await db.select().from(cimdValidationResults).orderBy(desc(cimdValidationResults.createdAt));

  return clients.map((client) => ({
    ...client,
    ...observedSignalsForClient(client, attempts, results)
  }));
}

export async function getClientDetail(id: string) {
  const [client] = await db.select().from(mcpClients).where(eq(mcpClients.id, id)).limit(1);
  if (!client) return null;

  const attempts = await db.select().from(oauthAttempts).orderBy(desc(oauthAttempts.createdAt));
  const results = await db.select().from(cimdValidationResults).orderBy(desc(cimdValidationResults.createdAt));
  const signals = observedSignalsForClient(client, attempts, results);

  return {
    client,
    ...signals
  };
}

function observedSignalsForClient(client: McpClient, attempts: OAuthAttempt[], results: (typeof cimdValidationResults.$inferSelect)[]) {
  const matchingAttempts = attempts.filter((attempt) => directAttemptMatchesClient(attempt, client, results) || dcrAttemptMatchesClient(attempt, client));
  const behaviorAttempts = matchingAttempts.filter((attempt) => attempt.path === "/register" || attempt.classification);
  const latestAttempt = matchingAttempts[0] ?? null;
  const latestCimdAttempt = matchingAttempts.find((attempt) => attempt.classification === "cimd") ?? null;
  const statusAttempt = latestCimdAttempt ?? behaviorAttempts[0] ?? latestAttempt;
  const latestCimdValidation = resultForAttempt(latestCimdAttempt, results);
  const latestValidation = latestCimdValidation ?? (
    matchingAttempts.length
      ? results.find((result) => matchingAttempts.some((attempt) => attempt.id === result.attemptId)) ?? null
      : null
  );
  const behavior = latestCimdAttempt ? "cimd" : observedBehavior(statusAttempt);

  return {
    latestAttempt,
    statusAttempt,
    latestCimdAttempt,
    latestValidation,
    latestCimdValidation,
    observedBehavior: behavior,
    observedEvidence: observedEvidence(statusAttempt),
    observedAt: latestAttempt?.createdAt ?? latestValidation?.createdAt ?? null
  };
}

export async function getSessions() {
  const sessions = await db.select().from(validationSessions).orderBy(desc(validationSessions.createdAt));
  const attempts = await db
    .select()
    .from(oauthAttempts)
    .orderBy(desc(oauthAttempts.createdAt));
  const counts = await db
    .select({ sessionId: oauthAttempts.sessionId, count: sql<number>`count(*)` })
    .from(oauthAttempts)
    .groupBy(oauthAttempts.sessionId);
  const attemptIds = attempts.map((attempt) => attempt.id);
  const results = attemptIds.length
    ? await db.select().from(cimdValidationResults).where(inArray(cimdValidationResults.attemptId, attemptIds))
    : [];

  return sessions.map((session) => ({
    ...session,
    attemptCount: Number(counts.find((count) => count.sessionId === session.id)?.count ?? 0),
    attempts: attempts.filter((attempt) => attempt.sessionId === session.id),
    latestAttempt: attempts.find((attempt) => attempt.sessionId === session.id) ?? null,
    ...sessionClientSummary(attempts.filter((attempt) => attempt.sessionId === session.id), results)
  }));
}

export function displayClassification(attempt: OAuthAttempt | null) {
  return observedBehavior(attempt);
}

export function clientTypeForAttempt(attempt: OAuthAttempt | null) {
  if (!attempt) return "Unknown client";

  const registeredName = registeredClientName(attempt);
  if (attempt.clientName) return attempt.clientName;
  if (registeredName) return registeredName;

  if (attempt.clientId && attempt.clientId.startsWith("https://")) {
    try {
      return new URL(attempt.clientId).hostname.replace(/^www\./, "");
    } catch {
      return attempt.clientId;
    }
  }

  if (attempt.userAgent) {
    const product = attempt.userAgent.match(/([A-Za-z][A-Za-z0-9._-]*)\/[^\s()]+/);
    if (product?.[1]) return product[1];
  }

  if (attempt.path === "/register" || observedBehavior(attempt) === "dcr") return "DCR client";
  if (attempt.classification === "static") return "Static client";
  if (attempt.classification === "cimd") return "CIMD client";
  if (attempt.classification === "mcp") return "MCP client";
  return "Unknown client";
}

export function clientVersionForAttempt(attempt: OAuthAttempt | null) {
  return attempt?.clientVersion ?? null;
}

function metadataNameForAttemptId(attemptId: string, results: (typeof cimdValidationResults.$inferSelect)[]) {
  const result = results.find((item) => item.attemptId === attemptId);
  if (!result?.rawMetadataJson) return null;

  try {
    const metadata = JSON.parse(result.rawMetadataJson) as Record<string, unknown>;
    return typeof metadata.client_name === "string" ? metadata.client_name : null;
  } catch {
    return null;
  }
}

function clientTypeCandidate(attempt: OAuthAttempt, results: (typeof cimdValidationResults.$inferSelect)[]) {
  const registeredName = registeredClientName(attempt);
  const metadataName = metadataNameForAttemptId(attempt.id, results);

  if (attempt.classification === "cimd") {
    return metadataName ?? attempt.clientName ?? clientTypeForAttempt(attempt);
  }

  if (attempt.path === "/register") {
    return registeredName ?? attempt.clientName ?? clientTypeForAttempt(attempt);
  }

  return attempt.clientName ?? registeredName ?? metadataName ?? clientTypeForAttempt(attempt);
}

function sessionClientSummary(attempts: OAuthAttempt[], results: (typeof cimdValidationResults.$inferSelect)[]) {
  const prioritized = [
    attempts.find((attempt) => attempt.classification === "cimd"),
    attempts.find((attempt) => attempt.path === "/register"),
    attempts.find((attempt) => attempt.classification === "mcp"),
    attempts[0]
  ].filter((attempt): attempt is OAuthAttempt => Boolean(attempt));
  const candidate = prioritized.map((attempt) => clientTypeCandidate(attempt, results)).find((value) => normalize(value));
  const behaviorCounts = attempts.reduce<Record<string, number>>((counts, attempt) => {
    const behavior = observedBehavior(attempt);
    counts[behavior] = (counts[behavior] ?? 0) + 1;
    return counts;
  }, {});
  const versions = [...new Set(attempts.map((attempt) => attempt.clientVersion).filter((version): version is string => Boolean(version)))].sort();

  return {
    clientKey: canonicalClientKey(candidate) ?? "unknown-client",
    clientType: displayClientType(candidate),
    clientVersions: versions,
    behaviorCounts
  };
}

export async function getSessionTimeline(id: string) {
  const [session] = await db.select().from(validationSessions).where(eq(validationSessions.id, id)).limit(1);
  if (!session) return null;

  const attempts = await db
    .select()
    .from(oauthAttempts)
    .where(eq(oauthAttempts.sessionId, id))
    .orderBy(oauthAttempts.createdAt);

  const attemptIds = attempts.map((attempt) => attempt.id);
  const results = attemptIds.length
    ? await db.select().from(cimdValidationResults).where(inArray(cimdValidationResults.attemptId, attemptIds))
    : [];

  return { session, attempts, results };
}

export async function ensureSession(id: string, label?: string | null) {
  await db
    .insert(validationSessions)
    .values({ id, label: label ?? null, createdAt: new Date().toISOString() })
    .onConflictDoNothing();
}

export async function hasDcrAttemptForSession(sessionId: string | null) {
  if (!sessionId) return false;
  const rows = await db
    .select({ id: oauthAttempts.id })
    .from(oauthAttempts)
    .where(and(eq(oauthAttempts.sessionId, sessionId), eq(oauthAttempts.path, "/register")))
    .limit(1);

  return rows.length > 0;
}
