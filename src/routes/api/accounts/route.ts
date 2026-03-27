import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import consola from "consola"
import * as store from "../../../store/store"
import * as processManager from "../../../lib/process-manager"
import { generateId } from "../../../lib/crypto"
import type { Account, AccountType, AuthSession } from "../../../store/types"

export const accountRoutes = new Hono()

// ─── 列表 ───────────────────────────────────────────────────────────────────

accountRoutes.get("/", (c) => {
  const accounts = store.getAccounts()
  const result = accounts.map((acc) => {
    const runtime = store.getRuntime(acc.id)
    return {
      ...acc,
      github_token: maskToken(acc.github_token),
      status: runtime?.status ?? "stopped",
      port: runtime?.port ?? null,
      pid: runtime?.pid ?? null,
      restart_count: runtime?.restartCount ?? 0,
      error: runtime?.error ?? null,
    }
  })
  return c.json(result)
})

// ─── 创建账号（直接提供 token）──────────────────────────────────────────────

const createAccountSchema = z.object({
  name: z.string().min(1),
  github_token: z.string().min(1),
  account_type: z.enum(["individual", "business", "enterprise"]).default("individual"),
})

accountRoutes.post("/", zValidator("json", createAccountSchema), (c) => {
  const body = c.req.valid("json")
  const account: Account = {
    id: generateId("acc"),
    name: body.name,
    github_token: body.github_token,
    account_type: body.account_type as AccountType,
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
})

accountRoutes.put("/:id", zValidator("json", updateAccountSchema), (c) => {
  const id = c.req.param("id")
  const body = c.req.valid("json")
  const updated = store.updateAccount(id, body)
  if (!updated) return c.json({ error: "Account not found" }, 404)
  return c.json({ ...updated, github_token: maskToken(updated.github_token) })
})

// ─── 删除账号 ────────────────────────────────────────────────────────────────

accountRoutes.delete("/:id", (c) => {
  const id = c.req.param("id")
  // 先停止进程
  const runtime = store.getRuntime(id)
  if (runtime?.status === "running" || runtime?.status === "starting") {
    processManager.stopProcess(id)
  }
  // 删除关联 keys
  const keys = store.getKeys(id)
  for (const key of keys) {
    store.deleteKey(key.id)
  }
  const deleted = store.deleteAccount(id)
  if (!deleted) return c.json({ error: "Account not found" }, 404)
  return c.json({ success: true })
})

// ─── 启动进程 ────────────────────────────────────────────────────────────────

accountRoutes.post("/:id/start", async (c) => {
  const id = c.req.param("id")
  const account = store.getAccountById(id)
  if (!account) return c.json({ error: "Account not found" }, 404)

  try {
    await processManager.startProcess(account)
    const runtime = store.getRuntime(id)
    return c.json({ success: true, port: runtime?.port, status: runtime?.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: message }, 500)
  }
})

// ─── 停止进程 ────────────────────────────────────────────────────────────────

accountRoutes.post("/:id/stop", (c) => {
  const id = c.req.param("id")
  const account = store.getAccountById(id)
  if (!account) return c.json({ error: "Account not found" }, 404)
  processManager.stopProcess(id)
  return c.json({ success: true })
})

// ─── Device Flow 开始 ──────────────────────────────────────────────────────

const authStartSchema = z.object({
  name: z.string().min(1),
  account_type: z.enum(["individual", "business", "enterprise"]).default("individual"),
})

accountRoutes.post("/auth/start", zValidator("json", authStartSchema), async (c) => {
  const { name, account_type } = c.req.valid("json")

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
  if (token.length <= 8) return "****"
  return `${token.slice(0, 4)}****${token.slice(-4)}`
}
