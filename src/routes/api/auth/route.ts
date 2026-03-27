import { Hono } from "hono"
import { setCookie, deleteCookie } from "hono/cookie"
import { randomBytes } from "node:crypto"
import type { Context } from "hono"
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

// ─── 登录防暴力破解（内存计数器）────────────────────────────────────────────

const MAX_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000 // 15 分钟

interface AttemptRecord {
  count: number
  lockedUntil: number
}

const loginAttempts = new Map<string, AttemptRecord>()

function getClientIp(c: Context): string {
  return (
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    c.req.header("X-Real-IP") ||
    "unknown"
  )
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const record = loginAttempts.get(ip)

  if (record && record.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) }
  }

  // 锁定已过期，清除记录
  if (record && record.lockedUntil <= now) {
    loginAttempts.delete(ip)
  }

  return { allowed: true }
}

function recordFailedAttempt(ip: string): void {
  const record = loginAttempts.get(ip) ?? { count: 0, lockedUntil: 0 }
  record.count++
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_DURATION_MS
  }
  loginAttempts.set(ip, record)
}

function clearAttempts(ip: string): void {
  loginAttempts.delete(ip)
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────

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
 * 用户登录（含暴力破解防护：连续失败 5 次锁定 15 分钟）
 */
authRoutes.post("/login", async (c) => {
  const config = getSystemConfig()

  if (!config?.initialized) {
    return c.json({ error: "System not initialized" }, 503)
  }

  const ip = getClientIp(c)
  const rateCheck = checkRateLimit(ip)
  if (!rateCheck.allowed) {
    return c.json(
      { error: "登录尝试次数过多，请稍后再试。" },
      429,
      { "Retry-After": String(rateCheck.retryAfter) },
    )
  }

  const body = await c.req.json()
  const { username, password } = body

  if (!username || !password) {
    return c.json({ error: "Username and password required" }, 400)
  }

  // 查找用户
  const user = getUserByUsername(username)
  if (!user) {
    recordFailedAttempt(ip)
    return c.json({ error: "Invalid credentials" }, 401)
  }

  // 验证密码
  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    recordFailedAttempt(ip)
    return c.json({ error: "Invalid credentials" }, 401)
  }

  // 登录成功，清除失败计数
  clearAttempts(ip)

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
 * 获取当前用户信息（需要 authMiddleware，在 server.ts 单独注册）
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
 * 修改密码（需要 authMiddleware，在 server.ts 单独注册）
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
