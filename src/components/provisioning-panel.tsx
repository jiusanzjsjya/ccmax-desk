"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { isValidClaudeAuthCode, normalizeClaudeAuthCode } from "@/lib/claude-auth-code";
import { CLAUDE_COUNTRIES, DEFAULT_COUNTRY } from "@/lib/claude-countries";
import { useI18n, type I18nValue } from "@/lib/i18n/context";

type TFn = I18nValue["t"];

type ProvisioningPanelProps = {
  adminConfigured: boolean;
  sub2ApiConfigured: boolean;
  canViewAccountPool: boolean;
};

type Tab = "wizard" | "pending" | "accounts";
type SlotStatus = "pending" | "submitting" | "done" | "error";

type Slot = {
  flowId: string;
  authUrl: string;
  expiresAt: string;
  code: string;
  status: SlotStatus;
  result?: string;
};

type AccountSummary = {
  id: number | string | null;
  name: string | null;
  email: string | null;
  platform: string;
  type: string;
  status: string;
  schedulable: boolean | null;
  errorMessage: string | null;
  createdAt: string | null;
  displayName?: string | null;
  subscription?: string | null;
  deadCause?: string | null;
  backend?: string;
};

type ProxyOption = {
  id: number | string;
  name: string | null;
  protocol: string | null;
  host: string | null;
  port: number | null;
  status: string | null;
  latencyMs: number | null;
};

type BackendOption = { ref: string; kind: string; label: string };

/** A CCMax-local egress proxy option for the wizard (bookkeeping only). */
type EgressProxyOption = { id: string; label: string; protocol: string; host: string; port: number; accountCount: number };

const MAX_BATCH = 5;

export default function ProvisioningPanel({ adminConfigured, sub2ApiConfigured, canViewAccountPool }: ProvisioningPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("wizard");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [batchCount, setBatchCount] = useState(1);
  const [notes, setNotes] = useState("");
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [proxies, setProxies] = useState<ProxyOption[]>([]);
  const [selectedProxyId, setSelectedProxyId] = useState("");
  const [proxyAllowed, setProxyAllowed] = useState(false);
  const [backends, setBackends] = useState<BackendOption[]>([]);
  const [selectedBackend, setSelectedBackend] = useState("");
  const [backendSelectable, setBackendSelectable] = useState(true);
  // For a locked admin/user: "" = ok, "unassigned" = no platform assigned,
  // "unavailable" = assigned platform is no longer enabled/configured.
  const [platformNotice, setPlatformNotice] = useState<"" | "unassigned" | "unavailable">("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [proxyTest, setProxyTest] = useState<{ status: "idle" | "testing" | "ok" | "error"; message: string }>({
    status: "idle",
    message: "",
  });
  const [prefixEnabled, setPrefixEnabled] = useState(false);
  const [prefixes, setPrefixes] = useState<{ id: string; value: string }[]>([]);
  const [prefixId, setPrefixId] = useState("");
  const [proxyRequired, setProxyRequired] = useState(false);
  const [egressProxies, setEgressProxies] = useState<EgressProxyOption[]>([]);
  const [egressProxyId, setEgressProxyId] = useState("");

  const configured = adminConfigured && sub2ApiConfigured;

  const activeSlots = useMemo(
    () => slots.filter((slot) => slot.status !== "done" && !isExpired(slot.expiresAt, now)),
    [slots, now],
  );
  const pendingCount = activeSlots.length;

  const aliveCount = useMemo(
    () =>
      accounts.filter(
        (account) => account.status === "active" && account.schedulable !== false && !account.deadCause,
      ).length,
    [accounts],
  );
  const deadCount = accounts.length - aliveCount;

  const redirectToLogin = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Restore active slots from the server so a reload keeps pending authorizations.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/provisioning/claude/status", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as {
          slots?: Array<{ flowId: string; authUrl: string; expiresAt: string }>;
        };
        if (cancelled || !payload.slots?.length) return;

        setSlots(payload.slots.map((slot) => ({ ...slot, code: "", status: "pending" as const })));
      } catch {
        // Ignore restore failures; the operator can generate new slots.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load Sub2API proxies for the selector (admin only; 403 for plain users just hides it).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/provisioning/proxies", { cache: "no-store" });
        if (!response.ok) return; // 403 for plain users → proxy tools stay hidden
        const payload = (await response.json().catch(() => ({}))) as { items?: ProxyOption[] };
        if (cancelled) return;
        setProxyAllowed(true); // admin/superadmin may pick or create proxies
        if (payload.items?.length) setProxies(payload.items);
      } catch {
        // Proxy selection is optional; ignore failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load onboarding prefixes + whether a prefix is mandatory before generating.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/provisioning/prefixes", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as {
          enabled?: boolean;
          items?: { id: string; value: string }[];
        };
        if (cancelled) return;
        setPrefixEnabled(Boolean(payload.enabled));
        if (payload.items) setPrefixes(payload.items);
      } catch {
        // Prefix selection only gates onboarding when enabled; ignore failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load the caller's egress proxies + whether one is mandatory before onboarding.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/provisioning/egress-proxies", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as {
          forcedProxyEnabled?: boolean;
          items?: EgressProxyOption[];
        };
        if (cancelled) return;
        setProxyRequired(Boolean(payload.forcedProxyEnabled));
        if (payload.items) setEgressProxies(payload.items);
      } catch {
        // Egress proxy only gates onboarding when the toggle is on; ignore failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load the target platforms the superadmin has enabled + configured.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/provisioning/backends", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as {
          default?: string;
          items?: BackendOption[];
          canSelect?: boolean;
          targetUnassigned?: boolean;
          targetUnavailable?: boolean;
        };
        if (cancelled) return;
        // A locked admin/user with no usable platform: surface the reason and block.
        if (payload.targetUnassigned) {
          setBackendSelectable(false);
          setPlatformNotice("unassigned");
          return;
        }
        if (payload.targetUnavailable) {
          setBackendSelectable(false);
          setPlatformNotice("unavailable");
          return;
        }
        if (!payload.items?.length) return;
        // Locked users (canSelect === false) are pinned to their assigned platform; hide the picker.
        setBackendSelectable(payload.canSelect !== false);
        setBackends(payload.items);
        setSelectedBackend(payload.default && payload.items.some((item) => item.ref === payload.default)
          ? payload.default
          : payload.items[0].ref);
      } catch {
        // Backend selection is optional; the server falls back to the default.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateSlot(flowId: string, patch: Partial<Slot>) {
    setSlots((current) => current.map((slot) => (slot.flowId === flowId ? { ...slot, ...patch } : slot)));
  }

  async function testSelectedProxy() {
    if (!selectedProxyId) return;
    setProxyTest({ status: "testing", message: t("检测中...") });

    try {
      const response = await fetch(`/api/provisioning/proxies/${selectedProxyId}/test`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        latencyMs?: number | null;
        exitIp?: string | null;
        error?: string;
      };

      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok) {
        setProxyTest({ status: "error", message: readApiError(t, response.status, payload.error, t("代理检测失败。")) });
        return;
      }

      const parts = [payload.message || (payload.success ? t("可用") : t("不可用"))];
      if (payload.latencyMs != null) parts.push(`${payload.latencyMs}ms`);
      if (payload.exitIp) parts.push(t("出口 {ip}", { ip: payload.exitIp }));
      setProxyTest({ status: payload.success ? "ok" : "error", message: parts.join(" · ") });
    } catch {
      setProxyTest({ status: "error", message: t("无法连接代理检测服务。") });
    }
  }

  async function addCustomProxy(input: {
    name: string;
    protocol: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
  }): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch("/api/provisioning/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json().catch(() => ({}))) as { proxy?: ProxyOption; error?: string };
      if (response.status === 401) {
        redirectToLogin();
        return { ok: false, message: "" };
      }
      if (!response.ok || !payload.proxy) {
        return { ok: false, message: readApiError(t, response.status, payload.error, t("创建自定义代理失败。")) };
      }
      const proxy = payload.proxy;
      setProxies((current) => [proxy, ...current.filter((item) => String(item.id) !== String(proxy.id))]);
      setSelectedProxyId(String(proxy.id));
      setProxyTest({ status: "idle", message: "" });
      return { ok: true, message: t("已创建并选用代理：{name}", { name: proxy.name || `${proxy.host}:${proxy.port}` }) };
    } catch {
      return { ok: false, message: t("无法连接代理创建服务。") };
    }
  }

  async function generateSlots() {
    setActiveTab("wizard");
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch("/api/provisioning/claude/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: batchCount,
          ...(selectedProxyId ? { proxyId: Number(selectedProxyId) } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        slots?: Array<{ flowId: string; authUrl: string; expiresAt: string }>;
        partial?: boolean;
        error?: string;
      };

      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.slots?.length) {
        setError(readApiError(t, response.status, payload.error, t("生成授权槽位失败。")));
        return;
      }

      const fresh: Slot[] = payload.slots.map((slot) => ({ ...slot, code: "", status: "pending" }));
      setSlots((current) => [...current, ...fresh]);
      setMessage(
        payload.partial
          ? t("已生成 {n} 个槽位（部分请求失败）。请逐个完成官方登录后提交回执。", { n: fresh.length })
          : t("已生成 {n} 个授权槽位。请在新标签完成官方登录，再回到这里逐个提交回执。", { n: fresh.length }),
      );
    } catch {
      setError(t("无法连接 Sub2API 接入服务。"));
    } finally {
      setLoading(false);
    }
  }

  function cancelBatch() {
    setSlots((current) => current.filter((slot) => slot.status === "done"));
    setError("");
    setMessage(t("已取消当前授权批次，待处理槽位已清空。"));
  }

  async function submitSlot(slot: Slot) {
    const normalizedCode = normalizeClaudeAuthCode(slot.code);

    if (isExpired(slot.expiresAt, Date.now())) {
      updateSlot(slot.flowId, { status: "error", result: t("槽位已过期，请重新生成。") });
      return;
    }
    if (!isValidClaudeAuthCode(normalizedCode)) {
      updateSlot(slot.flowId, { status: "error", result: t("回执格式不正确，请粘贴完整的 code#state 或回调 URL。") });
      return;
    }

    updateSlot(slot.flowId, { status: "submitting", code: normalizedCode, result: undefined });

    try {
      const response = await fetch("/api/provisioning/claude/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowId: slot.flowId,
          code: normalizedCode,
          notes: notes.trim() || undefined,
          country: country.trim() || undefined,
          ...(prefixId ? { prefixId } : {}),
          ...(egressProxyId ? { egressProxyId } : {}),
          ...(selectedBackend ? { backend: selectedBackend } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { account?: AccountSummary; error?: string };

      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.account) {
        updateSlot(slot.flowId, {
          status: "error",
          result: readApiError(t, response.status, payload.error, t("Claude 账号接入失败。")),
        });
        return;
      }

      const label = payload.account.email || payload.account.name || t("账号已入池");
      updateSlot(slot.flowId, { status: "done", result: t("已入池：{label}", { label }) });
      setAccounts((current) => [payload.account as AccountSummary, ...current]);
    } catch {
      updateSlot(slot.flowId, { status: "error", result: t("无法连接 Sub2API 接入服务。") });
    }
  }

  async function loadAccounts() {
    setActiveTab("accounts");
    setError("");
    setAccountsLoading(true);

    try {
      const query = selectedBackend ? `?backend=${encodeURIComponent(selectedBackend)}` : "";
      const response = await fetch(`/api/provisioning/claude/accounts${query}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { items?: AccountSummary[]; error?: string };

      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.items) {
        setError(readApiError(t, response.status, payload.error, t("读取已入池账号失败。")));
        return;
      }

      setAccounts(payload.items);
      setMessage(t("账号列表已刷新。"));
    } catch {
      setError(t("无法连接 Sub2API 接入服务。"));
    } finally {
      setAccountsLoading(false);
    }
  }

  function clearFinished() {
    setSlots((current) => current.filter((slot) => slot.status !== "done" && !isExpired(slot.expiresAt, Date.now())));
    setMessage(t("已清理完成和过期的槽位。"));
  }

  return (
    <div className="provisioning-workspace">
      {!configured ? (
        <div className="error-box">
          {!adminConfigured ? t("超级管理员账号未配置。") : null}
          {!sub2ApiConfigured ? t(" Sub2API（Claude 授权代理）尚未配置，请在超管后台填写。") : null}
        </div>
      ) : null}

      {backends.length && backendSelectable ? (
        <div className="target-backend-bar">
          <label className="field-label" htmlFor="target-backend">{t("目标平台")}</label>
          <select
            id="target-backend"
            className="text-input"
            value={selectedBackend}
            onChange={(event) => setSelectedBackend(event.target.value)}
            disabled={loading}
          >
            {backends.map((backend) => (
              <option key={backend.ref} value={backend.ref}>
                {backend.label}
              </option>
            ))}
          </select>
        </div>
      ) : backends.length && !backendSelectable ? (
        // Locked admin/user: platform is fixed by the superadmin, shown read-only.
        <div className="target-backend-bar">
          <span className="field-label">{t("目标平台")}</span>
          <span className="target-backend-locked">{backends[0].label}</span>
        </div>
      ) : null}

      {platformNotice ? (
        <div className="error-box" role="alert">
          {platformNotice === "unassigned"
            ? t("尚未分配目标平台，暂时无法上号，请联系超级管理员分配。")
            : t("分配的目标平台当前不可用，请联系超级管理员检查平台配置。")}
        </div>
      ) : null}

      <div className={`workspace-nav ${canViewAccountPool ? "" : "is-compact"}`} role="tablist" aria-label={t("账号接入视图")}>
        <button className={`workspace-tab ${activeTab === "wizard" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("wizard")}>
          {t("授权向导")}
        </button>
        <button className={`workspace-tab ${activeTab === "pending" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("pending")}>
          {t("待处理槽位")} <span className="tab-count">{pendingCount}</span>
        </button>
        {canViewAccountPool ? (
          <button className={`workspace-tab ${activeTab === "accounts" ? "is-active" : ""}`} type="button" onClick={loadAccounts}>
            {t("已入池账号")}
          </button>
        ) : null}
      </div>

      <div className="summary-strip" aria-label={t("账号统计")}>
        <div><span>{t("存活")}</span><strong>{aliveCount}</strong></div>
        <div><span>{t("失效")}</span><strong>{deadCount}</strong></div>
        <div><span>{t("待授权")}</span><strong>{pendingCount}</strong></div>
      </div>

      {activeTab === "accounts" && canViewAccountPool ? (
        <AccountsView accounts={accounts} loading={accountsLoading} onRefresh={loadAccounts} />
      ) : activeTab === "pending" ? (
        <PendingView slots={activeSlots} now={now} onContinue={() => setActiveTab("wizard")} onNew={() => setActiveTab("wizard")} onCopy={copyToClipboard} />
      ) : (
        <WizardView
          slots={slots}
          activeSlots={activeSlots}
          batchCount={batchCount}
          notes={notes}
          loading={loading}
          configured={configured}
          platformBlocked={Boolean(platformNotice)}
          message={message}
          error={error}
          now={now}
          onGenerate={generateSlots}
          onSubmitSlot={submitSlot}
          onCancel={cancelBatch}
          onClearFinished={clearFinished}
          onCopy={copyToClipboard}
          setBatchCount={setBatchCount}
          setNotes={setNotes}
          setSlotCode={(flowId, code) => updateSlot(flowId, { code, status: "pending", result: undefined })}
          proxies={proxies}
          proxyAllowed={proxyAllowed}
          selectedProxyId={selectedProxyId}
          setSelectedProxyId={(value) => { setSelectedProxyId(value); setProxyTest({ status: "idle", message: "" }); }}
          onTestProxy={testSelectedProxy}
          onAddProxy={addCustomProxy}
          proxyTest={proxyTest}
          country={country}
          setCountry={setCountry}
          prefixEnabled={prefixEnabled}
          prefixes={prefixes}
          prefixId={prefixId}
          setPrefixId={setPrefixId}
          proxyRequired={proxyRequired}
          egressProxies={egressProxies}
          egressProxyId={egressProxyId}
          setEgressProxyId={setEgressProxyId}
        />
      )}

      {activeTab !== "wizard" && (message || error) ? (
        <div className={error ? "error-box" : "status-box"} role={error ? "alert" : "status"}>
          {error || message}
        </div>
      ) : null}
    </div>
  );
}

async function copyToClipboard(value: string) {
  // navigator.clipboard only exists in a secure context (HTTPS/localhost); on a
  // plain-HTTP IP deployment it is undefined, so fall back to a hidden textarea
  // + execCommand("copy"), which works everywhere. Either way, failure is silent
  // — the operator can still select the field manually.
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch {
    // Clipboard unavailable; the operator can still select the field manually.
  }
}

function WizardView({
  slots,
  activeSlots,
  batchCount,
  notes,
  loading,
  configured,
  platformBlocked,
  message,
  error,
  now,
  onGenerate,
  onSubmitSlot,
  onCancel,
  onClearFinished,
  onCopy,
  setBatchCount,
  setNotes,
  setSlotCode,
  proxies,
  proxyAllowed,
  selectedProxyId,
  setSelectedProxyId,
  onTestProxy,
  onAddProxy,
  proxyTest,
  country,
  setCountry,
  prefixEnabled,
  prefixes,
  prefixId,
  setPrefixId,
  proxyRequired,
  egressProxies,
  egressProxyId,
  setEgressProxyId,
}: {
  slots: Slot[];
  activeSlots: Slot[];
  batchCount: number;
  notes: string;
  loading: boolean;
  configured: boolean;
  platformBlocked: boolean;
  message: string;
  error: string;
  now: number;
  onGenerate: () => void;
  onSubmitSlot: (slot: Slot) => void;
  onCancel: () => void;
  onClearFinished: () => void;
  onCopy: (value: string) => void;
  setBatchCount: (value: number) => void;
  setNotes: (value: string) => void;
  setSlotCode: (flowId: string, code: string) => void;
  proxies: ProxyOption[];
  proxyAllowed: boolean;
  selectedProxyId: string;
  setSelectedProxyId: (value: string) => void;
  onTestProxy: () => void;
  onAddProxy: (input: { name: string; protocol: string; host: string; port: number; username?: string; password?: string }) => Promise<{ ok: boolean; message: string }>;
  proxyTest: { status: "idle" | "testing" | "ok" | "error"; message: string };
  country: string;
  setCountry: (value: string) => void;
  prefixEnabled: boolean;
  prefixes: { id: string; value: string }[];
  prefixId: string;
  setPrefixId: (value: string) => void;
  proxyRequired: boolean;
  egressProxies: EgressProxyOption[];
  egressProxyId: string;
  setEgressProxyId: (value: string) => void;
}) {
  const { t, locale } = useI18n();
  const doneCount = slots.filter((slot) => slot.status === "done").length;
  const [countryQuery, setCountryQuery] = useState("");
  const countryOptions = useMemo(() => {
    const query = countryQuery.trim();
    if (!query) return CLAUDE_COUNTRIES;
    const lower = query.toLowerCase();
    const matches = CLAUDE_COUNTRIES.filter(
      (item) => item.zh.includes(query) || item.en.toLowerCase().includes(lower) || item.code.toLowerCase().includes(lower),
    );
    // Keep the current selection visible even when it's filtered out.
    if (matches.some((item) => item.code === country)) return matches;
    const selected = CLAUDE_COUNTRIES.find((item) => item.code === country);
    return selected ? [selected, ...matches] : matches;
  }, [countryQuery, country]);

  return (
    <section className="wizard-panel" aria-labelledby="wizard-title">
      <div className="wizard-columns">
      <div className="step-body">
        <p className="label">{t("授权上号")}</p>
        <h3 id="wizard-title">{t("准备 Claude Max 账号")}</h3>
        <p className="step-lead">
          {t("一次可生成 1–{max} 个授权槽位；打开官方链接登录授权后，把回执粘回对应槽位提交入池——全部在本页完成。备注与注册国家会应用到这一批账号。", { max: MAX_BATCH })}
        </p>
        <div className="advanced-fields">
          <label className="field-label" htmlFor="batch-count">{t("生成槽位数（1–{max}）", { max: MAX_BATCH })}</label>
          <input
            id="batch-count"
            className="text-input"
            type="number"
            min={1}
            max={MAX_BATCH}
            value={batchCount}
            onChange={(event) => setBatchCount(clampBatch(event.target.value))}
            disabled={loading}
          />
          <label className="field-label" htmlFor="batch-notes">{t("批次备注（可选）")}</label>
          {prefixEnabled && prefixes.length ? (
            // Forced prefix on: the prefix dropdown is glued to the left of the note
            // input and joined with "-", so the row reads as the final note (Allen-0826).
            <div className="prefix-note-group">
              <select
                id="batch-prefix"
                className="text-input prefix-note-select"
                value={prefixId}
                onChange={(event) => setPrefixId(event.target.value)}
                disabled={loading}
                aria-label={t("强制前缀（必选）")}
              >
                <option value="">{t("请选择前缀")}</option>
                {prefixes.map((item) => (
                  <option key={item.id} value={item.id}>{item.value}</option>
                ))}
              </select>
              <span className="prefix-note-join" aria-hidden="true">-</span>
              <input
                id="batch-notes"
                className="text-input prefix-note-input"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("例如 0826，不要填写 token")}
                maxLength={500}
                disabled={loading}
              />
            </div>
          ) : (
            <>
              <input
                id="batch-notes"
                className="text-input"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("例如 Allen-0826，不要填写 token")}
                maxLength={500}
                disabled={loading}
              />
              {prefixEnabled ? (
                <p className="step-lead is-placeholder">{t("尚无可用前缀，请联系管理员在「账号与权限」中添加。")}</p>
              ) : null}
            </>
          )}
          <label className="field-label" htmlFor="batch-country-search">{t("注册国家")}</label>
          <input
            id="batch-country-search"
            className="text-input"
            value={countryQuery}
            onChange={(event) => setCountryQuery(event.target.value)}
            placeholder={t("搜索国家/地区，如 美国 或 US")}
            aria-label={t("搜索注册国家")}
            disabled={loading}
          />
          <select
            id="batch-country"
            className="text-input"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            disabled={loading}
            aria-label={t("注册国家")}
          >
            {countryOptions.map((item) => (
              <option key={item.code} value={item.code}>
                {locale === "en" ? `${item.en} (${item.code})` : `${item.zh}（${item.code}）`}
              </option>
            ))}
          </select>
          {proxyRequired || egressProxies.length ? (
            <>
              <label className="field-label" htmlFor="batch-egress-proxy">
                {proxyRequired ? t("本地出口代理（必选）") : t("本地出口代理（可选）")}
              </label>
              <select
                id="batch-egress-proxy"
                className="text-input"
                value={egressProxyId}
                onChange={(event) => setEgressProxyId(event.target.value)}
                disabled={loading}
                aria-label={t("本地出口代理")}
              >
                <option value="">{proxyRequired ? t("请选择代理") : t("不选")}</option>
                {egressProxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {(proxy.label || `${proxy.host}:${proxy.port}`) + t(" · {n} 个账号", { n: proxy.accountCount })}
                  </option>
                ))}
              </select>
              {proxyRequired && !egressProxies.length ? (
                <p className="step-lead is-placeholder">{t("尚无可用代理，请先在「代理配置」中添加。")}</p>
              ) : null}
            </>
          ) : null}
          {proxyAllowed ? (
            <>
              <label className="field-label" htmlFor="batch-proxy">{t("出口代理（可选）")}</label>
              <div className="flow-actions">
                <select
                  id="batch-proxy"
                  className="text-input"
                  value={selectedProxyId}
                  onChange={(event) => setSelectedProxyId(event.target.value)}
                  disabled={loading}
                >
                  <option value="">{t("默认（由 Sub2API 分配）")}</option>
                  {proxies.map((proxy) => (
                    <option key={proxy.id} value={String(proxy.id)}>
                      {proxyLabel(proxy)}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onTestProxy}
                  disabled={!selectedProxyId || proxyTest.status === "testing"}
                >
                  {proxyTest.status === "testing" ? t("检测中...") : t("检测代理")}
                </button>
              </div>
              {proxyTest.message ? (
                <p className={proxyTest.status === "error" ? "slot-result is-error" : "slot-result is-ok"}>
                  {proxyTest.message}
                </p>
              ) : null}
              <CustomProxyForm onAdd={onAddProxy} disabled={loading} />
            </>
          ) : null}
        </div>
        <div className="wizard-actions">
          <button className="oauth-button" type="button" onClick={onGenerate} disabled={!configured || loading || platformBlocked || (prefixEnabled && !prefixId) || (proxyRequired && !egressProxyId)}>
            {loading ? t("正在生成...") : t("生成 {n} 个授权槽位", { n: batchCount })}
          </button>
          {activeSlots.length ? (
            <button className="secondary-button" type="button" onClick={onCancel} disabled={loading}>
              {t("取消（清空 {n} 个待处理）", { n: activeSlots.length })}
            </button>
          ) : null}
        </div>
      </div>

      <div className="step-body">
        <p className="label">{t("授权与回执")}</p>
        <h3>{t("完成授权并提交")}</h3>
        {activeSlots.length ? (
          <>
            <p className="step-lead">{t("逐个打开官方授权链接登录同意，把成功页的 code#state（或回调 URL）粘回对应槽位提交。每个槽位独立入池。")}</p>
            <div className="slot-cards">
              {activeSlots.map((slot, index) => (
                <SlotFlowCard
                  key={slot.flowId}
                  slot={slot}
                  index={index}
                  now={now}
                  onCopy={onCopy}
                  onChange={(code) => setSlotCode(slot.flowId, code)}
                  onSubmit={() => onSubmitSlot(slot)}
                />
              ))}
            </div>
            {doneCount ? (
              <div className="wizard-actions">
                <button className="secondary-button" type="button" onClick={onClearFinished}>
                  {t("清理已完成（{n}）", { n: doneCount })}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="step-lead is-placeholder">{t("生成槽位后，在此完成官方授权并提交回执入池。")}</p>
        )}
      </div>
      </div>

      {message && !error ? <div className="status-box" role="status">{message}</div> : null}
      {error ? <div className="error-box" role="alert">{error}</div> : null}
    </section>
  );
}

type ProxyKind = "http" | "socks5";

type ParsedProxy = { protocol: ProxyKind; host: string; port: number; username?: string; password?: string };

const PROXY_PLACEHOLDER = "socks5://user:pass@1.2.3.4:1080  或  http://1.2.3.4:8080";

/**
 * Parse a pasted proxy string. The protocol is read from a required scheme prefix
 * (http/https -> http, socks5/socks5h -> socks5), so it is never guessed. After the
 * scheme, three address shapes are accepted: `host:port`, `host:port:user:pass`,
 * and `user:pass@host:port`.
 */
function parseProxyString(raw: string, t: TFn): { ok: true; value: ParsedProxy } | { ok: false; message: string } {
  let text = raw.trim();
  if (!text) return { ok: false, message: t("请粘贴代理地址。") };

  const scheme = text.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (!scheme) return { ok: false, message: t("请加协议头 http:// 或 socks5://。") };
  const name = scheme[1].toLowerCase();
  const protocol: ProxyKind | null =
    name === "http" || name === "https" ? "http" : name === "socks5" || name === "socks5h" ? "socks5" : null;
  if (!protocol) return { ok: false, message: t("无法识别的协议头 {name}://。", { name }) };
  text = text.slice(scheme[0].length);

  let host = "";
  let portText = "";
  let username: string | undefined;
  let password: string | undefined;

  const at = text.lastIndexOf("@");
  if (at >= 0) {
    const cred = text.slice(0, at);
    const hostPort = text.slice(at + 1);
    const ci = cred.indexOf(":");
    if (ci < 0) return { ok: false, message: t("认证部分应为 user:pass。") };
    username = cred.slice(0, ci);
    password = cred.slice(ci + 1);
    const hp = hostPort.split(":");
    if (hp.length !== 2) return { ok: false, message: t("地址部分应为 host:port。") };
    [host, portText] = hp;
  } else {
    const parts = text.split(":");
    if (parts.length === 2) {
      [host, portText] = parts;
    } else if (parts.length === 4) {
      [host, portText, username, password] = parts;
    } else {
      return { ok: false, message: t("格式应为 host:port、host:port:user:pass 或 user:pass@host:port。") };
    }
  }

  host = host.trim();
  const port = Number(portText.trim());
  if (!host) return { ok: false, message: t("缺少主机地址。") };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: t("端口无效（1–65535）。") };
  if (username !== undefined && username.trim() === "") return { ok: false, message: t("用户名不能为空（或整体省略认证）。") };

  return { ok: true, value: { protocol, host, port, username: username?.trim() || undefined, password: password || undefined } };
}

function CustomProxyForm({
  onAdd,
  disabled,
}: {
  onAdd: (input: { name: string; protocol: string; host: string; port: number; username?: string; password?: string }) => Promise<{ ok: boolean; message: string }>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const parsed = useMemo(() => parseProxyString(raw, t), [raw, t]);

  async function submit() {
    if (!parsed.ok) {
      setResult({ ok: false, message: parsed.message });
      return;
    }
    setBusy(true);
    setResult(null);
    const res = await onAdd({
      name: name.trim(),
      protocol: parsed.value.protocol,
      host: parsed.value.host,
      port: parsed.value.port,
      username: parsed.value.username,
      password: parsed.value.password,
    });
    setResult(res.message ? res : null);
    setBusy(false);
    if (res.ok) {
      setRaw("");
      setName("");
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button className="secondary-button" type="button" onClick={() => setOpen(true)} disabled={disabled}>
        {t("＋ 添加自定义代理")}
      </button>
    );
  }

  return (
    <div className="custom-proxy">
      <label className="field-label" htmlFor="proxy-paste">{t("粘贴代理地址")}</label>
      <input
        id="proxy-paste"
        className="text-input"
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        placeholder={t(PROXY_PLACEHOLDER)}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        aria-label={t("代理地址")}
      />

      {raw.trim() ? (
        parsed.ok ? (
          <p className="proxy-check is-ok">
            ✓ {parsed.value.protocol}://{parsed.value.host}:{parsed.value.port}
            {parsed.value.username ? ` · ${t("认证 {user}", { user: parsed.value.username })}` : ` · ${t("无认证")}`}
          </p>
        ) : (
          <p className="proxy-check is-error">✕ {parsed.message}</p>
        )
      ) : (
        <p className="proxy-check">{t("需带 http:// 或 socks5:// 前缀，协议自动识别；支持 host:port、host:port:user:pass、user:pass@host:port。")}</p>
      )}

      <input
        className="text-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t("名称（可选）")}
        maxLength={80}
        disabled={busy}
        aria-label={t("名称")}
      />

      <div className="flow-actions">
        <button className="oauth-button" type="button" onClick={submit} disabled={busy || !parsed.ok}>
          {busy ? t("创建中...") : t("创建并选用")}
        </button>
        <button className="secondary-button" type="button" onClick={() => { setOpen(false); setResult(null); }} disabled={busy}>
          {t("收起")}
        </button>
      </div>
      {result ? <p className={result.ok ? "slot-result is-ok" : "slot-result is-error"}>{result.message}</p> : null}
    </div>
  );
}

function SlotFlowCard({
  slot,
  index,
  now,
  onCopy,
  onChange,
  onSubmit,
}: {
  slot: Slot;
  index: number;
  now: number;
  onCopy: (value: string) => void;
  onChange: (code: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const expired = isExpired(slot.expiresAt, now);
  const submitting = slot.status === "submitting";
  return (
    <div className="flow-card">
      <div className="flow-card-head">
        <SlotBadge slot={slot} now={now} />
        <span className="flow-id">{t("槽位 #{n} · {id}", { n: index + 1, id: slot.flowId.slice(0, 8) })}</span>
      </div>
      <label className="field-label" htmlFor={`auth-url-${slot.flowId}`}>{t("① 官方授权链接")}</label>
      <input
        id={`auth-url-${slot.flowId}`}
        className="text-input auth-url-input"
        value={slot.authUrl}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="flow-actions">
        <a className="oauth-button" href={slot.authUrl} target="_blank" rel="noreferrer" aria-disabled={expired}>
          {t("打开官方授权页 ↗")}
        </a>
        <button className="secondary-button" type="button" onClick={() => onCopy(slot.authUrl)}>
          {t("复制链接")}
        </button>
      </div>
      <label className="field-label" htmlFor={`code-${slot.flowId}`}>{t("② 授权回执（code#state 或回调 URL）")}</label>
      <textarea
        id={`code-${slot.flowId}`}
        className="text-input textarea-input"
        value={slot.code}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("粘贴完整的 code#state 或回调 URL")}
        rows={3}
        disabled={submitting}
      />
      <div className="flow-actions">
        <button className="oauth-button" type="button" onClick={onSubmit} disabled={submitting || !slot.code.trim()}>
          {submitting ? t("正在兑换并入池...") : t("提交回执并创建账号")}
        </button>
      </div>
      {slot.result ? (
        <p className={slot.status === "error" ? "slot-result is-error" : "slot-result is-ok"}>{slot.result}</p>
      ) : null}
    </div>
  );
}

function SlotBadge({ slot, now }: { slot: Slot; now: number }) {
  const { t } = useI18n();
  if (slot.status === "done") return <span className="flow-badge">{t("已完成")}</span>;
  const expired = isExpired(slot.expiresAt, now);
  return <span className={`flow-badge ${expired ? "is-expired" : ""}`}>{expired ? t("已过期") : t("剩余 {time}", { time: formatRemaining(slot.expiresAt, now) })}</span>;
}

function SlotAuthCard({ slot, index, now, onCopy }: { slot: Slot; index: number; now: number; onCopy: (value: string) => void }) {
  const { t } = useI18n();
  const expired = isExpired(slot.expiresAt, now);
  return (
    <div className="flow-card">
      <div className="flow-card-head">
        <SlotBadge slot={slot} now={now} />
        <span className="flow-id">{t("槽位 #{n} · {id}", { n: index + 1, id: slot.flowId.slice(0, 8) })}</span>
      </div>
      <label className="field-label" htmlFor={`auth-url-${slot.flowId}`}>{t("官方授权链接")}</label>
      <input
        id={`auth-url-${slot.flowId}`}
        className="text-input auth-url-input"
        value={slot.authUrl}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="flow-actions">
        <a className="oauth-button" href={slot.authUrl} target="_blank" rel="noreferrer" aria-disabled={expired}>
          {t("打开官方授权页 ↗")}
        </a>
        <button className="secondary-button" type="button" onClick={() => onCopy(slot.authUrl)}>
          {t("复制链接")}
        </button>
      </div>
    </div>
  );
}

function PendingView({
  slots,
  now,
  onContinue,
  onNew,
  onCopy,
}: {
  slots: Slot[];
  now: number;
  onContinue: () => void;
  onNew: () => void;
  onCopy: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="list-panel">
      <div className="panel-heading-row">
        <div>
          <p className="label">{t("待处理槽位")}</p>
          <h3>{t("授权槽位")}</h3>
        </div>
        <button className="secondary-button" type="button" onClick={onNew}>
          {t("新建槽位")}
        </button>
      </div>
      {slots.length ? (
        <>
          <div className="slot-cards">
            {slots.map((slot, index) => (
              <SlotAuthCard key={slot.flowId} slot={slot} index={index} now={now} onCopy={onCopy} />
            ))}
          </div>
          <div className="wizard-actions">
            <button className="oauth-button" type="button" onClick={onContinue}>
              {t("去提交回执")}
            </button>
          </div>
        </>
      ) : (
        <p className="empty-state">{t("当前没有待处理槽位。")}</p>
      )}
    </section>
  );
}

function AccountsView({ accounts, loading, onRefresh }: { accounts: AccountSummary[]; loading: boolean; onRefresh: () => void }) {
  const { t } = useI18n();
  return (
    <section className="list-panel">
      <div className="panel-heading-row">
        <div>
          <p className="label">{t("账号池")}</p>
          <h3>{t("已入池账号")}</h3>
        </div>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? t("刷新中...") : t("刷新列表")}
        </button>
      </div>
      {accounts.length ? (
        <div className="account-list">
          {accounts.map((account) => {
            const alive = account.status === "active" && account.schedulable !== false && !account.deadCause;
            return (
              <article className="account-row" key={`${account.id}-${account.createdAt || account.name}`}>
                <div className="account-main">
                  <strong>{account.email || account.displayName || account.name || t("未命名账号")}</strong>
                  <span>
                    {account.displayName || account.name || "Claude Code Max"}
                    {account.subscription ? ` · ${account.subscription}` : ""}
                  </span>
                </div>
                <div className="account-meta">
                  <span className={`account-status ${alive ? "is-alive" : "is-dead"}`}>
                    {alive ? t("存活") : account.deadCause || account.status || t("失效")}
                  </span>
                  <span>
                    {account.platform} / {account.type}
                    {account.backend ? ` · ${account.backend}` : ""}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-state">{t("暂无已入池账号。完成一次授权后，账号会显示在这里。")}</p>
      )}
    </section>
  );
}

function proxyLabel(proxy: ProxyOption) {
  const host = [proxy.host, proxy.port].filter(Boolean).join(":");
  const parts = [proxy.name || host || `#${proxy.id}`];
  if (proxy.protocol) parts.push(proxy.protocol);
  if (proxy.latencyMs != null) parts.push(`${proxy.latencyMs}ms`);
  if (proxy.status && proxy.status !== "active") parts.push(proxy.status);
  return parts.join(" · ");
}

function clampBatch(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(MAX_BATCH, Math.max(1, Math.floor(parsed)));
}

function isExpired(expiresAt: string, now: number) {
  return new Date(expiresAt).getTime() <= now;
}

function formatRemaining(expiresAt: string, now: number) {
  const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function readApiError(t: TFn, status: number, error: string | undefined, fallback: string) {
  if (status === 401) return t("管理员会话已失效，请重新登录。");
  if (status === 429) return t("待处理槽位过多，请先完成或清理已有槽位。");
  if (status === 502 && error === "sub2api_auth_failed") {
    return t("Sub2API 管理令牌无效或权限不足，请更新 SUB2API_ADMIN_TOKEN。");
  }
  if (status === 403) {
    if (error === "user_provisioning_disabled") return t("超级管理员已暂停普通用户上号，请联系管理员。");
    if (error === "target_platform_unassigned") return t("尚未分配目标平台，暂时无法上号，请联系超级管理员分配。");
    return t("当前角色或系统开关不允许执行此操作。");
  }
  if (status === 400 && error === "proxy_required") {
    return t("请先在「代理配置」中添加并选择一个出口代理。");
  }
  if (status === 410) return t("授权槽位已过期，请重新生成。");
  if (status === 503 && error === "provisioning_disabled") return t("超级管理员已暂停 Claude 上号流程。");
  if (status === 503 && error === "backend_not_configured") return t("目标后端尚未配置，请检查对应环境变量。");
  if (status === 503) return t("服务尚未配置完成，请检查 .env.local。");
  return error || fallback;
}

function redirectOnUnauthorized(response: Response, redirectToLogin: () => void) {
  if (response.status !== 401) return false;
  redirectToLogin();
  return true;
}
