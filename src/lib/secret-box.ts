import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Reversible secret-at-rest encryption for stored credentials that must be
 * replayed to a third party (e.g. a vendor gateway login password). One-way
 * hashing (like local account passwords) can't be used because the adapter has
 * to send the real value upstream.
 *
 * AES-256-GCM with a key derived from SESSION_SECRET. Rotating SESSION_SECRET
 * invalidates existing ciphertexts (decrypt returns "") — the operator must then
 * re-enter the affected secrets. Values are tagged `enc:v1:` so a plaintext
 * legacy value survives decrypt untouched (best-effort migration).
 */

const KEY = scryptSync(env.SESSION_SECRET, "ccmax-secret-box-v1", 32);
const PREFIX = "enc:v1:";

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // tolerate a plaintext legacy value
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/** True when a value is already an `enc:v1:` ciphertext (not plaintext). */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}
