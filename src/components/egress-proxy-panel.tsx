"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/context";
import type { Role } from "@/lib/roles";

type EgressProxyPanelProps = { role: Role };

type ProxyProtocol = "http" | "https" | "socks5" | "socks5h";

type ProxyItem = {
  id: string;
  ownerId: string;
  ownerName: string;
  label: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  accountCount: number;
  canDelete: boolean;
  createdAt: string;
};

type NewProxy = {
  label?: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
};

const PROTOCOLS: ProxyProtocol[] = ["http", "https", "socks5", "socks5h"];

export default function EgressProxyPanel({ role }: EgressProxyPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<ProxyItem[]>([]);
  const [forcedProxyEnabled, setForcedProxyEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Single-form fields.
  const [protocol, setProtocol] = useState<ProxyProtocol>("http");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  // Bulk paste.
  const [bulk, setBulk] = useState("");

  const isSuperadmin = role === "superadmin";
  const redirectToLogin = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/provisioning/egress-proxies", { cache: "no-store" });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json().catch(() => ({}))) as { items?: ProxyItem[]; forcedProxyEnabled?: boolean; error?: string };
      if (!response.ok || !payload.items) {
        setError(t("读取代理列表失败。"));
        return;
      }
      setItems(payload.items);
      setForcedProxyEnabled(Boolean(payload.forcedProxyEnabled));
    } catch {
      setError(t("无法读取代理列表。"));
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function submit(itemsToAdd: NewProxy[], onDone: () => void) {
    if (!itemsToAdd.length) {
      setError(t("没有可添加的代理，请检查输入格式。"));
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/provisioning/egress-proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsToAdd }),
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json().catch(() => ({}))) as { added?: number; skipped?: number; error?: string };
      if (!response.ok) {
        setError(payload.error === "invalid_request" ? t("代理格式不正确。") : t("添加代理失败。"));
        return;
      }
      setMessage(t("已添加 {added} 条代理，跳过 {skipped} 条重复。", { added: payload.added ?? 0, skipped: payload.skipped ?? 0 }));
      onDone();
      void refresh();
    } catch {
      setError(t("添加代理失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  function addSingle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const portNum = Number(port);
    if (!host.trim() || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError(t("请填写有效的地址和端口。"));
      return;
    }
    void submit(
      [{ label: label.trim() || undefined, protocol, host: host.trim(), port: portNum, username: username.trim() || undefined, password: password || undefined }],
      () => {
        setHost("");
        setPort("");
        setUsername("");
        setPassword("");
        setLabel("");
      },
    );
  }

  function addBulk() {
    const parsed = bulk
      .split(/\r?\n/)
      .map((line) => parseProxyLine(line, protocol))
      .filter((item): item is NewProxy => item !== null);
    void submit(parsed, () => setBulk(""));
  }

  async function removeProxy(proxy: ProxyItem) {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/provisioning/egress-proxies/${proxy.id}`, { method: "DELETE" });
      if (response.status === 401) return redirectToLogin();
      if (!response.ok) {
        setError(t("删除代理失败。"));
        return;
      }
      setItems((current) => current.filter((item) => item.id !== proxy.id));
      setMessage(t("代理 {host} 已删除。", { host: `${proxy.host}:${proxy.port}` }));
    } catch {
      setError(t("删除代理失败，请检查本地服务状态。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-management" aria-labelledby="egress-proxy-title">
      <div className="management-heading">
        <div>
          <p className="label">{t("出口代理")}</p>
          <h3 id="egress-proxy-title">{t("代理配置")}</h3>
        </div>
        <span className="role-chip">
          {forcedProxyEnabled ? t("上号强制选代理：开") : t("上号强制选代理：关")}
        </span>
      </div>

      <div className="management-grid">
        <form className="management-form" onSubmit={addSingle}>
          <div>
            <p className="management-kicker">{t("添加单条代理")}</p>
            <p className="management-help">{t("代理仅用于本地记录与新建账号时选用，不会真正代理流量。")}</p>
          </div>
          <label className="field-label" htmlFor="proxy-protocol">{t("协议")}</label>
          <select id="proxy-protocol" className="text-input" value={protocol} onChange={(e) => setProtocol(e.target.value as ProxyProtocol)} disabled={saving}>
            {PROTOCOLS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <label className="field-label" htmlFor="proxy-host">{t("地址 Host")}</label>
          <input id="proxy-host" className="text-input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="1.2.3.4" autoComplete="off" disabled={saving} />
          <label className="field-label" htmlFor="proxy-port">{t("端口 Port")}</label>
          <input id="proxy-port" className="text-input" type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="1080" disabled={saving} />
          <label className="field-label" htmlFor="proxy-user">{t("用户名（可选）")}</label>
          <input id="proxy-user" className="text-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" disabled={saving} />
          <label className="field-label" htmlFor="proxy-pass">{t("密码（可选）")}</label>
          <input id="proxy-pass" className="text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={saving} />
          <label className="field-label" htmlFor="proxy-label">{t("备注名（可选）")}</label>
          <input id="proxy-label" className="text-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("例如 香港-A")} autoComplete="off" disabled={saving} />
          <button className="oauth-button" type="submit" disabled={saving || !host.trim() || !port}>
            {saving ? t("保存中...") : t("添加代理")}
          </button>
        </form>

        <div className="settings-panel">
          <div>
            <p className="management-kicker">{t("批量粘贴导入")}</p>
            <p className="management-help">{t("每行一条，支持 scheme://user:pass@host:port 或 host:port:user:pass 或 host:port。协议缺省用上方所选。")}</p>
          </div>
          <textarea
            className="text-input"
            rows={8}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={"http://user:pass@1.2.3.4:8080\nsocks5://5.6.7.8:1080\n1.2.3.4:3128:user:pass"}
            disabled={saving}
            aria-label={t("批量代理")}
          />
          <button className="secondary-button" type="button" onClick={addBulk} disabled={saving || !bulk.trim()}>
            {t("批量导入")}
          </button>
        </div>
      </div>

      {message ? <div className="status-box" role="status">{message}</div> : null}
      {error ? <div className="error-box" role="alert">{error}</div> : null}

      <div className="managed-users">
        <div className="management-section-heading">
          <div>
            <p className="management-kicker">{t("代理列表")}</p>
            <p className="management-help">{t("每条显示已绑定的账号数，新建账号时可挑选用得少的代理。")}</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading || saving}>
            {loading ? t("读取中...") : t("刷新列表")}
          </button>
        </div>
        {items.length ? (
          <div className="managed-user-list">
            {items.map((proxy) => (
              <article className="managed-user-row" key={proxy.id}>
                <div className="managed-user-identity">
                  <strong>{proxy.label || `${proxy.host}:${proxy.port}`}</strong>
                  <span>
                    {proxy.protocol}://{proxy.username ? `${proxy.username}@` : ""}{proxy.host}:{proxy.port}
                    {isSuperadmin ? ` · ${proxy.ownerName}` : ""}
                  </span>
                </div>
                <div className="managed-user-actions">
                  <span className="proxy-count">{t("{n} 个账号", { n: proxy.accountCount })}</span>
                  {proxy.canDelete ? (
                    <button className="danger-button" type="button" onClick={() => void removeProxy(proxy)} disabled={saving}>
                      {t("删除")}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">{t("还没有代理。先添加或批量导入。")}</p>
        )}
      </div>
    </section>
  );
}

/** Parse one pasted proxy line into a structured proxy, or null if unrecognized. */
function parseProxyLine(line: string, defaultProtocol: ProxyProtocol): NewProxy | null {
  const s = line.trim();
  if (!s) return null;

  const url = s.match(/^(https?|socks5h?):\/\/(?:([^:@/\s]+):([^@/\s]*)@)?([^:@/\s]+):(\d+)$/i);
  if (url) {
    const port = Number(url[5]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { protocol: url[1].toLowerCase() as ProxyProtocol, username: url[2] || undefined, password: url[3] || undefined, host: url[4], port };
  }

  const parts = s.split(":");
  if (parts.length === 2 || parts.length === 4) {
    const port = Number(parts[1]);
    if (!parts[0] || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      protocol: defaultProtocol,
      host: parts[0],
      port,
      username: parts[2] || undefined,
      password: parts[3] || undefined,
    };
  }
  return null;
}
