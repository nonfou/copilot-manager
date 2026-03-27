import { Context, Next } from "hono"
import { getCookie } from "hono/cookie"
import { getSystemConfig, getSession, deleteSession, getUserById } from "../store/store"
import type { User } from "../store/types"

// 扩展 Context 类型
declare module "hono" {
  interface ContextVariableMap {
    user: User
    userId: string
    userRole: string
  }
}

/**
 * 认证中间件
 * - 系统 UI 和管理 API 使用 Session 认证
 * - 代理路由保持原有 Bearer Token 认证（不在此处理）
 */
export async function authMiddleware(c: Context, next: Next) {
  const path = c.req.path
  const config = getSystemConfig()

  // 1. 系统初始化检查
  if (!config?.initialized) {
    // 允许初始化相关路由
    if (path === "/api/auth/setup" || path === "/api/auth/status") {
      return next()
    }
    // UI 静态资源允许访问（login.html 需要显示初始化表单）
    if (path.startsWith("/ui") && (path.endsWith(".html") || path.endsWith(".js") || path.endsWith(".css"))) {
      return next()
    }
    // 其他请求返回 503
    if (path.startsWith("/api/")) {
      return c.json({ error: "System not initialized" }, 503)
    }
    return c.redirect("/ui/login.html")
  }

  // 2. 白名单路由（公开访问）
  const publicRoutes = ["/api/auth/login", "/api/auth/status"]
  if (publicRoutes.includes(path)) {
    return next()
  }

  // login.html 本身不需要认证（避免重定向到自身产生无限循环）
  if (path === "/ui/login.html") {
    return next()
  }

  // 3. UI 静态文件 + 管理 API - Session 认证
  if (path.startsWith("/ui") || path.startsWith("/api/")) {
    const sessionId = getCookie(c, "cm_session")
    const session = sessionId ? getSession(sessionId) : null

    // 检查 session 是否有效
    if (!session || new Date(session.expires_at) < new Date()) {
      // 清除过期 session
      if (session) {
        deleteSession(sessionId!)
      }

      // UI 页面请求：返回重定向或特殊响应
      if (path.startsWith("/ui")) {
        // 对于 HTML 页面请求，返回重定向
        if (path.endsWith(".html") || path === "/ui/" || path === "/ui") {
          return c.redirect("/ui/login.html")
        }
        // 对于静态资源（JS/CSS），返回 401
        return c.json({ error: "Unauthorized" }, 401)
      }

      // API 请求返回 401
      return c.json({ error: "Unauthorized" }, 401)
    }

    // 设置用户信息到 context
    const user = getUserById(session.user_id)
    if (!user) {
      deleteSession(sessionId!)
      if (path.startsWith("/ui")) {
        return c.redirect("/ui/login.html")
      }
      return c.json({ error: "User not found" }, 401)
    }

    c.set("user", user)
    c.set("userId", user.id)
    c.set("userRole", user.role)

    return next()
  }

  // 4. 其他路由正常通过
  return next()
}

/**
 * Admin 角色检查中间件
 */
export async function adminOnlyMiddleware(c: Context, next: Next) {
  const userRole = c.get("userRole")
  if (userRole !== "admin") {
    return c.json({ error: "Admin access required" }, 403)
  }
  return next()
}

/**
 * 获取当前登录用户
 */
export function getCurrentUser(c: Context): User | undefined {
  return c.get("user")
}

/**
 * 获取当前用户 ID
 */
export function getCurrentUserId(c: Context): string | undefined {
  return c.get("userId")
}

/**
 * 检查是否是 admin
 */
export function isAdmin(c: Context): boolean {
  return c.get("userRole") === "admin"
}
