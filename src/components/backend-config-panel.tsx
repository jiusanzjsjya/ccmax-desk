"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { BACKEND_KINDS, backendLabel, type BackendKind } from "@/lib/backends/kinds";

type BackendConfig = {
  defaultBackend: BackendKind;
  enabled: BackendKind[];
  configured: Record<BackendKind, boolean>;
  sub2api: { baseUrl: string; hasAdminToken: boolean; proxyId: number | null };
  newapi: { baseUrl: string; hasAdminToken: boolean; userId: string; channelType: number; models: string };
  oneapi: { baseUrl: string; hasAdminToken: boolean; channelType: number; models: string };
  custom: { url: string; hasToken: boolean; listUrl: string };
};

type TokenInputs = { sub2api: string; newapi: string; oneapi: string; custom: string };

export default function BackendConfigPanel() {
  const router = useRouter();
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [tokens, setTokens] = useState<TokenInputs>({ sub2api: "", newapi: "", oneapi: "", custom: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const redirectToLogin = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/backends", { cache: "no-store" });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json().catch(() => ({}))) as BackendConfig & { error?: string };
      if (!response.ok || !payload.sub2api) {
        setError("读取后端配置失败。");
        return;
      }
      setConfig(payload);
      setTokens({ sub2api: "", newapi: "", oneapi: "", custom: "" });
    } catch {
      setError("无法读取后端配置。");
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  function patch<K extends keyof BackendConfig>(key: K, value: BackendConfig[K]) {
    setConfig((current) => (current ? { ...current, [key]: value } : current));
  }

  function patchPlatform<K extends "sub2api" | "newapi" | "oneapi" | "custom">(key: K, value: Partial<BackendConfig[K]>) {
    setConfig((current) => (current ? { ...current, [key]: { ...current[key], ...value } } : current));
  }

  function toggleEnabled(kind: BackendKind, on: boolean) {
    setConfig((current) => {
      if (!current) return current;
      const set = new Set(current.enabled);
      if (on) set.add(kind);
      else set.delete(kind);
      return { ...current, enabled: BACKEND_KINDS.filter((k) => set.has(k)) };
    });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const body = {
        defaultBackend: config.defaultBackend,
        enabled: config.enabled,
        sub2api: {
          baseUrl: config.sub2api.baseUrl,
          proxyId: config.sub2api.proxyId,
          ...(tokens.sub2api ? { adminToken: tokens.sub2api } : {}),
        },
        newapi: {
          baseUrl: config.newapi.baseUrl,
          userId: config.newapi.userId,
          channelType: config.newapi.channelType,
          models: config.newapi.models,
          ...(tokens.newapi ? { adminToken: tokens.newapi } : {}),
        },
        oneapi: {
          baseUrl: config.oneapi.baseUrl,
          channelType: config.oneapi.channelType,
          models: config.oneapi.models,
          ...(tokens.oneapi ? { adminToken: tokens.oneapi } : {}),
        },
        custom: {
          url: config.custom.url,
          listUrl: config.custom.listUrl,
          ...(tokens.custom ? { token: tokens.custom } : {}),
        },
      };

      const response = await fetch("/api/admin/backends", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error === "forbidden" ? "只有超级管理员可以修改后端配置。" : "保存后端配置失败。");
        return;
      }
      setMessage("后端配置已保存。");
      void refresh();
    } catch {
      setError("保存后端配置失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-management" aria-labelledby="backend-config-title">
      <div className="management-heading">
        <div>
          <p className="label">多平台后端</p>
          <h3 id="backend-config-title">上号目标平台配置</h3>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading || saving}>
          {loading ? "读取中..." : "刷新"}
        </button>
      </div>

      {!config ? (
        <p className="empty-state">{loading ? "正在读取后端配置..." : "暂无后端配置。"}</p>
      ) : (
        <>
          <div className="management-form">
            <div>
              <p className="management-kicker">默认平台与启用范围</p>
              <p className="management-help">默认平台用于向导未选择时；启用的平台会出现在授权向导的目标选择里。</p>
            </div>
            <label className="field-label" htmlFor="default-backend">默认平台</label>
            <select
              id="default-backend"
              className="text-input"
              value={config.defaultBackend}
              onChange={(event) => patch("defaultBackend", event.target.value as BackendKind)}
              disabled={saving}
            >
              {BACKEND_KINDS.map((kind) => (
                <option key={kind} value={kind}>{backendLabel(kind)}</option>
              ))}
            </select>
            <div className="settings-panel">
              {BACKEND_KINDS.map((kind) => (
                <label className={`setting-toggle ${saving ? "is-disabled" : ""}`} key={kind}>
                  <span>
                    启用 {backendLabel(kind)}
                    {config.configured[kind] ? "" : "（未配置）"}
                  </span>
                  <input
                    type="checkbox"
                    checked={config.enabled.includes(kind)}
                    disabled={saving}
                    onChange={(event) => toggleEnabled(kind, event.target.checked)}
                  />
                  <i aria-hidden="true" />
                </label>
              ))}
            </div>
          </div>

          <div className="management-grid">
            <PlatformCard title="Sub2API（同时也是 Claude OAuth 代理）" configured={config.configured.sub2api}>
              <Field label="地址 Base URL">
                <input className="text-input" value={config.sub2api.baseUrl} onChange={(e) => patchPlatform("sub2api", { baseUrl: e.target.value })} placeholder="https://sub2api.example.com" disabled={saving} />
              </Field>
              <Field label="管理令牌">
                <TokenInput has={config.sub2api.hasAdminToken} value={tokens.sub2api} onChange={(v) => setTokens((t) => ({ ...t, sub2api: v }))} disabled={saving} />
              </Field>
              <Field label="默认代理 ID（可选）">
                <input className="text-input" type="number" value={config.sub2api.proxyId ?? ""} onChange={(e) => patchPlatform("sub2api", { proxyId: e.target.value ? Number(e.target.value) : null })} placeholder="留空由 Sub2API 分配" disabled={saving} />
              </Field>
            </PlatformCard>

            <PlatformCard title="new-api" configured={config.configured.newapi}>
              <Field label="地址 Base URL">
                <input className="text-input" value={config.newapi.baseUrl} onChange={(e) => patchPlatform("newapi", { baseUrl: e.target.value })} placeholder="https://newapi.example.com" disabled={saving} />
              </Field>
              <Field label="管理令牌">
                <TokenInput has={config.newapi.hasAdminToken} value={tokens.newapi} onChange={(v) => setTokens((t) => ({ ...t, newapi: v }))} disabled={saving} />
              </Field>
              <Field label="New-Api-User（用户 ID）">
                <input className="text-input" value={config.newapi.userId} onChange={(e) => patchPlatform("newapi", { userId: e.target.value })} placeholder="例如 1" disabled={saving} />
              </Field>
              <Field label="渠道类型 / 模型">
                <div className="flow-actions">
                  <input className="text-input" type="number" value={config.newapi.channelType} onChange={(e) => patchPlatform("newapi", { channelType: Number(e.target.value) })} disabled={saving} />
                  <input className="text-input" value={config.newapi.models} onChange={(e) => patchPlatform("newapi", { models: e.target.value })} placeholder="claude-3-5-sonnet-latest" disabled={saving} />
                </div>
              </Field>
            </PlatformCard>

            <PlatformCard title="one-api" configured={config.configured.oneapi}>
              <Field label="地址 Base URL">
                <input className="text-input" value={config.oneapi.baseUrl} onChange={(e) => patchPlatform("oneapi", { baseUrl: e.target.value })} placeholder="https://oneapi.example.com" disabled={saving} />
              </Field>
              <Field label="管理令牌">
                <TokenInput has={config.oneapi.hasAdminToken} value={tokens.oneapi} onChange={(v) => setTokens((t) => ({ ...t, oneapi: v }))} disabled={saving} />
              </Field>
              <Field label="渠道类型 / 模型">
                <div className="flow-actions">
                  <input className="text-input" type="number" value={config.oneapi.channelType} onChange={(e) => patchPlatform("oneapi", { channelType: Number(e.target.value) })} disabled={saving} />
                  <input className="text-input" value={config.oneapi.models} onChange={(e) => patchPlatform("oneapi", { models: e.target.value })} placeholder="claude-3-5-sonnet-latest" disabled={saving} />
                </div>
              </Field>
            </PlatformCard>

            <PlatformCard title="自建网关" configured={config.configured.custom}>
              <Field label="创建账号 URL">
                <input className="text-input" value={config.custom.url} onChange={(e) => patchPlatform("custom", { url: e.target.value })} placeholder="https://gateway.example.com/accounts" disabled={saving} />
              </Field>
              <Field label="令牌（可选）">
                <TokenInput has={config.custom.hasToken} value={tokens.custom} onChange={(v) => setTokens((t) => ({ ...t, custom: v }))} disabled={saving} />
              </Field>
              <Field label="账号列表 URL（可选）">
                <input className="text-input" value={config.custom.listUrl} onChange={(e) => patchPlatform("custom", { listUrl: e.target.value })} placeholder="留空则不展示账号池" disabled={saving} />
              </Field>
            </PlatformCard>
          </div>

          <div className="wizard-actions">
            <button className="oauth-button" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "保存中..." : "保存后端配置"}
            </button>
          </div>
        </>
      )}

      {message ? <div className="status-box" role="status">{message}</div> : null}
      {error ? <div className="error-box" role="alert">{error}</div> : null}
    </section>
  );
}

function PlatformCard({ title, configured, children }: { title: string; configured: boolean; children: React.ReactNode }) {
  return (
    <div className="settings-panel">
      <div className="flow-card-head">
        <p className="management-kicker">{title}</p>
        <span className={`account-status ${configured ? "is-alive" : "is-dead"}`}>{configured ? "已配置" : "未配置"}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <label className="field-label">{label}</label>
      {children}
    </>
  );
}

function TokenInput({ has, value, onChange, disabled }: { has: boolean; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <input
      className="text-input"
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={has ? "已配置，留空不修改" : "尚未配置"}
      autoComplete="off"
      disabled={disabled}
    />
  );
}
