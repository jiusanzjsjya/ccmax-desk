/** English strings for the dashboard shell (rail nav, topbar, overview). */
export const shell: Record<string, string> = {
  // Rail
  "模块": "Modules",
  "控制台模块": "Console modules",

  // Theme toggle
  "配色主题": "Color theme",
  "浅色": "Light",
  "深色": "Dark",
  "系统": "System",

  // Nav — labels / hints / subtitles
  "总览": "Overview",
  "信号路径与状态": "Signal path & status",
  "授权链路与接入状态一览": "Authorization chain and connectivity at a glance",

  "授权上号": "Onboarding",
  "生成槽位 · 授权 · 入池": "Create slot · authorize · add to pool",
  "生成授权槽位、完成官方授权、提交回执入池": "Create an authorization slot, complete official OAuth, submit the receipt to the pool",

  "授权上key": "Key Upload",
  "OpenAI · API key · 入池": "OpenAI · API key · to pool",
  "提交 OpenAI API key，直接入池到 Sub2API（无需官方授权换取）":
    "Submit an OpenAI API key straight into the Sub2API pool (no OAuth exchange needed)",

  "账号池统揽": "Account pool",
  "调度 · 健康 · 掉权": "Scheduling · health · deauthorization",
  "OAuth 账号调度与健康 · 额度、并发、掉权状态": "OAuth account scheduling and health · quota, concurrency, deauthorization",

  "Key 使用额度": "Key Usage",
  "OpenAI · 用量 · 死活": "OpenAI · usage · liveness",
  "实时显示自己 OpenAI Key 在 Sub2API 上的用量与是否死 Key":
    "Real-time usage and dead-key status of your OpenAI keys on Sub2API",

  "多平台后端": "Backends",
  "目标平台与网关": "Target platforms & gateways",
  "统一配置 Sub2API、new-api、one-api 与自建网关": "Configure Sub2API, new-api, one-api and custom gateways in one place",

  "账号与权限": "Accounts & Access",
  "账号 · 系统开关": "Accounts · system switches",
  "本地账号与系统开关": "Local accounts and system switches",

  "系统日志": "System Logs",
  "操作审计 · 留痕": "Operation audit · trail",
  "登录、账号、系统开关与后端配置的操作审计": "Audit trail for logins, accounts, system switches and backend config",

  "数据分析": "Analytics",
  "用量金额 · 结算台账": "Usage cost · settlement ledger",
  "数据分析 · 预付结款": "Analytics · Prepay & Settlement",
  "按用户统计真实用量金额，记录结算与预付台账（仅记录，不接支付）":
    "Per-user real usage cost, with a settlement and prepay ledger (records only, no payment integration)",

  // Signal path
  "授权信号路径": "Authorization signal path",
  "Sub2API 代理": "Sub2API proxy",

  // Overview hero
  "CCMax provisioning bridge": "CCMax provisioning bridge",
  "把已授权的 Claude 账号接入你的账号池": "Bring authorized Claude accounts into your pool",
  "一条链路：Claude 官方 OAuth 由 Sub2API 代理换取凭据，再写入你选定的目标平台。凭据只在服务端流转，浏览器只接收状态摘要。":
    "One chain: Claude's official OAuth is exchanged for credentials via the Sub2API proxy, then written to your chosen target platform. Credentials stay server-side; the browser only receives status summaries.",

  // Overview stat cards
  "待配置": "Pending setup",

  // Quick cards
  "01 / 上号": "01 / Onboard",
  "01 / 上key": "01 / Key",
  "选目标平台，生成授权槽位，完成官方授权后提交回执入池。":
    "Pick a target platform, create a slot, then submit the receipt after official OAuth.",
  "02 / 账号池": "02 / Pool",
  "查看已入池账号的调度、额度、并发与掉权状态。":
    "View scheduling, quota, concurrency and deauthorization of pooled accounts.",
  "03 / 平台": "03 / Platform",
  "配置 Sub2API / new-api / one-api，或添加多个自建网关。":
    "Configure Sub2API / new-api / one-api, or add multiple custom gateways.",
  "04 / 权限": "04 / Access",
  "创建本地账号、调整系统开关与访问权限。": "Create local accounts and adjust system switches and access.",
  "05 / 日志": "05 / Logs",
  "登录、账号变更、系统开关与后端配置的操作审计留痕。":
    "Audit trail for logins, account changes, system switches and backend config.",
};
