"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"root" | "account">("root");
  const [accessKey, setAccessKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "root" ? { accessKey } : { username, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(
          payload.error === "admin_not_configured"
            ? "超级管理员密钥尚未配置。"
            : mode === "account"
              ? "登录名或密码不正确，或账号已停用。"
              : "超级管理员密钥不正确。",
        );
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("无法连接登录服务，请检查本地服务状态。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="stack-form" onSubmit={handleSubmit}>
      <div className="login-mode" role="tablist" aria-label="登录方式">
        <button className={mode === "root" ? "is-active" : ""} type="button" onClick={() => setMode("root")}>
          超级管理员密钥
        </button>
        <button className={mode === "account" ? "is-active" : ""} type="button" onClick={() => setMode("account")}>
          账号登录
        </button>
      </div>

      {mode === "root" ? (
        <>
          <label className="field-label" htmlFor="admin-access-key">超级管理员访问密钥</label>
          <input
            id="admin-access-key"
            className="text-input"
            type="password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            placeholder="输入 ADMIN_ACCESS_KEY"
            autoComplete="current-password"
            disabled={!configured || loading}
          />
        </>
      ) : (
        <>
          <label className="field-label" htmlFor="account-username">登录名</label>
          <input
            id="account-username"
            className="text-input"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="例如：ops-user"
            autoComplete="username"
            disabled={loading}
          />
          <label className="field-label" htmlFor="account-password">密码</label>
          <input
            id="account-password"
            className="text-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 10 位"
            autoComplete="current-password"
            disabled={loading}
          />
        </>
      )}

      <button className="oauth-button" type="submit" disabled={loading || (mode === "root" ? !configured || !accessKey : !username || !password)}>
        {loading ? "正在验证..." : "进入管理员工作台"}
      </button>
      {error ? <div className="error-box">{error}</div> : null}
      <p className="microcopy">
        {mode === "root" ? "超级管理员密钥只在本项目服务端校验。" : "账号密码只在本项目服务端校验，不会发送给 Sub2API。"}
      </p>
    </form>
  );
}
