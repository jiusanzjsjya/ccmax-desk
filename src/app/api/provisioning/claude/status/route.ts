import { NextResponse } from "next/server";

import { getAccessContext, provisioningAccess } from "@/lib/access";
import { listOwnerFlows } from "@/lib/provisioning-state";

export const dynamic = "force-dynamic";

/** Active authorization slots owned by the current operator (for restore + pending board). */
export async function GET() {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = provisioningAccess(context);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return NextResponse.json({ slots: listOwnerFlows(context.session.sessionId) });
}
