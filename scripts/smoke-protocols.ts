import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const directory = mkdtempSync(join(tmpdir(), "cimd-protocols-"));
  process.env.TURSO_DATABASE_URL = `file:${join(directory, "test.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
  const migrate = () => execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: process.env });
  migrate();
  const { client, db } = await import("../lib/db");
  try {
    const { POST } = await import("../app/mcp/route");
    const { GET } = await import("../app/api/protocols/route");
    const { getProtocolObservations } = await import("../lib/mcp/observations");
    const { getClientDetail } = await import("../lib/db/queries");
    const { mcpClients } = await import("../lib/db/schema");
    const { MCP_PROTOCOL_VERSION } = await import("../lib/mcp/protocol");
    const base = "http://localhost:3000";
    const invoke = async (body: unknown, headers: Record<string, string> = {}, authorized = true) => {
      const request = new Request(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorized ? { authorization: "Bearer test-access-token" } : {}),
          ...headers
        },
        body: JSON.stringify(body)
      });
      const response = await POST(request as never);
      return { response, payload: response.status === 202 || response.status === 401 ? null : await response.json() };
    };
    const initialize = (version: string, release = "1.0.0", name = "Codex CLI") => ({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: version, clientInfo: { name, version: release }, capabilities: {} }
    });
    const modern = (version: string, method = "tools/list", release = "2.0.0") => ({
      body: {
        jsonrpc: "2.0", id: 2, method,
        params: { _meta: {
          "io.modelcontextprotocol/protocolVersion": version,
          "io.modelcontextprotocol/clientInfo": { name: "Codex CLI", version: release }
        } }
      },
      headers: { "mcp-protocol-version": version, "mcp-method": method }
    });
    const legacy = initialize("2025-06-18");
    const first = await invoke(legacy);
    assert.equal(first.payload.result.protocolVersion, "2025-06-18");
    const firstRow = (await getProtocolObservations())[0];
    await Promise.all(Array.from({ length: 5 }, () => invoke({ ...legacy, id: crypto.randomUUID() })));
    let rows = await getProtocolObservations();
    assert.equal(rows.length, 1, "Repeated requests should produce one observation row");
    assert.equal(rows[0].observationCount, 6, "Concurrent repeats must not lose counts");
    assert.equal(rows[0].firstSeenAt, firstRow.firstSeenAt);
    assert.ok(rows[0].lastSeenAt >= rows[0].firstSeenAt);

    await invoke(initialize("2025-06-18", "1.1.0"));
    assert.equal((await getProtocolObservations()).length, 2, "Application releases must stay distinct");
    const newest = modern(MCP_PROTOCOL_VERSION);
    assert.equal((await invoke(newest.body, newest.headers)).response.status, 200);
    const discover = modern(MCP_PROTOCOL_VERSION, "server/discover");
    await invoke(discover.body, discover.headers);
    // A later observation of an older revision must not displace the newest revision.
    await invoke(legacy);
    rows = await getProtocolObservations();
    assert.equal(rows[0].selectedVersion, MCP_PROTOCOL_VERSION);
    assert.equal(rows.find((row) => row.phase === "discovery")?.outcome, "discovered");
    assert.equal(rows.find((row) => row.phase === "request")?.identitySource, "clientInfo");

    const counterOffer = await invoke(initialize("2099-01-01", "3.0.0"));
    assert.equal(counterOffer.payload.result.protocolVersion, "2025-11-25");
    const offered = (await getProtocolObservations()).find((row) => row.clientVersion === "3.0.0");
    assert.equal(offered?.requestedVersion, "2099-01-01");
    assert.equal(offered?.outcome, "offered");

    const unsupported = modern("2099-01-01");
    const rejected = await invoke(unsupported.body, unsupported.headers);
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.payload.error.code, -32022);
    const failed = (await getProtocolObservations()).find((row) => row.outcome === "rejected");
    assert.equal(failed?.selectedVersion, null);
    assert.equal(failed?.requestedVersion, "2099-01-01");

    const mismatch = modern("2025-11-25");
    const mismatchResult = await invoke(mismatch.body, { ...mismatch.headers, "mcp-protocol-version": MCP_PROTOCOL_VERSION });
    assert.equal(mismatchResult.payload.error.code, -32020);
    const mismatchRow = (await getProtocolObservations()).find((row) => row.errorCode === -32020);
    assert.equal(mismatchRow?.headerVersion, MCP_PROTOCOL_VERSION);
    assert.equal(mismatchRow?.metaVersion, "2025-11-25");
    assert.equal(mismatchRow?.selectedVersion, null);
    assert.equal(mismatchRow?.protocolStatus, "rejected");
    assert.equal(failed?.protocolStatus, "rejected");

    const initializedBefore = (await getProtocolObservations())
      .filter((row) => row.phase === "initialize")
      .reduce((sum, row) => sum + row.observationCount, 0);
    const initializeCapabilities = first.payload.result.capabilities;
    assert.ok(initializeCapabilities.tools);
    assert.equal(initializeCapabilities.resources, undefined);
    const legacyHeaders = {
      "mcp-protocol-version": "2025-06-18",
      "mcp-session-id": "cimd-reader-legacy-session",
      "user-agent": "Codex-CLI/1.0.0"
    };
    const missingResources = await invoke({ jsonrpc: "2.0", id: 41, method: "resources/list", params: {} }, legacyHeaders);
    assert.equal(missingResources.response.status, 200, "Unsupported RPC methods must not signal session expiry via HTTP 404");
    assert.equal(missingResources.payload.error.code, -32601);
    const missingRow = (await getProtocolObservations()).find((row) => row.errorCode === -32601);
    assert.equal(missingRow?.protocolVersion, "2025-06-18");
    assert.equal(missingRow?.protocolStatus, "accepted");
    assert.equal(missingRow?.requestStatus, "unsupported_method");
    assert.ok(missingRow?.errorMessage?.includes("resources/list"));
    const subsequentTools = await invoke({ jsonrpc: "2.0", id: 42, method: "tools/list", params: {} }, legacyHeaders);
    assert.equal(subsequentTools.response.status, 200);
    assert.ok(Array.isArray(subsequentTools.payload.result.tools));
    assert.equal((await getProtocolObservations()).filter((row) => row.phase === "initialize")
      .reduce((sum, row) => sum + row.observationCount, 0), initializedBefore);
    const unknownTool = await invoke({ jsonrpc: "2.0", id: 43, method: "tools/call", params: { name: "missing_tool", arguments: {} } }, legacyHeaders);
    assert.equal(unknownTool.response.status, 200);
    assert.equal(unknownTool.payload.error.code, -32602);
    const invalidParamsRow = (await getProtocolObservations()).find((row) => row.errorCode === -32602);
    assert.equal(invalidParamsRow?.protocolStatus, "accepted");
    assert.equal(invalidParamsRow?.requestStatus, "invalid_params");
    const modernUnsupported = modern(MCP_PROTOCOL_VERSION, "resources/list");
    const unsupportedMethod = await invoke(modernUnsupported.body, modernUnsupported.headers);
    assert.equal(unsupportedMethod.response.status, 200);
    assert.equal(unsupportedMethod.payload.error.code, -32601);
    const { protocolObservationStatus } = await import("../lib/mcp/observation-status");
    assert.ok(missingRow);
    assert.deepEqual(protocolObservationStatus({ ...missingRow, outcome: "rejected", selectedVersion: null }), {
      protocolVersion: "2025-06-18", protocolStatus: "accepted", requestStatus: "unsupported_method"
    }, "Historical method errors must not appear as protocol rejections");

    const noIdentity = { jsonrpc: "2.0", id: 8, method: "tools/list", params: {} };
    await invoke(noIdentity, { "mcp-protocol-version": "2025-11-25" });
    await invoke(noIdentity, { "mcp-protocol-version": "2025-11-25", "user-agent": "Cursor/5.0" });
    rows = await getProtocolObservations();
    assert.ok(rows.some((row) => row.identitySource === "unknown" && row.clientName === null));
    assert.ok(rows.some((row) => row.identitySource === "user-agent" && row.clientName === "Cursor" && row.clientVersion === "5.0"));
    const before = rows.reduce((sum, row) => sum + row.observationCount, 0);
    assert.equal((await invoke(newest.body, newest.headers, false)).response.status, 401);
    assert.equal((await invoke(null)).response.status, 400);
    assert.equal((await invoke({ jsonrpc: "2.0", method: "notifications/initialized" })).response.status, 202);
    assert.equal((await getProtocolObservations()).reduce((sum, row) => sum + row.observationCount, 0), before);

    await db.insert(mcpClients).values({
      id: "codex-cli", name: "Codex CLI", supportStatus: "unknown",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    const detail = await getClientDetail("codex-cli");
    assert.equal(detail?.highestObservedProtocol?.selectedVersion, MCP_PROTOCOL_VERSION);
    assert.equal(detail?.highestObservedProtocol?.outcome, "accepted");
    assert.ok(detail?.protocolHistory.every((row) => row.clientName?.toLowerCase().replace(/[-_]/g, " ") === "codex cli"));
    assert.equal(detail?.observedBehavior, "unknown", "Protocol traffic must not imply CIMD support");

    migrate();
    assert.equal((await getProtocolObservations()).reduce((sum, row) => sum + row.observationCount, 0), before, "Migration reruns must preserve history");
    const api = await GET();
    const payload = await api.json();
    assert.equal(payload.observations.length, (await getProtocolObservations()).length);
    assert.equal(api.status, 200);
    console.log("Protocol history smoke passed: legacy/modern, counter-offers, version vs method errors, session continuity, concurrent deduplication, ordering, identity, API, and migration persistence.");
  } finally {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
