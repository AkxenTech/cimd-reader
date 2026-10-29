import Link from "next/link";
import { CheckCircle2, CircleHelp, CircleX, ExternalLink, RadioTower } from "lucide-react";

import { getClientsWithLatestSignals } from "@/lib/db/queries";
import { hostedClientPlatformFromSignal } from "@/lib/oauth/client-platform";
import { GITHUB_HANDLE, GITHUB_URL } from "@/lib/site";
import { clientDisplayName, dashboardSections } from "@/lib/clients/presentation";

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

function behaviorLabel(status: string) {
  switch (status) {
    case "cimd": return "CIMD metadata URL";
    case "dcr": return "Dynamic registration";
    case "static": return "Static client ID";
    case "failed": return "CIMD validation failed";
    case "not_supported": return "Not supported";
    case "unknown": return "Not observed";
    default: return status;
  }
}

type DashboardClient = Awaited<ReturnType<typeof getClientsWithLatestSignals>>[number];

function ClientCard({ client }: { client: DashboardClient }) {
  const metadata = parseRawMetadata(client.latestSuccessfulCimdValidation?.rawMetadataJson) ?? {};
  const metadataUrl = client.latestSuccessfulCimdValidation?.metadataUrl ?? null;
  const platform = hostedClientPlatformFromSignal({
    metadataUrl: metadataUrl ?? client.identities.find(identity => identity.registrationMethod === "cimd")?.clientId,
    userAgent: client.latestAttempt?.userAgent
  });
  const logo = typeof metadata.logo_uri === "string" ? metadata.logo_uri : null;
  return (
    <Link href={`/clients/${client.id}`} data-client-id={client.id}
      className="group flex min-w-0 flex-col rounded-lg border border-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-slate-50">
          {logo ? <img src={logo} alt="" className="h-7 w-7 object-contain" /> : <RadioTower className="h-5 w-5 text-slate-500" />}
        </div>
        <div className="min-w-0">
          <h3 className="wrap-anywhere text-lg font-semibold text-ink">{clientDisplayName(client)}</h3>
          <p className="wrap-anywhere text-sm text-slate-500">{platform ? platform.name : client.category ?? "Tool"}{client.attribution.status === "unresolved" ? " · Client-reported name" : ""}</p>
        </div>
      </div>
      <span className={`mt-4 inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses(client.observedBehavior)}`}>
        <StatusIcon status={client.observedBehavior} />{behaviorLabel(client.observedBehavior)}
      </span>
      <p className="wrap-anywhere mt-4 line-clamp-3 text-sm text-slate-600">{client.observedEvidence}</p>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Latest CIMD check</dt>
          <dd className={`mt-1 ${client.latestValidation ? client.latestValidation.metadataValid ? "text-emerald-700" : "text-red-700" : "text-slate-600"}`}>
            {client.latestValidation ? client.latestValidation.metadataValid ? "Passed" : "Failed" : "Not observed"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Highest MCP version</dt>
          <dd className="wrap-anywhere mt-1 font-mono text-slate-800">{client.highestObservedProtocol?.protocolVersion ?? "Not observed"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Latest event</dt>
          <dd className="wrap-anywhere mt-1 text-slate-800">{client.latestAttempt ? `${client.latestAttempt.method} ${client.latestAttempt.path}` : "Not observed"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Client release</dt>
          <dd className="wrap-anywhere mt-1 text-slate-800">{client.latestAttempt?.clientVersion ?? "Not observed"}</dd>
        </div>
        {metadataUrl ? (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Last successful CIMD metadata</dt>
            <dd className="wrap-anywhere mt-1 font-mono text-xs text-slate-700">{metadataUrl}</dd>
            {client.observedBehavior === "failed" ? <dd className="mt-1 text-xs text-slate-500">Historical success: {client.latestSuccessfulCimdAt}</dd> : null}
          </div>
        ) : null}
      </dl>
      <div className="wrap-anywhere mt-auto pt-5 text-xs text-slate-500">
        <p className="border-t border-line pt-3">Last observed: {client.observedAt ?? "Not observed"}</p>
        <p className="mt-2 font-medium text-sky-700">View details{client.identities.length > 1 ? ` · ${client.identities.length} OAuth identities` : ""} →</p>
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  const clients = await getClientsWithLatestSignals();
  const { primary, other } = dashboardSections(clients);

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

      <section aria-labelledby="observed-clients-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="observed-clients-heading" className="text-xl font-semibold text-ink">Clients</h2>
          <p className="text-sm text-slate-500">{primary.length} clients</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {primary.map(client => <ClientCard key={client.id} client={client} />)}
        </div>
      </section>

      {other.length ? (
        <details className="mt-7 rounded-lg border border-line bg-white p-5">
          <summary className="cursor-pointer text-lg font-semibold text-ink">Other OAuth observations ({other.length})</summary>
          <p className="mt-2 text-sm text-slate-600">Failed metadata checks and unidentified clients are kept here for investigation. All requests remain available in Sessions.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {other.map(client => <ClientCard key={client.id} client={client} />)}
          </div>
        </details>
      ) : null}
    </main>
  );
}
