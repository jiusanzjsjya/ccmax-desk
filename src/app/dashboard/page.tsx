import { redirect } from "next/navigation";

import DashboardShell from "@/components/dashboard-shell";
import { accountPoolAccess, getAccessContext } from "@/lib/access";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { env } from "@/lib/env";
import { roleLabel } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const context = await getAccessContext();

  if (!context) {
    redirect("/");
  }

  const sub2Ready = await isSub2ApiConfigured();

  return (
    <DashboardShell
      role={context.role}
      roleLabel={roleLabel(context.role)}
      displayName={context.session.displayName}
      canViewAccountPool={accountPoolAccess(context)}
      sub2ApiConfigured={sub2Ready}
      superadminConfigured={env.isSuperadminConfigured}
    />
  );
}
