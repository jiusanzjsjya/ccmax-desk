"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/context";
import { roleLabel, type Role } from "@/lib/roles";

type AccountManagementPanelProps = {
  role: Exclude<Role, "user">;
};

/** Provisioning modules the superadmin can grant per account (授权上号 / 授权上key). */
type ModuleKey = "onboard" | "key";
const MODULE_OPTIONS: { key: ModuleKey; label: string }[] = [
  { key: "onboard", label: "授权上号" },
  { key: "key", label: "授权上key" },
];

type ManagedAccount = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  disabled: boolean;
  createdAt: string;
  createdBy: string;
  lastLoginAt: string | null;
  /** Superadmin-assigned onboarding/pool platform; null = unassigned. */
  targetBackend: string | null;
  /** Granted provisioning modules; default-deny beyond what is listed. */
  allowedModules: ModuleKey[];
};

/** An assignable target platform (enabled + configured), from the users API. */
type Platform = { ref: string; kind: string; label: string };

type Settings = {
  provisioningEnabled: boolean;
  allowAdminCreateUsers: boolean;
  allowUserProvisioning: boolean;
  settlementModuleEnabled: boolean;
  allowUserLedgerWrite: boolean;
  forcedPrefixEnabled: boolean;
  forcedProxyEnabled: boolean;
  openaiKeyMonitorEnabled: boolean;
  openaiKeyMonitorIntervalMinutes: number;
  openaiKeyMonitorThreshold: number;
  openaiUploadBaseUrl: string;
  openaiUploadConcurrency: number;
  openaiUploadPriority: number;
  openaiUploadValidateKey: boolean;
};

type PrefixItem = {
  id: string;
  value: string;
  createdBy: string;
  createdByName: string;
  createdByRole: Role;
  createdAt: string;
  updatedAt: string;
};

const emptySettings: Settings = {
  provisioningEnabled: true,
  allowAdminCreateUsers: true,
  allowUserProvisioning: true,
  settlementModuleEnabled: true,
  allowUserLedgerWrite: false,
  forcedPrefixEnabled: false,
  forcedProxyEnabled: false,
  openaiKeyMonitorEnabled: false,
  openaiKeyMonitorIntervalMinutes: 5,
  openaiKeyMonitorThreshold: 1,
  openaiUploadBaseUrl: "https://api.openai.com",
  openaiUploadConcurrency: 2500,
  openaiUploadPriority: 1,
  openaiUploadValidateKey: true,
};

/** In-app modal state — replaces window.confirm/prompt (blocked in embedded/WebView contexts). */
type DialogState =
  | { kind: "confirm"; title: string; danger?: boolean; confirmLabel?: string; onConfirm: () => void | Promise<void> }
  | {
      kind: "prompt";
      title: string;
      label?: string;
      initial?: string;
      inputType?: "text" | "password";
      confirmLabel?: string;
      onConfirm: (value: string) => void | Promise<void>;
    };

export default function AccountManagementPanel({ role }: AccountManagementPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [newTargetBackend, setNewTargetBackend] = useState("");
  const [newModules, setNewModules] = useState<ModuleKey[]>(["onboard"]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [prefixes, setPrefixes] = useState<PrefixItem[]>([]);
  const [newPrefix, setNewPrefix] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">(role === "superadmin" ? "admin" : "user");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogInput, setDialogInput] = useState("");

  const isSuperadmin = role === "superadmin";

  function openConfirm(opts: Omit<Extract<DialogState, { kind: "confirm" }>, "kind">) {
    setDialog({ kind: "confirm", ...opts });
  }
  function openPrompt(opts: Omit<Extract<DialogState, { kind: "prompt" }>, "kind">) {
    setDialogInput(opts.initial ?? "");
    setDialog({ kind: "prompt", ...opts });
  }
  function closeDialog() {
    setDialog(null);
    setDialogInput("");
  }
  async function confirmDialog() {
    const current = dialog;
    if (!current) return;
    const value = dialogInput;
    closeDialog();
    if (current.kind === "prompt") await current.onConfirm(value);
    else await current.onConfirm();
  }
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
        assignablePlatforms?: Platform[];
        currentUser?: { id: string };
        error?: string;
      };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.items) {
        setError(t(readManagementError(response.status, payload.error)));
        return;
      }

      setAccounts(payload.items);
      if (payload.settings) setSettings(payload.settings);
      if (payload.assignablePlatforms) setPlatforms(payload.assignablePlatforms);
      if (payload.currentUser) setCurrentUserId(payload.currentUser.id);
    } catch {
      setError(t("无法读取本地账号管理数据。"));
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin, t]);

  const refreshPrefixes = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/prefixes", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { items?: PrefixItem[] };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (response.ok && payload.items) setPrefixes(payload.items);
    } catch {
      // Prefix list is best-effort; the management block just shows empty on failure.
    }
  }, [redirectToLogin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
      void refreshPrefixes();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh, refreshPrefixes]);

  async function addPrefix(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = newPrefix.trim();
    if (!value) return;
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/prefixes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok) {
        setError(response.status === 409 ? t("该前缀已存在，请换一个。") : t(readManagementError(response.status, payload.error)));
        return;
      }
      setNewPrefix("");
      setMessage(t("前缀 {value} 已添加。", { value }));
      void refreshPrefixes();
    } catch {
      setError(t("添加前缀失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  function renamePrefix(prefix: PrefixItem) {
    openPrompt({
      title: t("修改前缀（当前：{value}）", { value: prefix.value }),
      label: t("新前缀"),
      initial: prefix.value,
      confirmLabel: t("保存"),
      onConfirm: (next) => {
        const value = next.trim();
        if (!value || value === prefix.value) return;
        return submitRenamePrefix(prefix, value);
      },
    });
  }

  async function submitRenamePrefix(prefix: PrefixItem, value: string) {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/admin/prefixes/${prefix.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok) {
        setError(response.status === 409 ? t("该前缀已存在，请换一个。") : t(readManagementError(response.status, payload.error)));
        return;
      }
      setMessage(t("前缀已更新为 {value}。", { value }));
      void refreshPrefixes();
    } catch {
      setError(t("更新前缀失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  function removePrefix(prefix: PrefixItem) {
    openConfirm({
      title: t("确定删除前缀 {value} 吗？", { value: prefix.value }),
      danger: true,
      confirmLabel: t("删除"),
      onConfirm: () => submitRemovePrefix(prefix),
    });
  }

  async function submitRemovePrefix(prefix: PrefixItem) {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/admin/prefixes/${prefix.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok) {
        setError(t(readManagementError(response.status, payload.error)));
        return;
      }
      setMessage(t("前缀 {value} 已删除。", { value: prefix.value }));
      void refreshPrefixes();
    } catch {
      setError(t("删除前缀失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          displayName,
          password,
          role: newRole,
          // Only the superadmin picks a platform + modules; an admin's new user
          // inherits the admin's platform and module grants.
          ...(isSuperadmin ? { targetBackend: newTargetBackend || null, allowedModules: newModules } : {}),
        }),
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
      setNewTargetBackend("");
      setNewModules(["onboard"]);
      setMessage(t("账号 {name} 已创建。", { name: payload.account.username }));
      if (isSuperadmin) void refresh();
    } catch {
      setError(t("创建账号失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  function toggleAccountModule(account: ManagedAccount, module: ModuleKey, checked: boolean) {
    const set = new Set(account.allowedModules ?? []);
    if (checked) set.add(module);
    else set.delete(module);
    void updateAccount(account, { allowedModules: MODULE_OPTIONS.map((option) => option.key).filter((key) => set.has(key)) });
  }

  async function updateAccount(
    account: ManagedAccount,
    patch: { role?: "admin" | "user"; disabled?: boolean; targetBackend?: string | null; allowedModules?: ModuleKey[] },
  ) {
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

  function deleteAccount(account: ManagedAccount) {
    openConfirm({
      title: t("确定删除本地账号 {name} 吗？这不会删除 Sub2API 账号。", { name: account.username }),
      danger: true,
      confirmLabel: t("删除"),
      onConfirm: () => submitDeleteAccount(account),
    });
  }

  async function submitDeleteAccount(account: ManagedAccount) {
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

  function resetPassword(account: ManagedAccount) {
    openPrompt({
      title: t("为 {name} 设置新密码（至少 10 位）", { name: account.username }),
      label: t("新密码"),
      inputType: "password",
      confirmLabel: t("重置"),
      onConfirm: (nextPassword) => {
        if (!nextPassword) return;
        if (nextPassword.length < 10) {
          setError(t("新密码至少需要 10 位。"));
          return;
        }
        return submitResetPassword(account, nextPassword);
      },
    });
  }

  async function submitResetPassword(account: ManagedAccount, nextPassword: string) {
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

  async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
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
              <label className="field-label" htmlFor="new-account-backend">{t("目标平台")}</label>
              <select id="new-account-backend" className="text-input" value={newTargetBackend} onChange={(event) => setNewTargetBackend(event.target.value)} disabled={saving}>
                <option value="">{t("暂不分配")}</option>
                {platforms.map((platform) => (
                  <option key={platform.ref} value={platform.ref}>{platform.label}</option>
                ))}
              </select>
              <p className="management-help">{t("上号与账号池将锁定在此平台；管理员创建的用户会继承管理员的平台。")}</p>
              <span className="field-label">{t("授权模块")}</span>
              <div className="module-grant">
                {MODULE_OPTIONS.map((option) => (
                  <label key={option.key} className="module-grant-option">
                    <input
                      type="checkbox"
                      checked={newModules.includes(option.key)}
                      onChange={(event) =>
                        setNewModules((current) =>
                          event.target.checked
                            ? MODULE_OPTIONS.map((item) => item.key).filter((key) => key === option.key || current.includes(key))
                            : current.filter((key) => key !== option.key),
                        )
                      }
                      disabled={saving}
                    />
                    <span>{t(option.label)}</span>
                  </label>
                ))}
              </div>
              <p className="management-help">{t("未勾选的模块默认不可用；管理员创建的用户会继承管理员的模块。")}</p>
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

        {isSuperadmin ? (
        <div className="settings-panel">
          <div>
            <p className="management-kicker">{t("系统开关")}</p>
            <p className="management-help">{t("只有超级管理员可以修改全局权限边界。")}</p>
          </div>
          <SettingToggle label={t("允许 Claude 上号流程")} checked={settings.provisioningEnabled} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("provisioningEnabled", value)} />
          <SettingToggle label={t("允许管理员创建普通用户")} checked={settings.allowAdminCreateUsers} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowAdminCreateUsers", value)} />
          <SettingToggle label={t("允许普通用户上号")} checked={settings.allowUserProvisioning} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserProvisioning", value)} />
          <SettingToggle label={t("启用数据分析结算模块")} checked={settings.settlementModuleEnabled} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("settlementModuleEnabled", value)} />
          <SettingToggle label={t("允许普通用户结算台账记账")} checked={settings.allowUserLedgerWrite} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("allowUserLedgerWrite", value)} />
          <SettingToggle label={t("启用强制前缀")} checked={settings.forcedPrefixEnabled} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("forcedPrefixEnabled", value)} />
          <SettingToggle label={t("上号强制选择出口代理")} checked={settings.forcedProxyEnabled} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("forcedProxyEnabled", value)} />
          <SettingToggle label={t("启用 OpenAI Key 监控（自动禁用死/报错 Key）")} checked={settings.openaiKeyMonitorEnabled} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("openaiKeyMonitorEnabled", value)} />
          <div className="monitor-config">
            <label className="field-label" htmlFor="monitor-interval">{t("监控巡检周期（分钟）")}</label>
            <input
              id="monitor-interval"
              className="text-input"
              type="number"
              min={1}
              max={1440}
              value={settings.openaiKeyMonitorIntervalMinutes}
              disabled={!isSuperadmin || saving}
              onChange={(e) => setSettings((c) => ({ ...c, openaiKeyMonitorIntervalMinutes: clampInt(e.target.value, 1, 1440) }))}
              onBlur={() => void updateSetting("openaiKeyMonitorIntervalMinutes", settings.openaiKeyMonitorIntervalMinutes)}
            />
            <label className="field-label" htmlFor="monitor-threshold">{t("连续异常禁用阈值（次，1=立即）")}</label>
            <input
              id="monitor-threshold"
              className="text-input"
              type="number"
              min={1}
              max={100}
              value={settings.openaiKeyMonitorThreshold}
              disabled={!isSuperadmin || saving}
              onChange={(e) => setSettings((c) => ({ ...c, openaiKeyMonitorThreshold: clampInt(e.target.value, 1, 100) }))}
              onBlur={() => void updateSetting("openaiKeyMonitorThreshold", settings.openaiKeyMonitorThreshold)}
            />
            <p className="management-help">{t("监控内置运行，改动即时生效；仅超管可见可改。")}</p>
          </div>
          <div className="monitor-config">
            <p className="management-kicker">{t("OpenAI 上 Key 配置")}</p>
            <label className="field-label" htmlFor="openai-base-url">{t("OpenAI Base URL")}</label>
            <input
              id="openai-base-url"
              className="text-input"
              value={settings.openaiUploadBaseUrl}
              disabled={!isSuperadmin || saving}
              placeholder="https://api.openai.com"
              onChange={(e) => setSettings((c) => ({ ...c, openaiUploadBaseUrl: e.target.value }))}
              onBlur={() => void updateSetting("openaiUploadBaseUrl", settings.openaiUploadBaseUrl.trim())}
            />
            <label className="field-label" htmlFor="openai-concurrency">{t("并发数（RPM，上 key 时写入）")}</label>
            <input
              id="openai-concurrency"
              className="text-input"
              type="number"
              min={1}
              max={100000}
              value={settings.openaiUploadConcurrency}
              disabled={!isSuperadmin || saving}
              onChange={(e) => setSettings((c) => ({ ...c, openaiUploadConcurrency: clampInt(e.target.value, 1, 100000) }))}
              onBlur={() => void updateSetting("openaiUploadConcurrency", settings.openaiUploadConcurrency)}
            />
            <label className="field-label" htmlFor="openai-priority">{t("优先级（上 key 时写入）")}</label>
            <input
              id="openai-priority"
              className="text-input"
              type="number"
              min={0}
              max={100000}
              value={settings.openaiUploadPriority}
              disabled={!isSuperadmin || saving}
              onChange={(e) => setSettings((c) => ({ ...c, openaiUploadPriority: clampInt(e.target.value, 0, 100000) }))}
              onBlur={() => void updateSetting("openaiUploadPriority", settings.openaiUploadPriority)}
            />
            <p className="management-help">{t("上 OpenAI Key 时自动带上；企业分组号在「多平台后端」里为每个网关单独配置（可多个，逗号分隔）。")}</p>
          </div>
          <SettingToggle label={t("上 Key 前校验有效性（拦截死 Key，不入池）")} checked={settings.openaiUploadValidateKey} disabled={!isSuperadmin || saving} onChange={(value) => updateSetting("openaiUploadValidateKey", value)} />
        </div>
        ) : null}

        <div className="settings-panel prefix-manager">
          <div>
            <p className="management-kicker">{t("前缀管理")}</p>
            <p className="management-help">
              {isSuperadmin
                ? t("管理强制上号前缀，超管可增删改任意前缀。")
                : t("管理强制上号前缀，可添加；仅能修改/删除本人添加的，超管的前缀只能查看。")}
            </p>
          </div>
          <form className="prefix-add" onSubmit={addPrefix}>
            <input
              className="text-input"
              value={newPrefix}
              onChange={(event) => setNewPrefix(event.target.value)}
              placeholder={t("新前缀，例如 Allen")}
              maxLength={60}
              disabled={saving}
              aria-label={t("新前缀")}
            />
            <button className="secondary-button" type="submit" disabled={saving || !newPrefix.trim()}>
              {t("添加")}
            </button>
          </form>
          {prefixes.length ? (
            <ul className="prefix-list">
              {prefixes.map((prefix) => {
                // superadmin manages any; an admin only their own — a superadmin's prefix is view-only.
                const canModify = isSuperadmin || prefix.createdBy === currentUserId;
                return (
                  <li className="prefix-row" key={prefix.id}>
                    <span className="prefix-value">{prefix.value}</span>
                    <span className="prefix-owner">{prefix.createdByName}</span>
                    <span className="prefix-row-actions">
                      {canModify ? (
                        <>
                          <button className="secondary-button compact-button" type="button" onClick={() => void renamePrefix(prefix)} disabled={saving}>
                            {t("修改")}
                          </button>
                          <button className="danger-button" type="button" onClick={() => void removePrefix(prefix)} disabled={saving}>
                            {t("删除")}
                          </button>
                        </>
                      ) : (
                        <span className="prefix-readonly">{t("仅查看")}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-state">{t("还没有前缀。添加一个供上号时选择。")}</p>
          )}
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
                  <span className="managed-user-platform">
                    {t("目标平台")}：{account.targetBackend ? platformLabel(account.targetBackend, platforms) : t("未分配")}
                  </span>
                  {isSuperadmin ? (
                    <div className="module-grant">
                      {MODULE_OPTIONS.map((option) => (
                        <label key={option.key} className="module-grant-option">
                          <input
                            type="checkbox"
                            checked={(account.allowedModules ?? []).includes(option.key)}
                            onChange={(event) => toggleAccountModule(account, option.key, event.target.checked)}
                            disabled={saving}
                            aria-label={t("{name} {module}", { name: account.username, module: t(option.label) })}
                          />
                          <span>{t(option.label)}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
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
                  {isSuperadmin ? (
                    <select
                      className="role-select"
                      value={account.targetBackend ?? ""}
                      onChange={(event) => void updateAccount(account, { targetBackend: event.target.value || null })}
                      disabled={saving}
                      aria-label={t("{name} 目标平台", { name: account.username })}
                    >
                      <option value="">{t("未分配")}</option>
                      {platforms.map((platform) => (
                        <option key={platform.ref} value={platform.ref}>{platform.label}</option>
                      ))}
                      {/* Keep a stale assignment visible even if its platform is no longer enabled. */}
                      {account.targetBackend && !platforms.some((platform) => platform.ref === account.targetBackend) ? (
                        <option value={account.targetBackend}>{account.targetBackend}</option>
                      ) : null}
                    </select>
                  ) : null}
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

      {dialog ? (
        <div className="modal-overlay" role="presentation" onClick={closeDialog}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <p className="modal-title">{dialog.title}</p>
            {dialog.kind === "prompt" ? (
              <>
                {dialog.label ? <label className="field-label" htmlFor="dialog-input">{dialog.label}</label> : null}
                <input
                  id="dialog-input"
                  className="text-input"
                  type={dialog.inputType ?? "text"}
                  value={dialogInput}
                  autoFocus
                  autoComplete={dialog.inputType === "password" ? "new-password" : "off"}
                  onChange={(event) => setDialogInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void confirmDialog();
                    if (event.key === "Escape") closeDialog();
                  }}
                />
              </>
            ) : null}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeDialog} disabled={saving}>
                {t("取消")}
              </button>
              <button
                className={dialog.kind === "confirm" && dialog.danger ? "danger-button" : "oauth-button"}
                type="button"
                onClick={() => void confirmDialog()}
                disabled={saving}
              >
                {dialog.confirmLabel ?? t("确定")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}

/** Parse an integer input, clamped to [min, max]; falls back to `min` on junk. */
function clampInt(raw: string, min: number, max: number): number {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
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

/** Display label for a target-platform ref, falling back to the raw ref. */
function platformLabel(ref: string, platforms: Platform[]) {
  return platforms.find((platform) => platform.ref === ref)?.label ?? ref;
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
