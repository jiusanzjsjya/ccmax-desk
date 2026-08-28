/** English strings for the system logs area (audit trail). */
export const logs: Record<string, string> = {
  // Action labels
  "超管登录": "Superadmin login",
  "账号登录": "Account login",
  "创建账号": "Create account",
  "修改账号": "Update account",
  "删除账号": "Delete account",
  "重置密码": "Reset password",
  "系统开关变更": "System switch change",
  "后端配置变更": "Backend config change",

  // Category + filter labels
  "登录": "Login",
  "账号": "Account",
  "系统": "System",
  "后端配置": "Backend config",
  "其他": "Other",
  "全部": "All",

  // Heading + help
  "操作审计": "Audit trail",
  "系统日志": "System logs",
  "仅记录本系统自身的操作留痕：登录、账号变更、系统开关与后端配置。不含 Sub2API 或各网关平台的运行日志，也不含密码或 OAuth 令牌。仅保留最近 100 条。":
    "Records only this system's own actions: sign-ins, account changes, system switches, and backend config. It excludes Sub2API and gateway-platform runtime logs, and never stores passwords or OAuth tokens. Only the latest 100 entries are kept.",
  "读取中...": "Loading…",
  "刷新": "Refresh",

  // Toolbar
  "按类别筛选": "Filter by category",
  "搜索操作人 / 动作 / 详情": "Search actor / action / details",
  "搜索日志": "Search logs",

  // Errors + empty states
  "只有超级管理员可以查看系统日志。": "Only the superadmin can view system logs.",
  "读取系统日志失败。": "Failed to load system logs.",
  "无法读取系统日志。": "Could not read system logs.",
  "没有符合条件的日志。": "No logs match your filter.",
  "暂无系统日志。": "No system logs yet.",

  // Relative time
  "刚刚": "just now",
  "{n} 分钟前": "{n} min ago",
  "{n} 小时前": "{n} h ago",
  "{n} 天前": "{n} d ago",
};
