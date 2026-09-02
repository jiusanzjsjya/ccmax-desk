# Claude Code Max 接入 Sub2API 的登录验证台

## 1. 项目定位

本项目用于为已获得授权的 Claude Code Max 订阅账号提供一个独立的 Web 接入入口，并将账号安全地接入 [Sub2API](https://github.com/Wei-Shaw/sub2api) 的账号管理与调度体系。

这里的 CCMax 指 **Claude Code Max 订阅**，不是一个独立的 OAuth 身份平台。Sub2API 也不是本项目的 OAuth 身份提供方，而是目标网关和账号池系统。

本项目的正确定位是：

```text
本项目 Web 端
  -> 服务端调用 Sub2API 管理接口
  -> Sub2API 发起/完成 Claude OAuth
  -> Sub2API 创建 Anthropic OAuth 账号
  -> Sub2API 通过 Claude Code 兼容网关提供服务
```

本项目不应保存 Claude 密码，不应把 refresh token 暴露给浏览器，也不应实现绕过 Anthropic 授权、批量收集第三方账号或规避官方订阅限制的功能。实际部署必须遵守 Anthropic、Claude Code 和 Sub2API 的适用条款，并且只处理账号所有者明确授权的账号。

## 2. Sub2API 源码结论

本 README 的流程依据 Sub2API 仓库在 2026-08-24 检出的提交 `03e8ab41346b42de9ece4e3e5bfcb6ca2b8cb57e`（版本 `0.1.180`）整理。Sub2API 后续升级可能调整 OAuth 参数、路由或账号凭据格式，升级时需要重新核对源码。

重点源码位置：

- Claude OAuth 常量和 PKCE 工具：`backend/internal/pkg/oauth/oauth.go`
- Claude OAuth 网络请求：`backend/internal/repository/claude_oauth_service.go`
- OAuth 状态、授权码兑换和 Cookie 自动授权：`backend/internal/service/oauth_service.go`
- 管理端 OAuth 路由：`backend/internal/server/routes/admin.go`
- Claude Code 请求识别：`backend/internal/service/claude_code_validator.go`
- Claude OAuth token 刷新：`backend/internal/service/claude_token_provider.go`
- 管理端添加账号页面：`frontend/src/components/account/CreateAccountModal.vue`
- OAuth 交互组件：`frontend/src/components/account/OAuthAuthorizationFlow.vue`

## 3. Sub2API 中的账号模型

Sub2API 将 Claude 账号保存为一个账号池条目，而不是创建一个普通的“本地用户”：

| 字段 | Claude Code Max 接入中的含义 |
| --- | --- |
| `platform` | 固定为 `anthropic` |
| `type` | 完整 Claude OAuth 使用 `oauth`；仅推理用途的 Setup Token 使用 `setup-token` |
| `credentials` | OAuth token、过期时间、scope 等敏感凭据，必须只在服务端处理 |
| `extra` | `org_uuid`、`account_uuid`、`email_address` 等账号元信息 |
| `proxy_id` | 可选的 Sub2API 出口代理，用于授权和上游访问 |
| `group_ids` | 将账号加入指定分组，供订阅、权限和调度使用 |
| `status` | 账号是否可用、错误或暂停 |

账号创建的逻辑数据大致如下。真实 token 不得写入 README、前端代码、日志或错误响应：

```json
{
  "name": "Claude Code Max account",
  "platform": "anthropic",
  "type": "oauth",
  "credentials": {
    "access_token": "由 Sub2API 服务端兑换得到",
    "token_type": "Bearer",
    "expires_in": 3600,
    "expires_at": 0,
    "refresh_token": "由 Sub2API 加密保存"
  },
  "extra": {
    "org_uuid": "Claude 组织 UUID",
    "account_uuid": "Claude 账号 UUID",
    "email_address": "账号邮箱"
  },
  "group_ids": []
}
```

## 4. Claude OAuth 的实际流程

Sub2API 使用 **Authorization Code + PKCE**，并不是通用的 `userinfo_endpoint` 模式。它的 Claude OAuth 客户端参数在 Sub2API 源码中固定维护。

### 4.1 手动授权模式

这是最适合本项目第一阶段接入的方式：浏览器只负责登录和授权，token 兑换与账号创建全部由服务端完成。

```text
1. 已认证的 Sub2API 管理员在本项目发起“添加 Claude 账号”
2. 本项目服务端调用 Sub2API 管理接口生成授权 URL
3. Sub2API 生成 state、PKCE code_verifier、code_challenge 和 session_id
4. 用户在浏览器打开授权 URL，登录自己的 Claude 账号并授权
5. Claude 授权页面显示授权码
6. 用户将授权码交回本项目
7. 本项目服务端把 session_id 和授权码提交给 Sub2API
8. Sub2API 使用 code_verifier 向 Claude token endpoint 兑换 token
9. 本项目服务端调用 Sub2API 创建 anthropic/oauth 账号
10. Sub2API 返回账号状态，本项目只显示脱敏后的结果
```

Sub2API 当前源码中的关键参数为：

| 参数 | 当前值/含义 |
| --- | --- |
| Authorize URL | `https://claude.com/cai/oauth/authorize` |
| Token URL | `https://platform.claude.com/v1/oauth/token` |
| Redirect URI | `https://platform.claude.com/oauth/code/callback` |
| PKCE | `S256` |
| 完整 OAuth scope | `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` |
| Setup Token scope | `user:inference` |
| Client ID | 由 Sub2API 源码固定使用，不应由本项目自行猜测或替换 |

兑换请求是 Sub2API 服务端向 Token URL 发起的 JSON 请求，主要包含：

```json
{
  "code": "authorization code",
  "grant_type": "authorization_code",
  "client_id": "Sub2API 使用的 Claude OAuth client id",
  "redirect_uri": "https://platform.claude.com/oauth/code/callback",
  "code_verifier": "与生成 URL 时对应的 PKCE verifier",
  "state": "授权码中带回的 state（如果存在）"
}
```

成功响应可能包含：

- `access_token`
- `refresh_token`
- `token_type`
- `expires_in`
- `scope`
- `organization.uuid`
- `account.uuid`
- `account.email_address`

本项目后续应优先复用 Sub2API 的授权和兑换接口，而不是在 Next.js 中复制这套 Claude OAuth 细节。这样可以让 token 格式、刷新逻辑和 Sub2API 版本保持一致。

### 4.2 Cookie 自动授权模式

Sub2API 还支持使用 `claude.ai` 的 `sessionKey` 自动完成授权：

```text
1. 服务端接收一次性的 claude.ai sessionKey
2. Sub2API 使用 sessionKey Cookie 请求 https://claude.ai/api/organizations
3. 选择组织 UUID
4. 生成 PKCE 参数和 state
5. 请求 https://claude.ai/v1/oauth/{org_uuid}/authorize
6. 从返回的 redirect_uri 中解析授权码和 state
7. 请求 https://platform.claude.com/v1/oauth/token 兑换 token
8. 返回账号 token 信息，随后创建 Sub2API 账号
```

Sub2API 对应的管理接口是：

- 完整 OAuth：`POST /api/v1/admin/accounts/cookie-auth`
- Setup Token：`POST /api/v1/admin/accounts/setup-token-cookie-auth`

`sessionKey` 等同于 Claude Web 会话凭据。它不能出现在公共前端、URL、日志、数据库明文或分析平台中。基于这个风险，本项目 MVP 默认只规划手动授权模式，Cookie 自动授权只能作为受严格权限控制的管理员功能。

### 4.3 完整 OAuth 与 Setup Token 的区别

- `oauth`：包含更完整的 Claude Code OAuth scope，适用于 Sub2API 的 Claude OAuth 账号。
- `setup-token`：仅使用 `user:inference`，能力和适用场景更窄。

两者不能混用。创建账号时，`type` 必须与授权时使用的 scope 对应。

## 5. Sub2API 管理接口接入方案

本项目不应把 Sub2API 当成 `SUB2_AUTHORIZATION_ENDPOINT`、`SUB2_TOKEN_ENDPOINT`、`SUB2_USERINFO_ENDPOINT` 三个 OAuth 地址来配置。推荐的接入方式是由本项目服务端调用 Sub2API 的管理 API。

Sub2API 前端当前使用的核心接口为：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/accounts/generate-auth-url` | 生成完整 Claude OAuth 授权 URL 和 `session_id` |
| `POST` | `/api/v1/admin/accounts/generate-setup-token-url` | 生成 Setup Token 授权 URL |
| `POST` | `/api/v1/admin/accounts/exchange-code` | 用 `session_id` 和授权码兑换完整 OAuth token |
| `POST` | `/api/v1/admin/accounts/exchange-setup-token-code` | 兑换 Setup Token |
| `POST` | `/api/v1/admin/accounts/cookie-auth` | 使用 sessionKey 自动完成完整 OAuth |
| `POST` | `/api/v1/admin/accounts/setup-token-cookie-auth` | 使用 sessionKey 自动完成 Setup Token |
| `POST` | `/api/v1/admin/accounts` | 创建账号池条目 |
| `POST` | `/api/v1/admin/accounts/:id/refresh` | 管理员手动刷新账号 token，具体路由以目标版本为准 |

这些接口位于 Sub2API 管理端，需要管理员身份认证。本项目不能把管理员 token 放到浏览器，也不能让普通用户直接调用这些管理接口。正确的边界是：

```text
浏览器 -> 本项目服务端 -> Sub2API Admin API
```

本项目服务端负责：

- 校验当前操作者的权限和授权范围。
- 保存本项目自己的短期流程状态。
- 安全转发 `session_id` 和授权码。
- 调用账号创建接口。
- 对 Sub2API 返回结果做脱敏。
- 记录 request ID 和审计事件，不记录 token 原文。

## 6. Claude Code “验证”到底验证什么

Sub2API 中的 Claude Code 验证主要是**网关入站请求识别**，不是网页登录验证，也不是通过 `userinfo` 判断用户身份。

在 `ClaudeCodeValidator` 中，主要检查如下：

1. `User-Agent` 必须匹配 `claude-cli/x.y.z`。
2. 非 messages 路径主要依据 User-Agent 判断。
3. `/messages/count_tokens` 和特定的 Haiku 探测请求有专门放行规则。
4. 普通 `/messages` 请求还需要：
   - system prompt 与官方 Claude Code 模板达到相似度阈值。
   - 存在 `X-App`。
   - 存在 `anthropic-beta`。
   - 存在 `anthropic-version`。
   - `metadata.user_id` 存在且能被 Sub2API 解析。

账号接入成功只代表 Sub2API 拿到了可用的 Anthropic OAuth 凭据；后续请求能否被 Claude Code 专用分组接收，还取决于：

- 请求是否来自兼容的 Claude Code 客户端。
- 分组是否开启 Claude Code 限制。
- 分组是否允许 OAuth 账号。
- 账号是否处于 active、schedulable 状态。
- OAuth token 是否有效并能正常刷新。

Sub2API 的转发层还会根据账号类型处理 Claude OAuth 所需的模型映射和请求头。本项目 Web 端不应自行伪造或拼接这些上游请求头，只负责完成授权和账号入库。

## 7. 本项目与 Sub2API 的目标架构

```text
                        ┌────────────────────────┐
                        │ Claude / Anthropic OAuth │
                        └───────────┬────────────┘
                                    │ 授权码/Token
                                    v
┌───────────────┐   HTTPS   ┌──────────────────────┐
│ 管理员浏览器   │ ────────> │ CCMax Web 接入台      │
└───────────────┘           │ Next.js BFF/Server    │
                            └──────────┬───────────┘
                                       │ 管理员认证请求
                                       v
                            ┌──────────────────────┐
                            │ Sub2API Admin API     │
                            │ OAuth + Account Pool  │
                            └──────────┬───────────┘
                                       │ 调度/转发
                                       v
                            ┌──────────────────────┐
                            │ Claude Code Gateway   │
                            └──────────────────────┘
```

第一阶段只实现“本地账号登录 + 管理端代办授权 + 创建 Sub2API 账号”，不做公开注册，不收集 Claude 密码，不做 Cookie 自动授权。

## 8. 当前代码与真实目标的差异

当前代码已经从通用 OAuth 骨架切换为第一版 Sub2API Admin API 接入，但仍是本地 MVP：

- `src/lib/sub2api.ts` 负责调用 Sub2API 的授权 URL、授权码兑换和账号创建接口。
- `src/lib/provisioning-state.ts` 将本项目流程 ID 与 Sub2API `session_id` 关联，目前状态保存在进程内存。
- `src/app/api/auth/admin/login` 使用 `ADMIN_ACCESS_KEY` 建立本项目管理员会话。
- `src/lib/account-store.ts` 提供本地账号、系统开关和审计记录存储，密码只保存为 `scrypt` 哈希。
- `src/lib/roles.ts` 与 `src/lib/access.ts` 提供 `superadmin`、`admin`、`user` 三种角色的服务端权限校验。
- `src/app/api/provisioning/claude/start` 生成授权 URL。
- `src/app/api/provisioning/claude/complete` 在服务端兑换授权码并立即创建 `anthropic/oauth` 账号，浏览器只得到账号摘要。
- `src/components/provisioning-panel.tsx` 提供授权 URL、授权码、账号名称、备注和分组 ID 的管理界面。
- `src/components/account-management-panel.tsx` 提供本地账号创建、角色管理、系统开关和超级管理员审计视图。

当前仍未完成的生产能力包括 PostgreSQL/Redis 持久化、多实例流程锁、Sub2API token 轮换和真实环境端到端测试。本地 `.data/accounts.json` 适合单机 MVP，不适合多实例生产部署。

### 8.1 本地账号权限模型

| 角色 | 能力 |
| --- | --- |
| `superadmin` | 由 `ADMIN_ACCESS_KEY` 引导登录；可创建管理员/普通用户、修改角色、启停/删除本地账号、修改全部系统开关、查看账号池和审计记录、执行上号 |
| `admin` | 使用本地账号密码登录；可创建普通用户，执行上号，并在开关允许时查看 Sub2API 账号池 |
| `user` | 使用本地账号密码登录；只能执行被系统开关允许的 Claude 上号流程，默认不能查看账号池和权限控制台 |

超级管理员修改角色或停用账号后，服务端会在后续请求重新读取本地账号状态；权限不依赖前端按钮隐藏。管理员不能通过 API 创建另一个管理员，也不能修改系统开关。

本地账号管理入口使用 `POST /api/admin/users`、`PATCH/DELETE /api/admin/users/:id`、`PATCH /api/admin/settings` 和 `GET /api/admin/audit`。账号文件默认写入 `.data/accounts.json`，该目录已加入 `.gitignore`。

## 9. 后续生产化改造边界

### 9.1 推荐的服务端模块

```text
src/lib/sub2api.ts             # 当前实现：Sub2API Admin API 客户端
src/lib/provisioning-state.ts  # 当前实现：短期流程状态
src/app/api/provisioning/      # 当前实现：授权和账号创建接口
src/components/provisioning-panel.tsx
```

### 9.2 推荐的接口

| 方法 | 本项目路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/provisioning/claude/start` | 向 Sub2API 申请授权 URL |
| `POST` | `/api/provisioning/claude/complete` | 兑换授权码并立即创建 `anthropic/oauth` 账号 |
| `GET` | `/api/provisioning/claude/:id/status` | 查看接入结果和脱敏状态 |
| `POST` | `/api/provisioning/claude/:id/refresh` | 触发 Sub2API 侧刷新或同步 |

这些接口都应要求本项目管理员会话。浏览器只拿到授权 URL、流程 ID、账号 ID 和脱敏状态，不拿到 `access_token` 或 `refresh_token`。

### 9.3 需要持久化的流程状态

后续应将当前内存 Map 替换为 `provisioning_sessions` 持久化模型：

- 本项目流程 ID。
- Sub2API 返回的 `session_id`。
- 操作者 ID。
- 授权模式：`oauth` 或 `setup-token`。
- 状态：`created`、`authorized`、`exchanged`、`account_created`、`failed`、`expired`。
- 目标 Sub2API 实例和账号 ID。
- 过期时间、消耗时间和审计信息。

`session_id`、授权码和 token 都应短时有效、一次性使用，日志中只保留哈希或脱敏摘要。

## 10. 配置规划

当前 [`.env.example`](F:\ccmax-version-1.0.0-login-desker\.env.example) 已改为 Sub2API Admin API 配置：

```env
APP_ENV=development
APP_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-random-secret
ADMIN_ACCESS_KEY=replace-with-a-long-random-admin-key
LOCAL_ACCOUNT_STORE_PATH=.data/accounts.json

# Sub2API deployment
SUB2API_BASE_URL=http://localhost:8080
SUB2API_ADMIN_TOKEN=do-not-expose-this-to-the-browser
SUB2API_PROXY_ID=

# Optional: local policy and audit settings
PROVISIONING_SESSION_TTL_SECONDS=1800
```

这里的 `SUB2API_ADMIN_TOKEN` 只是配置方向示例。实际鉴权可能是管理员 Bearer token、服务端 Cookie 或其他部署方式，需要按照 Sub2API 的认证配置确定。绝不能把管理员密码硬编码进前端或提交到 Git。

本项目当前客户端按 Bearer token 调用 Sub2API：

```http
Authorization: Bearer <SUB2API_ADMIN_TOKEN>
```

如果目标 Sub2API 部署使用不同鉴权方式，需要调整 `src/lib/sub2api.ts` 的服务端请求头，不要把凭据下放到前端。

如果采用 Sub2API 自带前端而不是独立接入台，则可以直接复用它的管理页面，不需要本项目重复实现 Claude OAuth。

### 本地启动

```powershell
Copy-Item .env.example .env.local
```

生成两个本地密钥并写入 `.env.local`：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

至少配置：

```env
SESSION_SECRET=随机字符串
ADMIN_ACCESS_KEY=另一个随机字符串
SUB2API_BASE_URL=http://localhost:8080
SUB2API_ADMIN_TOKEN=Sub2API管理员Bearer Token
```

然后启动：

```powershell
npm install
npm run dev
```

访问 `http://localhost:3000`：超级管理员使用 `ADMIN_ACCESS_KEY` 登录；超级管理员创建的管理员和普通用户使用账号密码登录。登录后按照角色进入对应工作台。Sub2API 必须已经运行，并且该管理员 token 具有账号管理权限。

## 11. 开发步骤

### 阶段 0：锁定 Sub2API 运行环境

1. 确认 Sub2API 的部署地址、版本和 API 前缀。
2. 确认管理员认证方式和本项目允许调用的接口。
3. 确认默认代理、账号分组和账号过期策略。
4. 用 Sub2API 自带管理页面完成一次人工 Claude OAuth 上号，记录成功后的账号字段和状态。
5. 确认目标账号确实是合法授权的 Claude Code Max 订阅账号。

### 阶段 1：当前已实现的接入闭环

1. 本项目服务端配置 Sub2API Base URL 和管理员 Bearer token。
2. 管理员在本项目登录并调用 `generate-auth-url`。
3. 浏览器完成 Claude 授权，管理员粘贴授权码。
4. 服务端调用 `exchange-code`，不向浏览器返回 token。
5. 服务端调用 `POST /api/v1/admin/accounts` 创建 `anthropic/oauth` 账号。
6. 在 Sub2API 管理页面确认账号、状态和分组。

### 阶段 2：生产化改造

1. 将流程状态从内存迁移到 PostgreSQL/Redis。
2. 将本地账号和审计文件迁移到 PostgreSQL/Redis，增加限流、CSRF 防护和多实例锁。
3. 增加账号状态查询、刷新、撤销和 Sub2API token 轮换。
4. 增加 request ID、结构化日志和敏感字段脱敏。
5. 用真实 Sub2API 测试环境完成端到端验收。

### 阶段 3：Claude Code 验收

1. 使用官方 Claude Code 客户端配置 Sub2API 提供的入口。
2. 验证 `User-Agent`、`X-App`、`anthropic-beta`、`anthropic-version` 和 metadata 规则。
3. 验证 Claude Code 专用分组和 OAuth-only 分组策略。
4. 验证 token 自动刷新、429/过期处理和账号故障转移。
5. 验证普通非 Claude Code 请求不会意外进入限制分组。

## 12. 安全边界

- 不收集 Claude 密码。
- 不在浏览器、URL、前端日志或错误页面显示 OAuth token。
- 不把 Sub2API 管理 token 下发到浏览器。
- `sessionKey` 只允许在受控管理员流程中一次性使用；MVP 默认关闭 Cookie 自动授权。
- 授权码、Sub2API `session_id` 和流程状态需要一次性消费和短时过期。
- 账号凭据只由 Sub2API 或受控服务端保存，并使用其正式的刷新机制。
- 本地账号密码只保存为不可逆哈希；账号创建、登录、角色变更、开关变更和删除写入审计日志。
- `.data/` 只用于单机本地 MVP，不能直接作为多实例生产数据库。
- 生产环境必须使用 HTTPS、密钥管理和数据库备份。
- 只接入账号所有者明确授权且符合相关服务条款的账号。

## 13. 验收标准

### 授权与上号

- 管理员可以从本项目发起 Sub2API Claude OAuth 授权。
- 超级管理员可以创建管理员和普通用户，并修改本地角色与系统开关。
- 管理员只能创建普通用户，普通用户不能访问账号管理 API。
- 停用本地账号后，服务端请求会被拒绝，不能只依赖前端隐藏入口。
- 浏览器完成 Claude 授权后，可以把授权码安全交回服务端。
- Sub2API 成功兑换 token 并创建 `platform=anthropic`、`type=oauth` 账号。
- 本项目不向浏览器返回 token 原文。
- 创建失败时不会留下半成品账号或可重复使用的授权状态。

### Claude Code 请求

- 账号处于可调度状态时，官方 Claude Code 能通过 Sub2API 网关调用。
- OAuth token 过期时能由 Sub2API 自动刷新。
- Claude Code-only 分组按 Sub2API 的识别规则生效。
- 非 Claude Code 请求不会因为仅携带一个普通 API Key 就被误判为官方客户端。

> 说明：上面第 2–9 节是项目**早期设计文档**，记录了对 Sub2API / Claude OAuth 的调研与最初的接入闭环，作为背景保留。项目实际已远超该范围，**当前实现以第 14–16 节为准**。

## 14. 当前状态（2026-09）

项目已从"单一的 Claude OAuth 登录验证台"演进为一套**多平台账号/Key 供给与治理控制台**。核心能力：

- **认证与 RBAC**：环境超管引导 + 本地账号（超管/管理员/普通用户）登录，角色权限、系统开关、操作审计、站内弹窗。
- **多平台后端**：统一配置 `sub2api / new-api / one-api / 自建网关(custom) / Claude Gateway(ccgateway) / 账号密码 Sub2API 网关(sub2gw)`，密钥/密码 AES 加密存储、接口脱敏；按账户绑定目标平台（`targetBackend`）。
- **授权模块隔离**：`授权上号(Claude OAuth)` 与 `授权上 key(OpenAI)` 两个模块，超管按用户授权、默认拒；看板可见性与模块授权绑定。
- **授权上号**：向导化生成槽位 → 官方 OAuth → 回执入池；强制前缀、出口代理（本地记账）等。
- **授权上 key（OpenAI）**：批量导入、格式校验、命名 `显示名-MMDD-序号`、base_url/并发/优先级全局可配、企业分组按网关"按名勾选"（可多选）、**建前 + 建后双重死 Key 拦截**（含无效 key 与"无余额/配额耗尽"）。
- **观测与治理**：账号池统揽（富列表/聚合/告警）、Key 使用额度看板、数据分析·预付结款、系统日志、前缀管理。
- **内置 OpenAI Key 监控**：随服务自启，按间隔**只探本系统上传的 key**，主动 `/test` 探活，判死自动禁用并"抓包"（报错原文入日志与审计）。总开关默认关。
- **体验**：中/英 i18n，浅/深/跟随系统主题，暖色调；纯 HTTP 部署下的安全上下文兜底。

## 15. 功能全景（当前实现）

**后端类型体系（`src/lib/backends/`）**：`kinds` + `registry` 分发，`PoolBackend`/`OAuthBroker` 抽象；实现 `sub2api`（OAuth broker，支持长效 admin key 与 JWT）、`relay`（new-api/one-api）、`custom`、`ccgateway`（vendor 登录换 JWT + import-rt）、`sub2gw`（账号密码登录换 JWT，打 Sub2API 原生接口，主用于上 key）。

**主要 API 路由（`src/app/api/`）**：
- 认证：`auth/admin/login`、`auth/logout`、`me`、`health`
- 管理：`admin/users(/[id]/password)`、`admin/settings`、`admin/audit`、`admin/prefixes`、`admin/backends(/groups)`
- 上号：`provisioning/claude/{start,complete,status,accounts}`、`provisioning/backends`、`provisioning/prefixes`
- 上 key：`provisioning/openai/keys`（上传）、`provisioning/openai/usage`（额度/死活）
- 代理：`provisioning/proxies(/[id]/test)`、`provisioning/egress-proxies(/[id])`
- 账号池：`provisioning/pool(/ops,/platforms)`
- 结算：`settlement/{entries(/[id]),summary}`

**关键库**：`account-store`（本地 JSON 存储 + RBAC + 系统开关 + 归属 + 健康计数）、`access`（角色/模块/平台门禁）、`secret-box`（AES-GCM）、`sub2api`（Sub2API 客户端，可按实例参数化）、`openai-probe`（建前发 "hi" 探活）、`openai-key-monitor` + `instrumentation`（内置监控）、`settlement`、`provisioning-state`、`session`、`roles`。

**面板（`src/components/`）**：`dashboard-shell`（导航/顶栏/概览）、`provisioning-panel`（上号）、`key-provisioning-panel`（上 key）、`key-usage-panel`（Key 额度）、`account-pool-panel` + `pool-ops-board`（账号池）、`backend-config-panel`（多平台后端）、`account-management-panel`（账号与权限/系统开关/前缀）、`egress-proxy-panel`、`settlement-panel`、`system-log-panel`、登录/主题/语言等。

## 16. 项目历程（里程碑）

按提交时间顺序归纳（每行对应一个或一组提交）：

1. **登录台雏形**：Sub2API Admin API 接入闭环、页面 UI、账号登录与多平台配置、new-api/one-api 静态 API Key 渠道对齐。
2. **控制台重构 + 主题**：控制台重构，浅/深/跟随系统主题，暖色调。
3. **账号池统揽 P1–P3**：富列表 + 聚合条 + 过滤/自动刷新 → 逐账号额度/花费(5h/7d/30d) + 分组筛选 → 运维告警看板 + 规则引擎。
4. **账号池隔离**：分平台选择、按上号人隔离（超管开关）。
5. **Sub2API 长效 Admin Key**：`x-api-key` 按前缀路由，兼容静态 key 与登录 JWT。
6. **上号体验**：去超管字样、国家搜索、自定义出口代理（粘贴自动识别、HTTP/SOCKS5）、强制前缀内联选择、固定左右两栏。
7. **HTTP 部署修复**：Secure cookie 按 `APP_URL` 协议判定；非安全上下文的复制/网关添加兜底。
8. **系统日志模块**、**数据分析·预付结款模块**。
9. **超管权限开关**：普通用户的代理/平台/台账权限开关；**中/英 i18n**。
10. **目标平台按账户绑定**：分账户上号/池视图锁定；前缀改名按归属限制；账号管理弹窗站内化。
11. **ccgateway 后端**：对接自研 Claude Gateway 供应商网关（vendor 登录换 JWT + refresh_token 导入）。
12. **出口代理模块**：本地代理库 + 账号计数 + 强制选代理；随后收紧为仅超管可用出口代理、管理/用户仅本地代理池。
13. **授权上 key 模块（OpenAI）**：新增上 key + Key 使用额度看板 + `上号/上key` 模块授权隔离；账号退出与系统设置移到右上角顶栏。
14. **账号密码 Sub2API 网关（sub2gw）**：不用长效 admin key，邮箱+密码登录换 JWT，多实例配置，主用于上 key。
15. **内置 OpenAI Key 监控**：随服务自启，自动禁用死/报错 key。
16. **上 key 配置化**：base_url/并发全局设置、企业分组按网关单独配（后升级为按名勾选、可多选）、优先级可配（默认 1）。
17. **报错体验治理**：真实状态码 + 分类、去网关名、清除 `SUB2API_ADMIN_TOKEN` 误导文案、网关登录失败透出真因。
18. **死 Key 拦截强化**：建前发 "hi" 探活 + 建后 `/test` 真实验活兜底；判死纳入"无效 key"与"无余额/配额耗尽(insufficient_quota)"，真限流放行；死的拒绝/删除、不入池。
19. **命名规则**：`显示名-MMDD-序号`（去年份、保留显示名连字符作分隔）。
20. **监控收敛**：从"扫全池被动读状态"改为"**只探本系统上传的 key** 的主动探活 + 抓包（报错入日志与审计），判死禁用"。

> 变更以 Git 提交为准；本节为里程碑归纳，非逐条 changelog。
