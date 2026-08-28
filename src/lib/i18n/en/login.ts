/** English strings for the login desk (page copy, form, logout). */
export const login: Record<string, string> = {
  // Story
  "授权，": "Authorize,",
  "接入，": "connect,",
  "开始。": "go.",
  "为获得授权的 Claude Code Max 账号准备的 Sub2API 管理接入台。授权码和账号凭据只在服务端流转。":
    "A Sub2API management desk for authorized Claude Code Max accounts. Auth codes and credentials stay server-side.",

  // Form card
  "受保护入口": "Protected entrance",
  "登录": "Sign in",
  "使用账号密码登录，进入 Claude 授权工作台。": "Sign in with your username and password to enter the Claude authorization workspace.",

  // Fields
  "登录名": "Username",
  "密码": "Password",
  "账号密码": "Account password",
  "正在验证...": "Verifying…",

  // Microcopy
  "账号尚未配置：在 .env.local 设置 SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD。":
    "No account configured yet: set SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD in .env.local.",
  "账号密码只在本项目服务端校验，不会发送给 Sub2API。":
    "Credentials are verified only by this project's server and are never sent to Sub2API.",

  // Errors
  "账号尚未配置，请在 .env.local 设置 SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD。":
    "No account configured yet — set SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD in .env.local.",
  "登录名或密码不正确，或账号已停用。": "Incorrect username or password, or the account is disabled.",
  "无法连接登录服务，请检查本地服务状态。": "Could not reach the login service — check that the local server is running.",

  // Logout
  "正在退出...": "Signing out…",
  "退出当前会话": "Sign out",
};
