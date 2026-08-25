import { NextResponse } from "next/server";
import { z } from "zod";

import { addAuditEvent, updateLocalPassword } from "@/lib/account-store";
import { getAccessContext } from "@/lib/access";

export const dynamic = "force-dynamic";

const passwordSchema = z.object({ password: z.string().min(10).max(200) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = passwordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "password_too_short" }, { status: 400 });

  const { id } = await params;
  const account = await updateLocalPassword(id, parsed.data.password);
  if (!account) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "user.password_reset",
    targetId: account.id,
    details: account.username,
  });

  return NextResponse.json({ ok: true });
}
