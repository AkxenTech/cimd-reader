import { lookup } from "node:dns/promises";
import net from "node:net";

export type CimdValidationResultInput = {
  metadataFetchSuccess: boolean;
  metadataHttpStatus: number | null;
  metadataValid: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  rawMetadataJson: string | null;
};

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 256 * 1024;

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal"
  );
}

function isBlockedIp(ip: string) {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return true;
}

async function assertSafeHttpsUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("metadata URL is not a valid URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("metadata URL must use HTTPS");
  }

  if (url.username || url.password) {
    throw new Error("metadata URL must not contain credentials");
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error("metadata URL hostname is blocked");
  }

  if (net.isIP(url.hostname)) {
    if (isBlockedIp(url.hostname)) throw new Error("metadata URL IP address is blocked");
    return url;
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("metadata URL hostname did not resolve");
  for (const address of addresses) {
    if (isBlockedIp(address.address)) {
      throw new Error(`metadata URL resolves to blocked IP address ${address.address}`);
    }
  }

  return url;
}

async function readLimitedBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("metadata response body exceeds size limit");
      }
      chunks.push(value);
    }
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchMetadataDocument(rawUrl: string) {
  let currentUrl = await assertSafeHttpsUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "application/json"
        },
        cache: "no-store",
        credentials: "omit"
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("metadata redirect is missing a location header");
        if (redirectCount === MAX_REDIRECTS) throw new Error("metadata redirect limit exceeded");
        currentUrl = await assertSafeHttpsUrl(new URL(location, currentUrl).toString());
        continue;
      }

      const body = await readLimitedBody(response);
      return { response, body, finalUrl: currentUrl.toString() };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("metadata redirect limit exceeded");
}

function asStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

export async function validateCimdDocument(clientId: string, requestedRedirectUri: string | null): Promise<CimdValidationResultInput> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const { response, body } = await fetchMetadataDocument(clientId);
    let parsed: Record<string, unknown>;

    if (response.status !== 200) {
      errors.push(`metadata HTTP status was ${response.status}, expected 200`);
    }

    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {
        metadataFetchSuccess: response.ok,
        metadataHttpStatus: response.status,
        metadataValid: false,
        validationErrors: [...errors, "metadata response is not valid JSON"],
        validationWarnings: warnings,
        rawMetadataJson: body
      };
    }

    if (!parsed.client_id) errors.push("metadata.client_id is missing");
    if (parsed.client_id !== clientId) errors.push("metadata.client_id does not match requested client_id");

    const redirectUris = asStringArray(parsed.redirect_uris);
    if (!redirectUris) {
      errors.push("metadata.redirect_uris must be an array of strings");
    } else if (requestedRedirectUri && !redirectUris.includes(requestedRedirectUri)) {
      errors.push("requested redirect_uri is not listed in metadata.redirect_uris");
    }

    const responseTypes = asStringArray(parsed.response_types);
    if (!responseTypes?.includes("code")) errors.push("metadata.response_types must include code");

    const grantTypes = asStringArray(parsed.grant_types);
    if (!grantTypes?.includes("authorization_code")) {
      errors.push("metadata.grant_types must include authorization_code");
    }

    if (parsed.token_endpoint_auth_method !== "none") {
      errors.push("metadata.token_endpoint_auth_method must be none for native/public clients");
    }

    if (!parsed.application_type) warnings.push("metadata.application_type is missing");
    for (const optionalField of ["client_name", "client_uri", "logo_uri"]) {
      if (!parsed[optionalField]) warnings.push(`metadata.${optionalField} is missing`);
    }

    return {
      metadataFetchSuccess: response.ok,
      metadataHttpStatus: response.status,
      metadataValid: response.status === 200 && errors.length === 0,
      validationErrors: errors,
      validationWarnings: warnings,
      rawMetadataJson: JSON.stringify(parsed, null, 2)
    };
  } catch (error) {
    return {
      metadataFetchSuccess: false,
      metadataHttpStatus: null,
      metadataValid: false,
      validationErrors: [error instanceof Error ? error.message : "metadata fetch failed"],
      validationWarnings: warnings,
      rawMetadataJson: null
    };
  }
}
