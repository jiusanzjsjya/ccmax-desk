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
import { disableAccount, listPoolAccounts, testOpenAIAccount, type PoolAccount, type Sub2ApiRequestConfig } from "@/lib/sub2api";

/**
 * Built-in OpenAI-key monitor. On each tick it ACTIVELY probes — via Sub2API's
 * account test (a real request through the key) — every OpenAI api-key account
 * THIS SYSTEM uploaded (tracked in poolOwnership); it never touches other
 * accounts on Sub2API. A conclusively-dead key (invalid / no-credits / disabled)
 * crossing the configured threshold is auto-disabled (status=inactive +
 * schedulable=false) and the probe's captured reason is written to the audit log
 * ("抓包"). Gated by the superadmin `openaiKeyMonitorEnabled` switch; started once
 * from `instrumentation.ts` and self-schedules on the configured interval.
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // bounded scan — mirrors the pool capacity (1000)
const FIRST_RUN_DELAY_MS = 30_000; // let the server settle before the first probe

let started = false;

/** List the owned accounts on one instance (bounded pool scan, filtered to `owned`). */
async function collectOwnedOpenAIAccounts(owned: Set<string>, config: Sub2ApiRequestConfig): Promise<PoolAccount[]> {
  const collected: PoolAccount[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { items } = await listPoolAccounts(
      { page, pageSize: PAGE_SIZE, platform: "openai", sortBy: "created_at", sortOrder: "desc" },
      config,
    );
    if (!items.length) break;
    for (const account of items) {
      if (account.id != null && owned.has(String(account.id))) collected.push(account);
    }
    if (collected.length >= owned.size) break; // found them all
    if (items.length < PAGE_SIZE) break;
  }
  return collected;
}

/** Run one monitor pass. Safe to call directly (e.g. from a manual trigger). */
export async function runOpenAIKeyMonitorTick(): Promise<{ probed: number; disabled: number }> {
  const store = await getAccountStore();
  const settings = store.settings;
  if (!settings.openaiKeyMonitorEnabled) return { probed: 0, disabled: 0 };

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

  let probedTotal = 0;
  let disabledTotal = 0;

  for (const { ref, config } of targets) {
    // Only THIS system's uploads on this instance (from poolOwnership) — never
    // other accounts on Sub2API.
    const owned = new Set(store.poolOwnership.filter((o) => o.platform === ref).map((o) => o.accountId));
    if (owned.size === 0) continue;

    try {
      const accounts = await collectOwnedOpenAIAccounts(owned, config);
      // Skip accounts already disabled on Sub2API — nothing to probe.
      const active = accounts.filter((a) => a.id != null && a.status !== "inactive" && a.status !== "disabled");

      const observations: Array<{ accountId: string; healthy: boolean }> = [];
      const reasonById = new Map<string, string>();
      let dead = 0;
      let inconclusive = 0;

      for (const account of active) {
        const id = String(account.id);
        const probe = await testOpenAIAccount(account.id!, config);
        probedTotal += 1;
        if (!probe.conclusive) {
          inconclusive += 1;
          observations.push({ accountId: id, healthy: true }); // don't penalize a transient
          continue;
        }
        observations.push({ accountId: id, healthy: probe.alive });
        if (!probe.alive) {
          dead += 1;
          const reason = probe.detail || "校验未通过（无效/无余额/已停用）";
          reasonById.set(id, reason);
          // 抓包: record what the probe actually saw, per key.
          console.log(`[openai-key-monitor] dead probe ${ref}/${id} (${account.name ?? ""}): ${reason}`);
        }
      }
      console.log(`[openai-key-monitor] ${ref}: probed ${active.length}, dead ${dead}, inconclusive ${inconclusive}`);

      const toDisable = await reconcileKeyHealth(ref, observations, threshold);
      if (!toDisable.length) continue;

      const disabledOk: Array<{ id: string; reason: string }> = [];
      for (const id of toDisable) {
        try {
          await disableAccount(id, config);
          disabledOk.push({ id, reason: reasonById.get(id) ?? "连续探测异常" });
        } catch (error) {
          console.error(`[openai-key-monitor] disable ${ref}/${id} failed`, error instanceof Error ? error.message : error);
        }
      }

      if (disabledOk.length) {
        await markKeysDisabledByMonitor(ref, disabledOk.map((d) => d.id));
        await addAuditEvent({
          actorId: "system",
          actorName: "系统·OpenAI Key 监控",
          actorRole: "superadmin",
          action: "monitor.openai.disable",
          // 抓包: the captured probe reason travels into the audit trail.
          details: JSON.stringify({ platform: ref, count: disabledOk.length, disabled: disabledOk.slice(0, 50) }),
        }).catch(() => {});
        disabledTotal += disabledOk.length;
      }
    } catch (error) {
      console.error(`[openai-key-monitor] probe ${ref} failed`, error instanceof Error ? error.message : error);
    }
  }

  return { probed: probedTotal, disabled: disabledTotal };
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
          console.log(`[openai-key-monitor] disabled ${result.disabled} key(s) (probed ${result.probed})`);
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
