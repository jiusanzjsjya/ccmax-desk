"use client";

import { useState } from "react";

type ProvisioningPanelProps = {
  adminConfigured: boolean;
  sub2ApiConfigured: boolean;
};

type AccountSummary = {
  id: number | string | null;
  name: string | null;
  platform: string;
  type: string;
  status: string;
  schedulable: boolean | null;
  errorMessage: string | null;
};

export default function ProvisioningPanel({ adminConfigured, sub2ApiConfigured }: ProvisioningPanelProps) {
  const [flowId, setFlowId] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [notes, setNotes] = useState("");
  const [groupIds, setGroupIds] = useState("");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const configured = adminConfigured && sub2ApiConfigured;

  async function startAuthorization() {
    setError("");
    setMessage("");
    setAccount(null);
    setLoading(true);

    try {
      const response = await fetch("/api/provisioning/claude/start", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        flowId?: string;
        authUrl?: string;
        expiresAt?: string;
        error?: string;
      };

      if (!response.ok || !payload.flowId || !payload.authUrl) {
        setError(payload.error || "生成授权地址失败。");
        return;
      }

      setFlowId(payload.flowId);
      setAuthUrl(payload.authUrl);
      setAuthCode("");
      setMessage(`授权流程已创建，将于 ${payload.expiresAt ? new Date(payload.expiresAt).toLocaleString() : "稍后"} 过期。`);
    } catch {
      setError("无法连接 Sub2API 接入服务。");
    } finally {
      setLoading(false);
    }
  }

  async function completeAuthorization() {
    setError("");
    setMessage("");
    setAccount(null);
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
          flowId,
          code: authCode,
          name: accountName || undefined,
          notes: notes || undefined,
          groupIds: parsedGroupIds,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        account?: AccountSummary;
        error?: string;
      };

      if (!response.ok || !payload.account) {
        setError(payload.error || "Claude 账号接入失败。");
        return;
      }

      setAccount(payload.account);
      setFlowId("");
      setAuthUrl("");
      setAuthCode("");
      setMessage("账号已创建到 Sub2API 账号池，页面没有接收 token 原文。");
    } catch {
      setError("无法连接 Sub2API 接入服务。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack-form">
      {!configured ? (
        <div className="error-box">
          {!adminConfigured ? "ADMIN_ACCESS_KEY 未配置。" : null}
          {!sub2ApiConfigured ? " SUB2API_ADMIN_TOKEN 未配置。" : null}
        </div>
      ) : null}

      <div className="status-box">
        <span className="status-label">流程说明</span>
        <br />
        先生成 Sub2API 授权 URL，在 Claude 页面完成授权，再把授权码提交回来。服务端会兑换并立即创建账号。
      </div>

      <button className="oauth-button" type="button" onClick={startAuthorization} disabled={!configured || loading}>
        {loading ? "处理中..." : flowId ? "重新生成授权流程" : "生成 Claude 授权 URL"}
      </button>

      {authUrl ? (
        <div className="flow-card">
          <p className="field-label">第一步：打开授权地址</p>
          <a className="auth-url" href={authUrl} target="_blank" rel="noreferrer">
            在新标签页打开 Claude 授权页面 ↗
          </a>
          <p className="microcopy">请使用账号所有者的 Claude 账号完成授权。授权码不要发送给其他人。</p>
        </div>
      ) : null}

      {flowId ? (
        <div className="flow-card">
          <p className="field-label">第二步：提交授权码并创建账号</p>
          <label className="field-label" htmlFor="claude-auth-code">Authorization Code</label>
          <textarea
            id="claude-auth-code"
            className="text-input textarea-input"
            value={authCode}
            onChange={(event) => setAuthCode(event.target.value)}
            placeholder="粘贴 Claude 页面显示的授权码"
            rows={3}
            disabled={loading}
          />
          <label className="field-label" htmlFor="claude-account-name">Sub2API 账号名称（可选）</label>
          <input
            id="claude-account-name"
            className="text-input"
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder="默认使用邮箱或账号 UUID"
            maxLength={100}
            disabled={loading}
          />
          <label className="field-label" htmlFor="claude-group-ids">分组 ID（可选，逗号分隔）</label>
          <input
            id="claude-group-ids"
            className="text-input"
            value={groupIds}
            onChange={(event) => setGroupIds(event.target.value)}
            placeholder="例如：1,2"
            disabled={loading}
          />
          <label className="field-label" htmlFor="claude-account-notes">备注（可选）</label>
          <input
            id="claude-account-notes"
            className="text-input"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="仅保存业务备注，不要填写 token"
            maxLength={500}
            disabled={loading}
          />
          <button className="oauth-button" type="button" onClick={completeAuthorization} disabled={loading || !authCode.trim()}>
            {loading ? "正在兑换并创建..." : "完成授权并创建 Sub2API 账号"}
          </button>
        </div>
      ) : null}

      {message ? <div className="status-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {account ? (
        <div className="success-box">
          <p className="field-label">接入结果</p>
          <dl className="result-grid">
            <div><dt>账号 ID</dt><dd>{account.id ?? "未返回"}</dd></div>
            <div><dt>账号名称</dt><dd>{account.name ?? "未返回"}</dd></div>
            <div><dt>平台 / 类型</dt><dd>{account.platform} / {account.type}</dd></div>
            <div><dt>状态</dt><dd>{account.status}</dd></div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
