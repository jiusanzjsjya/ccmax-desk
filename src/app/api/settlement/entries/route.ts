import { NextResponse } from "next/server";
import { z } from "zod";

import { addAuditEvent, addLedgerEntry } from "@/lib/account-store";
import { canWriteLedger, getAccessContext } from "@/lib/access";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const entrySchema = z.object({
  userId: z.string().min(1).max(80),
  kind: z.enum(["settlement", "prepay"]),
  amountUsd: z.number().positive().max(1_000_000),
  paidAmount: z.number().min(0).max(1_000_000).nullable().optional(),
  paidCurrency: z.string().trim().max(16).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Create a manual settlement/prepay ledger entry (bookkeeping only). */
export async function POST(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!context.store.settings.settlementModuleEnabled) {
    return NextResponse.json({ error: "settlement_disabled" }, { status: 403 });
  }

  const parsed = entrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { userId, kind, amountUsd, paidAmount, paidCurrency, note } = parsed.data;

  if (!canWriteLedger(context, userId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Resolve a username snapshot; reject unknown targets.
  let username: string | null = null;
  if (userId === "env-superadmin") {
    if (env.isSuperadminConfigured) username = env.SUPERADMIN_USERNAME;
  } else {
    username = context.store.accounts.find((account) => account.id === userId)?.username ?? null;
  }
  if (!username) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const entry = await addLedgerEntry({
    userId,
    username,
    kind,
    amountUsd,
    paidAmount: paidAmount ?? null,
    paidCurrency: (paidCurrency || "USD").toUpperCase(),
    note: note || null,
    createdBy: context.session.userId,
    createdByName: context.session.displayName,
  });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: `ledger.${kind}`,
    targetId: userId,
    details: JSON.stringify({ amountUsd, paidAmount: paidAmount ?? null, paidCurrency: entry.paidCurrency }),
  });

  return NextResponse.json({ ok: true, entry });
}
