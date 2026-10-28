import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  cimdValidationResults,
  mcpClients,
  oauthClientRegistrations,
  oauthAttempts,
  validationSessions,
  clientIdentityMappings
} from "@/lib/db/schema";
import type { OAuthAttempt } from "@/lib/db/schema";
import { hostedClientPlatformFromSignal } from "@/lib/oauth/client-platform";
import { getProtocolObservations } from "@/lib/mcp/observations";
import { resolveClientCatalog, type ResolvedClient } from "@/lib/clients/resolver";
import { sameDiagnosticRedirect } from "@/lib/oauth/redirect-uri";
import { oauthIdentityId } from "@/lib/clients/identity";

function parseBodyJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function registeredClientName(attempt: OAuthAttempt) {
  const body = parseBodyJson(attempt.rawBodyJson);
  return typeof body?.client_name === "string" ? body.client_name : null;
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

function parseValidationErrors(result: (typeof cimdValidationResults.$inferSelect) | null) {
  if (!result?.validationErrors) return [];

  try {
    const parsed = JSON.parse(result.validationErrors);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function observedEvidence(
  attempt: OAuthAttempt | null,
  fallbackClientName?: string | null,
  validation?: (typeof cimdValidationResults.$inferSelect) | null
) {
  if (!attempt) return "No OAuth traffic observed yet.";
  const version = attempt.clientVersion ? ` (${attempt.clientVersion})` : "";
  const clientName = attempt.clientName ?? fallbackClientName;
  const client = clientName ? `${clientName}${version}` : null;
  const platform = hostedClientPlatformFromSignal({
    metadataUrl: attempt.classification === "cimd" ? attempt.clientId : null,
    userAgent: attempt.userAgent
  });
  if (attempt.path === "/register") {
    const name = registeredClientName(attempt);
    return `${name ?? client ?? "Client"} dynamically registered and received client_id ${attempt.clientId ?? "unknown"}.`;
  }
  if (attempt.classification === "cimd") {
    if (validation && !validation.metadataValid) {
      const errors = parseValidationErrors(validation);
      const reason = errors.length ? ` ${errors.join("; ")}.` : "";
      return `${client ?? "Client"} used client_id metadata URL ${attempt.clientId}, but metadata validation failed.${reason}`;
    }

    if (platform) {
      return `${client ?? "Client"} is a ${platform.label}; authorization used per-connector client_id metadata URL ${attempt.clientId}.`;
    }

    return `${client ? `${client} authorization used` : "Authorization used"} client_id metadata URL ${attempt.clientId}.`;
  }
  if (attempt.classification === "static") return `${client ? `${client} authorization used` : "Authorization used"} static client_id ${attempt.clientId ?? "unknown"}.`;
  if (observedBehavior(attempt) === "dcr") return `${client ? `${client} authorization used` : "Authorization used"} dynamically registered client_id ${attempt.clientId ?? "unknown"}.`;
  if (attempt.classification === "mcp") return `${client ?? "MCP client"} initialized the authenticated MCP session.`;
  return `Latest OAuth event was ${attempt.method} ${attempt.path}.`;
}

async function clientCatalog() {
  const [clients, attempts, results, mappings, observations] = await Promise.all([
    db.select().from(mcpClients).orderBy(mcpClients.name),
    db.select().from(oauthAttempts).orderBy(desc(oauthAttempts.createdAt)),
    db.select().from(cimdValidationResults).orderBy(desc(cimdValidationResults.createdAt)),
    db.select().from(clientIdentityMappings),
    getProtocolObservations()
  ]);
  return { catalog: resolveClientCatalog(clients, attempts, results, mappings), results, observations };
}

export async function getClientsWithLatestSignals() {
  const { catalog, results, observations } = await clientCatalog();
  return catalog.entries.filter(entry => !entry.client.isHidden).map(entry => ({
    ...entry.client, ...observedSignalsForClient(entry, results, observations)
  }));
}

export async function getClientDetail(id: string) {
  const { catalog, results, observations } = await clientCatalog();
  const entry = catalog.find(id);
  if (!entry || entry.client.isHidden) return null;
  return { client: entry.client, ...observedSignalsForClient(entry, results, observations) };
}

function observedSignalsForClient(
  entry: ResolvedClient,
  results: (typeof cimdValidationResults.$inferSelect)[],
  observations: Awaited<ReturnType<typeof getProtocolObservations>>
) {
  const matchingAttempts = entry.attempts;
  const latestAttempt = matchingAttempts[0] ?? null;
  const statusAttempt = matchingAttempts.find(row => row.path === "/authorize")
    ?? matchingAttempts.find(row => row.path === "/register") ?? latestAttempt;
  const latestCimdAttempt = matchingAttempts.find(row => row.classification === "cimd") ?? null;
  const validationIds = new Set(matchingAttempts.map(row => row.id));
  const validations = results.filter(row => validationIds.has(row.attemptId));
  const latestValidation = validations[0] ?? null;
  const latestCimdValidation = resultForAttempt(latestCimdAttempt, results);
  const latestSuccessfulCimdValidation = validations.find(row => Boolean(row.metadataValid)) ?? null;
  const statusValidation = resultForAttempt(statusAttempt, results);
  const behavior = statusAttempt?.classification === "cimd" && statusValidation && !statusValidation.metadataValid
    ? "failed" : observedBehavior(statusAttempt);
  const identityIds = new Set(entry.identities.map(row => row.id));
  const protocolHistory = observations.filter(row => row.oauthIdentityId && identityIds.has(row.oauthIdentityId));
  return {
    latestAttempt, statusAttempt, latestCimdAttempt, latestValidation, latestCimdValidation,
    latestSuccessfulCimdValidation, latestSuccessfulCimdAt: latestSuccessfulCimdValidation?.createdAt ?? null,
    observedBehavior: behavior,
    observedEvidence: observedEvidence(statusAttempt, entry.client.name, statusValidation),
    observedAt: statusAttempt?.createdAt ?? latestAttempt?.createdAt ?? null,
    identities: entry.identities,
    attribution: entry.attribution,
    protocolHistory,
    highestObservedProtocol: protocolHistory.find(row => row.protocolStatus === "negotiated" || row.protocolStatus === "accepted") ?? null
  };
}

export async function getSessions() {
  const [sessions, clients, attempts, results, mappings] = await Promise.all([
    db.select().from(validationSessions).orderBy(desc(validationSessions.createdAt)),
    db.select().from(mcpClients),
    db.select().from(oauthAttempts).orderBy(desc(oauthAttempts.createdAt)),
    db.select().from(cimdValidationResults).orderBy(desc(cimdValidationResults.createdAt)),
    db.select().from(clientIdentityMappings)
  ]);
  const catalog = resolveClientCatalog(clients, attempts, results, mappings);
  return sessions.map(session => {
    const events = attempts.filter(row => row.sessionId === session.id);
    const owners = new Map(events.flatMap(row => {
      const owner = catalog.forAttempt(row);
      return owner ? [[owner.client.id, owner] as const] : [];
    }));
    const owner = owners.size === 1 ? [...owners.values()][0] : null;
    const identityIds = new Set(events.filter(row => row.clientId).map(row => oauthIdentityId(row.issuer, row.clientId!)));
    const identities = [...owners.values()].flatMap(entry => entry.identities)
      .filter(identity => identityIds.has(identity.id));
    return {
      ...session, attemptCount: events.length, attempts: events, latestAttempt: events[0] ?? null,
      ...sessionClientSummary(events, results),
      clientKey: owner?.client.id ?? `session-${session.id}`,
      clientType: owner?.client.name ?? "Unresolved client",
      identities,
      attribution: owner?.attribution ?? { status: "unresolved" as const, reason: "Session does not identify one OAuth client." }
    };
  });
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

function sessionClientSummary(attempts: OAuthAttempt[], results: (typeof cimdValidationResults.$inferSelect)[]) {
  const latestAuth = attempts.find(row => row.path === "/authorize");
  const validation = resultForAttempt(latestAuth ?? null, results);
  const behaviorCounts = attempts.reduce<Record<string, number>>((counts, row) => {
    const behavior = observedBehavior(row);
    counts[behavior] = (counts[behavior] ?? 0) + 1;
    return counts;
  }, {});
  return {
    clientVersions: [...new Set(attempts.map(row => row.clientVersion).filter((version): version is string => Boolean(version)))].sort(),
    sessionBehavior: latestAuth?.classification === "cimd" && validation && !validation.metadataValid
      ? "failed" : observedBehavior(latestAuth ?? attempts[0] ?? null),
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

export async function upsertDcrRegistration(input: {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  rawBody: Record<string, unknown>;
  sessionId: string | null;
  issuer?: string | null;
}) {
  const now = new Date().toISOString();
  await db
    .insert(oauthClientRegistrations)
    .values({
      clientId: input.clientId,
      issuer: input.issuer ?? null,
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

export async function getDcrRegistration(clientId: string | null, issuer?: string | null) {
  if (!clientId) return null;
  const registrations = await db
    .select()
    .from(oauthClientRegistrations)
    .where(eq(oauthClientRegistrations.clientId, clientId))
    .limit(1);

  return registrations.find(row => issuer === undefined || row.issuer === issuer)
    ?? registrations.find(row => row.issuer === null) ?? null;
}

export async function hasDcrAttemptForSession(input: { sessionId: string | null; clientId: string | null; issuer: string }) {
  if (!input.sessionId || !input.clientId) return false;
  const rows = await db
    .select({ id: oauthAttempts.id })
    .from(oauthAttempts)
    .where(and(
      eq(oauthAttempts.sessionId, input.sessionId), eq(oauthAttempts.path, "/register"),
      eq(oauthAttempts.clientId, input.clientId), eq(oauthAttempts.issuer, input.issuer)
    ))
    .limit(1);

  return rows.length > 0;
}

export async function hasDcrRegistration(clientId: string | null) {
  return Boolean(await getDcrRegistration(clientId));
}

function tokenMatchesAuthorizeAttempt(token: { clientId: string | null; redirectUri: string | null }, attempt: OAuthAttempt) {
  const clientMatches = Boolean(token.clientId && attempt.clientId === token.clientId);
  const redirectMatches = Boolean(token.redirectUri && sameDiagnosticRedirect(token.redirectUri, attempt.redirectUri));

  if (token.clientId && token.redirectUri) return clientMatches && redirectMatches;
  if (token.clientId) return clientMatches;
  if (token.redirectUri) return redirectMatches;
  return false;
}

export async function findRecentAuthorizeSessionForToken(input: {
  clientId: string | null;
  redirectUri: string | null;
  createdAt?: string;
  maxAgeMs?: number;
  issuer?: string | null;
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

  const matches = candidates.filter((attempt) => {
    if (input.issuer !== undefined && attempt.issuer !== input.issuer) return false;
    if (!attempt.sessionId) return false;
    const attemptTime = Date.parse(attempt.createdAt);
    if (!Number.isFinite(attemptTime)) return false;
    if (attemptTime > referenceTime) return false;
    if (referenceTime - attemptTime > maxAgeMs) return false;
    return tokenMatchesAuthorizeAttempt(input, attempt);
  });

  return matches.length === 1 ? matches[0].sessionId : null;
}
