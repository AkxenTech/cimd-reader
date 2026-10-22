import { getProtocolObservations } from "@/lib/mcp/observations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ observations: await getProtocolObservations() });
}
