"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n, type I18nValue } from "@/lib/i18n/context";

type TFn = I18nValue["t"];

type KeyProvisioningPanelProps = {
  sub2ApiConfigured: boolean;
};

type UploadResult = { key: string; name?: string; ok: boolean; dead?: boolean; error?: string };

const MAX_KEYS = 10;
// Mirror of the server-side OpenAI key shape, for instant client-side feedback.
const OPENAI_KEY_RE = /^sk-[A-Za-z0-9_-]{20,}$/;

/**
 * 授权上key — batch-upload OpenAI API keys into Sub2API. Deliberately simple:
 * paste keys (one per line, # comments) and submit. OpenAI only; the upstream
 * base_url is fixed to OpenAI's official API and every account is auto-named
 * `<你的账号名>-<日期>-<NN>` (the day's sequence continues) server-side.
 */
export default function KeyProvisioningPanel({ sub2ApiConfigured }: KeyProvisioningPanelProps) {
  const { t } = useI18n();
  const router = useRouter();

  const [keysText, setKeysText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<UploadResult[] | null>(null);

  function parseKeys(raw: string): string[] {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  }

  async function submit() {
    const keys = parseKeys(keysText);
    if (!keys.length) {
      setError(t("请至少粘贴一条 Key。"));
      setResults(null);
      return;
    }
    if (keys.length > MAX_KEYS) {
      setError(t("单次最多提交 {n} 条 Key。", { n: MAX_KEYS }));
      setResults(null);
      return;
    }
    const malformed = keys.filter((key) => !OPENAI_KEY_RE.test(key)).length;
    if (malformed === keys.length) {
      setError(t("没有格式正确的 Key（应为 sk- 开头的 OpenAI Key）。"));
      setResults(null);
      return;
    }

    setBusy(true);
    setError("");
    setResults(null);
    try {
      const response = await fetch("/api/provisioning/openai/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        okCount?: number;
        results?: UploadResult[];
      };
      if (!response.ok || !payload.results) {
        setError(readApiError(t, response.status, payload.error, t("上传失败，请稍后再试。")));
        return;
      }
      setResults(payload.results);
      // Clear the box only when every key succeeded, so failures can be retried.
      if (!payload.results.some((item) => !item.ok)) {
        setKeysText("");
      }
    } catch {
      setError(t("无法连接 Sub2API 接入服务。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="provisioning-workspace">
      {!sub2ApiConfigured ? (
        <div className="error-box">{t(" Sub2API（Claude 授权代理）尚未配置，请在超管后台填写。")}</div>
      ) : null}

      <section className="list-panel">
        <div className="panel-heading-row">
          <div>
            <p className="label">{t("OpenAI · API key")}</p>
            <h3>{t("提交 Key")}</h3>
          </div>
        </div>

        <p className="management-help">
          {t("每行一条 Key；以 # 开头的行视为注释。单次最多提交 {n} 条 Key。", { n: MAX_KEYS })}
        </p>
        <p className="management-help">
          {t("仅上传 OpenAI Key；Base URL 固定为官方地址。账号自动命名为 你的账号名-日期-序号（当天顺延）。")}
        </p>

        <div className="custom-proxy">
          <label className="field-label" htmlFor="openai-keys">{t("Keys")}</label>
          <textarea
            id="openai-keys"
            className="text-input key-textarea"
            value={keysText}
            onChange={(event) => setKeysText(event.target.value)}
            placeholder={"sk-...\n# 以 # 开头为注释\nsk-..."}
            rows={10}
            spellCheck={false}
            disabled={busy}
            aria-label={t("Keys")}
          />

          <div className="flow-actions">
            <button className="oauth-button" type="button" onClick={submit} disabled={busy || !sub2ApiConfigured}>
              {busy ? t("上传中...") : t("提交并上传")}
            </button>
          </div>

          {error ? <p className="slot-result is-error">{error}</p> : null}
          {results ? (
            <div className="key-results">
              <p className="slot-result is-ok">
                {t("成功 {ok} / {total} 条，其中疑似死 Key {dead} 条。", {
                  ok: results.filter((r) => r.ok).length,
                  total: results.length,
                  dead: results.filter((r) => r.dead).length,
                })}
              </p>
              {results.map((item, index) => (
                <p
                  key={`${item.key}-${index}`}
                  className={!item.ok ? "proxy-check is-error" : item.dead ? "proxy-check is-warn" : "proxy-check is-ok"}
                >
                  {!item.ok ? "✕" : item.dead ? "⚠" : "✓"} {item.name ? `${item.name} · ` : ""}{item.key}
                  {item.error ? ` · ${item.error}` : ""}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function readApiError(t: TFn, status: number, error: string | undefined, fallback: string) {
  if (status === 401) return t("管理员会话已失效，请重新登录。");
  if (status === 403) {
    if (error === "module_forbidden") return t("未获授权上key权限，请联系超级管理员开通。");
    if (error === "user_provisioning_disabled") return t("超级管理员已暂停普通用户上号，请联系管理员。");
    return t("当前角色或系统开关不允许执行此操作。");
  }
  if (status === 502 && error === "sub2api_auth_failed") {
    return t("Sub2API 管理令牌无效或权限不足，请更新 SUB2API_ADMIN_TOKEN。");
  }
  if (status === 503) return t("服务尚未配置完成，请检查 .env.local。");
  return error || fallback;
}
