import { NextRequest, NextResponse } from "next/server";

import { authorizationServerMetadata, getBaseUrl } from "@/lib/oauth/base-url";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return NextResponse.json(authorizationServerMetadata(getBaseUrl(request)));
}
