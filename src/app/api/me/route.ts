import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    user: { role: session.role, sessionId: session.sessionId },
    session: {
      expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    },
  });
}
