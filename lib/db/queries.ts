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

function registeredClientName(attempt: OAuthAttempt) {
  const body = parseBodyJson(attempt.rawBodyJson);
  return typeof body?.client_name === "string" ? body.client_name : null;
}

function dcrAttemptMatchesClient(attempt: OAuthAttempt, client: McpClient) {
  if (attempt.path !== "/register") return false;
  const name = normalize(registeredClientName(attempt));
  if (!name) return false;

  return clientAliases(client).some((alias) => name === alias || name.includes(alias) || alias.includes(name));
}

function directAttemptMatchesClient(attempt: OAuthAttempt, client: McpClient) {
  const directIds = [client.id, client.metadataUrl].filter(Boolean);
  return directIds.includes(attempt.clientId);
}

function observedBehavior(attempt: OAuthAttempt | null) {
  if (!attempt) return "unknown";
  if (attempt.path === "/register") return "dcr";
  if (attempt.classification === "dcr" || attempt.clientId?.startsWith("dcr-") || attempt.clientId === "dcr-test-client-id") return "dcr";
  return attempt.classification ?? "unknown";
}

function observedEvidence(attempt: OAuthAttempt | null) {
  if (!attempt) return "No OAuth traffic observed yet.";
  if (attempt.path === "/register") {
    const name = registeredClientName(attempt);
    return `${name ?? "Client"} dynamically registered and received client_id ${attempt.clientId ?? "unknown"}.`;
  }
  if (attempt.classification === "cimd") return `Authorization used client_id metadata URL ${attempt.clientId}.`;
  if (attempt.classification === "static") return `Authorization used static client_id ${attempt.clientId ?? "unknown"}.`;
  if (observedBehavior(attempt) === "dcr") return `Authorization used dynamically registered client_id ${attempt.clientId ?? "unknown"}.`;
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
  const matchingAttempts = attempts.filter((attempt) => directAttemptMatchesClient(attempt, client) || dcrAttemptMatchesClient(attempt, client));
  const latestAttempt = matchingAttempts[0] ?? null;
  const latestValidation = matchingAttempts.length
    ? results.find((result) => matchingAttempts.some((attempt) => attempt.id === result.attemptId)) ?? null
    : null;
  const behavior = observedBehavior(latestAttempt);

  return {
    latestAttempt,
    latestValidation,
    observedBehavior: behavior,
    observedEvidence: observedEvidence(latestAttempt),
    observedAt: latestAttempt?.createdAt ?? latestValidation?.createdAt ?? null
  };
}

export async function getSessions() {
  const sessions = await db.select().from(validationSessions).orderBy(desc(validationSessions.createdAt));
  const latestAttempts = await db
    .select()
    .from(oauthAttempts)
    .orderBy(desc(oauthAttempts.createdAt));
  const counts = await db
    .select({ sessionId: oauthAttempts.sessionId, count: sql<number>`count(*)` })
    .from(oauthAttempts)
    .groupBy(oauthAttempts.sessionId);

  return sessions.map((session) => ({
    ...session,
    attemptCount: Number(counts.find((count) => count.sessionId === session.id)?.count ?? 0),
    latestAttempt: latestAttempts.find((attempt) => attempt.sessionId === session.id) ?? null
  }));
}

export function displayClassification(attempt: OAuthAttempt | null) {
  return observedBehavior(attempt);
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
