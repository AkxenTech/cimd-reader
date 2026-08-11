import { NextResponse } from "next/server";

import { getSessions } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ sessions: await getSessions() });
}
