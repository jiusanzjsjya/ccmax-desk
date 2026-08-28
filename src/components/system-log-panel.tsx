"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n, type I18nValue } from "@/lib/i18n/context";
import { roleLabel, type Role } from "@/lib/roles";

type TFn = I18nValue["t"];

type AuditEvent = {
  id: string;
  actorName: string;
  actorRole: Role;
  action: string;
  targetId?: string;
  details?: string;
  createdAt: string;
};

type Category = "auth" | "account" | "system" | "backend" | "other";

/** Map a raw audit action to a human label + category for filtering/badging. */
const ACTION_META: Record<string, { label: string; cat: Category }> = {
  "login.superadmin": { label: "超管登录", cat: "auth" },
  "login.env_superadmin": { label: "超管登录", cat: "auth" },
  "login.account": { label: "账号登录", cat: "auth" },
  "user.create": { label: "创建账号", cat: "account" },
  "user.update": { label: "修改账号", cat: "account" },
  "user.delete": { label: "删除账号", cat: "account" },
  "user.password_reset": { label: "重置密码", cat: "account" },
  "settings.update": { label: "系统开关变更", cat: "system" },
  "backends.update": { label: "后端配置变更", cat: "backend" },
};

function actionMeta(action: string): { label: string; cat: Category } {
  return ACTION_META[action] ?? { label: action, cat: "other" };
}

const CATEGORY_LABELS: Record<Category, string> = {
  auth: "登录",
  account: "账号",
  system: "系统",
  backend: "后端配置",
  other: "其他",
};

const FILTERS: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "auth", label: "登录" },
  { id: "account", label: "账号" },
  { id: "system", label: "系统" },
  { id: "backend", label: "后端配置" },
];

export default function SystemLogPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");

  const redirectToLogin = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/audit", { cache: "no-store" });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json().catch(() => ({}))) as { items?: AuditEvent[]; error?: string };
      if (response.status === 403) {
        setError(t("只有超级管理员可以查看系统日志。"));
        return;
      }
      if (!response.ok || !Array.isArray(payload.items)) {
        setError(t("读取系统日志失败。"));
        return;
      }
      setEvents(payload.items);
    } catch {
      setError(t("无法读取系统日志。"));
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      const meta = actionMeta(event.action);
      if (filter !== "all" && meta.cat !== filter) return false;
      if (!needle) return true;
      return (
        event.actorName.toLowerCase().includes(needle) ||
        event.action.toLowerCase().includes(needle) ||
        meta.label.toLowerCase().includes(needle) ||
        (event.details?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [events, filter, query]);

  // Per-category counts drive the chip badges (computed over the unfiltered set).
  const counts = useMemo(() => {
    const map = new Map<Category, number>();
    for (const event of events) {
      const cat = actionMeta(event.action).cat;
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return map;
  }, [events]);

  return (
    <section className="account-management" aria-labelledby="system-log-title">
      <div className="management-heading">
        <div>
          <p className="label">{t("操作审计")}</p>
          <h3 id="system-log-title">{t("系统日志")}</h3>
          <p className="management-help">
            {t("仅记录本系统自身的操作留痕：登录、账号变更、系统开关与后端配置。不含 Sub2API 或各网关平台的运行日志，也不含密码或 OAuth 令牌。仅保留最近 100 条。")}
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? t("读取中...") : t("刷新")}
        </button>
      </div>

      <div className="log-toolbar">
        <div className="log-filters" role="tablist" aria-label={t("按类别筛选")}>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`log-chip ${filter === item.id ? "is-active" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              {t(item.label)}
              {item.id !== "all" && counts.get(item.id as Category) ? (
                <span className="log-chip-count">{counts.get(item.id as Category)}</span>
              ) : null}
            </button>
          ))}
        </div>
        <input
          className="text-input log-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("搜索操作人 / 动作 / 详情")}
          aria-label={t("搜索日志")}
        />
      </div>

      {error ? <div className="error-box" role="alert">{error}</div> : null}

      {!error && !loading && filtered.length === 0 ? (
        <p className="empty-state">{events.length ? t("没有符合条件的日志。") : t("暂无系统日志。")}</p>
      ) : null}

      {filtered.length ? (
        <div className="log-list">
          {filtered.map((event) => {
            const meta = actionMeta(event.action);
            return (
              <article className="log-row" key={event.id}>
                <div className="log-row-main">
                  <span className={`log-tag log-cat-${meta.cat}`}>{t(CATEGORY_LABELS[meta.cat])}</span>
                  <div className="log-row-body">
                    <p className="log-line">
                      <strong>{event.actorName}</strong>
                      <span className="role-badge">{t(roleLabel(event.actorRole))}</span>
                      <span className="log-action">{t(meta.label)}</span>
                      <code className="log-code">{event.action}</code>
                    </p>
                    {event.details ? <p className="log-details">{summarizeDetails(event.details)}</p> : null}
                  </div>
                </div>
                <time className="log-time" dateTime={event.createdAt} title={formatAbsolute(event.createdAt)}>
                  {formatRelative(event.createdAt, t)}
                </time>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/** Render structured details compactly; pass raw text through if not JSON. */
function summarizeDetails(details: string): string {
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("/") || "—" : String(value)}`)
      .join(" · ");
  } catch {
    return details;
  }
}

function formatAbsolute(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatRelative(value: string, t: TFn): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return t("刚刚");
  const min = Math.round(sec / 60);
  if (min < 60) return t("{n} 分钟前", { n: min });
  const hour = Math.round(min / 60);
  if (hour < 24) return t("{n} 小时前", { n: hour });
  const day = Math.round(hour / 24);
  if (day < 30) return t("{n} 天前", { n: day });
  return date.toLocaleDateString("zh-CN");
}
