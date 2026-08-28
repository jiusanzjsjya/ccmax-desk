/**
 * English translations, keyed by the Chinese source string (Chinese is the
 * source of truth). Split per component/domain so each module stays small and
 * independently editable; merged here into one lookup table.
 *
 * Shared glossary — keep these consistent across modules:
 *   控制台 → Console            授权上号 → Onboarding        账号池 → Account Pool
 *   多平台后端 → Backends        账号与权限 → Accounts & Access  系统日志 → System Logs
 *   数据分析 → Analytics         结算 → Settlement            预付 → Prepay
 *   代理 → Proxy                目标平台 → Target platform     台账 → Ledger
 *   超级管理员 → Superadmin      管理员 → Admin               普通用户 → User
 *   槽位 → Slot                 回执 → Receipt / Auth code    入池 → Add to pool
 */
import { common } from "./common";
import { shell } from "./shell";
import { login } from "./login";
import { provisioning } from "./provisioning";
import { pool } from "./pool";
import { poolOps } from "./pool-ops";
import { backends } from "./backends";
import { access } from "./access";
import { logs } from "./logs";
import { settlement } from "./settlement";
import { errors } from "./errors";

export const en: Record<string, string> = {
  ...common,
  ...shell,
  ...login,
  ...provisioning,
  ...pool,
  ...poolOps,
  ...backends,
  ...access,
  ...logs,
  ...settlement,
  ...errors,
};
