import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { createAdminSession, setSessionCookie } from "@/lib/session";

export async function POST(request: Request) {
  if (!env.isAdminConfigured) {
    return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const accessKey = body && typeof body === "object" && "accessKey" in body && typeof body.accessKey === "string"
    ? body.accessKey
    : "";

  if (!isEqualSecret(accessKey, env.ADMIN_ACCESS_KEY)) {
    return NextResponse.json({ error: "invalid_access_key" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, role: "admin" });
  setSessionCookie(response, createAdminSession());
  return response;
}

function isEqualSecret(received: string, expected: string) {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);

  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}
