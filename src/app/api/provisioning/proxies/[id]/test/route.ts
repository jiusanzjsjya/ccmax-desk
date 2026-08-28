import { NextResponse } from "next/server";

import { canUseCustomProxy, getAccessContext, provisioningAccess } from "@/lib/access";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { mapSub2ApiError, Sub2ApiError, testProxy } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

/** Test a Sub2API proxy by id (POST /admin/proxies/:id/test). Admin / superadmin only. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = provisioningAccess(context);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!canUseCustomProxy(context)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!(await isSub2ApiConfigured())) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  const proxyId = Number((await params).id);
  if (!Number.isInteger(proxyId) || proxyId <= 0) {
    return NextResponse.json({ error: "invalid_proxy_id" }, { status: 400 });
  }

  try {
    return NextResponse.json(await testProxy(proxyId));
  } catch (error) {
    const failure = mapSub2ApiError(error, "代理检测失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.proxies.test] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
