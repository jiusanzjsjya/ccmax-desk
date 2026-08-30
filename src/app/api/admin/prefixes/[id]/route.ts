import { NextResponse } from "next/server";
import { z } from "zod";

import { canDeletePrefix, canEditPrefix, canManagePrefixes, getAccessContext } from "@/lib/access";
import { addAuditEvent, deleteAccountPrefix, listAccountPrefixes, updateAccountPrefix } from "@/lib/account-store";

export const dynamic = "force-dynamic";

const updatePrefixSchema = z.object({
  value: z.string().trim().min(1).max(60),
});

/** Rename a prefix. superadmin may edit any; an admin only their own. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManagePrefixes(context)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = updatePrefixSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  const target = (await listAccountPrefixes()).find((prefix) => prefix.id === id);
  if (!target) return NextResponse.json({ error: "prefix_not_found" }, { status: 404 });
  // An admin may not rename a superadmin's prefix (view-only).
  if (!canEditPrefix(context, target)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const prefix = await updateAccountPrefix(id, parsed.data.value);
  if (!prefix) return NextResponse.json({ error: "duplicate_prefix" }, { status: 409 });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "prefix.update",
    targetId: prefix.id,
    details: prefix.value,
  });
  return NextResponse.json({ ok: true, prefix });
}

/** Delete a prefix. superadmin may delete any; admin only their own. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManagePrefixes(context)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const target = (await listAccountPrefixes()).find((prefix) => prefix.id === id);
  if (!target) return NextResponse.json({ error: "prefix_not_found" }, { status: 404 });
  if (!canDeletePrefix(context, target)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const removed = await deleteAccountPrefix(id);
  if (!removed) return NextResponse.json({ error: "prefix_not_found" }, { status: 404 });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "prefix.delete",
    targetId: removed.id,
    details: removed.value,
  });
  return NextResponse.json({ ok: true });
}
