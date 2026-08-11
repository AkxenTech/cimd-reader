import type { NextRequest } from "next/server";

export function getBaseUrl(request: NextRequest | Request) {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");

  const headers = request.headers;
  const proto = headers.get("x-forwarded-proto") ?? "http";
  const host = headers.get("x-forwarded-host") ?? headers.get("host");

  if (!host) return "http://localhost:3000";
  return `${proto.split(",")[0]}://${host.split(",")[0]}`.replace(/\/$/, "");
}

export function authorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["cimd:read"],
    protected_resources: [`${baseUrl}/mcp`],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true
  };
}
