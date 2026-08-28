/** English strings for the provisioning area (Onboarding / authorization wizard). */
export const provisioning: Record<string, string> = {
  // Proxy test + custom proxy
  "检测中...": "Testing…",
  "代理检测失败。": "Proxy test failed.",
  "可用": "Available",
  "不可用": "Unavailable",
  "出口 {ip}": "Exit {ip}",
  "无法连接代理检测服务。": "Could not reach the proxy test service.",
  "创建自定义代理失败。": "Failed to create the custom proxy.",
  "已创建并选用代理：{name}": "Created and selected proxy: {name}",
  "无法连接代理创建服务。": "Could not reach the proxy creation service.",

  // Slot generation + submission
  "生成授权槽位失败。": "Failed to generate authorization slots.",
  "已生成 {n} 个槽位（部分请求失败）。请逐个完成官方登录后提交回执。":
    "Created {n} slots (some requests failed). Complete official login for each, then submit its receipt.",
  "已生成 {n} 个授权槽位。请在新标签完成官方登录，再回到这里逐个提交回执。":
    "Created {n} authorization slots. Complete official login in a new tab, then return here and submit each receipt.",
  "无法连接 Sub2API 接入服务。": "Could not reach the Sub2API onboarding service.",
  "已取消当前授权批次，待处理槽位已清空。": "Current authorization batch cancelled; pending slots cleared.",
  "槽位已过期，请重新生成。": "This slot has expired — please generate a new one.",
  "回执格式不正确，请粘贴完整的 code#state 或回调 URL。":
    "Invalid receipt format — paste the full code#state or callback URL.",
  "Claude 账号接入失败。": "Failed to onboard the Claude account.",
  "账号已入池": "Account added to pool",
  "已入池：{label}": "Added to pool: {label}",
  "读取已入池账号失败。": "Failed to load pooled accounts.",
  "账号列表已刷新。": "Account list refreshed.",
  "已清理完成和过期的槽位。": "Cleared finished and expired slots.",

  // Config guard
  "超级管理员账号未配置。": "The superadmin account is not configured.",
  " Sub2API（Claude 授权代理）尚未配置，请在超管后台填写。":
    " Sub2API (Claude authorization proxy) is not configured yet — set it up in the superadmin console.",

  // Tabs + summary
  "目标平台": "Target platform",
  "账号接入视图": "Account onboarding views",
  "授权向导": "Authorization wizard",
  "待处理槽位": "Pending slots",
  "已入池账号": "Pooled accounts",
  "账号统计": "Account stats",
  "存活": "Alive",
  "失效": "Dead",
  "待授权": "Awaiting auth",

  // Wizard
  "授权上号": "Onboarding",
  "准备 Claude Max 账号": "Prepare Claude Max accounts",
  "一次可生成 1–{max} 个授权槽位；打开官方链接登录授权后，把回执粘回对应槽位提交入池——全部在本页完成。备注与注册国家会应用到这一批账号。":
    "Generate 1–{max} authorization slots at once. Open the official link, sign in and authorize, then paste each receipt back into its slot to add it to the pool — all on this page. The note and registration country apply to this batch.",
  "生成槽位数（1–{max}）": "Number of slots (1–{max})",
  "批次备注（可选）": "Batch note (optional)",
  "例如 Allen-0826，不要填写 token": "e.g. Allen-0826 — do not paste a token",
  "注册国家": "Registration country",
  "搜索国家/地区，如 美国 或 US": "Search country/region, e.g. US",
  "搜索注册国家": "Search registration country",
  "出口代理（可选）": "Egress proxy (optional)",
  "默认（由 Sub2API 分配）": "Default (assigned by Sub2API)",
  "检测代理": "Test proxy",
  "正在生成...": "Generating…",
  "生成 {n} 个授权槽位": "Generate {n} authorization slots",
  "取消（清空 {n} 个待处理）": "Cancel (clear {n} pending)",
  "授权与回执": "Authorization & receipt",
  "完成授权并提交": "Complete authorization and submit",
  "逐个打开官方授权链接登录同意，把成功页的 code#state（或回调 URL）粘回对应槽位提交。每个槽位独立入池。":
    "Open each official authorization link, sign in and consent, then paste the success page's code#state (or callback URL) back into its slot and submit. Each slot is pooled independently.",
  "清理已完成（{n}）": "Clear finished ({n})",
  "生成槽位后，在此完成官方授权并提交回执入池。":
    "After generating slots, complete official authorization here and submit the receipts to the pool.",

  // Proxy parsing
  "请粘贴代理地址。": "Paste a proxy address.",
  "无法识别的协议头 {name}://。": "Unrecognized scheme {name}://.",
  "协议头 {name}:// 与所选「{tab}」不一致。": "Scheme {name}:// doesn't match the selected {tab}.",
  "认证部分应为 user:pass。": "The auth part should be user:pass.",
  "地址部分应为 host:port。": "The address part should be host:port.",
  "格式应为 host:port、host:port:user:pass 或 user:pass@host:port。":
    "Format should be host:port, host:port:user:pass, or user:pass@host:port.",
  "缺少主机地址。": "Missing host address.",
  "端口无效（1–65535）。": "Invalid port (1–65535).",
  "用户名不能为空（或整体省略认证）。": "Username cannot be empty (or omit auth entirely).",

  // Custom proxy form
  "1.2.3.4:8080  或  user:pass@1.2.3.4:8080": "1.2.3.4:8080  or  user:pass@1.2.3.4:8080",
  "1.2.3.4:1080  或  user:pass@1.2.3.4:1080": "1.2.3.4:1080  or  user:pass@1.2.3.4:1080",
  "代理协议": "Proxy protocol",
  "粘贴 {label} 代理": "Paste {label} proxy",
  "{label} 代理地址": "{label} proxy address",
  "认证 {user}": "auth {user}",
  "无认证": "no auth",
  "选项卡锁定协议，支持 host:port、host:port:user:pass、user:pass@host:port。":
    "The tab locks the protocol; supports host:port, host:port:user:pass, user:pass@host:port.",
  "名称（可选）": "Name (optional)",
  "名称": "Name",
  "创建中...": "Creating…",
  "创建并选用": "Create and use",
  "收起": "Collapse",
  "＋ 添加自定义代理": "＋ Add custom proxy",

  // Slot cards
  "槽位 #{n} · {id}": "Slot #{n} · {id}",
  "① 官方授权链接": "① Official authorization link",
  "官方授权链接": "Official authorization link",
  "打开官方授权页 ↗": "Open official authorization page ↗",
  "复制链接": "Copy link",
  "② 授权回执（code#state 或回调 URL）": "② Authorization receipt (code#state or callback URL)",
  "粘贴完整的 code#state 或回调 URL": "Paste the full code#state or callback URL",
  "正在兑换并入池...": "Exchanging and adding to pool…",
  "提交回执并创建账号": "Submit receipt and create account",
  "已完成": "Done",
  "已过期": "Expired",
  "剩余 {time}": "{time} left",

  // Pending view
  "授权槽位": "Authorization slots",
  "新建槽位": "New slot",
  "去提交回执": "Go submit receipts",
  "当前没有待处理槽位。": "No pending slots right now.",

  // Accounts view
  "刷新中...": "Refreshing…",
  "刷新列表": "Refresh list",
  "账号池": "Account pool",
  "未命名账号": "Unnamed account",
  "暂无已入池账号。完成一次授权后，账号会显示在这里。":
    "No pooled accounts yet. Once you complete an authorization, accounts appear here.",

  // API error branches
  "管理员会话已失效，请重新登录。": "Your admin session has expired — please sign in again.",
  "待处理槽位过多，请先完成或清理已有槽位。": "Too many pending slots — finish or clear existing ones first.",
  "Sub2API 管理令牌无效或权限不足，请更新 SUB2API_ADMIN_TOKEN。":
    "The Sub2API admin token is invalid or lacks permission — update SUB2API_ADMIN_TOKEN.",
  "超级管理员已暂停普通用户上号，请联系管理员。":
    "The superadmin has paused onboarding for regular users — contact an administrator.",
  "当前角色或系统开关不允许执行此操作。": "Your role or a system switch doesn't allow this action.",
  "授权槽位已过期，请重新生成。": "The authorization slot has expired — please generate a new one.",
  "超级管理员已暂停 Claude 上号流程。": "The superadmin has paused the Claude onboarding flow.",
  "目标后端尚未配置，请检查对应环境变量。": "The target backend is not configured — check the matching environment variables.",
  "服务尚未配置完成，请检查 .env.local。": "The service is not fully configured — check .env.local.",
};
