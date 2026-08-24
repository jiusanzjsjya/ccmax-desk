import AdminLoginForm from "@/components/admin-login-form";
import LogoutButton from "@/components/logout-button";
import ProvisioningPanel from "@/components/provisioning-panel";
import { env } from "@/lib/env";
import { getCurrentSession } from "@/lib/session";

export default async function Home() {
  const session = await getCurrentSession();

  return (
    <main className="shell">
      <div className="grain" />
      <section className="panel">
        <div className="story">
          <div>
            <div className="brand">
              <span className="brand-mark">C</span>
              CCMax / Desk
            </div>
            <p className="eyebrow" style={{ marginTop: 70 }}>
              Sub2API provisioning bridge
            </p>
            <h1>授权，接入，开始。</h1>
            <p className="story-copy">
              为获得授权的 Claude Code Max 账号准备的 Sub2API 管理接入台。授权码和账号凭据只在服务端流转。
            </p>
          </div>
          <div className="story-footer">
            <span>ADMIN ACCESS / 01</span>
            <span>
              <strong>CCMax Login Desk</strong>
              Sub2API account bridge
            </span>
          </div>
        </div>

        <div className="form-side">
          <div className="form-card wide">
            {session ? (
              <>
                <div className="panel-heading-row">
                  <div>
                    <p className="label">管理员工作台</p>
                    <h2>接入 Claude 账号</h2>
                  </div>
                  <LogoutButton />
                </div>
                <p className="form-intro">
                  通过 Sub2API 官方管理接口完成 Claude OAuth，并创建一个 `anthropic/oauth` 账号池条目。
                </p>
                <ProvisioningPanel
                  adminConfigured={env.isAdminConfigured}
                  sub2ApiConfigured={env.isSub2ApiConfigured}
                />
              </>
            ) : (
              <>
                <p className="label">受保护入口</p>
                <h2>管理员登录</h2>
                <p className="form-intro">只有受控管理员可以发起 Sub2API 账号接入，普通访客不会看到授权流程。</p>
                <AdminLoginForm configured={env.isAdminConfigured} />
                <div className="status-box">
                  <span className="status-label">启动前检查</span>
                  <br />
                  {env.isAdminConfigured
                    ? "管理员访问密钥已配置。"
                    : "请先在 .env.local 中配置 ADMIN_ACCESS_KEY。"}
                  <br />
                  {env.isSub2ApiConfigured
                    ? "Sub2API 管理令牌已配置。"
                    : "请同时配置 SUB2API_ADMIN_TOKEN。"}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
