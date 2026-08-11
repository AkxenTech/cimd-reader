import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { cimdValidationResults, oauthAttempts } from "@/lib/db/schema";
import { ensureSession, hasDcrAttemptForSession } from "@/lib/db/queries";
import { classifyAuthorizeRequest, isHttpsUrl } from "@/lib/oauth/classify";
import { searchParamsToRecord } from "@/lib/oauth/parse";
import { validateCimdDocument } from "@/lib/oauth/cimd-validator";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id") ?? crypto.randomUUID();
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const hadDcrAttempt = await hasDcrAttemptForSession(sessionId);
  const classification = classifyAuthorizeRequest(clientId, hadDcrAttempt);
  const now = new Date().toISOString();
  const attemptId = crypto.randomUUID();

  await ensureSession(sessionId, url.searchParams.get("label"));
  await db.insert(oauthAttempts).values({
    id: attemptId,
    sessionId,
    createdAt: now,
    path: "/authorize",
    method: request.method,
    clientId,
    redirectUri,
    responseType: url.searchParams.get("response_type"),
    scope: url.searchParams.get("scope"),
    state,
    resource: url.searchParams.get("resource"),
    codeChallenge: url.searchParams.get("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method"),
    userAgent: request.headers.get("user-agent"),
    classification,
    rawQueryJson: JSON.stringify(searchParamsToRecord(url.searchParams)),
    rawBodyJson: null
  });

  if (clientId && isHttpsUrl(clientId)) {
    const validation = await validateCimdDocument(clientId, redirectUri);
    await db.insert(cimdValidationResults).values({
      id: crypto.randomUUID(),
      attemptId,
      metadataUrl: clientId,
      metadataFetchSuccess: validation.metadataFetchSuccess ? 1 : 0,
      metadataHttpStatus: validation.metadataHttpStatus,
      metadataValid: validation.metadataValid ? 1 : 0,
      validationErrors: JSON.stringify(validation.validationErrors),
      validationWarnings: JSON.stringify(validation.validationWarnings),
      rawMetadataJson: validation.rawMetadataJson,
      createdAt: new Date().toISOString()
    });
  }

  if (redirectUri) {
    try {
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", "test-authorization-code");
      callbackUrl.searchParams.set("session_id", sessionId);
      if (state) callbackUrl.searchParams.set("state", state);
      return NextResponse.redirect(callbackUrl, 302);
    } catch {
      return NextResponse.json({ error: "invalid_redirect_uri", session_id: sessionId }, { status: 400 });
    }
  }

  return NextResponse.json({
    code: "test-authorization-code",
    session_id: sessionId,
    classification
  });
}
