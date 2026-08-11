import Link from "next/link";
import { notFound } from "next/navigation";

import { getClientDetail } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function metadataObject(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-800">{value || <span className="text-slate-400">Unknown</span>}</dd>
    </div>
  );
}

function Value({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <>{value.join(", ")}</>;
  if (typeof value === "string") return <>{value}</>;
  if (typeof value === "number") return <>{value}</>;
  return <span className="text-slate-400">Not observed</span>;
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getClientDetail(id);
  if (!detail) notFound();

  const { client, latestAttempt, latestValidation, observedBehavior, observedEvidence, observedAt } = detail;
  const metadata = metadataObject(latestValidation?.rawMetadataJson);
  const errors = parseJsonArray(latestValidation?.validationErrors);
  const warnings = parseJsonArray(latestValidation?.validationWarnings);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm font-medium text-slate-600 hover:text-ink">
        Back to clients
      </Link>

      <section className="mt-5 rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm text-slate-500">{client.category ?? "Developer tool"}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{client.name}</h1>
            <p className="mt-3 max-w-3xl text-slate-600">{client.notes ?? "No notes recorded."}</p>
          </div>
          <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
            observed: {observedBehavior}
          </span>
        </div>

        <dl className="mt-6 grid gap-4 md:grid-cols-2">
          <Field label="Observed evidence" value={observedEvidence} />
          <Field label="Observed at" value={observedAt} />
          <Field label="Metadata URL" value={client.metadataUrl} />
          <Field label="Vendor" value={client.vendor} />
          <Field label="Source URL" value={client.sourceUrl} />
          <Field label="Claimed status" value={client.supportStatus.replace("_", " ")} />
        </dl>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-line bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Known Metadata</h2>
          <dl className="mt-5 grid gap-4">
            <Field label="Client name" value={<Value value={metadata?.client_name} />} />
            <Field label="Client URI" value={<Value value={metadata?.client_uri} />} />
            <Field label="Logo URI" value={<Value value={metadata?.logo_uri} />} />
            <Field label="Grant types" value={<Value value={metadata?.grant_types} />} />
            <Field label="Response types" value={<Value value={metadata?.response_types} />} />
            <Field label="Token endpoint auth method" value={<Value value={metadata?.token_endpoint_auth_method} />} />
            <Field label="Application type" value={<Value value={metadata?.application_type} />} />
            <Field label="Redirect URIs" value={<Value value={metadata?.redirect_uris} />} />
          </dl>
        </div>

        <div className="rounded-lg border border-line bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Latest OAuth Attempt</h2>
          {latestAttempt ? (
            <dl className="mt-5 grid gap-4">
              <Field label="Timestamp" value={latestAttempt.createdAt} />
              <Field label="Path" value={`${latestAttempt.method} ${latestAttempt.path}`} />
              <Field label="Client ID" value={latestAttempt.clientId} />
              <Field label="Redirect URI" value={latestAttempt.redirectUri} />
              <Field label="Scope" value={latestAttempt.scope} />
              <Field label="PKCE" value={latestAttempt.codeChallengeMethod ? `${latestAttempt.codeChallengeMethod}: ${latestAttempt.codeChallenge}` : null} />
              <Field label="User agent" value={latestAttempt.userAgent} />
            </dl>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No OAuth attempt has been observed for this client.</p>
          )}
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Validation Result</h2>
          {latestValidation ? (
            <span className={latestValidation.metadataValid ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-red-700"}>
              {latestValidation.metadataValid ? "pass" : "fail"} at {latestValidation.createdAt}
            </span>
          ) : null}
        </div>

        {latestValidation ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Errors</h3>
              {errors.length ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                  {errors.map((error, index) => <li key={index}>{String(error)}</li>)}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No validation errors.</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Warnings</h3>
              {warnings.length ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
                  {warnings.map((warning, index) => <li key={index}>{String(warning)}</li>)}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No validation warnings.</p>
              )}
            </div>
            <div className="lg:col-span-2">
              <h3 className="text-sm font-semibold text-slate-700">Raw metadata JSON</h3>
              <pre className="mt-2 max-h-[520px] overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs text-slate-100">
                {latestValidation.rawMetadataJson ?? "No metadata body captured."}
              </pre>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No CIMD validation result has been recorded.</p>
        )}
      </section>
    </main>
  );
}
