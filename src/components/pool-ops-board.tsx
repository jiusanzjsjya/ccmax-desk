"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/context";

type PoolAccount = {
  id: number | string | null;
  name: string | null;
  email: string | null;
  platform: string;
  status: string;
  schedulable: boolean | null;
  errorMessage: string | null;
  lastUsedAt: string | null;
  subscription: string | null;
  groups: string[];
  currentConcurrency: number | null;
  concurrency: number | null;
  baseRpm: number | null;
  currentRpm: number | null;
  windowCostLimit: number | null;
  currentWindowCost: number | null;
  rateLimitResetAt: string | null;
  overloadUntil: string | null;
  tempUnschedulableUntil: string | null;
  tempUnschedulableReason: string | null;
};

type PoolStats = {
  totalAccounts: number;
  normalAccounts: number;
  errorAccounts: number;
  ratelimitAccounts: number;
  overloadAccounts: number;
  todayCost: number;
  totalCost: number;
  todayRequests: number;
  rpm: number;
  tpm: number;
};

type OpsResponse = {
  stats?: PoolStats | null;
  notable?: PoolAccount[];
  scanned?: number;
  truncated?: boolean;
  concurrencySum?: number;
  capacity?: number;
  scoped?: boolean;
  pending?: boolean;
  error?: string;
};

type RuleKey = "error" | "cooldown" | "cost" | "rpm" | "disabled";
type Severity = "critical" | "warn" | "info";

type RuleConfig = {
  error: boolean;
  cooldown: boolean;
  cost: boolean;
  rpm: boolean;
  disabled: boolean;
  costThreshold: number; // 0.5–1
  rpmThreshold: number; // 0.5–1
};

const DEFAULT_RULES: RuleConfig = {
  error: true,
  cooldown: true,
  cost: true,
  rpm: false,
  disabled: false,
  costThreshold: 0.8,
  rpmThreshold: 0.8,
};

const RULE_META: { key: RuleKey; label: string; hint: string; severity: Severity; threshold?: "cost" | "rpm" }[] = [
  { key: "error", label: "掉权 / 报错", hint: "账号返回错误或已被封禁", severity: "critical" },
  { key: "cooldown", label: "限流冷却", hint: "过载 / 限流 / 临时不可调度", severity: "warn" },
  { key: "cost", label: "额度接近上限", hint: "窗口花费占额度比例", severity: "warn", threshold: "cost" },
  { key: "rpm", label: "RPM 接近上限", hint: "当前 RPM 占基准比例", severity: "warn", threshold: "rpm" },
  { key: "disabled", label: "已停用 / 不可调度", hint: "被手动停用或标记为不可调度", severity: "info" },
];

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
const RULES_STORE_KEY = "ccmax-pool-alert-rules";
const REFRESH_MS = 15000;

type Alert = {
  account: PoolAccount;
  primary: RuleKey;
  severity: Severity;
  headline: string;
  detail: string;
  tags: { key: RuleKey; label: string; severity: Severity }[];
};

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export default function PoolOpsBoard({ platform, sub2ApiConfigured }: { platform: string; sub2ApiConfigured: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [notable, setNotable] = useState<PoolAccount[]>([]);
  const [scanned, setScanned] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [concurrencySum, setConcurrencySum] = useState(0);
  const [capacity, setCapacity] = useState(1000);
  const [scoped, setScoped] = useState(false);
  const [pending, setPending] = useState(false);

  const [rules, setRules] = useState<RuleConfig>(DEFAULT_RULES);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const redirectToLogin = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  // Load saved rule config once, after hydration (avoids SSR/client mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RULES_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<RuleConfig>;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRules((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  const persistRules = useCallback((next: RuleConfig) => {
    setRules(next);
    try {
      window.localStorage.setItem(RULES_STORE_KEY, JSON.stringify(next));
    } catch {
      // storage may be unavailable — rules still apply for this session
    }
  }, []);

  const load = useCallback(async () => {
    if (!sub2ApiConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ platform, scan_max: "1000" });
      const response = await fetch(`/api/provisioning/pool/ops?${qs}`, { cache: "no-store" });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json().catch(() => ({}))) as OpsResponse;
      if (!response.ok) {
        setNotable([]);
        setStats(null);
        setError(t(readOpsError(response.status, payload.error)));
        return;
      }
      if (payload.pending) {
        setPending(true);
        setNotable([]);
        setStats(null);
        return;
      }
      setPending(false);
      setScoped(Boolean(payload.scoped));
      setStats(payload.stats ?? null);
      setNotable(payload.notable ?? []);
      setScanned(payload.scanned ?? 0);
      setTruncated(Boolean(payload.truncated));
      setConcurrencySum(payload.concurrencySum ?? 0);
      setCapacity(payload.capacity ?? 1000);
    } catch {
      setError(t("无法连接账号池服务，请检查本地服务状态。"));
    } finally {
      setLoading(false);
    }
  }, [platform, sub2ApiConfigured, redirectToLogin, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !sub2ApiConfigured) return;
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, sub2ApiConfigured, load]);

  const alerts = useMemo(() => buildAlerts(notable, rules, t), [notable, rules, t]);
  const counts = useMemo(() => {
    return alerts.reduce(
      (acc, alert) => {
        acc[alert.severity] += 1;
        return acc;
      },
      { critical: 0, warn: 0, info: 0 } as Record<Severity, number>,
    );
  }, [alerts]);

  if (!sub2ApiConfigured) {
    return <p className="empty-state">{t("账号池仅对 Sub2API 可用。请先在「多平台后端」配置并启用 Sub2API。")}</p>;
  }

  if (pending) {
    return <p className="empty-state">{t("该平台账号池待接入，敬请期待。")}</p>;
  }

  const available = stats ? `${stats.normalAccounts} / ${stats.totalAccounts}` : "—";
  const cooling = stats ? stats.ratelimitAccounts + stats.overloadAccounts : 0;

  return (
    <div className="ops">
      <div className="ops-bar">
        <div className="ops-scan">
          {scoped
            ? t("本人账号 {n} 个", { n: scanned })
            : truncated
              ? t("已扫描前 {n} 个账号（池内更多）", { n: scanned })
              : t("已扫描 {n} 个账号", { n: scanned })}
        </div>
        <div className="pool-heading-actions">
          <label className="setting-toggle pool-auto">
            <span>{t("自动刷新 15s")}</span>
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <i aria-hidden="true" />
          </label>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? t("扫描中...") : t("刷新")}
          </button>
        </div>
      </div>

      <div className="pool-stats ops-stats">
        <OpsStat k={t("可用账号")} v={available} tone="ok" />
        <OpsStat k={t("冷却中")} v={String(cooling)} tone={cooling > 0 ? "warn" : "muted"} />
        <OpsStat k={t("掉权")} v={stats ? String(stats.errorAccounts) : "—"} tone={stats && stats.errorAccounts > 0 ? "bad" : "muted"} />
        <OpsStat k={t("实时并发")} v={String(concurrencySum)} tone="muted" />
        <OpsStat k={scoped ? t("本人 RPM") : t("全局 RPM")} v={stats ? String(stats.rpm) : "—"} tone="muted" />
        {scoped ? null : <OpsStat k={t("全局 TPM")} v={stats ? formatCount(stats.tpm) : "—"} tone="muted" />}
        <OpsStat k={t("承载")} v={stats ? `${stats.totalAccounts} / ${capacity}` : "—"} tone={stats && stats.totalAccounts >= capacity ? "bad" : "muted"} />
        <OpsStat k={t("当前告警")} v={String(alerts.length)} tone={alerts.length > 0 ? (counts.critical > 0 ? "bad" : "warn") : "ok"} />
      </div>

      <div className="ops-rules">
        <div className="ops-rules-head">
          <p className="label">{t("告警规则")}</p>
          <button className="ghost-button" type="button" onClick={() => persistRules(DEFAULT_RULES)}>
            {t("重置默认")}
          </button>
        </div>
        <div className="ops-rules-grid">
          {RULE_META.map((meta) => {
            const on = rules[meta.key];
            return (
              <div className={`ops-rule ${on ? "is-on" : ""}`} key={meta.key}>
                <label className="setting-toggle">
                  <span>
                    <i className={`sev-dot sev-${meta.severity}`} aria-hidden="true" />
                    {t(meta.label)}
                  </span>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) => persistRules({ ...rules, [meta.key]: event.target.checked })}
                  />
                  <i aria-hidden="true" />
                </label>
                <p className="ops-rule-hint">{t(meta.hint)}</p>
                {meta.threshold ? (
                  <label className="ops-rule-th">
                    <span>{t("阈值 {n}%", { n: Math.round((meta.threshold === "cost" ? rules.costThreshold : rules.rpmThreshold) * 100) })}</span>
                    <input
                      type="range"
                      min={50}
                      max={100}
                      step={5}
                      disabled={!on}
                      value={Math.round((meta.threshold === "cost" ? rules.costThreshold : rules.rpmThreshold) * 100)}
                      onChange={(event) =>
                        persistRules({
                          ...rules,
                          [meta.threshold === "cost" ? "costThreshold" : "rpmThreshold"]: Number(event.target.value) / 100,
                        })
                      }
                    />
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {error ? <div className="error-box" role="alert">{error}</div> : null}

      {alerts.length === 0 && !loading && !error ? (
        <p className="empty-state ops-clear">
          <i className="sev-dot sev-ok" aria-hidden="true" />
          {t("无触发告警 — 已扫描账号均在阈值内。")}
        </p>
      ) : (
        <ul className="ops-feed">
          {alerts.map((alert, index) => (
            <li className={`ops-alert sev-${alert.severity}`} key={`${alert.account.id ?? "x"}-${index}`}>
              <span className={`sev-bar sev-${alert.severity}`} aria-hidden="true" />
              <div className="ops-alert-main">
                <div className="ops-alert-top">
                  <strong>{alert.account.email || alert.account.name || t("未命名账号")}</strong>
                  <span className="ops-alert-rule">{alert.headline}</span>
                </div>
                <p className="ops-alert-detail">{alert.detail}</p>
                <div className="ops-alert-meta">
                  {alert.tags.map((tag) => (
                    <span className={`ops-chip sev-${tag.severity}`} key={tag.key}>{tag.label}</span>
                  ))}
                  {alert.account.groups.map((groupName) => (
                    <span className="ops-chip is-group" key={groupName}>{groupName}</span>
                  ))}
                  <span className="ops-alert-when">{t("最近 {d}", { d: formatDate(alert.account.lastUsedAt) })}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OpsStat({ k, v, tone }: { k: string; v: string; tone: "ok" | "warn" | "bad" | "muted" }) {
  return (
    <div className="stat-card">
      <p className="k">{k}</p>
      <p className="v">
        <span className={`dot ${tone}`} />
        {v}
      </p>
    </div>
  );
}

/** Evaluate each notable account against the enabled rules; one row per account. */
function buildAlerts(accounts: PoolAccount[], rules: RuleConfig, t: TFn): Alert[] {
  const out: Alert[] = [];

  for (const account of accounts) {
    const tags: Alert["tags"] = [];

    if (rules.error && account.status === "error") {
      tags.push({ key: "error", label: t("掉权"), severity: "critical" });
    }
    if (rules.cooldown && cooldownText(account, t)) {
      tags.push({ key: "cooldown", label: t("冷却"), severity: "warn" });
    }
    if (rules.cost) {
      const ratio = pressureRatio(account.currentWindowCost, account.windowCostLimit);
      if (ratio >= rules.costThreshold) tags.push({ key: "cost", label: t("额度"), severity: "warn" });
    }
    if (rules.rpm) {
      const ratio = pressureRatio(account.currentRpm, account.baseRpm);
      if (ratio >= rules.rpmThreshold) tags.push({ key: "rpm", label: t("RPM"), severity: "warn" });
    }
    if (rules.disabled && account.status !== "error" && (account.status === "disabled" || account.schedulable === false)) {
      tags.push({ key: "disabled", label: t("停用"), severity: "info" });
    }

    if (!tags.length) continue;

    tags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const primary = tags[0];
    out.push({
      account,
      primary: primary.key,
      severity: primary.severity,
      headline: t(RULE_META.find((meta) => meta.key === primary.key)?.label ?? "") || primary.label,
      detail: detailFor(primary.key, account, rules, t),
      tags,
    });
  }

  out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return out;
}

function detailFor(rule: RuleKey, account: PoolAccount, rules: RuleConfig, t: TFn): string {
  switch (rule) {
    case "error":
      return account.errorMessage || t("账号返回错误或已被封禁，需人工介入。");
    case "cooldown":
      return cooldownText(account, t) || t("账号处于限流冷却中。");
    case "cost": {
      const pct = Math.round(pressureRatio(account.currentWindowCost, account.windowCostLimit) * 100);
      return t("窗口额度 ${cur} / ${lim}（{pct}% ≥ {th}%）", {
        cur: (account.currentWindowCost ?? 0).toFixed(2),
        lim: (account.windowCostLimit ?? 0).toFixed(2),
        pct,
        th: Math.round(rules.costThreshold * 100),
      });
    }
    case "rpm": {
      const pct = Math.round(pressureRatio(account.currentRpm, account.baseRpm) * 100);
      return t("RPM {cur} / {base}（{pct}% ≥ {th}%）", {
        cur: account.currentRpm ?? 0,
        base: account.baseRpm ?? 0,
        pct,
        th: Math.round(rules.rpmThreshold * 100),
      });
    }
    case "disabled":
      return account.schedulable === false ? t("账号被标记为不可调度。") : t("账号已停用。");
    default:
      return "";
  }
}

function cooldownText(account: PoolAccount, t: TFn): string | null {
  const now = Date.now();
  const future = (ts: string | null) => {
    if (!ts) return false;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) && parsed > now;
  };
  if (future(account.overloadUntil)) return t("过载至 {d}", { d: formatDate(account.overloadUntil) });
  if (future(account.rateLimitResetAt)) return t("限流至 {d}", { d: formatDate(account.rateLimitResetAt) });
  if (future(account.tempUnschedulableUntil)) {
    const reason = account.tempUnschedulableReason ? `（${account.tempUnschedulableReason}）` : "";
    return t("冷却至 {d}", { d: formatDate(account.tempUnschedulableUntil) }) + reason;
  }
  return null;
}

function pressureRatio(current: number | null, limit: number | null): number {
  if (!limit || limit <= 0 || current == null || current < 0) return 0;
  return current / limit;
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function readOpsError(status: number, error?: string) {
  if (status === 403) return "当前角色不允许查看账号池。";
  if (status === 503 && error === "sub2api_not_configured") return "Sub2API 尚未配置，请在「多平台后端」填写地址与管理令牌。";
  if (status === 502 && error === "sub2api_auth_failed") return "鉴权失败或权限不足，请检查该平台的令牌或账号密码。";
  return error || "读取账号池运维数据失败。";
}
