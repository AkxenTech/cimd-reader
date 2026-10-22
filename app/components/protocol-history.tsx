import type { McpProtocolObservation } from "@/lib/db/schema";

const outcomes: Record<string, string> = {
  negotiated: "Negotiated",
  offered: "Server counter-offer",
  discovered: "Discovery accepted",
  accepted: "Request accepted",
  rejected: "Rejected"
};

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value} className="whitespace-nowrap">{value.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time>;
}

export function ProtocolHistory({ observations }: { observations: McpProtocolObservation[] }) {
  if (!observations.length) {
    return <p className="mt-4 text-sm text-slate-500">No protocol versions recorded yet. Reconnect the MCP client and make a request to capture its version.</p>;
  }

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Distinct MCP version observations, newest protocol version first</caption>
        <thead className="border-b border-line text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-3">Client / release</th>
            <th scope="col" className="px-3 py-3">Requested</th>
            <th scope="col" className="px-3 py-3">Server version / outcome</th>
            <th scope="col" className="px-3 py-3">Evidence</th>
            <th scope="col" className="px-3 py-3">First / last seen</th>
            <th scope="col" className="px-3 py-3 text-right">Count</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {observations.map((row) => (
            <tr key={row.id} className="align-top">
              <td className="px-3 py-4">
                <p className="wrap-anywhere font-medium text-ink">{row.clientName ?? "Unidentified client"}</p>
                <p className="wrap-anywhere mt-1 text-xs text-slate-500">{row.clientVersion ?? "Release unknown"}</p>
              </td>
              <td className="whitespace-nowrap px-3 py-4 font-mono text-xs">{row.requestedVersion ?? "Not supplied"}</td>
              <td className="px-3 py-4">
                <p className="whitespace-nowrap font-mono text-xs">{row.selectedVersion ?? "None"}</p>
                <p className={`mt-1 text-xs ${row.outcome === "rejected" ? "text-red-700" : row.outcome === "offered" ? "text-amber-800" : "text-emerald-700"}`}>
                  {outcomes[row.outcome] ?? row.outcome}
                </p>
              </td>
              <td className="min-w-40 px-3 py-4 text-xs text-slate-600">
                <details>
                  <summary className="cursor-pointer font-medium text-slate-800">{row.phase === "initialize" ? "initialize" : row.phase === "discovery" ? "server/discover" : "Per-request version"}</summary>
                  <dl className="mt-2 space-y-2">
                    <div><dt>Identity source</dt><dd className="font-mono">{row.identitySource}</dd></div>
                    <div><dt>HTTP version header</dt><dd className="font-mono">{row.headerVersion ?? "Not supplied"}</dd></div>
                    <div><dt>Initialize version</dt><dd className="font-mono">{row.paramsVersion ?? "Not supplied"}</dd></div>
                    <div><dt>Metadata version</dt><dd className="font-mono">{row.metaVersion ?? "Not supplied"}</dd></div>
                    <div><dt>Server-supported versions</dt><dd className="wrap-anywhere font-mono">{row.serverVersionsJson}</dd></div>
                    {row.errorMessage ? <div><dt>Error {row.errorCode}</dt><dd className="wrap-anywhere text-red-700">{row.errorMessage}</dd></div> : null}
                  </dl>
                </details>
              </td>
              <td className="px-3 py-4 text-xs text-slate-500">
                <p><Timestamp value={row.firstSeenAt} /></p>
                <p className="mt-1 text-slate-800"><Timestamp value={row.lastSeenAt} /></p>
              </td>
              <td className="px-3 py-4 text-right tabular-nums">{row.observationCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProtocolHistoryNote() {
  return (
    <p className="mt-2 max-w-4xl text-sm text-slate-600">
      Newest protocol versions first, then most recently seen. Repeated client releases and version outcomes are counted together.
      A counter-offer or discovery response does not prove the client used that version. Client names are self-reported and are not linked to individual OAuth sessions.
    </p>
  );
}
