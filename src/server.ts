import { Hono } from "hono"
import { cors } from "hono/cors"
import { serveStatic } from "hono/bun"

import { accountRoutes } from "./routes/api/accounts/route"
import { keyRoutes } from "./routes/api/keys/route"
import { logRoutes } from "./routes/api/logs/route"
import { statsRoutes } from "./routes/api/stats/route"
import { proxyRoutes } from "./routes/proxy/route"

export const server = new Hono()

server.use(cors())

// ─── 管理 API ──────────────────────────────────────────────────────────────
server.route("/api/accounts", accountRoutes)
server.route("/api/keys", keyRoutes)
server.route("/api/logs", logRoutes)
server.route("/api/stats", statsRoutes)

// ─── 静态 UI 文件 ──────────────────────────────────────────────────────────
// 访问 /ui/ → public/index.html
server.use("/ui/*", serveStatic({ root: "./public", rewriteRequestPath: (path) => path.replace(/^\/ui/, "") }))
server.get("/ui", (c) => c.redirect("/ui/"))
server.get("/", (c) => c.redirect("/ui/"))

// ─── 代理：转发所有其他请求到对应的 copilot-api 实例 ───────────────────────
server.route("/", proxyRoutes)
