"use client";

import AdminLoginForm from "@/components/admin-login-form";
import LocaleToggle from "@/components/locale-toggle";
import ThemeToggle from "@/components/theme-toggle";
import { useI18n } from "@/lib/i18n/context";

/** Login-page presentation. Kept client-side so the copy is translatable. */
export default function LoginDesk({ configured }: { configured: boolean }) {
  const { t } = useI18n();

  return (
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
            <span>{t("授权，")}</span>
            <span>{t("接入，")}</span>
            <span>{t("开始。")}</span>
          </h1>
          <p className="story-copy">
            {t("为获得授权的 Claude Code Max 账号准备的 Sub2API 管理接入台。授权码和账号凭据只在服务端流转。")}
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
            <LocaleToggle />
            <ThemeToggle />
          </div>
          <>
            <p className="label">{t("受保护入口")}</p>
            <h2>{t("登录")}</h2>
            <p className="form-intro">{t("使用账号密码登录，进入 Claude 授权工作台。")}</p>
            <AdminLoginForm configured={configured} />
          </>
        </div>
      </div>
    </section>
  );
}
