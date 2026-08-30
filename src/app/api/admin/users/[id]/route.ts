import { NextResponse } from "next/server";
import { z } from "zod";

import { addAuditEvent, deleteLocalAccount, toPublicAccount, updateLocalAccount } from "@/lib/account-store";
import { getAccessContext } from "@/lib/access";
import { selectableBackends } from "@/lib/backend-config";
import { roleValues } from "@/lib/roles";

export const dynamic = "force-dynamic";

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  role: z.enum([roleValues[1], roleValues[2]]).optional(),
  disabled: z.boolean().optional(),
  // `null` unassigns the target platform; a ref must be enabled + configured.
  targetBackend: z.string().trim().max(80).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  // A non-null target must be an enabled + configured platform.
  if (parsed.data.targetBackend != null) {
    const { items } = await selectableBackends();
    if (!items.some((item) => item.ref === parsed.data.targetBackend)) {
      return NextResponse.json({ error: "invalid_target_backend" }, { status: 400 });
    }
  }

  const { id } = await params;
  const account = await updateLocalAccount(id, parsed.data);
  if (!account) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "user.update",
    targetId: account.id,
    details: JSON.stringify(parsed.data),
  });

  return NextResponse.json({ ok: true, account: toPublicAccount(account) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const account = await deleteLocalAccount(id);
  if (!account) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "user.delete",
    targetId: account.id,
    details: account.username,
  });
  return NextResponse.json({ ok: true });
}
