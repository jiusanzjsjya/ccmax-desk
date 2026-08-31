"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/context";

type KeyUsagePanelProps = {
  sub2ApiConfigured: boolean;
};

type UsageItem = {
  id: number | string | null;
  name: string | null;
  alive: boolean;
  deadReason: string | null;
  todayCost: number;
  todayRequests: number;
  monthCost: number | null;
};

/**
 * Key 使用额度 — real-time usage + dead-status for the caller's OpenAI keys on
 * Sub2API. Only usage (cost + requests) and alive/dead are shown; bound to the
 * 授权上key grant. Non-superadmin see only their own uploads (server-scoped).
 */
export default function KeyUsagePanel({ sub2ApiConfigured }: KeyUsagePanelProps) {
  const { t } = useI18n();
  const router = useRouter();

  const [items, setItems] = useState<UsageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/provisioning/openai/usage", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { items?: UsageItem[]; error?: string };
      if (!response.ok) {
        setError(readError(response.status, payload.error));
        return;
      }
      setItems(payload.items ?? []);
    } catch {
      setError(t("无法连接 Sub2API 接入服务。"));
    } finally {
      setLoading(false);
    }

    function readError(status: number, code?: string) {
      if (status === 403 && code === "module_forbidden") return t("未获授权上key权限，请联系超级管理员开通。");
      if (status === 502 && code === "sub2api_auth_failed") return t("Sub2API 管理令牌无效或权限不足，请更新 SUB2API_ADMIN_TOKEN。");
      if (status === 503) return t("服务尚未配置完成，请检查 .env.local。");
      return code || t("读取 Key 使用额度失败。");
    }
  }, [router, t]);

  // Fetch first, then setState (no synchronous setState inside the effect body).
  useEffect(() => {
    if (!sub2ApiConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/provisioning/openai/usage", { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 401) {
          router.replace("/");
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as { items?: UsageItem[] };
        if (!cancelled) setItems(payload.items ?? []);
      } catch {
        // Best-effort initial load; the refresh button retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sub2ApiConfigured, router]);

  const aliveCount = items.filter((item) => item.alive).length;
  const deadCount = items.length - aliveCount;

  return (
    <div className="provisioning-workspace">
      {!sub2ApiConfigured ? (
        <div className="error-box">{t(" Sub2API（Claude 授权代理）尚未配置，请在超管后台填写。")}</div>
      ) : null}

      <div className="summary-strip" aria-label={t("Key 统计")}>
        <div><span>{t("总数")}</span><strong>{items.length}</strong></div>
        <div><span>{t("存活")}</span><strong>{aliveCount}</strong></div>
        <div><span>{t("死 Key")}</span><strong>{deadCount}</strong></div>
      </div>

      <section className="list-panel">
        <div className="panel-heading-row">
          <div>
            <p className="label">{t("OpenAI · 实时用量")}</p>
            <h3>{t("Key 使用额度")}</h3>
          </div>
          <button className="secondary-button" type="button" onClick={load} disabled={loading}>
            {loading ? t("刷新中...") : t("刷新")}
          </button>
        </div>

        {error ? <div className="error-box" role="alert">{error}</div> : null}

        {items.length ? (
          <div className="account-list">
            {items.map((item) => (
              <article className="account-row" key={`${item.id}-${item.name}`}>
                <div className="account-main">
                  <strong>{item.name || t("未命名 Key")}</strong>
                  <span>
                    {t("今日花费")} ${item.todayCost.toFixed(4)} · {t("今日请求")} {item.todayRequests}
                    {item.monthCost != null ? ` · ${t("近30天花费")} $${item.monthCost.toFixed(2)}` : ""}
                  </span>
                </div>
                <div className="account-meta">
                  <span className={`account-status ${item.alive ? "is-alive" : "is-dead"}`}>
                    {item.alive ? t("存活") : t("死 Key")}
                  </span>
                  {!item.alive && item.deadReason ? <span>{item.deadReason}</span> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">{t("暂无 OpenAI Key。到「授权上key」上传后，这里会实时显示用量与死活状态。")}</p>
        )}
      </section>
    </div>
  );
}
