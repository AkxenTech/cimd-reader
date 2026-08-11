import { db, client } from "../lib/db";
import { cimdValidationResults, mcpClients, oauthAttempts, validationSessions } from "../lib/db/schema";

const now = new Date().toISOString();

const vscodeMetadata = {
  client_name: "Visual Studio Code",
  logo_uri: "https://code.visualstudio.com/assets/branding/code-stable.png",
  grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  application_type: "native",
  client_id: "https://vscode.dev/oauth/client-metadata.json",
  client_uri: "https://vscode.dev/product",
  redirect_uris: ["http://127.0.0.1:33418/", "https://vscode.dev/redirect"]
};

const clients = [
  {
    id: "visual-studio-code",
    name: "Visual Studio Code",
    category: "IDE",
    vendor: "Microsoft",
    supportStatus: "verified",
    metadataUrl: "https://vscode.dev/oauth/client-metadata.json",
    sourceUrl: "https://vscode.dev/oauth/client-metadata.json",
    notes: "Seeded as verified: client_id matches the metadata document URL and redirect URIs include the requested VS Code callbacks."
  },
  { id: "claude-code", name: "Claude Code", category: "CLI", vendor: "Anthropic", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until an observed OAuth flow confirms CIMD, DCR, static, or unknown behavior." },
  { id: "mcpjam", name: "MCPJam", category: "Debugger", vendor: "MCPJam", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until validation traffic is captured." },
  { id: "cursor", name: "Cursor", category: "IDE", vendor: "Anysphere", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until validation traffic is captured." },
  { id: "codex-cli", name: "Codex CLI", category: "CLI", vendor: "OpenAI", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until validation traffic is captured." },
  { id: "github-copilot", name: "GitHub Copilot", category: "Assistant", vendor: "GitHub", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until validation traffic is captured." },
  { id: "windsurf", name: "Windsurf", category: "IDE", vendor: "Cognition", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until validation traffic is captured." }
];

async function main() {
  for (const seedClient of clients) {
    await db
      .insert(mcpClients)
      .values({ ...seedClient, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: mcpClients.id,
        set: { ...seedClient, updatedAt: now }
      });
  }

  const sessionId = "seed-vscode";
  const attemptId = "seed-vscode-authorize";

  await db
    .insert(validationSessions)
    .values({ id: sessionId, label: "Seeded VS Code CIMD pass", createdAt: now })
    .onConflictDoNothing();

  await db
    .insert(oauthAttempts)
    .values({
      id: attemptId,
      sessionId,
      createdAt: now,
      path: "/authorize",
      method: "GET",
      clientId: "https://vscode.dev/oauth/client-metadata.json",
      redirectUri: "http://127.0.0.1:33418/",
      responseType: "code",
      scope: "openid profile offline_access",
      state: "seed",
      resource: null,
      codeChallenge: "seed-code-challenge",
      codeChallengeMethod: "S256",
      userAgent: "seed-data",
      classification: "cimd",
      rawQueryJson: JSON.stringify({
        client_id: "https://vscode.dev/oauth/client-metadata.json",
        redirect_uri: "http://127.0.0.1:33418/",
        response_type: "code",
        state: "seed"
      }),
      rawBodyJson: null
    })
    .onConflictDoNothing();

  await db
    .insert(cimdValidationResults)
    .values({
      id: "seed-vscode-validation",
      attemptId,
      metadataUrl: "https://vscode.dev/oauth/client-metadata.json",
      metadataFetchSuccess: 1,
      metadataHttpStatus: 200,
      metadataValid: 1,
      validationErrors: JSON.stringify([]),
      validationWarnings: JSON.stringify([]),
      rawMetadataJson: JSON.stringify(vscodeMetadata, null, 2),
      createdAt: now
    })
    .onConflictDoNothing();

  console.log(`Seeded ${clients.length} clients and VS Code validation sample.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => client.close());
