const IGNORED_USER_AGENT_PRODUCTS = new Set([
  "mozilla",
  "applewebkit",
  "chrome",
  "chromium",
  "safari",
  "mobile",
  "version"
]);

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function clientNameFromPayload(payload: Record<string, unknown>) {
  return clean(payload.client_name) ?? clean(payload.software_id) ?? clean(payload.application_name);
}

export function clientVersionFromPayload(payload: Record<string, unknown>) {
  return clean(payload.client_version) ?? clean(payload.software_version) ?? clean(payload.version);
}

export function clientSignalFromUserAgent(userAgent: string | null) {
  if (!userAgent) return { clientName: null, clientVersion: null };

  const products = [...userAgent.matchAll(/([A-Za-z][A-Za-z0-9._-]*)\/([^\s()]+)/g)]
    .map((match) => ({ name: match[1], version: match[2] }))
    .filter((product) => !IGNORED_USER_AGENT_PRODUCTS.has(product.name.toLowerCase()));

  const preferred = products.find((product) => /codex|claude|mcp|vscode|inspector|cursor|copilot/i.test(product.name)) ?? products[0];

  return {
    clientName: preferred?.name ?? null,
    clientVersion: preferred?.version ?? null
  };
}

export function clientSignalFromPayload(payload: Record<string, unknown>, userAgent: string | null) {
  const userAgentSignal = clientSignalFromUserAgent(userAgent);

  return {
    clientName: clientNameFromPayload(payload) ?? userAgentSignal.clientName,
    clientVersion: clientVersionFromPayload(payload) ?? userAgentSignal.clientVersion
  };
}

export function clientSignalFromRawMetadata(rawMetadataJson: string | null | undefined) {
  if (!rawMetadataJson) return { clientName: null, clientVersion: null };

  try {
    const metadata = JSON.parse(rawMetadataJson) as Record<string, unknown>;
    return {
      clientName: clientNameFromPayload(metadata),
      clientVersion: clientVersionFromPayload(metadata)
    };
  } catch {
    return { clientName: null, clientVersion: null };
  }
}
