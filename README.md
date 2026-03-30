# Copilot Manager

多账号 GitHub Copilot 代理管理系统。集中管理多个 copilot-api 实例，通过 API Key 路由请求，提供统一的 API 入口。

---

## 架构概览

```
客户端 (Claude Code / 其他工具)
        │  Bearer sk-ant-api03-xxxx
        ▼
  Copilot Manager  :4242          ← 本项目（管理 + 代理）
        │  按 API Key 路由
        ▼
  copilot-api 实例  :8080          ← 独立运行，持有 GitHub Token
        │
        ▼
  GitHub Copilot API
```

每个账号对应一个独立运行的 `copilot-api` 实例，copilot-manager 不管理子进程，只做请求转发。

当前后端为 **Go 轻量版**，并使用 **纯 Go SQLite 驱动** 避免 Docker / 小内存机器上的 CGO 构建开销；前端为 **原生静态 HTML/CSS/JS**，进一步降低部署复杂度。

---

## 前置条件

需要先运行一个或多个 [copilot-api](https://github.com/ddddddeon/copilot-api) 实例：

```bash
# 每个 GitHub 账号单独运行一个实例，指定不同端口
bun run /path/to/copilot-api/src/main.ts start --port 8080 --github-token <your_github_token>
bun run /path/to/copilot-api/src/main.ts start --port 8081 --github-token <another_token>
```

确认实例正常运行：

```bash
curl http://localhost:8080/v1/models
```

---

## 安装与启动

### 前置依赖

- **Go 1.25+**
- **前端为原生静态文件**（无需 Node.js / pnpm 构建）

### 1. 克隆仓库

```bash
git clone https://github.com/nonfou/copilot-manager.git
cd copilot-manager
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 管理员账号（首次启动自动创建，之后可删除这两行）
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# 数据加密密钥（强烈建议设置，丢失后数据无法解密）
ENCRYPTION_KEY=<用下方命令生成>
```

生成加密密钥：

```bash
openssl rand -hex 32
```

### 3. 构建

```bash
# 构建 Go 后端（纯 Go SQLite，无需 CGO）
cd backend && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/copilot-manager ./cmd/server && cd ..
```

前端位于 `frontend/static/`，为原生静态资源，无需额外构建。

### 4. 启动

```bash
# 直接运行（自动读取当前目录的 .env）
source .env
DATA_DIR=data ./backend/bin/copilot-manager

# 或使用启动脚本（自动构建 + PM2/nohup 后台运行）
./start.sh
```

启动后访问 **http://localhost:4242/ui/** 进入管理界面。

### 开发模式

```bash
# 后端
cd backend && CGO_ENABLED=0 go run ./cmd/server
```

前端为原生静态页面，直接由 Go 后端通过 `/ui/` 提供，无需单独开发服务器。

---

## Docker 部署

```bash
# 构建镜像
docker build -t copilot-manager .

# 运行（配合 .env 文件）
docker compose up -d

# 查看日志
docker compose logs -f
```

`docker-compose.yml` 说明：
- 数据目录挂载到 `./data`（持久化数据库文件）
- 环境变量从 `.env` 文件读取
- 默认监听端口 `4242`，可在 `.env` 中通过 `PORT` 修改
- 默认附带轻量内存设置：`GOMEMLIMIT=320MiB`、`GOGC=50`

---

## 添加账号

登录管理界面 → **账号管理** → **+ 添加账号**，有三种方式：

| 方式 | 适用场景 |
|------|---------|
| GitHub OAuth 授权 | 在线授权，无需手动复制 Token |
| 直接粘贴 Token | 已有 `ghu_xxx` Token |
| 仅 API 地址 | copilot-api 实例由外部管理，不在本系统存储 Token |

**必填字段**：copilot-api 地址（如 `http://localhost:8080`）。

---

## 创建 API Key

进入 **Key 管理** → **+ 新建 Key**：

1. 填写 Key 名称（或点击**随机生成**）
2. 选择关联的账号
3. 点击**创建**，立即复制显示的完整 Key（**仅显示一次**）

生成的 Key 格式：`sk-ant-api03-xxxxxxxxxxxxxxxxxx`

---

## 客户端接入

代理地址统一为：`http://<your-host>:4242`

### Claude Code

```bash
ANTHROPIC_API_KEY=sk-ant-api03-你的Key \
ANTHROPIC_BASE_URL=http://localhost:4242 \
claude
```

或写入 `~/.bashrc` / `~/.zshrc`：

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-你的Key"
export ANTHROPIC_BASE_URL="http://localhost:4242"
```

### Continue.dev / Cursor / 其他 OpenAI 兼容客户端

以 Continue.dev 为例，在 `config.json` 中：

```json
{
  "models": [
    {
      "title": "GitHub Copilot (via Manager)",
      "provider": "openai",
      "model": "gpt-4o",
      "apiKey": "sk-ant-api03-你的Key",
      "apiBase": "http://localhost:4242"
    }
  ]
}
```

### curl 直接调用

```bash
curl http://localhost:4242/v1/chat/completions \
  -H "Authorization: Bearer sk-ant-api03-你的Key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADMIN_USERNAME` | 初始管理员用户名 | — |
| `ADMIN_PASSWORD` | 初始管理员密码 | — |
| `ENCRYPTION_KEY` | 64 位 hex 加密密钥 | —（必填，否则启动失败） |
| `DATA_DIR` | 数据库文件目录 | `data` |
| `PORT` | 监听端口 | `4242` |
| `RATE_LIMIT_PER_MINUTE` | 每个 Key 每分钟最大请求数，`0` 不限 | `300` |
| `CORS_ALLOWED_ORIGINS` | 逗号分隔的 CORS 白名单 | —（不设则允许所有） |
| `HTTPS` | Cookie Secure 属性（部署在 HTTPS 反向代理后设为 `true`） | `false` |
| `TRUSTED_PROXY` | 信任 X-Forwarded-For 头（仅在反向代理可信时启用） | `false` |
| `MAX_PROXY_BODY_SIZE` | 非流式代理请求体最大缓存，支持 `16MiB` 写法 | `16MiB` |
| `LOG_RETENTION_COUNT` | 最多保留的请求日志条数 | `2000` |
| `CACHE_TTL_SECONDS` | 账号 usage/models 缓存秒数 | `120` |
| `GOMEMLIMIT` | Go 运行时软内存上限 | `320MiB` |
| `GOGC` | Go GC 激进程度，越小越省内存 | `50` |

---

## 注意事项

- **ENCRYPTION_KEY 一旦设置不可更改**，丢失后存储的 Token 和 Key 无法解密
- Session 存储在内存中，服务重启后需要重新登录
- 代理转发时会去掉客户端的 `Authorization` 头，由 copilot-api 实例负责鉴权
- SQLite 使用 WAL 模式，`DATA_DIR` 目录需有写权限
- 对于 2G 服务器，建议优先使用 Docker Compose 默认配置或保留 `GOMEMLIMIT=320MiB`




