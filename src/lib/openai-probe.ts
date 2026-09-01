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
const INVALID_KEY_RE = /invalid[_ ]?api[_ ]?key|incorrect api key|invalid_authentication/i;

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

  if (response.ok) return { conclusive: true, alive: true, status: response.status, detail: "" };
  if (response.status === 429) return { conclusive: true, alive: true, status: 429, detail: "" }; // valid, just limited
  if (response.status === 401) return { conclusive: true, alive: false, status: 401, detail };
  // 400/403/404 only count as dead when the body explicitly says the key is invalid.
  if (INVALID_KEY_RE.test(text)) return { conclusive: true, alive: false, status: response.status, detail };
  return { conclusive: false, alive: true, status: response.status, detail }; // ambiguous → inconclusive
}

function extractMessage(text: string): string {
  const match = text.match(/"message"\s*:\s*"([^"]{3,200})"/);
  return match ? match[1] : "";
}
