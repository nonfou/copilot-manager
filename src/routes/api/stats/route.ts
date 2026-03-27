import { Hono } from "hono"
import * as store from "../../../store/store"

export const statsRoutes = new Hono()

statsRoutes.get("/", (c) => {
  const stats = store.getStats()
  return c.json(stats)
})
