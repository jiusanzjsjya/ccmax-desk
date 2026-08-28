import { NextResponse } from "next/server";

import { getAccessContext, settlementScope } from "@/lib/access";
import { type PoolOwnership } from "@/lib/account-store";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { refKind } from "@/lib/backends/kinds";
import { env } from "@/lib/env";
import { roleLabel } from "@/lib/roles";
import { buildSettlementRows, type SettlementSummary, type UserUsage } from "@/lib/settlement";
import { fetchPoolUsage, type PoolUsage } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

type BasicUser = { id: string; username: string; displayName: string; role: import("@/lib/roles").Role; disabled: boolean };

/**
 * Settlement / data-analysis summary. Rolls up real Sub2API usage cost per user
 * (from the accounts they onboarded, via the local ownership map) and merges it
 * with the manual settlement/prepay ledger. Scoped by role: superadmin sees all,
 * admin sees self + regular users, a user sees only themselves.
 */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!context.store.settings.settlementModuleEnabled) {
    return NextResponse.json({ error: "settlement_disabled" }, { status: 403 });
  }

  const scope = settlementScope(context);

  // Visible user set: env superadmin (if configured) + local accounts, filtered.
  const allUsers: BasicUser[] = [];
  if (env.isSuperadminConfigured) {
    allUsers.push({
      id: "env-superadmin",
      username: env.SUPERADMIN_USERNAME,
      displayName: roleLabel("superadmin"),
      role: "superadmin",
      disabled: false,
    });
  }
  for (const account of context.store.accounts) {
    allUsers.push({
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      disabled: account.disabled,
    });
  }
  const scopeIds = scope.userIds;
  const users = scopeIds === "all" ? allUsers : allUsers.filter((user) => scopeIds.has(user.id));
  const visibleIds = new Set(users.map((user) => user.id));

  // Ledger scoped to visible users.
  const ledger = context.store.ledger.filter((entry) => visibleIds.has(entry.userId));

  // Real usage: map each visible user's Sub2API-owned accounts, fetch usage once.
  const usageByUser = new Map<string, UserUsage>();
  let usageAvailable = false;

  const ownedByUser = new Map<string, string[]>();
  for (const item of context.store.poolOwnership as PoolOwnership[]) {
    if (refKind(item.platform) !== "sub2api") continue;
    if (!visibleIds.has(item.ownerId)) continue;
    const list = ownedByUser.get(item.ownerId);
    if (list) list.push(item.accountId);
    else ownedByUser.set(item.ownerId, [item.accountId]);
  }

  if (ownedByUser.size > 0 && (await isSub2ApiConfigured())) {
    const allIds = [...new Set([...ownedByUser.values()].flat())]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const usageById: Record<string, PoolUsage> = allIds.length ? await fetchPoolUsage(allIds).catch(() => ({})) : {};
    usageAvailable = true;

    for (const [ownerId, accountIds] of ownedByUser) {
      let accrued = 0;
      let todayCost = 0;
      let requests = 0;
      for (const accountId of accountIds) {
        const usage = usageById[String(accountId)];
        if (!usage) continue;
        accrued += usage.thirtyDay?.cost ?? 0;
        todayCost += usage.today?.cost ?? 0;
        requests += usage.thirtyDay?.requests ?? 0;
      }
      usageByUser.set(ownerId, { accountCount: accountIds.length, accrued, todayCost, requests });
    }
  } else {
    // Sub2API unavailable: still report how many accounts each user owns.
    for (const [ownerId, accountIds] of ownedByUser) {
      usageByUser.set(ownerId, { accountCount: accountIds.length, accrued: 0, todayCost: 0, requests: 0 });
    }
  }

  const { rows, totals } = buildSettlementRows(users, ledger, usageByUser);

  const summary: SettlementSummary = {
    rows,
    totals,
    usageAvailable,
    canWrite: context.role !== "user",
  };

  return NextResponse.json(summary);
}
