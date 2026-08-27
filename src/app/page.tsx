import AdminLoginForm from "@/components/admin-login-form";
import ThemeToggle from "@/components/theme-toggle";
import { env } from "@/lib/env";
import { getCurrentSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getCurrentSession();

  if (session) {
    redirect("/dashboard");
  }

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
            <h1>
              <span>授权，</span>
              <span>接入，</span>
              <span>开始。</span>
            </h1>
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
            <div className="login-topbar">
              <ThemeToggle />
            </div>
            <>
              <p className="label">受保护入口</p>
              <h2>登录</h2>
              <p className="form-intro">使用账号密码登录，进入 Claude 授权工作台。</p>
              <AdminLoginForm configured={env.isSuperadminConfigured} />
            </>
          </div>
        </div>
      </section>
    </main>
  );
}
