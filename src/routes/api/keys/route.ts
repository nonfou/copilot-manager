import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import * as store from "../../../store/store"
import { generateId, generateApiKey } from "../../../lib/crypto"
import { getCurrentUserId, isAdmin } from "../../../middleware/auth"
import type { ApiKey } from "../../../store/types"

export const keyRoutes = new Hono()

// ─── 列表（可按 account_id 过滤）──────────────────────────────────────────

keyRoutes.get("/", (c) => {
  const accountId = c.req.query("account_id")
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)
  // 非 admin 只能看到自己的 keys
  const keys = store.getKeys(admin ? undefined : userId, accountId)
  return c.json(keys.map(k => withOwnerUsername(maskKey(k), admin)))
})

// ─── 创建 Key ──────────────────────────────────────────────────────────────

const createKeySchema = z.object({
  name: z.string().min(1),
  account_id: z.string().min(1),
  owner_id: z.string().optional(), // admin 可指定归属用户
})

keyRoutes.post("/", zValidator("json", createKeySchema), (c) => {
  const { name, account_id, owner_id: requestedOwnerId } = c.req.valid("json")
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)

  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  // 检查账户是否存在且用户有权限（admin 可操作所有账号）
  const account = store.getAccountById(account_id, admin ? undefined : userId)
  if (!account) {
    return c.json({ error: "Account not found or no permission" }, 404)
  }

  // 确定 owner_id：admin 可指定目标用户，否则继承账号所有者
  let targetOwnerId = account.owner_id
  if (admin && requestedOwnerId) {
    const targetUser = store.getUserById(requestedOwnerId)
    if (!targetUser) return c.json({ error: "Target user not found" }, 404)
    targetOwnerId = requestedOwnerId
  }

  const rawKey = generateApiKey()
  const key: ApiKey = {
    id: generateId("key"),
    key: rawKey,
    name,
    account_id,
    owner_id: targetOwnerId,
    enabled: true,
    request_count: 0,
    last_used_at: null,
    created_at: new Date().toISOString(),
  }
  store.addKey(key)

  // 创建时一次性返回完整 key 值
  return c.json({ ...key }, 201)
})

// ─── 单个 Key 详情 ──────────────────────────────────────────────────────────

keyRoutes.get("/:id", (c) => {
  const id = c.req.param("id")
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)
  const key = store.getKeyById(id, admin ? undefined : userId)
  if (!key) return c.json({ error: "Key not found or no permission" }, 404)
  const account = store.getAccountById(key.account_id)
  return c.json({
    ...withOwnerUsername(maskKey(key), admin),
    account: account
      ? { id: account.id, name: account.name, account_type: account.account_type, api_url: account.api_url }
      : null,
  })
})

// ─── 更新 Key ──────────────────────────────────────────────────────────────

const updateKeySchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
})

keyRoutes.put("/:id", zValidator("json", updateKeySchema), (c) => {
  const id = c.req.param("id")
  const body = c.req.valid("json")
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)
  // 非 admin 只能更新自己的 key
  const updated = store.updateKey(id, body, admin ? undefined : userId)
  if (!updated) return c.json({ error: "Key not found or no permission" }, 404)
  return c.json(maskKey(updated))
})

// ─── 删除 Key ──────────────────────────────────────────────────────────────

keyRoutes.delete("/:id", (c) => {
  const id = c.req.param("id")
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)
  // 非 admin 只能删除自己的 key
  const deleted = store.deleteKey(id, admin ? undefined : userId)
  if (!deleted) return c.json({ error: "Key not found or no permission" }, 404)
  return c.json({ success: true })
})

// ─── 重新生成 Key 值 ────────────────────────────────────────────────────────

keyRoutes.post("/:id/regenerate", (c) => {
  const id = c.req.param("id")
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)
  const newKey = generateApiKey()
  // 非 admin 只能重新生成自己的 key
  const updated = store.updateKey(id, { key: newKey }, admin ? undefined : userId)
  if (!updated) return c.json({ error: "Key not found or no permission" }, 404)
  // 返回完整新 key
  return c.json({ ...updated })
})

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function maskKey(key: ApiKey): ApiKey & { masked_key: string } {
  const masked = key.key.length > 20
    ? `${key.key.slice(0, 16)}...${key.key.slice(-4)}`
    : "****"
  return { ...key, key: masked, masked_key: masked }
}

function withOwnerUsername<T extends ApiKey>(key: T, admin: boolean): T & { owner_username?: string } {
  if (!admin) return key
  const owner = store.getUserById(key.owner_id)
  return { ...key, owner_username: owner?.username ?? key.owner_id }
}
