import Link from "next/link";

import { displayClassification, getSessions } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const sessions = await getSessions();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Validation sessions</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">OAuth Request Timeline</h1>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm">
        {sessions.length ? (
          <table className="min-w-[980px] w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Latest event</th>
                <th className="px-4 py-3">Behavior</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Client ID</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/sessions/${session.id}`} className="text-slate-900 hover:underline">
                      {session.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{session.label ?? "Unlabeled"}</td>
                  <td className="px-4 py-3">{session.latestAttempt ? `${session.latestAttempt.method} ${session.latestAttempt.path}` : "None"}</td>
                  <td className="px-4 py-3">{displayClassification(session.latestAttempt)}</td>
                  <td className="px-4 py-3">
                    {session.latestAttempt?.clientName ? (
                      <>
                        {session.latestAttempt.clientName}
                        {session.latestAttempt.clientVersion ? <span className="text-slate-500"> {session.latestAttempt.clientVersion}</span> : null}
                      </>
                    ) : "Unknown"}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs">{session.latestAttempt?.clientId ?? "None"}</td>
                  <td className="px-4 py-3">{session.createdAt}</td>
                  <td className="px-4 py-3">{session.attemptCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-6 text-sm text-slate-500">No sessions have been recorded yet.</p>
        )}
      </div>
    </main>
  );
}
