/** English strings for the pool-ops area. Populated during component conversion. */
export const poolOps: Record<string, string> = {
  // Empty / gating states
  "账号池仅对 Sub2API 可用。请先在「多平台后端」配置并启用 Sub2API。":
    "The account pool is only available for Sub2API. Configure and enable Sub2API under “Backends” first.",
  "该平台账号池待接入，敬请期待。": "The account pool for this platform is not connected yet — stay tuned.",

  // Scan summary
  "本人账号 {n} 个": "{n} of your accounts",
  "已扫描前 {n} 个账号（池内更多）": "Scanned the first {n} accounts (more in the pool)",
  "已扫描 {n} 个账号": "Scanned {n} accounts",

  // Ops bar
  "自动刷新 15s": "Auto-refresh 15s",
  "扫描中...": "Scanning...",

  // Stat cards
  "可用账号": "Available accounts",
  "冷却中": "Cooling down",
  "掉权": "Deauthorization",
  "实时并发": "Live concurrency",
  "本人 RPM": "My RPM",
  "全局 RPM": "Global RPM",
  "全局 TPM": "Global TPM",
  "承载": "Capacity",
  "当前告警": "Active alerts",

  // Alert rules
  "告警规则": "Alert rules",
  "重置默认": "Reset to default",
  "掉权 / 报错": "Deauthorized / error",
  "账号返回错误或已被封禁": "Account returned an error or has been banned",
  "限流冷却": "Rate-limit cooldown",
  "过载 / 限流 / 临时不可调度": "Overloaded / rate-limited / temporarily unschedulable",
  "额度接近上限": "Quota near limit",
  "窗口花费占额度比例": "Window spend as a share of quota",
  "RPM 接近上限": "RPM near limit",
  "当前 RPM 占基准比例": "Current RPM as a share of baseline",
  "已停用 / 不可调度": "Disabled / unschedulable",
  "被手动停用或标记为不可调度": "Manually disabled or marked unschedulable",
  "阈值 {n}%": "Threshold {n}%",

  // Feed
  "无触发告警 — 已扫描账号均在阈值内。": "No alerts triggered — all scanned accounts are within thresholds.",
  "未命名账号": "Unnamed account",
  "最近 {d}": "Last used {d}",

  // Alert tags
  "冷却": "Cooldown",
  "额度": "Quota",
  "停用": "Disabled",

  // Alert details
  "账号返回错误或已被封禁，需人工介入。": "Account returned an error or has been banned — manual intervention required.",
  "账号处于限流冷却中。": "Account is in rate-limit cooldown.",
  "窗口额度 ${cur} / ${lim}（{pct}% ≥ {th}%）": "Window quota ${cur} / ${lim} ({pct}% ≥ {th}%)",
  "RPM {cur} / {base}（{pct}% ≥ {th}%）": "RPM {cur} / {base} ({pct}% ≥ {th}%)",
  "账号被标记为不可调度。": "Account is marked as unschedulable.",
  "账号已停用。": "Account is disabled.",
  "过载至 {d}": "Overloaded until {d}",
  "限流至 {d}": "Rate-limited until {d}",
  "冷却至 {d}": "Cooling down until {d}",

  // Error / connection messages
  "无法连接账号池服务，请检查本地服务状态。":
    "Cannot reach the account pool service — check the local service status.",
  "当前角色不允许查看账号池。": "Your role is not allowed to view the account pool.",
  "Sub2API 尚未配置，请在「多平台后端」填写地址与管理令牌。":
    "Sub2API is not configured yet — set the address and admin token under “Backends”.",
  "读取账号池运维数据失败。": "Failed to read account pool operations data.",
};
