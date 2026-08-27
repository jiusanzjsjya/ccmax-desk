import { redirect } from "next/navigation";

import AccountManagementPanel from "@/components/account-management-panel";
import BackendConfigPanel from "@/components/backend-config-panel";
import LogoutButton from "@/components/logout-button";
import ProvisioningPanel from "@/components/provisioning-panel";
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
    <main className="shell dashboard-shell">
      <div className="grain" />
      <section className="panel dashboard-panel">
        <div className="story">
          <div>
            <div className="brand">
              <span className="brand-mark">C</span>
              CCMax / Desk
            </div>
            <p className="eyebrow" style={{ marginTop: 70 }}>
              Sub2API provisioning bridge
            </p>
            <h1>
              <span>授权，</span>
              <span>接入，</span>
              <span>开始。</span>
            </h1>
            <p className="story-copy">
              用官方 OAuth 把 Claude Code Max 账号写入 Sub2API。账号凭据只在服务端流转，浏览器只接收状态摘要。
            </p>
          </div>
          <div className="story-footer">
            <span>ADMIN WORKSPACE / 02</span>
            <span>
              <strong>CCMax Login Desk</strong>
              Claude account bridge
            </span>
          </div>
        </div>

        <div className="form-side dashboard-content">
          <div className="form-card wide">
            <div className="panel-heading-row">
              <div>
                <p className="label">{roleLabel(context.role)}工作台</p>
                <h2>接入 Claude 账号</h2>
              </div>
              <LogoutButton />
            </div>
            <p className="form-intro">
              按向导完成一次授权。外部授权页会在新标签打开，完成后回到这里提交 code#state。
            </p>
            <ProvisioningPanel
              adminConfigured={env.isSuperadminConfigured}
              sub2ApiConfigured={sub2Ready}
              canViewAccountPool={accountPoolAccess(context)}
            />
            {context.role !== "user" ? <AccountManagementPanel role={context.role} /> : null}
            {context.role === "superadmin" ? <BackendConfigPanel /> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
