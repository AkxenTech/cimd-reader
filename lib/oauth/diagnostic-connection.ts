import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { diagnosticAuthorizationCodes, diagnosticConnections } from "@/lib/db/schema";
import { oauthIdentityId } from "@/lib/clients/identity";
import { sameDiagnosticRedirect } from "@/lib/oauth/redirect-uri";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function issueDiagnosticCode(input: { issuer: string; clientId: string | null; redirectUri: string | null; sessionId: string }) {
  const code = `diagnostic-${randomUUID()}`;
  await db.insert(diagnosticAuthorizationCodes).values({ ...input, codeHash: hash(code), createdAt: new Date().toISOString() });
  return code;
}

export async function sessionForDiagnosticCode(code: string | null, input: { issuer: string; clientId: string | null; redirectUri: string | null }) {
  if (!code?.startsWith("diagnostic-")) return null;
  const [row] = await db.select().from(diagnosticAuthorizationCodes).where(and(
    eq(diagnosticAuthorizationCodes.codeHash, hash(code)),
    gt(diagnosticAuthorizationCodes.createdAt, new Date(Date.now() - 10 * 60 * 1000).toISOString())
  )).limit(1);
  if (!row || row.issuer !== input.issuer || row.clientId !== input.clientId
    || !(row.redirectUri === input.redirectUri || sameDiagnosticRedirect(row.redirectUri, input.redirectUri))) return null;
  return row.sessionId;
}

export async function issueDiagnosticToken(input: { issuer: string; clientId: string | null; sessionId: string }) {
  const token = `diagnostic-${randomUUID()}`;
  await db.insert(diagnosticConnections).values({
    tokenHash: hash(token), identityId: input.clientId ? oauthIdentityId(input.issuer, input.clientId) : null,
    sessionId: input.sessionId, expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
  });
  return token;
}

export async function diagnosticConnection(request: Request) {
  const [scheme, token] = (request.headers.get("authorization") ?? "").split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  const [connection] = await db.select().from(diagnosticConnections).where(and(
    eq(diagnosticConnections.tokenHash, hash(token)), gt(diagnosticConnections.expiresAt, new Date().toISOString())
  )).limit(1);
  return connection ?? null;
}
