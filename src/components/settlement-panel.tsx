"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n, type TVars } from "@/lib/i18n/context";
import { roleLabel, type Role } from "@/lib/roles";

type SettlementPanelProps = {
  role: Role;
};

type LedgerKind = "settlement" | "prepay";

type LedgerEntryView = {
  id: string;
  kind: LedgerKind;
  amountUsd: number;
  paidAmount: number | null;
  paidCurrency: string;
  note: string | null;
  createdAt: string;
  createdByName: string;
};

type UserRow = {
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

type Totals = {
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

type Summary = {
  rows: UserRow[];
  totals: Totals;
  usageAvailable: boolean;
  canWrite: boolean;
};

type Tab = "analytics" | "ledger";

const fmtUsd = (value: number) => `US$${value.toFixed(2)}`;

function fmtCount(value: number) {
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function fmtDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export default function SettlementPanel({ role }: SettlementPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("analytics");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Drawer (new ledger entry) state.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [formUserId, setFormUserId] = useState("");
  const [formKind, setFormKind] = useState<LedgerKind>("settlement");
  const [formAmount, setFormAmount] = useState("");
  const [formPaid, setFormPaid] = useState("");
  const [formCurrency, setFormCurrency] = useState("USD");
  const [formNote, setFormNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settlement/summary", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as Partial<Summary> & { error?: string };
      if (!response.ok || !payload.rows) {
        setError(payload.error === "settlement_disabled" ? t("该模块已被超级管理员关闭。") : t("读取结算数据失败。"));
        setData(null);
        return;
      }
      setData(payload as Summary);
    } catch {
      setError(t("无法连接服务，请稍后重试。"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const totals = data?.totals ?? null;
  const canWrite = data?.canWrite ?? false;
  const usageAvailable = data?.usageAvailable ?? false;

  const targetRow = useMemo(() => rows.find((row) => row.userId === formUserId) ?? null, [rows, formUserId]);

  // Live preview of how this entry lands against the target's current pending amount.
  const preview = useMemo(() => {
    const amount = Number(formAmount);
    if (!targetRow || !Number.isFinite(amount) || amount <= 0) return null;
    const coverage = targetRow.settled + targetRow.prepaidTotal + amount;
    const pending = Math.max(0, targetRow.accrued - coverage);
    const balance = Math.max(0, coverage - targetRow.accrued);
    return { amount, pending, balance };
  }, [formAmount, targetRow]);

  function openDrawer(userId?: string) {
    setFormUserId(userId ?? rows[0]?.userId ?? "");
    setFormKind("settlement");
    setFormAmount("");
    setFormPaid("");
    setFormCurrency("USD");
    setFormNote("");
    setFormError("");
    setDrawerOpen(true);
  }

  function toggleExpanded(userId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function submitEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(formAmount);
    if (!formUserId) {
      setFormError(t("请选择用户。"));
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError(t("请输入大于 0 的入账金额。"));
      return;
    }
    const paid = formPaid.trim() === "" ? null : Number(formPaid);
    if (paid !== null && (!Number.isFinite(paid) || paid < 0)) {
      setFormError(t("实际付款金额无效。"));
      return;
    }

    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch("/api/settlement/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: formUserId,
          kind: formKind,
          amountUsd: amount,
          paidAmount: paid,
          paidCurrency: formCurrency.trim() || "USD",
          note: formNote.trim() || undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setFormError(readEntryError(t, response.status, payload.error));
        return;
      }
      setDrawerOpen(false);
      await load();
    } catch {
      setFormError(t("提交失败，请稍后重试。"));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteEntry(id: string) {
    try {
      const response = await fetch(`/api/settlement/entries/${id}`, { method: "DELETE" });
      if (response.ok) await load();
    } catch {
      // best-effort; a failed delete just leaves the row in place
    }
  }

  return (
    <section className="settle" aria-labelledby="settle-title">
      <div className="settle-head">
        <div className="settle-tabs" role="tablist" aria-label={t("结算视图")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "analytics"}
            className={`settle-tab ${tab === "analytics" ? "is-active" : ""}`}
            onClick={() => setTab("analytics")}
          >
            {t("数据分析")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ledger"}
            className={`settle-tab ${tab === "ledger" ? "is-active" : ""}`}
            onClick={() => setTab("ledger")}
          >
            {t("预付结款报表")}
          </button>
        </div>
        <div className="settle-head-actions">
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
            {loading ? t("刷新中…") : t("刷新")}
          </button>
          {canWrite ? (
            <button type="button" className="primary-button" onClick={() => openDrawer()} disabled={!rows.length}>
              {t("新建台账")}
            </button>
          ) : null}
        </div>
      </div>

      <p id="settle-title" className="settle-lede">
        {tab === "analytics"
          ? t("按用户统计名下账号的真实用量金额（近 30 天成本换算）、账号数与请求数。")
          : t("结算用于支付已产生的收益；预付会先抵扣待结算金额，剩余部分自动转为预付余额。数字仅为台账记录，不接真实支付接口。")}
      </p>

      {!usageAvailable ? (
        <div className="settle-hint">{t("Sub2API 未配置或暂无用量数据，用量金额显示为 US$0.00；台账记录不受影响。")}</div>
      ) : null}

      {error ? <div className="error-box">{error}</div> : null}

      {loading && !data ? (
        <div className="settle-empty">{t("加载中…")}</div>
      ) : tab === "analytics" ? (
        <AnalyticsView rows={rows} totals={totals} />
      ) : (
        <LedgerView
          rows={rows}
          totals={totals}
          canWrite={canWrite}
          canDelete={role === "superadmin"}
          expanded={expanded}
          onToggle={toggleExpanded}
          onNew={openDrawer}
          onDelete={deleteEntry}
        />
      )}

      {drawerOpen ? (
        <div className="drawer-overlay" role="dialog" aria-modal="true" aria-label={t("新建台账")}>
          <button type="button" className="drawer-scrim" aria-label={t("关闭")} onClick={() => setDrawerOpen(false)} />
          <form className="drawer" onSubmit={submitEntry}>
            <div className="drawer-head">
              <div>
                <p className="settle-eyebrow">NEW LEDGER ENTRY</p>
                <h3>{t("新建台账")}{targetRow ? ` · ${targetRow.username}` : ""}</h3>
              </div>
              <button type="button" className="drawer-close" aria-label={t("关闭")} onClick={() => setDrawerOpen(false)}>
                ✕
              </button>
            </div>

            <div className="seg-toggle" role="group" aria-label={t("台账类型")}>
              <button
                type="button"
                className={`seg ${formKind === "settlement" ? "is-active" : ""}`}
                onClick={() => setFormKind("settlement")}
              >
                <strong>{t("结算")}</strong>
                <span>{t("支付已经产生的收益")}</span>
              </button>
              <button
                type="button"
                className={`seg ${formKind === "prepay" ? "is-active" : ""}`}
                onClick={() => setFormKind("prepay")}
              >
                <strong>{t("预付")}</strong>
                <span>{t("提前充值并抵扣后续收益")}</span>
              </button>
            </div>

            <label className="field">
              <span className="field-label">{t("用户")}</span>
              <select className="text-input" value={formUserId} onChange={(event) => setFormUserId(event.target.value)}>
                {rows.map((row) => (
                  <option key={row.userId} value={row.userId}>
                    {row.username} · {t(roleLabel(row.role))}
                  </option>
                ))}
              </select>
            </label>

            {targetRow ? (
              <div className="drawer-mini">
                <span>{t("累计收益")} {fmtUsd(targetRow.accrued)}</span>
                <span>{t("待结算")} {fmtUsd(targetRow.pending)}</span>
                <span>{t("预付余额")} {fmtUsd(targetRow.prepayBalance)}</span>
              </div>
            ) : null}

            <label className="field">
              <span className="field-label">{t(formKind === "prepay" ? "本次预付入账金额（USD）" : "本次结算入账金额（USD）")}</span>
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                value={formAmount}
                onChange={(event) => setFormAmount(event.target.value)}
                placeholder="0.00"
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span className="field-label">{t("实际付款金额")}</span>
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formPaid}
                  onChange={(event) => setFormPaid(event.target.value)}
                  placeholder={t("可选")}
                />
              </label>
              <label className="field">
                <span className="field-label">{t("付款币种")}</span>
                <input
                  className="text-input"
                  type="text"
                  value={formCurrency}
                  onChange={(event) => setFormCurrency(event.target.value)}
                  maxLength={16}
                />
              </label>
            </div>

            <label className="field">
              <span className="field-label">{t("备注（可选）")}</span>
              <textarea
                className="text-input settle-textarea"
                value={formNote}
                onChange={(event) => setFormNote(event.target.value)}
                placeholder={t("例如：8 月第 2 批结算、转账流水号等")}
                maxLength={500}
              />
            </label>

            {preview ? (
              <div className="drawer-preview">
                <strong>
                  {t(formKind === "prepay" ? "本次预付入账 {amount}" : "本次结算入账 {amount}", { amount: fmtUsd(preview.amount) })}
                </strong>
                <span>
                  {preview.pending > 0
                    ? t("记账后待结算 {amount}", { amount: fmtUsd(preview.pending) })
                    : preview.balance > 0
                      ? t("待结算已结清，预付余额 {amount}", { amount: fmtUsd(preview.balance) })
                      : t("待结算已结清")}
                </span>
              </div>
            ) : null}

            {formError ? <div className="error-box">{formError}</div> : null}

            <div className="drawer-foot">
              <button type="button" className="secondary-button" onClick={() => setDrawerOpen(false)} disabled={submitting}>
                {t("取消")}
              </button>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? t("提交中…") : t("记一笔")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function AnalyticsView({ rows, totals }: { rows: UserRow[]; totals: Totals | null }) {
  const { t } = useI18n();
  const todayTotal = rows.reduce((acc, row) => acc + row.todayCost, 0);
  const requestsTotal = rows.reduce((acc, row) => acc + row.requests, 0);

  return (
    <>
      <div className="stat-grid settle-stat-grid">
        <StatCard k={t("累计收益")} v={fmtUsd(totals?.accrued ?? 0)} note={t("近 30 天用量换算")} />
        <StatCard k={t("今日用量")} v={fmtUsd(todayTotal)} note={t("当日成本")} />
        <StatCard k={t("30 天请求")} v={fmtCount(requestsTotal)} note={t("累计请求数")} />
        <StatCard k={t("账号数")} v={String(totals?.accountCount ?? 0)} note={t("名下账号")} />
        <StatCard k={t("用户数")} v={String(totals?.userCount ?? 0)} note={t("可见范围")} />
      </div>

      <div className="ledger-table" role="table" aria-label={t("用量分析")}>
        <div className="ledger-row is-head" role="row">
          <span role="columnheader">{t("用户")}</span>
          <span role="columnheader">{t("角色")}</span>
          <span role="columnheader" className="num">{t("账号数")}</span>
          <span role="columnheader" className="num">{t("近 30 天用量")}</span>
          <span role="columnheader" className="num">{t("今日用量")}</span>
          <span role="columnheader" className="num">{t("30 天请求")}</span>
          <span role="columnheader" className="num">{t("待结算")}</span>
        </div>
        {rows.length === 0 ? (
          <div className="settle-empty">{t("暂无用户数据。")}</div>
        ) : (
          rows.map((row) => (
            <div className="ledger-row" role="row" key={row.userId}>
              <span role="cell" className="ledger-user">
                <strong>{row.username}</strong>
                <em>{row.disabled ? t("已停用") : t("启用中")}</em>
              </span>
              <span role="cell">{t(roleLabel(row.role))}</span>
              <span role="cell" className="num">{row.accountCount}</span>
              <span role="cell" className="num">{fmtUsd(row.accrued)}</span>
              <span role="cell" className="num">{fmtUsd(row.todayCost)}</span>
              <span role="cell" className="num">{fmtCount(row.requests)}</span>
              <span role="cell" className="num">{fmtUsd(row.pending)}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function LedgerView({
  rows,
  totals,
  canWrite,
  canDelete,
  expanded,
  onToggle,
  onNew,
  onDelete,
}: {
  rows: UserRow[];
  totals: Totals | null;
  canWrite: boolean;
  canDelete: boolean;
  expanded: Set<string>;
  onToggle: (userId: string) => void;
  onNew: (userId: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="stat-grid settle-stat-grid">
        <StatCard k={t("累计收益")} v={fmtUsd(totals?.accrued ?? 0)} note={t("用量换算金额")} />
        <StatCard k={t("累计入账")} v={fmtUsd(totals?.totalIn ?? 0)} note={t("{n} 笔记录", { n: totals?.entryCount ?? 0 })} />
        <StatCard k={t("待结算")} v={fmtUsd(totals?.pending ?? 0)} note={t("尚未支付")} />
        <StatCard k={t("预付余额")} v={fmtUsd(totals?.prepayBalance ?? 0)} note={t("自动抵扣后续收益")} />
        <StatCard k={t("用户数")} v={String(totals?.userCount ?? 0)} note={t("可见范围")} />
      </div>

      <div className="ledger-table is-ledger" role="table" aria-label={t("预付结款报表")}>
        <div className="ledger-row is-ledger is-head" role="row">
          <span role="columnheader">{t("用户")}</span>
          <span role="columnheader" className="num">{t("账号")}</span>
          <span role="columnheader" className="num">{t("累计收益")}</span>
          <span role="columnheader" className="num">{t("已结算")}</span>
          <span role="columnheader" className="num">{t("待结算")}</span>
          <span role="columnheader" className="num">{t("预付余额")}</span>
          <span role="columnheader">{t("最近记账")}</span>
          <span role="columnheader" className="col-actions">{t("操作")}</span>
        </div>
        {rows.length === 0 ? (
          <div className="settle-empty">{t("暂无用户数据。")}</div>
        ) : (
          rows.map((row) => (
            <div className="ledger-group" key={row.userId}>
              <div className="ledger-row is-ledger" role="row">
                <span role="cell" className="ledger-user">
                  <strong>{row.username}</strong>
                  <em>{t(roleLabel(row.role))}</em>
                </span>
                <span role="cell" className="num">{row.accountCount}</span>
                <span role="cell" className="num">{fmtUsd(row.accrued)}</span>
                <span role="cell" className="num">{fmtUsd(row.settled)}</span>
                <span role="cell" className="num">{fmtUsd(row.pending)}</span>
                <span role="cell" className={`num ${row.prepayBalance > 0 ? "is-accent" : ""}`}>{fmtUsd(row.prepayBalance)}</span>
                <span role="cell" className="ledger-sync">{fmtDateTime(row.lastEntryAt)}</span>
                <span role="cell" className="col-actions">
                  {row.entries.length > 0 ? (
                    <button type="button" className="link-button" onClick={() => onToggle(row.userId)}>
                      {expanded.has(row.userId) ? t("收起") : t("明细({n})", { n: row.entries.length })}
                    </button>
                  ) : null}
                  {canWrite ? (
                    <button type="button" className="secondary-button is-small" onClick={() => onNew(row.userId)}>
                      {t("记一笔")}
                    </button>
                  ) : null}
                </span>
              </div>
              {expanded.has(row.userId) && row.entries.length > 0 ? (
                <div className="ledger-detail">
                  {row.entries.map((entry) => (
                    <div className="ledger-entry" key={entry.id}>
                      <span className={`entry-tag ${entry.kind}`}>{entry.kind === "prepay" ? t("预付") : t("结算")}</span>
                      <span className="entry-amount">{fmtUsd(entry.amountUsd)}</span>
                      <span className="entry-paid">
                        {entry.paidAmount != null ? t("实付 {amount} {currency}", { amount: entry.paidAmount, currency: entry.paidCurrency }) : "—"}
                      </span>
                      <span className="entry-note">{entry.note || "—"}</span>
                      <span className="entry-meta">
                        {fmtDateTime(entry.createdAt)} · {entry.createdByName}
                      </span>
                      {canDelete ? (
                        <button type="button" className="link-button" onClick={() => onDelete(entry.id)}>
                          {t("删除")}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </>
  );
}

function StatCard({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="stat-card settle-card">
      <p className="k">{k}</p>
      <p className="settle-card-v">{v}</p>
      <p className="settle-card-note">{note}</p>
    </div>
  );
}

function readEntryError(t: (key: string, vars?: TVars) => string, status: number, code?: string) {
  if (code === "forbidden" || status === 403) return t("没有权限为该用户记账。");
  if (code === "user_not_found" || status === 404) return t("用户不存在。");
  if (code === "invalid_request" || status === 400) return t("填写内容有误，请检查金额。");
  return t("提交失败，请稍后重试。");
}
