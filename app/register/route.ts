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

  await ensureSession(sessionId, "Dynamic Client Registration");
  await db.insert(oauthAttempts).values({
    id: crypto.randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    path: "/register",
    method: request.method,
    clientId: "dcr-test-client-id",
    redirectUri: Array.isArray(rawRecord.redirect_uris) ? rawRecord.redirect_uris.join(", ") : null,
    responseType: Array.isArray(rawRecord.response_types) ? rawRecord.response_types.join(" ") : null,
    scope: null,
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
    token_endpoint_auth_method: "none"
  });
}

export function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
