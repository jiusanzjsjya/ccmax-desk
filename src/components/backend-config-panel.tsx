"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ccgatewayRef, customRef, sub2gwRef } from "@/lib/backends/kinds";
import { useI18n } from "@/lib/i18n/context";

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

type CcGatewayView = {
  id: string;
  ref: string;
  name: string;
  baseUrl: string;
  vendorEmail: string;
  hasPassword: boolean;
  groupId: string;
  configured: boolean;
};

type Sub2GwView = {
  id: string;
  ref: string;
  name: string;
  baseUrl: string;
  adminEmail: string;
  hasPassword: boolean;
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
  ccgateways: CcGatewayView[];
  sub2gws: Sub2GwView[];
};

type TokenInputs = {
  sub2api: string;
  newapi: string;
  oneapi: string;
  newapiApiKey: string;
  oneapiApiKey: string;
  customs: Record<string, string>;
  ccgateways: Record<string, string>;
  sub2gws: Record<string, string>;
};

const emptyTokens: TokenInputs = { sub2api: "", newapi: "", oneapi: "", newapiApiKey: "", oneapiApiKey: "", customs: {}, ccgateways: {}, sub2gws: {} };

/**
 * A client-side gateway id. `crypto.randomUUID` only exists in a secure context
 * (HTTPS or localhost); on a plain-HTTP IP deployment it is undefined, so fall
 * back to getRandomValues (available everywhere) to build a v4 UUID. Store merge
 * only needs the id to be unique, so the exact scheme doesn't matter.
 */
function newGatewayId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function BackendConfigPanel() {
  const { t } = useI18n();
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
        setError(t("读取后端配置失败。"));
        return;
      }
      setConfig({
        ...payload,
        customs: Array.isArray(payload.customs) ? payload.customs : [],
        ccgateways: Array.isArray(payload.ccgateways) ? payload.ccgateways : [],
        sub2gws: Array.isArray(payload.sub2gws) ? payload.sub2gws : [],
      });
      setTokens(emptyTokens);
    } catch {
      setError(t("无法读取后端配置。"));
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin, t]);

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

  function patchCcGateway(id: string, value: Partial<CcGatewayView>) {
    setConfig((current) =>
      current ? { ...current, ccgateways: current.ccgateways.map((gateway) => (gateway.id === id ? { ...gateway, ...value } : gateway)) } : current,
    );
  }

  function setCcGatewayPassword(id: string, value: string) {
    setTokens((current) => ({ ...current, ccgateways: { ...current.ccgateways, [id]: value } }));
  }

  function patchSub2Gw(id: string, value: Partial<Sub2GwView>) {
    setConfig((current) =>
      current ? { ...current, sub2gws: current.sub2gws.map((gateway) => (gateway.id === id ? { ...gateway, ...value } : gateway)) } : current,
    );
  }

  function setSub2GwPassword(id: string, value: string) {
    setTokens((current) => ({ ...current, sub2gws: { ...current.sub2gws, [id]: value } }));
  }

  function toggleEnabled(ref: string, on: boolean) {
    setConfig((current) => {
      if (!current) return current;
      const set = new Set(current.enabled);
      if (on) set.add(ref);
      else set.delete(ref);
      return { ...current, enabled: orderRefs(set, current.customs, current.ccgateways, current.sub2gws) };
    });
  }

  function addGateway() {
    const id = newGatewayId();
    setConfig((current) =>
      current
        ? {
            ...current,
            customs: [...current.customs, { id, ref: customRef(id), name: t("自建网关"), url: "", hasToken: false, listUrl: "", configured: false }],
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

  function addCcGateway() {
    const id = newGatewayId();
    setConfig((current) =>
      current
        ? {
            ...current,
            ccgateways: [
              ...current.ccgateways,
              { id, ref: ccgatewayRef(id), name: t("Claude Gateway"), baseUrl: "", vendorEmail: "", hasPassword: false, groupId: "", configured: false },
            ],
          }
        : current,
    );
    setCcGatewayPassword(id, "");
  }

  function removeCcGateway(id: string) {
    setConfig((current) => {
      if (!current) return current;
      const ref = ccgatewayRef(id);
      const ccgateways = current.ccgateways.filter((gateway) => gateway.id !== id);
      const enabled = current.enabled.filter((value) => value !== ref);
      const defaultBackend = current.defaultBackend === ref ? enabled[0] ?? "sub2api" : current.defaultBackend;
      return { ...current, ccgateways, enabled, defaultBackend };
    });
    setTokens((current) => {
      const { [id]: _dropped, ...rest } = current.ccgateways;
      return { ...current, ccgateways: rest };
    });
  }

  function addSub2Gw() {
    const id = newGatewayId();
    setConfig((current) =>
      current
        ? {
            ...current,
            sub2gws: [
              ...current.sub2gws,
              { id, ref: sub2gwRef(id), name: t("Sub2API 网关"), baseUrl: "", adminEmail: "", hasPassword: false, configured: false },
            ],
          }
        : current,
    );
    setSub2GwPassword(id, "");
  }

  function removeSub2Gw(id: string) {
    setConfig((current) => {
      if (!current) return current;
      const ref = sub2gwRef(id);
      const sub2gws = current.sub2gws.filter((gateway) => gateway.id !== id);
      const enabled = current.enabled.filter((value) => value !== ref);
      const defaultBackend = current.defaultBackend === ref ? enabled[0] ?? "sub2api" : current.defaultBackend;
      return { ...current, sub2gws, enabled, defaultBackend };
    });
    setTokens((current) => {
      const { [id]: _dropped, ...rest } = current.sub2gws;
      return { ...current, sub2gws: rest };
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
        ccgateways: config.ccgateways.map((gateway) => ({
          id: gateway.id,
          name: gateway.name,
          baseUrl: gateway.baseUrl,
          vendorEmail: gateway.vendorEmail,
          groupId: gateway.groupId,
          ...(tokens.ccgateways[gateway.id] ? { vendorPassword: tokens.ccgateways[gateway.id] } : {}),
        })),
        sub2gws: config.sub2gws.map((gateway) => ({
          id: gateway.id,
          name: gateway.name,
          baseUrl: gateway.baseUrl,
          adminEmail: gateway.adminEmail,
          ...(tokens.sub2gws[gateway.id] ? { adminPassword: tokens.sub2gws[gateway.id] } : {}),
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
        setError(payload.error === "forbidden" ? t("只有超级管理员可以修改后端配置。") : t("保存后端配置失败。"));
        return;
      }
      setMessage(t("后端配置已保存。"));
      void refresh();
    } catch {
      setError(t("保存后端配置失败。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-management" aria-labelledby="backend-config-title">
      <div className="management-heading">
        <div>
          <p className="label">{t("多平台后端")}</p>
          <h3 id="backend-config-title">{t("上号目标平台配置")}</h3>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading || saving}>
          {loading ? t("读取中...") : t("刷新")}
        </button>
      </div>

      {!config ? (
        <p className="empty-state">{loading ? t("正在读取后端配置...") : t("暂无后端配置。")}</p>
      ) : (
        <>
          <div className="management-form">
            <div>
              <p className="management-kicker">{t("默认平台与启用范围")}</p>
              <p className="management-help">{t("默认平台用于向导未选择时；启用的平台会出现在授权向导顶部的目标平台里。")}</p>
            </div>
            <label className="field-label" htmlFor="default-backend">{t("默认平台")}</label>
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
                <option key={gateway.id} value={gateway.ref}>{gateway.name || t("自建网关")}</option>
              ))}
              {config.ccgateways.map((gateway) => (
                <option key={gateway.id} value={gateway.ref}>{gateway.name || t("Claude Gateway")}</option>
              ))}
              {config.sub2gws.map((gateway) => (
                <option key={gateway.id} value={gateway.ref}>{gateway.name || t("Sub2API 网关")}</option>
              ))}
            </select>
            <div className="settings-panel">
              {SINGLETONS.map(({ kind, label }) => (
                <label className={`setting-toggle ${saving ? "is-disabled" : ""}`} key={kind}>
                  <span>
                    {t("启用 {label}", { label })}
                    {config.configured[kind] ? "" : t("（未配置）")}
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
            <PlatformCard title={t("Sub2API（同时也是 Claude OAuth 代理）")} configured={config.configured.sub2api}>
              <Field label={t("地址 Base URL")}>
                <input className="text-input" value={config.sub2api.baseUrl} onChange={(e) => patchPlatform("sub2api", { baseUrl: e.target.value })} placeholder="https://sub2api.example.com" disabled={saving} />
              </Field>
              <Field label={t("管理令牌")}>
                <TokenInput has={config.sub2api.hasAdminToken} value={tokens.sub2api} onChange={(v) => setTokens((prev) => ({ ...prev, sub2api: v }))} disabled={saving} />
              </Field>
              <Field label={t("默认代理 ID（可选）")}>
                <input className="text-input" type="number" value={config.sub2api.proxyId ?? ""} onChange={(e) => patchPlatform("sub2api", { proxyId: e.target.value ? Number(e.target.value) : null })} placeholder={t("留空由 Sub2API 分配")} disabled={saving} />
              </Field>
            </PlatformCard>

            <PlatformCard title="new-api" configured={config.configured.newapi}>
              <Field label={t("地址 Base URL")}>
                <input className="text-input" value={config.newapi.baseUrl} onChange={(e) => patchPlatform("newapi", { baseUrl: e.target.value })} placeholder="https://newapi.example.com" disabled={saving} />
              </Field>
              <Field label={t("管理令牌（创建渠道用）")}>
                <TokenInput has={config.newapi.hasAdminToken} value={tokens.newapi} onChange={(v) => setTokens((prev) => ({ ...prev, newapi: v }))} disabled={saving} />
              </Field>
              <Field label={t("Anthropic API Key（sk-ant-，写入渠道）")}>
                <TokenInput has={config.newapi.hasApiKey} value={tokens.newapiApiKey} onChange={(v) => setTokens((prev) => ({ ...prev, newapiApiKey: v }))} disabled={saving} />
              </Field>
              <Field label={t("New-Api-User（用户 ID，可选）")}>
                <input className="text-input" value={config.newapi.userId} onChange={(e) => patchPlatform("newapi", { userId: e.target.value })} placeholder={t("例如 1")} disabled={saving} />
              </Field>
              <Field label={t("渠道类型 / 模型")}>
                <div className="flow-actions">
                  <input className="text-input" type="number" value={config.newapi.channelType} onChange={(e) => patchPlatform("newapi", { channelType: Number(e.target.value) })} disabled={saving} />
                  <input className="text-input" value={config.newapi.models} onChange={(e) => patchPlatform("newapi", { models: e.target.value })} placeholder="claude-3-5-sonnet-latest" disabled={saving} />
                </div>
              </Field>
            </PlatformCard>

            <PlatformCard title="one-api" configured={config.configured.oneapi}>
              <Field label={t("地址 Base URL")}>
                <input className="text-input" value={config.oneapi.baseUrl} onChange={(e) => patchPlatform("oneapi", { baseUrl: e.target.value })} placeholder="https://oneapi.example.com" disabled={saving} />
              </Field>
              <Field label={t("管理令牌（创建渠道用）")}>
                <TokenInput has={config.oneapi.hasAdminToken} value={tokens.oneapi} onChange={(v) => setTokens((prev) => ({ ...prev, oneapi: v }))} disabled={saving} />
              </Field>
              <Field label={t("Anthropic API Key（sk-ant-，写入渠道）")}>
                <TokenInput has={config.oneapi.hasApiKey} value={tokens.oneapiApiKey} onChange={(v) => setTokens((prev) => ({ ...prev, oneapiApiKey: v }))} disabled={saving} />
              </Field>
              <Field label={t("渠道类型 / 模型")}>
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
                <p className="management-kicker">{t("自建网关（可多个）")}</p>
                <p className="management-help">{t("每个网关独立配置与启用，会作为独立目标平台出现在向导里。")}</p>
              </div>
              <button className="secondary-button" type="button" onClick={addGateway} disabled={saving}>
                {t("+ 添加自建网关")}
              </button>
            </div>

            {config.customs.length ? (
              <div className="management-grid">
                {config.customs.map((gateway) => (
                  <div className="settings-panel" key={gateway.id}>
                    <div className="flow-card-head">
                      <p className="management-kicker">{gateway.name || t("自建网关")}</p>
                      <span className={`account-status ${gateway.configured ? "is-alive" : "is-dead"}`}>{gateway.configured ? t("已配置") : t("未配置")}</span>
                    </div>
                    <Field label={t("名称")}>
                      <input className="text-input" value={gateway.name} onChange={(e) => patchGateway(gateway.id, { name: e.target.value })} placeholder={t("例如 网关-A")} disabled={saving} />
                    </Field>
                    <Field label={t("创建账号 URL")}>
                      <input className="text-input" value={gateway.url} onChange={(e) => patchGateway(gateway.id, { url: e.target.value })} placeholder="https://gateway.example.com/accounts" disabled={saving} />
                    </Field>
                    <Field label={t("令牌（可选）")}>
                      <TokenInput has={gateway.hasToken} value={tokens.customs[gateway.id] ?? ""} onChange={(v) => setGatewayToken(gateway.id, v)} disabled={saving} />
                    </Field>
                    <Field label={t("账号列表 URL（可选）")}>
                      <input className="text-input" value={gateway.listUrl} onChange={(e) => patchGateway(gateway.id, { listUrl: e.target.value })} placeholder={t("留空则不展示账号池")} disabled={saving} />
                    </Field>
                    <label className={`setting-toggle ${saving ? "is-disabled" : ""}`}>
                      <span>{t("启用该网关")}</span>
                      <input
                        type="checkbox"
                        checked={config.enabled.includes(gateway.ref)}
                        disabled={saving}
                        onChange={(event) => toggleEnabled(gateway.ref, event.target.checked)}
                      />
                      <i aria-hidden="true" />
                    </label>
                    <button className="secondary-button" type="button" onClick={() => removeGateway(gateway.id)} disabled={saving}>
                      {t("移除该网关")}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">{t("还没有自建网关，点「添加自建网关」新增。")}</p>
            )}
          </div>

          <div className="gateway-section">
            <div className="management-heading">
              <div>
                <p className="management-kicker">{t("Claude Gateway（vendor 供应商，可多个）")}</p>
                <p className="management-help">{t("每个 vendor 供应商一条：用邮箱+密码登录换令牌，上号时用 refresh_token 导入其账号池。把该网关分配给对应管理员即可。")}</p>
              </div>
              <button className="secondary-button" type="button" onClick={addCcGateway} disabled={saving}>
                {t("+ 添加 Claude Gateway")}
              </button>
            </div>

            {config.ccgateways.length ? (
              <div className="management-grid">
                {config.ccgateways.map((gateway) => (
                  <div className="settings-panel" key={gateway.id}>
                    <div className="flow-card-head">
                      <p className="management-kicker">{gateway.name || t("Claude Gateway")}</p>
                      <span className={`account-status ${gateway.configured ? "is-alive" : "is-dead"}`}>{gateway.configured ? t("已配置") : t("未配置")}</span>
                    </div>
                    <Field label={t("名称")}>
                      <input className="text-input" value={gateway.name} onChange={(e) => patchCcGateway(gateway.id, { name: e.target.value })} placeholder={t("例如 供应商-A")} disabled={saving} />
                    </Field>
                    <Field label={t("网关地址 Base URL")}>
                      <input className="text-input" value={gateway.baseUrl} onChange={(e) => patchCcGateway(gateway.id, { baseUrl: e.target.value })} placeholder="http://gateway.example.com" disabled={saving} />
                    </Field>
                    <Field label={t("vendor 登录邮箱")}>
                      <input className="text-input" value={gateway.vendorEmail} onChange={(e) => patchCcGateway(gateway.id, { vendorEmail: e.target.value })} placeholder="vendor@example.com" autoComplete="off" disabled={saving} />
                    </Field>
                    <Field label={t("vendor 登录密码")}>
                      <TokenInput has={gateway.hasPassword} value={tokens.ccgateways[gateway.id] ?? ""} onChange={(v) => setCcGatewayPassword(gateway.id, v)} disabled={saving} />
                    </Field>
                    <Field label={t("分组 ID（可选，留空用默认组）")}>
                      <input className="text-input" value={gateway.groupId} onChange={(e) => patchCcGateway(gateway.id, { groupId: e.target.value })} placeholder={t("留空自动使用网关默认组")} disabled={saving} />
                    </Field>
                    <label className={`setting-toggle ${saving ? "is-disabled" : ""}`}>
                      <span>{t("启用该网关")}</span>
                      <input
                        type="checkbox"
                        checked={config.enabled.includes(gateway.ref)}
                        disabled={saving}
                        onChange={(event) => toggleEnabled(gateway.ref, event.target.checked)}
                      />
                      <i aria-hidden="true" />
                    </label>
                    <button className="secondary-button" type="button" onClick={() => removeCcGateway(gateway.id)} disabled={saving}>
                      {t("移除该网关")}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">{t("还没有 Claude Gateway，点「添加 Claude Gateway」新增。")}</p>
            )}
          </div>

          <div className="gateway-section">
            <div className="management-heading">
              <div>
                <p className="management-kicker">{t("Sub2API 网关（账号密码鉴权，可多个）")}</p>
                <p className="management-help">{t("与主 Sub2API 同款软件，但用管理员邮箱+密码登录换令牌（不用长效 admin key）。主要用于上 OpenAI Key：把该网关分配给用户后，其上 key 即写入这里。")}</p>
              </div>
              <button className="secondary-button" type="button" onClick={addSub2Gw} disabled={saving}>
                {t("+ 添加 Sub2API 网关")}
              </button>
            </div>

            {config.sub2gws.length ? (
              <div className="management-grid">
                {config.sub2gws.map((gateway) => (
                  <div className="settings-panel" key={gateway.id}>
                    <div className="flow-card-head">
                      <p className="management-kicker">{gateway.name || t("Sub2API 网关")}</p>
                      <span className={`account-status ${gateway.configured ? "is-alive" : "is-dead"}`}>{gateway.configured ? t("已配置") : t("未配置")}</span>
                    </div>
                    <Field label={t("名称")}>
                      <input className="text-input" value={gateway.name} onChange={(e) => patchSub2Gw(gateway.id, { name: e.target.value })} placeholder={t("例如 站点-A")} disabled={saving} />
                    </Field>
                    <Field label={t("网关地址 Base URL")}>
                      <input className="text-input" value={gateway.baseUrl} onChange={(e) => patchSub2Gw(gateway.id, { baseUrl: e.target.value })} placeholder="https://sub2.example.com" disabled={saving} />
                    </Field>
                    <Field label={t("管理员邮箱")}>
                      <input className="text-input" value={gateway.adminEmail} onChange={(e) => patchSub2Gw(gateway.id, { adminEmail: e.target.value })} placeholder="admin@example.com" autoComplete="off" disabled={saving} />
                    </Field>
                    <Field label={t("管理员密码")}>
                      <TokenInput has={gateway.hasPassword} value={tokens.sub2gws[gateway.id] ?? ""} onChange={(v) => setSub2GwPassword(gateway.id, v)} disabled={saving} />
                    </Field>
                    <label className={`setting-toggle ${saving ? "is-disabled" : ""}`}>
                      <span>{t("启用该网关")}</span>
                      <input
                        type="checkbox"
                        checked={config.enabled.includes(gateway.ref)}
                        disabled={saving}
                        onChange={(event) => toggleEnabled(gateway.ref, event.target.checked)}
                      />
                      <i aria-hidden="true" />
                    </label>
                    <button className="secondary-button" type="button" onClick={() => removeSub2Gw(gateway.id)} disabled={saving}>
                      {t("移除该网关")}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">{t("还没有 Sub2API 网关，点「添加 Sub2API 网关」新增。")}</p>
            )}
          </div>

          <div className="wizard-actions">
            <button className="oauth-button" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? t("保存中...") : t("保存后端配置")}
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
function orderRefs(refs: Set<string>, customs: CustomGatewayView[], ccgateways: CcGatewayView[], sub2gws: Sub2GwView[]): string[] {
  const ordered: string[] = [];
  for (const { kind } of SINGLETONS) if (refs.has(kind)) ordered.push(kind);
  for (const gateway of customs) if (refs.has(gateway.ref)) ordered.push(gateway.ref);
  for (const gateway of ccgateways) if (refs.has(gateway.ref)) ordered.push(gateway.ref);
  for (const gateway of sub2gws) if (refs.has(gateway.ref)) ordered.push(gateway.ref);
  return ordered;
}

function PlatformCard({ title, configured, children }: { title: string; configured: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="settings-panel">
      <div className="flow-card-head">
        <p className="management-kicker">{title}</p>
        <span className={`account-status ${configured ? "is-alive" : "is-dead"}`}>{configured ? t("已配置") : t("未配置")}</span>
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
  const { t } = useI18n();
  return (
    <input
      className="text-input"
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={has ? t("已配置，留空不修改") : t("尚未配置")}
      autoComplete="off"
      disabled={disabled}
    />
  );
}
