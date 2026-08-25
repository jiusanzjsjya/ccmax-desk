"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [accessKey, setAccessKey] = useState("");
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
        body: JSON.stringify({ accessKey }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error === "admin_not_configured" ? "管理员访问密钥尚未配置。" : "管理员访问密钥不正确。\n");
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
      <label className="field-label" htmlFor="admin-access-key">
        管理员访问密钥
      </label>
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
      <button className="oauth-button" type="submit" disabled={!configured || loading || !accessKey}>
        {loading ? "正在验证..." : "进入管理员工作台"}
      </button>
      {error ? <div className="error-box">{error}</div> : null}
      <p className="microcopy">访问密钥只提交到本项目服务端，不会转发给浏览器之外的服务。</p>
    </form>
  );
}
