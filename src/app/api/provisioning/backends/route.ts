import { NextResponse } from "next/server";

import { effectiveTargetBackend, getAccessContext, provisioningAccess } from "@/lib/access";
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

  // Superadmin chooses freely across every enabled + configured platform.
  if (context.role === "superadmin") {
    return NextResponse.json({ default: defaultBackend, items, canSelect: true });
  }

  // admin/user are locked to their superadmin-assigned platform.
  const target = effectiveTargetBackend(context);
  if (!target) {
    // No platform assigned yet — the wizard must block onboarding.
    return NextResponse.json({ default: defaultBackend, items: [], canSelect: false, targetUnassigned: true });
  }

  const locked = items.filter((item) => item.ref === target);
  if (locked.length === 0) {
    // Assigned platform is no longer enabled/configured — surface it as unusable.
    return NextResponse.json({ default: target, items: [], canSelect: false, targetUnavailable: true });
  }
  return NextResponse.json({ default: target, items: locked, canSelect: false });
}
