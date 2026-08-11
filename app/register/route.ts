import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { oauthAttempts } from "@/lib/db/schema";
import { ensureSession } from "@/lib/db/queries";
import { requestBodyToRecord } from "@/lib/oauth/parse";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const { raw } = await requestBodyToRecord(request);
  const rawRecord = raw as Record<string, unknown>;
  const sessionId = url.searchParams.get("session_id") ?? crypto.randomUUID();
  const redirectUris = Array.isArray(rawRecord.redirect_uris) && rawRecord.redirect_uris.every((item) => typeof item === "string")
    ? rawRecord.redirect_uris
    : [];
  const responseTypes = Array.isArray(rawRecord.response_types) && rawRecord.response_types.every((item) => typeof item === "string")
    ? rawRecord.response_types
    : ["code"];
  const grantTypes = Array.isArray(rawRecord.grant_types) && rawRecord.grant_types.every((item) => typeof item === "string")
    ? rawRecord.grant_types
    : ["authorization_code", "refresh_token"];
  const scope = typeof rawRecord.scope === "string" ? rawRecord.scope : "cimd:read";
  const clientName = typeof rawRecord.client_name === "string" ? rawRecord.client_name : "DCR test client";

  await ensureSession(sessionId, "Dynamic Client Registration");
  await db.insert(oauthAttempts).values({
    id: crypto.randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    path: "/register",
    method: request.method,
    clientId: "dcr-test-client-id",
    redirectUri: redirectUris.length ? redirectUris.join(", ") : null,
    responseType: responseTypes.join(" "),
    scope,
    state: null,
    resource: null,
    codeChallenge: null,
    codeChallengeMethod: null,
    userAgent: request.headers.get("user-agent"),
    classification: "dcr",
    rawQueryJson: JSON.stringify(Object.fromEntries(url.searchParams.entries())),
    rawBodyJson: JSON.stringify(rawRecord)
  });

  return NextResponse.json({
    client_id: "dcr-test-client-id",
    client_id_issued_at: 1710000000,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: "none",
    application_type: typeof rawRecord.application_type === "string" ? rawRecord.application_type : "native",
    scope
  });
}

export function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
