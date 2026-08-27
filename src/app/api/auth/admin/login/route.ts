import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { addAuditEvent, findLocalAccount, markAccountLogin, normalizeUsername, verifyPassword } from "@/lib/account-store";
import { env } from "@/lib/env";
import { createAdminSession, setSessionCookie } from "@/lib/session";
import { roleLabel } from "@/lib/roles";

const loginSchema = z.object({
  username: z.string().trim().max(80).optional(),
  password: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const username = parsed.data.username?.trim();
  const password = parsed.data.password;

  if (!username || !password) {
    if (!env.isSuperadminConfigured) {
      return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Superadmin signs in with the env-configured account name + password.
  if (
    env.isSuperadminConfigured &&
    normalizeUsername(username) === normalizeUsername(env.SUPERADMIN_USERNAME) &&
    isEqualSecret(password, env.SUPERADMIN_PASSWORD)
  ) {
    return createSessionResponse({
      userId: "env-superadmin",
      username: env.SUPERADMIN_USERNAME,
      displayName: "超级管理员",
      role: "superadmin",
      auditAction: "login.superadmin",
    });
  }

  // Local admin / user accounts.
  const account = await findLocalAccount(username);
  if (account && !account.disabled && verifyPassword(password, account.passwordHash)) {
    await markAccountLogin(account.id);
    return createSessionResponse({
      userId: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      auditAction: "login.account",
      auditTargetId: account.id,
    });
  }

  return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
}

async function createSessionResponse(input: {
  userId: string;
  username: string;
  displayName: string;
  role: "superadmin" | "admin" | "user";
  auditAction: string;
  auditTargetId?: string;
}) {
  const response = NextResponse.json({
    ok: true,
    user: {
      id: input.userId,
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      roleLabel: roleLabel(input.role),
    },
  });
  setSessionCookie(response, createAdminSession({
    userId: input.userId,
    username: input.username,
    displayName: input.displayName,
    role: input.role,
  }));

  try {
    await addAuditEvent({
      actorId: input.userId,
      actorName: input.displayName,
      actorRole: input.role,
      action: input.auditAction,
      targetId: input.auditTargetId,
    });
  } catch (error) {
    console.error("[auth.login] audit failed", error instanceof Error ? error.message : error);
  }

  return response;
}

function isEqualSecret(received: string, expected: string) {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);

  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}
