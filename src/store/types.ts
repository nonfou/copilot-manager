// 核心类型定义

export type AccountType = "individual" | "business" | "enterprise"
export type AccountStatus = "stopped" | "running" | "starting" | "error"

export interface Account {
  id: string
  name: string
  github_token: string
  account_type: AccountType
  created_at: string
}

export interface AccountRuntime {
  port: number
  status: AccountStatus
  pid?: number
  error?: string
  startedAt?: string
  restartCount: number
}

export interface ApiKey {
  id: string
  key: string
  name: string
  account_id: string
  enabled: boolean
  request_count: number
  last_used_at: string | null
  created_at: string
}

export interface RequestLog {
  id: string
  api_key_id: string
  account_id: string
  api_key_name: string
  account_name: string
  method: string
  path: string
  status_code: number
  duration_ms: number
  error: string | null
  created_at: string
}

export interface AuthSession {
  auth_id: string
  device_code: string
  name: string
  account_type: AccountType
  interval: number
  started_at: string
  expires_at: string
}

export interface StatsData {
  running_accounts: number
  total_accounts: number
  enabled_keys: number
  today_requests: number
  total_requests: number
}
