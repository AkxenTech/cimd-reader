import Link from "next/link";
import { CheckCircle2, CircleHelp, CircleX, ExternalLink, RadioTower } from "lucide-react";

import { getClientsWithLatestSignals } from "@/lib/db/queries";

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
  if (Array.isArray(value)) return <span>{value.join(", ")}</span>;
  if (typeof value === "string") return <span>{value}</span>;
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
        </div>
        <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-slate-600">
          Authorization server: <code className="font-mono text-ink">/.well-known/oauth-authorization-server</code>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((client) => {
          const metadata = parseRawMetadata(client.latestValidation?.rawMetadataJson) ?? {};
          const displayName = typeof metadata.client_name === "string" ? metadata.client_name : client.name;
          const logo = typeof metadata.logo_uri === "string" ? metadata.logo_uri : null;
          const metadataUrl = client.metadataUrl ?? client.latestValidation?.metadataUrl ?? (client.latestAttempt?.classification === "cimd" ? client.latestAttempt.clientId : null);

          return (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="group flex min-h-[420px] flex-col rounded-lg border border-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-slate-50">
                    {logo ? <img src={logo} alt="" className="h-7 w-7 object-contain" /> : <RadioTower className="h-5 w-5 text-slate-500" />}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-ink">{client.name}</h2>
                    <p className="text-sm text-slate-500">{client.category ?? "Tool"}</p>
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses(client.observedBehavior)}`}>
                  <StatusIcon status={client.observedBehavior} />
                  {client.observedBehavior}
                </span>
              </div>

              <dl className="mt-5 grid gap-3 text-sm">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Observed result</dt>
                  <dd className="mt-1 text-slate-800">{client.observedEvidence}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Claimed status</dt>
                  <dd className="mt-1 text-slate-800">{client.supportStatus.replace("_", " ")}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Metadata name</dt>
                    <dd className="mt-1 text-slate-800">{displayName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Observed behavior</dt>
                    <dd className="mt-1 text-slate-800">{client.observedBehavior}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Metadata URL</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-slate-700">{metadataUrl ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Client URI</dt>
                  <dd className="mt-1 break-all text-slate-800">
                    {typeof metadata.client_uri === "string" ? (
                      <span className="inline-flex items-center gap-1">
                        {metadata.client_uri}
                        <ExternalLink className="h-3 w-3" />
                      </span>
                    ) : (
                      "Not observed"
                    )}
                  </dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Grant types</dt>
                    <dd className="mt-1 text-slate-800"><ListValue value={metadata.grant_types} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Response types</dt>
                    <dd className="mt-1 text-slate-800"><ListValue value={metadata.response_types} /></dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Token auth</dt>
                    <dd className="mt-1 text-slate-800"><ListValue value={metadata.token_endpoint_auth_method} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">App type</dt>
                    <dd className="mt-1 text-slate-800"><ListValue value={metadata.application_type} /></dd>
                  </div>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Redirect URIs</dt>
                  <dd className="mt-1 line-clamp-3 text-slate-800"><ListValue value={metadata.redirect_uris} /></dd>
                </div>
              </dl>

              <div className="mt-auto border-t border-line pt-4 text-sm text-slate-600">
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
