// 核心类型定义

export type AccountType = "individual" | "business" | "enterprise"
export type UserRole = "admin" | "user"

// 用户类型
export interface User {
  id: string
  username: string
  password_hash: string
  role: UserRole
  created_at: string
  created_by: string | null  // 创建者 user_id（admin 创建的记录是谁创建的）
  last_login_at: string | null
}

// 用户会话
export interface UserSession {
  session_id: string
  user_id: string
  created_at: string
  expires_at: string
}

// 系统配置
export interface SystemConfig {
  initialized: boolean
  admin_created_at: string | null
}

export interface Account {
  id: string
  name: string
  github_token: string
  account_type: AccountType
  api_url: string           // copilot-api 实例地址（如 http://localhost:8080）
  owner_id: string  // 所属用户 ID
  created_at: string
}

export interface ApiKey {
  id: string
  key: string
  name: string
  account_id: string
  owner_id: string  // 所属用户 ID
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
  model: string | null
  error: string | null
  created_at: string
}

export interface AuthSession {
  auth_id: string
  device_code: string
  name: string
  account_type: AccountType
  api_url: string           // copilot-api 实例地址
  owner_id: string  // 发起认证的用户 ID
  interval: number
  started_at: string
  expires_at: string
}

export interface StatsData {
  total_accounts: number
  enabled_keys: number
  today_requests: number
  total_requests: number
}
