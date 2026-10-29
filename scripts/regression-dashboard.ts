import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

async function verifyRenderedDashboard(names: string[], customClientId: string) {
  assert.ok(existsSync(".next/BUILD_ID"), "Build the app before running the dashboard HTTP regression");
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], {
    env: { ...process.env, NEXT_PUBLIC_BASE_URL: base }, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", data => { output = (output + data).slice(-4000); });
  server.stderr.on("data", data => { output = (output + data).slice(-4000); });
  try {
    let response: Response | null = null;
    const deadline = Date.now() + 20000;
    while (!response && Date.now() < deadline && server.exitCode === null) {
      response = await fetch(base).catch(() => null);
      if (!response) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(response?.status, 200, output);
    const html = (await response!.text()).replace(/<!--[\s\S]*?-->/g, "");
    const primary = html.match(/<section aria-labelledby="observed-clients-heading">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(primary, "the primary client section is present in the rendered dashboard");
    const headings = [...primary.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(match => match[1]);
    assert.deepEqual(headings, names, "the rendered cards match the production-shaped product list");
    assert.ok(!html.includes("Unmapped"), "internal mapping status never replaces client names in the UI");
    assert.match(html, /<summary[^>]*>Other OAuth observations \(4\)<\/summary>/);
    assert.ok(!/<details[^>]*\bopen\b/.test(html), "secondary observations are collapsed initially");
    for (const [id, name] of [["cursor", "Cursor"], ["mcpjam", "MCPJam"], ["pi", "Pi"], [customClientId, "InvestigateAI"]]) {
      const detail = await fetch(`${base}/clients/${id}`);
      assert.equal(detail.status, 200, id);
      const body = await detail.text();
      assert.ok(body.includes(`>${name}</h1>`), `${id} detail uses the same readable client name`);
      if (id === "pi") {
        assert.ok(body.includes("dcr-pi"));
        assert.ok(body.includes("https://pi.dev/oauth/account/client.json"));
        assert.ok(!body.includes("https://v0.app/api/chat/integrations/oauth/client-metadata.json"));
      }
    }
  } finally {
    if (server.exitCode === null) await new Promise<void>(resolve => { server.once("exit", () => resolve()); server.kill("SIGTERM"); });
  }
}

async function main() {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-regression-"));
  process.env.TURSO_DATABASE_URL = `file:${join(directory, "dashboard.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  const bootstrap = createClient({ url: process.env.TURSO_DATABASE_URL });
  let closeDatabase = () => bootstrap.close();
  const at = "2026-10-01T12:00:00.000Z";
  try {
    // Populate the previous schema before the one-time association migration.
    for (const file of readdirSync("drizzle").filter(file => /^000[1-5]_.*\.sql$/.test(file)).sort()) {
      for (const sql of readFileSync(join("drizzle", file), "utf8").split(";").map(row => row.trim()).filter(Boolean)) {
        await bootstrap.execute(sql);
      }
    }
    for (const [id, name] of [["claude-code", "Claude Code"], ["codex-cli", "Codex CLI"], ["cursor", "Cursor"], ["mcpjam", "MCPJam"], ["visual-studio-code", "Visual Studio Code"]]) {
      await bootstrap.execute({ sql: "INSERT INTO mcp_clients (id, name, support_status, created_at, updated_at) VALUES (?, ?, 'unknown', ?, ?)", args: [id, name, at, at] });
    }
    const cimd: [string, string, boolean][] = [
      ["https://claude.ai/oauth/claude-code-client-metadata", "Claude Code", true],
      ["https://chatgpt.com/oauth/codex/account/client.json", "Codex", true],
      ["https://vscode.dev/oauth/client-metadata.json", "Visual Studio Code", true],
      ["https://pi.dev/oauth/account/client.json", "pi", true],
      ["https://opencode.ai/oauth/opencode/client.json", "opencode", true],
      ["https://custom.example/client.json", "InvestigateAI", true],
      ["https://v0.app/api/chat/integrations/oauth/client-metadata.json", "v0", true],
      ["https://stella.maz.ix.is/.well-known/oauth-client", "Stella", true],
      ["https://connect.vercel.com/connectors/regression-one", "cimd-reader3", true],
      ["https://connect.vercel.com/connectors/regression-two", "cimd-reader", false],
      ["https://connect.vercel.com/connectors/regression-three", "cimd-reader2", false],
      ["https://api.lovable.dev/.well-known/oauth-client", "Lovable", true],
      ["https://www.mcpjam.com/.well-known/oauth/client-metadata.json", "MCPJam", true],
      ["https://example-app.com/client.json", "Example App", false]
    ];
    const dcr: [string, string | null][] = [
      ["dcr-pi", "pi"], ["dcr-codex", "Codex"], ["dcr-cursor", "Cursor"],
      ["dcr-devin-cli", "Devin CLI"], ["dcr-windsurf", "Windsurf"], ["dcr-builder", "Builder"],
      ["dcr-bolt", "Bolt"], ["dcr-replit-mcp-connector", "Replit MCP Connector"],
      ["dcr-mcp-use-inspector", "mcp-use Inspector"], ["dcr-test-client-id", null]
    ];
    for (const [clientId, name, valid] of [...cimd, ...dcr.map(([id, name]) => [id, name, null] as const)]) {
      const sessionId = crypto.randomUUID();
      await bootstrap.execute({ sql: "INSERT INTO validation_sessions (id, created_at) VALUES (?, ?)", args: [sessionId, at] });
      const attemptId = crypto.randomUUID();
      for (const [id, path] of [[attemptId, "/authorize"], [crypto.randomUUID(), "/token"]]) {
        await bootstrap.execute({
          sql: "INSERT INTO oauth_attempts (id, session_id, created_at, path, method, client_id, client_name, classification) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          args: [id, sessionId, at, path, path === "/authorize" ? "GET" : "POST", clientId, name, valid === null ? "dcr" : "cimd"]
        });
      }
      if (valid !== null) {
        await bootstrap.execute({
          sql: "INSERT INTO cimd_validation_results (id, attempt_id, metadata_url, metadata_fetch_success, metadata_valid, raw_metadata_json, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
          args: [crypto.randomUUID(), attemptId, clientId, valid ? 1 : 0, JSON.stringify({ client_id: clientId, client_name: name }), at]
        });
      }
    }
    bootstrap.close();
    const migrate = () => execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: process.env, stdio: "inherit" });
    migrate();

    const { client, db } = await import("../lib/db");
    closeDatabase = () => client.close();
    const { clientIdentityMappings, mcpClients, oauthAttempts } = await import("../lib/db/schema");
    const { getClientDetail, getClientsWithLatestSignals } = await import("../lib/db/queries");
    const { oauthIdentityId } = await import("../lib/clients/identity");
    const { clientDisplayName, dashboardSections } = await import("../lib/clients/presentation");
    const { eq } = await import("drizzle-orm");
    const cards = await getClientsWithLatestSignals();
    const { primary, other } = dashboardSections(cards);
    const names = primary.map(clientDisplayName);
    assert.equal(primary.length, 18, "the production-shaped history has 18 client cards, without empty duplicate placeholders");
    assert.equal(other.length, 4, "three unvalidated failures and one unidentified client remain inspectable separately");
    assert.equal(new Set(names).size, names.length, "known products do not have duplicate reported-name cards");
    for (const name of ["Cursor", "MCPJam", "Codex CLI", "Pi", "OpenCode", "Lovable", "Stella", "Builder", "Bolt", "Replit MCP Connector", "mcp-use Inspector", "Devin CLI", "Windsurf", "InvestigateAI", "cimd-reader3"]) {
      assert.ok(names.includes(name), name);
    }
    assert.ok(names.every(name => !name.includes("Unmapped")));
    assert.ok(other.every(card => cards.some(row => row.id === card.id)), "the secondary section does not delete or suppress raw evidence");
    assert.equal((await db.select().from(oauthAttempts)).length, (cimd.length + dcr.length) * 2);
    for (const [clientId] of dcr.slice(0, 9)) {
      const matching = cards.filter(card => card.identities.some(identity => identity.clientId === clientId));
      assert.equal(matching.length, 1);
      assert.equal(matching[0].attribution.status, "mapped", clientId);
    }
    const pi = await getClientDetail("pi");
    assert.equal(pi?.identities.length, 2);
    assert.equal(pi?.latestSuccessfulCimdValidation?.metadataUrl, "https://pi.dev/oauth/account/client.json");
    assert.ok(!pi?.identities.some(identity => identity.clientId.includes("v0.app")));
    assert.equal((await getClientDetail("mcpjam"))?.identities[0].clientId, "https://www.mcpjam.com/.well-known/oauth/client-metadata.json");
    const custom = primary.find(card => card.name === "InvestigateAI")!;
    assert.equal(custom.attribution.status, "unresolved", "a useful display name does not fabricate product ownership");
    assert.equal(clientDisplayName(custom), "InvestigateAI");
    await verifyRenderedDashboard(names, custom.id);

    const legacyId = oauthIdentityId(null, "dcr-pi");
    await db.delete(clientIdentityMappings).where(eq(clientIdentityMappings.identityId, legacyId));
    await db.update(mcpClients).set({ isHidden: 1, hiddenReason: "operator choice" }).where(eq(mcpClients.id, "builder"));
    migrate();
    assert.equal((await db.select().from(clientIdentityMappings).where(eq(clientIdentityMappings.identityId, legacyId))).length, 0,
      "replayed migrations never restore an explicitly removed product binding");
    const [builder] = await db.select().from(mcpClients).where(eq(mcpClients.id, "builder"));
    assert.equal(builder.isHidden, 1);
    assert.equal(builder.hiddenReason, "operator choice");
    assert.notEqual(oauthIdentityId("https://new-issuer.example", "dcr-pi"), legacyId);
    console.log("Dashboard regression passed: known product associations, readable names, distinct OAuth identities, secondary failed observations, migration replay, and operator choices.");
  } finally {
    closeDatabase();
    rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
