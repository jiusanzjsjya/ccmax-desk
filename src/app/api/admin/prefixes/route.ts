import { NextResponse } from "next/server";
import { z } from "zod";

import { canManagePrefixes, getAccessContext } from "@/lib/access";
import { addAccountPrefix, addAuditEvent, listAccountPrefixes } from "@/lib/account-store";

export const dynamic = "force-dynamic";

const createPrefixSchema = z.object({
  value: z.string().trim().min(1).max(60),
});

/** Full prefix list for the management block (admin + superadmin). */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManagePrefixes(context)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({ items: await listAccountPrefixes() });
}

/** Add a prefix (admin + superadmin). */
export async function POST(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManagePrefixes(context)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = createPrefixSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  const prefix = await addAccountPrefix({
    value: parsed.data.value,
    createdBy: context.session.userId,
    createdByName: context.session.displayName,
    createdByRole: context.role,
  });
  if (!prefix) return NextResponse.json({ error: "duplicate_prefix" }, { status: 409 });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "prefix.create",
    targetId: prefix.id,
    details: prefix.value,
  });
  return NextResponse.json({ ok: true, prefix }, { status: 201 });
}
