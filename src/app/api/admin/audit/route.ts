import { NextResponse } from "next/server";

import { getAccessContext } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({ items: context.store.audit.slice(0, 100) });
}
