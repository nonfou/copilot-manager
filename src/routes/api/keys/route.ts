import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import * as store from "../../../store/store"
import { generateId, generateApiKey } from "../../../lib/crypto"
import type { ApiKey } from "../../../store/types"

export const keyRoutes = new Hono()

// ─── 列表（可按 account_id 过滤）──────────────────────────────────────────

keyRoutes.get("/", (c) => {
  const accountId = c.req.query("account_id")
  const keys = store.getKeys(accountId)
  return c.json(keys.map(maskKey))
})

// ─── 创建 Key ──────────────────────────────────────────────────────────────

const createKeySchema = z.object({
  name: z.string().min(1),
  account_id: z.string().min(1),
})

keyRoutes.post("/", zValidator("json", createKeySchema), (c) => {
  const { name, account_id } = c.req.valid("json")

  const account = store.getAccountById(account_id)
  if (!account) return c.json({ error: "Account not found" }, 404)

  const rawKey = generateApiKey()
  const key: ApiKey = {
    id: generateId("key"),
    key: rawKey,
    name,
    account_id,
    enabled: true,
    request_count: 0,
    last_used_at: null,
    created_at: new Date().toISOString(),
  }
  store.addKey(key)

  // 创建时一次性返回完整 key 值
  return c.json({ ...key }, 201)
})

// ─── 更新 Key ──────────────────────────────────────────────────────────────

const updateKeySchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
})

keyRoutes.put("/:id", zValidator("json", updateKeySchema), (c) => {
  const id = c.req.param("id")
  const body = c.req.valid("json")
  const updated = store.updateKey(id, body)
  if (!updated) return c.json({ error: "Key not found" }, 404)
  return c.json(maskKey(updated))
})

// ─── 删除 Key ──────────────────────────────────────────────────────────────

keyRoutes.delete("/:id", (c) => {
  const id = c.req.param("id")
  const deleted = store.deleteKey(id)
  if (!deleted) return c.json({ error: "Key not found" }, 404)
  return c.json({ success: true })
})

// ─── 重新生成 Key 值 ────────────────────────────────────────────────────────

keyRoutes.post("/:id/regenerate", (c) => {
  const id = c.req.param("id")
  const newKey = generateApiKey()
  const updated = store.updateKey(id, { key: newKey })
  if (!updated) return c.json({ error: "Key not found" }, 404)
  // 返回完整新 key
  return c.json({ ...updated })
})

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function maskKey(key: ApiKey): ApiKey & { masked_key: string } {
  const masked = key.key.length > 10
    ? `${key.key.slice(0, 6)}...${key.key.slice(-4)}`
    : "****"
  return { ...key, key: masked, masked_key: masked }
}
