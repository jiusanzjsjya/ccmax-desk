import { getAccountStore, findLocalAccountById, type LocalAccountStore } from "@/lib/account-store";
import { getCurrentSession, type AdminSession } from "@/lib/session";
import type { Role } from "@/lib/roles";

export type AccessContext = {
  session: AdminSession;
  role: Role;
  store: LocalAccountStore;
};

export async function getAccessContext(): Promise<AccessContext | null> {
  const session = await getCurrentSession();
  if (!session) return null;

  if (session.userId === "env-superadmin") {
    return { session, role: "superadmin", store: await getAccountStore() };
  }

  const account = await findLocalAccountById(session.userId);
  if (!account || account.disabled) return null;

  return {
    session: {
      ...session,
      userId: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
    },
    role: account.role,
    store: await getAccountStore(),
  };
}

export function provisioningAccess(context: AccessContext) {
  if (!context.store.settings.provisioningEnabled) {
    return { allowed: false, status: 503, error: "provisioning_disabled" } as const;
  }

  if (context.role === "user" && !context.store.settings.allowUserProvisioning) {
    return { allowed: false, status: 403, error: "user_provisioning_disabled" } as const;
  }

  return { allowed: true, status: 200, error: null } as const;
}

export function accountPoolAccess(context: AccessContext) {
  if (context.role === "superadmin") return true;
  if (context.role === "admin") return context.store.settings.allowAdminAccountPoolView;
  return context.store.settings.allowUserAccountPoolView;
}

export function roleCanCreateUsers(role: Role, settings: AccessContext["store"]["settings"]) {
  return role === "superadmin" || (role === "admin" && settings.allowAdminCreateUsers);
}
