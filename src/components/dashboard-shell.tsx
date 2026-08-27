"use client";

import { useState } from "react";

import AccountManagementPanel from "@/components/account-management-panel";
import AccountPoolPanel from "@/components/account-pool-panel";
import BackendConfigPanel from "@/components/backend-config-panel";
import LogoutButton from "@/components/logout-button";
import ProvisioningPanel from "@/components/provisioning-panel";
import SystemLogPanel from "@/components/system-log-panel";
import ThemeToggle from "@/components/theme-toggle";
import type { Role } from "@/lib/roles";

type SectionId = "overview" | "provisioning" | "pool" | "backends" | "access" | "logs";

type DashboardShellProps = {
  role: Role;
  roleLabel: string;
  displayName: string;
  canViewAccountPool: boolean;
  sub2ApiConfigured: boolean;
  superadminConfigured: boolean;
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
    visible: () => true,
  },
  {
    id: "pool",
    index: "02",
    label: "账号池统揽",
    hint: "调度 · 健康 · 掉权",
    title: "账号池统揽",
    subtitle: "OAuth 账号调度与健康 · 额度、并发、掉权状态",
    visible: (p) => p.canViewAccountPool,
  },
  {
    id: "backends",
    index: "03",
    label: "多平台后端",
    hint: "目标平台与网关",
    title: "多平台后端",
    subtitle: "统一配置 Sub2API、new-api、one-api 与自建网关",
    visible: (p) => p.role === "superadmin",
  },
  {
    id: "access",
    index: "04",
    label: "账号与权限",
    hint: "账号 · 系统开关",
    title: "账号与权限",
    subtitle: "本地账号与系统开关",
    visible: (p) => p.role !== "user",
  },
  {
    id: "logs",
    index: "05",
    label: "系统日志",
    hint: "操作审计 · 留痕",
    title: "系统日志",
    subtitle: "登录、账号、系统开关与后端配置的操作审计",
    visible: (p) => p.role === "superadmin",
  },
];

export default function DashboardShell(props: DashboardShellProps) {
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

        <p className="rail-kicker">模块</p>
        <nav className="rail-nav" aria-label="控制台模块">
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
                <b>{item.label}</b>
                <em>{item.hint}</em>
              </span>
            </button>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="user-chip">
            <span className="avatar">{initial(props.displayName)}</span>
            <span className="meta">
              <strong>{props.displayName}</strong>
              <span>{props.roleLabel}</span>
            </span>
          </div>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <span className="idx">/ {current.index}</span>
            <h1>{current.title}</h1>
            <em>{current.subtitle}</em>
          </div>
          <SignalPath sub2ApiConfigured={props.sub2ApiConfigured} />
        </header>

        <main className="view">
          <div className="view-inner">
            {active === "overview" ? <Overview {...props} onJump={setActive} /> : null}
            {active === "provisioning" ? (
              <ProvisioningPanel
                adminConfigured={props.superadminConfigured}
                sub2ApiConfigured={props.sub2ApiConfigured}
                canViewAccountPool={props.canViewAccountPool}
              />
            ) : null}
            {active === "pool" && props.canViewAccountPool ? (
              <AccountPoolPanel sub2ApiConfigured={props.sub2ApiConfigured} />
            ) : null}
            {active === "backends" && props.role === "superadmin" ? <BackendConfigPanel /> : null}
            {active === "access" && props.role !== "user" ? (
              <AccountManagementPanel role={props.role as Exclude<Role, "user">} />
            ) : null}
            {active === "logs" && props.role === "superadmin" ? <SystemLogPanel /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function SignalPath({ sub2ApiConfigured, hero = false }: { sub2ApiConfigured: boolean; hero?: boolean }) {
  return (
    <div className={`signal-path ${hero ? "is-hero" : ""}`} aria-label="授权信号路径">
      <span className="signal-node is-source is-live">
        <i className="dot" /> Claude OAuth
      </span>
      <span className="signal-arrow">▶</span>
      <span className={`signal-node ${sub2ApiConfigured ? "is-live" : ""}`}>
        <i className="dot" /> Sub2API 代理
      </span>
      <span className="signal-arrow">▶</span>
      <span className="signal-node">
        <i className="dot" /> 目标平台
      </span>
    </div>
  );
}

function Overview(props: DashboardShellProps & { onJump: (id: SectionId) => void }) {
  const { role, roleLabel, sub2ApiConfigured, superadminConfigured, onJump } = props;

  return (
    <section className="overview" aria-labelledby="overview-title">
      <div className="overview-hero">
        <p className="eyebrow">CCMax provisioning bridge</p>
        <h2 id="overview-title">把已授权的 Claude 账号接入你的账号池</h2>
        <p>
          一条链路：Claude 官方 OAuth 由 Sub2API 代理换取凭据，再写入你选定的目标平台。
          凭据只在服务端流转，浏览器只接收状态摘要。
        </p>
        <SignalPath sub2ApiConfigured={sub2ApiConfigured} hero />
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <p className="k">超级管理员</p>
          <p className="v">
            <span className={`dot ${superadminConfigured ? "ok" : "bad"}`} />
            {superadminConfigured ? "已配置" : "未配置"}
          </p>
        </div>
        <div className="stat-card">
          <p className="k">Sub2API 代理</p>
          <p className="v">
            <span className={`dot ${sub2ApiConfigured ? "ok" : "warn"}`} />
            {sub2ApiConfigured ? "已就绪" : "待配置"}
          </p>
        </div>
        <div className="stat-card">
          <p className="k">当前身份</p>
          <p className="v">
            <span className="dot ok" />
            {roleLabel}
          </p>
        </div>
      </div>

      <div className="quick-grid">
        <button type="button" className="quick-card" onClick={() => onJump("provisioning")}>
          <span className="qk">01 / 上号</span>
          <strong>授权上号</strong>
          <span>选目标平台，生成授权槽位，完成官方授权后提交回执入池。</span>
        </button>
        {props.canViewAccountPool ? (
          <button type="button" className="quick-card" onClick={() => onJump("pool")}>
            <span className="qk">02 / 账号池</span>
            <strong>账号池统揽</strong>
            <span>查看已入池账号的调度、额度、并发与掉权状态。</span>
          </button>
        ) : null}
        {role === "superadmin" ? (
          <button type="button" className="quick-card" onClick={() => onJump("backends")}>
            <span className="qk">03 / 平台</span>
            <strong>多平台后端</strong>
            <span>配置 Sub2API / new-api / one-api，或添加多个自建网关。</span>
          </button>
        ) : null}
        {role !== "user" ? (
          <button type="button" className="quick-card" onClick={() => onJump("access")}>
            <span className="qk">04 / 权限</span>
            <strong>账号与权限</strong>
            <span>创建本地账号、调整系统开关与访问权限。</span>
          </button>
        ) : null}
        {role === "superadmin" ? (
          <button type="button" className="quick-card" onClick={() => onJump("logs")}>
            <span className="qk">05 / 日志</span>
            <strong>系统日志</strong>
            <span>登录、账号变更、系统开关与后端配置的操作审计留痕。</span>
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
