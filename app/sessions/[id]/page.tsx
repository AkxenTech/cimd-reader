import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ListOrdered } from "lucide-react";

import { displayClassification, getSessionTimeline } from "@/lib/db/queries";
import type { CimdValidationResult } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function resultFor(results: CimdValidationResult[], attemptId: string) {
  return results.find((result) => result.attemptId === attemptId);
}

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const timeline = await getSessionTimeline(id);
  if (!timeline) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/sessions" className="text-sm font-medium text-slate-600 hover:text-ink">
        Back to sessions
      </Link>
      <div className="mt-5 rounded-lg border border-line bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Session</p>
        <h1 className="mt-1 break-all font-mono text-2xl font-semibold tracking-tight">{timeline.session.id}</h1>
        <p className="mt-2 text-sm text-slate-600">{timeline.session.label ?? "Unlabeled"} · {timeline.session.createdAt}</p>
      </div>

      <section id="attempts" className="mt-6 rounded-lg border border-line bg-white p-5 shadow-sm scroll-mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <h2 className="text-lg font-semibold">
              {timeline.attempts.length} attempt{timeline.attempts.length === 1 ? "" : "s"}
            </h2>
          </div>
          <Link
            href="/sessions"
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            All sessions
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {timeline.attempts.map((attempt, index) => (
            <Link
              key={attempt.id}
              href={`#attempt-${attempt.id}`}
              className="rounded-md border border-line px-3 py-2 text-sm hover:border-blue-200 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label={`View attempt ${index + 1}: ${attempt.method} ${attempt.path}`}
            >
              <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Attempt {index + 1}</span>
              <span className="mt-1 flex items-center justify-between gap-3 font-medium text-slate-900">
                <span>{attempt.method} {attempt.path}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
              </span>
              <span className="mt-1 block truncate font-mono text-xs text-slate-500">{attempt.createdAt}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-6 space-y-4">
        {timeline.attempts.map((attempt, index) => {
          const validation = resultFor(timeline.results, attempt.id);
          return (
            <article id={`attempt-${attempt.id}`} key={attempt.id} className="scroll-mt-6 rounded-lg border border-line bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-mono text-xs text-slate-500">{attempt.createdAt}</p>
                  <h2 className="mt-1 text-lg font-semibold">Attempt {index + 1}: {attempt.method} {attempt.path}</h2>
                </div>
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-200">
                  {displayClassification(attempt)}
                </span>
              </div>

              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Client ID</dt><dd className="mt-1 break-all">{attempt.clientId ?? "None"}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Client name</dt><dd className="mt-1 break-all">{attempt.clientName ?? "Unknown"}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Client version</dt><dd className="mt-1 break-all">{attempt.clientVersion ?? "Unknown"}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Redirect URI</dt><dd className="mt-1 break-all">{attempt.redirectUri ?? "None"}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Scope</dt><dd className="mt-1">{attempt.scope ?? "None"}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">User agent</dt><dd className="mt-1 break-words">{attempt.userAgent ?? "Unknown"}</dd></div>
              </dl>

              {validation ? (
                <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
                  <p className={validation.metadataValid ? "font-medium text-emerald-700" : "font-medium text-red-700"}>
                    CIMD validation {validation.metadataValid ? "passed" : "failed"} · HTTP {validation.metadataHttpStatus ?? "not reached"}
                  </p>
                  <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-white p-3 font-mono text-xs text-slate-700 ring-1 ring-line">
                    {validation.validationErrors ?? "[]"}
                  </pre>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
