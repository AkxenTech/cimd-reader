import Link from "next/link";
import { CheckCircle2, CircleHelp, CircleX, ExternalLink, RadioTower } from "lucide-react";

import { getClientsWithLatestSignals } from "@/lib/db/queries";
import { hostedClientPlatformFromSignal } from "@/lib/oauth/client-platform";
import { GITHUB_HANDLE, GITHUB_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

function parseRawMetadata(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function statusClasses(status: string) {
  switch (status) {
    case "cimd":
    case "verified":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "dcr":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "static":
      return "bg-orange-50 text-orange-800 ring-orange-200";
    case "failed":
      return "bg-red-50 text-red-700 ring-red-200";
    case "not_supported":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    default:
      return "bg-amber-50 text-amber-800 ring-amber-200";
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === "verified" || status === "cimd" || status === "dcr") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "failed" || status === "not_supported") return <CircleX className="h-4 w-4" />;
  return <CircleHelp className="h-4 w-4" />;
}

function ListValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <span className="wrap-anywhere">{value.join(", ")}</span>;
  if (typeof value === "string") return <span className="wrap-anywhere">{value}</span>;
  return <span className="text-slate-400">Not observed</span>;
}

export default async function DashboardPage() {
  const clients = await getClientsWithLatestSignals();

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <section className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">MCP OAuth diagnostics</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Observed MCP OAuth client behavior</h1>
          <p className="mt-3 max-w-3xl text-slate-600">
            See whether IDEs and developer tools use CIMD, fall back to Dynamic Client Registration, or send static client IDs during OAuth.
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-ink"
          >
            Built by @{GITHUB_HANDLE}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-slate-600">
          Authorization server: <code className="font-mono text-ink">/.well-known/oauth-authorization-server</code>
        </div>
      </section>

      <section className="mb-7 rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Test endpoint</h2>
            <p className="mt-1 text-sm text-slate-600">Add this Streamable HTTP MCP server URL to the client you want to test.</p>
          </div>
          <code className="break-all rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100">
            https://cimd-reader.akxen.tech/mcp
          </code>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Codex CLI</h3>
            <pre className="mt-3 overflow-auto rounded-md bg-white p-3 font-mono text-xs text-slate-800 ring-1 ring-line">{`codex mcp add cimd_reader \\
  --url https://cimd-reader.akxen.tech/mcp \\
  --oauth-resource https://cimd-reader.akxen.tech/mcp

codex mcp login cimd_reader`}</pre>
          </div>

          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Claude Code</h3>
            <pre className="mt-3 overflow-auto rounded-md bg-white p-3 font-mono text-xs text-slate-800 ring-1 ring-line">{`claude mcp add --transport http \\
  cimd_reader \\
  https://cimd-reader.akxen.tech/mcp

# then run /mcp in Claude Code`}</pre>
          </div>

          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">VS Code</h3>
            <pre className="mt-3 overflow-auto rounded-md bg-white p-3 font-mono text-xs text-slate-800 ring-1 ring-line">{`{
  "servers": {
    "cimd_reader": {
      "type": "http",
      "url": "https://cimd-reader.akxen.tech/mcp",
      "oauth": {
        "clientId": "https://vscode.dev/oauth/client-metadata.json"
      }
    }
  }
}`}</pre>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((client) => {
          const metadata = parseRawMetadata(client.latestValidation?.rawMetadataJson) ?? {};
          const displayName = typeof metadata.client_name === "string" ? metadata.client_name : client.name;
          const logo = typeof metadata.logo_uri === "string" ? metadata.logo_uri : null;
          const metadataUrl = client.metadataUrl ?? client.latestValidation?.metadataUrl ?? (client.latestAttempt?.classification === "cimd" ? client.latestAttempt.clientId : null);
          const platform = hostedClientPlatformFromSignal({
            metadataUrl,
            userAgent: client.latestAttempt?.userAgent
          });

          return (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="group flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"
            >
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-slate-50">
                    {logo ? <img src={logo} alt="" className="h-7 w-7 object-contain" /> : <RadioTower className="h-5 w-5 text-slate-500" />}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-ink">{client.name}</h2>
                    <p className="wrap-anywhere text-sm text-slate-500">
                      {client.category ?? "Tool"}
                      {platform ? <span> · {platform.name}</span> : null}
                    </p>
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses(client.observedBehavior)}`}>
                  <StatusIcon status={client.observedBehavior} />
                  {client.observedBehavior}
                </span>
              </div>

              <dl className="mt-5 grid gap-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Observed result</dt>
                  <dd className="wrap-anywhere mt-1 text-slate-800">{client.observedEvidence}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Latest user agent</dt>
                  <dd className="wrap-anywhere mt-1 font-mono text-xs text-slate-700">{client.latestAttempt?.userAgent ?? "Not observed"}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Latest event</dt>
                    <dd className="wrap-anywhere mt-1 text-slate-800">
                      {client.latestAttempt ? `${client.latestAttempt.method} ${client.latestAttempt.path}` : "Not observed"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Client version</dt>
                    <dd className="wrap-anywhere mt-1 text-slate-800">{client.latestAttempt?.clientVersion ?? "Unknown"}</dd>
                  </div>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Claimed status</dt>
                  <dd className="wrap-anywhere mt-1 text-slate-800">{client.supportStatus.replace("_", " ")}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Metadata name</dt>
                    <dd className="wrap-anywhere mt-1 text-slate-800">{displayName}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Observed behavior</dt>
                    <dd className="wrap-anywhere mt-1 text-slate-800">{client.observedBehavior}</dd>
                  </div>
                </div>
                {platform ? (
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Host platform</dt>
                    <dd className="wrap-anywhere mt-1 text-slate-800">
                      {platform.name} · {platform.identityScope}
                    </dd>
                  </div>
                ) : null}
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Metadata URL</dt>
                  <dd className="wrap-anywhere mt-1 font-mono text-xs text-slate-700">{metadataUrl ?? "Unknown"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Client URI</dt>
                  <dd className="wrap-anywhere mt-1 text-slate-800">
                    {typeof metadata.client_uri === "string" ? (
                      <span className="inline-flex max-w-full items-center gap-1">
                        <span className="wrap-anywhere min-w-0">{metadata.client_uri}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </span>
                    ) : (
                      "Not observed"
                    )}
                  </dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Grant types</dt>
                    <dd className="mt-1 text-slate-800"><ListValue value={metadata.grant_types} /></dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Response types</dt>
                    <dd className="mt-1 text-slate-800"><ListValue value={metadata.response_types} /></dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Token auth</dt>
                    <dd className="mt-1 text-slate-800"><ListValue value={metadata.token_endpoint_auth_method} /></dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">App type</dt>
                    <dd className="mt-1 text-slate-800"><ListValue value={metadata.application_type} /></dd>
                  </div>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Redirect URIs</dt>
                  <dd className="wrap-anywhere mt-1 line-clamp-3 text-slate-800"><ListValue value={metadata.redirect_uris} /></dd>
                </div>
              </dl>

              <div className="wrap-anywhere mt-auto border-t border-line pt-4 text-sm text-slate-600">
                Last observed:{" "}
                {client.observedAt ? (
                  <span className="text-slate-800">{client.observedAt}</span>
                ) : client.latestValidation ? (
                  <span className={client.latestValidation.metadataValid ? "text-emerald-700" : "text-red-700"}>
                    {client.latestValidation.metadataValid ? "pass" : "fail"} at {client.latestValidation.createdAt}
                  </span>
                ) : (
                  <span>not observed</span>
                )}
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
