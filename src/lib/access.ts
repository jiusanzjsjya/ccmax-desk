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

/**
 * Per-owner scoping for the account pool. Only regular users are scoped (and
 * only when the superadmin toggle is on); admin/superadmin always see the full
 * pool. When scoped, callers must restrict results to `ownerId`'s own accounts.
 */
export function poolScope(context: AccessContext): { scoped: boolean; ownerId: string | null } {
  if (context.role !== "user") return { scoped: false, ownerId: null };
  if (!context.store.settings.scopeAccountPoolByOwner) return { scoped: false, ownerId: null };
  return { scoped: true, ownerId: context.session.userId };
}

export function roleCanCreateUsers(role: Role, settings: AccessContext["store"]["settings"]) {
  return role === "superadmin" || (role === "admin" && settings.allowAdminCreateUsers);
}

/**
 * Which CCMax users a viewer may see in the settlement/analytics module.
 * - superadmin: everyone (`"all"`)
 * - admin: themselves + every regular `user`
 * - user: only themselves
 */
export function settlementScope(context: AccessContext): { userIds: "all" | Set<string> } {
  if (context.role === "superadmin") return { userIds: "all" };

  const visible = new Set<string>([context.session.userId]);
  if (context.role === "admin") {
    for (const account of context.store.accounts) {
      if (account.role === "user") visible.add(account.id);
    }
  }
  return { userIds: visible };
}

/** Whether a viewer may write a ledger entry for `targetUserId`. */
export function canWriteLedger(context: AccessContext, targetUserId: string): boolean {
  if (context.role === "superadmin") return true;
  if (context.role !== "admin") return false;
  if (targetUserId === context.session.userId) return true;
  const target = context.store.accounts.find((account) => account.id === targetUserId);
  return target?.role === "user";
}
