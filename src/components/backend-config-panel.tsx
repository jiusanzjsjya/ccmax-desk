"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { customRef } from "@/lib/backends/kinds";

type SingletonKind = "sub2api" | "newapi" | "oneapi";

const SINGLETONS: { kind: SingletonKind; label: string }[] = [
  { kind: "sub2api", label: "Sub2API" },
  { kind: "newapi", label: "new-api" },
  { kind: "oneapi", label: "one-api" },
];

type CustomGatewayView = {
  id: string;
  ref: string;
  name: string;
  url: string;
  hasToken: boolean;
  listUrl: string;
  configured: boolean;
};

type BackendConfig = {
  defaultBackend: string;
  enabled: string[];
  configured: Record<SingletonKind, boolean>;
  sub2api: { baseUrl: string; hasAdminToken: boolean; proxyId: number | null };
  newapi: { baseUrl: string; hasAdminToken: boolean; userId: string; channelType: number; models: string; hasApiKey: boolean };
  oneapi: { baseUrl: string; hasAdminToken: boolean; channelType: number; models: string; hasApiKey: boolean };
  customs: CustomGatewayView[];
};

type TokenInputs = {
  sub2api: string;
  newapi: string;
  oneapi: string;
  newapiApiKey: string;
  oneapiApiKey: string;
  customs: Record<string, string>;
};

const emptyTokens: TokenInputs = { sub2api: "", newapi: "", oneapi: "", newapiApiKey: "", oneapiApiKey: "", customs: {} };

export default function BackendConfigPanel() {
  const router = useRouter();
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [tokens, setTokens] = useState<TokenInputs>(emptyTokens);
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
      setConfig({ ...payload, customs: Array.isArray(payload.customs) ? payload.customs : [] });
      setTokens(emptyTokens);
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

  function patchPlatform<K extends "sub2api" | "newapi" | "oneapi">(key: K, value: Partial<BackendConfig[K]>) {
    setConfig((current) => (current ? { ...current, [key]: { ...current[key], ...value } } : current));
  }

  function patchGateway(id: string, value: Partial<CustomGatewayView>) {
    setConfig((current) =>
      current ? { ...current, customs: current.customs.map((gateway) => (gateway.id === id ? { ...gateway, ...value } : gateway)) } : current,
    );
  }

  function setGatewayToken(id: string, value: string) {
    setTokens((current) => ({ ...current, customs: { ...current.customs, [id]: value } }));
  }

  function toggleEnabled(ref: string, on: boolean) {
    setConfig((current) => {
      if (!current) return current;
      const set = new Set(current.enabled);
      if (on) set.add(ref);
      else set.delete(ref);
      return { ...current, enabled: orderRefs(set, current.customs) };
    });
  }

  function addGateway() {
    const id = crypto.randomUUID();
    setConfig((current) =>
      current
        ? {
            ...current,
            customs: [...current.customs, { id, ref: customRef(id), name: "自建网关", url: "", hasToken: false, listUrl: "", configured: false }],
          }
        : current,
    );
    setGatewayToken(id, "");
  }

  function removeGateway(id: string) {
    setConfig((current) => {
      if (!current) return current;
      const ref = customRef(id);
      const customs = current.customs.filter((gateway) => gateway.id !== id);
      const enabled = current.enabled.filter((value) => value !== ref);
      const defaultBackend = current.defaultBackend === ref ? enabled[0] ?? "sub2api" : current.defaultBackend;
      return { ...current, customs, enabled, defaultBackend };
    });
    setTokens((current) => {
      const { [id]: _dropped, ...rest } = current.customs;
      return { ...current, customs: rest };
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
          ...(tokens.newapiApiKey ? { apiKey: tokens.newapiApiKey } : {}),
        },
        oneapi: {
          baseUrl: config.oneapi.baseUrl,
          channelType: config.oneapi.channelType,
          models: config.oneapi.models,
          ...(tokens.oneapi ? { adminToken: tokens.oneapi } : {}),
          ...(tokens.oneapiApiKey ? { apiKey: tokens.oneapiApiKey } : {}),
        },
        customs: config.customs.map((gateway) => ({
          id: gateway.id,
          name: gateway.name,
          url: gateway.url,
          listUrl: gateway.listUrl,
          ...(tokens.customs[gateway.id] ? { token: tokens.customs[gateway.id] } : {}),
        })),
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
              <p className="management-help">默认平台用于向导未选择时；启用的平台会出现在授权向导顶部的目标平台里。</p>
            </div>
            <label className="field-label" htmlFor="default-backend">默认平台</label>
            <select
              id="default-backend"
              className="text-input"
              value={config.defaultBackend}
              onChange={(event) => patch("defaultBackend", event.target.value)}
              disabled={saving}
            >
              {SINGLETONS.map(({ kind, label }) => (
                <option key={kind} value={kind}>{label}</option>
              ))}
              {config.customs.map((gateway) => (
                <option key={gateway.id} value={gateway.ref}>{gateway.name || "自建网关"}</option>
              ))}
            </select>
            <div className="settings-panel">
              {SINGLETONS.map(({ kind, label }) => (
                <label className={`setting-toggle ${saving ? "is-disabled" : ""}`} key={kind}>
                  <span>
                    启用 {label}
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
              <Field label="管理令牌（创建渠道用）">
                <TokenInput has={config.newapi.hasAdminToken} value={tokens.newapi} onChange={(v) => setTokens((t) => ({ ...t, newapi: v }))} disabled={saving} />
              </Field>
              <Field label="Anthropic API Key（sk-ant-，写入渠道）">
                <TokenInput has={config.newapi.hasApiKey} value={tokens.newapiApiKey} onChange={(v) => setTokens((t) => ({ ...t, newapiApiKey: v }))} disabled={saving} />
              </Field>
              <Field label="New-Api-User（用户 ID，可选）">
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
              <Field label="管理令牌（创建渠道用）">
                <TokenInput has={config.oneapi.hasAdminToken} value={tokens.oneapi} onChange={(v) => setTokens((t) => ({ ...t, oneapi: v }))} disabled={saving} />
              </Field>
              <Field label="Anthropic API Key（sk-ant-，写入渠道）">
                <TokenInput has={config.oneapi.hasApiKey} value={tokens.oneapiApiKey} onChange={(v) => setTokens((t) => ({ ...t, oneapiApiKey: v }))} disabled={saving} />
              </Field>
              <Field label="渠道类型 / 模型">
                <div className="flow-actions">
                  <input className="text-input" type="number" value={config.oneapi.channelType} onChange={(e) => patchPlatform("oneapi", { channelType: Number(e.target.value) })} disabled={saving} />
                  <input className="text-input" value={config.oneapi.models} onChange={(e) => patchPlatform("oneapi", { models: e.target.value })} placeholder="claude-3-5-sonnet-latest" disabled={saving} />
                </div>
              </Field>
            </PlatformCard>
          </div>

          <div className="gateway-section">
            <div className="management-heading">
              <div>
                <p className="management-kicker">自建网关（可多个）</p>
                <p className="management-help">每个网关独立配置与启用，会作为独立目标平台出现在向导里。</p>
              </div>
              <button className="secondary-button" type="button" onClick={addGateway} disabled={saving}>
                + 添加自建网关
              </button>
            </div>

            {config.customs.length ? (
              <div className="management-grid">
                {config.customs.map((gateway) => (
                  <div className="settings-panel" key={gateway.id}>
                    <div className="flow-card-head">
                      <p className="management-kicker">{gateway.name || "自建网关"}</p>
                      <span className={`account-status ${gateway.configured ? "is-alive" : "is-dead"}`}>{gateway.configured ? "已配置" : "未配置"}</span>
                    </div>
                    <Field label="名称">
                      <input className="text-input" value={gateway.name} onChange={(e) => patchGateway(gateway.id, { name: e.target.value })} placeholder="例如 网关-A" disabled={saving} />
                    </Field>
                    <Field label="创建账号 URL">
                      <input className="text-input" value={gateway.url} onChange={(e) => patchGateway(gateway.id, { url: e.target.value })} placeholder="https://gateway.example.com/accounts" disabled={saving} />
                    </Field>
                    <Field label="令牌（可选）">
                      <TokenInput has={gateway.hasToken} value={tokens.customs[gateway.id] ?? ""} onChange={(v) => setGatewayToken(gateway.id, v)} disabled={saving} />
                    </Field>
                    <Field label="账号列表 URL（可选）">
                      <input className="text-input" value={gateway.listUrl} onChange={(e) => patchGateway(gateway.id, { listUrl: e.target.value })} placeholder="留空则不展示账号池" disabled={saving} />
                    </Field>
                    <label className={`setting-toggle ${saving ? "is-disabled" : ""}`}>
                      <span>启用该网关</span>
                      <input
                        type="checkbox"
                        checked={config.enabled.includes(gateway.ref)}
                        disabled={saving}
                        onChange={(event) => toggleEnabled(gateway.ref, event.target.checked)}
                      />
                      <i aria-hidden="true" />
                    </label>
                    <button className="secondary-button" type="button" onClick={() => removeGateway(gateway.id)} disabled={saving}>
                      移除该网关
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">还没有自建网关，点「添加自建网关」新增。</p>
            )}
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

/** Keep enabled refs in a stable order: singletons first, then gateways as listed. */
function orderRefs(refs: Set<string>, customs: CustomGatewayView[]): string[] {
  const ordered: string[] = [];
  for (const { kind } of SINGLETONS) if (refs.has(kind)) ordered.push(kind);
  for (const gateway of customs) if (refs.has(gateway.ref)) ordered.push(gateway.ref);
  return ordered;
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
