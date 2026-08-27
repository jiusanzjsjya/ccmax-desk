"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { isValidClaudeAuthCode, normalizeClaudeAuthCode } from "@/lib/claude-auth-code";

type ProvisioningPanelProps = {
  adminConfigured: boolean;
  sub2ApiConfigured: boolean;
  canViewAccountPool: boolean;
};

type Step = 1 | 2 | 3;
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

type BackendOption = { kind: string; label: string };

const MAX_BATCH = 5;

export default function ProvisioningPanel({ adminConfigured, sub2ApiConfigured, canViewAccountPool }: ProvisioningPanelProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("wizard");
  const [step, setStep] = useState<Step>(1);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [batchCount, setBatchCount] = useState(1);
  const [notes, setNotes] = useState("");
  const [groupIds, setGroupIds] = useState("");
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [proxies, setProxies] = useState<ProxyOption[]>([]);
  const [selectedProxyId, setSelectedProxyId] = useState("");
  const [backends, setBackends] = useState<BackendOption[]>([]);
  const [selectedBackend, setSelectedBackend] = useState("");
  const [country, setCountry] = useState("");
  const [proxyTest, setProxyTest] = useState<{ status: "idle" | "testing" | "ok" | "error"; message: string }>({
    status: "idle",
    message: "",
  });

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
        setStep(2);
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
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as { items?: ProxyOption[] };
        if (!cancelled && payload.items?.length) setProxies(payload.items);
      } catch {
        // Proxy selection is optional; ignore failures.
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
        const payload = (await response.json().catch(() => ({}))) as { default?: string; items?: BackendOption[] };
        if (cancelled || !payload.items?.length) return;
        setBackends(payload.items);
        setSelectedBackend(payload.default && payload.items.some((item) => item.kind === payload.default)
          ? payload.default
          : payload.items[0].kind);
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
    setProxyTest({ status: "testing", message: "检测中..." });

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
        setProxyTest({ status: "error", message: readApiError(response.status, payload.error, "代理检测失败。") });
        return;
      }

      const parts = [payload.message || (payload.success ? "可用" : "不可用")];
      if (payload.latencyMs != null) parts.push(`${payload.latencyMs}ms`);
      if (payload.exitIp) parts.push(`出口 ${payload.exitIp}`);
      setProxyTest({ status: payload.success ? "ok" : "error", message: parts.join(" · ") });
    } catch {
      setProxyTest({ status: "error", message: "无法连接代理检测服务。" });
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
        setError(readApiError(response.status, payload.error, "生成授权槽位失败。"));
        return;
      }

      const fresh: Slot[] = payload.slots.map((slot) => ({ ...slot, code: "", status: "pending" }));
      setSlots((current) => [...current, ...fresh]);
      setStep(2);
      setMessage(
        payload.partial
          ? `已生成 ${fresh.length} 个槽位（部分请求失败）。请逐个完成官方登录后提交回执。`
          : `已生成 ${fresh.length} 个授权槽位。请在新标签完成官方登录，再回到这里逐个提交回执。`,
      );
    } catch {
      setError("无法连接 Sub2API 接入服务。");
    } finally {
      setLoading(false);
    }
  }

  function goToSubmitStep() {
    if (pendingCount === 0) {
      setError("当前没有待处理槽位，请先生成槽位。");
      setActiveTab("wizard");
      setStep(1);
      return;
    }
    setActiveTab("wizard");
    setStep(3);
    setError("");
    setMessage("");
  }

  async function submitSlot(slot: Slot) {
    const normalizedCode = normalizeClaudeAuthCode(slot.code);

    if (isExpired(slot.expiresAt, Date.now())) {
      updateSlot(slot.flowId, { status: "error", result: "槽位已过期，请重新生成。" });
      return;
    }
    if (!isValidClaudeAuthCode(normalizedCode)) {
      updateSlot(slot.flowId, { status: "error", result: "回执格式不正确，请粘贴完整的 code#state 或回调 URL。" });
      return;
    }

    updateSlot(slot.flowId, { status: "submitting", code: normalizedCode, result: undefined });

    try {
      const parsedGroupIds = groupIds
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);

      const response = await fetch("/api/provisioning/claude/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowId: slot.flowId,
          code: normalizedCode,
          notes: notes.trim() || undefined,
          country: country.trim() || undefined,
          groupIds: parsedGroupIds,
          ...(selectedBackend ? { backend: selectedBackend } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { account?: AccountSummary; error?: string };

      if (redirectOnUnauthorized(response, redirectToLogin)) return;
      if (!response.ok || !payload.account) {
        updateSlot(slot.flowId, {
          status: "error",
          result: readApiError(response.status, payload.error, "Claude 账号接入失败。"),
        });
        return;
      }

      const label = payload.account.email || payload.account.name || "账号已入池";
      updateSlot(slot.flowId, { status: "done", result: `已入池：${label}` });
      setAccounts((current) => [payload.account as AccountSummary, ...current]);
    } catch {
      updateSlot(slot.flowId, { status: "error", result: "无法连接 Sub2API 接入服务。" });
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
        setError(readApiError(response.status, payload.error, "读取已入池账号失败。"));
        return;
      }

      setAccounts(payload.items);
      setMessage("账号列表已刷新。");
    } catch {
      setError("无法连接 Sub2API 接入服务。");
    } finally {
      setAccountsLoading(false);
    }
  }

  function clearFinished() {
    setSlots((current) => current.filter((slot) => slot.status !== "done" && !isExpired(slot.expiresAt, Date.now())));
    setMessage("已清理完成和过期的槽位。");
  }

  return (
    <div className="provisioning-workspace">
      {!configured ? (
        <div className="error-box">
          {!adminConfigured ? "超级管理员账号未配置。" : null}
          {!sub2ApiConfigured ? " Sub2API（Claude 授权代理）尚未配置，请在超管后台填写。" : null}
        </div>
      ) : null}

      <div className={`workspace-nav ${canViewAccountPool ? "" : "is-compact"}`} role="tablist" aria-label="账号接入视图">
        <button className={`workspace-tab ${activeTab === "wizard" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("wizard")}>
          授权向导
        </button>
        <button className={`workspace-tab ${activeTab === "pending" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("pending")}>
          待处理槽位 <span className="tab-count">{pendingCount}</span>
        </button>
        {canViewAccountPool ? (
          <button className={`workspace-tab ${activeTab === "accounts" ? "is-active" : ""}`} type="button" onClick={loadAccounts}>
            已入池账号
          </button>
        ) : null}
      </div>

      <div className="summary-strip" aria-label="账号统计">
        <div><span>存活</span><strong>{aliveCount}</strong></div>
        <div><span>失效</span><strong>{deadCount}</strong></div>
        <div><span>待授权</span><strong>{pendingCount}</strong></div>
      </div>

      {activeTab === "accounts" && canViewAccountPool ? (
        <AccountsView accounts={accounts} loading={accountsLoading} onRefresh={loadAccounts} />
      ) : activeTab === "pending" ? (
        <PendingView slots={activeSlots} now={now} onContinue={goToSubmitStep} onNew={() => { setActiveTab("wizard"); setStep(1); }} onCopy={copyToClipboard} />
      ) : (
        <WizardView
          step={step}
          slots={slots}
          activeSlots={activeSlots}
          batchCount={batchCount}
          notes={notes}
          groupIds={groupIds}
          loading={loading}
          configured={configured}
          message={message}
          error={error}
          now={now}
          onGenerate={generateSlots}
          onContinue={goToSubmitStep}
          onSubmitSlot={submitSlot}
          onBackToStart={() => setStep(1)}
          onClearFinished={clearFinished}
          onCopy={copyToClipboard}
          setBatchCount={setBatchCount}
          setNotes={setNotes}
          setGroupIds={setGroupIds}
          setSlotCode={(flowId, code) => updateSlot(flowId, { code, status: "pending", result: undefined })}
          proxies={proxies}
          selectedProxyId={selectedProxyId}
          setSelectedProxyId={(value) => { setSelectedProxyId(value); setProxyTest({ status: "idle", message: "" }); }}
          onTestProxy={testSelectedProxy}
          proxyTest={proxyTest}
          country={country}
          setCountry={setCountry}
          backends={backends}
          selectedBackend={selectedBackend}
          setSelectedBackend={setSelectedBackend}
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
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard may be blocked; the operator can still select the field manually.
  }
}

function WizardView({
  step,
  slots,
  activeSlots,
  batchCount,
  notes,
  groupIds,
  loading,
  configured,
  message,
  error,
  now,
  onGenerate,
  onContinue,
  onSubmitSlot,
  onBackToStart,
  onClearFinished,
  onCopy,
  setBatchCount,
  setNotes,
  setGroupIds,
  setSlotCode,
  proxies,
  selectedProxyId,
  setSelectedProxyId,
  onTestProxy,
  proxyTest,
  country,
  setCountry,
  backends,
  selectedBackend,
  setSelectedBackend,
}: {
  step: Step;
  slots: Slot[];
  activeSlots: Slot[];
  batchCount: number;
  notes: string;
  groupIds: string;
  loading: boolean;
  configured: boolean;
  message: string;
  error: string;
  now: number;
  onGenerate: () => void;
  onContinue: () => void;
  onSubmitSlot: (slot: Slot) => void;
  onBackToStart: () => void;
  onClearFinished: () => void;
  onCopy: (value: string) => void;
  setBatchCount: (value: number) => void;
  setNotes: (value: string) => void;
  setGroupIds: (value: string) => void;
  setSlotCode: (flowId: string, code: string) => void;
  proxies: ProxyOption[];
  selectedProxyId: string;
  setSelectedProxyId: (value: string) => void;
  onTestProxy: () => void;
  proxyTest: { status: "idle" | "testing" | "ok" | "error"; message: string };
  country: string;
  setCountry: (value: string) => void;
  backends: BackendOption[];
  selectedBackend: string;
  setSelectedBackend: (value: string) => void;
}) {
  const doneCount = slots.filter((slot) => slot.status === "done").length;

  return (
    <section className="wizard-panel" aria-labelledby="wizard-title">
      <div className="wizard-steps" aria-label="授权步骤">
        <StepItem number={1} label="生成槽位" current={step === 1} done={step > 1} />
        <StepItem number={2} label="官方授权" current={step === 2} done={step > 2} />
        <StepItem number={3} label="提交回执" current={step === 3} done={false} />
      </div>

      {step === 1 ? (
        <div className="step-body">
          <p className="label">步骤一 / 生成授权槽位</p>
          <h3 id="wizard-title">准备 Claude Max 账号</h3>
          <p className="step-lead">
            一次可生成 1–5 个授权槽位，每个槽位对应一个独立的 Claude 官方授权链接。备注与分组会应用到这一批账号。
          </p>
          <div className="advanced-fields">
            {backends.length > 1 ? (
              <>
                <label className="field-label" htmlFor="target-backend">目标平台</label>
                <select
                  id="target-backend"
                  className="text-input"
                  value={selectedBackend}
                  onChange={(event) => setSelectedBackend(event.target.value)}
                  disabled={loading}
                >
                  {backends.map((backend) => (
                    <option key={backend.kind} value={backend.kind}>
                      {backend.label}
                    </option>
                  ))}
                </select>
              </>
            ) : backends.length === 1 ? (
              <p className="step-lead">目标平台：{backends[0].label}</p>
            ) : null}
            <label className="field-label" htmlFor="batch-count">生成槽位数（1–{MAX_BATCH}）</label>
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
            <label className="field-label" htmlFor="batch-notes">批次备注（可选）</label>
            <input
              id="batch-notes"
              className="text-input"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="例如 Allen-0826，不要填写 token"
              maxLength={500}
              disabled={loading}
            />
            <label className="field-label" htmlFor="batch-groups">分组 ID（可选）</label>
            <input
              id="batch-groups"
              className="text-input"
              value={groupIds}
              onChange={(event) => setGroupIds(event.target.value)}
              placeholder="例如：1,2"
              disabled={loading}
            />
            <label className="field-label" htmlFor="batch-country">注册国家（本地标签，可选）</label>
            <input
              id="batch-country"
              className="text-input"
              list="country-options"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              placeholder="例如 US / JP / SG，仅作账号备注标签"
              maxLength={60}
              disabled={loading}
            />
            <datalist id="country-options">
              {["US", "JP", "SG", "HK", "GB", "DE", "FR", "CA", "AU", "KR", "TW"].map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
            {proxies.length ? (
              <>
                <label className="field-label" htmlFor="batch-proxy">出口代理（Sub2API 代理，可选）</label>
                <div className="flow-actions">
                  <select
                    id="batch-proxy"
                    className="text-input"
                    value={selectedProxyId}
                    onChange={(event) => setSelectedProxyId(event.target.value)}
                    disabled={loading}
                  >
                    <option value="">默认（由 Sub2API 分配）</option>
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
                    {proxyTest.status === "testing" ? "检测中..." : "检测代理"}
                  </button>
                </div>
                {proxyTest.message ? (
                  <p className={proxyTest.status === "error" ? "slot-result is-error" : "slot-result is-ok"}>
                    {proxyTest.message}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
          <button className="oauth-button" type="button" onClick={onGenerate} disabled={!configured || loading}>
            {loading ? "正在生成..." : `生成 ${batchCount} 个授权槽位`}
          </button>
          {activeSlots.length ? (
            <p className="step-lead">已有 {activeSlots.length} 个待处理槽位，可继续到第二步或追加生成。</p>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="step-body">
          <p className="label">步骤二 / 官方授权</p>
          <h3 id="wizard-title">在 Claude 完成官方授权</h3>
          <p className="step-lead">逐个打开授权链接登录并同意授权。成功页会显示完整的 code#state，复制后回到第三步提交。</p>
          {activeSlots.length ? (
            <div className="slot-cards">
              {activeSlots.map((slot, index) => (
                <SlotAuthCard key={slot.flowId} slot={slot} index={index} now={now} onCopy={onCopy} />
              ))}
            </div>
          ) : (
            <p className="empty-state">没有待授权的槽位，请回到第一步生成。</p>
          )}
          <div className="wizard-actions">
            <button className="oauth-button" type="button" onClick={onContinue} disabled={activeSlots.length === 0}>
              我已完成授权，去提交回执
            </button>
            <button className="secondary-button" type="button" onClick={onBackToStart} disabled={loading}>
              追加生成槽位
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="step-body">
          <p className="label">步骤三 / 提交回执</p>
          <h3 id="wizard-title">逐槽粘贴授权回执</h3>
          <p className="step-lead">支持 code#state、Claude 回调 URL，或分两行粘贴 code 和 state。每个槽位独立提交。</p>
          {activeSlots.length ? (
            <div className="slot-cards">
              {activeSlots.map((slot, index) => (
                <SlotSubmitCard
                  key={slot.flowId}
                  slot={slot}
                  index={index}
                  now={now}
                  onChange={(code) => setSlotCode(slot.flowId, code)}
                  onSubmit={() => onSubmitSlot(slot)}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">没有待提交的槽位。</p>
          )}
          <div className="wizard-actions">
            <button className="secondary-button" type="button" onClick={onBackToStart}>
              生成更多槽位
            </button>
            {doneCount ? (
              <button className="secondary-button" type="button" onClick={onClearFinished}>
                清理已完成（{doneCount}）
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {message && !error ? <div className="status-box" role="status">{message}</div> : null}
      {error ? <div className="error-box" role="alert">{error}</div> : null}
    </section>
  );
}

function StepItem({ number, label, current, done }: { number: number; label: string; current: boolean; done: boolean }) {
  return (
    <div className={`wizard-step ${current ? "is-current" : ""} ${done ? "is-done" : ""}`}>
      <span>{done ? "✓" : number}</span>
      <em>{label}</em>
    </div>
  );
}

function SlotBadge({ slot, now }: { slot: Slot; now: number }) {
  if (slot.status === "done") return <span className="flow-badge">已完成</span>;
  const expired = isExpired(slot.expiresAt, now);
  return <span className={`flow-badge ${expired ? "is-expired" : ""}`}>{expired ? "已过期" : `剩余 ${formatRemaining(slot.expiresAt, now)}`}</span>;
}

function SlotAuthCard({ slot, index, now, onCopy }: { slot: Slot; index: number; now: number; onCopy: (value: string) => void }) {
  const expired = isExpired(slot.expiresAt, now);
  return (
    <div className="flow-card">
      <div className="flow-card-head">
        <SlotBadge slot={slot} now={now} />
        <span className="flow-id">槽位 #{index + 1} · {slot.flowId.slice(0, 8)}</span>
      </div>
      <label className="field-label" htmlFor={`auth-url-${slot.flowId}`}>官方授权链接</label>
      <input
        id={`auth-url-${slot.flowId}`}
        className="text-input auth-url-input"
        value={slot.authUrl}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="flow-actions">
        <a className="oauth-button" href={slot.authUrl} target="_blank" rel="noreferrer" aria-disabled={expired}>
          打开官方授权页 ↗
        </a>
        <button className="secondary-button" type="button" onClick={() => onCopy(slot.authUrl)}>
          复制链接
        </button>
      </div>
    </div>
  );
}

function SlotSubmitCard({
  slot,
  index,
  now,
  onChange,
  onSubmit,
}: {
  slot: Slot;
  index: number;
  now: number;
  onChange: (code: string) => void;
  onSubmit: () => void;
}) {
  const submitting = slot.status === "submitting";
  return (
    <div className="flow-card">
      <div className="flow-card-head">
        <SlotBadge slot={slot} now={now} />
        <span className="flow-id">槽位 #{index + 1} · {slot.flowId.slice(0, 8)}</span>
      </div>
      <label className="field-label" htmlFor={`code-${slot.flowId}`}>Authorization Code</label>
      <textarea
        id={`code-${slot.flowId}`}
        className="text-input textarea-input"
        value={slot.code}
        onChange={(event) => onChange(event.target.value)}
        placeholder="粘贴完整的 code#state 或回调 URL"
        rows={3}
        disabled={submitting}
      />
      <div className="flow-actions">
        <button className="oauth-button" type="button" onClick={onSubmit} disabled={submitting || !slot.code.trim()}>
          {submitting ? "正在兑换并入池..." : "提交回执并创建账号"}
        </button>
      </div>
      {slot.result ? (
        <p className={slot.status === "error" ? "slot-result is-error" : "slot-result is-ok"}>{slot.result}</p>
      ) : null}
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
  return (
    <section className="list-panel">
      <div className="panel-heading-row">
        <div>
          <p className="label">待处理槽位</p>
          <h3>授权槽位</h3>
        </div>
        <button className="secondary-button" type="button" onClick={onNew}>
          新建槽位
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
              去提交回执
            </button>
          </div>
        </>
      ) : (
        <p className="empty-state">当前没有待处理槽位。</p>
      )}
    </section>
  );
}

function AccountsView({ accounts, loading, onRefresh }: { accounts: AccountSummary[]; loading: boolean; onRefresh: () => void }) {
  return (
    <section className="list-panel">
      <div className="panel-heading-row">
        <div>
          <p className="label">账号池</p>
          <h3>已入池账号</h3>
        </div>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? "刷新中..." : "刷新列表"}
        </button>
      </div>
      {accounts.length ? (
        <div className="account-list">
          {accounts.map((account) => {
            const alive = account.status === "active" && account.schedulable !== false && !account.deadCause;
            return (
              <article className="account-row" key={`${account.id}-${account.createdAt || account.name}`}>
                <div className="account-main">
                  <strong>{account.email || account.displayName || account.name || "未命名账号"}</strong>
                  <span>
                    {account.displayName || account.name || "Claude Code Max"}
                    {account.subscription ? ` · ${account.subscription}` : ""}
                  </span>
                </div>
                <div className="account-meta">
                  <span className={`account-status ${alive ? "is-alive" : "is-dead"}`}>
                    {alive ? "存活" : account.deadCause || account.status || "失效"}
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
        <p className="empty-state">暂无已入池账号。完成一次授权后，账号会显示在这里。</p>
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

function readApiError(status: number, error: string | undefined, fallback: string) {
  if (status === 401) return "管理员会话已失效，请重新登录。";
  if (status === 429) return "待处理槽位过多，请先完成或清理已有槽位。";
  if (status === 502 && error === "sub2api_auth_failed") {
    return "Sub2API 管理令牌无效或权限不足，请更新 SUB2API_ADMIN_TOKEN。";
  }
  if (status === 403) {
    return error === "user_provisioning_disabled"
      ? "超级管理员已暂停普通用户上号，请联系管理员。"
      : "当前角色或系统开关不允许执行此操作。";
  }
  if (status === 410) return "授权槽位已过期，请重新生成。";
  if (status === 503 && error === "provisioning_disabled") return "超级管理员已暂停 Claude 上号流程。";
  if (status === 503 && error === "backend_not_configured") return "目标后端尚未配置，请检查对应环境变量。";
  if (status === 503) return "服务尚未配置完成，请检查 .env.local。";
  return error || fallback;
}

function redirectOnUnauthorized(response: Response, redirectToLogin: () => void) {
  if (response.status !== 401) return false;
  redirectToLogin();
  return true;
}
