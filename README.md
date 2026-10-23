# CIMD Validator

A Next.js App Router application for validating whether MCP OAuth clients use Client ID Metadata Documents (CIMD), fall back to Dynamic Client Registration (DCR), or send static client IDs.

## Stack

- Next.js App Router and Vercel route handlers
- TypeScript
- Tailwind CSS
- Turso/libSQL
- Drizzle ORM

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create local environment variables:

```bash
cp .env.example .env.local
```

3. Create and seed the local libSQL database:

```bash
npm run db:setup
```

4. Run the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Turso Setup

Create a Turso database and set these variables locally and in Vercel:

```bash
TURSO_DATABASE_URL=libsql://YOUR_DATABASE.turso.io
TURSO_AUTH_TOKEN=YOUR_TURSO_TOKEN
NEXT_PUBLIC_BASE_URL=https://YOUR_DOMAIN
```

Then run:

```bash
npm run db:migrate
npm run db:seed
```

For Vercel, add the same environment variables in the project settings before deploying.

## OAuth Test Endpoints

- `/.well-known/oauth-authorization-server`
- `/authorize`
- `/token`
- `/register`
- `/mcp`

## MCP Client Setup

Add this Streamable HTTP MCP server URL to the client being tested:

```text
https://cimd-reader.akxen.tech/mcp
```

Codex CLI:

```bash
codex mcp add cimd_reader \
  --url https://cimd-reader.akxen.tech/mcp \
  --oauth-resource https://cimd-reader.akxen.tech/mcp

codex mcp login cimd_reader
```

Claude Code:

```bash
claude mcp add --transport http \
  cimd_reader \
  https://cimd-reader.akxen.tech/mcp
```

VS Code `mcp.json`:

```json
{
  "servers": {
    "cimd_reader": {
      "type": "http",
      "url": "https://cimd-reader.akxen.tech/mcp",
      "oauth": {
        "clientId": "https://vscode.dev/oauth/client-metadata.json"
      }
    }
  }
}
```

The authorization server advertises CIMD support. `/authorize` logs the request, classifies the client behavior, validates HTTPS URL `client_id` values as CIMD metadata documents, stores the result, then redirects to `redirect_uri` with a fake authorization code. `/token` returns a fake bearer token. `/register` logs DCR attempts and returns a fake client registration.

## Dashboard

- `/` shows MCP client cards with claimed support, observed behavior, and latest CIMD validation.
- `/clients/[id]` shows known metadata, latest OAuth attempt, raw metadata JSON, validation errors, and warnings.
- `/sessions` lists validation sessions.
- `/sessions/[id]` shows an OAuth request timeline.
- `/api/clients` returns client data as JSON.
- `/api/sessions` returns session data as JSON.
- `/protocols` lists unique MCP protocol observations across clients, newest protocol revision first, then most recently observed.
- `/api/protocols` returns the same history as JSON. Client cards and detail pages include matching protocol observations.

## MCP Protocol History

Run `npm run db:migrate` before serving the updated app locally. Vercel runs migrations before each build using the deployment's database credentials. Missing Vercel database configuration fails the build. Migration `0004` adds a persistent protocol observation table without modifying OAuth results.

Authenticated `/mcp` requests record legacy `initialize` exchanges, modern `server/discover` probes, and explicit per-request protocol versions. Each distinct reported client name, application release, identity source, negotiation phase, version evidence, outcome, and server-supported version set has one row. Repeated observations atomically increment a count and update first/last seen timestamps. Different releases and version outcomes remain separate, including failures.

The history distinguishes a successful initialization from a server counter-offer, discovery, an accepted request, and a rejected request. Legacy clients proposing an unsupported revision receive a supported legacy counter-offer. Modern requests with unsupported versions receive an error listing supported revisions. Counter-offers and discovery alone are not counted as evidence of client usage on dashboard cards.

Protocol acceptance and method outcomes are reported separately, including for historical observations. An unsupported method such as `resources/list` returns a JSON-RPC `-32601` error over HTTP 200, preserving the live session and the accepted protocol version. The server advertises tools; resources and prompts are optional capabilities that it does not advertise. HTTP 404 is reserved for missing/expired sessions rather than ordinary RPC method failures.

Identity comes from initialize `clientInfo`, modern `_meta` client information, or the user agent as a fallback. Unidentified traffic remains visible in the protocol history. Identity is self-reported: the shared diagnostic bearer token cannot associate MCP traffic with a particular OAuth session. This history records observed versions, not every version a client may support. Existing initialize logs did not retain server responses and are not backfilled as negotiated versions; new structured history starts after migration and deployment.

See the [modern versioning rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) and [legacy initialization rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

`npm run smoke:protocols` uses a temporary local database to verify negotiation, persistence, deduplication, ordering, and the history API.

## SSRF Protections

The CIMD metadata fetcher:

- Requires HTTPS and a path, and rejects credentials, fragments, and dot path segments.
- Rejects localhost hostnames.
- Rejects private, loopback, link-local, carrier-grade NAT, multicast, and metadata IP ranges.
- Resolves hostnames and blocks unsafe DNS results, including IPv4-mapped IPv6 and reserved ranges.
- Pins the connection to vetted DNS addresses while retaining hostname-based TLS verification.
- Rejects HTTP redirects without following them.
- Uses a five-second deadline across DNS, connection, and body reading.
- Caps response body size.
- Sends no credentials or cookies.
- Parses and validates JSON only after the fetch checks pass.

## CIMD Regression

Run `npm run test:cimd` for the isolated CIMD regression suite. It creates and removes a temporary database and intercepts DNS/HTTPS responses with deterministic fixtures; it never writes to the configured Turso database or contacts fixture hosts.

Coverage includes required fields and malformed JSON, exact client ID matching, OAuth defaults, native loopback and custom-scheme redirects, secret/private-key rejection, IPv4/IPv6 SSRF cases, DNS rebinding prevention, HTTP failures and redirects, byte limits, DNS/header/body timeouts, persisted validation results, token correlation, client cards/details/API, hosted connectors, and coexistence with protocol history. `npm run verify:local` also runs this suite.

The validator targets this diagnostic server's public/native authorization-code profile (`token_endpoint_auth_method: none`), not every possible OAuth grant or confidential-client authentication method. Metadata fetching follows the [CIMD discovery requirements](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-02#section-5). `/authorize` and `/token` remain diagnostic stubs: invalid CIMD evidence is logged and excluded from successful client promotion, while the fake authorization flow continues.

## Seed Data

The seed script creates placeholder cards for:

- Visual Studio Code.
- Claude Code.
- MCPJam.
- Cursor.
- Codex CLI.
- GitHub Copilot.
- Windsurf.
