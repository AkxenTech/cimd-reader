export type HostedClientPlatform = {
  name: string;
  label: string;
  identityScope: string;
  notes: string;
};

const VERCEL_CONNECT_PLATFORM: HostedClientPlatform = {
  name: "Vercel Connect",
  label: "Vercel-hosted connector",
  identityScope: "Per-connector OAuth client",
  notes:
    "Observed as a Vercel Connect-hosted MCP connector. Vercel publishes one CIMD metadata URL per connector, so each connector is represented as its own OAuth client."
};

export function vercelConnectorIdFromMetadataUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.hostname !== "connect.vercel.com") return null;

    const [, connectorId] = url.pathname.match(/^\/connectors\/([^/]+)\/?$/) ?? [];
    return connectorId ?? null;
  } catch {
    return null;
  }
}

export function hostedClientPlatformFromSignal(input: {
  metadataUrl?: string | null;
  userAgent?: string | null;
}) {
  if (vercelConnectorIdFromMetadataUrl(input.metadataUrl)) return VERCEL_CONNECT_PLATFORM;
  if (input.userAgent?.includes("Vercel-Connex/")) return VERCEL_CONNECT_PLATFORM;

  return null;
}

export function hostedClientKeyFromMetadataUrl(value: string | null | undefined) {
  const connectorId = vercelConnectorIdFromMetadataUrl(value);
  if (!connectorId) return null;

  return `vercel-connector-${connectorId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}
