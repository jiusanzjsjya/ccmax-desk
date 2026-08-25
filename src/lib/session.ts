import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { roleValues, type Role } from "@/lib/roles";

const sessionCookieName = "ccmax_admin_session";
const sessionLifetimeSeconds = 60 * 60 * 24 * 7;

export type AdminSession = {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  issuedAt: number;
  expiresAt: number;
};

export function createAdminSession(identity: {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const session: AdminSession = {
    sessionId: randomUUID(),
    ...identity,
    issuedAt,
    expiresAt: issuedAt + sessionLifetimeSeconds,
  };

  const encodedPayload = encodePayload(session);
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function readAdminSession(value: string | undefined): AdminSession | null {
  if (!value) {
    return null;
  }

  const [encodedPayload, signature] = value.split(".");

  if (!encodedPayload || !signature || !isValidSignature(encodedPayload, signature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<AdminSession> & { role?: string };
    const role = session.role === "admin" ? "superadmin" : session.role;
    const now = Math.floor(Date.now() / 1000);

    // Sessions issued before local account RBAC used only the admin role and timestamps.
    if (
      session.role === "admin" &&
      !session.userId &&
      typeof session.sessionId === "string" &&
      typeof session.issuedAt === "number" &&
      typeof session.expiresAt === "number" &&
      session.expiresAt > now
    ) {
      return {
        sessionId: session.sessionId,
        userId: "env-superadmin",
        username: "superadmin",
        displayName: "超级管理员",
        role: "superadmin",
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
      };
    }

    if (
      typeof session.sessionId !== "string" ||
      typeof session.userId !== "string" ||
      typeof session.username !== "string" ||
      typeof session.displayName !== "string" ||
      !roleValues.includes(role as Role) ||
      typeof session.issuedAt !== "number" ||
      typeof session.expiresAt !== "number" ||
      session.expiresAt <= now
    ) {
      return null;
    }

    return { ...session, role } as AdminSession;
  } catch {
    return null;
  }
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  return readAdminSession(cookieStore.get(sessionCookieName)?.value);
}

export function setSessionCookie(response: NextResponse, sessionToken: string) {
  response.cookies.set(sessionCookieName, sessionToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function encodePayload(session: AdminSession) {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", env.SESSION_SECRET).update(value).digest("base64url");
}

function isValidSignature(value: string, signature: string) {
  const expected = Buffer.from(sign(value));
  const received = Buffer.from(signature);

  return expected.length === received.length && timingSafeEqual(expected, received);
}
