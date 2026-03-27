#!/usr/bin/env node

import { defineCommand, runMain } from "citty"
import consola from "consola"
import { serve, type ServerHandler } from "srvx"
import * as store from "./store/store"
import * as processManager from "./lib/process-manager"
import { server } from "./server"
import { hashPassword } from "./lib/password"
import { initEncryption } from "./lib/encrypt"
import { randomBytes } from "node:crypto"

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

    // 初始化加密（必须在 loadStore 之前，确保加载时能解密）
    initEncryption()

    consola.info("Loading data store...")
    store.loadStore()

    // 检查是否需要通过环境变量初始化管理员
    const config = store.getSystemConfig()
    if (!config?.initialized) {
      const adminUsername = process.env.ADMIN_USERNAME
      const adminPassword = process.env.ADMIN_PASSWORD

      if (adminUsername && adminPassword) {
        consola.info("Found admin credentials, initializing...")

        // 参数验证
        if (adminUsername.length < 3 || adminUsername.length > 32) {
          consola.error("Invalid ADMIN_USERNAME (must be 3-32 characters)")
          process.exit(1)
        }

        if (adminPassword.length < 6) {
          consola.error("Invalid ADMIN_PASSWORD (must be at least 6 characters)")
          process.exit(1)
        }

        // 检查用户名是否已存在
        if (store.getUserByUsername(adminUsername)) {
          consola.error("Username already exists")
          process.exit(1)
        }

        // 创建管理员账号
        const now = new Date().toISOString()
        const adminUser = {
          id: randomBytes(16).toString("hex"),
          username: adminUsername,
          password_hash: await hashPassword(adminPassword),
          role: "admin" as const,
          created_at: now,
          created_by: null,
          last_login_at: null,
        }

        store.addUser(adminUser)
        store.setSystemConfig({
          initialized: true,
          admin_created_at: now,
        })

        consola.success("Admin account created!")
        consola.info(`Username: ${adminUsername}`)
      } else {
        consola.warn("")
        consola.warn("System not initialized!")
        consola.warn("Please set ADMIN_USERNAME and ADMIN_PASSWORD in .env file")
        consola.warn("")
      }
    }

    const accounts = store.getAccounts()
    const keys = store.getKeys()
    consola.info(`Loaded ${accounts.length} account(s), ${keys.length} key(s)`)

    // 优雅退出：等待子进程终止，flush 防抖缓冲区
    const shutdown = async (signal: string) => {
      consola.info(`Received ${signal}, shutting down gracefully...`)
      await processManager.stopAll()
      store.flushPendingWrites()
      process.exit(0)
    }

    process.on("SIGINT", () => shutdown("SIGINT"))
    process.on("SIGTERM", () => shutdown("SIGTERM"))

    consola.box(
      [
        `🚀 Copilot Manager running on http://localhost:${port}`,
        `🖥️  UI: http://localhost:${port}/ui/`,
        `📡 API: http://localhost:${port}/api/`,
        `💊 Health: http://localhost:${port}/health`,
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
