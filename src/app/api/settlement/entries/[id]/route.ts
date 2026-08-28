import { NextResponse } from "next/server";

import { addAuditEvent, deleteLedgerEntry } from "@/lib/account-store";
import { getAccessContext } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Delete a ledger entry. Superadmin only — a corrective action, fully audited. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const entry = await deleteLedgerEntry(id);
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "ledger.delete",
    targetId: entry.userId,
    details: JSON.stringify({ id: entry.id, kind: entry.kind, amountUsd: entry.amountUsd }),
  });

  return NextResponse.json({ ok: true });
}
