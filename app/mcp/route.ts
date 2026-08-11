import { NextRequest } from "next/server";

import { getBaseUrl } from "@/lib/oauth/base-url";
import {
  handleMcpRequest,
  hasValidBearerToken,
  isAllowedOrigin,
  unauthorizedResponse
} from "@/lib/mcp/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}

export function DELETE() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}

export function OPTIONS(request: NextRequest) {
  const baseUrl = getBaseUrl(request);
  if (!isAllowedOrigin(request.headers.get("origin"), baseUrl)) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": baseUrl,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name"
    }
  });
}

export async function POST(request: NextRequest) {
  const baseUrl = getBaseUrl(request);

  if (!isAllowedOrigin(request.headers.get("origin"), baseUrl)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  if (!hasValidBearerToken(request)) {
    return unauthorizedResponse(baseUrl);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  return handleMcpRequest(request, body as never, baseUrl);
}
