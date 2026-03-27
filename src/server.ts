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

export const server = new Hono()

// ─── CORS ────────────────────────────────────────────────────────────────────
server.use(cors({
  origin: "*",
  credentials: true,
}))

// ─── 认证 API（无需认证）─────────────────────────────────────────────────────
server.route("/api/auth", authRoutes)

// ─── 认证中间件 ──────────────────────────────────────────────────────────────
// 保护管理 API 和 UI
server.use("/api/accounts/*", authMiddleware)
server.use("/api/keys/*", authMiddleware)
server.use("/api/logs/*", authMiddleware)
server.use("/api/stats/*", authMiddleware)
server.use("/api/users/*", authMiddleware)
server.use("/ui/*", authMiddleware)

// ─── 管理 API ────────────────────────────────────────────────────────────────
server.route("/api/accounts", accountRoutes)
server.route("/api/keys", keyRoutes)
server.route("/api/logs", logRoutes)
server.route("/api/stats", statsRoutes)
server.route("/api/users", userRoutes)

// ─── 静态 UI 文件 ────────────────────────────────────────────────────────────
// 访问 /ui/ → public/index.html
server.use("/ui/*", serveStatic({ root: "./public", rewriteRequestPath: (path) => path.replace(/^\/ui/, "") }))
server.get("/ui", (c) => c.redirect("/ui/"))
server.get("/", (c) => c.redirect("/ui/"))

// ─── 代理：转发所有其他请求到对应的 copilot-api 实例 ───────────────────────
server.route("/", proxyRoutes)
