import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { oauthAttempts } from "@/lib/db/schema";
import { ensureSession, findRecentAuthorizeSessionForToken, getDcrRegistration } from "@/lib/db/queries";
import { mcpResourceUrl } from "@/lib/mcp/protocol";
import { clientSignalFromPayload } from "@/lib/oauth/client-signal";
import { getBaseUrl } from "@/lib/oauth/base-url";
import { requestBodyToRecord } from "@/lib/oauth/parse";
import { issueDiagnosticToken, sessionForDiagnosticCode } from "@/lib/oauth/diagnostic-connection";
import { and, eq } from "drizzle-orm";
import { sameDiagnosticRedirect } from "@/lib/oauth/redirect-uri";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { raw } = await requestBodyToRecord(request);
  const rawRecord = raw as Record<string, unknown>;
  const providedSessionId = typeof rawRecord.session_id === "string" ? rawRecord.session_id : null;
  const clientId = typeof rawRecord.client_id === "string" ? rawRecord.client_id : null;
  const redirectUri = typeof rawRecord.redirect_uri === "string" ? rawRecord.redirect_uri : null;
  const resource = typeof rawRecord.resource === "string" ? rawRecord.resource : null;
  const issuer = getBaseUrl(request);
  const code = typeof rawRecord.code === "string" ? rawRecord.code : null;
  const expectedResource = mcpResourceUrl(getBaseUrl(request));
  const userAgent = request.headers.get("user-agent");
  const clientSignal = clientSignalFromPayload(rawRecord, userAgent);
  const dcrRegistration = await getDcrRegistration(clientId, issuer);

  if (resource && resource !== expectedResource) {
    return NextResponse.json({ error: "invalid_target", error_description: "resource does not match this MCP server" }, { status: 400 });
  }

  const exactCodeSession = await sessionForDiagnosticCode(code, { issuer, clientId, redirectUri });
  const suppliedAttempts = providedSessionId ? await db.select().from(oauthAttempts).where(and(
    eq(oauthAttempts.sessionId, providedSessionId), eq(oauthAttempts.path, "/authorize")
  )) : [];
  const validProvidedSession = suppliedAttempts.some(row => row.issuer === issuer && row.clientId === clientId
    && (row.redirectUri === redirectUri || sameDiagnosticRedirect(row.redirectUri, redirectUri)))
    ? providedSessionId : null;
  const legacySession = !code?.startsWith("diagnostic-")
    ? await findRecentAuthorizeSessionForToken({ clientId, redirectUri, issuer }) : null;
  const correlatedSessionId = exactCodeSession ?? validProvidedSession ?? legacySession;
  const sessionId = correlatedSessionId ?? crypto.randomUUID();

  await ensureSession(sessionId, correlatedSessionId ? null : "Token exchange");
  await db.insert(oauthAttempts).values({
    id: crypto.randomUUID(),
    sessionId,
    issuer,
    createdAt: new Date().toISOString(),
    path: "/token",
    method: request.method,
    clientId,
    redirectUri,
    responseType: null,
    scope: typeof rawRecord.scope === "string" ? rawRecord.scope : null,
    state: null,
    resource,
    codeChallenge: null,
    codeChallengeMethod: null,
    userAgent,
    clientName: dcrRegistration?.clientName ?? clientSignal.clientName,
    clientVersion: clientSignal.clientVersion,
    classification: null,
    rawQueryJson: null,
    rawBodyJson: JSON.stringify(rawRecord)
  });

  const accessToken = await issueDiagnosticToken({ issuer, clientId, sessionId });
  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: typeof rawRecord.scope === "string" ? rawRecord.scope : "cimd:read",
    session_id: sessionId
  });
}

export function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
