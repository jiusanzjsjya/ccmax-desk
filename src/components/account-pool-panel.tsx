"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PoolOpsBoard from "@/components/pool-ops-board";
import { useI18n } from "@/lib/i18n/context";
import type { TVars } from "@/lib/i18n/context";

type WindowUse = {
  utilization: number;
  resetsAt: string | null;
  remainingSeconds: number;
  cost: number | null;
  requests: number | null;
};

type PoolUsage = {
  today: { cost: number; requests: number } | null;
  fiveHour: WindowUse | null;
  sevenDay: WindowUse | null;
  sevenDaySonnet: WindowUse | null;
  sevenDayFable: WindowUse | null;
  thirtyDay: WindowUse | null;
};

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
  usage?: PoolUsage | null;
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

type GroupOption = { id: number; name: string };
type PlatformOption = { ref: string; kind: string; label: string };

type PoolResponse = {
  accounts?: { items?: PoolAccount[]; total?: number };
  stats?: PoolStats | null;
  groups?: GroupOption[] | null;
  capacity?: number;
  scoped?: boolean;
  pending?: boolean;
  error?: string;
};

const SERVER_SORTS: { value: string; label: string }[] = [
  { value: "created_at:desc", label: "添加时间 新到旧" },
  { value: "created_at:asc", label: "添加时间 旧到新" },
  { value: "last_used_at:desc", label: "最近使用 新到旧" },
  { value: "rate_multiplier:desc", label: "倍率 高到低" },
  { value: "status:asc", label: "状态" },
  { value: "name:asc", label: "名称" },
];

const CLIENT_SORTS: { value: string; label: string }[] = [
  { value: "c:todayCost:desc", label: "今日额度 高到低" },
  { value: "c:todayCost:asc", label: "今日额度 低到高" },
  { value: "c:rpm:desc", label: "RPM 高到低" },
  { value: "c:concurrency:desc", label: "并发 高到低" },
  { value: "c:todayReq:desc", label: "今日请求 高到低" },
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
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<PoolAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [capacity, setCapacity] = useState(1000);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const groupsLoaded = useRef(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("created_at:desc");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"card" | "list">("card");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [mode, setMode] = useState<"accounts" | "ops">("accounts");

  const [platform, setPlatform] = useState("sub2api");
  const [platforms, setPlatforms] = useState<PlatformOption[]>([]);
  const [scoped, setScoped] = useState(false);
  const [pending, setPending] = useState(false);

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
      // Client-side sorts fetch a stable page (created_at desc) and reorder locally.
      const [field, order] = sort.startsWith("c:") ? ["created_at", "desc"] : sort.split(":");
      const qs = new URLSearchParams({ platform, page: String(page), page_size: String(pageSize), sort_by: field, sort_order: order });
      if (search.trim()) qs.set("search", search.trim());
      if (group) qs.set("group", group);
      if (status) qs.set("status", status);
      if (!groupsLoaded.current) qs.set("with_groups", "1");

      const response = await fetch(`/api/provisioning/pool?${qs}`, { cache: "no-store" });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json().catch(() => ({}))) as PoolResponse;
      if (!response.ok) {
        setAccounts([]);
        setStats(null);
        setError(readPoolError(t, response.status, payload.error));
        return;
      }
      // Platforms other than Sub2API have no browsable pool yet.
      if (payload.pending) {
        setPending(true);
        setAccounts([]);
        setStats(null);
        setTotal(0);
        return;
      }
      setPending(false);
      setScoped(Boolean(payload.scoped));
      setAccounts(payload.accounts?.items ?? []);
      setTotal(payload.accounts?.total ?? 0);
      setStats(payload.stats ?? null);
      setCapacity(payload.capacity ?? 1000);
      if (payload.groups) {
        setGroups(payload.groups);
        groupsLoaded.current = true;
      }
    } catch {
      setError(t("无法连接账号池服务，请检查本地服务状态。"));
    } finally {
      setLoading(false);
    }
  }, [sub2ApiConfigured, platform, sort, page, pageSize, search, group, status, redirectToLogin, t]);

  useEffect(() => {
    if (mode !== "accounts") return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, mode]);

  useEffect(() => {
    if (!autoRefresh || !sub2ApiConfigured || mode !== "accounts") return;
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, sub2ApiConfigured, load, mode]);

  // Platforms change rarely — fetch the selector list once.
  useEffect(() => {
    let active = true;
    void fetch("/api/provisioning/pool/platforms", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { default?: string | null; items?: PlatformOption[] } | null) => {
        if (!active || !payload) return;
        if (payload.items?.length) setPlatforms(payload.items);
        // Lock a scoped admin/user's view onto their assigned platform.
        if (payload.default) setPlatform(payload.default);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }

  const displayed = useMemo(() => sortClientSide(accounts, sort), [accounts, sort]);

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
            <p className="label">{t("账号池统揽")}</p>
            <h3>{t("已入池账号")}</h3>
          </div>
        </div>
        <p className="empty-state">{t("账号池仅对 Sub2API 可用。请先在「多平台后端」配置并启用 Sub2API。")}</p>
      </section>
    );
  }

  return (
    <section className="pool" aria-labelledby="pool-title">
      <div className="pool-heading">
        <div>
          <p className="label">{t("账号池统揽")}</p>
          <h3 id="pool-title">{t("OAuth 账号调度与健康")}</h3>
          {scoped && !pending ? <p className="pool-scope-note">{t("仅显示本人上号的账号")}</p> : null}
        </div>
        <div className="pool-heading-actions">
          {platforms.length > 1 ? (
            <select
              className="text-input pool-platform"
              value={platform}
              onChange={(event) => { setPending(false); setPage(1); setPlatform(event.target.value); }}
              aria-label={t("平台")}
            >
              {platforms.map((option) => (
                <option key={option.ref} value={option.ref}>{option.label}</option>
              ))}
            </select>
          ) : null}
          <div className="pool-view pool-modes" role="tablist" aria-label={t("账号池视图")}>
            <button type="button" role="tab" aria-selected={mode === "accounts"} className={mode === "accounts" ? "is-active" : ""} onClick={() => setMode("accounts")}>
              {t("账号列表")}
            </button>
            <button type="button" role="tab" aria-selected={mode === "ops"} className={mode === "ops" ? "is-active" : ""} onClick={() => setMode("ops")}>
              {t("运维告警")}
            </button>
          </div>
          {mode === "accounts" ? (
            <>
              <label className="setting-toggle pool-auto">
                <span>{t("自动刷新 15s")}</span>
                <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
                <i aria-hidden="true" />
              </label>
              <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
                {loading ? t("刷新中...") : t("刷新")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {mode === "ops" ? <PoolOpsBoard platform={platform} sub2ApiConfigured={sub2ApiConfigured} /> : pending ? (
        <p className="empty-state">{t("该平台账号池待接入，敬请期待。")}</p>
      ) : (
      <>
      <div className="pool-stats">
        <PoolStat k={t("可用账号")} v={available} tone="ok" />
        <PoolStat k={t("冷却中")} v={String(cooling)} tone={cooling > 0 ? "warn" : "muted"} />
        <PoolStat k={scoped ? t("本人 RPM") : t("全局 RPM")} v={stats ? String(stats.rpm) : "—"} tone="muted" />
        <PoolStat k={t("今日额度")} v={stats ? `$${stats.todayCost.toFixed(2)}` : "—"} tone="muted" />
        <PoolStat k={t("今日请求")} v={stats ? formatCount(stats.todayRequests) : "—"} tone="muted" />
        <PoolStat k={t("承载")} v={`${carried} / ${capacity}`} tone={carried >= capacity ? "bad" : "muted"} />
      </div>

      <form className="pool-filters" onSubmit={applySearch}>
        <input
          className="text-input"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("搜索账号名 / 邮箱，回车")}
          aria-label={t("搜索账号")}
        />
        <select className="text-input" value={group} onChange={(event) => { setPage(1); setGroup(event.target.value); }} aria-label={t("分组")}>
          <option value="">{t("全部分组")}</option>
          {groups.map((option) => (
            <option key={option.id} value={String(option.id)}>{option.name}</option>
          ))}
        </select>
        <select className="text-input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label={t("状态")}>
          {STATUSES.map((option) => (
            <option key={option.value} value={option.value}>{t(option.label)}</option>
          ))}
        </select>
        <select className="text-input" value={sort} onChange={(event) => { setPage(1); setSort(event.target.value); }} aria-label={t("排序")}>
          <optgroup label={t("服务端排序")}>
            {SERVER_SORTS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.label)}</option>
            ))}
          </optgroup>
          <optgroup label={t("本页排序")}>
            {CLIENT_SORTS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.label)}</option>
            ))}
          </optgroup>
        </select>
        <select className="text-input" value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }} aria-label={t("每页")}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{t("{size} 条", { size })}</option>
          ))}
        </select>
        <div className="pool-view">
          <button type="button" className={view === "card" ? "is-active" : ""} onClick={() => setView("card")}>{t("卡片")}</button>
          <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>{t("列表")}</button>
        </div>
      </form>

      {error ? <div className="error-box" role="alert">{error}</div> : null}

      {displayed.length === 0 && !loading && !error ? (
        <p className="empty-state">{t("没有匹配的账号。调整筛选或先在「授权上号」入池。")}</p>
      ) : view === "card" ? (
        <div className="pool-grid">
          {displayed.map((account, index) => (
            <PoolCard key={keyOf(account, index)} account={account} />
          ))}
        </div>
      ) : (
        <PoolList accounts={displayed} />
      )}

      <div className="pool-foot">
        <span>{total ? t("{start}-{end} / 共 {total}", { start: rangeStart, end: rangeEnd, total }) : t("共 0")}</span>
        <div className="pool-pager">
          <button className="secondary-button compact-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {t("上一页")}
          </button>
          <span className="pool-page">{page} / {totalPages}</span>
          <button className="secondary-button compact-button" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            {t("下一页")}
          </button>
        </div>
      </div>
      </>
      )}
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
  const { t } = useI18n();
  const health = healthOf(t, account);
  const cooldown = cooldownOf(t, account);
  const title = account.email || account.name || t("未命名账号");
  const usage = account.usage;

  return (
    <article className="pool-card">
      <div className="pool-card-top">
        <span className="avatar">{initial(title)}</span>
        <div className="pool-id">
          <strong>{title}</strong>
          <span>{account.name && account.email ? account.name : account.platform} · {t("添加 {date}", { date: formatDate(account.createdAt) })}</span>
        </div>
        <span className={`account-status ${health.className}`}>{health.label}</span>
      </div>

      <div className="pool-badges">
        {account.subscription ? <span className="pool-tag">{account.subscription.toUpperCase()}</span> : null}
        <span className="pool-tag is-faint">{account.type.toUpperCase()}</span>
        {account.groups.map((groupName) => (
          <span className="pool-tag is-group" key={groupName}>{groupName}</span>
        ))}
      </div>

      {account.status === "error" && account.errorMessage ? <p className="pool-error">{account.errorMessage}</p> : null}
      {cooldown ? <p className="pool-cooldown">{cooldown}</p> : null}

      {usage ? (
        <>
          <div className="pool-usage">
            <UsageWin label="5h" w={usage.fiveHour} />
            <UsageWin label="7d" w={usage.sevenDay} />
            <UsageWin label="30d" w={usage.thirtyDay} />
          </div>
          {usage.sevenDayFable || usage.sevenDaySonnet ? (
            <p className="pool-models">
              {usage.sevenDayFable ? `Fable5 ${Math.round(usage.sevenDayFable.utilization)}%` : t("Fable5 无数据")}
              {" · "}
              {usage.sevenDaySonnet ? `Sonnet ${Math.round(usage.sevenDaySonnet.utilization)}%` : t("Sonnet 无数据")}
            </p>
          ) : null}
        </>
      ) : null}

      <div className="pool-meters">
        <Meter label="RPM" current={account.currentRpm} limit={account.baseRpm} />
        <Meter label={t("并发")} current={account.currentConcurrency} limit={account.concurrency} />
        <Meter label="SLOTS" current={account.activeSessions} limit={account.maxSessions} />
      </div>

      <div className="pool-card-foot">
        <span>{t("今日 {v}", { v: usage?.today ? t("${cost} · {req}次", { cost: usage.today.cost.toFixed(2), req: formatCount(usage.today.requests) }) : "—" })}</span>
        <span>{t("倍率 ×{rate} · 最近 {date}", { rate: account.rateMultiplier ?? 1, date: account.lastUsedAt ? formatDate(account.lastUsedAt) : "—" })}</span>
      </div>
    </article>
  );
}

function PoolList({ accounts }: { accounts: PoolAccount[] }) {
  const { t } = useI18n();
  return (
    <div className="pool-table" role="table">
      <div className="pool-row is-head" role="row">
        <span>{t("账号")}</span>
        <span>{t("状态")}</span>
        <span>{t("订阅")}</span>
        <span>{t("今日额度")}</span>
        <span>RPM</span>
        <span>{t("并发")}</span>
        <span>SLOTS</span>
        <span>{t("倍率")}</span>
      </div>
      {accounts.map((account, index) => {
        const health = healthOf(t, account);
        return (
          <div className="pool-row" role="row" key={keyOf(account, index)}>
            <span className="pool-row-id">
              <strong>{account.email || account.name || t("未命名")}</strong>
              <em>{account.groups.join(" · ") || account.platform}</em>
            </span>
            <span><i className={`account-status ${health.className}`}>{health.label}</i></span>
            <span>{account.subscription ? account.subscription.toUpperCase() : "—"}</span>
            <span>{account.usage?.today ? `$${account.usage.today.cost.toFixed(2)}` : "—"}</span>
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

function UsageWin({ label, w }: { label: string; w: WindowUse | null }) {
  const { t } = useI18n();
  const pct = w ? Math.min(100, Math.max(0, Math.round(w.utilization))) : 0;
  return (
    <div className={`pool-win ${w ? "" : "is-empty"}`}>
      <div className="pool-win-head">
        <span>{label}</span>
        <b>{w ? `${pct}%` : t("无数据")}</b>
      </div>
      <div className="pool-meter-track">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="pool-win-sub">
        <span>{w && w.cost != null ? `$${w.cost.toFixed(2)}` : "—"}{w && w.requests != null ? t(" · {req}次", { req: formatCount(w.requests) }) : ""}</span>
        <span>{w && w.remainingSeconds > 0 ? t("恢复 {duration}", { duration: formatDuration(w.remainingSeconds) }) : ""}</span>
      </div>
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

function sortClientSide(list: PoolAccount[], sort: string): PoolAccount[] {
  if (!sort.startsWith("c:")) return list;
  const [, key, order] = sort.split(":");
  const dir = order === "asc" ? 1 : -1;
  const valueOf = (account: PoolAccount): number => {
    switch (key) {
      case "todayCost":
        return account.usage?.today?.cost ?? -1;
      case "todayReq":
        return account.usage?.today?.requests ?? -1;
      case "rpm":
        return account.currentRpm ?? -1;
      case "concurrency":
        return account.currentConcurrency ?? -1;
      default:
        return 0;
    }
  };
  return [...list].sort((a, b) => (valueOf(a) - valueOf(b)) * dir);
}

function healthOf(t: (key: string, vars?: TVars) => string, account: PoolAccount): { label: string; className: string } {
  if (account.status === "error") return { label: t("掉权"), className: "is-dead" };
  if (account.status === "disabled" || account.schedulable === false) return { label: t("已停用"), className: "" };
  return { label: t("正常"), className: "is-alive" };
}

function cooldownOf(t: (key: string, vars?: TVars) => string, account: PoolAccount): string | null {
  if (account.overloadUntil) return t("过载至 {date}", { date: formatDate(account.overloadUntil) });
  if (account.rateLimitResetAt) return t("限流至 {date}", { date: formatDate(account.rateLimitResetAt) });
  if (account.tempUnschedulableUntil) {
    const reason = account.tempUnschedulableReason ? `（${account.tempUnschedulableReason}）` : "";
    return t("冷却至 {date}{reason}", { date: formatDate(account.tempUnschedulableUntil), reason });
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

function formatDuration(seconds: number) {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m ? ` ${m}m` : ""}`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function readPoolError(t: (key: string, vars?: TVars) => string, status: number, error?: string) {
  if (status === 403) return t("当前角色不允许查看账号池。");
  if (status === 503 && error === "sub2api_not_configured") return t("Sub2API 尚未配置，请在「多平台后端」填写地址与管理令牌。");
  if (status === 502 && error === "sub2api_auth_failed") return t("鉴权失败或权限不足，请检查该平台的令牌或账号密码。");
  return error || t("读取账号池失败。");
}
