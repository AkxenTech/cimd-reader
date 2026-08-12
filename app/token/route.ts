import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { oauthAttempts } from "@/lib/db/schema";
import { ensureSession, findRecentAuthorizeSessionForToken } from "@/lib/db/queries";
import { mcpResourceUrl } from "@/lib/mcp/protocol";
import { clientSignalFromPayload } from "@/lib/oauth/client-signal";
import { getBaseUrl } from "@/lib/oauth/base-url";
import { requestBodyToRecord } from "@/lib/oauth/parse";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { raw } = await requestBodyToRecord(request);
  const rawRecord = raw as Record<string, unknown>;
  const providedSessionId = typeof rawRecord.session_id === "string" ? rawRecord.session_id : null;
  const clientId = typeof rawRecord.client_id === "string" ? rawRecord.client_id : null;
  const redirectUri = typeof rawRecord.redirect_uri === "string" ? rawRecord.redirect_uri : null;
  const resource = typeof rawRecord.resource === "string" ? rawRecord.resource : null;
  const expectedResource = mcpResourceUrl(getBaseUrl(request));
  const userAgent = request.headers.get("user-agent");
  const clientSignal = clientSignalFromPayload(rawRecord, userAgent);

  if (resource && resource !== expectedResource) {
    return NextResponse.json({ error: "invalid_target", error_description: "resource does not match this MCP server" }, { status: 400 });
  }

  const correlatedSessionId = providedSessionId ?? await findRecentAuthorizeSessionForToken({ clientId, redirectUri });
  const sessionId = correlatedSessionId ?? crypto.randomUUID();

  await ensureSession(sessionId, correlatedSessionId ? null : "Token exchange");
  await db.insert(oauthAttempts).values({
    id: crypto.randomUUID(),
    sessionId,
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
    clientName: clientSignal.clientName,
    clientVersion: clientSignal.clientVersion,
    classification: null,
    rawQueryJson: null,
    rawBodyJson: JSON.stringify(rawRecord)
  });

  return NextResponse.json({
    access_token: "test-access-token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: typeof rawRecord.scope === "string" ? rawRecord.scope : "cimd:read",
    session_id: sessionId
  });
}

export function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
