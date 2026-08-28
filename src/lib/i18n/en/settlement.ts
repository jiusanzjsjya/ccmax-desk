/** English strings for the settlement area (Analytics / prepaid settlement ledger). */
export const settlement: Record<string, string> = {
  // Load / fetch errors
  "该模块已被超级管理员关闭。": "This module has been turned off by the superadmin.",
  "读取结算数据失败。": "Failed to load settlement data.",
  "无法连接服务，请稍后重试。": "Could not reach the service — please try again later.",

  // Head + tabs
  "结算视图": "Settlement views",
  "数据分析": "Analytics",
  "预付结款报表": "Prepaid settlement report",
  "刷新中…": "Refreshing…",
  "刷新": "Refresh",
  "新建台账": "New entry",

  // Ledes + hints
  "按用户统计名下账号的真实用量金额（近 30 天成本换算）、账号数与请求数。":
    "Per-user real usage amounts across owned accounts (converted from the last 30 days' cost), plus account and request counts.",
  "结算用于支付已产生的收益；预付会先抵扣待结算金额，剩余部分自动转为预付余额。数字仅为台账记录，不接真实支付接口。":
    "Settlement pays out accrued earnings; a prepay first offsets pending amounts, and any remainder becomes prepay balance. The figures are ledger records only — no real payment integration.",
  "Sub2API 未配置或暂无用量数据，用量金额显示为 US$0.00；台账记录不受影响。":
    "Sub2API is not configured or has no usage data, so usage amounts show as US$0.00; ledger records are unaffected.",
  "加载中…": "Loading…",

  // Drawer
  "关闭": "Close",
  "台账类型": "Entry type",
  "结算": "Settlement",
  "支付已经产生的收益": "Pay out earnings already accrued",
  "预付": "Prepay",
  "提前充值并抵扣后续收益": "Top up in advance and offset future earnings",
  "用户": "User",
  "累计收益": "Accrued",
  "待结算": "Pending",
  "预付余额": "Prepay balance",
  "本次预付入账金额（USD）": "This prepay amount (USD)",
  "本次结算入账金额（USD）": "This settlement amount (USD)",
  "实际付款金额": "Actual payment amount",
  "可选": "Optional",
  "付款币种": "Payment currency",
  "备注（可选）": "Note (optional)",
  "例如：8 月第 2 批结算、转账流水号等": "e.g. August batch 2 settlement, transfer reference no., etc.",
  "本次预付入账 {amount}": "Prepay entry of {amount}",
  "本次结算入账 {amount}": "Settlement entry of {amount}",
  "记账后待结算 {amount}": "Pending after entry: {amount}",
  "待结算已结清，预付余额 {amount}": "Pending cleared; prepay balance {amount}",
  "待结算已结清": "Pending cleared",
  "取消": "Cancel",
  "提交中…": "Submitting…",
  "记一笔": "Add entry",

  // Form validation
  "请选择用户。": "Please select a user.",
  "请输入大于 0 的入账金额。": "Enter an amount greater than 0.",
  "实际付款金额无效。": "The actual payment amount is invalid.",
  "提交失败，请稍后重试。": "Submission failed — please try again later.",
  "没有权限为该用户记账。": "You don't have permission to book entries for this user.",
  "用户不存在。": "The user does not exist.",
  "填写内容有误，请检查金额。": "Some fields are invalid — please check the amount.",

  // Analytics view
  "今日用量": "Today's usage",
  "30 天请求": "30-day requests",
  "账号数": "Accounts",
  "用户数": "Users",
  "近 30 天用量换算": "Last-30-day usage",
  "当日成本": "Today's cost",
  "累计请求数": "Total requests",
  "名下账号": "Owned accounts",
  "可见范围": "Visible scope",
  "用量分析": "Usage analytics",
  "角色": "Role",
  "近 30 天用量": "Last 30-day usage",
  "暂无用户数据。": "No user data yet.",
  "已停用": "Disabled",
  "启用中": "Active",

  // Ledger view
  "累计入账": "Total booked",
  "{n} 笔记录": "{n} records",
  "尚未支付": "Not yet paid",
  "自动抵扣后续收益": "Auto-offsets future earnings",
  "用量换算金额": "Usage-based amount",
  "账号": "Accounts",
  "已结算": "Settled",
  "最近记账": "Last entry",
  "操作": "Actions",
  "收起": "Collapse",
  "明细({n})": "Details ({n})",
  "实付 {amount} {currency}": "Paid {amount} {currency}",
  "删除": "Delete",
};
