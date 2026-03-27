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

### 1. 克隆并安装依赖

```bash
git clone https://github.com/nonfou/copilot-manager.git
cd copilot-manager
bun install
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
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. 启动

```bash
# 开发模式（热重载）
bun run dev

# 生产模式
bun run start

# 指定端口（默认 4242）
bun run start -- --port 3000
```

启动后访问 **http://localhost:4242/ui/** 进入管理界面。

> 详细部署（PM2、反向代理）参见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

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
| `ENCRYPTION_KEY` | 64 位 hex 加密密钥 | —（不加密） |
| `RATE_LIMIT_PER_MINUTE` | 每个 Key 每分钟最大请求数，`0` 不限 | `300` |
| `CORS_ALLOWED_ORIGINS` | 逗号分隔的 CORS 白名单，不设则允许所有 | — |
| `PORT` | 监听端口 | `4242` |

---

## 注意事项

- **ENCRYPTION_KEY 一旦设置不可更改**，丢失后存储的 Token 和 Key 无法解密
- 旧账号（无 `api_url` 字段）需进入编辑页面补填 copilot-api 地址
- Session 存储在内存中，服务重启后需要重新登录
- 代理转发时会去掉客户端的 `Authorization` 头，由 copilot-api 实例负责鉴权
