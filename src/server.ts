import { Hono } from "hono"
import { cors } from "hono/cors"
import { serveStatic } from "hono/bun"

import { authRoutes } from "./routes/api/auth/route"
import { userRoutes } from "./routes/api/users/route"
import { accountRoutes } from "./routes/api/accounts/route"
import { keyRoutes } from "./routes/api/keys/route"
import { logRoutes } from "./routes/api/logs/route"
import { statsRoutes } from "./routes/api/stats/route"
import { proxyRoutes } from "./routes/proxy/route"
import { authMiddleware } from "./middleware/auth"
import * as store from "./store/store"

export const server = new Hono()

// ─── 安全响应头（仅对非代理路由）────────────────────────────────────────────
server.use("*", async (c, next) => {
  await next()
  // 代理路由直接透传上游响应头，不添加安全头
  if (c.req.path.startsWith("/v1")) return
  c.res.headers.set("X-Content-Type-Options", "nosniff")
  c.res.headers.set("X-Frame-Options", "SAMEORIGIN")
  c.res.headers.set("X-XSS-Protection", "1; mode=block")
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  )
})

// ─── CORS ────────────────────────────────────────────────────────────────────
// origin:"*" + credentials:true 违反 CORS 规范，改为函数式 origin
const IS_PRODUCTION = process.env.NODE_ENV === "production"

server.use(cors({
  origin: (origin) => {
    const allowed = process.env.CORS_ALLOWED_ORIGINS
      ?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []
    // 无 origin 头 = 同源请求或 curl，直接放行
    if (!origin) return origin
    // 生产环境：未配置白名单时拒绝所有跨域
    if (allowed.length === 0) return IS_PRODUCTION ? null : origin
    return allowed.includes(origin) ? origin : null
  },
  credentials: true,
}))

// ─── 健康检查（无需认证）────────────────────────────────────────────────────
server.get("/health", (c) => {
  const accounts = store.getAccounts()
  return c.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    accounts: {
      total: accounts.length,
    },
  })
})

// ─── 需要认证的 auth 子路由（必须在 route 注册之前注册中间件）────────────────
server.use("/api/auth/me", authMiddleware)
server.use("/api/auth/change-password", authMiddleware)

// ─── 认证 API（login/logout/status 无需认证）─────────────────────────────────
server.route("/api/auth", authRoutes)

// ─── 认证中间件（仅 API，静态文件不需要）──────────────────────────────────
server.use("/api/accounts/*", authMiddleware)
server.use("/api/keys/*", authMiddleware)
server.use("/api/logs/*", authMiddleware)
server.use("/api/stats/*", authMiddleware)
server.use("/api/users/*", authMiddleware)

// ─── 管理 API ────────────────────────────────────────────────────────────────
server.route("/api/accounts", accountRoutes)
server.route("/api/keys", keyRoutes)
server.route("/api/logs", logRoutes)
server.route("/api/stats", statsRoutes)
server.route("/api/users", userRoutes)

// ─── 静态 UI 文件 ────────────────────────────────────────────────────────────
server.use("/ui/*", serveStatic({ root: "./public", rewriteRequestPath: (path) => path.replace(/^\/ui/, "") }))
server.get("/ui", (c) => c.redirect("/ui/"))
server.get("/", (c) => c.redirect("/ui/"))

// ─── 代理：仅转发 /v1/* 请求到对应的 copilot-api 实例 ─────────────────────
server.route("/v1", proxyRoutes)
