import consola from "consola"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { allocatePort, releasePort, isPortListening } from "./port-manager"
import * as store from "../store/store"
import type { Account } from "../store/types"

// 子进程路径：优先使用 COPILOT_API_PATH 环境变量，否则使用相对路径默认值
const COPILOT_API_ENTRY =
  process.env.COPILOT_API_PATH ??
  join(import.meta.dir, "../../../copilot-api/src/main.ts")

// 启动时检查路径是否存在
if (!existsSync(COPILOT_API_ENTRY)) {
  consola.warn(`copilot-api 未找到: ${COPILOT_API_ENTRY}`)
  consola.warn(`请在 .env 中设置 COPILOT_API_PATH 指向正确路径，否则无法启动账号进程。`)
}

const HEALTH_CHECK_TIMEOUT = 20_000  // 20秒
const HEALTH_CHECK_INTERVAL = 1_000  // 每秒检查一次
const MAX_RESTART_COUNT = 5
const HEALTH_POLL_INTERVAL = 30_000  // 30秒定期健康检查
const STOP_TIMEOUT_MS = 5_000        // 等待子进程退出的超时时间

const processes = new Map<string, Subprocess>()
const healthTimers = new Map<string, ReturnType<typeof setInterval>>()

/**
 * 启动 copilot-api 子进程
 */
export async function startProcess(account: Account): Promise<void> {
  if (!existsSync(COPILOT_API_ENTRY)) {
    throw new Error(`copilot-api not found: ${COPILOT_API_ENTRY}. Set COPILOT_API_PATH env variable.`)
  }

  const existingRuntime = store.getRuntime(account.id)
  if (existingRuntime?.status === "running" || existingRuntime?.status === "starting") {
    throw new Error(`Account ${account.name} is already running or starting`)
  }

  const port = allocatePort()
  store.setRuntime(account.id, {
    port,
    status: "starting",
    restartCount: existingRuntime?.restartCount ?? 0,
    startedAt: new Date().toISOString(),
  })

  consola.info(`Starting copilot-api for account "${account.name}" on port ${port}`)

  try {
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        COPILOT_API_ENTRY,
        "start",
        "--port",
        String(port),
        "--github-token",
        account.github_token,
        "--account-type",
        account.account_type,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      },
    )

    processes.set(account.id, proc)

    // 等待进程健康
    await waitForHealthy(port, account.id)

    store.setRuntime(account.id, {
      port,
      status: "running",
      pid: proc.pid,
      restartCount: existingRuntime?.restartCount ?? 0,
      startedAt: new Date().toISOString(),
    })

    consola.success(`Account "${account.name}" is now running on port ${port}`)

    // 启动定期健康检查
    startHealthMonitor(account)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    consola.error(`Failed to start account "${account.name}": ${message}`)
    store.setAccountStatus(account.id, "error", { error: message })
    releasePort(port)
    throw err
  }
}

/**
 * 停止子进程（优雅关闭：先 SIGTERM，超时后 SIGKILL）
 */
export async function stopProcess(accountId: string): Promise<void> {
  stopHealthMonitor(accountId)

  const proc = processes.get(accountId)
  if (proc) {
    try {
      proc.kill("SIGTERM")
      // 等待进程退出（最多 5 秒）
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))
      await Promise.race([proc.exited.then(() => undefined), timeout])

      // 若超时仍未退出，强制 kill
      if (proc.exitCode === null) {
        proc.kill("SIGKILL")
        await proc.exited.catch(() => undefined)
      }
    } catch {
      // 忽略 kill 错误
    }
    processes.delete(accountId)
  }

  const runtime = store.getRuntime(accountId)
  if (runtime?.port) {
    releasePort(runtime.port)
  }

  store.setAccountStatus(accountId, "stopped")
  consola.info(`Stopped process for account ${accountId}`)
}

/**
 * 等待端口健康（轮询 /v1/models）
 */
async function waitForHealthy(port: number, accountId: string): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < HEALTH_CHECK_TIMEOUT) {
    const ok = await isPortListening(port, 800)
    if (ok) return
    await Bun.sleep(HEALTH_CHECK_INTERVAL)

    // 检查进程是否还存活
    const proc = processes.get(accountId)
    if (proc && proc.exitCode !== null) {
      throw new Error(`Process exited with code ${proc.exitCode}`)
    }
  }
  throw new Error(`Health check timed out after ${HEALTH_CHECK_TIMEOUT}ms`)
}

/**
 * 启动定期健康监控
 */
function startHealthMonitor(account: Account): void {
  stopHealthMonitor(account.id) // 清理旧的

  const timer = setInterval(async () => {
    const runtime = store.getRuntime(account.id)
    if (!runtime || runtime.status !== "running") {
      stopHealthMonitor(account.id)
      return
    }

    const ok = await isPortListening(runtime.port, 2000)
    if (!ok) {
      consola.warn(`Health check failed for account "${account.name}", attempting restart`)
      stopHealthMonitor(account.id)
      await attemptRestart(account)
    }
  }, HEALTH_POLL_INTERVAL)

  healthTimers.set(account.id, timer)
}

/**
 * 停止健康监控定时器
 */
function stopHealthMonitor(accountId: string): void {
  const timer = healthTimers.get(accountId)
  if (timer) {
    clearInterval(timer)
    healthTimers.delete(accountId)
  }
}

/**
 * 自动重启（指数退避，最多 5 次）
 */
async function attemptRestart(account: Account): Promise<void> {
  const runtime = store.getRuntime(account.id)
  const restartCount = (runtime?.restartCount ?? 0) + 1

  if (restartCount > MAX_RESTART_COUNT) {
    consola.error(`Account "${account.name}" exceeded max restart count (${MAX_RESTART_COUNT})`)
    store.setAccountStatus(account.id, "error", {
      error: `Exceeded max restart count (${MAX_RESTART_COUNT})`,
    })
    return
  }

  const delay = Math.min(1000 * 2 ** (restartCount - 1), 30_000)
  consola.info(`Restarting "${account.name}" in ${delay}ms (attempt ${restartCount}/${MAX_RESTART_COUNT})`)

  // 先释放旧端口和进程
  const proc = processes.get(account.id)
  if (proc) {
    try { proc.kill() } catch {}
    processes.delete(account.id)
  }
  if (runtime?.port) {
    releasePort(runtime.port)
  }

  await Bun.sleep(delay)

  try {
    const port = allocatePort()
    store.setRuntime(account.id, {
      port,
      status: "starting",
      restartCount,
      startedAt: new Date().toISOString(),
    })

    const newProc = Bun.spawn(
      [
        "bun", "run", COPILOT_API_ENTRY, "start",
        "--port", String(port),
        "--github-token", account.github_token,
        "--account-type", account.account_type,
      ],
      { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    )

    processes.set(account.id, newProc)
    await waitForHealthy(port, account.id)

    store.setRuntime(account.id, {
      port,
      status: "running",
      pid: newProc.pid,
      restartCount,
      startedAt: new Date().toISOString(),
    })

    consola.success(`Account "${account.name}" restarted successfully on port ${port}`)
    startHealthMonitor(account)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    store.setAccountStatus(account.id, "error", { error: message, restartCount })
    consola.error(`Restart failed for "${account.name}": ${message}`)
  }
}

/**
 * 停止所有子进程（程序退出时调用，等待所有子进程实际终止）
 */
export async function stopAll(): Promise<void> {
  const accountIds = [...processes.keys()]
  await Promise.all(accountIds.map((id) => stopProcess(id)))
}
