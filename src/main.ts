#!/usr/bin/env node

import { defineCommand, runMain } from "citty"
import consola from "consola"
import { serve, type ServerHandler } from "srvx"
import * as store from "./store/store"
import * as processManager from "./lib/process-manager"
import { server } from "./server"

const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Copilot Manager server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4242",
      description: "Port to listen on",
    },
  },
  async run({ args }) {
    const port = parseInt(args.port, 10)

    consola.info("Loading data store...")
    store.loadStore()

    const accounts = store.getAccounts()
    const keys = store.getKeys()
    consola.info(`Loaded ${accounts.length} account(s), ${keys.length} key(s)`)

    // 优雅退出
    process.on("SIGINT", () => {
      consola.info("Shutting down...")
      processManager.stopAll()
      process.exit(0)
    })
    process.on("SIGTERM", () => {
      consola.info("Shutting down...")
      processManager.stopAll()
      process.exit(0)
    })

    consola.box(
      [
        `🚀 Copilot Manager running on http://localhost:${port}`,
        `🖥️  UI: http://localhost:${port}/ui/`,
        `📡 API: http://localhost:${port}/api/`,
      ].join("\n"),
    )

    serve({
      fetch: server.fetch as ServerHandler,
      port,
      bun: {
        idleTimeout: 0,
      },
    })
  },
})

const main = defineCommand({
  meta: {
    name: "copilot-manager",
    description: "Manage multiple GitHub Copilot accounts with API key routing",
  },
  subCommands: { start },
})

await runMain(main)
