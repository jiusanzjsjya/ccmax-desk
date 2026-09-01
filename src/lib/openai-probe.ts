/**
 * Pre-create liveness probe for an OpenAI API key: CCMax sends a minimal "hi"
 * chat completion straight to the key's own base_url and reads the result. A
 * dead/expired key comes back 401 (invalid_api_key); a live key returns 2xx (or
 * 429 when merely rate-limited). This is the only check that truly exercises the
 * key BEFORE any account is created — Sub2API's model "preview" uses a static
 * catalog and never authenticates the key.
 *
 * Conservative by design: only a clear auth failure (401, or an invalid-key
 * marker) is conclusive-dead. Region/model/quota errors and any transport
 * failure (e.g. no direct egress to OpenAI from this host) are INCONCLUSIVE, so
 * a good key is never falsely rejected — the caller falls back to the
 * post-create account test in that case.
 */
export type KeyProbe = { conclusive: boolean; alive: boolean; status?: number; detail: string };

const PROBE_MODEL = "gpt-4o-mini";
const PROBE_TIMEOUT_MS = 12_000;
/**
 * A conclusively-dead key: bad auth OR no usable balance/quota OR a
 * deactivated account. `insufficient_quota` / "no credits remaining" comes back
 * as HTTP 429 but the key is useless, so it must count as dead — NOT a transient
 * rate limit (`rate_limit_exceeded`, which has none of these markers).
 */
const DEAD_KEY_RE =
  /invalid[_ ]?api[_ ]?key|incorrect api key|invalid_authentication|unauthoriz|insufficient_quota|no credits|exceeded your current quota|billing|account.*(deactivat|disabl|suspend)/i;

export async function probeOpenAIKey(apiKey: string, baseUrl?: string): Promise<KeyProbe> {
  const base = (baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  // base may or may not already carry a version segment (…/v1). Only add /v1 when absent.
  const url = /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: PROBE_MODEL, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { conclusive: false, alive: true, detail: "" }; // unreachable / timeout → inconclusive
  }

  const text = await response.text().catch(() => "");
  const detail = extractMessage(text);

  // Dead first (covers no-credits/insufficient_quota, which is a 429 but useless).
  if (DEAD_KEY_RE.test(text)) return { conclusive: true, alive: false, status: response.status, detail };
  if (response.ok) return { conclusive: true, alive: true, status: response.status, detail: "" };
  if (response.status === 401) return { conclusive: true, alive: false, status: 401, detail };
  if (response.status === 429) return { conclusive: true, alive: true, status: 429, detail: "" }; // rate-limited but valid
  return { conclusive: false, alive: true, status: response.status, detail }; // ambiguous → inconclusive
}

function extractMessage(text: string): string {
  const match = text.match(/"message"\s*:\s*"([^"]{3,200})"/);
  return match ? match[1] : "";
}
