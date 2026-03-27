import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { encrypt, decrypt } from "../lib/encrypt"
import type {
  Account,
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

/**
 * 原子文件写入：先写临时文件，再 rename 替换，避免写到一半时崩溃导致文件损坏
 */
function writeJsonFileAtomic(filename: string, data: unknown): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
  const filePath = join(DATA_DIR, filename)
  const tmpPath = filePath + ".tmp"
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8")
  renameSync(tmpPath, filePath) // 原子替换（POSIX + Windows 均支持）
}

// ─── 防抖写入（热路径专用）──────────────────────────────────────────────────

let saveKeysTimer: ReturnType<typeof setTimeout> | null = null
let saveLogsTimer: ReturnType<typeof setTimeout> | null = null

function saveKeysNow(): void {
  const toSave = state.keys.map((k) => ({ ...k, key: encrypt(k.key) }))
  writeJsonFileAtomic("keys.json", toSave)
}

function saveLogsNow(): void {
  writeJsonFileAtomic("logs.json", state.logs.slice(-5000))
}

/**
 * 防抖写入 keys（热路径：incrementKeyRequestCount）
 * 5 秒内最多写一次，合并高频写入
 */
function saveKeysDebounced(): void {
  if (saveKeysTimer) return
  saveKeysTimer = setTimeout(() => {
    saveKeysNow()
    saveKeysTimer = null
  }, 5000)
}

/**
 * 防抖写入 logs（热路径：appendLog）
 */
function saveLogsDebounced(): void {
  if (saveLogsTimer) return
  saveLogsTimer = setTimeout(() => {
    saveLogsNow()
    saveLogsTimer = null
  }, 5000)
}

/**
 * 强制立即 flush 所有待写入的防抖缓冲区（进程退出前调用）
 */
export function flushPendingWrites(): void {
  if (saveKeysTimer) {
    clearTimeout(saveKeysTimer)
    saveKeysTimer = null
    saveKeysNow()
  }
  if (saveLogsTimer) {
    clearTimeout(saveLogsTimer)
    saveLogsTimer = null
    saveLogsNow()
  }
}

// ─── 初始化加载 ─────────────────────────────────────────────────────────────

export function loadStore(): void {
  // 加载时解密敏感字段（支持明文向后兼容）
  state.accounts = readJsonFile<Account[]>("accounts.json", []).map((a) => ({
    ...a,
    github_token: decrypt(a.github_token),
  }))
  state.keys = readJsonFile<ApiKey[]>("keys.json", []).map((k) => ({
    ...k,
    key: decrypt(k.key),
  }))
  state.logs = readJsonFile<RequestLog[]>("logs.json", [])
  state.users = readJsonFile<User[]>("users.json", [])
  state.systemConfig = readJsonFile<SystemConfig | null>("config.json", null)
}

// ─── 持久化写入 ─────────────────────────────────────────────────────────────

export function saveAccounts(): void {
  const toSave = state.accounts.map((a) => ({ ...a, github_token: encrypt(a.github_token) }))
  writeJsonFileAtomic("accounts.json", toSave)
}

export function saveKeys(): void {
  // 立即写入（取消任何待写入的防抖计时器，确保数据一致性）
  if (saveKeysTimer) {
    clearTimeout(saveKeysTimer)
    saveKeysTimer = null
  }
  saveKeysNow()
}

export function saveLogs(): void {
  if (saveLogsTimer) {
    clearTimeout(saveLogsTimer)
    saveLogsTimer = null
  }
  saveLogsNow()
}

export function saveUsers(): void {
  writeJsonFileAtomic("users.json", state.users)
}

export function saveConfig(): void {
  if (state.systemConfig) {
    writeJsonFileAtomic("config.json", state.systemConfig)
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

// ─── 热路径：通过 API Key 查找账号 ──────────────────────────────────────────

export function findKeyWithAccount(apiKey: string): {
  key: ApiKey
  account: Account | undefined
} | null {
  const key = state.keys.find((k) => k.key === apiKey && k.enabled)
  if (!key) return null
  const account = state.accounts.find((a) => a.id === key.account_id)
  return { key, account }
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
  // 超出 5000 条时裁剪（保留最新）
  if (state.logs.length > 5000) {
    state.logs = state.logs.slice(-5000)
  }
  saveLogsDebounced()
}

export function incrementKeyRequestCount(keyId: string): void {
  const idx = state.keys.findIndex((k) => k.id === keyId)
  if (idx !== -1) {
    state.keys[idx].request_count++
    state.keys[idx].last_used_at = new Date().toISOString()
    saveKeysDebounced() // 防抖：避免热路径每次请求都触发写盘
  }
}

// ─── 统计 ──────────────────────────────────────────────────────────────────

export function getStats() {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const todayRequests = state.logs.filter((l) =>
    l.created_at.startsWith(today),
  ).length

  return {
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
