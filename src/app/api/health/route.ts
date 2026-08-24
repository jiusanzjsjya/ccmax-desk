import { NextResponse } from "next/server";

import { env } from "@/lib/env";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "ccmax-login-desk",
    adminConfigured: env.isAdminConfigured,
    sub2ApiConfigured: env.isSub2ApiConfigured,
  });
}
