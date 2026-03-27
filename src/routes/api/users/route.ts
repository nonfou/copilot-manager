import { Hono } from "hono"
import { randomBytes } from "node:crypto"
import { getUsers, getUserById, getUserByUsername, addUser, updateUser, deleteUser } from "../../../store/store"
import { hashPassword } from "../../../lib/password"
import { adminOnlyMiddleware, getCurrentUserId } from "../../../middleware/auth"
import type { User, UserRole } from "../../../store/types"

export const userRoutes = new Hono()

// 所有用户管理路由都需要 admin 权限
userRoutes.use("/*", adminOnlyMiddleware)

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return randomBytes(16).toString("hex")
}

/**
 * 过滤敏感字段
 */
function sanitizeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    created_at: user.created_at,
    created_by: user.created_by,
    last_login_at: user.last_login_at,
  }
}

/**
 * GET /api/users
 * 获取用户列表
 */
userRoutes.get("/", (c) => {
  const users = getUsers()
  return c.json({
    users: users.map(sanitizeUser),
    total: users.length,
  })
})

/**
 * POST /api/users
 * 创建新用户
 */
userRoutes.post("/", async (c) => {
  const currentUserId = getCurrentUserId(c)
  const body = await c.req.json()
  const { username, password, role } = body

  // 参数验证
  if (!username || !password) {
    return c.json({ error: "Username and password required" }, 400)
  }

  if (username.length < 3 || username.length > 32) {
    return c.json({ error: "Username must be 3-32 characters" }, 400)
  }

  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400)
  }

  const validRoles: UserRole[] = ["admin", "user"]
  const userRole: UserRole = validRoles.includes(role) ? role : "user"

  // 检查用户名是否已存在
  if (getUserByUsername(username)) {
    return c.json({ error: "Username already exists" }, 400)
  }

  // 创建用户
  const now = new Date().toISOString()
  const newUser: User = {
    id: generateId(),
    username,
    password_hash: await hashPassword(password),
    role: userRole,
    created_at: now,
    created_by: currentUserId || null,
    last_login_at: null,
  }

  addUser(newUser)

  return c.json({
    success: true,
    user: sanitizeUser(newUser),
  })
})

/**
 * GET /api/users/:id
 * 获取用户详情
 */
userRoutes.get("/:id", (c) => {
  const { id } = c.req.param()
  const user = getUserById(id)

  if (!user) {
    return c.json({ error: "User not found" }, 404)
  }

  return c.json({ user: sanitizeUser(user) })
})

/**
 * PUT /api/users/:id
 * 更新用户
 */
userRoutes.put("/:id", async (c) => {
  const { id } = c.req.param()
  const user = getUserById(id)

  if (!user) {
    return c.json({ error: "User not found" }, 404)
  }

  const body = await c.req.json()
  const { username, role } = body

  // 如果修改用户名，检查是否已存在
  if (username && username !== user.username) {
    if (getUserByUsername(username)) {
      return c.json({ error: "Username already exists" }, 400)
    }
  }

  const validRoles: UserRole[] = ["admin", "user"]
  const updates: Partial<User> = {}
  if (username && username.length >= 3 && username.length <= 32) {
    updates.username = username
  }
  if (role && validRoles.includes(role)) {
    updates.role = role
  }

  const updated = updateUser(id, updates)
  if (!updated) {
    return c.json({ error: "Update failed" }, 500)
  }

  return c.json({
    success: true,
    user: sanitizeUser(updated),
  })
})

/**
 * DELETE /api/users/:id
 * 删除用户
 */
userRoutes.delete("/:id", (c) => {
  const { id } = c.req.param()
  const currentUserId = getCurrentUserId(c)

  // 不能删除自己
  if (id === currentUserId) {
    return c.json({ error: "Cannot delete yourself" }, 400)
  }

  const user = getUserById(id)
  if (!user) {
    return c.json({ error: "User not found" }, 404)
  }

  const success = deleteUser(id)
  return c.json({ success })
})

/**
 * POST /api/users/:id/reset-password
 * 重置用户密码
 */
userRoutes.post("/:id/reset-password", async (c) => {
  const { id } = c.req.param()
  const user = getUserById(id)

  if (!user) {
    return c.json({ error: "User not found" }, 404)
  }

  const body = await c.req.json()
  const { new_password } = body

  if (!new_password || new_password.length < 6) {
    return c.json({ error: "New password must be at least 6 characters" }, 400)
  }

  const newHash = await hashPassword(new_password)
  updateUser(id, { password_hash: newHash })

  return c.json({ success: true })
})
