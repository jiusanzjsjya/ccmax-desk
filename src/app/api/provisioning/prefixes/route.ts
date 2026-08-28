import { NextResponse } from "next/server";

import { getAccessContext } from "@/lib/access";
import { listAccountPrefixes } from "@/lib/account-store";

export const dynamic = "force-dynamic";

/**
 * Read-only prefix list for the onboarding selector. Any authenticated role may
 * read it (regular users need it to select); the `enabled` flag drives whether
 * a prefix is mandatory before generating slots.
 */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const items = (await listAccountPrefixes()).map((prefix) => ({ id: prefix.id, value: prefix.value }));
  return NextResponse.json({ enabled: context.store.settings.forcedPrefixEnabled, items });
}
