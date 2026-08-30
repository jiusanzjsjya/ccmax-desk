import { NextResponse } from "next/server";

import { accountPoolAccess, effectiveTargetBackend, getAccessContext } from "@/lib/access";
import { getBackendConfigStore } from "@/lib/account-store";
import { customRef } from "@/lib/backends/kinds";

export const dynamic = "force-dynamic";

/**
 * Platforms whose account pool can be reviewed. Sub2API is the reference pool
 * (the only one with real data today); each configured self-built gateway is
 * listed for forward-compat (its pool is a "待接入" placeholder for now).
 *
 * Gated by `accountPoolAccess` — deliberately decoupled from the provisioning
 * wizard's platform list (`/api/provisioning/backends`), which is provisioning-
 * gated and would 403 a pool-only viewer.
 */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!accountPoolAccess(context)) return NextResponse.json({ error: "account_pool_forbidden" }, { status: 403 });

  const backends = await getBackendConfigStore();
  const items = [
    { ref: "sub2api", kind: "sub2api", label: "Sub2API · 参考平台" },
    ...backends.customs.map((gateway) => ({
      ref: customRef(gateway.id),
      kind: "custom",
      label: gateway.name || "自建网关",
    })),
  ];

  // Superadmin sees every platform's pool; admin/user are locked to their
  // assigned platform (mirrors the onboarding lock).
  if (context.role === "superadmin") {
    return NextResponse.json({ default: "sub2api", items });
  }

  const target = effectiveTargetBackend(context);
  if (!target) {
    return NextResponse.json({ default: null, items: [], targetUnassigned: true });
  }
  const locked = items.filter((item) => item.ref === target);
  return NextResponse.json({ default: target, items: locked });
}
