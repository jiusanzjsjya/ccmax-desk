"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/context";
import { roleLabel, type Role } from "@/lib/roles";

type AccountManagementPanelProps = {
  role: Exclude<Role, "user">;
};

type ManagedAccount = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  disabled: boolean;
  createdAt: string;
  createdBy: string;
  lastLoginAt: string | null;
};

type Settings = {
  provisioningEnabled: boolean;
  allowAdminCreateUsers: boolean;
  allowUserProvisioning: boolean;
  allowAdminAccountPoolView: boolean;
  allowUserAccountPoolView: boolean;
  scopeAccountPoolByOwner: boolean;
  settlementModuleEnabled: boolean;
  allowUserCustomProxy: boolean;
  allowUserSelectBackend: boolean;
  allowUserLedgerWrite: boolean;
};

const emptySettings: Settings = {
  provisioningEnabled: true,
  allowAdminCreateUsers: true,
  allowUserProvisioning: true,
  allowAdminAccountPoolView: true,
  allowUserAccountPoolView: false,
  scopeAccountPoolByOwner: true,
  settlementModuleEnabled: true,
  allowUserCustomProxy: true,
  allowUserSelectBackend: true,
  allowUserLedgerWrite: false,
};

export default function AccountManagementPanel({ role }: AccountManagementPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">(role === "superadmin" ? "admin" : "user");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isSuperadmin = role === "superadmin";
  const redirectToLogin = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        items?: ManagedAccount[];
        settings?: Settings;
        error?: string;
      };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.items) {
        setError(t(readManagementError(response.status, payload.error)));
        return;
      }

      setAccounts(payload.items);
      if (payload.settings) setSettings(payload.settings);
    } catch {
      setError(t("无法读取本地账号管理数据。"));
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName, password, role: newRole }),
      });
      const payload = (await response.json().catch(() => ({}))) as { account?: ManagedAccount; message?: string; error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.account) {
        setError(payload.message || t(readManagementError(response.status, payload.error)));
        return;
      }

      setAccounts((current) => [payload.account as ManagedAccount, ...current]);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setMessage(t("账号 {name} 已创建。", { name: payload.account.username }));
      if (isSuperadmin) void refresh();
    } catch {
      setError(t("创建账号失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  async function updateAccount(account: ManagedAccount, patch: { role?: "admin" | "user"; disabled?: boolean }) {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/admin/users/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json().catch(() => ({}))) as { account?: ManagedAccount; error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.account) {
        setError(t(readManagementError(response.status, payload.error)));
        return;
      }

      setAccounts((current) => current.map((item) => (item.id === account.id ? payload.account as ManagedAccount : item)));
      setMessage(t("账号 {name} 的权限状态已更新。", { name: account.username }));
      void refresh();
    } catch {
      setError(t("更新账号失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(account: ManagedAccount) {
    if (!window.confirm(t("确定删除本地账号 {name} 吗？这不会删除 Sub2API 账号。", { name: account.username }))) return;
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/admin/users/${account.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok) {
        setError(t(readManagementError(response.status, payload.error)));
        return;
      }

      setAccounts((current) => current.filter((item) => item.id !== account.id));
      setMessage(t("账号 {name} 已删除。", { name: account.username }));
      void refresh();
    } catch {
      setError(t("删除账号失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(account: ManagedAccount) {
    const nextPassword = window.prompt(t("为 {name} 设置新密码（至少 10 位）", { name: account.username }));
    if (!nextPassword) return;
    if (nextPassword.length < 10) {
      setError(t("新密码至少需要 10 位。"));
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${account.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: nextPassword }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok) {
        setError(t(readManagementError(response.status, payload.error)));
        return;
      }
      setMessage(t("账号 {name} 的密码已重置。", { name: account.username }));
      void refresh();
    } catch {
      setError(t("重置密码失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  async function updateSetting(key: keyof Settings, value: boolean) {
    if (!isSuperadmin) return;
    setSettings((current) => ({ ...current, [key]: value }));
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const payload = (await response.json().catch(() => ({}))) as { settings?: Settings; error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.settings) {
        setError(t(readManagementError(response.status, payload.error)));
        await refresh();
        return;
      }

      setSettings(payload.settings);
      setMessage(t("系统开关已保存。"));
      void refresh();
      // Some toggles (e.g. the settlement module) gate server-rendered nav items,
      // so re-run the dashboard server component to reflect visibility changes.
      router.refresh();
    } catch {
      setError(t("保存系统开关失败。"));
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-management" aria-labelledby="account-management-title">
      <div className="management-heading">
        <div>
          <p className="label">{t("权限控制台")}</p>
          <h3 id="account-management-title">{t("账号与权限")}</h3>
        </div>
        <span className="role-chip">{t("当前身份")} / {t(roleLabel(role))}</span>
      </div>

      <div className="management-grid">
        <form className="management-form" onSubmit={createUser}>
          <div>
            <p className="management-kicker">{t("创建本地账号")}</p>
            <p className="management-help">{t("账号用于登录本台，不会创建或修改 Claude 账号。")}</p>
          </div>
          <label className="field-label" htmlFor="new-account-username">{t("登录名")}</label>
          <input
            id="new-account-username"
            className="text-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("例如：ops-user")}
            autoComplete="off"
            disabled={saving}
          />
          <label className="field-label" htmlFor="new-account-display-name">{t("显示名称")}</label>
          <input
            id="new-account-display-name"
            className="text-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t("例如：运营一组")}
            autoComplete="off"
            disabled={saving}
          />
          {isSuperadmin ? (
            <>
              <label className="field-label" htmlFor="new-account-role">{t("角色")}</label>
              <select id="new-account-role" className="text-input" value={newRole} onChange={(event) => setNewRole(event.target.value as "admin" | "user")} disabled={saving}>
                <option value="admin">{t("管理员")}</option>
                <option value="user">{t("普通用户")}</option>
              </select>
            </>
          ) : null}
          <label className="field-label" htmlFor="new-account-password">{t("初始密码")}</label>
          <input
            id="new-account-password"
            className="text-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("至少 10 位")}
            autoComplete="new-password"
            disabled={saving}
          />
          <button className="oauth-button" type="submit" disabled={saving || !username || !displayName || password.length < 10}>
            {saving ? t("保存中...") : isSuperadmin ? t("创建账号") : t("创建普通用户")}
          </button>
        </form>

        <div className="settings-panel">
          <div>
            <p className="management-kicker">{t("系统开关")}</p>
            <p className="management-help">{t("只有超级管理员可以修改全局权限边界。")}</p>
          </div>
          <SettingToggle label={t("允许 Claude 上号流程")} checked={settings.provisioningEnabled} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("provisioningEnabled", value)} />
          <SettingToggle label={t("允许管理员创建普通用户")} checked={settings.allowAdminCreateUsers} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowAdminCreateUsers", value)} />
          <SettingToggle label={t("允许普通用户上号")} checked={settings.allowUserProvisioning} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserProvisioning", value)} />
          <SettingToggle label={t("管理员查看账号池")} checked={settings.allowAdminAccountPoolView} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowAdminAccountPoolView", value)} />
          <SettingToggle label={t("普通用户查看账号池")} checked={settings.allowUserAccountPoolView} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserAccountPoolView", value)} />
          <SettingToggle label={t("普通用户仅见本人上号的账号")} checked={settings.scopeAccountPoolByOwner} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("scopeAccountPoolByOwner", value)} />
          <SettingToggle label={t("启用数据分析结算模块")} checked={settings.settlementModuleEnabled} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("settlementModuleEnabled", value)} />
          <SettingToggle label={t("允许普通用户使用自建代理")} checked={settings.allowUserCustomProxy} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserCustomProxy", value)} />
          <SettingToggle label={t("允许普通用户选择目标平台")} checked={settings.allowUserSelectBackend} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserSelectBackend", value)} />
          <SettingToggle label={t("允许普通用户结算台账记账")} checked={settings.allowUserLedgerWrite} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserLedgerWrite", value)} />
        </div>
      </div>

      {message ? <div className="status-box" role="status">{message}</div> : null}
      {error ? <div className="error-box" role="alert">{error}</div> : null}

      <div className="managed-users">
        <div className="management-section-heading">
          <div>
            <p className="management-kicker">{t("本地账号")}</p>
            <p className="management-help">{t("密码只保存为不可逆哈希，列表不会返回密码。")}</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading || saving}>
            {loading ? t("读取中...") : t("刷新列表")}
          </button>
        </div>
        {accounts.length ? (
          <div className="managed-user-list">
            {accounts.map((account) => (
              <article className={`managed-user-row ${account.disabled ? "is-disabled" : ""}`} key={account.id}>
                <div className="managed-user-identity">
                  <strong>{account.displayName}</strong>
                  <span>@{account.username} · {t("创建于 {date}", { date: formatDate(account.createdAt) })}</span>
                </div>
                <div className="managed-user-actions">
                  {isSuperadmin ? (
                    <select className="role-select" value={account.role} onChange={(event) => void updateAccount(account, { role: event.target.value as "admin" | "user" })} disabled={saving} aria-label={t("{name} 角色", { name: account.username })}>
                      <option value="admin">{t("管理员")}</option>
                      <option value="user">{t("普通用户")}</option>
                    </select>
                  ) : (
                    <span className="role-chip">{t(roleLabel(account.role))}</span>
                  )}
                  <span className={`account-status ${account.disabled ? "is-dead" : "is-alive"}`}>{account.disabled ? t("已停用") : t("正常")}</span>
                  {isSuperadmin ? (
                    <button className="secondary-button compact-button" type="button" onClick={() => void updateAccount(account, { disabled: !account.disabled })} disabled={saving}>
                      {account.disabled ? t("启用") : t("停用")}
                    </button>
                  ) : null}
                  {isSuperadmin ? (
                    <button className="danger-button" type="button" onClick={() => void deleteAccount(account)} disabled={saving}>
                      {t("删除")}
                    </button>
                  ) : null}
                  {isSuperadmin ? (
                    <button className="secondary-button compact-button" type="button" onClick={() => void resetPassword(account)} disabled={saving}>
                      {t("重置密码")}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">{t("还没有本地账号。先创建一个管理员或普通用户。")}</p>
        )}
      </div>

    </section>
  );
}

function SettingToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`setting-toggle ${disabled ? "is-disabled" : ""}`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function readManagementError(status: number, error?: string) {
  if (status === 401) return "管理员会话已失效，请重新登录。";
  if (status === 403) return "当前角色或系统开关不允许执行此操作。";
  if (status === 409 || error === "duplicate_username") return "该登录名已存在，请换一个。";
  return error || "账号管理请求失败。";
}

function redirectOnUnauthorized(response: Response, redirectToLogin: () => void) {
  if (response.status !== 401) return false;
  redirectToLogin();
  return true;
}
