/**
 * Accept the formats shown by Claude's OAuth success page and turn them into
 * the code#state value expected by Sub2API.
 */
export function normalizeClaudeAuthCode(raw: string) {
  let value = String(raw || "")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\r/g, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!value) {
    return "";
  }

  const fromUrl = parseCallback(value);
  if (fromUrl) {
    return fromUrl;
  }

  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && !lines[0].includes("#")) {
    const code = lines[0].replace(/^code[=:\s]+/i, "");
    const state = lines[1].replace(/^state[=:\s]+/i, "");
    if (code && state) {
      return `${code}#${state}`;
    }
  }

  value = value.replace(/\s*#\s*/g, "#").replace(/\s+/g, "");
  const match = value.match(/([A-Za-z0-9_.=+\/-]{12,}#[A-Za-z0-9_.=+\/-]{8,})/);
  return match?.[1] || value;
}

export function isValidClaudeAuthCode(value: string) {
  const normalized = normalizeClaudeAuthCode(value);
  if (!normalized.includes("#")) {
    return false;
  }

  const [code, state] = normalized.split("#", 2);
  return Boolean(
    code &&
      state &&
      code.length >= 12 &&
      state.length >= 8 &&
      !/^(true|false)$/i.test(code) &&
      /^[A-Za-z0-9_.=+\/-]+$/.test(code) &&
      /^[A-Za-z0-9_.=+\/-]+$/.test(state),
  );
}

function parseCallback(value: string) {
  if (!/^https?:\/\//i.test(value) && !/[?&]code=/.test(value)) {
    return null;
  }

  try {
    const url = new URL(value, "https://invalid.local");
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    if (code && state && !/^(true|false)$/i.test(code)) {
      return `${code}#${state}`;
    }
  } catch {
    return null;
  }

  return null;
}
