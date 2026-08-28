import { NextResponse } from "next/server";

import { canSelectBackend, getAccessContext, provisioningAccess } from "@/lib/access";
import { selectableBackends } from "@/lib/backend-config";

export const dynamic = "force-dynamic";

/** Backends the operator may target in the wizard (enabled + configured, no secrets). */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = provisioningAccess(context);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // items: [{ ref, kind, label }] — ref is the value the wizard sends back.
  const { default: defaultBackend, items } = await selectableBackends();

  // A user without select permission is locked to the default: expose only that
  // option and signal `canSelect: false` so the wizard hides the platform picker.
  const canSelect = canSelectBackend(context);
  const visibleItems = canSelect ? items : items.filter((item) => item.ref === defaultBackend);
  return NextResponse.json({ default: defaultBackend, items: visibleItems, canSelect });
}
