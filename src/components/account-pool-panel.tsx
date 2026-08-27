"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PoolAccount = {
  id: number | string | null;
  name: string | null;
  email: string | null;
  platform: string;
  type: string;
  status: string;
  schedulable: boolean | null;
  errorMessage: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  subscription: string | null;
  groups: string[];
  rateMultiplier: number | null;
  concurrency: number | null;
  currentConcurrency: number | null;
  baseRpm: number | null;
  currentRpm: number | null;
  windowCostLimit: number | null;
  currentWindowCost: number | null;
  maxSessions: number | null;
  activeSessions: number | null;
  rateLimitResetAt: string | null;
  overloadUntil: string | null;
  tempUnschedulableUntil: string | null;
  tempUnschedulableReason: string | null;
  sessionWindowEnd: string | null;
  sessionWindowStatus: string | null;
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

type PoolResponse = { accounts?: { items?: PoolAccount[]; total?: number }; stats?: PoolStats | null; capacity?: number; error?: string };

const SORTS: { value: string; label: string }[] = [
  { value: "created_at:desc", label: "添加时间 新到旧" },
  { value: "created_at:asc", label: "添加时间 旧到新" },
  { value: "last_used_at:desc", label: "最近使用 新到旧" },
  { value: "rate_multiplier:desc", label: "倍率 高到低" },
  { value: "status:asc", label: "状态" },
  { value: "name:asc", label: "名称" },
];

const STATUSES: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "active", label: "正常" },
  { value: "error", label: "掉权 / 错误" },
  { value: "disabled", label: "已停用" },
];

const PAGE_SIZES = [20, 50, 100];
const REFRESH_MS = 15000;

export default function AccountPoolPanel({ sub2ApiConfigured }: { sub2ApiConfigured: boolean }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<PoolAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [capacity, setCapacity] = useState(1000);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("created_at:desc");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"card" | "list">("card");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const redirectToLogin = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  const load = useCallback(async () => {
    if (!sub2ApiConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [field, order] = sort.split(":");
      const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort_by: field, sort_order: order });
      if (search.trim()) qs.set("search", search.trim());
      if (status) qs.set("status", status);

      const response = await fetch(`/api/provisioning/pool?${qs}`, { cache: "no-store" });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json().catch(() => ({}))) as PoolResponse;
      if (!response.ok) {
        setAccounts([]);
        setStats(null);
        setError(readPoolError(response.status, payload.error));
        return;
      }
      setAccounts(payload.accounts?.items ?? []);
      setTotal(payload.accounts?.total ?? 0);
      setStats(payload.stats ?? null);
      setCapacity(payload.capacity ?? 1000);
    } catch {
      setError("无法连接账号池服务，请检查本地服务状态。");
    } finally {
      setLoading(false);
    }
  }, [sub2ApiConfigured, sort, page, pageSize, search, status, redirectToLogin]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !sub2ApiConfigured) return;
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, sub2ApiConfigured, load]);

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  const available = stats ? `${stats.normalAccounts} / ${stats.totalAccounts}` : `— / ${total}`;
  const cooling = stats ? stats.ratelimitAccounts + stats.overloadAccounts : 0;
  const carried = stats ? stats.totalAccounts : total;

  if (!sub2ApiConfigured) {
    return (
      <section className="pool">
        <div className="pool-heading">
          <div>
            <p className="label">账号池统揽</p>
            <h3>已入池账号</h3>
          </div>
        </div>
        <p className="empty-state">账号池仅对 Sub2API 可用。请先在「多平台后端」配置并启用 Sub2API。</p>
      </section>
    );
  }

  return (
    <section className="pool" aria-labelledby="pool-title">
      <div className="pool-heading">
        <div>
          <p className="label">账号池统揽</p>
          <h3 id="pool-title">OAuth 账号调度与健康</h3>
        </div>
        <div className="pool-heading-actions">
          <label className="setting-toggle pool-auto">
            <span>自动刷新 15s</span>
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <i aria-hidden="true" />
          </label>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      <div className="pool-stats">
        <PoolStat k="可用账号" v={available} tone="ok" />
        <PoolStat k="冷却中" v={String(cooling)} tone={cooling > 0 ? "warn" : "muted"} />
        <PoolStat k="全局 RPM" v={stats ? String(stats.rpm) : "—"} tone="muted" />
        <PoolStat k="今日额度" v={stats ? `$${stats.todayCost.toFixed(2)}` : "—"} tone="muted" />
        <PoolStat k="今日请求" v={stats ? formatCount(stats.todayRequests) : "—"} tone="muted" />
        <PoolStat k="承载" v={`${carried} / ${capacity}`} tone={carried >= capacity ? "bad" : "muted"} />
      </div>

      <form className="pool-filters" onSubmit={applySearch}>
        <input
          className="text-input"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="搜索账号名 / 邮箱，回车"
          aria-label="搜索账号"
        />
        <select className="text-input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label="状态">
          {STATUSES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select className="text-input" value={sort} onChange={(event) => { setPage(1); setSort(event.target.value); }} aria-label="排序">
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select className="text-input" value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }} aria-label="每页">
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size} 条</option>
          ))}
        </select>
        <div className="pool-view">
          <button type="button" className={view === "card" ? "is-active" : ""} onClick={() => setView("card")}>卡片</button>
          <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>列表</button>
        </div>
      </form>

      {error ? <div className="error-box" role="alert">{error}</div> : null}

      {accounts.length === 0 && !loading && !error ? (
        <p className="empty-state">没有匹配的账号。调整筛选或先在「授权上号」入池。</p>
      ) : view === "card" ? (
        <div className="pool-grid">
          {accounts.map((account, index) => (
            <PoolCard key={keyOf(account, index)} account={account} />
          ))}
        </div>
      ) : (
        <PoolList accounts={accounts} />
      )}

      <div className="pool-foot">
        <span>{total ? `${rangeStart}-${rangeEnd} / 共 ${total}` : "共 0"}</span>
        <div className="pool-pager">
          <button className="secondary-button compact-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </button>
          <span className="pool-page">{page} / {totalPages}</span>
          <button className="secondary-button compact-button" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}

function PoolStat({ k, v, tone }: { k: string; v: string; tone: "ok" | "warn" | "bad" | "muted" }) {
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

function PoolCard({ account }: { account: PoolAccount }) {
  const health = healthOf(account);
  const cooldown = cooldownOf(account);
  const title = account.email || account.name || "未命名账号";

  return (
    <article className="pool-card">
      <div className="pool-card-top">
        <span className="avatar">{initial(title)}</span>
        <div className="pool-id">
          <strong>{title}</strong>
          <span>{account.name && account.email ? account.name : account.platform} · 添加 {formatDate(account.createdAt)}</span>
        </div>
        <span className={`account-status ${health.className}`}>{health.label}</span>
      </div>

      <div className="pool-badges">
        {account.subscription ? <span className="pool-tag">{account.subscription.toUpperCase()}</span> : null}
        <span className="pool-tag is-faint">{account.type.toUpperCase()}</span>
        {account.groups.map((group) => (
          <span className="pool-tag is-group" key={group}>{group}</span>
        ))}
      </div>

      {account.status === "error" && account.errorMessage ? (
        <p className="pool-error">{account.errorMessage}</p>
      ) : null}
      {cooldown ? <p className="pool-cooldown">{cooldown}</p> : null}

      <div className="pool-meters">
        <Meter label="RPM" current={account.currentRpm} limit={account.baseRpm} />
        <Meter label="并发" current={account.currentConcurrency} limit={account.concurrency} />
        <Meter label="SLOTS" current={account.activeSessions} limit={account.maxSessions} />
      </div>

      <div className="pool-card-foot">
        <span>倍率 ×{account.rateMultiplier ?? 1}</span>
        <span>最近使用 {account.lastUsedAt ? formatDate(account.lastUsedAt) : "—"}</span>
      </div>
    </article>
  );
}

function PoolList({ accounts }: { accounts: PoolAccount[] }) {
  return (
    <div className="pool-table" role="table">
      <div className="pool-row is-head" role="row">
        <span>账号</span>
        <span>状态</span>
        <span>订阅</span>
        <span>RPM</span>
        <span>并发</span>
        <span>SLOTS</span>
        <span>倍率</span>
      </div>
      {accounts.map((account, index) => {
        const health = healthOf(account);
        return (
          <div className="pool-row" role="row" key={keyOf(account, index)}>
            <span className="pool-row-id">
              <strong>{account.email || account.name || "未命名"}</strong>
              <em>{account.groups.join(" · ") || account.platform}</em>
            </span>
            <span><i className={`account-status ${health.className}`}>{health.label}</i></span>
            <span>{account.subscription ? account.subscription.toUpperCase() : "—"}</span>
            <span>{meterText(account.currentRpm, account.baseRpm)}</span>
            <span>{meterText(account.currentConcurrency, account.concurrency)}</span>
            <span>{meterText(account.activeSessions, account.maxSessions)}</span>
            <span>×{account.rateMultiplier ?? 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function Meter({ label, current, limit }: { label: string; current: number | null; limit: number | null }) {
  const cur = current ?? 0;
  const lim = limit ?? 0;
  const pct = lim > 0 ? Math.min(100, Math.round((cur / lim) * 100)) : 0;
  return (
    <div className="pool-meter">
      <div className="pool-meter-head">
        <span>{label}</span>
        <b>{cur}{lim ? ` / ${lim}` : ""}</b>
      </div>
      <div className="pool-meter-track">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function healthOf(account: PoolAccount): { label: string; className: string } {
  if (account.status === "error") return { label: "掉权", className: "is-dead" };
  if (account.status === "disabled" || account.schedulable === false) return { label: "已停用", className: "" };
  return { label: "正常", className: "is-alive" };
}

function cooldownOf(account: PoolAccount): string | null {
  if (account.overloadUntil) return `过载至 ${formatDate(account.overloadUntil)}`;
  if (account.rateLimitResetAt) return `限流至 ${formatDate(account.rateLimitResetAt)}`;
  if (account.tempUnschedulableUntil) {
    const reason = account.tempUnschedulableReason ? `（${account.tempUnschedulableReason}）` : "";
    return `冷却至 ${formatDate(account.tempUnschedulableUntil)}${reason}`;
  }
  return null;
}

function meterText(current: number | null, limit: number | null) {
  const cur = current ?? 0;
  return limit ? `${cur} / ${limit}` : String(cur);
}

function keyOf(account: PoolAccount, index: number) {
  return `${account.id ?? "x"}-${index}`;
}

function initial(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
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

function readPoolError(status: number, error?: string) {
  if (status === 403) return "当前角色不允许查看账号池。";
  if (status === 503 && error === "sub2api_not_configured") return "Sub2API 尚未配置，请在「多平台后端」填写地址与管理令牌。";
  if (status === 502 && error === "sub2api_auth_failed") return "Sub2API 管理令牌无效或已过期，请更新 SUB2API_ADMIN_TOKEN。";
  return error || "读取账号池失败。";
}
