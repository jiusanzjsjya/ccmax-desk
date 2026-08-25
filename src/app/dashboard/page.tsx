import { redirect } from "next/navigation";

import LogoutButton from "@/components/logout-button";
import ProvisioningPanel from "@/components/provisioning-panel";
import { env } from "@/lib/env";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/");
  }

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
                <p className="label">管理员工作台</p>
                <h2>接入 Claude 账号</h2>
              </div>
              <LogoutButton />
            </div>
            <p className="form-intro">
              按向导完成一次授权。外部授权页会在新标签打开，完成后回到这里提交 code#state。
            </p>
            <ProvisioningPanel
              adminConfigured={env.isAdminConfigured}
              sub2ApiConfigured={env.isSub2ApiConfigured}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
