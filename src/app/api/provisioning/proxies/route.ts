import { NextResponse } from "next/server";

import { getAccessContext, provisioningAccess } from "@/lib/access";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { listProxies, mapSub2ApiError, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

/** List Sub2API proxies for the wizard's proxy selector (admin / superadmin only). */
export async function GET() {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = provisioningAccess(context);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Proxy infrastructure is admin-only; plain users use the default proxy.
  if (context.role === "user") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!(await isSub2ApiConfigured())) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  try {
    return NextResponse.json({ items: await listProxies() });
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取 Sub2API 代理列表失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.proxies] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
