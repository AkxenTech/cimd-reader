import { db, client } from "../lib/db";
import { mcpClients } from "../lib/db/schema";

const now = new Date().toISOString();

const clients = [
  {
    id: "visual-studio-code",
    name: "Visual Studio Code",
    category: "IDE",
    vendor: "Microsoft",
    supportStatus: "unknown",
    metadataUrl: null,
    sourceUrl: null,
    notes: "Placeholder until a real VS Code OAuth flow confirms CIMD, DCR, static, or unknown behavior."
  },
  {
    id: "claude-code",
    name: "Claude Code",
    category: "CLI",
    vendor: "Anthropic",
    supportStatus: "verified",
    metadataUrl: "https://claude.ai/oauth/claude-code-client-metadata",
    sourceUrl: "https://claude.ai/oauth/claude-code-client-metadata",
    notes: "Observed using CIMD: client_id is the Claude Code metadata document URL."
  },
  { id: "mcpjam", name: "MCPJam", category: "Debugger", vendor: "MCPJam", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until validation traffic is captured." },
  { id: "cursor", name: "Cursor", category: "IDE", vendor: "Anysphere", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until validation traffic is captured." },
  { id: "codex-cli", name: "Codex CLI", category: "CLI", vendor: "OpenAI", supportStatus: "unknown", metadataUrl: null, sourceUrl: null, notes: "Placeholder until validation traffic is captured." }
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

  console.log(`Seeded ${clients.length} client cards.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => client.close());
