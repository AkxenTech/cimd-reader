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

The authorization server advertises CIMD support. `/authorize` logs the request, classifies the client behavior, validates HTTPS URL `client_id` values as CIMD metadata documents, stores the result, then redirects to `redirect_uri` with a fake authorization code. `/token` returns a fake bearer token. `/register` logs DCR attempts and returns a fake client registration.

## Dashboard

- `/` shows MCP client cards with claimed support, observed behavior, and latest CIMD validation.
- `/clients/[id]` shows known metadata, latest OAuth attempt, raw metadata JSON, validation errors, and warnings.
- `/sessions` lists validation sessions.
- `/sessions/[id]` shows an OAuth request timeline.
- `/api/clients` returns client data as JSON.
- `/api/sessions` returns session data as JSON.

## SSRF Protections

The CIMD metadata fetcher:

- Requires HTTPS.
- Rejects localhost hostnames.
- Rejects private, loopback, link-local, carrier-grade NAT, multicast, and metadata IP ranges.
- Resolves hostnames and blocks unsafe DNS results.
- Limits redirects.
- Uses a request timeout.
- Caps response body size.
- Sends no credentials or cookies.
- Parses and validates JSON only after the fetch checks pass.

## Seed Data

The seed script creates cards for:

- Visual Studio Code, marked verified with `https://vscode.dev/oauth/client-metadata.json`.
- Claude Code.
- MCPJam.
- Cursor.
- Codex CLI.
- GitHub Copilot.
- Windsurf.

It also creates a seeded VS Code CIMD validation pass so the dashboard has one complete example before live traffic is captured.
