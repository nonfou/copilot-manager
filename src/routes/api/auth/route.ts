import { Hono } from "hono"
import { setCookie, deleteCookie } from "hono/cookie"
import { randomBytes } from "node:crypto"
import {
  getSystemConfig,
  getUserByUsername,
  updateUser,
  setSession,
  getSession,
  deleteSession,
  getUserById,
} from "../../../store/store"
import { hashPassword, verifyPassword } from "../../../lib/password"
import { getCurrentUser, getCurrentUserId } from "../../../middleware/auth"

export const authRoutes = new Hono()

// Session 有效期：24 小时
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return randomBytes(16).toString("hex")
}

/**
 * GET /api/auth/status
 * 获取系统状态
 */
authRoutes.get("/status", (c) => {
  const config = getSystemConfig()
  const sessionId = c.req.header("X-Session-Id") || c.req.query("session_id")

  let user = null
  if (config?.initialized && sessionId) {
    const session = getSession(sessionId)
    if (session && new Date(session.expires_at) > new Date()) {
      const u = getUserById(session.user_id)
      if (u) {
        user = { id: u.id, username: u.username, role: u.role }
      }
    }
  }

  return c.json({
    initialized: config?.initialized ?? false,
    user,
  })
})

/**
 * POST /api/auth/setup
 * 已禁用 - 管理员账号必须通过命令行初始化
 */
authRoutes.post("/setup", async (c) => {
  return c.json({ error: "Setup via API is disabled. Please use CLI: copilot-manager init -u <username> -p <password>" }, 403)
})

/**
 * POST /api/auth/login
 * 用户登录
 */
authRoutes.post("/login", async (c) => {
  const config = getSystemConfig()

  if (!config?.initialized) {
    return c.json({ error: "System not initialized" }, 503)
  }

  const body = await c.req.json()
  const { username, password } = body

  if (!username || !password) {
    return c.json({ error: "Username and password required" }, 400)
  }

  // 查找用户
  const user = getUserByUsername(username)
  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401)
  }

  // 验证密码
  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.json({ error: "Invalid credentials" }, 401)
  }

  // 创建 session
  const now = new Date().toISOString()
  const sessionId = generateId()
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS).toISOString()
  setSession({
    session_id: sessionId,
    user_id: user.id,
    created_at: now,
    expires_at: expiresAt,
  })

  setCookie(c, "cm_session", sessionId, {
    httpOnly: true,
    sameSite: "Strict",
    maxAge: SESSION_EXPIRY_MS / 1000,
    path: "/",
  })

  // 更新最后登录时间
  updateUser(user.id, { last_login_at: now })

  return c.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  })
})

/**
 * POST /api/auth/logout
 * 用户登出
 */
authRoutes.post("/logout", (c) => {
  const sessionId = c.req.header("X-Session-Id") || c.req.query("session_id")
  if (sessionId) {
    deleteSession(sessionId)
  }
  deleteCookie(c, "cm_session", { path: "/" })
  return c.json({ success: true })
})

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
authRoutes.get("/me", (c) => {
  const user = getCurrentUser(c)
  if (!user) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  return c.json({
    id: user.id,
    username: user.username,
    role: user.role,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  })
})

/**
 * POST /api/auth/change-password
 * 修改密码
 */
authRoutes.post("/change-password", async (c) => {
  const userId = getCurrentUserId(c)
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  const body = await c.req.json()
  const { current_password, new_password } = body

  if (!current_password || !new_password) {
    return c.json({ error: "Current and new password required" }, 400)
  }

  if (new_password.length < 6) {
    return c.json({ error: "New password must be at least 6 characters" }, 400)
  }

  // 获取用户并验证当前密码
  const user = getUserById(userId)
  if (!user) {
    return c.json({ error: "User not found" }, 404)
  }

  const valid = await verifyPassword(current_password, user.password_hash)
  if (!valid) {
    return c.json({ error: "Current password is incorrect" }, 400)
  }

  // 更新密码
  const newHash = await hashPassword(new_password)
  updateUser(userId, { password_hash: newHash })

  return c.json({ success: true })
})
