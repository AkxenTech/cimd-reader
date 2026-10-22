import { lookup } from "node:dns/promises";
import net from "node:net";
import https from "node:https";

export type CimdValidationResultInput = {
  metadataFetchSuccess: boolean;
  metadataHttpStatus: number | null;
  metadataValid: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  rawMetadataJson: string | null;
};

const TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 256 * 1024;

const blockedAddresses = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]
] as const) blockedAddresses.addSubnet(address, prefix, "ipv6");
const publicIpv6 = new net.BlockList();
publicIpv6.addSubnet("2000::", 3, "ipv6");
publicIpv6.addSubnet("::ffff:0:0", 96, "ipv6");

function isBlockedIp(ip: string) {
  const family = net.isIP(ip);
  if (!family) return true;
  if (family === 6 && !publicIpv6.check(ip, "ipv6")) return true;
  // BlockList handles compressed, expanded, and IPv4-mapped IPv6 forms.
  return blockedAddresses.check(ip, family === 6 ? "ipv6" : "ipv4");
}

async function assertSafeHttpsUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("metadata URL is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("metadata URL must use HTTPS");
  if (url.username || url.password) throw new Error("metadata URL must not contain credentials");
  if (rawUrl.includes("#")) throw new Error("metadata URL must not contain a fragment");
  // Inspect the original path before WHATWG URL parsing normalizes dot segments.
  const path = rawUrl.match(/^https:\/\/[^/?#]+(\/[^?#]*)/i)?.[1];
  if (!path) throw new Error("metadata URL must contain a path component");
  if (/[\u0000-\u0020\\]/.test(rawUrl)) throw new Error("metadata URL contains invalid characters");
  if (path.split("/").some((segment) => [".", ".."].includes(segment.replace(/%2e/gi, ".")))) {
    throw new Error("metadata URL must not contain dot path components");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "metadata.google.internal") {
    throw new Error("metadata URL hostname is blocked");
  }
  const family = net.isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("metadata URL hostname did not resolve");
  if (addresses.some(({ address }) => isBlockedIp(address))) {
    throw new Error("metadata URL resolves to a blocked IP address");
  }
  return { url, addresses };
}

async function fetchMetadataDocument(rawUrl: string) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("metadata request timed out"));
      controller.abort();
    }, TIMEOUT_MS);
  });
  const fetchDocument = async () => {
    const { url, addresses } = await assertSafeHttpsUrl(rawUrl);
    controller.signal.throwIfAborted();
    return new Promise<{ response: { status: number; ok: boolean }; body: string }>((resolve, reject) => {
      const request = https.request(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
        // Preserve the hostname for TLS/Host, but only connect to vetted addresses.
        // A fresh connection avoids a pooled socket bypassing this lookup.
        agent: false,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        }
      }, (response) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("error", reject);
        response.on("aborted", () => reject(new Error("metadata response was aborted")));
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_BODY_BYTES) {
            const error = new Error("metadata response body exceeds size limit");
            reject(error);
            request.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({
          response: { status, ok: status >= 200 && status < 300 },
          body: Buffer.concat(chunks).toString("utf8")
        }));
      });
      request.on("error", reject);
      request.end();
    });
  };
  try {
    // The deadline also covers DNS resolution and a stalled response body.
    // Redirects are returned as errors, never followed (CIMD section 5).
    return await Promise.race([fetchDocument(), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

function asStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function optionalStringArray(value: unknown, defaultValue: string[]) {
  if (value === undefined) return defaultValue;
  return asStringArray(value);
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function validRedirectUri(value: string) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !value.includes("#")
      && !["javascript:", "data:", "file:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function redirectUriMatches(registeredUri: string, requestedRedirectUri: string) {
  if (!validRedirectUri(registeredUri) || !validRedirectUri(requestedRedirectUri)) return false;
  if (registeredUri === requestedRedirectUri) return true;

  try {
    const registered = new URL(registeredUri);
    const requested = new URL(requestedRedirectUri);
    const authority = registeredUri.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1] ?? "";
    const registeredHasExplicitPort = /:\d+$/.test(authority);

    return (
      registered.protocol === "http:" && registered.protocol === requested.protocol &&
      isLoopbackHostname(registered.hostname) &&
      isLoopbackHostname(requested.hostname) &&
      registered.pathname === requested.pathname &&
      registered.search === requested.search &&
      registered.hash === requested.hash &&
      !registeredHasExplicitPort
    );
  } catch {
    return false;
  }
}

export async function validateCimdDocument(clientId: string, requestedRedirectUri: string | null): Promise<CimdValidationResultInput> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const { response, body } = await fetchMetadataDocument(clientId);
    let parsed: unknown;

    if (response.status !== 200) {
      errors.push(`metadata HTTP status was ${response.status}, expected 200`);
    }

    try {
      parsed = JSON.parse(body);
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

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        metadataFetchSuccess: response.ok,
        metadataHttpStatus: response.status,
        metadataValid: false,
        validationErrors: [...errors, "metadata must be a JSON object"],
        validationWarnings: warnings,
        rawMetadataJson: body
      };
    }
    const metadata = parsed as Record<string, unknown>;
    if (typeof metadata.client_name !== "string" || !metadata.client_name.trim()) {
      errors.push("metadata.client_name must be a non-empty string");
    }
    for (const field of ["client_secret", "client_secret_expires_at"]) {
      if (field in metadata) errors.push(`metadata.${field} must not be published`);
    }
    const jwks = metadata.jwks as { keys?: unknown } | null | undefined;
    if (Array.isArray(jwks?.keys) && jwks.keys.some((key) => (
      key && typeof key === "object" &&
      ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((field) => field in key)
    ))) {
      errors.push("metadata.jwks must not contain private or symmetric key material");
    }
    if (!metadata.client_id) errors.push("metadata.client_id is missing");
    if (metadata.client_id !== clientId) errors.push("metadata.client_id does not match requested client_id");

    const redirectUris = asStringArray(metadata.redirect_uris);
    if (!redirectUris) {
      errors.push("metadata.redirect_uris must be an array of strings");
    } else if (!redirectUris.length || redirectUris.some((uri) => !validRedirectUri(uri))) {
      errors.push("metadata.redirect_uris must contain valid absolute URIs without credentials or fragments");
    } else if (requestedRedirectUri && !redirectUris.some((redirectUri) => redirectUriMatches(redirectUri, requestedRedirectUri))) {
      errors.push("requested redirect_uri is not listed in metadata.redirect_uris");
    }

    const responseTypes = optionalStringArray(metadata.response_types, ["code"]);
    if (!responseTypes) {
      errors.push("metadata.response_types must be an array of strings");
    } else if (!responseTypes.includes("code")) {
      errors.push("metadata.response_types must include code");
    }

    const grantTypes = optionalStringArray(metadata.grant_types, ["authorization_code"]);
    if (!grantTypes) {
      errors.push("metadata.grant_types must be an array of strings");
    } else if (!grantTypes.includes("authorization_code")) {
      errors.push("metadata.grant_types must include authorization_code");
    }

    if (metadata.token_endpoint_auth_method !== "none") {
      errors.push("metadata.token_endpoint_auth_method must be none for native/public clients");
    }

    if (!metadata.application_type) warnings.push("metadata.application_type is missing");
    for (const optionalField of ["client_uri", "logo_uri"]) {
      if (!metadata[optionalField]) warnings.push(`metadata.${optionalField} is missing`);
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
