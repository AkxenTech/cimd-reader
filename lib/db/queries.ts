import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  cimdValidationResults,
  mcpClients,
  oauthAttempts,
  validationSessions
} from "@/lib/db/schema";

export async function getClientsWithLatestSignals() {
  const clients = await db.select().from(mcpClients).orderBy(mcpClients.name);
  const latestAttempts = await Promise.all(
    clients.map(async (client) => {
      const matchClauses = [eq(oauthAttempts.clientId, client.metadataUrl ?? client.id)];
      if (client.metadataUrl) {
        matchClauses.push(eq(oauthAttempts.clientId, client.metadataUrl));
      }

      const attempt = await db
        .select()
        .from(oauthAttempts)
        .where(client.metadataUrl ? inArray(oauthAttempts.clientId, [client.metadataUrl, client.id]) : eq(oauthAttempts.clientId, client.id))
        .orderBy(desc(oauthAttempts.createdAt))
        .limit(1);

      const result = attempt[0]
        ? await db
            .select()
            .from(cimdValidationResults)
            .where(eq(cimdValidationResults.attemptId, attempt[0].id))
            .orderBy(desc(cimdValidationResults.createdAt))
            .limit(1)
        : [];

      return { clientId: client.id, attempt: attempt[0] ?? null, result: result[0] ?? null };
    })
  );

  return clients.map((client) => ({
    ...client,
    latestAttempt: latestAttempts.find((item) => item.clientId === client.id)?.attempt ?? null,
    latestValidation: latestAttempts.find((item) => item.clientId === client.id)?.result ?? null
  }));
}

export async function getClientDetail(id: string) {
  const [client] = await db.select().from(mcpClients).where(eq(mcpClients.id, id)).limit(1);
  if (!client) return null;

  const latestAttempt = await db
    .select()
    .from(oauthAttempts)
    .where(client.metadataUrl ? inArray(oauthAttempts.clientId, [client.metadataUrl, client.id]) : eq(oauthAttempts.clientId, client.id))
    .orderBy(desc(oauthAttempts.createdAt))
    .limit(1);

  const latestValidation = latestAttempt[0]
    ? await db
        .select()
        .from(cimdValidationResults)
        .where(eq(cimdValidationResults.attemptId, latestAttempt[0].id))
        .orderBy(desc(cimdValidationResults.createdAt))
        .limit(1)
    : [];

  return {
    client,
    latestAttempt: latestAttempt[0] ?? null,
    latestValidation: latestValidation[0] ?? null
  };
}

export async function getSessions() {
  const sessions = await db.select().from(validationSessions).orderBy(desc(validationSessions.createdAt));
  const counts = await db
    .select({ sessionId: oauthAttempts.sessionId, count: sql<number>`count(*)` })
    .from(oauthAttempts)
    .groupBy(oauthAttempts.sessionId);

  return sessions.map((session) => ({
    ...session,
    attemptCount: Number(counts.find((count) => count.sessionId === session.id)?.count ?? 0)
  }));
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
