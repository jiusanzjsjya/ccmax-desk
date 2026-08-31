import {
  addAuditEvent,
  getAccountStore,
  isBackendRefConfigured,
  markKeysDisabledByMonitor,
  reconcileKeyHealth,
} from "@/lib/account-store";
import { getSub2ApiConfig } from "@/lib/backend-config";
import { sub2gwRef, type BackendRef } from "@/lib/backends/kinds";
import { sub2GwRequestConfig } from "@/lib/backends/sub2gw";
import { disableAccount, listPoolAccounts, type PoolAccount, type Sub2ApiRequestConfig } from "@/lib/sub2api";

/**
 * Built-in OpenAI-key monitor. On each tick it scans every configured Sub2API
 * instance (primary + all sub2gw gateways) for OpenAI api-key accounts, counts
 * consecutive unhealthy scans per key, and once a key crosses the configured
 * threshold auto-disables it on Sub2API (status=inactive + schedulable=false).
 * Gated by the superadmin `openaiKeyMonitorEnabled` switch. Started once from
 * `instrumentation.ts` and self-schedules using the configured interval.
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // bounded scan — mirrors the pool capacity (1000)
const FIRST_RUN_DELAY_MS = 30_000; // let the server settle before the first scan

let started = false;

/** A key is unhealthy when it is in error / unschedulable / carries an error note. */
function isUnhealthy(account: PoolAccount): boolean {
  return account.status === "error" || account.schedulable === false || Boolean(account.errorMessage);
}

/** Bounded page-scan of one instance's OpenAI pool. */
async function scanOpenAIAccounts(config: Sub2ApiRequestConfig): Promise<PoolAccount[]> {
  const collected: PoolAccount[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { items } = await listPoolAccounts(
      { page, pageSize: PAGE_SIZE, platform: "openai", sortBy: "created_at", sortOrder: "desc" },
      config,
    );
    if (!items.length) break;
    collected.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return collected;
}

/** Run one monitor pass. Safe to call directly (e.g. from a manual trigger). */
export async function runOpenAIKeyMonitorTick(): Promise<{ scanned: number; disabled: number }> {
  const store = await getAccountStore();
  const settings = store.settings;
  if (!settings.openaiKeyMonitorEnabled) return { scanned: 0, disabled: 0 };

  const threshold = Math.max(1, settings.openaiKeyMonitorThreshold || 1);
  const backends = store.backends;

  // Enumerate every configured Sub2API-type instance.
  const targets: Array<{ ref: BackendRef; config: Sub2ApiRequestConfig }> = [];
  if (isBackendRefConfigured("sub2api", backends)) {
    try {
      targets.push({ ref: "sub2api", config: await getSub2ApiConfig() });
    } catch (error) {
      console.error("[openai-key-monitor] primary sub2api config failed", error instanceof Error ? error.message : error);
    }
  }
  for (const gateway of backends.sub2gws) {
    const ref = sub2gwRef(gateway.id);
    if (!isBackendRefConfigured(ref, backends)) continue;
    try {
      targets.push({ ref, config: await sub2GwRequestConfig(gateway) });
    } catch (error) {
      console.error(`[openai-key-monitor] gateway ${ref} login failed`, error instanceof Error ? error.message : error);
    }
  }

  let scanned = 0;
  let disabledTotal = 0;

  for (const { ref, config } of targets) {
    try {
      const accounts = await scanOpenAIAccounts(config);
      scanned += accounts.length;

      // Skip already-disabled accounts; judge the rest.
      const observations = accounts
        .filter((account) => account.id != null && account.status !== "inactive" && account.status !== "disabled")
        .map((account) => ({ accountId: String(account.id), healthy: !isUnhealthy(account) }));

      const toDisable = await reconcileKeyHealth(ref, observations, threshold);
      if (!toDisable.length) continue;

      const disabledOk: string[] = [];
      for (const id of toDisable) {
        try {
          await disableAccount(id, config);
          disabledOk.push(id);
        } catch (error) {
          console.error(`[openai-key-monitor] disable ${ref}/${id} failed`, error instanceof Error ? error.message : error);
        }
      }

      if (disabledOk.length) {
        await markKeysDisabledByMonitor(ref, disabledOk);
        await addAuditEvent({
          actorId: "system",
          actorName: "系统·OpenAI Key 监控",
          actorRole: "superadmin",
          action: "monitor.openai.disable",
          details: JSON.stringify({ platform: ref, count: disabledOk.length, ids: disabledOk.slice(0, 50) }),
        }).catch(() => {});
        disabledTotal += disabledOk.length;
      }
    } catch (error) {
      console.error(`[openai-key-monitor] scan ${ref} failed`, error instanceof Error ? error.message : error);
    }
  }

  return { scanned, disabled: disabledTotal };
}

/** Start the self-scheduling monitor loop (idempotent). */
export function startOpenAIKeyMonitor() {
  if (started) return;
  started = true;

  const schedule = async () => {
    let delayMs = 5 * 60_000;
    try {
      const { settings } = await getAccountStore();
      delayMs = Math.max(1, settings.openaiKeyMonitorIntervalMinutes || 5) * 60_000;
      if (settings.openaiKeyMonitorEnabled) {
        const result = await runOpenAIKeyMonitorTick();
        if (result.disabled) {
          console.log(`[openai-key-monitor] disabled ${result.disabled} key(s) (scanned ${result.scanned})`);
        }
      }
    } catch (error) {
      console.error("[openai-key-monitor] tick failed", error instanceof Error ? error.message : error);
    } finally {
      setTimeout(() => void schedule(), delayMs);
    }
  };

  setTimeout(() => void schedule(), FIRST_RUN_DELAY_MS);
  console.log("[openai-key-monitor] started");
}
