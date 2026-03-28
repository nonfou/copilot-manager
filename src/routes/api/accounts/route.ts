import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import consola from "consola"
import * as store from "../../../store/store"
import { generateId } from "../../../lib/crypto"
import { getCurrentUserId, isAdmin } from "../../../middleware/auth"
import type { Account, AccountType, AuthSession } from "../../../store/types"

export const accountRoutes = new Hono()

// ─── 用量缓存（5 分钟）──────────────────────────────────────────────────────

interface UsageCache {
  data: unknown
  fetchedAt: number
}

const usageCache = new Map<string, UsageCache>()
const modelsCache = new Map<string, UsageCache>()
const USAGE_CACHE_TTL = 5 * 60 * 1000 // 5 分钟

// ─── 列表 ───────────────────────────────────────────────────────────────────

accountRoutes.get("/", (c) => {
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)
  // 非 admin 只能看到自己的账号
  const accounts = store.getAccounts(admin ? undefined : userId)
  const result = accounts.map((acc) => ({
    ...acc,
    github_token: maskToken(acc.github_token),
  }))
  return c.json(result)
})

// ─── 创建账号（直接提供 token，或仅 API 地址）─────────────────────────────

const createAccountSchema = z.object({
  name: z.string().min(1),
  github_token: z.string().optional().default(""),  // 可选，仅 API 模式时留空
  account_type: z.enum(["individual", "business", "enterprise"]).default("individual"),
  api_url: z.string().url("api_url 必须是有效的 URL"),
})

accountRoutes.post("/", zValidator("json", createAccountSchema), (c) => {
  const body = c.req.valid("json")
  const userId = getCurrentUserId(c)
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }
  const account: Account = {
    id: generateId("acc"),
    name: body.name,
    github_token: body.github_token,
    account_type: body.account_type as AccountType,
    api_url: body.api_url.replace(/\/$/, ""), // 去掉末尾斜杠
    owner_id: userId,
    created_at: new Date().toISOString(),
  }
  store.addAccount(account)
  return c.json({ ...account, github_token: maskToken(account.github_token) }, 201)
})

// ─── 更新账号 ────────────────────────────────────────────────────────────────

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  github_token: z.string().min(1).optional(),
  account_type: z.enum(["individual", "business", "enterprise"]).optional(),
  api_url: z.string().url("api_url 必须是有效的 URL").optional(),
})

accountRoutes.put("/:id", zValidator("json", updateAccountSchema), (c) => {
  const id = c.req.param("id")
  const body = c.req.valid("json")
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)

  const updateData: Partial<Account> = { ...body }
  if (body.api_url) {
    updateData.api_url = body.api_url.replace(/\/$/, "")
  }

  // 非 admin 只能更新自己的账号
  const updated = store.updateAccount(id, updateData, admin ? undefined : userId)
  if (!updated) return c.json({ error: "Account not found or no permission" }, 404)

  // 清除该账号的用量缓存和模型缓存
  usageCache.delete(id)
  modelsCache.delete(id)

  return c.json({ ...updated, github_token: maskToken(updated.github_token) })
})

// ─── 删除账号 ────────────────────────────────────────────────────────────────

accountRoutes.delete("/:id", (c) => {
  const id = c.req.param("id")
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)
  // 检查权限
  const account = store.getAccountById(id, admin ? undefined : userId)
  if (!account) {
    return c.json({ error: "Account not found or no permission" }, 404)
  }
  // 删除关联 keys
  const keys = store.getKeys(admin ? undefined : userId, id)
  for (const key of keys) {
    store.deleteKey(key.id, admin ? undefined : userId)
  }
  const deleted = store.deleteAccount(id, admin ? undefined : userId)
  if (!deleted) return c.json({ error: "Delete failed" }, 500)

  // 清除用量缓存和模型缓存
  usageCache.delete(id)
  modelsCache.delete(id)

  return c.json({ success: true })
})

// ─── 查询账号用量 ─────────────────────────────────────────────────────────────

accountRoutes.get("/:id/usage", async (c) => {
  const id = c.req.param("id")
  const forceRefresh = c.req.query("refresh") === "true"
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)

  const account = store.getAccountById(id)
  if (!account) {
    return c.json({ error: "Account not found or no permission" }, 404)
  }
  // 非 admin：必须拥有该账号，或持有该账号下的 Key
  if (!admin && account.owner_id !== userId) {
    const hasKey = store.getKeys(userId, id).length > 0
    if (!hasKey) return c.json({ error: "Account not found or no permission" }, 404)
  }

  if (!account.api_url) {
    return c.json({ error: "Account has no api_url configured" }, 400)
  }

  // 检查缓存
  if (!forceRefresh) {
    const cached = usageCache.get(id)
    if (cached && Date.now() - cached.fetchedAt < USAGE_CACHE_TTL) {
      return c.json(cached.data)
    }
  }

  try {
    const resp = await fetch(`${account.api_url}/usage`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!resp.ok) {
      return c.json({ error: `Upstream returned ${resp.status}` }, 502)
    }
    const data = await resp.json()
    usageCache.set(id, { data, fetchedAt: Date.now() })
    return c.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    consola.warn(`Usage fetch failed for account ${id}: ${message}`)
    return c.json({ error: `Failed to fetch usage: ${message}` }, 502)
  }
})

// ─── 查询可用模型 ─────────────────────────────────────────────────────────

accountRoutes.get("/:id/models", async (c) => {
  const id = c.req.param("id")
  const forceRefresh = c.req.query("refresh") === "true"
  const userId = getCurrentUserId(c)
  const admin = isAdmin(c)

  const account = store.getAccountById(id)
  if (!account) {
    return c.json({ error: "Account not found or no permission" }, 404)
  }
  // 非 admin：必须拥有该账号，或持有该账号下的 Key
  if (!admin && account.owner_id !== userId) {
    const hasKey = store.getKeys(userId, id).length > 0
    if (!hasKey) return c.json({ error: "Account not found or no permission" }, 404)
  }

  if (!account.api_url) {
    return c.json({ error: "Account has no api_url configured" }, 503)
  }

  // 检查缓存
  if (!forceRefresh) {
    const cached = modelsCache.get(id)
    if (cached && Date.now() - cached.fetchedAt < USAGE_CACHE_TTL) {
      return c.json(cached.data)
    }
  }

  try {
    const resp = await fetch(`${account.api_url}/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!resp.ok) {
      // 有陈旧缓存时返回缓存，避免报错
      const stale = modelsCache.get(id)
      if (stale) return c.json(stale.data)
      return c.json({ error: `Upstream returned ${resp.status}` }, 502)
    }
    const data = await resp.json()
    modelsCache.set(id, { data, fetchedAt: Date.now() })
    return c.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    consola.warn(`Models fetch failed for account ${id}: ${message}`)
    // 有陈旧缓存时返回缓存
    const stale = modelsCache.get(id)
    if (stale) return c.json(stale.data)
    return c.json({ error: `Failed to fetch models: ${message}` }, 502)
  }
})

// ─── Device Flow 开始 ──────────────────────────────────────────────────────

const authStartSchema = z.object({
  name: z.string().min(1),
  account_type: z.enum(["individual", "business", "enterprise"]).default("individual"),
  api_url: z.string().url("api_url 必须是有效的 URL"),
})

accountRoutes.post("/auth/start", zValidator("json", authStartSchema), async (c) => {
  const { name, account_type, api_url } = c.req.valid("json")
  const userId = getCurrentUserId(c)
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  try {
    // 调用 GitHub Device Flow API
    const resp = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: "Iv1.b507a08c87ecfe98", // GitHub Copilot 官方 client_id
        scope: "read:user",
      }),
    })

    if (!resp.ok) {
      return c.json({ error: "Failed to start GitHub OAuth flow" }, 502)
    }

    const data = await resp.json() as {
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
      interval: number
    }

    const auth_id = generateId("auth")
    const session: AuthSession = {
      auth_id,
      device_code: data.device_code,
      name,
      account_type: account_type as AccountType,
      api_url: api_url.replace(/\/$/, ""),
      owner_id: userId,
      interval: data.interval ?? 5,
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    }
    store.setAuthSession(session)

    return c.json({
      auth_id,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    consola.error("Auth start error:", message)
    return c.json({ error: message }, 500)
  }
})

// ─── Device Flow 轮询 ──────────────────────────────────────────────────────

accountRoutes.get("/auth/poll/:auth_id", async (c) => {
  const auth_id = c.req.param("auth_id")
  const session = store.getAuthSession(auth_id)

  if (!session) {
    return c.json({ status: "expired" })
  }

  // 检查是否过期
  if (new Date(session.expires_at) < new Date()) {
    store.deleteAuthSession(auth_id)
    return c.json({ status: "expired" })
  }

  try {
    const resp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: "Iv1.b507a08c87ecfe98",
        device_code: session.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })

    const data = await resp.json() as {
      access_token?: string
      error?: string
    }

    if (data.error === "authorization_pending") {
      return c.json({ status: "pending" })
    }

    if (data.error === "slow_down") {
      return c.json({ status: "pending" })
    }

    if (data.error === "expired_token") {
      store.deleteAuthSession(auth_id)
      return c.json({ status: "expired" })
    }

    if (data.access_token) {
      // 创建账号
      const account: Account = {
        id: generateId("acc"),
        name: session.name,
        github_token: data.access_token,
        account_type: session.account_type,
        api_url: session.api_url,
        owner_id: session.owner_id,
        created_at: new Date().toISOString(),
      }
      store.addAccount(account)
      store.deleteAuthSession(auth_id)

      return c.json({
        status: "success",
        account: { ...account, github_token: maskToken(account.github_token) },
      })
    }

    return c.json({ status: "pending" })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ status: "error", error: message })
  }
})

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function maskToken(token: string): string {
  if (!token) return ""
  if (token.length <= 8) return "****"
  return `${token.slice(0, 4)}****${token.slice(-4)}`
}
