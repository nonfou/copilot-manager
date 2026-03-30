export interface User {
  id: string
  username: string
  role: 'admin' | 'user'
  created_at: string
  last_login_at?: string
}

export interface Account {
  id: string
  name: string
  account_type: 'individual' | 'business' | 'enterprise'
  api_url: string
  created_at: string
}

export interface ApiKey {
  id: string
  name: string
  masked_key: string
  key?: string
  account_id: string
  owner_id: string
  owner_username?: string
  enabled: boolean
  request_count: number
  last_used_at?: string
  account?: Account
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
  model?: string
  error?: string
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  first_token_ms?: number
  created_at: string
}

export interface Stats {
  total_accounts: number
  enabled_keys: number
  today_requests: number
  total_requests: number
}

export interface LogsResponse {
  logs: RequestLog[]
  total: number
  page: number
  limit: number
}

export interface PremiumInteractions {
  unlimited?: boolean
  entitlement?: number
  remaining?: number
}

export interface UsageData {
  quota_snapshots?: {
    premium_interactions?: PremiumInteractions
  }
  quota_reset_date_utc?: string
}

export interface ModelItem {
  id: string
  display_name?: string
}

export interface ModelsResponse {
  data: ModelItem[]
}

export interface AuthStatus {
  initialized: boolean
}

export interface AuthStartResponse {
  auth_id: string
  user_code: string
  verification_uri: string
  interval: number
}

export interface AuthPollResponse {
  status: 'pending' | 'success' | 'expired'
  account?: Account
}

export interface UsersListResponse {
  users: User[]
  current_user: User
}
