import type { CimdValidationResult, McpClient, OAuthAttempt } from "@/lib/db/schema";
import { oauthIdentityId, clientNameKey } from "./identity";

export type OAuthIdentity = {
  id: string;
  issuer: string | null;
  clientId: string;
  registrationMethod: string;
  displayName: string | null;
};
export type Attribution = { status: "mapped" | "unresolved"; reason: string };
export type ResolvedClient = {
  client: McpClient;
  identities: OAuthIdentity[];
  attribution: Attribution;
  attempts: OAuthAttempt[];
};
type Mapping = { identityId: string; productId: string };

function metadataName(attempt: OAuthAttempt, results: CimdValidationResult[]) {
  const result = results.find(row => row.attemptId === attempt.id);
  if (!result?.metadataValid || !result.rawMetadataJson) return null;
  try {
    const name = JSON.parse(result.rawMetadataJson)?.client_name;
    return typeof name === "string" ? name : null;
  } catch { return null; }
}

function trustedProduct(clientId: string): { id: string; name: string } | null {
  // Explicit metadata endpoints/namespaces, not aliases found inside URLs.
  if (clientId === "https://claude.ai/oauth/claude-code-client-metadata") return { id: "claude-code", name: "Claude Code" };
  if (clientId === "https://vscode.dev/oauth/client-metadata.json") return { id: "visual-studio-code", name: "Visual Studio Code" };
  if (clientId === "https://v0.app/api/chat/integrations/oauth/client-metadata.json") return { id: "v0", name: "v0" };
  if (/^https:\/\/chatgpt\.com\/oauth\/codex\/[^/?#]+\/client\.json$/.test(clientId)) return { id: "codex-cli", name: "Codex CLI" };
  if (/^https:\/\/pi\.dev\/oauth\/(?:[^/?#]+\/)?client\.json$/.test(clientId)) return { id: "pi", name: "Pi" };
  return null;
}

function newClient(id: string, name: string, at: string, metadataUrl: string | null): McpClient {
  return {
    id, name, metadataUrl, sourceUrl: metadataUrl, category: "Tool", vendor: null,
    supportStatus: "unknown", notes: null, isHidden: 0, hiddenReason: null,
    createdAt: at, updatedAt: at
  };
}

export function resolveClientCatalog(
  storedClients: McpClient[], attempts: OAuthAttempt[], results: CimdValidationResult[], mappings: Mapping[] = []
) {
  attempts = [...attempts].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  results = [...results].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const groups = new Map<string, { identity: OAuthIdentity; attempts: OAuthAttempt[] }>();
  for (const attempt of attempts) {
    if (!attempt.clientId || attempt.path === "/mcp") continue;
    const issuer = attempt.issuer ?? null;
    const id = oauthIdentityId(issuer, attempt.clientId);
    let group = groups.get(id);
    if (!group) {
      group = { identity: {
        id, issuer, clientId: attempt.clientId,
        registrationMethod: attempt.classification ?? (attempt.clientId.startsWith("dcr-") ? "dcr" : "unknown"),
        displayName: null
      }, attempts: [] };
      groups.set(id, group);
    }
    group.attempts.push(attempt);
    group.identity.displayName ??= metadataName(attempt, results) ?? attempt.clientName;
  }
  const catalog = new Map<string, ResolvedClient>(storedClients.map(client => [client.id, {
    client, identities: [], attempts: [], attribution: { status: "mapped", reason: "Configured product; no matching OAuth identity observed yet." }
  }]));
  const byIdentity = new Map<string, ResolvedClient>();
  for (const group of groups.values()) {
    const { identity } = group;
    identity.registrationMethod = group.attempts.find(row => row.classification)?.classification ?? identity.registrationMethod;
    identity.displayName = group.attempts.map(row => metadataName(row, results)).find(Boolean)
      ?? group.attempts.find(row => row.path === "/register")?.clientName
      ?? group.attempts.find(row => row.path === "/authorize")?.clientName
      ?? identity.displayName;
    const binding = mappings.find(row => row.identityId === identity.id);
    const configured = storedClients.filter(client => client.metadataUrl === identity.clientId);
    const trusted = trustedProduct(identity.clientId);
    const ambiguous = configured.length > 1;
    const product = binding ? storedClients.find(client => client.id === binding.productId)
      : configured.length === 1 ? configured[0] : undefined;
    const mappedId = product?.id ?? (!binding && !ambiguous ? trusted?.id : undefined);
    const reason = binding && product ? "Explicit mapping for this issuer and client ID."
      : binding ? "The explicit product mapping no longer exists."
      : ambiguous ? "This metadata URL matches multiple configured products; an explicit identity mapping is required."
      : mappedId ? "Matched an explicitly configured metadata URL or trusted metadata namespace."
      : "This exact issuer and client ID have not been mapped to a product; reported names do not establish ownership.";
    const key = mappedId ?? `identity-${identity.id}`;
    const latest = group.attempts[0];
    let entry = catalog.get(key);
    if (!entry) {
      entry = {
        client: product ?? newClient(key, mappedId && trusted ? trusted.name : identity.displayName ?? identity.clientId, latest.createdAt,
          identity.registrationMethod === "cimd" ? identity.clientId : null),
        identities: [], attempts: [], attribution: {
          status: mappedId ? "mapped" : "unresolved",
          reason
        }
      };
      catalog.set(key, entry);
    }
    entry.identities.push(identity);
    entry.attempts.push(...group.attempts);
    entry.attribution = {
      status: mappedId ? "mapped" : "unresolved",
      reason
    };
    byIdentity.set(identity.id, entry);
  }
  // Link missing-client-ID events only when their exact issuer/session contains
  // one identity. Shared session labels never override an explicit client ID.
  for (const attempt of attempts.filter(row => !row.clientId && row.sessionId)) {
    const owners = [...groups.values()].filter(group => group.identity.issuer === (attempt.issuer ?? null)
      && group.attempts.some(row => row.sessionId === attempt.sessionId));
    if (owners.length === 1) byIdentity.get(owners[0].identity.id)?.attempts.push(attempt);
  }
  for (const entry of catalog.values()) entry.attempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const isCompleted = (entry: ResolvedClient) => entry.attempts.some(auth => auth.path === "/authorize" && auth.sessionId
    && entry.attempts.some(token => token.path === "/token" && token.sessionId === auth.sessionId
      && (token.issuer ?? null) === (auth.issuer ?? null) && token.clientId === auth.clientId));
  return {
    entries: [...catalog.values()].filter(entry => entry.attribution.status === "mapped" || isCompleted(entry)),
    byIdentity,
    forAttempt(attempt: OAuthAttempt) {
      return attempt.clientId ? byIdentity.get(oauthIdentityId(attempt.issuer, attempt.clientId)) ?? null : null;
    },
    // Legacy URLs are routing conveniences only. Ambiguous labels never select
    // one of several identities, and this never merges their evidence.
    find(id: string) {
      const exact = catalog.get(id);
      if (exact) return exact;
      const candidates = [...catalog.values()].filter(entry => clientNameKey(entry.client.name) === id && isCompleted(entry));
      return candidates.length === 1 ? candidates[0] : null;
    }
  };
}
