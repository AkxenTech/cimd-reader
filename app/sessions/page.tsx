import Link from "next/link";

import { getSessions } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const RECENT_SESSIONS_PER_GROUP = 8;
type SessionList = Awaited<ReturnType<typeof getSessions>>;

function SessionRows({ sessions }: { sessions: SessionList }) {
  return (
    <>
      {sessions.map((session) => (
        <tr key={session.id} className="border-t border-line hover:bg-slate-50">
          <td className="px-4 py-3 font-mono text-xs">
            <Link href={`/sessions/${session.id}`} className="text-slate-900 hover:underline">
              {session.id}
            </Link>
          </td>
          <td className="px-4 py-3">{session.label ?? "Unlabeled"}</td>
          <td className="px-4 py-3">{session.latestAttempt ? `${session.latestAttempt.method} ${session.latestAttempt.path}` : "None"}</td>
          <td className="px-4 py-3">{session.sessionBehavior}</td>
          <td className="px-4 py-3">
            {session.clientType !== "Unknown client" ? (
              <>
                {session.clientType}
                {session.clientVersions.length ? <span className="text-slate-500"> {session.clientVersions.join(", ")}</span> : null}
              </>
            ) : "Unknown"}
          </td>
          <td className="max-w-[240px] truncate px-4 py-3 font-mono text-xs">{session.latestAttempt?.userAgent ?? "Unknown"}</td>
          <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs">{session.latestAttempt?.clientId ?? "None"}</td>
          <td className="px-4 py-3">{session.createdAt}</td>
          <td className="px-4 py-3">{session.attemptCount}</td>
        </tr>
      ))}
    </>
  );
}

export default async function SessionsPage() {
  const sessions = await getSessions();
  const groups = [...sessions.reduce((map, session) => {
    const group = map.get(session.clientKey) ?? {
      clientKey: session.clientKey,
      clientType: session.clientType,
      sessions: [] as typeof sessions,
      versions: new Set<string>(),
      behaviors: new Map<string, number>(),
      attempts: 0
    };

    group.sessions.push(session);
    group.attempts += session.attemptCount;
    for (const version of session.clientVersions) group.versions.add(version);
    group.behaviors.set(session.sessionBehavior, (group.behaviors.get(session.sessionBehavior) ?? 0) + 1);
    map.set(session.clientKey, group);
    return map;
  }, new Map<string, {
    clientKey: string;
    clientType: string;
    sessions: typeof sessions;
    versions: Set<string>;
    behaviors: Map<string, number>;
    attempts: number;
  }>()).values()].sort((a, b) => a.clientType.localeCompare(b.clientType));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Validation sessions</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">OAuth Request Timeline</h1>
      </div>

      {groups.length ? (
        <div className="space-y-5">
          {groups.map((group) => {
            const versions = [...group.versions].sort();
            const behaviors = [...group.behaviors.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([behavior, count]) => `${behavior}: ${count}`)
              .join(" · ");
            const recentSessions = group.sessions.slice(0, RECENT_SESSIONS_PER_GROUP);
            const olderSessions = group.sessions.slice(RECENT_SESSIONS_PER_GROUP);

            return (
              <section key={group.clientKey} className="rounded-lg border border-line bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Client type</p>
                    <h2 className="mt-1 text-lg font-semibold text-ink">{group.clientType}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {group.sessions.length} session{group.sessions.length === 1 ? "" : "s"} · {group.attempts} attempt{group.attempts === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="grid gap-1 text-sm text-slate-600 sm:text-right">
                    <span>Versions: {versions.length ? versions.join(", ") : "Unknown"}</span>
                    <span>Results: {behaviors || "Unknown"}</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Session</th>
                        <th className="px-4 py-3">Label</th>
                        <th className="px-4 py-3">Latest event</th>
                        <th className="px-4 py-3">Behavior</th>
                        <th className="px-4 py-3">Client</th>
                        <th className="px-4 py-3">User agent</th>
                        <th className="px-4 py-3">Client ID</th>
                        <th className="px-4 py-3">Created</th>
                        <th className="px-4 py-3">Attempts</th>
                      </tr>
                    </thead>
                    <tbody>
                      <SessionRows sessions={recentSessions} />
                    </tbody>
                  </table>
                </div>

                {olderSessions.length ? (
                  <details className="border-t border-line bg-slate-50">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 hover:text-ink">
                      Show {olderSessions.length} older session{olderSessions.length === 1 ? "" : "s"}
                    </summary>
                    <div className="overflow-x-auto border-t border-line bg-white">
                      <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                        <tbody>
                          <SessionRows sessions={olderSessions} />
                        </tbody>
                      </table>
                    </div>
                  </details>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-white shadow-sm">
          <p className="p-6 text-sm text-slate-500">No sessions have been recorded yet.</p>
        </div>
      )}
    </main>
  );
}
