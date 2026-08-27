import { NextResponse } from "next/server";
import { z } from "zod";

import { addAuditEvent, updateSystemSettings } from "@/lib/account-store";
import { getAccessContext } from "@/lib/access";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  provisioningEnabled: z.boolean().optional(),
  allowAdminCreateUsers: z.boolean().optional(),
  allowUserProvisioning: z.boolean().optional(),
  allowAdminAccountPoolView: z.boolean().optional(),
  allowUserAccountPoolView: z.boolean().optional(),
  scopeAccountPoolByOwner: z.boolean().optional(),
});

export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role === "user") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({ settings: context.store.settings, canManage: context.role === "superadmin" });
}

export async function PATCH(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  const settings = await updateSystemSettings(parsed.data);
  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "settings.update",
    details: JSON.stringify(parsed.data),
  });
  return NextResponse.json({ ok: true, settings });
}
