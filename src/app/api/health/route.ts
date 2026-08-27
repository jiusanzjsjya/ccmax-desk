import { NextResponse } from "next/server";

import { isSub2ApiConfigured } from "@/lib/backend-config";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "ccmax-login-desk",
    superadminConfigured: env.isSuperadminConfigured,
    sub2ApiConfigured: await isSub2ApiConfigured(),
  });
}
