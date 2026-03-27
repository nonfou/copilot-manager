import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type {
  Account,
  AccountRuntime,
  AccountStatus,
  ApiKey,
  AuthSession,
  RequestLog,
  User,
  UserSession,
  SystemConfig,
} from "./types"

const DATA_DIR = join(process.cwd(), "data")

// 内存状态
const state = {
  accounts: [] as Account[],
  keys: [] as ApiKey[],
  logs: [] as RequestLog[],
  runtime: new Map<string, AccountRuntime>(),
  authSessions: new Map<string, AuthSession>(),
  users: [] as User[],
  sessions: new Map<string, UserSession>(),
  systemConfig: null as SystemConfig | null,
}

// ─── 文件读写 ──────────────────────────────────────────────────────────────

function readJsonFile<T>(filename: string, defaultValue: T): T {
  const filePath = join(DATA_DIR, filename)
  if (!existsSync(filePath)) return defaultValue
  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as T
  } catch {
    return defaultValue
  }
}

function writeJsonFile(filename: string, data: unknown): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
  const filePath = join(DATA_DIR, filename)
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
}

// ─── 初始化加载 ─────────────────────────────────────────────────────────────

export function loadStore(): void {
  state.accounts = readJsonFile<Account[]>("accounts.json", [])
  state.keys = readJsonFile<ApiKey[]>("keys.json", [])
  state.logs = readJsonFile<RequestLog[]>("logs.json", [])
  state.users = readJsonFile<User[]>("users.json", [])
  state.systemConfig = readJsonFile<SystemConfig | null>("config.json", null)
}

// ─── 持久化写入 ─────────────────────────────────────────────────────────────

export function saveAccounts(): void {
  writeJsonFile("accounts.json", state.accounts)
}

export function saveKeys(): void {
  writeJsonFile("keys.json", state.keys)
}

export function saveLogs(): void {
  writeJsonFile("logs.json", state.logs.slice(-500))
}

export function saveUsers(): void {
  writeJsonFile("users.json", state.users)
}

export function saveConfig(): void {
  if (state.systemConfig) {
    writeJsonFile("config.json", state.systemConfig)
  }
}

// ─── Account CRUD ──────────────────────────────────────────────────────────

export function getAccounts(ownerId?: string): Account[] {
  if (ownerId) {
    return state.accounts.filter((a) => a.owner_id === ownerId)
  }
  return state.accounts
}

export function getAccountById(id: string, ownerId?: string): Account | undefined {
  return state.accounts.find((a) => a.id === id && (!ownerId || a.owner_id === ownerId))
}

export function addAccount(account: Account): void {
  state.accounts.push(account)
  saveAccounts()
}

export function updateAccount(id: string, data: Partial<Account>, ownerId?: string): Account | null {
  const idx = state.accounts.findIndex((a) => a.id === id && (!ownerId || a.owner_id === ownerId))
  if (idx === -1) return null
  state.accounts[idx] = { ...state.accounts[idx], ...data }
  saveAccounts()
  return state.accounts[idx]
}

export function deleteAccount(id: string, ownerId?: string): boolean {
  const before = state.accounts.length
  const account = state.accounts.find((a) => a.id === id)
  // 检查所有权
  if (ownerId && account && account.owner_id !== ownerId) {
    return false
  }
  state.accounts = state.accounts.filter((a) => a.id !== id)
  if (state.accounts.length < before) {
    saveAccounts()
    return true
  }
  return false
}

// ─── ApiKey CRUD ───────────────────────────────────────────────────────────

export function getKeys(ownerId?: string, accountId?: string): ApiKey[] {
  let keys = state.keys
  if (ownerId) {
    keys = keys.filter((k) => k.owner_id === ownerId)
  }
  if (accountId) {
    keys = keys.filter((k) => k.account_id === accountId)
  }
  return keys
}

export function getKeyById(id: string, ownerId?: string): ApiKey | undefined {
  return state.keys.find((k) => k.id === id && (!ownerId || k.owner_id === ownerId))
}

export function addKey(key: ApiKey): void {
  state.keys.push(key)
  saveKeys()
}

export function updateKey(id: string, data: Partial<ApiKey>, ownerId?: string): ApiKey | null {
  const idx = state.keys.findIndex((k) => k.id === id && (!ownerId || k.owner_id === ownerId))
  if (idx === -1) return null
  state.keys[idx] = { ...state.keys[idx], ...data }
  saveKeys()
  return state.keys[idx]
}

export function deleteKey(id: string, ownerId?: string): boolean {
  const key = state.keys.find((k) => k.id === id)
  // 检查所有权
  if (ownerId && key && key.owner_id !== ownerId) {
    return false
  }
  const before = state.keys.length
  state.keys = state.keys.filter((k) => k.id !== id)
  if (state.keys.length < before) {
    saveKeys()
    return true
  }
  return false
}

// ─── 热路径：通过 API Key 查找账号和运行时 ────────────────────────────────

export function findKeyWithAccount(apiKey: string): {
  key: ApiKey
  account: Account | undefined
  runtime: AccountRuntime | undefined
} | null {
  const key = state.keys.find((k) => k.key === apiKey && k.enabled)
  if (!key) return null
  const account = state.accounts.find((a) => a.id === key.account_id)
  const runtime = state.runtime.get(key.account_id)
  return { key, account, runtime }
}

// ─── Runtime 状态（纯内存）─────────────────────────────────────────────────

export function getRuntime(accountId: string): AccountRuntime | undefined {
  return state.runtime.get(accountId)
}

export function setRuntime(accountId: string, runtime: AccountRuntime): void {
  state.runtime.set(accountId, runtime)
}

export function deleteRuntime(accountId: string): void {
  state.runtime.delete(accountId)
}

export function getAllRuntimes(): Map<string, AccountRuntime> {
  return state.runtime
}

export function setAccountStatus(accountId: string, status: AccountStatus, extra?: Partial<AccountRuntime>): void {
  const existing = state.runtime.get(accountId)
  if (existing) {
    state.runtime.set(accountId, { ...existing, status, ...extra })
  } else {
    state.runtime.set(accountId, { port: 0, status, restartCount: 0, ...extra })
  }
}

// ─── 日志 ──────────────────────────────────────────────────────────────────

export function getLogs(options?: {
  page?: number
  limit?: number
  accountId?: string
}): { logs: RequestLog[]; total: number } {
  let filtered = state.logs
  if (options?.accountId) {
    filtered = filtered.filter((l) => l.account_id === options.accountId)
  }
  // 倒序（最新在前）
  const reversed = [...filtered].reverse()
  const total = reversed.length
  const limit = options?.limit ?? 50
  const page = options?.page ?? 1
  const offset = (page - 1) * limit
  return { logs: reversed.slice(offset, offset + limit), total }
}

export function appendLog(log: RequestLog): void {
  state.logs.push(log)
  // 超出 500 条时裁剪（保留最新）
  if (state.logs.length > 500) {
    state.logs = state.logs.slice(-500)
  }
  saveLogs()
}

export function incrementKeyRequestCount(keyId: string): void {
  const idx = state.keys.findIndex((k) => k.id === keyId)
  if (idx !== -1) {
    state.keys[idx].request_count++
    state.keys[idx].last_used_at = new Date().toISOString()
    saveKeys()
  }
}

// ─── 统计 ──────────────────────────────────────────────────────────────────

export function getStats() {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const runningAccounts = [...state.runtime.values()].filter(
    (r) => r.status === "running",
  ).length
  const todayRequests = state.logs.filter((l) =>
    l.created_at.startsWith(today),
  ).length

  return {
    running_accounts: runningAccounts,
    total_accounts: state.accounts.length,
    enabled_keys: state.keys.filter((k) => k.enabled).length,
    today_requests: todayRequests,
    total_requests: state.logs.length,
  }
}

// ─── Auth Sessions（Device Flow 临时状态）──────────────────────────────────

export function setAuthSession(session: AuthSession): void {
  state.authSessions.set(session.auth_id, session)
}

export function getAuthSession(authId: string): AuthSession | undefined {
  return state.authSessions.get(authId)
}

export function deleteAuthSession(authId: string): void {
  state.authSessions.delete(authId)
}

// ─── User CRUD ─────────────────────────────────────────────────────────────

export function getUsers(): User[] {
  return state.users
}

export function getUserById(id: string): User | undefined {
  return state.users.find((u) => u.id === id)
}

export function getUserByUsername(username: string): User | undefined {
  return state.users.find((u) => u.username === username)
}

export function addUser(user: User): void {
  state.users.push(user)
  saveUsers()
}

export function updateUser(id: string, data: Partial<User>): User | null {
  const idx = state.users.findIndex((u) => u.id === id)
  if (idx === -1) return null
  state.users[idx] = { ...state.users[idx], ...data }
  saveUsers()
  return state.users[idx]
}

export function deleteUser(id: string): boolean {
  const before = state.users.length
  state.users = state.users.filter((u) => u.id !== id)
  if (state.users.length < before) {
    saveUsers()
    return true
  }
  return false
}

// ─── Session 管理 ─────────────────────────────────────────────────────────

export function setSession(session: UserSession): void {
  state.sessions.set(session.session_id, session)
}

export function getSession(sessionId: string): UserSession | undefined {
  return state.sessions.get(sessionId)
}

export function deleteSession(sessionId: string): void {
  state.sessions.delete(sessionId)
}

// ─── System Config ────────────────────────────────────────────────────────

export function getSystemConfig(): SystemConfig | null {
  return state.systemConfig
}

export function setSystemConfig(config: SystemConfig): void {
  state.systemConfig = config
  saveConfig()
}

export function updateSystemConfig(partial: Partial<SystemConfig>): void {
  if (state.systemConfig) {
    state.systemConfig = { ...state.systemConfig, ...partial }
    saveConfig()
  }
}
