/** English strings for the backends area. Populated during component conversion. */
export const backends: Record<string, string> = {
  // Panel heading
  "多平台后端": "Backends",
  "上号目标平台配置": "Onboarding target platform configuration",
  "读取中...": "Loading...",
  "正在读取后端配置...": "Loading backend configuration...",
  "暂无后端配置。": "No backend configuration yet.",

  // Default platform & enable scope
  "默认平台与启用范围": "Default platform & enable scope",
  "默认平台用于向导未选择时；启用的平台会出现在授权向导顶部的目标平台里。":
    "The default platform is used when the wizard makes no selection; enabled platforms appear as target platforms at the top of the authorization wizard.",
  "默认平台": "Default platform",
  "启用 {label}": "Enable {label}",
  "（未配置）": " (not configured)",

  // Platform cards
  "Sub2API（同时也是 Claude OAuth 代理）": "Sub2API (also the Claude OAuth proxy)",
  "地址 Base URL": "Base URL",
  "管理令牌": "Admin token",
  "默认代理 ID（可选）": "Default proxy ID (optional)",
  "留空由 Sub2API 分配": "Leave blank to let Sub2API assign",
  "管理令牌（创建渠道用）": "Admin token (for creating channels)",
  "Anthropic API Key（sk-ant-，写入渠道）": "Anthropic API key (sk-ant-, written to the channel)",
  "New-Api-User（用户 ID，可选）": "New-Api-User (user ID, optional)",
  "例如 1": "e.g. 1",
  "渠道类型 / 模型": "Channel type / models",

  // Custom gateways
  "自建网关（可多个）": "Custom gateways (multiple allowed)",
  "每个网关独立配置与启用，会作为独立目标平台出现在向导里。":
    "Each gateway is configured and enabled independently, and appears as its own target platform in the wizard.",
  "+ 添加自建网关": "+ Add custom gateway",
  "自建网关": "Custom gateway",
  "名称": "Name",
  "例如 网关-A": "e.g. Gateway-A",
  "创建账号 URL": "Create account URL",
  "令牌（可选）": "Token (optional)",
  "账号列表 URL（可选）": "Account list URL (optional)",
  "留空则不展示账号池": "Leave blank to hide the account pool",
  "启用该网关": "Enable this gateway",
  "移除该网关": "Remove this gateway",
  "还没有自建网关，点「添加自建网关」新增。": "No custom gateways yet. Click \"Add custom gateway\" to create one.",

  // Save action
  "保存中...": "Saving...",
  "保存后端配置": "Save backend configuration",

  // Token input placeholders
  "已配置，留空不修改": "Configured. Leave blank to keep unchanged.",
  "尚未配置": "Not configured yet",

  // Status / error messages
  "读取后端配置失败。": "Failed to read backend configuration.",
  "无法读取后端配置。": "Unable to read backend configuration.",
  "只有超级管理员可以修改后端配置。": "Only a superadmin can modify backend configuration.",
  "保存后端配置失败。": "Failed to save backend configuration.",
  "后端配置已保存。": "Backend configuration saved.",
};
