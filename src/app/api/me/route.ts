import { NextResponse } from "next/server";

import { getAccessContext } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: context.session.userId,
      username: context.session.username,
      displayName: context.session.displayName,
      role: context.role,
      sessionId: context.session.sessionId,
    },
    session: {
      expiresAt: new Date(context.session.expiresAt * 1000).toISOString(),
    },
  });
}
