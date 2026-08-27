"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
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
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(
          payload.error === "admin_not_configured"
            ? "账号尚未配置，请在 .env.local 设置 SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD。"
            : "登录名或密码不正确，或账号已停用。",
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
      <label className="field-label" htmlFor="account-username">登录名</label>
      <input
        id="account-username"
        className="text-input"
        type="text"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="登录名"
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
        placeholder="账号密码"
        autoComplete="current-password"
        disabled={loading}
      />

      <button className="oauth-button" type="submit" disabled={loading || !username || !password}>
        {loading ? "正在验证..." : "登录"}
      </button>
      {error ? <div className="error-box">{error}</div> : null}
      {!configured ? (
        <p className="microcopy">账号尚未配置：在 .env.local 设置 SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD。</p>
      ) : (
        <p className="microcopy">账号密码只在本项目服务端校验，不会发送给 Sub2API。</p>
      )}
    </form>
  );
}
