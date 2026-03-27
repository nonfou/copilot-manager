import { Hono } from "hono"
import * as store from "../../../store/store"

export const logRoutes = new Hono()

logRoutes.get("/", (c) => {
  const page = parseInt(c.req.query("page") ?? "1", 10)
  const limit = parseInt(c.req.query("limit") ?? "50", 10)
  const accountId = c.req.query("account_id")
  const apiKeyId = c.req.query("api_key_id")

  const { logs, total } = store.getLogs({ page, limit, accountId, apiKeyId })
  return c.json({
    logs,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  })
})
