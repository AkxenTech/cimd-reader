import { createHash } from "node:crypto";
import { desc, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { mcpProtocolObservations, type McpProtocolObservation } from "@/lib/db/schema";
import { clientSignalFromUserAgent } from "@/lib/oauth/client-signal";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Only protocol and identity evidence is retained here, never tokens or tool arguments.
export async function recordProtocolObservation(
  httpRequest: Request,
  body: unknown,
  response: Response,
  supportedVersions: readonly string[]
) {
  const request = object(body);
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || request.id === undefined) return;
  const params = object(request.params);
  const meta = object(params._meta);
  const phase = request.method === "initialize" ? "initialize" : request.method === "server/discover" ? "discovery" : "request";
  const headerVersion = text(httpRequest.headers.get("mcp-protocol-version"));
  const paramsVersion = text(params.protocolVersion);
  const metaVersion = text(meta["io.modelcontextprotocol/protocolVersion"]);
  const requestedVersion = phase === "initialize"
    ? paramsVersion ?? headerVersion ?? metaVersion
    : metaVersion ?? headerVersion ?? paramsVersion;
  if (phase === "request" && !requestedVersion) return;

  const clientInfo = object(phase === "initialize" ? params.clientInfo : meta["io.modelcontextprotocol/clientInfo"]);
  const userAgent = clientSignalFromUserAgent(httpRequest.headers.get("user-agent"));
  const hasClientInfo = Boolean(text(clientInfo.name));
  const clientName = hasClientInfo ? text(clientInfo.name) : userAgent.clientName;
  // Never attach a transport library's version to a reported application name.
  const clientVersion = hasClientInfo ? text(clientInfo.version) : userAgent.clientVersion;
  const identitySource = hasClientInfo ? "clientInfo" : clientName ? "user-agent" : "unknown";
  const payload = object(await response.clone().json());
  const result = object(payload.result);
  const error = object(payload.error);
  const rejected = !response.ok || payload.error !== undefined;
  const selectedVersion = rejected ? null : phase === "initialize"
    ? text(result.protocolVersion)
    : headerVersion ?? metaVersion ?? paramsVersion;
  const outcome = rejected ? "rejected" : phase === "initialize"
    ? selectedVersion === requestedVersion ? "negotiated" : "offered"
    : phase === "discovery" ? "discovered" : "accepted";
  const errorCode = typeof error.code === "number" ? error.code : null;
  const errorMessage = text(error.message);
  const serverVersionsJson = JSON.stringify(supportedVersions);
  const id = createHash("sha256").update(JSON.stringify([
    clientName?.toLowerCase(), clientVersion, identitySource, phase,
    requestedVersion, headerVersion, paramsVersion, metaVersion, selectedVersion,
    outcome, errorCode, serverVersionsJson
  ])).digest("hex");
  const now = new Date().toISOString();

  await db.insert(mcpProtocolObservations).values({
    id, clientName, clientVersion, identitySource, phase,
    requestedVersion, headerVersion, paramsVersion, metaVersion, selectedVersion,
    outcome, errorCode, errorMessage, serverVersionsJson,
    firstSeenAt: now, lastSeenAt: now, observationCount: 1
  }).onConflictDoUpdate({
    target: mcpProtocolObservations.id,
    set: {
      lastSeenAt: sql`max(${mcpProtocolObservations.lastSeenAt}, ${now})`,
      firstSeenAt: sql`min(${mcpProtocolObservations.firstSeenAt}, ${now})`,
      observationCount: sql`${mcpProtocolObservations.observationCount} + 1`,
      errorMessage
    }
  });
}

export function compareProtocolObservations(left: McpProtocolObservation, right: McpProtocolObservation) {
  // MCP revision dates sort chronologically. Invalid/missing revisions come last.
  const version = (row: McpProtocolObservation) => {
    const value = row.selectedVersion ?? row.requestedVersion ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  };
  return version(right).localeCompare(version(left))
    || right.lastSeenAt.localeCompare(left.lastSeenAt)
    || left.id.localeCompare(right.id);
}

export async function getProtocolObservations() {
  const rows = await db.select().from(mcpProtocolObservations).orderBy(desc(mcpProtocolObservations.lastSeenAt));
  return rows.sort(compareProtocolObservations);
}
