import { NextResponse } from "next/server";

import { getAccessContext, provisioningAccess } from "@/lib/access";
import { selectableBackends } from "@/lib/backend-config";
import { backendLabel } from "@/lib/backends/kinds";

export const dynamic = "force-dynamic";

/** Backends the operator may target in the wizard (enabled + configured, no secrets). */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = provisioningAccess(context);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { default: defaultBackend, kinds } = await selectableBackends();
  return NextResponse.json({
    default: defaultBackend,
    items: kinds.map((kind) => ({ kind, label: backendLabel(kind) })),
  });
}
