import { getClientsWithLatestSignals, getSessions } from "@/lib/db/queries";
import { GITHUB_HANDLE, GITHUB_URL } from "@/lib/site";

export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_COMPAT_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION, MCP_COMPAT_PROTOCOL_VERSION] as const;
export const MCP_SCOPE = "cimd:read";
export const MCP_ACCESS_TOKEN = "test-access-token";
const MCP_LEGACY_SESSION_ID = "cimd-reader-legacy-session";

type SupportedProtocolVersion = (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];
type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

const serverInfo = {
  name: "cimd-reader",
  title: "CIMD Reader",
  version: "0.1.0",
  description: "MCP OAuth diagnostics and CIMD validation dashboard"
};

const legacyServerInfo = {
  name: serverInfo.name,
  version: serverInfo.version
};

const tools = [
  {
    name: "cimd_server_info",
    title: "CIMD Server Info",
    description: "Return public dashboard, MCP endpoint, and OAuth metadata URLs for this test server.",
    inputSchema: { type: "object", additionalProperties: false }
  },
  {
    name: "cimd_clients_list",
    title: "List CIMD Clients",
    description: "List tracked MCP clients with their latest observed OAuth/CIMD status.",
    inputSchema: { type: "object", additionalProperties: false }
  },
  {
    name: "cimd_sessions_list",
    title: "List Validation Sessions",
    description: "List recent OAuth validation sessions captured by the dashboard.",
    inputSchema: { type: "object", additionalProperties: false }
  }
];

const legacyTools = tools.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema
}));

function normalizeToolName(name: string) {
  if (name === "cimd.server.info") return "cimd_server_info";
  if (name === "cimd.clients.list") return "cimd_clients_list";
  if (name === "cimd.sessions.list") return "cimd_sessions_list";
  return name;
}

export function mcpResourceUrl(baseUrl: string) {
  return `${baseUrl}/mcp`;
}

export function protectedResourceMetadataUrl(baseUrl: string) {
  return `${baseUrl}/.well-known/oauth-protected-resource/mcp`;
}

export function protectedResourceMetadata(baseUrl: string) {
  return {
    resource: mcpResourceUrl(baseUrl),
    authorization_servers: [baseUrl],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: baseUrl
  };
}

export function isAllowedOrigin(origin: string | null, baseUrl: string) {
  if (!origin) return true;
  return origin === baseUrl;
}

export function unauthorizedResponse(baseUrl: string, error?: string) {
  const parts = [
    error ? `error="${error}"` : null,
    `resource_metadata="${protectedResourceMetadataUrl(baseUrl)}"`,
    `scope="${MCP_SCOPE}"`
  ].filter(Boolean);

  return new Response(null, {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer ${parts.join(", ")}`
    }
  });
}

export function hasValidBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token === MCP_ACCESS_TOKEN;
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    ...(id !== undefined ? { id } : {}),
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {})
    }
  };
}

function jsonRpcResult(id: JsonRpcId, result: Record<string, unknown>, protocolVersion: SupportedProtocolVersion) {
  if (protocolVersion === MCP_COMPAT_PROTOCOL_VERSION) {
    return {
      jsonrpc: "2.0",
      id,
      result
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    result: {
      _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
      ...result
    }
  };
}

function resultJson(
  id: JsonRpcId,
  result: Record<string, unknown>,
  status = 200,
  protocolVersion: SupportedProtocolVersion = MCP_PROTOCOL_VERSION,
  headers?: HeadersInit
) {
  return Response.json(jsonRpcResult(id, result, protocolVersion), { status, headers });
}

function errorJson(id: JsonRpcId | undefined, code: number, message: string, status: number, data?: unknown) {
  return Response.json(jsonRpcError(id, code, message, data), { status });
}

function getRequestMeta(request: JsonRpcRequest) {
  return request.params?._meta as Record<string, unknown> | undefined;
}

function getParamsProtocolVersion(request: JsonRpcRequest) {
  const protocolVersion = request.params?.protocolVersion;
  return typeof protocolVersion === "string" ? protocolVersion : undefined;
}

function getMetaProtocolVersion(request: JsonRpcRequest) {
  const protocolVersion = getRequestMeta(request)?.["io.modelcontextprotocol/protocolVersion"];
  return typeof protocolVersion === "string" ? protocolVersion : undefined;
}

function getRequestedProtocolVersions(httpRequest: Request, rpcRequest: JsonRpcRequest) {
  return [
    httpRequest.headers.get("mcp-protocol-version") ?? undefined,
    getParamsProtocolVersion(rpcRequest),
    getMetaProtocolVersion(rpcRequest)
  ].filter((version): version is string => typeof version === "string" && version.length > 0);
}

function isSupportedProtocolVersion(version: string) {
  return MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(version as (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number]);
}

function negotiatedProtocolVersion(httpRequest: Request, rpcRequest: JsonRpcRequest): SupportedProtocolVersion {
  const requested = getRequestedProtocolVersions(httpRequest, rpcRequest);
  return (requested.find(isSupportedProtocolVersion) as SupportedProtocolVersion | undefined) ?? MCP_PROTOCOL_VERSION;
}

function sourceNameForRequest(request: JsonRpcRequest) {
  if (request.method === "tools/call" || request.method === "prompts/get") {
    return typeof request.params?.name === "string" ? request.params.name : null;
  }
  if (request.method === "resources/read") {
    return typeof request.params?.uri === "string" ? request.params.uri : null;
  }
  return null;
}

function validateRequiredHeaders(httpRequest: Request, rpcRequest: JsonRpcRequest) {
  const protocolHeader = httpRequest.headers.get("mcp-protocol-version");
  const methodHeader = httpRequest.headers.get("mcp-method");
  const nameHeader = httpRequest.headers.get("mcp-name");
  const bodyProtocol = rpcRequest.method === "initialize" ? getParamsProtocolVersion(rpcRequest) : getMetaProtocolVersion(rpcRequest);

  if (!protocolHeader) return "Header mismatch: MCP-Protocol-Version header is missing";
  if (protocolHeader !== MCP_PROTOCOL_VERSION) {
    return null;
  }
  if (bodyProtocol && bodyProtocol !== protocolHeader) {
    return `Header mismatch: MCP-Protocol-Version header value '${protocolHeader}' does not match request protocolVersion`;
  }
  if (!methodHeader) return "Header mismatch: Mcp-Method header is missing";
  if (methodHeader !== rpcRequest.method) {
    return `Header mismatch: Mcp-Method header value '${methodHeader}' does not match body method '${rpcRequest.method}'`;
  }

  const sourceName = sourceNameForRequest(rpcRequest);
  if (sourceName !== null) {
    if (!nameHeader) return "Header mismatch: Mcp-Name header is missing";
    if (nameHeader !== sourceName) {
      return `Header mismatch: Mcp-Name header value '${nameHeader}' does not match body value '${sourceName}'`;
    }
  }

  return null;
}

function validateProtocolVersion(httpRequest: Request, request: JsonRpcRequest) {
  const requestedVersions = getRequestedProtocolVersions(httpRequest, request);
  const unsupportedVersion = requestedVersions.find((version) => !isSupportedProtocolVersion(version));

  if (unsupportedVersion) {
    return {
      code: -32022,
      message: `Unsupported protocol version '${unsupportedVersion}'`,
      data: {
        supported: MCP_SUPPORTED_PROTOCOL_VERSIONS,
        requested: unsupportedVersion
      }
    };
  }

  if (requestedVersions.length > 0) return null;

  return {
    code: -32022,
    message: "Missing protocol version",
    data: {
      supported: MCP_SUPPORTED_PROTOCOL_VERSIONS
    }
  };
}

function toolResult(
  id: JsonRpcId,
  protocolVersion: SupportedProtocolVersion,
  content: Array<{ type: "text"; text: string }>,
  structuredContent: Record<string, unknown>
) {
  if (protocolVersion === MCP_COMPAT_PROTOCOL_VERSION) {
    return resultJson(id, { content, isError: false }, 200, protocolVersion);
  }

  return resultJson(
    id,
    {
      resultType: "complete",
      content,
      structuredContent,
      isError: false
    },
    200,
    protocolVersion
  );
}

async function handleToolCall(
  id: JsonRpcId,
  baseUrl: string,
  params: Record<string, unknown> | undefined,
  protocolVersion: SupportedProtocolVersion
) {
  const name = normalizeToolName(typeof params?.name === "string" ? params.name : "");

  if (name === "cimd_server_info") {
    const structuredContent = {
      dashboardUrl: baseUrl,
      mcpEndpoint: mcpResourceUrl(baseUrl),
      protectedResourceMetadata: protectedResourceMetadataUrl(baseUrl),
      authorizationServerMetadata: `${baseUrl}/.well-known/oauth-authorization-server`,
      githubHandle: GITHUB_HANDLE,
      githubUrl: GITHUB_URL,
      protocolVersion: MCP_PROTOCOL_VERSION,
      supportedProtocolVersions: MCP_SUPPORTED_PROTOCOL_VERSIONS
    };
    return toolResult(id, protocolVersion, [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent);
  }

  if (name === "cimd_clients_list") {
    const clients = await getClientsWithLatestSignals();
    return toolResult(id, protocolVersion, [{ type: "text", text: JSON.stringify(clients, null, 2) }], { clients });
  }

  if (name === "cimd_sessions_list") {
    const sessions = await getSessions();
    return toolResult(id, protocolVersion, [{ type: "text", text: JSON.stringify(sessions, null, 2) }], { sessions });
  }

  return errorJson(id, -32602, `Unknown tool '${name}'`, 400);
}

export async function handleMcpRequest(httpRequest: Request, body: JsonRpcRequest, baseUrl: string) {
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return errorJson(body.id, -32600, "Invalid JSON-RPC request", 400);
  }

  if (body.id === undefined) {
    return new Response(null, { status: 202 });
  }

  const headerMismatch = validateRequiredHeaders(httpRequest, body);
  if (headerMismatch) {
    return errorJson(body.id, -32020, headerMismatch, 400);
  }

  const versionError = validateProtocolVersion(httpRequest, body);
  if (versionError) {
    return errorJson(body.id, versionError.code, versionError.message, 400, versionError.data);
  }

  const protocolVersion = negotiatedProtocolVersion(httpRequest, body);

  if (body.method === "server/discover") {
    return resultJson(body.id, {
      resultType: "complete",
      supportedVersions: MCP_SUPPORTED_PROTOCOL_VERSIONS,
      capabilities: { tools: { listChanged: false } },
      instructions: "Use this server to inspect CIMD/OAuth behavior captured by the public dashboard.",
      ttlMs: 300000,
      cacheScope: "public"
    }, 200, protocolVersion);
  }

  if (body.method === "initialize") {
    const headers = protocolVersion === MCP_COMPAT_PROTOCOL_VERSION ? { "Mcp-Session-Id": MCP_LEGACY_SESSION_ID } : undefined;
    return resultJson(body.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: protocolVersion === MCP_COMPAT_PROTOCOL_VERSION ? legacyServerInfo : serverInfo,
      instructions: "Use this server to inspect CIMD/OAuth behavior captured by the public dashboard."
    }, 200, protocolVersion, headers);
  }

  if (body.method === "tools/list") {
    if (protocolVersion === MCP_COMPAT_PROTOCOL_VERSION) {
      return resultJson(body.id, { tools: legacyTools }, 200, protocolVersion);
    }

    return resultJson(body.id, {
      resultType: "complete",
      tools,
      ttlMs: 300000,
      cacheScope: "public"
    }, 200, protocolVersion);
  }

  if (body.method === "tools/call") {
    return handleToolCall(body.id, baseUrl, body.params, protocolVersion);
  }

  return errorJson(body.id, -32601, `Method not found: ${body.method}`, 404);
}
