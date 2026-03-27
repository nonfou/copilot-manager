import { Hono } from "hono"
import * as store from "../../store/store"
import { generateId } from "../../lib/crypto"
import type { RequestLog } from "../../store/types"

export const proxyRoutes = new Hono()

// ─── 每 API Key 限流（固定窗口计数器）──────────────────────────────────────

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? "300")
const RATE_WINDOW_MS = 60_000

interface RateRecord {
  count: number
  windowStart: number
}

const keyRateLimits = new Map<string, RateRecord>()

function checkKeyRateLimit(keyId: string): { allowed: boolean; retryAfter?: number } {
  if (RATE_LIMIT <= 0) return { allowed: true } // 0 = 不限流

  const now = Date.now()
  const record = keyRateLimits.get(keyId)

  if (!record || now - record.windowStart >= RATE_WINDOW_MS) {
    keyRateLimits.set(keyId, { count: 1, windowStart: now })
    return { allowed: true }
  }

  record.count++
  if (record.count > RATE_LIMIT) {
    const retryAfter = Math.ceil((record.windowStart + RATE_WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfter }
  }

  return { allowed: true }
}

// ─── 代理处理器 ───────────────────────────────────────────────────────────

proxyRoutes.all("/*", async (c) => {
  const startTime = Date.now()
  const authHeader = c.req.header("Authorization")
  const apiKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null

  // 验证 API Key
  if (!apiKey) {
    return c.json({ error: "Missing Authorization header" }, 401)
  }

  const found = store.findKeyWithAccount(apiKey)
  if (!found) {
    return c.json({ error: "Invalid API key" }, 401)
  }

  const { key, account } = found

  if (!account) {
    return c.json({ error: "Account not found" }, 404)
  }

  if (!account.api_url) {
    return c.json({ error: `Account "${account.name}" has no api_url configured` }, 503)
  }

  // 限流检查
  const rateCheck = checkKeyRateLimit(key.id)
  if (!rateCheck.allowed) {
    return c.json(
      { error: "Rate limit exceeded" },
      429,
      { "Retry-After": String(rateCheck.retryAfter) },
    )
  }

  // 构建转发请求头
  const headers = new Headers(c.req.raw.headers)
  headers.delete("authorization")
  headers.delete("host")
  headers.delete("content-length")

  let upstreamResponse: Response
  let errorMsg: string | null = null

  try {
    const reqUrl = new URL(c.req.raw.url)
    const baseUrl = account.api_url.replace(/\/$/, "")
    const upstreamUrl = `${baseUrl}${reqUrl.pathname}${reqUrl.search}`

    upstreamResponse = await fetch(upstreamUrl, {
      method: c.req.method,
      headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
      // @ts-ignore - duplex required for streaming request bodies
      duplex: "half",
    })
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err)
    // 异步记录日志
    queueMicrotask(() => {
      store.incrementKeyRequestCount(key.id)
      const log: RequestLog = {
        id: generateId("log"),
        api_key_id: key.id,
        account_id: account.id,
        api_key_name: key.name,
        account_name: account.name,
        method: c.req.method,
        path: c.req.path,
        status_code: 502,
        duration_ms: Date.now() - startTime,
        error: errorMsg,
        created_at: new Date().toISOString(),
      }
      store.appendLog(log)
    })
    return c.json({ error: `Upstream error: ${errorMsg}` }, 502)
  }

  const durationMs = Date.now() - startTime

  // 异步记录日志（不阻塞响应）
  queueMicrotask(() => {
    store.incrementKeyRequestCount(key.id)
    const log: RequestLog = {
      id: generateId("log"),
      api_key_id: key.id,
      account_id: account.id,
      api_key_name: key.name,
      account_name: account.name,
      method: c.req.method,
      path: c.req.path,
      status_code: upstreamResponse.status,
      duration_ms: durationMs,
      error: null,
      created_at: new Date().toISOString(),
    }
    store.appendLog(log)
  })

  // 直接管道转发响应（支持 SSE 流式 + JSON）
  const responseHeaders = new Headers(upstreamResponse.headers)
  responseHeaders.delete("content-encoding") // 避免二次解压问题

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  })
})
