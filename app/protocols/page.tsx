import { ProtocolHistory, ProtocolHistoryNote } from "@/app/components/protocol-history";
import { getProtocolObservations } from "@/lib/mcp/observations";

export const dynamic = "force-dynamic";

export default async function ProtocolsPage() {
  const observations = await getProtocolObservations();
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">MCP compatibility</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Protocol version history</h1>
        <ProtocolHistoryNote />
        <ProtocolHistory observations={observations} />
      </section>
    </main>
  );
}
