"use client";

import { useState } from "react";

import AccountManagementPanel from "@/components/account-management-panel";
import AccountPoolPanel from "@/components/account-pool-panel";
import BackendConfigPanel from "@/components/backend-config-panel";
import EgressProxyPanel from "@/components/egress-proxy-panel";
import LocaleToggle from "@/components/locale-toggle";
import KeyProvisioningPanel from "@/components/key-provisioning-panel";
import KeyUsagePanel from "@/components/key-usage-panel";
import LogoutButton from "@/components/logout-button";
import ProvisioningPanel from "@/components/provisioning-panel";
import SettlementPanel from "@/components/settlement-panel";
import SystemLogPanel from "@/components/system-log-panel";
import ThemeToggle from "@/components/theme-toggle";
import { useI18n } from "@/lib/i18n/context";
import type { Role } from "@/lib/roles";

type SectionId =
  | "overview"
  | "provisioning"
  | "key-provisioning"
  | "pool"
  | "key-usage"
  | "proxies"
  | "backends"
  | "access"
  | "settlement"
  | "logs";

type DashboardShellProps = {
  role: Role;
  roleLabel: string;
  displayName: string;
  canViewAccountPool: boolean;
  sub2ApiConfigured: boolean;
  superadminConfigured: boolean;
  settlementEnabled: boolean;
  /** 授权上号 module grant — gates the provisioning nav + panel. */
  canOnboard: boolean;
  /** 授权上key module grant — gates the key-provisioning nav + panel. */
  canUploadKey: boolean;
};

type NavItem = {
  id: SectionId;
  index: string;
  label: string;
  hint: string;
  title: string;
  subtitle: string;
  visible: (p: DashboardShellProps) => boolean;
};

const NAV: NavItem[] = [
  {
    id: "overview",
    index: "00",
    label: "总览",
    hint: "信号路径与状态",
    title: "总览",
    subtitle: "授权链路与接入状态一览",
    visible: () => true,
  },
  {
    id: "provisioning",
    index: "01",
    label: "授权上号",
    hint: "生成槽位 · 授权 · 入池",
    title: "授权上号",
    subtitle: "生成授权槽位、完成官方授权、提交回执入池",
    visible: (p) => p.canOnboard,
  },
  {
    id: "key-provisioning",
    index: "02",
    label: "授权上key",
    hint: "OpenAI · API key · 入池",
    title: "授权上key",
    subtitle: "提交 OpenAI API key，直接入池到 Sub2API（无需官方授权换取）",
    visible: (p) => p.canUploadKey,
  },
  {
    id: "pool",
    index: "03",
    label: "账号池统揽",
    hint: "调度 · 健康 · 掉权",
    title: "账号池统揽",
    subtitle: "OAuth 账号调度与健康 · 额度、并发、掉权状态",
    visible: (p) => p.canViewAccountPool,
  },
  {
    id: "key-usage",
    index: "04",
    label: "Key 使用额度",
    hint: "OpenAI · 用量 · 死活",
    title: "Key 使用额度",
    subtitle: "实时显示自己 OpenAI Key 在 Sub2API 上的用量与是否死 Key",
    visible: (p) => p.canUploadKey,
  },
  {
    id: "backends",
    index: "05",
    label: "多平台后端",
    hint: "目标平台与网关",
    title: "多平台后端",
    subtitle: "统一配置 Sub2API、new-api、one-api 与自建网关",
    visible: (p) => p.role === "superadmin",
  },
  {
    id: "access",
    index: "06",
    label: "账号与权限",
    hint: "账号 · 系统开关",
    title: "账号与权限",
    subtitle: "本地账号与系统开关",
    visible: (p) => p.role !== "user",
  },
  {
    id: "logs",
    index: "07",
    label: "系统日志",
    hint: "操作审计 · 留痕",
    title: "系统日志",
    subtitle: "登录、账号、系统开关与后端配置的操作审计",
    visible: (p) => p.role === "superadmin",
  },
  {
    id: "settlement",
    index: "08",
    label: "数据分析",
    hint: "用量金额 · 结算台账",
    title: "数据分析 · 预付结款",
    subtitle: "按用户统计真实用量金额，记录结算与预付台账（仅记录，不接支付）",
    visible: (p) => p.settlementEnabled,
  },
  {
    id: "proxies",
    index: "09",
    label: "代理配置",
    hint: "出口代理 · 账号统计",
    title: "出口代理",
    subtitle: "创建/导入出口代理，新建账号时选用；显示每个代理已绑定的账号数",
    visible: () => true,
  },
];

export default function DashboardShell(props: DashboardShellProps) {
  const { t } = useI18n();
  const items = NAV.filter((item) => item.visible(props));
  const [active, setActive] = useState<SectionId>("overview");
  const current = items.find((item) => item.id === active) ?? items[0];

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand">
          <span className="brand-mark">CC</span>
          <span className="rail-wordmark">
            <strong>CCMax</strong>
            <span>Control</span>
          </span>
        </div>

        <p className="rail-kicker">{t("模块")}</p>
        <nav className="rail-nav" aria-label={t("控制台模块")}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail-item ${active === item.id ? "is-active" : ""}`}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => setActive(item.id)}
            >
              <span className="rail-index">{item.index}</span>
              <span className="rail-label">
                <b>{t(item.label)}</b>
                <em>{t(item.hint)}</em>
              </span>
            </button>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="user-chip">
            <span className="avatar">{initial(props.displayName)}</span>
            <span className="meta">
              <strong>{props.displayName}</strong>
              <span>{t(props.roleLabel)}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <span className="idx">/ {current.index}</span>
            <h1>{t(current.title)}</h1>
            <em>{t(current.subtitle)}</em>
          </div>
          <div className="topbar-right">
            <SignalPath sub2ApiConfigured={props.sub2ApiConfigured} />
            <div className="topbar-actions">
              <LocaleToggle />
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
        </header>

        <main className="view">
          <div className="view-inner">
            {active === "overview" ? <Overview {...props} onJump={setActive} /> : null}
            {active === "provisioning" && props.canOnboard ? (
              <ProvisioningPanel
                adminConfigured={props.superadminConfigured}
                sub2ApiConfigured={props.sub2ApiConfigured}
                canViewAccountPool={props.canViewAccountPool}
              />
            ) : null}
            {active === "key-provisioning" && props.canUploadKey ? (
              <KeyProvisioningPanel sub2ApiConfigured={props.sub2ApiConfigured} />
            ) : null}
            {active === "pool" && props.canViewAccountPool ? (
              <AccountPoolPanel sub2ApiConfigured={props.sub2ApiConfigured} />
            ) : null}
            {active === "key-usage" && props.canUploadKey ? (
              <KeyUsagePanel sub2ApiConfigured={props.sub2ApiConfigured} />
            ) : null}
            {active === "proxies" ? <EgressProxyPanel role={props.role} /> : null}
            {active === "backends" && props.role === "superadmin" ? <BackendConfigPanel /> : null}
            {active === "access" && props.role !== "user" ? (
              <AccountManagementPanel role={props.role as Exclude<Role, "user">} />
            ) : null}
            {active === "logs" && props.role === "superadmin" ? <SystemLogPanel /> : null}
            {active === "settlement" && props.settlementEnabled ? <SettlementPanel role={props.role} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function SignalPath({ sub2ApiConfigured, hero = false }: { sub2ApiConfigured: boolean; hero?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`signal-path ${hero ? "is-hero" : ""}`} aria-label={t("授权信号路径")}>
      <span className="signal-node is-source is-live">
        <i className="dot" /> Claude OAuth
      </span>
      <span className="signal-arrow">▶</span>
      <span className={`signal-node ${sub2ApiConfigured ? "is-live" : ""}`}>
        <i className="dot" /> {t("Sub2API 代理")}
      </span>
      <span className="signal-arrow">▶</span>
      <span className="signal-node">
        <i className="dot" /> {t("目标平台")}
      </span>
    </div>
  );
}

function Overview(props: DashboardShellProps & { onJump: (id: SectionId) => void }) {
  const { t } = useI18n();
  const { role, roleLabel, sub2ApiConfigured, superadminConfigured, onJump } = props;

  return (
    <section className="overview" aria-labelledby="overview-title">
      <div className="overview-hero">
        <p className="eyebrow">{t("CCMax provisioning bridge")}</p>
        <h2 id="overview-title">{t("把已授权的 Claude 账号接入你的账号池")}</h2>
        <p>
          {t(
            "一条链路：Claude 官方 OAuth 由 Sub2API 代理换取凭据，再写入你选定的目标平台。凭据只在服务端流转，浏览器只接收状态摘要。",
          )}
        </p>
        <SignalPath sub2ApiConfigured={sub2ApiConfigured} hero />
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <p className="k">{t("超级管理员")}</p>
          <p className="v">
            <span className={`dot ${superadminConfigured ? "ok" : "bad"}`} />
            {superadminConfigured ? t("已配置") : t("未配置")}
          </p>
        </div>
        <div className="stat-card">
          <p className="k">{t("Sub2API 代理")}</p>
          <p className="v">
            <span className={`dot ${sub2ApiConfigured ? "ok" : "warn"}`} />
            {sub2ApiConfigured ? t("已就绪") : t("待配置")}
          </p>
        </div>
        <div className="stat-card">
          <p className="k">{t("当前身份")}</p>
          <p className="v">
            <span className="dot ok" />
            {t(roleLabel)}
          </p>
        </div>
      </div>

      <div className="quick-grid">
        {props.canOnboard ? (
          <button type="button" className="quick-card" onClick={() => onJump("provisioning")}>
            <span className="qk">{t("01 / 上号")}</span>
            <strong>{t("授权上号")}</strong>
            <span>{t("选目标平台，生成授权槽位，完成官方授权后提交回执入池。")}</span>
          </button>
        ) : null}
        {props.canUploadKey ? (
          <button type="button" className="quick-card" onClick={() => onJump("key-provisioning")}>
            <span className="qk">{t("01 / 上key")}</span>
            <strong>{t("授权上key")}</strong>
            <span>{t("提交 OpenAI API key，直接入池到 Sub2API（无需官方授权换取）")}</span>
          </button>
        ) : null}
        {props.canViewAccountPool ? (
          <button type="button" className="quick-card" onClick={() => onJump("pool")}>
            <span className="qk">{t("02 / 账号池")}</span>
            <strong>{t("账号池统揽")}</strong>
            <span>{t("查看已入池账号的调度、额度、并发与掉权状态。")}</span>
          </button>
        ) : null}
        {role === "superadmin" ? (
          <button type="button" className="quick-card" onClick={() => onJump("backends")}>
            <span className="qk">{t("03 / 平台")}</span>
            <strong>{t("多平台后端")}</strong>
            <span>{t("配置 Sub2API / new-api / one-api，或添加多个自建网关。")}</span>
          </button>
        ) : null}
        {role !== "user" ? (
          <button type="button" className="quick-card" onClick={() => onJump("access")}>
            <span className="qk">{t("04 / 权限")}</span>
            <strong>{t("账号与权限")}</strong>
            <span>{t("创建本地账号、调整系统开关与访问权限。")}</span>
          </button>
        ) : null}
        {role === "superadmin" ? (
          <button type="button" className="quick-card" onClick={() => onJump("logs")}>
            <span className="qk">{t("05 / 日志")}</span>
            <strong>{t("系统日志")}</strong>
            <span>{t("登录、账号变更、系统开关与后端配置的操作审计留痕。")}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function initial(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : "C";
}
