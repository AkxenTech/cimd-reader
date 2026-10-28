import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import https from "node:https";
import type { IncomingMessage, ClientRequest } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { mock } from "node:test";

const metadataUrl = "https://cimd.example/client.json";
const callback = "http://127.0.0.1:8765/callback";
const validDocument = (url = metadataUrl, name = "Regression Client") => ({
  client_id: url, client_name: name, redirect_uris: [callback],
  token_endpoint_auth_method: "none", application_type: "native"
});
type Fixture = { status?: number; headers?: Record<string, string>; body?: string; error?: string; stall?: boolean; streamStall?: boolean };
let fixture: (url: string) => Fixture;
let resolve: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
let requests: Array<{ url: string; headers: unknown; options?: https.RequestOptions }> = [];
let dnsCalls: string[] = [];
const failures: string[] = [];
let passed = 0;

function reset() {
  fixture = () => ({ body: JSON.stringify(validDocument()) });
  resolve = async () => [{ address: "93.184.216.34", family: 4 }];
  requests = [];
  dnsCalls = [];
}

async function check(name: string, run: () => unknown | Promise<unknown>) {
  reset();
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

function installNetworkFixtures() {
  mock.method(dns, "lookup", async (hostname: string) => {
    dnsCalls.push(hostname);
    return resolve(hostname);
  });
  syncBuiltinESMExports();
  // No unexpected dependency may perform real network I/O in this suite.
  mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected fetch: CIMD must use the vetted HTTPS connection");
  });
  mock.method(https, "request", ((url: URL, options: https.RequestOptions, receive: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as ClientRequest;
    let response: PassThrough | undefined;
    request.destroy = ((error?: Error) => {
      if (error) queueMicrotask(() => request.emit("error", error));
      response?.destroy(error);
      return request;
    }) as typeof request.destroy;
    request.end = (() => {
      queueMicrotask(() => {
        requests.push({ url: String(url), headers: options.headers, options });
        const value = fixture(String(url));
        if (value.error) { request.emit("error", new Error(value.error)); return; }
        if (value.stall) return;
        response = new PassThrough();
        Object.assign(response, { statusCode: value.status ?? 200, headers: { "content-type": "application/json", ...value.headers } });
        receive(response as unknown as IncomingMessage);
        if (!value.streamStall) response.end(value.body ?? "");
      });
      return request;
    }) as typeof request.end;
    options.signal?.addEventListener("abort", () => request.destroy(new Error("metadata request timed out")), { once: true });
    return request;
  }) as typeof https.request);
}

async function main() {
  const directory = mkdtempSync(join(tmpdir(), "cimd-regression-"));
  process.env.TURSO_DATABASE_URL = `file:${join(directory, "test.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
  execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: process.env });
  installNetworkFixtures();
  const { validateCimdDocument } = await import("../lib/oauth/cimd-validator");
  const { classifyAuthorizeRequest } = await import("../lib/oauth/classify");
  const { db, client } = await import("../lib/db");
  const { cimdValidationResults, oauthAttempts, mcpClients } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { GET: authorize } = await import("../app/authorize/route");
  const { POST: token } = await import("../app/token/route");
  const { POST: register } = await import("../app/register/route");
  const { POST: mcp } = await import("../app/mcp/route");
  const { GET: clientsApi } = await import("../app/api/clients/route");
  const { getClientsWithLatestSignals, getClientDetail, getSessionTimeline } = await import("../lib/db/queries");
  const { authorizationServerMetadata } = await import("../lib/oauth/base-url");
  const validate = () => validateCimdDocument(metadataUrl, callback);
  const invalid = async (document: unknown, pattern: RegExp) => {
    fixture = () => ({ body: JSON.stringify(document) });
    const result = await validate();
    assert.equal(result.metadataFetchSuccess, true);
    assert.equal(result.metadataHttpStatus, 200);
    assert.equal(result.metadataValid, false);
    assert.match(result.validationErrors.join("; "), pattern);
  };

  try {
    await check("discovery advertises CIMD", () => assert.equal(authorizationServerMetadata("https://server.example").client_id_metadata_document_supported, true));
    for (const [id, dcr, expected] of [[metadataUrl, true, "cimd"], ["opaque-id", false, "static"], ["dcr-client", false, "dcr"], ["opaque-id", true, "dcr"], ["http://client.example/id", false, "unknown"], [null, false, "unknown"]] as const) {
      await check(`classification ${id} / DCR=${dcr}`, () => assert.equal(classifyAuthorizeRequest(id, dcr), expected));
    }
    await check("valid document and OAuth defaults", async () => {
      const result = await validate();
      assert.equal(result.metadataValid, true, result.validationErrors.join("; "));
      assert.deepEqual(result.validationErrors, []);
      assert.ok(result.validationWarnings.some((value) => value.includes("client_uri")));
    });
    for (const [field, value, pattern] of [
      ["client_id", undefined, /client_id/], ["client_id", "https://different.example/id", /does not match/],
      ["client_id", 42, /client_id/], ["client_name", undefined, /client_name/], ["client_name", 42, /client_name/], ["client_name", "  ", /client_name/],
      ["redirect_uris", undefined, /redirect_uris/], ["redirect_uris", [], /redirect/], ["redirect_uris", [42], /redirect_uris/],
      ["response_types", "code", /response_types/], ["response_types", [], /include code/],
      ["grant_types", null, /grant_types/], ["grant_types", ["client_credentials"], /authorization_code/],
      ["token_endpoint_auth_method", "client_secret_basic", /token_endpoint_auth_method/],
      ["client_secret", "must-not-be-published", /client_secret/],
      ["client_secret_expires_at", 123, /client_secret_expires_at/],
      ["jwks", { keys: [{ kty: "RSA", d: "private" }] }, /private/],
      ["jwks", { keys: [{ kty: "oct", k: "symmetric" }] }, /symmetric/]
    ] as const) {
      await check(`invalid ${field}=${JSON.stringify(value)}`, () => invalid({ ...validDocument(), [field]: value }, pattern));
    }
    for (const value of [null, [], "text", 42, true]) {
      await check(`non-object JSON ${JSON.stringify(value)} preserves fetch evidence`, () => invalid(value, /object/));
    }
    await check("malformed JSON preserves fetched body", async () => {
      fixture = () => ({ body: "{broken" });
      const result = await validate();
      assert.equal(result.metadataFetchSuccess, true);
      assert.equal(result.rawMetadataJson, "{broken");
      assert.match(result.validationErrors.join("; "), /not valid JSON/);
    });
    await check("client_id is compared without URL normalization", () => invalid({ ...validDocument(), client_id: "https://cimd.example:443/client.json" }, /does not match/));
    await check("explicit grant and response types", async () => {
      fixture = () => ({ body: JSON.stringify({ ...validDocument(), response_types: ["code"], grant_types: ["authorization_code", "refresh_token"] }) });
      assert.equal((await validate()).metadataValid, true);
    });
    for (const [registered, requested, expected] of [
      [callback, callback, true], [callback, "http://127.0.0.1:9999/callback", false],
      ["http://127.0.0.1:80/callback", "http://127.0.0.1:9999/callback", false],
      ["https://localhost/callback", "https://localhost:9999/callback", false],
      ["http://127.0.0.1/callback", "http://127.0.0.1:9999/callback", true],
      ["http://[::1]/callback", "http://[::1]:9999/callback", true],
      ["http://localhost/callback", "http://127.0.0.1:9999/callback", true],
      ["http://127.0.0.1/callback", "http://127.0.0.1:9999/other", false],
      ["http://127.0.0.1/callback?x=1", "http://127.0.0.1:9999/callback?x=2", false],
      ["http://127.0.0.1/callback", "http://attacker.example/callback", false],
      ["https://client.example/callback", "https://client.example:444/callback", false],
      ["https://client.example/callback", "https://client.example/callback/", false],
      ["native-app:/callback", "native-app:/callback", true],
      ["http://127.0.0.1/callback", "http://user:password@127.0.0.1:9999/callback", false],
      ["not-a-url", "not-a-url", false], ["https://client.example/cb#fragment", "https://client.example/cb#fragment", false]
    ] as const) {
      await check(`redirect ${registered} -> ${requested}`, async () => {
        fixture = () => ({ body: JSON.stringify({ ...validDocument(), redirect_uris: [registered] }) });
        assert.equal((await validateCimdDocument(metadataUrl, requested)).metadataValid, expected);
      });
    }
    for (const url of ["not-a-url", "http://cimd.example/client.json", "https://u:p@cimd.example/client.json", "https://localhost/id", "https://a.localhost/id", "https://localhost./id", "https://metadata.google.internal/id", "https://127.1/id", "https://2130706433/id", "https://0x7f000001/id", "https://10.0.0.1/id", "https://169.254.169.254/id", "https://172.16.0.1/id", "https://192.168.1.1/id", "https://100.64.0.1/id", "https://224.0.0.1/id", "https://[::1]/id", "https://[::ffff:127.0.0.1]/id", "https://[ff02::1]/id", "https://cimd.example", "https://cimd.example/client.json#fragment", "https://cimd.example/a/../client.json"]) {
      await check(`blocks unsafe client_id ${url}`, async () => {
        fixture = () => ({ body: JSON.stringify(validDocument(url)) });
        const result = await validateCimdDocument(url, callback);
        assert.equal(result.metadataValid, false);
        assert.equal(requests.length, 0, "Unsafe URLs must be rejected before connecting");
      });
    }
    for (const address of ["127.0.0.1", "10.1.2.3", "169.254.1.2", "172.31.0.1", "192.168.0.1", "100.127.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1", "192.0.2.1", "198.18.0.1", "2001:db8::1"]) {
      await check(`blocks DNS answer ${address}`, async () => {
        resolve = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
        assert.equal((await validate()).metadataValid, false);
        assert.equal(requests.length, 0);
      });
    }
    await check("mixed public/private DNS answers rejected", async () => {
      resolve = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }];
      assert.equal((await validate()).metadataValid, false);
      assert.equal(requests.length, 0);
    });
    await check("DNS failures and empty answers", async () => {
      resolve = async () => { throw new Error("ENOTFOUND"); };
      assert.equal((await validate()).metadataFetchSuccess, false);
      resolve = async () => [];
      assert.equal((await validate()).metadataValid, false);
      assert.equal(requests.length, 0);
    });
    await check("public IPv6 literal needs no DNS lookup", async () => {
      const url = "https://[2606:4700:4700::1111]/client.json";
      fixture = () => ({ body: JSON.stringify(validDocument(url)) });
      assert.equal((await validateCimdDocument(url, callback)).metadataValid, true);
      assert.equal(dnsCalls.length, 0);
    });
    await check("connection uses vetted DNS address and preserves TLS verification", async () => {
      resolve = async () => dnsCalls.length === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
      assert.equal((await validate()).metadataValid, true);
      const options = requests[0].options;
      assert.ok(options?.lookup, "Connection must use a pinned lookup instead of resolving the hostname again");
      const address = await new Promise<string>((done, reject) => {
        (options.lookup as Function)("cimd.example", {}, (error: Error | null, ip: string) => error ? reject(error) : done(ip));
      });
      assert.equal(address, "93.184.216.34");
      assert.equal(dnsCalls.length, 1);
      assert.notEqual(options.rejectUnauthorized, false);
      assert.equal(new URL(requests[0].url).hostname, "cimd.example");
      assert.equal(options.agent, false, "No connection reuse may bypass the vetted address");
      assert.deepEqual(options.headers, { accept: "application/json" });
    });
    for (const status of [201, 204, 301, 302, 303, 307, 308, 400, 404, 500]) {
      await check(`HTTP ${status} is invalid and never followed`, async () => {
        fixture = () => ({ status, headers: { location: "https://other.example/client.json" }, body: status === 204 ? undefined : JSON.stringify(validDocument()) });
        const result = await validate();
        assert.equal(result.metadataValid, false);
        assert.equal(result.metadataHttpStatus, status);
        assert.equal(requests.length, 1);
      });
    }
    await check("network/TLS error is captured", async () => {
      fixture = () => ({ error: "certificate has expired" });
      assert.match((await validate()).validationErrors.join("; "), /certificate/);
    });
    await check("response body byte limit", async () => {
      fixture = () => ({ body: "é".repeat(140 * 1024) });
      assert.match((await validate()).validationErrors.join("; "), /size limit/);
    });
    await check("response at the byte limit is accepted", async () => {
      const body = JSON.stringify(validDocument());
      fixture = () => ({ body: body + " ".repeat(256 * 1024 - Buffer.byteLength(body)) });
      assert.equal((await validate()).metadataValid, true);
    });
    for (const stage of ["dns", "headers", "body"] as const) {
      await check(`timeout covers ${stage}`, async () => {
        const timer = globalThis.setTimeout;
        const timerMock = mock.method(globalThis, "setTimeout", ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => timer(fn, delay === 5000 ? 10 : delay, ...args)) as typeof setTimeout);
        try {
          if (stage === "dns") resolve = async () => new Promise(() => {});
          else fixture = () => stage === "headers" ? { stall: true } : { streamStall: true };
          const result = await Promise.race([validate(), new Promise<never>((_, reject) => timer(() => reject(new Error("Validation failed to enforce its timeout")), 100))]);
          assert.equal(result.metadataValid, false);
          assert.match(result.validationErrors.join("; "), /timed out|abort/i);
        } finally { timerMock.mock.restore(); }
      });
    }

    async function authorizeFixture(url: string, name: string, valid = true) {
      fixture = () => ({ body: JSON.stringify({ ...validDocument(url, name), ...(valid ? {} : { client_id: "https://wrong.example/id" }) }) });
      const session = crypto.randomUUID();
      const response = await authorize(new Request(`http://localhost:3000/authorize?${new URLSearchParams({
        client_id: url, redirect_uri: callback, session_id: session, state: "regression-state", response_type: "code", code_challenge: "challenge", code_challenge_method: "S256"
      })}`) as never);
      return { session, response };
    }
    async function exchange(url: string) {
      return token(new Request("http://localhost:3000/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: url, redirect_uri: callback, grant_type: "authorization_code", code: "test-authorization-code" })
      }) as never);
    }
    await check("valid CIMD authorize -> token -> API/card/detail -> MCP history", async () => {
      const url = "https://cimd.example/complete.json";
      const { session, response } = await authorizeFixture(url, "CIMD Regression Complete");
      assert.equal(response.status, 302);
      const location = new URL(response.headers.get("location")!);
      assert.equal(location.searchParams.get("state"), "regression-state");
      assert.equal(location.searchParams.get("session_id"), session);
      const [attempt] = await db.select().from(oauthAttempts).where(eq(oauthAttempts.sessionId, session));
      assert.equal(attempt.classification, "cimd");
      assert.equal(attempt.clientName, "CIMD Regression Complete");
      assert.equal(attempt.codeChallengeMethod, "S256");
      const [validation] = await db.select().from(cimdValidationResults).where(eq(cimdValidationResults.attemptId, attempt.id));
      assert.equal(validation.metadataValid, 1);
      assert.equal(validation.metadataFetchSuccess, 1);
      assert.equal(validation.metadataHttpStatus, 200);
      assert.ok(validation.rawMetadataJson?.includes(url));
      assert.equal((await getClientsWithLatestSignals()).some((item) => item.metadataUrl === url), false);
      const exchanged = await exchange(url);
      const tokenBody = await exchanged.json();
      assert.equal(tokenBody.session_id, session);
      assert.equal(exchanged.status, 200);
      const cards = await getClientsWithLatestSignals();
      const card = cards.find((item) => item.metadataUrl === url);
      assert.equal(card?.observedBehavior, "cimd");
      assert.ok(card);
      const detail = await getClientDetail(card.id);
      assert.equal(detail?.latestValidation?.metadataValid, 1);
      const timeline = await getSessionTimeline(session);
      assert.deepEqual(timeline?.attempts.map((item) => item.path), ["/authorize", "/token"]);
      assert.equal(timeline?.results[0].metadataValid, 1);
      const api = await (await clientsApi()).json();
      assert.equal(api.clients.find((item: { id: string }) => item.id === card.id).observedBehavior, "cimd");
      const mcpResponse = await mcp(new Request("http://localhost:3000/mcp", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokenBody.access_token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", clientInfo: { name: "CIMD Regression Complete", version: "1.0" }, capabilities: {} } })
      }) as never);
      assert.equal(mcpResponse.status, 200);
      const after = await getClientDetail(card.id);
      assert.equal(after?.observedBehavior, "cimd");
      assert.equal(after?.highestObservedProtocol?.selectedVersion, "2025-11-25");
      assert.equal(after?.latestValidation?.id, validation.id);
    });
    await check("invalid CIMD remains visible as failed identity evidence after token", async () => {
      const url = "https://cimd.example/invalid.json";
      const { session } = await authorizeFixture(url, "CIMD Regression Invalid", false);
      await exchange(url);
      const timeline = await getSessionTimeline(session);
      assert.equal(timeline?.results[0].metadataValid, 0);
      assert.match(timeline?.results[0].validationErrors ?? "", /does not match/);
      const failedIdentity = (await getClientsWithLatestSignals()).find((item) => item.metadataUrl === url);
      assert.equal(failedIdentity?.observedBehavior, "failed");
      assert.equal(failedIdentity?.attribution?.status, "unresolved");
      assert.equal(failedIdentity?.latestValidation?.metadataValid, 0);
    });
    await check("latest failed revalidation is separate from historical CIMD success", async () => {
      const url = "https://cimd.example/complete.json";
      await authorizeFixture(url, "CIMD Regression Complete", false);
      await exchange(url);
      const card = (await getClientsWithLatestSignals()).find((item) => item.metadataUrl === url);
      assert.equal(card?.latestValidation?.metadataValid, 0);
      assert.equal(card?.latestSuccessfulCimdValidation?.metadataValid, 1);
      assert.equal(card?.observedBehavior, "failed");
      const detail = card ? await getClientDetail(card.id) : null;
      assert.equal(detail?.latestValidation?.metadataValid, 0);
      assert.equal(detail?.latestSuccessfulCimdValidation?.metadataValid, 1);
    });
    await check("hosted connectors remain distinct OAuth clients", async () => {
      for (const id of ["regression-one", "regression-two"]) {
        const url = `https://connect.vercel.com/connectors/${id}`;
        await authorizeFixture(url, "Hosted Regression Client");
        await exchange(url);
      }
      const cards = await getClientsWithLatestSignals();
      const connectorCards = [];
      for (const id of ["regression-one", "regression-two"]) {
        const url = `https://connect.vercel.com/connectors/${id}`;
        const card = cards.find((item) => item.identities?.some((identity: { clientId: string }) => identity.clientId === url));
        connectorCards.push(card);
        assert.equal(card?.observedBehavior, "cimd");
        assert.equal(card?.attribution?.status, "unresolved");
        assert.equal(card?.identities?.[0]?.clientId, url);
        assert.equal(card?.latestValidation?.metadataUrl, card?.metadataUrl);
        assert.equal(card?.latestCimdAttempt?.clientId, url);
        const detail = card ? await getClientDetail(card.id) : null;
        assert.equal(detail?.latestValidation?.metadataUrl, url);
      }
      assert.notEqual(connectorCards[0]?.id, connectorCards[1]?.id, "shared reported names do not merge connector URLs");
    });
    await check("DCR identity never inherits v0 metadata or a name-derived product through the API", async () => {
      const v0Url = "https://v0.app/api/chat/integrations/oauth/client-metadata.json";
      await authorizeFixture(v0Url, "v0");
      await exchange(v0Url);
      const registered = await register(new Request("http://localhost:3000/register", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "pi", redirect_uris: [callback], token_endpoint_auth_method: "none" })
      }) as never);
      const registration = await registered.json();
      const dcrClientId = String(registration.client_id);
      assert.match(dcrClientId, /^dcr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      for (let connection = 0; connection < 2; connection += 1) {
        const session = crypto.randomUUID();
        await authorize(new Request(`http://localhost:3000/authorize?${new URLSearchParams({
          client_id: dcrClientId, redirect_uri: callback, session_id: session
        })}`) as never);
        await exchange(dcrClientId);
      }
      const cards = await getClientsWithLatestSignals();
      const pi = cards.find((item) => item.identities?.some((identity: { clientId: string }) => identity.clientId === dcrClientId));
      const v0 = cards.find((item) => item.id === "v0");
      assert.ok(pi);
      assert.equal(pi.observedBehavior, "dcr");
      assert.equal(pi.attribution?.status, "unresolved");
      assert.equal(pi.metadataUrl, null);
      assert.equal(pi.sourceUrl, null);
      assert.equal(pi.latestCimdAttempt, null);
      assert.equal(pi.latestValidation, null);
      assert.equal(pi.statusAttempt?.clientId, dcrClientId);
      assert.ok(!pi.observedEvidence.includes(v0Url));
      assert.equal(v0?.observedBehavior, "cimd");
      assert.equal(v0?.latestValidation?.metadataUrl, v0Url);
      const detail = await getClientDetail(pi.id);
      assert.equal(detail?.observedBehavior, "dcr");
      assert.equal(detail?.latestValidation, null);
      const api = await (await clientsApi()).json();
      const apiPi = api.clients.find((item: { id: string }) => item.id === pi.id);
      assert.equal(apiPi.observedBehavior, "dcr");
      assert.equal(apiPi.latestValidation, null);
    });
    await check("self-reported metadata names alone do not bind curated products", async () => {
      const now = new Date().toISOString();
      for (const [id, name, metadataName] of [
        ["codex-cli", "Codex CLI", "Codex"],
        ["visual-studio-code", "Visual Studio Code", "Visual Studio Code"],
        ["mcpjam", "MCPJam", "MCPJam Inspector"],
        ["claude-code", "Claude Code", "Claude Code"]
      ] as const) {
        await db.insert(mcpClients).values({ id, name, supportStatus: "unknown", createdAt: now, updatedAt: now });
        const url = `https://clients.example/${id}/metadata.json`;
        await authorizeFixture(url, metadataName);
        await exchange(url);
        const identity = (await getClientsWithLatestSignals()).find((item) => item.identities?.some((row: { clientId: string }) => row.clientId === url));
        assert.ok(identity, name);
        assert.equal(identity.attribution?.status, "unresolved", name);
        assert.notEqual(identity.id, id, "the test fixture should not be used as the identity card key");
        const detail = await getClientDetail(id);
        assert.equal(detail?.latestValidation, null, name);
      }
    });
    await check("a vendor name cannot attribute another client's metadata", async () => {
      const now = new Date().toISOString();
      for (const id of ["vendor-one", "vendor-two"]) {
        await db.insert(mcpClients).values({ id, name: id, vendor: "Shared Vendor", supportStatus: "unknown", createdAt: now, updatedAt: now });
      }
      const url = "https://vendor.example/client.json";
      await authorizeFixture(url, "Shared Vendor");
      await exchange(url);
      const cards = await getClientsWithLatestSignals();
      for (const id of ["vendor-one", "vendor-two"]) {
        assert.equal(cards.find((item) => item.id === id)?.latestValidation, null);
      }
      const unresolvedIdentity = cards.find((item) => item.identities?.some((identity: { clientId: string }) => identity.clientId === url));
      assert.equal(unresolvedIdentity?.attribution?.status, "unresolved");
    });
    for (const failure of ["dns", "malformed", "null-json", "ssrf"] as const) {
      await check(`authorization persists ${failure} failure without crashing`, async () => {
        const url = failure === "ssrf" ? "https://127.0.0.1/client.json" : `https://cimd.example/${failure}.json`;
        if (failure === "dns") resolve = async () => { throw new Error("ENOTFOUND"); };
        fixture = () => ({ body: failure === "null-json" ? "null" : "{broken" });
        const session = crypto.randomUUID();
        const response = await authorize(new Request(`http://localhost:3000/authorize?${new URLSearchParams({
          client_id: url, session_id: session, redirect_uri: callback
        })}`) as never);
        // This is a diagnostic OAuth stub: failure evidence is retained even
        // though its intentionally fake authorization flow continues.
        assert.equal(response.status, 302);
        await exchange(url);
        const timeline = await getSessionTimeline(session);
        assert.equal(timeline?.results.length, 1);
        assert.equal(timeline?.results[0].metadataValid, 0);
        assert.ok(JSON.parse(timeline!.results[0].validationErrors!).length > 0);
        const identity = (await getClientsWithLatestSignals()).find((item) => item.identities?.some((row: { clientId: string }) => row.clientId === url));
        assert.equal(identity?.observedBehavior, "failed");
        assert.equal(identity?.latestValidation?.metadataValid, 0);
      });
    }
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    client.close();
    rmSync(directory, { recursive: true, force: true });
  }
  console.log(`\nCIMD regression: ${passed} passed, ${failures.length} failed.`);
  if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
