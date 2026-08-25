export const roleValues = ["superadmin", "admin", "user"] as const;

export type Role = (typeof roleValues)[number];

export type Permission =
  | "manage_users"
  | "create_users"
  | "manage_settings"
  | "use_provisioning"
  | "view_account_pool"
  | "view_audit";

export function roleLabel(role: Role) {
  if (role === "superadmin") return "超级管理员";
  if (role === "admin") return "管理员";
  return "普通用户";
}

export function hasPermission(role: Role, permission: Permission) {
  if (role === "superadmin") return true;
  if (role === "admin") {
    return ["create_users", "use_provisioning", "view_account_pool"].includes(permission);
  }

  return permission === "use_provisioning";
}
