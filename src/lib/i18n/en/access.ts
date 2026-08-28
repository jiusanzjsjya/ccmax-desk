/** English strings for the access area. Populated during component conversion. */
export const access: Record<string, string> = {
  // Heading
  "权限控制台": "Access console",
  "账号与权限": "Accounts & Access",

  // Create-account form
  "创建本地账号": "Create local account",
  "账号用于登录本台，不会创建或修改 Claude 账号。":
    "Accounts sign in to this console only; they don't create or modify Claude accounts.",
  "登录名": "Username",
  "例如：ops-user": "e.g. ops-user",
  "显示名称": "Display name",
  "例如：运营一组": "e.g. Ops Team 1",
  "角色": "Role",
  "初始密码": "Initial password",
  "至少 10 位": "At least 10 characters",
  "保存中...": "Saving...",
  "创建账号": "Create account",
  "创建普通用户": "Create regular user",

  // System switches
  "系统开关": "System switches",
  "只有超级管理员可以修改全局权限边界。":
    "Only a superadmin can change the global permission boundaries.",
  "允许 Claude 上号流程": "Allow the Claude onboarding flow",
  "允许管理员创建普通用户": "Allow admins to create regular users",
  "允许普通用户上号": "Allow regular users to onboard accounts",
  "管理员查看账号池": "Admins can view the account pool",
  "普通用户查看账号池": "Regular users can view the account pool",
  "普通用户仅见本人上号的账号": "Regular users see only accounts they onboarded",
  "启用数据分析结算模块": "Enable the Analytics settlement module",
  "允许普通用户使用自建代理": "Allow regular users to use custom proxies",
  "允许普通用户选择目标平台": "Allow regular users to choose the target platform",
  "允许普通用户结算台账记账": "Allow regular users to write to the settlement ledger",

  // Local account list
  "本地账号": "Local accounts",
  "密码只保存为不可逆哈希，列表不会返回密码。":
    "Passwords are stored only as irreversible hashes; the list never returns passwords.",
  "读取中...": "Loading...",
  "刷新列表": "Refresh list",
  "创建于 {date}": "created {date}",
  "{name} 角色": "{name} role",
  "已停用": "Disabled",
  "正常": "Active",
  "重置密码": "Reset password",
  "还没有本地账号。先创建一个管理员或普通用户。":
    "No local accounts yet. Create an admin or regular user first.",

  // Status / error messages
  "无法读取本地账号管理数据。": "Couldn't load local account management data.",
  "账号 {name} 已创建。": "Account {name} created.",
  "创建账号失败，请检查本地服务状态。":
    "Failed to create account; check the local service status.",
  "账号 {name} 的权限状态已更新。": "Access status for account {name} updated.",
  "更新账号失败，请检查本地服务状态。":
    "Failed to update account; check the local service status.",
  "确定删除本地账号 {name} 吗？这不会删除 Sub2API 账号。":
    "Delete local account {name}? This won't delete the Sub2API account.",
  "账号 {name} 已删除。": "Account {name} deleted.",
  "删除账号失败，请检查本地服务状态。":
    "Failed to delete account; check the local service status.",
  "为 {name} 设置新密码（至少 10 位）":
    "Set a new password for {name} (at least 10 characters)",
  "新密码至少需要 10 位。": "The new password must be at least 10 characters.",
  "账号 {name} 的密码已重置。": "Password for account {name} reset.",
  "重置密码失败，请检查本地服务状态。":
    "Failed to reset password; check the local service status.",
  "系统开关已保存。": "System switches saved.",
  "保存系统开关失败。": "Failed to save system switches.",

  // readManagementError()
  "管理员会话已失效，请重新登录。":
    "Your admin session has expired; please sign in again.",
  "当前角色或系统开关不允许执行此操作。":
    "Your role or the system switches don't allow this action.",
  "该登录名已存在，请换一个。": "That username already exists; pick another.",
  "账号管理请求失败。": "Account management request failed.",
};
