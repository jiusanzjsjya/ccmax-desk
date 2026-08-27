import AdminLoginForm from "@/components/admin-login-form";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { env } from "@/lib/env";
import { getCurrentSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getCurrentSession();

  if (session) {
    redirect("/dashboard");
  }

  const sub2Ready = await isSub2ApiConfigured();

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
            <>
              <p className="label">受保护入口</p>
              <h2>开始授权</h2>
              <p className="form-intro">用账号密码登录后进入三步向导：生成槽位、完成官方授权、提交回执。</p>
              <AdminLoginForm configured={env.isSuperadminConfigured} />
              <div className="status-box">
                <span className="status-label">启动前检查</span>
                <br />
                {env.isSuperadminConfigured
                  ? "超级管理员账号已配置。"
                  : "请先在 .env.local 配置 SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD。"}
                <br />
                {sub2Ready
                  ? "Sub2API 管理令牌已配置。"
                  : "Sub2API 尚未配置，可登录后在超管后台填写。"}
              </div>
            </>
          </div>
        </div>
      </section>
    </main>
  );
}
