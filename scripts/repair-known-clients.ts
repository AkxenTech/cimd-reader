import { eq } from "drizzle-orm";

import { db, client } from "../lib/db";
import { mcpClients } from "../lib/db/schema";

async function main() {
  await db
    .update(mcpClients)
    .set({
      supportStatus: "verified",
      metadataUrl: "https://claude.ai/oauth/claude-code-client-metadata",
      sourceUrl: "https://claude.ai/oauth/claude-code-client-metadata",
      notes: "Observed using CIMD: client_id is the Claude Code metadata document URL.",
      updatedAt: new Date().toISOString()
    })
    .where(eq(mcpClients.id, "claude-code"));

  console.log("Repaired known client metadata.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => client.close());
