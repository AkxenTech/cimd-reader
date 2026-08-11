import { NextResponse } from "next/server";

import { getClientsWithLatestSignals } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ clients: await getClientsWithLatestSignals() });
}
