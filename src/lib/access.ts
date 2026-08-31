import {
  getAccountStore,
  findLocalAccountById,
  PROVISIONING_MODULES,
  type AccountPrefix,
  type LocalAccountStore,
  type ProvisioningModule,
} from "@/lib/account-store";
import type { BackendRef } from "@/lib/backends/kinds";
import { getCurrentSession, type AdminSession } from "@/lib/session";
import type { Role } from "@/lib/roles";

export type AccessContext = {
  session: AdminSession;
  role: Role;
  store: LocalAccountStore;
  /**
   * The account's superadmin-assigned platform. `null` for the superadmin (who
   * chooses freely) and for an admin/user with no assignment yet (blocked).
   */
  targetBackend: BackendRef | null;
  /**
   * Provisioning modules this caller may use. The superadmin implicitly has all
   * of them; an admin/user has exactly what the superadmin granted.
   */
  allowedModules: ProvisioningModule[];
};

export async function getAccessContext(): Promise<AccessContext | null> {
  const session = await getCurrentSession();
  if (!session) return null;

  if (session.userId === "env-superadmin") {
    return {
      session,
      role: "superadmin",
      store: await getAccountStore(),
      targetBackend: null,
      allowedModules: [...PROVISIONING_MODULES],
    };
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
    targetBackend: account.targetBackend ?? null,
    allowedModules: account.allowedModules ?? [],
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

/**
 * Whether the caller may use a given provisioning module. superadmin always may;
 * an admin/user only when the superadmin granted it (default-deny). This is the
 * per-module authorization gate for 授权上号 ("onboard") and 授权上key ("key").
 */
export function canUseModule(context: AccessContext, module: ProvisioningModule): boolean {
  if (context.role === "superadmin") return true;
  return context.allowedModules.includes(module);
}

/** Whether the caller may run Claude onboarding (授权上号). */
export function canOnboard(context: AccessContext): boolean {
  return canUseModule(context, "onboard");
}

/** Whether the caller may upload OpenAI API keys (授权上key). */
export function canUploadKey(context: AccessContext): boolean {
  return canUseModule(context, "key");
}

/**
 * Account-pool (账号池统揽, Claude accounts) visibility is bound to the 授权上号
 * grant: whoever may onboard may review the pool they feed. superadmin always.
 */
export function accountPoolAccess(context: AccessContext) {
  return canOnboard(context);
}

/**
 * Per-owner scoping for the account pool. Every non-superadmin is scoped to the
 * accounts they personally onboarded (default-deny visibility of others'), so
 * opening the pool by the onboard grant never leaks the whole pool. superadmin
 * sees everything. When scoped, callers restrict results to `ownerId`.
 */
export function poolScope(context: AccessContext): { scoped: boolean; ownerId: string | null } {
  if (context.role === "superadmin") return { scoped: false, ownerId: null };
  return { scoped: true, ownerId: context.session.userId };
}

export function roleCanCreateUsers(role: Role, settings: AccessContext["store"]["settings"]) {
  return role === "superadmin" || (role === "admin" && settings.allowAdminCreateUsers);
}

/**
 * Egress-proxy visibility/ownership. superadmin sees and manages every proxy;
 * an admin/user only their own. `ownerId` is the caller's id for own-scoping.
 */
export function egressProxyScope(context: AccessContext): { all: boolean; ownerId: string } {
  return { all: context.role === "superadmin", ownerId: context.session.userId };
}

/**
 * Whether the viewer may select/create/test Sub2API egress proxies in provisioning.
 * Only the superadmin may — admin and user are restricted to their own local egress
 * proxies (see {@link egressProxyScope}) and never see the Sub2API proxy selector.
 */
export function canUseCustomProxy(context: AccessContext): boolean {
  return context.role === "superadmin";
}

/**
 * Whether the viewer may freely choose the target platform in the wizard. Only
 * the superadmin may — admin and user are locked to their assigned platform
 * (see {@link effectiveTargetBackend}).
 */
export function canSelectBackend(context: AccessContext): boolean {
  return context.role === "superadmin";
}

/**
 * The platform an admin/user is locked to for onboarding and pool review.
 * - superadmin: `null` (free to target any enabled platform)
 * - admin/user: their superadmin-assigned platform, or `null` when unassigned.
 *   Callers MUST block onboarding/pool access when this is `null` for a
 *   non-superadmin — an unassigned account has no platform to act on.
 */
export function effectiveTargetBackend(context: AccessContext): BackendRef | null {
  if (context.role === "superadmin") return null;
  return context.targetBackend;
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
  if (context.role === "admin") {
    if (targetUserId === context.session.userId) return true;
    const target = context.store.accounts.find((account) => account.id === targetUserId);
    return target?.role === "user";
  }
  // Regular user: only their own ledger, and only when the superadmin toggle is on.
  return context.store.settings.allowUserLedgerWrite && targetUserId === context.session.userId;
}

/** Whether the viewer may write any ledger entry at all (drives the panel's "new entry" affordance). */
export function canWriteAnyLedger(context: AccessContext): boolean {
  return context.role !== "user" || context.store.settings.allowUserLedgerWrite;
}

/**
 * Whether the viewer may manage (add/rename) onboarding prefixes. admin and
 * superadmin may; a regular `user` may only select an existing prefix.
 */
export function canManagePrefixes(context: AccessContext): boolean {
  return context.role !== "user";
}

/**
 * Whether the viewer may delete a specific prefix. superadmin may delete any;
 * an admin may delete only the ones they created; a `user` may not delete.
 */
export function canDeletePrefix(context: AccessContext, prefix: AccountPrefix): boolean {
  if (context.role === "superadmin") return true;
  if (context.role === "admin") return prefix.createdBy === context.session.userId;
  return false;
}

/**
 * Whether the viewer may rename a specific prefix. Same ownership rule as delete:
 * superadmin may edit any; an admin only the ones they created (a superadmin's
 * prefix is view-only to an admin); a `user` may not edit.
 */
export function canEditPrefix(context: AccessContext, prefix: AccountPrefix): boolean {
  return canDeletePrefix(context, prefix);
}
