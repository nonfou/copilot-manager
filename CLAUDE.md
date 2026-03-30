# Copilot Manager — 项目架构参考

## 项目概述

多账号 GitHub Copilot 管理系统。通过 API Key 将请求路由到用户自行运行的外部 copilot-api 实例，提供账号管理、Key 分发、用量监控、请求日志等功能。

## 技术栈

- **后端**：Go 1.25 + chi v5 + GORM + SQLite（glebarez/sqlite，纯 Go 无 CGO）
- **前端**：原生静态 HTML + CSS + JavaScript（零依赖、hash 路由）
- **认证**：Session Cookie（`cm_session`），无 JWT
- **加密**：AES-256-GCM（`enc:<iv>:<tag>:<ct>` 格式）

## 目录结构

```
copilot-manager/
├── backend/                    # Go 后端
│   ├── cmd/server/main.go      # 入口
│   └── internal/
│       ├── config/             # 环境变量加载
│       ├── crypto/             # AES-256-GCM 加密 + scrypt 密码哈希
│       ├── idgen/              # ID 生成（usr_/acc_/key_/log_ 前缀）
│       ├── store/              # GORM 数据层 + 内存 keyCache
│       ├── ssrf/               # API URL SSRF 防护
│       ├── ratelimit/          # 登录限流 + 代理限流
│       ├── middleware/          # Auth / Admin / SecurityHeaders / CORS
│       └── handler/            # HTTP 处理器 + 路由 + SPA 服务
├── frontend/
│   └── static/                 # 原生静态前端
│       ├── index.html
│       ├── styles.css
│       ├── app.js
│       └── *.js                # 各页面模块
├── data/                       # SQLite 数据库（不提交）
└── .env.example
```

## 后端架构

### 启动流程

`main.go` 按顺序执行：`config.Load()` → `crypto.InitEncryption()` → `store.Init()` + `LoadStore()` → `initAdminFromEnv()` → `handler.NewRouter()` → `http.ListenAndServe()`

优雅关闭：SIGINT/SIGTERM → `store.FlushPendingWrites()`（WAL checkpoint）→ shutdown

### 中间件链

| 顺序 | 中间件 | 作用 |
|------|--------|------|
| 1 | `RealIP` | 解析 X-Forwarded-For |
| 2 | `SecurityHeaders` | X-Content-Type-Options / X-Frame-Options / CSP（跳过 /v1） |
| 3 | `CORS` | 生产环境白名单制，开发环境全放 |
| 4 | `Recoverer` | panic → 500 |
| 5 | `AuthMiddleware` | 验证 session（cookie / header / query） |
| 6 | `AdminMiddleware` | 检查 `role == "admin"` |

### API 路由

**公开（无需认证）：**
- `GET /health` — 健康检查
- `GET /api/auth/status` — 系统是否已初始化
- `POST /api/auth/login` / `logout` — 登录登出

**认证用户：**
- `GET/POST /api/accounts` — 账号 CRUD
- `POST /api/accounts/auth/start` + `GET /api/accounts/auth/poll/{id}` — GitHub Device Flow OAuth
- `GET /api/accounts/{id}/usage` / `models` — 上游用量/模型（5 分钟缓存）
- `GET/POST /api/keys` — API Key CRUD + `POST /api/keys/{id}/regenerate`
- `GET /api/logs` — 分页请求日志
- `GET /api/stats` — 仪表盘统计

**仅管理员：**
- `GET/POST /api/users` — 用户 CRUD + `POST /api/users/{id}/reset-password`

**代理（API Key 认证）：**
- `* /v1/*` — 反向代理到 account.api_url（600s 超时，100MB body 限制）

**静态前端：**
- `/ui/*` — 从 `frontend/static` 提供静态文件，fallback 到 index.html

### 数据模型

| 模型 | 表名 | ID 前缀 | 说明 |
|------|------|---------|------|
| User | `users` | `usr_` | username(unique), password_hash(scrypt), role(admin/user) |
| Account | `accounts` | `acc_` | name, github_token(加密), account_type, api_url, owner_id |
| ApiKey | `api_keys` | `key_` | key(加密), name, account_id, owner_id, enabled, request_count |
| RequestLog | `request_logs` | `log_` | method, path, status_code, duration_ms, model, tokens, first_token_ms |
| SystemConfig | `system_config` | (int PK=1) | initialized 标志 |

### 关键模式

- **GORM 加密 Hooks**：Account.GithubToken、ApiKey.Key 通过 BeforeSave/AfterFind 自动加解密
- **keyCache**：启动时预加载所有 API Key 明文到内存，`FindKeyWithAccount` 用 `subtle.ConstantTimeCompare` 时序安全查找
- **SSRF 防护**：`ssrf.ValidateAPIURL()` 拒绝 loopback/私有 IP，仅允许 http/https
- **限流**：登录（IP + 用户名双维度，5 次/15 分钟）、代理（per-key，可配置 RPM）
- **日志裁剪**：每 50 次写入触发 DELETE 保留最新 5000 条

## 前端架构

- 入口：`frontend/static/index.html`
- 样式：`frontend/static/styles.css`
- 逻辑：`frontend/static/app.js` + 分页面模块（login / dashboard / accounts / keys / key-detail / logs / users）
- 路由：基于 `#/dashboard`、`#/accounts` 等 hash 路由
- 认证：继续使用 session cookie，所有请求仍走 `/api/*`
- 页面：Login / Dashboard / Accounts / Keys / KeyDetail / Logs / Users 全部保留

## 构建与运行

```bash
# 后端构建
cd backend && CGO_ENABLED=0 go build -ldflags="-s -w" -o ../copilot-manager-go.exe ./cmd/server/

# 开发模式
cd backend && CGO_ENABLED=0 go run ./cmd/server/  # Go :8080

# 生产运行（从项目根目录）
./copilot-manager-go.exe        # 自动解析 ./frontend/ 和 ./data/
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4242` | 监听端口 |
| `ENCRYPTION_KEY` | (必填) | 64 hex 字符，AES-256 密钥 |
| `ADMIN_USERNAME` | (可选) | 首次启动自动创建管理员 |
| `ADMIN_PASSWORD` | (可选) | 至少 6 字符 |
| `CORS_ALLOWED_ORIGINS` | (无) | 逗号分隔；生产环境空=拒绝所有 |
| `RATE_LIMIT_PER_MINUTE` | `300` | 每 key 代理限流；0=不限 |
| `TRUSTED_PROXY` | `false` | 信任 X-Forwarded-For |
| `NODE_ENV` | (无) | `production` 时强制安全 cookie + CORS |
| `HTTPS` | `false` | Cookie Secure 标志 |

## 关键文件速查

| 用途 | 路径 |
|------|------|
| 后端入口 | `backend/cmd/server/main.go` |
| 路由定义 | `backend/internal/handler/router.go` |
| 数据模型 | `backend/internal/store/types.go` |
| 数据访问层 | `backend/internal/store/store.go` |
| DB 初始化 | `backend/internal/store/db.go` |
| 代理处理器 | `backend/internal/handler/proxy.go` |
| 认证中间件 | `backend/internal/middleware/auth.go` |
| 加密工具 | `backend/internal/crypto/encrypt.go` |
| 前端入口 | `frontend/static/index.html` |
| 前端样式 | `frontend/static/styles.css` |
| 前端路由与启动 | `frontend/static/app.js` |




