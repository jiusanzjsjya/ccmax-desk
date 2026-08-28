import type { LedgerEntry, LedgerEntryKind } from "@/lib/account-store";
import type { Role } from "@/lib/roles";

/**
 * Pure data shapes + aggregation for the settlement / data-analysis module.
 * No server-only imports here so the client may reuse the types. Usage figures
 * (accrued / requests) come from real Sub2API usage cost; settlement & prepay
 * are manual bookkeeping records — nothing here touches a payment gateway.
 */

/** Real usage rolled up for one user, from their owned Sub2API accounts. */
export type UserUsage = {
  accountCount: number;
  /** Cumulative usage cost proxy — 30-day cost in USD ("累计收益"). */
  accrued: number;
  todayCost: number;
  /** 30-day request count. */
  requests: number;
};

export type LedgerEntryView = {
  id: string;
  kind: LedgerEntryKind;
  amountUsd: number;
  paidAmount: number | null;
  paidCurrency: string;
  note: string | null;
  createdAt: string;
  createdByName: string;
};

export type SettlementUserRow = {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  accountCount: number;
  accrued: number;
  todayCost: number;
  requests: number;
  settled: number;
  prepaidTotal: number;
  pending: number;
  prepayBalance: number;
  lastEntryAt: string | null;
  entries: LedgerEntryView[];
};

export type SettlementTotals = {
  accrued: number;
  totalIn: number;
  settled: number;
  prepaidTotal: number;
  pending: number;
  prepayBalance: number;
  userCount: number;
  entryCount: number;
  accountCount: number;
};

export type SettlementSummary = {
  rows: SettlementUserRow[];
  totals: SettlementTotals;
  /** Whether real Sub2API usage could be read (false → accrued shown as 0/—). */
  usageAvailable: boolean;
  /** Whether the viewer may create ledger entries for at least one visible user. */
  canWrite: boolean;
};

type BasicUser = { id: string; username: string; displayName: string; role: Role; disabled: boolean };

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Build per-user rows and totals from the visible user set, the (already
 * scoped) ledger entries, and the real usage rolled up per user.
 *
 * Coverage semantics (see plan): a prepay first offsets accrued usage; any
 * excess becomes prepay balance carried forward.
 *   coverage      = settled + prepaidTotal
 *   pending 待结算 = max(0, accrued − coverage)
 *   balance 预付余额 = max(0, coverage − accrued)
 */
export function buildSettlementRows(
  users: BasicUser[],
  ledger: LedgerEntry[],
  usageByUser: Map<string, UserUsage>,
): { rows: SettlementUserRow[]; totals: SettlementTotals } {
  const entriesByUser = new Map<string, LedgerEntry[]>();
  for (const entry of ledger) {
    const list = entriesByUser.get(entry.userId);
    if (list) list.push(entry);
    else entriesByUser.set(entry.userId, [entry]);
  }

  const rows: SettlementUserRow[] = users.map((user) => {
    const usage = usageByUser.get(user.id);
    const entries = (entriesByUser.get(user.id) ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    let settled = 0;
    let prepaidTotal = 0;
    for (const entry of entries) {
      if (entry.kind === "settlement") settled += entry.amountUsd;
      else prepaidTotal += entry.amountUsd;
    }

    const accrued = usage?.accrued ?? 0;
    const coverage = settled + prepaidTotal;

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      disabled: user.disabled,
      accountCount: usage?.accountCount ?? 0,
      accrued: round2(accrued),
      todayCost: round2(usage?.todayCost ?? 0),
      requests: usage?.requests ?? 0,
      settled: round2(settled),
      prepaidTotal: round2(prepaidTotal),
      pending: round2(Math.max(0, accrued - coverage)),
      prepayBalance: round2(Math.max(0, coverage - accrued)),
      lastEntryAt: entries[0]?.createdAt ?? null,
      entries: entries.map(toEntryView),
    };
  });

  const totals: SettlementTotals = {
    accrued: round2(sum(rows, (r) => r.accrued)),
    totalIn: round2(sum(rows, (r) => r.settled + r.prepaidTotal)),
    settled: round2(sum(rows, (r) => r.settled)),
    prepaidTotal: round2(sum(rows, (r) => r.prepaidTotal)),
    pending: round2(sum(rows, (r) => r.pending)),
    prepayBalance: round2(sum(rows, (r) => r.prepayBalance)),
    userCount: rows.length,
    entryCount: rows.reduce((acc, r) => acc + r.entries.length, 0),
    accountCount: rows.reduce((acc, r) => acc + r.accountCount, 0),
  };

  return { rows, totals };
}

function toEntryView(entry: LedgerEntry): LedgerEntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    amountUsd: entry.amountUsd,
    paidAmount: entry.paidAmount,
    paidCurrency: entry.paidCurrency,
    note: entry.note,
    createdAt: entry.createdAt,
    createdByName: entry.createdByName,
  };
}

function sum<T>(list: T[], pick: (item: T) => number): number {
  return list.reduce((acc, item) => acc + pick(item), 0);
}
