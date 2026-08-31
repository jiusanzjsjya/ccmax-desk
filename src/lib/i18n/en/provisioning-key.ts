/** English strings for the 授权上key (OpenAI API-key upload) module. */
export const provisioningKey: Record<string, string> = {
  // Panel
  "OpenAI · API key": "OpenAI · API key",
  "提交 Key": "Submit Keys",
  "每行一条 Key；以 # 开头的行视为注释。单次最多提交 {n} 条 Key。":
    "One Key per line; lines starting with # are comments. Up to {n} Keys per submission.",
  "仅上传 OpenAI Key；Base URL 固定为官方地址。账号自动命名为 你的账号名-日期-序号（当天顺延）。":
    "OpenAI keys only; Base URL is fixed to the official API. Accounts are auto-named <your-name>-<date>-<NN> (the day's sequence continues).",
  "Keys": "Keys",
  "上传中...": "Uploading...",
  "提交并上传": "Submit & upload",

  // Results + validation
  "请至少粘贴一条 Key。": "Paste at least one Key.",
  "单次最多提交 {n} 条 Key。": "Up to {n} Keys per submission.",
  "没有格式正确的 Key（应为 sk- 开头的 OpenAI Key）。": "No well-formed Keys (must be an OpenAI key starting with sk-).",
  "成功 {ok} / {total} 条，其中疑似死 Key {dead} 条。": "{ok} / {total} succeeded, {dead} likely dead.",
  "上传失败，请稍后再试。": "Upload failed, please try again.",
  "未获授权上key权限，请联系超级管理员开通。": "Not authorized for Key Upload; contact the superadmin to enable it.",

  // Key usage module
  "OpenAI · 实时用量": "OpenAI · live usage",
  "Key 使用额度": "Key Usage",
  "Key 统计": "Key stats",
  "总数": "Total",
  "死 Key": "Dead",
  "刷新": "Refresh",
  "未命名 Key": "Unnamed Key",
  "今日花费": "Today cost",
  "今日请求": "Today requests",
  "近30天花费": "30-day cost",
  "暂无 OpenAI Key。到「授权上key」上传后，这里会实时显示用量与死活状态。":
    "No OpenAI keys yet. After uploading via Key Upload, usage and liveness show here in real time.",
  "读取 Key 使用额度失败。": "Failed to read key usage.",
  "监控已禁用": "Auto-disabled",

  // Account-management module grants
  "授权模块": "Modules",
  "授权上key": "Key Upload",
  "未勾选的模块默认不可用；管理员创建的用户会继承管理员的模块。":
    "Unchecked modules are unavailable by default; an admin's new users inherit the admin's modules.",
  "{name} {module}": "{name} {module}",
};
