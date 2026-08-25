"use client";

import { useEffect, useMemo, useState } from "react";

import { isValidClaudeAuthCode, normalizeClaudeAuthCode } from "@/lib/claude-auth-code";

type ProvisioningPanelProps = {
  adminConfigured: boolean;
  sub2ApiConfigured: boolean;
};

type Step = 1 | 2 | 3;
type Tab = "wizard" | "pending" | "accounts";

type ProvisioningFlow = {
  flowId: string;
  authUrl: string;
  expiresAt: string;
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
};

const flowStorageKey = "ccmax.active-claude-flow";

export default function ProvisioningPanel({ adminConfigured, sub2ApiConfigured }: ProvisioningPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("wizard");
  const [step, setStep] = useState<Step>(1);
  const [flow, setFlow] = useState<ProvisioningFlow | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [notes, setNotes] = useState("");
  const [groupIds, setGroupIds] = useState("");
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const configured = adminConfigured && sub2ApiConfigured;
  const flowExpired = Boolean(flow && new Date(flow.expiresAt).getTime() <= now);
  const aliveCount = useMemo(
    () => accounts.filter((account) => account.status === "active" && account.schedulable !== false).length,
    [accounts],
  );
  const deadCount = accounts.length - aliveCount;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const saved = sessionStorage.getItem(flowStorageKey);
      if (!saved) return;

      try {
        const parsed = JSON.parse(saved) as ProvisioningFlow;
        if (parsed.flowId && parsed.authUrl && new Date(parsed.expiresAt).getTime() > Date.now()) {
          setFlow(parsed);
          setStep(2);
        } else {
          sessionStorage.removeItem(flowStorageKey);
        }
      } catch {
        sessionStorage.removeItem(flowStorageKey);
      }

    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  async function startAuthorization() {
    setActiveTab("wizard");
    setStep(1);
    setError("");
    setMessage("");
    setAuthCode("");
    setLoading(true);

    try {
      const response = await fetch("/api/provisioning/claude/start", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        flowId?: string;
        authUrl?: string;
        expiresAt?: string;
        error?: string;
      };

      if (!response.ok || !payload.flowId || !payload.authUrl || !payload.expiresAt) {
        setError(readApiError(response.status, payload.error, "生成授权槽位失败。"));
        return;
      }

      const nextFlow = {
        flowId: payload.flowId,
        authUrl: payload.authUrl,
        expiresAt: payload.expiresAt,
      };
      setFlow(nextFlow);
      sessionStorage.setItem(flowStorageKey, JSON.stringify(nextFlow));
      setStep(2);
      setMessage("授权槽位已创建。请在新标签页完成 Claude 官方登录，再回到这里提交回执。");
    } catch {
      setError("无法连接 Sub2API 接入服务。");
    } finally {
      setLoading(false);
    }
  }

  function goToSubmitStep() {
    if (!flow) {
      setError("当前没有待处理的授权槽位，请先生成槽位。");
      setActiveTab("wizard");
      setStep(1);
      return;
    }

    setActiveTab("wizard");
    setStep(3);
    setError("");
    setMessage("");
  }

  async function completeAuthorization() {
    setError("");
    setMessage("");

    const normalizedCode = normalizeClaudeAuthCode(authCode);
    if (!flow || flowExpired) {
      setError("授权槽位已过期，请回到第一步重新生成。");
      return;
    }
    if (!isValidClaudeAuthCode(normalizedCode)) {
      setError("回执格式不正确，请粘贴完整的 code#state 或 Claude 回调 URL。");
      return;
    }

    setAuthCode(normalizedCode);
    setLoading(true);

    try {
      const parsedGroupIds = groupIds
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      const response = await fetch("/api/provisioning/claude/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowId: flow.flowId,
          code: normalizedCode,
          name: accountName.trim() || undefined,
          notes: notes.trim() || undefined,
          groupIds: parsedGroupIds,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        account?: AccountSummary;
        error?: string;
      };

      if (!response.ok || !payload.account) {
        setError(readApiError(response.status, payload.error, "Claude 账号接入失败。"));
        return;
      }

      setFlow(null);
      sessionStorage.removeItem(flowStorageKey);
      setStep(3);
      setMessage("授权成功，账号已写入 Sub2API 账号池。浏览器没有接收 token 原文。");
      setAccounts((current) => [payload.account as AccountSummary, ...current]);
    } catch {
      setError("无法连接 Sub2API 接入服务。");
    } finally {
      setLoading(false);
    }
  }

  async function loadAccounts() {
    setActiveTab("accounts");
    setError("");
    setAccountsLoading(true);

    try {
      const response = await fetch("/api/provisioning/claude/accounts", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        items?: AccountSummary[];
        error?: string;
      };

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

  async function copyAuthUrl() {
    if (!flow?.authUrl) return;

    try {
      await navigator.clipboard.writeText(flow.authUrl);
      setMessage("授权链接已复制。");
    } catch {
      setError("复制失败，请直接点击链接打开授权页面。");
    }
  }

  function resetToStart() {
    setActiveTab("wizard");
    setStep(1);
    setFlow(null);
    setAuthCode("");
    setAccountName("");
    setNotes("");
    setGroupIds("");
    setMessage("");
    setError("");
    sessionStorage.removeItem(flowStorageKey);
  }

  return (
    <div className="provisioning-workspace">
      {!configured ? (
        <div className="error-box">
          {!adminConfigured ? "ADMIN_ACCESS_KEY 未配置。" : null}
          {!sub2ApiConfigured ? " SUB2API_ADMIN_TOKEN 未配置。" : null}
        </div>
      ) : null}

      <div className="workspace-nav" role="tablist" aria-label="账号接入视图">
        <button className={`workspace-tab ${activeTab === "wizard" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("wizard")}>
          授权向导
        </button>
        <button className={`workspace-tab ${activeTab === "pending" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("pending")}>
          待处理流程 <span className="tab-count">{flow ? 1 : 0}</span>
        </button>
        <button className={`workspace-tab ${activeTab === "accounts" ? "is-active" : ""}`} type="button" onClick={loadAccounts}>
          已入池账号
        </button>
      </div>

      <div className="summary-strip" aria-label="账号统计">
        <div><span>存活</span><strong>{aliveCount}</strong></div>
        <div><span>失效</span><strong>{deadCount}</strong></div>
        <div><span>待授权</span><strong>{flow ? 1 : 0}</strong></div>
      </div>

      {activeTab === "accounts" ? (
        <AccountsView accounts={accounts} loading={accountsLoading} onRefresh={loadAccounts} />
      ) : activeTab === "pending" ? (
        <PendingView flow={flow} expired={flowExpired} onContinue={goToSubmitStep} onOpenWizard={resetToStart} />
      ) : (
        <WizardView
          step={step}
          flow={flow}
          expired={flowExpired}
          authCode={authCode}
          accountName={accountName}
          notes={notes}
          groupIds={groupIds}
          loading={loading}
          configured={configured}
          message={message}
          error={error}
          now={now}
          onStart={startAuthorization}
          onContinue={goToSubmitStep}
          onComplete={completeAuthorization}
          onReset={resetToStart}
          onCopyUrl={copyAuthUrl}
          setAuthCode={setAuthCode}
          setAccountName={setAccountName}
          setNotes={setNotes}
          setGroupIds={setGroupIds}
        />
      )}

      {activeTab === "accounts" && (message || error) ? (
        <div className={error ? "error-box" : "status-box"} role={error ? "alert" : "status"}>
          {error || message}
        </div>
      ) : null}
    </div>
  );
}

function WizardView({
  step,
  flow,
  expired,
  authCode,
  accountName,
  notes,
  groupIds,
  loading,
  configured,
  message,
  error,
  now,
  onStart,
  onContinue,
  onComplete,
  onReset,
  onCopyUrl,
  setAuthCode,
  setAccountName,
  setNotes,
  setGroupIds,
}: {
  step: Step;
  flow: ProvisioningFlow | null;
  expired: boolean;
  authCode: string;
  accountName: string;
  notes: string;
  groupIds: string;
  loading: boolean;
  configured: boolean;
  message: string;
  error: string;
  now: number;
  onStart: () => void;
  onContinue: () => void;
  onComplete: () => void;
  onReset: () => void;
  onCopyUrl: () => void;
  setAuthCode: (value: string) => void;
  setAccountName: (value: string) => void;
  setNotes: (value: string) => void;
  setGroupIds: (value: string) => void;
}) {
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
          <h3 id="wizard-title">准备一个 Claude Max 账号</h3>
          <p className="step-lead">
            当前适配 Sub2API 的 Claude OAuth 管理接口。这里不再重复填写渠道、国家或子渠道信息，账号名称和备注可在最后一步补充。
          </p>
          <div className="status-box compact-status">
            <strong>流程只有三步</strong>
            <span>生成授权链接 → 完成官方登录 → 粘贴 code#state。</span>
          </div>
          <button className="oauth-button" type="button" onClick={onStart} disabled={!configured || loading}>
            {loading ? "正在生成..." : "生成授权槽位"}
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="step-body">
          <p className="label">步骤二 / 官方授权</p>
          <h3 id="wizard-title">在 Claude 完成官方授权</h3>
          <p className="step-lead">打开授权页登录并同意授权。成功页会显示完整的 code#state，请复制后回到本页面。</p>
          {flow ? <FlowCard flow={flow} expired={expired} now={now} onCopy={onCopyUrl} /> : null}
          <div className="wizard-actions">
            <button className="oauth-button" type="button" onClick={onContinue} disabled={!flow || expired}>
              我已完成授权，去粘贴回执
            </button>
            <button className="secondary-button" type="button" onClick={onReset} disabled={loading}>
              重新生成槽位
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && flow ? (
        <div className="step-body">
          <p className="label">步骤三 / 提交回执</p>
          <h3 id="wizard-title">粘贴完整授权回执</h3>
          <p className="step-lead">支持直接粘贴 code#state、Claude 回调 URL，或分两行粘贴 code 和 state。</p>
          <label className="field-label" htmlFor="claude-auth-code">Authorization Code</label>
          <textarea
            id="claude-auth-code"
            className="text-input textarea-input"
            value={authCode}
            onChange={(event) => setAuthCode(event.target.value)}
            placeholder="粘贴完整的 code#state 或回调 URL"
            rows={4}
            disabled={loading}
          />
          <details className="advanced-panel">
            <summary>账号池信息（可选）</summary>
            <div className="advanced-fields">
              <label className="field-label" htmlFor="claude-account-name">账号名称</label>
              <input
                id="claude-account-name"
                className="text-input"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="留空则使用邮箱或账号 UUID"
                maxLength={100}
                disabled={loading}
              />
              <label className="field-label" htmlFor="claude-account-notes">备注</label>
              <input
                id="claude-account-notes"
                className="text-input"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="不要填写 token"
                maxLength={500}
                disabled={loading}
              />
              <label className="field-label" htmlFor="claude-group-ids">分组 ID</label>
              <input
                id="claude-group-ids"
                className="text-input"
                value={groupIds}
                onChange={(event) => setGroupIds(event.target.value)}
                placeholder="例如：1,2"
                disabled={loading}
              />
            </div>
          </details>
          <div className="wizard-actions">
            <button className="oauth-button" type="button" onClick={onComplete} disabled={loading || !authCode.trim()}>
              {loading ? "正在兑换并入池..." : "提交回执并创建账号"}
            </button>
            <button className="secondary-button" type="button" onClick={onReset} disabled={loading}>
              重新开始
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && !flow && message ? (
        <div className="success-box">
          <p className="field-label">接入结果</p>
          <p className="success-copy">{message}</p>
          <button className="secondary-button" type="button" onClick={onReset}>
            再授权一个账号
          </button>
        </div>
      ) : null}

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

function FlowCard({ flow, expired, now, onCopy }: { flow: ProvisioningFlow; expired: boolean; now: number; onCopy: () => void }) {
  const remainingSeconds = Math.max(0, Math.floor((new Date(flow.expiresAt).getTime() - now) / 1000));
  const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, "0");
  const seconds = String(remainingSeconds % 60).padStart(2, "0");

  return (
    <div className="flow-card">
      <div className="flow-card-head">
        <span className={`flow-badge ${expired ? "is-expired" : ""}`}>
          {expired ? "已过期" : `剩余 ${minutes}:${seconds}`}
        </span>
        <span className="flow-id">槽位 {flow.flowId.slice(0, 8)}</span>
      </div>
      <label className="field-label" htmlFor="claude-auth-url">官方授权链接</label>
      <input id="claude-auth-url" className="text-input auth-url-input" value={flow.authUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
      <div className="flow-actions">
        <a className="oauth-button" href={flow.authUrl} target="_blank" rel="noreferrer">
          打开官方授权页 ↗
        </a>
        <button className="secondary-button" type="button" onClick={onCopy}>
          复制链接
        </button>
      </div>
    </div>
  );
}

function PendingView({
  flow,
  expired,
  onContinue,
  onOpenWizard,
}: {
  flow: ProvisioningFlow | null;
  expired: boolean;
  onContinue: () => void;
  onOpenWizard: () => void;
}) {
  return (
    <section className="list-panel">
      <div className="panel-heading-row">
        <div>
          <p className="label">待处理流程</p>
          <h3>授权槽位</h3>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenWizard}>
          新建槽位
        </button>
      </div>
      {flow ? (
        <div className="pending-row">
          <div>
            <strong>{expired ? "槽位已过期" : "等待提交授权回执"}</strong>
            <span>{expired ? "请回到授权向导重新生成。" : "完成官方授权后，继续提交 code#state。"}</span>
          </div>
          <button className="oauth-button compact-button" type="button" onClick={onContinue} disabled={expired}>
            去提交回执
          </button>
        </div>
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
          {accounts.map((account) => (
            <article className="account-row" key={`${account.id}-${account.createdAt || account.name}`}>
              <div className="account-main">
                <strong>{account.email || account.name || "未命名账号"}</strong>
                <span>{account.name || "Claude Code Max"}</span>
              </div>
              <div className="account-meta">
                <span className={`account-status ${account.status === "active" ? "is-alive" : "is-dead"}`}>
                  {account.status === "active" ? "存活" : account.status || "未知"}
                </span>
                <span>{account.platform} / {account.type}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">暂无已入池账号。完成一次授权后，账号会显示在这里。</p>
      )}
    </section>
  );
}

function readApiError(status: number, error: string | undefined, fallback: string) {
  if (status === 401) return "管理员会话已失效，请重新登录。";
  if (status === 410) return "授权槽位已过期，请重新生成。";
  if (status === 503) return "服务尚未配置完成，请检查 .env.local。";
  return error || fallback;
}
