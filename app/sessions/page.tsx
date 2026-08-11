import Link from "next/link";

import { getSessions } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const sessions = await getSessions();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Validation sessions</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">OAuth Request Timeline</h1>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        {sessions.length ? (
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Label</th>
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
