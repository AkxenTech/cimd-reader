import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const baseUrl = "http://localhost:3000";
const callback = "http://127.0.0.1:8765/callback";
const uuidClientId = /^dcr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function verifyPopulatedPreIdentityMigration(directory: string) {
  const databasePath = join(directory, "pre-identity.db");
  const url = `file:${databasePath}`;
  const legacyClient = createClient({ url });
  const migrationFiles = readdirSync(join(process.cwd(), "drizzle"))
    .filter((file) => /^000[1-4]_.*\.sql$/.test(file))
    .sort();
  for (const file of migrationFiles) {
    const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf8");
    for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) {
      await legacyClient.execute(statement);
    }
  }

  await legacyClient.execute({
    sql: "INSERT INTO mcp_clients (id, name, support_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    args: ["pre-identity-product", "Pre Identity Product", "unknown", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]
  });
  await legacyClient.execute({ sql: "INSERT INTO validation_sessions (id, label, created_at) VALUES (?, ?, ?)", args: ["pre-identity-session", "legacy", "2026-01-01T00:00:00.000Z"] });
  await legacyClient.execute({
    sql: "INSERT INTO oauth_attempts (id, session_id, created_at, path, method, client_id, client_name, classification) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: ["pre-identity-attempt", "pre-identity-session", "2026-01-01T00:00:00.000Z", "/authorize", "GET", "https://old.example/client.json", "Old Client", "cimd"]
  });
  await legacyClient.execute({
    sql: "INSERT INTO cimd_validation_results (id, attempt_id, metadata_url, metadata_fetch_success, metadata_http_status, metadata_valid, validation_errors, validation_warnings, raw_metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: ["pre-identity-result", "pre-identity-attempt", "https://old.example/client.json", 1, 200, 1, "[]", "[]", "{}", "2026-01-01T00:00:00.000Z"]
  });
  await legacyClient.execute({
    sql: "INSERT INTO oauth_client_registrations (client_id, client_name, redirect_uris_json, raw_body_json, last_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: ["dcr-legacy-before-identity", "Legacy", "[]", "{}", "pre-identity-session", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]
  });
  await legacyClient.execute({
    sql: "INSERT INTO mcp_protocol_observations (id, client_name, identity_source, phase, outcome, server_versions_json, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: ["pre-identity-observation", "Old Client", "clientInfo", "initialize", "accepted", "[]", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]
  });
  await legacyClient.close();

  const migrationEnv: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  delete migrationEnv.TURSO_AUTH_TOKEN;
  execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: migrationEnv, stdio: "inherit" });
  execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: migrationEnv, stdio: "inherit" });

  const migrated = createClient({ url });
  try {
    const checks = await Promise.all([
      migrated.execute("SELECT count(*) AS count FROM oauth_attempts WHERE id = 'pre-identity-attempt'"),
      migrated.execute("SELECT count(*) AS count FROM cimd_validation_results WHERE id = 'pre-identity-result'"),
      migrated.execute("SELECT count(*) AS count FROM oauth_client_registrations WHERE client_id = 'dcr-legacy-before-identity'"),
      migrated.execute("SELECT count(*) AS count FROM mcp_protocol_observations WHERE id = 'pre-identity-observation'"),
      migrated.execute("SELECT issuer FROM oauth_attempts WHERE id = 'pre-identity-attempt'"),
      migrated.execute("SELECT issuer FROM oauth_client_registrations WHERE client_id = 'dcr-legacy-before-identity'"),
      migrated.execute("SELECT is_hidden, hidden_reason FROM mcp_clients WHERE id = 'pre-identity-product'"),
      migrated.execute("SELECT oauth_identity_id FROM mcp_protocol_observations WHERE id = 'pre-identity-observation'")
    ]);
    for (const result of checks.slice(0, 4)) assert.equal(Number(result.rows[0].count), 1, "migration preserves populated pre-existing rows");
    assert.equal(checks[4].rows[0].issuer, null);
    assert.equal(checks[5].rows[0].issuer, null);
    assert.equal(Number(checks[6].rows[0].is_hidden), 0);
    assert.equal(checks[6].rows[0].hidden_reason, null);
    assert.equal(checks[7].rows[0].oauth_identity_id, null);
  } finally {
    await migrated.close();
  }
}

async function main() {
  const directory = mkdtempSync(join(tmpdir(), "identity-regression-"));
  let closeDatabase: (() => void) | undefined;
  process.env.TURSO_DATABASE_URL = `file:${join(directory, "identity.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.NEXT_PUBLIC_BASE_URL = baseUrl;

  try {
    // Migrations must be safely replayable on an already-migrated database.
    execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: process.env, stdio: "inherit" });
    execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: process.env, stdio: "inherit" });
    await verifyPopulatedPreIdentityMigration(directory);

    const { db, client } = await import("../lib/db");
    closeDatabase = () => client.close();
    const {
      cimdValidationResults,
      clientIdentityMappings,
      mcpClients,
      oauthAttempts,
      oauthClientRegistrations,
      validationSessions
    } = await import("../lib/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { POST: register } = await import("../app/register/route");
    const { GET: authorize } = await import("../app/authorize/route");
    const { POST: token } = await import("../app/token/route");
    const { POST: mcp } = await import("../app/mcp/route");
    const { getClientDetail, getClientsWithLatestSignals, getSessions } = await import("../lib/db/queries");
    const { oauthIdentityId } = await import("../lib/clients/identity");

    const registerClient = async (name: string, sessionId?: string) => {
      const suffix = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
      const response = await register(new Request(`${baseUrl}/register${suffix}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: name,
          redirect_uris: [callback],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          application_type: "native"
        })
      }) as never);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.match(String(payload.client_id), uuidClientId);
      return String(payload.client_id);
    };

    const sameName = await Promise.all([
      registerClient("Same Name Client"),
      registerClient("Same Name Client")
    ]);
    const similarName = await registerClient("Same Name Client Helper");
    const longName = await registerClient(`Long Name ${"x".repeat(600)}`);
    assert.equal(new Set([...sameName, similarName, longName]).size, 4, "every registration gets a new opaque client ID");
    const registrations = await db.select().from(oauthClientRegistrations);
    for (const id of [...sameName, similarName, longName]) {
      assert.equal(registrations.filter((row) => row.clientId === id).length, 1);
      assert.equal(id.slice(4).toLowerCase().includes("same-name"), false, "client IDs do not encode client names");
    }

    const dcrSessions = await Promise.all(sameName.map(async (clientId) => {
      const sessionId = crypto.randomUUID();
      const redirectUri = `${callback}?run=${sessionId}`;
      const authorization = await authorize(new Request(`${baseUrl}/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        session_id: sessionId,
        response_type: "code"
      })}`) as never);
      assert.equal(authorization.status, 302);
      const authorizationLocation = authorization.headers.get("location");
      assert.ok(authorizationLocation);
      const authorizationCode = new URL(authorizationLocation).searchParams.get("code");
      assert.ok(authorizationCode);
      const exchange = await token(new Request(`${baseUrl}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authorizationCode,
          client_id: clientId,
          redirect_uri: redirectUri
        })
      }) as never);
      assert.equal(exchange.status, 200);
      const tokenPayload = await exchange.json() as { session_id?: string; access_token?: string };
      assert.equal(tokenPayload.session_id, sessionId, "the authorization code correlates to its own session under concurrent exchanges");
      assert.ok(tokenPayload.access_token);
      return { sessionId, accessToken: tokenPayload.access_token };
    }));
    const sameTuple = await Promise.all([0, 1].map(async () => {
      const sessionId = crypto.randomUUID();
      const response = await authorize(new Request(`${baseUrl}/authorize?${new URLSearchParams({
        client_id: sameName[0], redirect_uri: callback, session_id: sessionId, response_type: "code"
      })}`) as never);
      assert.equal(response.status, 302);
      const code = new URL(response.headers.get("location")!).searchParams.get("code");
      assert.ok(code);
      return { sessionId, code };
    }));
    assert.notEqual(sameTuple[0].code, sameTuple[1].code);
    await Promise.all([...sameTuple].reverse().map(async ({ sessionId, code }) => {
      const response = await token(new Request(`${baseUrl}/token`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: sameName[0], redirect_uri: callback, code, grant_type: "authorization_code" })
      }) as never);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).session_id, sessionId,
        "authorization codes distinguish concurrent logins with the exact same issuer, client ID, and callback");
    }));
    const ambiguousLegacyToken = await token(new Request(`${baseUrl}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: sameName[0], redirect_uri: callback, code: "legacy-code", grant_type: "authorization_code" })
    }) as never);
    const ambiguousSession = (await ambiguousLegacyToken.json()).session_id;
    assert.ok(sameTuple.every(row => row.sessionId !== ambiguousSession),
      "legacy token correlation never guesses between multiple matching authorizations");
    const registeredClientCards = await getClientsWithLatestSignals();
    const sameNameCards = sameName.map((clientId) => registeredClientCards.find((card) =>
      card.identities?.some((identity: { clientId: string }) => identity.clientId === clientId)
    ));
    assert.ok(sameNameCards.every(Boolean));
    assert.notEqual(sameNameCards[0]?.id, sameNameCards[1]?.id, "same-name registrations remain separate client identities");
    const listedSessions = await getSessions();
    dcrSessions.forEach(({ sessionId }, index) => {
      assert.equal(listedSessions.find((session) => session.id === sessionId)?.clientKey, sameNameCards[index]?.id);
    });
    for (const [index, version] of ["2025-06-18", "2025-11-25"].entries()) {
      const response = await mcp(new Request(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${dcrSessions[index].accessToken}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: index + 1,
          method: "initialize",
          params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "Same Name Client", version: "regression" } }
        })
      }) as never);
      assert.equal(response.status, 200);
    }
    for (const [index, version] of ["2025-06-18", "2025-11-25"].entries()) {
      const detail = await getClientDetail(sameNameCards[index]!.id);
      assert.equal(detail?.highestObservedProtocol?.selectedVersion, version, "MCP history follows the OAuth identity tied to its bearer token");
    }

    const legacyId = "dcr-legacy-name";
    const now = new Date().toISOString();
    await db.insert(oauthClientRegistrations).values({
      clientId: legacyId,
      clientName: "Legacy DCR Client",
      redirectUrisJson: JSON.stringify([callback]),
      rawBodyJson: JSON.stringify({ client_name: "Legacy DCR Client", redirect_uris: [callback] }),
      lastSessionId: null,
      issuer: null,
      createdAt: now,
      updatedAt: now
    });
    const legacySession = crypto.randomUUID();
    const legacyResponse = await authorize(new Request(`${baseUrl}/authorize?${new URLSearchParams({
      client_id: legacyId,
      redirect_uri: callback,
      session_id: legacySession,
      response_type: "code"
    })}`) as never);
    assert.equal(legacyResponse.status, 302);
    const [legacyAttempt] = await db.select().from(oauthAttempts).where(and(
      eq(oauthAttempts.sessionId, legacySession),
      eq(oauthAttempts.clientId, legacyId)
    ));
    assert.equal(legacyAttempt?.classification, "dcr");
    assert.equal(legacyAttempt?.clientName, "Legacy DCR Client");

    const sharedSessionId = crypto.randomUUID();
    await registerClient("Unrelated Registration", sharedSessionId);
    const staticClientId = `unrelated-static-${crypto.randomUUID()}`;
    await authorize(new Request(`${baseUrl}/authorize?${new URLSearchParams({
      client_id: staticClientId,
      redirect_uri: callback,
      session_id: sharedSessionId,
      response_type: "code"
    })}`) as never);
    const [unrelatedStaticAttempt] = await db.select().from(oauthAttempts).where(and(
      eq(oauthAttempts.sessionId, sharedSessionId),
      eq(oauthAttempts.clientId, staticClientId)
    ));
    assert.equal(unrelatedStaticAttempt?.classification, "static", "a registration in the same session cannot relabel an unrelated client ID as DCR");

    const insertCimdIdentity = async (issuer: string, url: string, name: string, sessionId: string) => {
      const at = new Date(Date.now() + Math.random() * 1000).toISOString();
      await db.insert(validationSessions).values({ id: sessionId, label: name, createdAt: at });
      const attemptId = crypto.randomUUID();
      await db.insert(oauthAttempts).values({
        id: attemptId,
        sessionId,
        createdAt: at,
        path: "/authorize",
        method: "GET",
        clientId: url,
        redirectUri: callback,
        responseType: "code",
        scope: "cimd:read",
        state: null,
        resource: null,
        codeChallenge: null,
        codeChallengeMethod: null,
        userAgent: null,
        clientName: name,
        clientVersion: null,
        classification: "cimd",
        rawQueryJson: "{}",
        rawBodyJson: null,
        issuer
      });
      await db.insert(cimdValidationResults).values({
        id: crypto.randomUUID(),
        attemptId,
        metadataUrl: url,
        metadataFetchSuccess: 1,
        metadataHttpStatus: 200,
        metadataValid: 1,
        validationErrors: "[]",
        validationWarnings: "[]",
        rawMetadataJson: JSON.stringify({ client_id: url, client_name: name }),
        createdAt: at
      });
      await db.insert(oauthAttempts).values({
        id: crypto.randomUUID(),
        sessionId,
        createdAt: new Date(Date.parse(at) + 1000).toISOString(),
        path: "/token",
        method: "POST",
        clientId: url,
        redirectUri: callback,
        responseType: null,
        scope: "cimd:read",
        state: null,
        resource: null,
        codeChallenge: null,
        codeChallengeMethod: null,
        userAgent: null,
        clientName: name,
        clientVersion: null,
        classification: "cimd",
        rawQueryJson: "{}",
        rawBodyJson: null,
        issuer
      });
    };

    const sharedUrl = "https://identity.example/client.json";
    const secondUrl = "https://identity.example/other-client.json";
    const sessionA = crypto.randomUUID();
    const sessionB = crypto.randomUUID();
    const sessionC = crypto.randomUUID();
    await insertCimdIdentity("https://issuer-a.example", sharedUrl, "Shared Self Reported Name", sessionA);
    await insertCimdIdentity("https://issuer-b.example", sharedUrl, "Shared Self Reported Name", sessionB);
    await insertCimdIdentity("https://issuer-a.example", secondUrl, "Shared Self Reported Name", sessionC);
    const cards = await getClientsWithLatestSignals();
    const findIdentityCard = (issuer: string) => cards.find((card) =>
      card.identities?.some((identity: { issuer: string | null; clientId: string }) => (
        identity.issuer === issuer && identity.clientId === sharedUrl
      ))
    );
    const cardA = findIdentityCard("https://issuer-a.example");
    const cardB = findIdentityCard("https://issuer-b.example");
    const cardC = cards.find((card) => card.identities?.some((identity: { issuer: string | null; clientId: string }) => (
      identity.issuer === "https://issuer-a.example" && identity.clientId === secondUrl
    )));
    assert.ok(cardA, "issuer A exact URL identity is visible");
    assert.ok(cardB, "issuer B exact URL identity is visible");
    assert.ok(cardC, "a second exact URL with the same self-reported name remains visible");
    assert.notEqual(cardA.id, cardB.id, "the same URL under different issuers has separate ownership");
    assert.notEqual(cardA.id, cardC.id, "distinct URLs with the same self-reported name are not merged");
    assert.equal(cardA.attribution?.status, "unresolved");
    assert.equal(cardB.attribution?.status, "unresolved");
    assert.notEqual(cardA.identities[0].id, cardB.identities[0].id, "identity IDs are issuer scoped");
    assert.equal(cardA.identities[0].id, oauthIdentityId("https://issuer-a.example", sharedUrl));
    assert.equal(cardB.identities[0].id, oauthIdentityId("https://issuer-b.example", sharedUrl));

    const codexNow = new Date().toISOString();
    await db.insert(mcpClients).values({
      id: "codex-cli",
      name: "Codex CLI",
      category: "CLI",
      vendor: "OpenAI",
      supportStatus: "unknown",
      metadataUrl: null,
      sourceUrl: null,
      notes: null,
      createdAt: codexNow,
      updatedAt: codexNow
    });
    const proxySession = crypto.randomUUID();
    const proxyUrl = "https://proxy.example/client.json";
    await insertCimdIdentity("https://issuer-a.example", proxyUrl, "Acme Codex Proxy", proxySession);
    const afterProxy = await getClientsWithLatestSignals();
    const proxyCard = afterProxy.find((card) => card.identities?.some((identity: { clientId: string }) => identity.clientId === proxyUrl));
    const codexCard = afterProxy.find((card) => card.id === "codex-cli");
    assert.ok(proxyCard);
    assert.notEqual(proxyCard.id, "codex-cli", "a substring in a self-reported name does not bind a product");
    assert.equal(proxyCard.attribution?.status, "unresolved");
    assert.equal(codexCard?.identities?.some((identity: { clientId: string }) => identity.clientId === proxyUrl), false);

    const proxyDcrId = await registerClient("Acme Codex Proxy");
    const proxyDcrSession = crypto.randomUUID();
    const proxyRedirect = `${callback}?proxy=${proxyDcrSession}`;
    const proxyAuthorization = await authorize(new Request(`${baseUrl}/authorize?${new URLSearchParams({
      client_id: proxyDcrId, redirect_uri: proxyRedirect, session_id: proxyDcrSession, response_type: "code"
    })}`) as never);
    const proxyCode = new URL(proxyAuthorization.headers.get("location")!).searchParams.get("code")!;
    const proxyTokenResponse = await token(new Request(`${baseUrl}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: proxyCode, client_id: proxyDcrId, redirect_uri: proxyRedirect })
    }) as never);
    const proxyToken = await proxyTokenResponse.json() as { access_token: string; session_id: string };
    assert.equal(proxyToken.session_id, proxyDcrSession);
    const proxyMcp = await mcp(new Request(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${proxyToken.access_token}` },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 3, method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Codex CLI", version: "misleading" } }
      })
    }) as never);
    assert.equal(proxyMcp.status, 200);
    const dcrProxyCard = (await getClientsWithLatestSignals()).find((card) =>
      card.identities?.some((identity: { clientId: string }) => identity.clientId === proxyDcrId)
    );
    assert.ok(dcrProxyCard);
    assert.equal(dcrProxyCard.attribution?.status, "unresolved");
    assert.equal((await getClientDetail("codex-cli"))?.highestObservedProtocol, null, "MCP clientInfo cannot override the bearer token's OAuth identity");
    assert.equal((await getClientDetail(dcrProxyCard.id))?.highestObservedProtocol?.selectedVersion, "2025-11-25");

    for (const [sessionId, expectedCard, expectedUrl] of [
      [sessionA, cardA, sharedUrl],
      [sessionB, cardB, sharedUrl],
      [sessionC, cardC, secondUrl]
    ] as const) {
      const detail = await getClientDetail(expectedCard.id);
      assert.equal(detail?.identities?.some((identity: { clientId: string }) => identity.clientId === expectedUrl), true);
      const session = (await getSessions()).find((row) => row.id === sessionId);
      assert.ok(session);
      assert.equal(session.clientKey, expectedCard.id);
      assert.deepEqual(session.identities?.map((identity: { id: string }) => identity.id), expectedCard.identities.map((identity: { id: string }) => identity.id));
      assert.deepEqual(session.attribution, expectedCard.attribution);
    }

    const productId = "identity-bound-product";
    const mappingTime = new Date().toISOString();
    await db.insert(mcpClients).values({
      id: productId, name: "Identity Bound Product", supportStatus: "unknown",
      createdAt: mappingTime, updatedAt: mappingTime
    });
    await db.insert(clientIdentityMappings).values([
      { identityId: cardA.identities[0].id, productId, createdAt: mappingTime },
      { identityId: cardB.identities[0].id, productId, createdAt: mappingTime }
    ]);
    let mappedCards = await getClientsWithLatestSignals();
    let mappedProduct = mappedCards.find((card) => card.id === productId);
    assert.equal(mappedProduct?.attribution?.status, "mapped");
    assert.deepEqual(mappedProduct?.identities?.map((identity: { id: string }) => identity.id).sort(), [
      cardA.identities[0].id, cardB.identities[0].id
    ].sort());
    for (const [sessionId, identityId] of [[sessionA, cardA.identities[0].id], [sessionB, cardB.identities[0].id]] as const) {
      const session = (await getSessions()).find((row) => row.id === sessionId);
      assert.equal(session?.clientKey, productId);
      assert.deepEqual(session?.identities?.map((identity: { id: string }) => identity.id), [identityId], "session ownership includes only identities observed in that session");
    }

    await db.update(mcpClients).set({ isHidden: 1, hiddenReason: "identity regression" }).where(eq(mcpClients.id, productId));
    assert.equal((await getClientsWithLatestSignals()).some((card) => card.id === productId), false);
    assert.equal(await getClientDetail(productId), null);
    const hiddenProductSessions = await getSessions();
    assert.ok(hiddenProductSessions.some((session) => session.id === sessionA));
    assert.ok(hiddenProductSessions.some((session) => session.id === sessionB));
    await db.update(mcpClients).set({ isHidden: 0, hiddenReason: null }).where(eq(mcpClients.id, productId));

    await db.delete(clientIdentityMappings).where(eq(clientIdentityMappings.identityId, cardB.identities[0].id));
    mappedCards = await getClientsWithLatestSignals();
    mappedProduct = mappedCards.find((card) => card.id === productId);
    const unboundCard = mappedCards.find((card) => card.identities?.some((identity: { id: string }) => identity.id === cardB.identities[0].id));
    assert.deepEqual(mappedProduct?.identities?.map((identity: { id: string }) => identity.id), [cardA.identities[0].id]);
    assert.equal(unboundCard?.attribution?.status, "unresolved");
    assert.notEqual(unboundCard?.id, productId);
    assert.equal((await getSessions()).find((session) => session.id === sessionA)?.clientKey, productId);
    assert.equal((await getSessions()).find((session) => session.id === sessionB)?.clientKey, unboundCard?.id);

    const duplicateMetadataUrl = "https://duplicate-config.example/client.json";
    await db.insert(mcpClients).values([
      { id: "duplicate-config-one", name: "Duplicate Config One", supportStatus: "unknown", metadataUrl: duplicateMetadataUrl, createdAt: mappingTime, updatedAt: mappingTime },
      { id: "duplicate-config-two", name: "Duplicate Config Two", supportStatus: "unknown", metadataUrl: duplicateMetadataUrl, createdAt: mappingTime, updatedAt: mappingTime }
    ]);
    const duplicateMetadataSession = crypto.randomUUID();
    await insertCimdIdentity("https://issuer-a.example", duplicateMetadataUrl, "Duplicate Config Name", duplicateMetadataSession);
    const duplicateCards = await getClientsWithLatestSignals();
    const duplicateIdentity = duplicateCards.find((card) => card.identities?.some((identity: { clientId: string }) => identity.clientId === duplicateMetadataUrl));
    assert.ok(duplicateIdentity);
    assert.equal(duplicateIdentity.attribution?.status, "unresolved", "duplicate configured URLs require an explicit mapping");
    assert.notEqual(duplicateIdentity.id, "duplicate-config-one");
    assert.notEqual(duplicateIdentity.id, "duplicate-config-two");
    assert.deepEqual(await getClientDetail("duplicate-config-one").then((detail) => detail?.identities), []);
    assert.deepEqual(await getClientDetail("duplicate-config-two").then((detail) => detail?.identities), []);

    console.log("Identity regression passed: opaque DCR IDs, migration replay, issuer scoping, explicit binding/visibility, unresolved self-reported names, and shared card/detail/session ownership.");
  } finally {
    closeDatabase?.();
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
