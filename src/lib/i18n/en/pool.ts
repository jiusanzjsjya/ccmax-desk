/** English strings for the pool area. Populated during component conversion. */
export const pool: Record<string, string> = {
  // Server-side sort options
  "添加时间 新到旧": "Added · newest first",
  "添加时间 旧到新": "Added · oldest first",
  "最近使用 新到旧": "Last used · newest first",
  "倍率 高到低": "Rate multiplier · high to low",
  "状态": "Status",
  "名称": "Name",

  // Client-side sort options
  "今日额度 高到低": "Today's quota · high to low",
  "今日额度 低到高": "Today's quota · low to high",
  "RPM 高到低": "RPM · high to low",
  "并发 高到低": "Concurrency · high to low",
  "今日请求 高到低": "Today's requests · high to low",

  // Status filter
  "全部": "All",
  "正常": "Normal",
  "掉权 / 错误": "Deauthorization / error",
  "已停用": "Disabled",

  // Errors
  "无法连接账号池服务，请检查本地服务状态。": "Cannot reach the account pool service. Check the local service status.",
  "当前角色不允许查看账号池。": "Your role is not allowed to view the account pool.",
  "Sub2API 尚未配置，请在「多平台后端」填写地址与管理令牌。": "Sub2API is not configured yet. Set the address and admin token under Backends.",
  "Sub2API 管理令牌无效或已过期，请更新 SUB2API_ADMIN_TOKEN。": "The Sub2API admin token is invalid or expired. Update SUB2API_ADMIN_TOKEN.",
  "读取账号池失败。": "Failed to read the account pool.",

  // Headings / empty states
  "账号池统揽": "Account pool",
  "已入池账号": "Pooled accounts",
  "账号池仅对 Sub2API 可用。请先在「多平台后端」配置并启用 Sub2API。": "The account pool is available for Sub2API only. Configure and enable Sub2API under Backends first.",
  "OAuth 账号调度与健康": "OAuth account scheduling and health",
  "仅显示本人上号的账号": "Showing only accounts you onboarded",
  "该平台账号池待接入，敬请期待。": "The account pool for this platform is not connected yet. Coming soon.",
  "没有匹配的账号。调整筛选或先在「授权上号」入池。": "No matching accounts. Adjust the filters, or add accounts under Onboarding first.",

  // Toolbar
  "平台": "Platform",
  "账号池视图": "Account pool view",
  "账号列表": "Account list",
  "运维告警": "Ops alerts",
  "自动刷新 15s": "Auto-refresh 15s",
  "刷新中...": "Refreshing...",
  "刷新": "Refresh",

  // Stat cards
  "可用账号": "Available accounts",
  "冷却中": "Cooling down",
  "本人 RPM": "My RPM",
  "全局 RPM": "Global RPM",
  "今日额度": "Today's quota",
  "今日请求": "Today's requests",
  "承载": "Capacity",

  // Filters
  "搜索账号名 / 邮箱，回车": "Search account name / email, press Enter",
  "搜索账号": "Search accounts",
  "分组": "Group",
  "全部分组": "All groups",
  "排序": "Sort",
  "服务端排序": "Server-side sort",
  "本页排序": "This-page sort",
  "每页": "Per page",
  "{size} 条": "{size} / page",
  "卡片": "Cards",
  "列表": "List",

  // Pagination
  "{start}-{end} / 共 {total}": "{start}-{end} / {total} total",
  "共 0": "0 total",
  "上一页": "Previous",
  "下一页": "Next",

  // Card
  "未命名账号": "Unnamed account",
  "添加 {date}": "Added {date}",
  "Fable5 无数据": "Fable5 no data",
  "Sonnet 无数据": "Sonnet no data",
  "并发": "Concurrency",
  "今日 {v}": "Today {v}",
  "${cost} · {req}次": "${cost} · {req} reqs",
  "倍率 ×{rate} · 最近 {date}": "Rate ×{rate} · last {date}",

  // List
  "账号": "Account",
  "订阅": "Subscription",
  "倍率": "Rate",
  "未命名": "Unnamed",

  // Usage window
  "无数据": "No data",
  " · {req}次": " · {req} reqs",
  "恢复 {duration}": "Resets in {duration}",

  // Health / cooldown
  "掉权": "Deauthorized",
  "过载至 {date}": "Overloaded until {date}",
  "限流至 {date}": "Rate-limited until {date}",
  "冷却至 {date}{reason}": "Cooling down until {date}{reason}",
};
