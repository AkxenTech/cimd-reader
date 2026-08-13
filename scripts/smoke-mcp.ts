import assert from "node:assert/strict";

import { and, desc, eq } from "drizzle-orm";

import { GET as authorizeGet } from "../app/authorize/route";
import { POST as registerPost } from "../app/register/route";
import { POST as tokenPost } from "../app/token/route";
import { db } from "../lib/db";
import { oauthAttempts } from "../lib/db/schema";
import { getClientsWithLatestSignals } from "../lib/db/queries";
import { handleMcpRequest } from "../lib/mcp/protocol";

const baseUrl = "http://localhost:3000";
const safeToolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

type JsonRpcResponse = {
  result?: Record<string, unknown>;
  error?: unknown;
};

async function invoke(body: Record<string, unknown>, headers: Record<string, string>) {
  const request = new Request(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-access-token",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers
    }
  });

  const response = await handleMcpRequest(request, body, baseUrl);
  const payload = (await response.json()) as JsonRpcResponse;
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.error, undefined, JSON.stringify(payload.error));

  return { response, payload };
}

function toolNames(payload: JsonRpcResponse) {
  const tools = payload.result?.tools;
  assert.ok(Array.isArray(tools), "tools/list did not return a tools array");
  return tools.map((tool) => {
    assert.equal(typeof tool.name, "string");
    return tool.name as string;
  });
}

async function main() {
  const probeVersion = `local-${Date.now()}`;

  const legacyInitialize = await invoke(
    {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "Local MCP Smoke", version: probeVersion }
      },
      id: 1
    },
    {
      "mcp-protocol-version": "2025-11-25",
      "user-agent": `LocalSmoke/${probeVersion}`
    }
  );
  assert.equal(legacyInitialize.payload.result?.protocolVersion, "2025-11-25");
  assert.equal(legacyInitialize.response.headers.get("mcp-session-id"), "cimd-reader-legacy-session");
  assert.equal(legacyInitialize.payload.result?._meta, undefined);

  const legacyTools = await invoke(
    { jsonrpc: "2.0", method: "tools/list", params: {}, id: 2 },
    { "mcp-protocol-version": "2025-11-25" }
  );
  const names = toolNames(legacyTools.payload);
  assert.deepEqual(names, ["cimd_server_info", "cimd_clients_list", "cimd_sessions_list"]);
  assert.equal(names.every((name) => safeToolNamePattern.test(name)), true);

  const legacyToolCall = await invoke(
    { jsonrpc: "2.0", method: "tools/call", params: { name: "cimd_server_info", arguments: {} }, id: 3 },
    { "mcp-protocol-version": "2025-11-25" }
  );
  assert.ok(Array.isArray(legacyToolCall.payload.result?.content));
  assert.equal(legacyToolCall.payload.result?.structuredContent, undefined);

  const sessionOnlyLegacyTools = await invoke(
    { jsonrpc: "2.0", method: "tools/list", params: {}, id: 31 },
    { "mcp-session-id": "cimd-reader-legacy-session" }
  );
  assert.deepEqual(toolNames(sessionOnlyLegacyTools.payload), names);

  const midLegacyInitialize = await invoke(
    {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Local MCP Smoke", version: probeVersion }
      },
      id: 32
    },
    {
      "mcp-protocol-version": "2025-06-18",
      "user-agent": `LocalSmoke/${probeVersion}`
    }
  );
  assert.equal(midLegacyInitialize.payload.result?.protocolVersion, "2025-06-18");
  assert.equal(midLegacyInitialize.response.headers.get("mcp-session-id"), "cimd-reader-legacy-session");

  const dottedAliasCall = await invoke(
    { jsonrpc: "2.0", method: "tools/call", params: { name: "cimd.server.info", arguments: {} }, id: 4 },
    { "mcp-protocol-version": "2025-11-25" }
  );
  assert.ok(Array.isArray(dottedAliasCall.payload.result?.content));

  const modernTools = await invoke(
    {
      jsonrpc: "2.0",
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "Local MCP Smoke", version: probeVersion }
        }
      },
      id: 5
    },
    {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list"
    }
  );
  assert.ok(modernTools.payload.result?._meta);
  assert.equal(modernTools.payload.result?.resultType, "complete");

  const modernToolCall = await invoke(
    {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "cimd_server_info",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "Local MCP Smoke", version: probeVersion }
        }
      },
      id: 6
    },
    {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "cimd_server_info"
    }
  );
  assert.ok(modernToolCall.payload.result?._meta);
  assert.ok(modernToolCall.payload.result?.structuredContent);

  const [latest] = await db.select().from(oauthAttempts).orderBy(desc(oauthAttempts.createdAt)).limit(1);
  assert.equal(latest.path, "/mcp");
  assert.equal(latest.classification, "mcp");
  assert.equal(latest.clientName, "Local MCP Smoke");
  assert.equal(latest.clientVersion, probeVersion);

  const oauthSessionId = crypto.randomUUID();
  const clientId = `local-client-${probeVersion}`;
  const redirectUri = `http://localhost/callback-${probeVersion}`;
  await authorizeGet(new Request(`${baseUrl}/authorize?${new URLSearchParams({
    session_id: oauthSessionId,
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "cimd:read"
  })}`) as never);

  const tokenResponse = await tokenPost(new Request(`${baseUrl}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": `LocalOAuthSmoke/${probeVersion}`
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "test-authorization-code",
      client_id: clientId,
      redirect_uri: redirectUri
    })
  }) as never);
  const tokenPayload = await tokenResponse.json() as Record<string, unknown>;
  assert.equal(tokenResponse.status, 200, JSON.stringify(tokenPayload));
  assert.equal(tokenPayload.session_id, oauthSessionId);

  const correlatedAttempts = await db
    .select()
    .from(oauthAttempts)
    .where(and(eq(oauthAttempts.sessionId, oauthSessionId), eq(oauthAttempts.clientId, clientId)))
    .orderBy(oauthAttempts.createdAt);
  assert.deepEqual(correlatedAttempts.map((attempt) => attempt.path), ["/authorize", "/token"]);

  const devinRegisterResponse = await registerPost(new Request(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Devin CLI",
      redirect_uris: ["http://127.0.0.1:8765/auth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "cimd:read",
      application_type: "native"
    })
  }) as never);
  const devinRegistration = await devinRegisterResponse.json() as Record<string, unknown>;
  assert.equal(devinRegisterResponse.status, 200);
  assert.equal(devinRegistration.client_id, "dcr-devin-cli");
  assert.deepEqual(devinRegistration.redirect_uris, [
    "http://127.0.0.1:8765/auth/callback",
    "http://localhost:8765/auth/callback"
  ]);

  const devinAuthorizeSession = crypto.randomUUID();
  await authorizeGet(new Request(`${baseUrl}/authorize?${new URLSearchParams({
    session_id: devinAuthorizeSession,
    client_id: "dcr-devin-cli",
    redirect_uri: "http://localhost:8765/auth/callback",
    response_type: "code",
    scope: "cimd:read"
  })}`) as never);
  const [devinAuthorizeAttempt] = await db
    .select()
    .from(oauthAttempts)
    .where(and(eq(oauthAttempts.sessionId, devinAuthorizeSession), eq(oauthAttempts.clientId, "dcr-devin-cli")))
    .limit(1);
  assert.equal(devinAuthorizeAttempt.classification, "dcr");
  assert.equal(devinAuthorizeAttempt.clientName, "Devin CLI");

  const pendingName = `Pending DCR ${probeVersion}`;
  const pendingRedirect = `http://127.0.0.1:8765/pending-${probeVersion}`;
  const pendingRegisterResponse = await registerPost(new Request(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: pendingName,
      redirect_uris: [pendingRedirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "cimd:read",
      application_type: "native"
    })
  }) as never);
  const pendingRegistration = await pendingRegisterResponse.json() as Record<string, unknown>;
  const pendingClientId = String(pendingRegistration.client_id);
  const pendingCardId = pendingClientId.replace(/^dcr-/, "");
  const pendingAuthorizeSession = crypto.randomUUID();
  await authorizeGet(new Request(`${baseUrl}/authorize?${new URLSearchParams({
    session_id: pendingAuthorizeSession,
    client_id: pendingClientId,
    redirect_uri: pendingRedirect.replace("127.0.0.1", "localhost"),
    response_type: "code",
    scope: "cimd:read"
  })}`) as never);
  const clientsBeforeToken = await getClientsWithLatestSignals();
  assert.equal(clientsBeforeToken.some((client) => client.id === pendingCardId), false);

  const completeName = `Complete DCR ${probeVersion}`;
  const completeRedirect = `http://127.0.0.1:8765/complete-${probeVersion}`;
  const completeRegisterResponse = await registerPost(new Request(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: completeName,
      redirect_uris: [completeRedirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "cimd:read",
      application_type: "native"
    })
  }) as never);
  const completeRegistration = await completeRegisterResponse.json() as Record<string, unknown>;
  const completeClientId = String(completeRegistration.client_id);
  const completeCardId = completeClientId.replace(/^dcr-/, "");
  const completeLoopbackRedirect = completeRedirect.replace("127.0.0.1", "localhost");
  const completeAuthorizeSession = crypto.randomUUID();
  await authorizeGet(new Request(`${baseUrl}/authorize?${new URLSearchParams({
    session_id: completeAuthorizeSession,
    client_id: completeClientId,
    redirect_uri: completeLoopbackRedirect,
    response_type: "code",
    scope: "cimd:read"
  })}`) as never);
  const completeTokenResponse = await tokenPost(new Request(`${baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "test-authorization-code",
      client_id: completeClientId,
      redirect_uri: completeLoopbackRedirect
    })
  }) as never);
  assert.equal(completeTokenResponse.status, 200);
  const clientsAfterToken = await getClientsWithLatestSignals();
  const completeClient = clientsAfterToken.find((client) => client.id === completeCardId);
  assert.equal(completeClient?.name, completeName);
  assert.equal(completeClient?.observedBehavior, "dcr");

  console.log("MCP smoke test passed");
  console.log(JSON.stringify({ safeToolNames: names, capturedClientVersion: probeVersion, correlatedTokenSession: oauthSessionId }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
