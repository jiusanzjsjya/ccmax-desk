import { NextResponse } from "next/server";
import { z } from "zod";

import { AccountStoreError, addAuditEvent, createLocalAccount, getAccountStore, toPublicAccount } from "@/lib/account-store";
import { getAccessContext, roleCanCreateUsers } from "@/lib/access";
import { selectableBackends } from "@/lib/backend-config";
import { roleValues } from "@/lib/roles";

export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, "登录名只能使用字母、数字、点、下划线和短横线"),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(10).max(200),
  role: z.enum([roleValues[1], roleValues[2]]).default("user"),
  // Superadmin may set the new account's target platform explicitly; ignored for
  // an admin creator (their own platform is snapshotted instead).
  targetBackend: z.string().trim().max(80).nullable().optional(),
});

export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role === "user") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const store = await getAccountStore();
  // Platforms a superadmin may assign to an account (enabled + configured).
  const { items: assignablePlatforms } = await selectableBackends();
  return NextResponse.json({
    items: store.accounts.map(toPublicAccount),
    settings: store.settings,
    assignablePlatforms,
    currentUser: {
      id: context.session.userId,
      username: context.session.username,
      displayName: context.session.displayName,
      role: context.role,
      targetBackend: context.targetBackend,
    },
    permissions: {
      canCreateUsers: roleCanCreateUsers(context.role, store.settings),
      canManageUsers: context.role === "superadmin",
      canManageSettings: context.role === "superadmin",
    },
  });
}

export async function POST(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const store = context.store;
  if (!roleCanCreateUsers(context.role, store.settings)) {
    return NextResponse.json({ error: "user_creation_disabled" }, { status: 403 });
  }

  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  if (context.role === "admin" && parsed.data.role !== "user") {
    return NextResponse.json({ error: "admin_can_only_create_users" }, { status: 403 });
  }

  // Snapshot the new account's target platform:
  // - superadmin: honour an explicit choice (validated), else leave unassigned.
  // - admin: inherit the admin's own assigned platform at creation time.
  let targetBackend: string | null = null;
  if (context.role === "superadmin") {
    if (parsed.data.targetBackend != null) {
      const { items } = await selectableBackends();
      if (!items.some((item) => item.ref === parsed.data.targetBackend)) {
        return NextResponse.json({ error: "invalid_target_backend" }, { status: 400 });
      }
      targetBackend = parsed.data.targetBackend;
    }
  } else {
    targetBackend = context.targetBackend;
  }

  try {
    const account = await createLocalAccount({ ...parsed.data, createdBy: context.session.userId, targetBackend });
    await addAuditEvent({
      actorId: context.session.userId,
      actorName: context.session.displayName,
      actorRole: context.role,
      action: "user.create",
      targetId: account.id,
      details: `${account.username}:${account.role}`,
    });
    return NextResponse.json({ ok: true, account: toPublicAccount(account) }, { status: 201 });
  } catch (error) {
    if (error instanceof AccountStoreError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 409 });
    }

    console.error("[admin.users.create] failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "user_create_failed" }, { status: 500 });
  }
}
