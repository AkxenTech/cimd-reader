import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { oauthAttempts } from "@/lib/db/schema";
import { ensureSession } from "@/lib/db/queries";
import { mcpResourceUrl } from "@/lib/mcp/protocol";
import { getBaseUrl } from "@/lib/oauth/base-url";
import { requestBodyToRecord } from "@/lib/oauth/parse";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { raw } = await requestBodyToRecord(request);
  const rawRecord = raw as Record<string, unknown>;
  const sessionId = typeof rawRecord.session_id === "string" ? rawRecord.session_id : crypto.randomUUID();
  const resource = typeof rawRecord.resource === "string" ? rawRecord.resource : null;
  const expectedResource = mcpResourceUrl(getBaseUrl(request));

  if (resource && resource !== expectedResource) {
    return NextResponse.json({ error: "invalid_target", error_description: "resource does not match this MCP server" }, { status: 400 });
  }

  await ensureSession(sessionId, "Token exchange");
  await db.insert(oauthAttempts).values({
    id: crypto.randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    path: "/token",
    method: request.method,
    clientId: typeof rawRecord.client_id === "string" ? rawRecord.client_id : null,
    redirectUri: typeof rawRecord.redirect_uri === "string" ? rawRecord.redirect_uri : null,
    responseType: null,
    scope: typeof rawRecord.scope === "string" ? rawRecord.scope : null,
    state: null,
    resource,
    codeChallenge: null,
    codeChallengeMethod: null,
    userAgent: request.headers.get("user-agent"),
    classification: null,
    rawQueryJson: null,
    rawBodyJson: JSON.stringify(rawRecord)
  });

  return NextResponse.json({
    access_token: "test-access-token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: typeof rawRecord.scope === "string" ? rawRecord.scope : "cimd:read"
  });
}

export function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
