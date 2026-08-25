"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
};

type AuditEvent = {
  id: string;
  actorName: string;
  actorRole: Role;
  action: string;
  targetId?: string;
  details?: string;
  createdAt: string;
};

const emptySettings: Settings = {
  provisioningEnabled: true,
  allowAdminCreateUsers: true,
  allowUserProvisioning: true,
  allowAdminAccountPoolView: true,
  allowUserAccountPoolView: false,
};

export default function AccountManagementPanel({ role }: AccountManagementPanelProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
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
        setError(readManagementError(response.status, payload.error));
        return;
      }

      setAccounts(payload.items);
      if (payload.settings) setSettings(payload.settings);

      if (isSuperadmin) {
        const auditResponse = await fetch("/api/admin/audit", { cache: "no-store" });
        const auditPayload = (await auditResponse.json().catch(() => ({}))) as { items?: AuditEvent[] };
        if (redirectOnUnauthorized(auditResponse, redirectToLogin)) return;
        if (auditResponse.ok && auditPayload.items) setAudit(auditPayload.items);
      }
    } catch {
      setError("无法读取本地账号管理数据。");
    } finally {
      setLoading(false);
    }
  }, [isSuperadmin, redirectToLogin]);

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
        setError(payload.message || readManagementError(response.status, payload.error));
        return;
      }

      setAccounts((current) => [payload.account as ManagedAccount, ...current]);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setMessage(`账号 ${payload.account.username} 已创建。`);
      if (isSuperadmin) void refresh();
    } catch {
      setError("创建账号失败，请检查本地服务状态。");
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
        setError(readManagementError(response.status, payload.error));
        return;
      }

      setAccounts((current) => current.map((item) => (item.id === account.id ? payload.account as ManagedAccount : item)));
      setMessage(`账号 ${account.username} 的权限状态已更新。`);
      void refresh();
    } catch {
      setError("更新账号失败，请检查本地服务状态。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(account: ManagedAccount) {
    if (!window.confirm(`确定删除本地账号 ${account.username} 吗？这不会删除 Sub2API 账号。`)) return;
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/admin/users/${account.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok) {
        setError(readManagementError(response.status, payload.error));
        return;
      }

      setAccounts((current) => current.filter((item) => item.id !== account.id));
      setMessage(`账号 ${account.username} 已删除。`);
      void refresh();
    } catch {
      setError("删除账号失败，请检查本地服务状态。");
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(account: ManagedAccount) {
    const nextPassword = window.prompt(`为 ${account.username} 设置新密码（至少 10 位）`);
    if (!nextPassword) return;
    if (nextPassword.length < 10) {
      setError("新密码至少需要 10 位。");
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
        setError(readManagementError(response.status, payload.error));
        return;
      }
      setMessage(`账号 ${account.username} 的密码已重置。`);
      void refresh();
    } catch {
      setError("重置密码失败，请检查本地服务状态。");
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
        setError(readManagementError(response.status, payload.error));
        await refresh();
        return;
      }

      setSettings(payload.settings);
      setMessage("系统开关已保存。");
      void refresh();
    } catch {
      setError("保存系统开关失败。");
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-management" aria-labelledby="account-management-title">
      <div className="management-heading">
        <div>
          <p className="label">权限控制台</p>
          <h3 id="account-management-title">账号与权限</h3>
        </div>
        <span className="role-chip">当前身份 / {roleLabel(role)}</span>
      </div>

      <div className="management-grid">
        <form className="management-form" onSubmit={createUser}>
          <div>
            <p className="management-kicker">创建本地账号</p>
            <p className="management-help">账号用于登录本台，不会创建或修改 Claude 账号。</p>
          </div>
          <label className="field-label" htmlFor="new-account-username">登录名</label>
          <input
            id="new-account-username"
            className="text-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="例如：ops-user"
            autoComplete="off"
            disabled={saving}
          />
          <label className="field-label" htmlFor="new-account-display-name">显示名称</label>
          <input
            id="new-account-display-name"
            className="text-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="例如：运营一组"
            autoComplete="off"
            disabled={saving}
          />
          {isSuperadmin ? (
            <>
              <label className="field-label" htmlFor="new-account-role">角色</label>
              <select id="new-account-role" className="text-input" value={newRole} onChange={(event) => setNewRole(event.target.value as "admin" | "user")} disabled={saving}>
                <option value="admin">管理员</option>
                <option value="user">普通用户</option>
              </select>
            </>
          ) : null}
          <label className="field-label" htmlFor="new-account-password">初始密码</label>
          <input
            id="new-account-password"
            className="text-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 10 位"
            autoComplete="new-password"
            disabled={saving}
          />
          <button className="oauth-button" type="submit" disabled={saving || !username || !displayName || password.length < 10}>
            {saving ? "保存中..." : isSuperadmin ? "创建账号" : "创建普通用户"}
          </button>
        </form>

        <div className="settings-panel">
          <div>
            <p className="management-kicker">系统开关</p>
            <p className="management-help">只有超级管理员可以修改全局权限边界。</p>
          </div>
          <SettingToggle label="允许 Claude 上号流程" checked={settings.provisioningEnabled} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("provisioningEnabled", value)} />
          <SettingToggle label="允许管理员创建普通用户" checked={settings.allowAdminCreateUsers} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowAdminCreateUsers", value)} />
          <SettingToggle label="允许普通用户上号" checked={settings.allowUserProvisioning} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserProvisioning", value)} />
          <SettingToggle label="管理员查看账号池" checked={settings.allowAdminAccountPoolView} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowAdminAccountPoolView", value)} />
          <SettingToggle label="普通用户查看账号池" checked={settings.allowUserAccountPoolView} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserAccountPoolView", value)} />
        </div>
      </div>

      {message ? <div className="status-box" role="status">{message}</div> : null}
      {error ? <div className="error-box" role="alert">{error}</div> : null}

      <div className="managed-users">
        <div className="management-section-heading">
          <div>
            <p className="management-kicker">本地账号</p>
            <p className="management-help">密码只保存为不可逆哈希，列表不会返回密码。</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading || saving}>
            {loading ? "读取中..." : "刷新列表"}
          </button>
        </div>
        {accounts.length ? (
          <div className="managed-user-list">
            {accounts.map((account) => (
              <article className={`managed-user-row ${account.disabled ? "is-disabled" : ""}`} key={account.id}>
                <div className="managed-user-identity">
                  <strong>{account.displayName}</strong>
                  <span>@{account.username} · 创建于 {formatDate(account.createdAt)}</span>
                </div>
                <div className="managed-user-actions">
                  {isSuperadmin ? (
                    <select className="role-select" value={account.role} onChange={(event) => void updateAccount(account, { role: event.target.value as "admin" | "user" })} disabled={saving} aria-label={`${account.username} 角色`}>
                      <option value="admin">管理员</option>
                      <option value="user">普通用户</option>
                    </select>
                  ) : (
                    <span className="role-chip">{roleLabel(account.role)}</span>
                  )}
                  <span className={`account-status ${account.disabled ? "is-dead" : "is-alive"}`}>{account.disabled ? "已停用" : "正常"}</span>
                  {isSuperadmin ? (
                    <button className="secondary-button compact-button" type="button" onClick={() => void updateAccount(account, { disabled: !account.disabled })} disabled={saving}>
                      {account.disabled ? "启用" : "停用"}
                    </button>
                  ) : null}
                  {isSuperadmin ? (
                    <button className="danger-button" type="button" onClick={() => void deleteAccount(account)} disabled={saving}>
                      删除
                    </button>
                  ) : null}
                  {isSuperadmin ? (
                    <button className="secondary-button compact-button" type="button" onClick={() => void resetPassword(account)} disabled={saving}>
                      重置密码
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">还没有本地账号。先创建一个管理员或普通用户。</p>
        )}
      </div>

      {isSuperadmin ? (
        <div className="audit-panel">
          <div className="management-section-heading">
            <div>
              <p className="management-kicker">审计记录</p>
              <p className="management-help">记录登录、账号变更和系统开关，不记录密码或 OAuth token。</p>
            </div>
          </div>
          {audit.length ? (
            <div className="audit-list">
              {audit.slice(0, 8).map((event) => (
                <div className="audit-row" key={event.id}>
                  <span>{formatDate(event.createdAt)}</span>
                  <strong>{event.actorName}</strong>
                  <code>{event.action}</code>
                </div>
              ))}
            </div>
          ) : <p className="empty-state">暂无审计记录。</p>}
        </div>
      ) : null}
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
