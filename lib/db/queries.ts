import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  cimdValidationResults,
  mcpClients,
  oauthClientRegistrations,
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
  return directIds.includes(attempt.clientId)
    || attempt.clientId === `dcr-${client.id}`
    || cimdAttemptMatchesClient(attempt, client, results);
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

function observedEvidence(attempt: OAuthAttempt | null, fallbackClientName?: string | null) {
  if (!attempt) return "No OAuth traffic observed yet.";
  const version = attempt.clientVersion ? ` (${attempt.clientVersion})` : "";
  const clientName = attempt.clientName ?? fallbackClientName;
  const client = clientName ? `${clientName}${version}` : null;
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
  const observedClients = syntheticClientsFromAttempts(promotableClientAttempts(attempts), results, clients);

  return [...clients, ...observedClients].map((client) => ({
    ...client,
    ...observedSignalsForClient(client, attempts, results)
  }));
}

export async function getClientDetail(id: string) {
  const [client] = await db.select().from(mcpClients).where(eq(mcpClients.id, id)).limit(1);

  const attempts = await db.select().from(oauthAttempts).orderBy(desc(oauthAttempts.createdAt));
  const results = await db.select().from(cimdValidationResults).orderBy(desc(cimdValidationResults.createdAt));
  const resolvedClient = client ?? syntheticClientsFromAttempts(promotableClientAttempts(attempts), results, []).find((item) => item.id === id);
  if (!resolvedClient) return null;
  const signals = observedSignalsForClient(resolvedClient, attempts, results);

  return {
    client: resolvedClient,
    ...signals
  };
}

function syntheticClientsFromAttempts(
  attempts: OAuthAttempt[],
  results: (typeof cimdValidationResults.$inferSelect)[],
  existingClients: McpClient[]
) {
  const existingKeys = new Set(existingClients.flatMap((client) => [
    client.id,
    canonicalClientKey(client.id),
    canonicalClientKey(client.name),
    canonicalClientKey(client.vendor)
  ].filter((value): value is string => Boolean(value))));
  const clients = new Map<string, McpClient>();

  for (const attempt of attempts) {
    const candidate = clientTypeCandidate(attempt, results);
    const dcrKey = attempt.clientId?.startsWith("dcr-") ? canonicalClientKey(attempt.clientId.slice(4)) : null;
    const key = dcrKey ?? canonicalClientKey(candidate);
    if (!key || key === "unknown-client" || existingKeys.has(key) || clients.has(key)) continue;

    const name = registeredClientName(attempt) ?? attempt.clientName ?? (dcrKey ? titleFromClientKey(key) : displayClientType(candidate));
    if (name === "Unknown client") continue;

    clients.set(key, {
      id: key,
      name,
      category: normalize(name).includes("cli") ? "CLI" : "Tool",
      vendor: null,
      supportStatus: "unknown",
      metadataUrl: null,
      sourceUrl: null,
      notes: "Observed from OAuth traffic.",
      createdAt: attempt.createdAt,
      updatedAt: attempt.createdAt
    });
  }

  return [...clients.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function promotableClientAttempts(attempts: OAuthAttempt[]) {
  const bySession = new Map<string, OAuthAttempt[]>();
  for (const attempt of attempts) {
    if (!attempt.sessionId) continue;
    const sessionAttempts = bySession.get(attempt.sessionId) ?? [];
    sessionAttempts.push(attempt);
    bySession.set(attempt.sessionId, sessionAttempts);
  }

  const promotable = new Set<OAuthAttempt>();
  for (const sessionAttempts of bySession.values()) {
    const behavior = sessionBehavior(sessionAttempts);
    const hasSuccessfulTokenExchange = sessionAttempts.some((attempt) => attempt.path === "/token");
    if (!hasSuccessfulTokenExchange || (behavior !== "dcr" && behavior !== "cimd")) continue;

    for (const attempt of sessionAttempts) {
      if (observedBehavior(attempt) === behavior) promotable.add(attempt);
    }
  }

  return attempts.filter((attempt) => promotable.has(attempt));
}

function titleFromClientKey(key: string) {
  return key
    .split("-")
    .filter(Boolean)
    .map((part) => part.toLowerCase() === "cli" ? "CLI" : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function observedSignalsForClient(client: McpClient, attempts: OAuthAttempt[], results: (typeof cimdValidationResults.$inferSelect)[]) {
  const directlyMatchingAttempts = attempts.filter((attempt) => directAttemptMatchesClient(attempt, client, results) || dcrAttemptMatchesClient(attempt, client));
  const matchingSessionIds = new Set(directlyMatchingAttempts.map((attempt) => attempt.sessionId).filter(Boolean));
  const matchingAttempts = attempts.filter((attempt) => directlyMatchingAttempts.includes(attempt) || (attempt.sessionId && matchingSessionIds.has(attempt.sessionId)));
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
    observedEvidence: observedEvidence(statusAttempt, client.name),
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
    sessionBehavior: sessionBehavior(attempts),
    behaviorCounts
  };
}

function sessionBehavior(attempts: OAuthAttempt[]) {
  const behaviors = attempts.map(observedBehavior);
  if (behaviors.includes("cimd")) return "cimd";
  if (behaviors.includes("dcr")) return "dcr";
  if (behaviors.includes("static")) return "static";
  if (behaviors.includes("mcp")) return "mcp";
  return behaviors.find((behavior) => behavior !== "unknown") ?? "unknown";
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

export async function upsertDcrRegistration(input: {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  rawBody: Record<string, unknown>;
  sessionId: string | null;
}) {
  const now = new Date().toISOString();
  await db
    .insert(oauthClientRegistrations)
    .values({
      clientId: input.clientId,
      clientName: input.clientName,
      redirectUrisJson: JSON.stringify(input.redirectUris),
      rawBodyJson: JSON.stringify(input.rawBody),
      lastSessionId: input.sessionId,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: oauthClientRegistrations.clientId,
      set: {
        clientName: input.clientName,
        redirectUrisJson: JSON.stringify(input.redirectUris),
        rawBodyJson: JSON.stringify(input.rawBody),
        lastSessionId: input.sessionId,
        updatedAt: now
      }
    });
}

export async function getDcrRegistration(clientId: string | null) {
  if (!clientId) return null;
  const [registration] = await db
    .select()
    .from(oauthClientRegistrations)
    .where(eq(oauthClientRegistrations.clientId, clientId))
    .limit(1);

  return registration ?? null;
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

export async function hasDcrRegistration(clientId: string | null) {
  return Boolean(await getDcrRegistration(clientId));
}

function tokenMatchesAuthorizeAttempt(token: { clientId: string | null; redirectUri: string | null }, attempt: OAuthAttempt) {
  const clientMatches = Boolean(token.clientId && attempt.clientId === token.clientId);
  const redirectMatches = Boolean(token.redirectUri && redirectUrisMatch(token.redirectUri, attempt.redirectUri));

  if (token.clientId && token.redirectUri) return clientMatches && redirectMatches;
  if (token.clientId) return clientMatches;
  if (token.redirectUri) return redirectMatches;
  return false;
}

function redirectUrisMatch(left: string | null, right: string | null) {
  if (!left || !right) return false;
  if (left === right) return true;

  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    const leftLoopback = leftUrl.hostname === "localhost" || leftUrl.hostname === "127.0.0.1";
    const rightLoopback = rightUrl.hostname === "localhost" || rightUrl.hostname === "127.0.0.1";

    if (!leftLoopback || !rightLoopback) return false;

    return leftUrl.protocol === rightUrl.protocol
      && leftUrl.port === rightUrl.port
      && leftUrl.pathname === rightUrl.pathname
      && leftUrl.search === rightUrl.search;
  } catch {
    return false;
  }
}

export async function findRecentAuthorizeSessionForToken(input: {
  clientId: string | null;
  redirectUri: string | null;
  createdAt?: string;
  maxAgeMs?: number;
}) {
  const referenceTime = input.createdAt ? Date.parse(input.createdAt) : Date.now();
  const maxAgeMs = input.maxAgeMs ?? 10 * 60 * 1000;

  if (!input.clientId && !input.redirectUri) return null;

  const candidates = await db
    .select()
    .from(oauthAttempts)
    .where(eq(oauthAttempts.path, "/authorize"))
    .orderBy(desc(oauthAttempts.createdAt))
    .limit(200);

  const match = candidates.find((attempt) => {
    if (!attempt.sessionId) return false;
    const attemptTime = Date.parse(attempt.createdAt);
    if (!Number.isFinite(attemptTime)) return false;
    if (attemptTime > referenceTime) return false;
    if (referenceTime - attemptTime > maxAgeMs) return false;
    return tokenMatchesAuthorizeAttempt(input, attempt);
  });

  return match?.sessionId ?? null;
}
