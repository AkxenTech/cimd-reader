import { NextRequest, NextResponse } from "next/server";

import { protectedResourceMetadata } from "@/lib/mcp/protocol";
import { getBaseUrl } from "@/lib/oauth/base-url";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return NextResponse.json(protectedResourceMetadata(getBaseUrl(request)));
}
