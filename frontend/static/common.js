export const app = document.getElementById('app')
export const toastBox = document.getElementById('toast-container')

export const routes = {
  login: { title: '登录', auth: false },
  dashboard: { title: '仪表盘', auth: true, admin: true },
  accounts: { title: '账号管理', auth: true, admin: true },
  keys: { title: 'Key 管理', auth: true, admin: true },
  'key-detail': { title: 'Key 详情', auth: true },
  logs: { title: '请求日志', auth: true, admin: true },
  users: { title: '用户管理', auth: true, admin: true }
}

export const state = {
  initialized: true,
  user: null,
  activeRoute: '',
  pageCleanup: null,
  accounts: { mode: 'oauth', editId: '', models: null, oauth: null, timer: null },
  keys: { filterAccountId: '', editId: '', revealedKey: '' },
  logs: { page: 1, filterAccountId: '' },
  detail: { keyId: '', page: 1 },
  users: { resetUserId: '' }
}

export const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export function title(text) {
  document.title = text ? `Copilot Manager - ${text}` : 'Copilot Manager'
}

export function toast(message, type = 'info') {
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = message
  toastBox.appendChild(el)
  setTimeout(() => el.remove(), 3200)
}

export function formatDate(value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return String(value)
  }
}

export const formatMs = (value) =>
  value == null ? '-' : value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`

export function formatTokens(log) {
  if (!log) return '-'
  const prompt = log.prompt_tokens
  const completion = log.completion_tokens
  const total = log.total_tokens
  if (prompt == null && completion == null && total == null) return '-'

  const parts = []
  if (prompt != null) parts.push(`in ${prompt}`)
  if (completion != null) parts.push(`out ${completion}`)
  if (total != null) parts.push(`total ${total}`)
  return parts.join(' / ')
}

export const defaultRoute = () => (state.user?.role === 'admin' ? 'dashboard' : 'key-detail')

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  return {
    route: path.replace(/^\/+/, ''),
    query: new URLSearchParams(query)
  }
}

export function go(route, query) {
  const search = query ? `?${new URLSearchParams(query).toString()}` : ''
  const hash = `#/${route}${search}`
  if (location.hash === hash) return
  location.hash = hash
}

export async function api(path, init = {}, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    },
    ...init
  })

  let data = null
  try {
    data = await response.json()
  } catch {}

  if (response.status === 401 && !options.allow401) {
    state.user = null
    if (state.activeRoute !== 'login') go('login')
    throw new Error('登录已失效，请重新登录')
  }

  if (!response.ok) {
    throw new Error(data?.error || response.statusText || '请求失败')
  }

  return data
}

export async function loadStatus() {
  try {
    const data = await api('/auth/status', {}, { allow401: true })
    state.initialized = !!data?.initialized
    if (!state.user && data?.user) state.user = data.user
  } catch {
    state.initialized = true
  }
}

export async function checkAuth() {
  try {
    state.user = await api('/auth/me', {}, { allow401: true })
  } catch {
    state.user = null
  }
}

export function allowRoute(name) {
  const config = routes[name]
  if (!config) {
    go(defaultRoute())
    return false
  }

  if (!config.auth) {
    if (state.user) {
      go(defaultRoute())
      return false
    }
    return true
  }

  if (!state.user) {
    go('login')
    return false
  }

  if (config.admin && state.user.role !== 'admin') {
    go('key-detail')
    return false
  }

  return true
}

export function cleanup() {
  if (typeof state.pageCleanup === 'function') state.pageCleanup()
  state.pageCleanup = null
}

export function stopOAuth() {
  if (state.accounts.timer) {
    clearTimeout(state.accounts.timer)
    state.accounts.timer = null
  }
}

const navConfig = {
  admin: [
    ['dashboard', '仪表盘', '📊'],
    ['accounts', '账号管理', '👤'],
    ['keys', 'Key 管理', '🔑'],
    ['key-detail', 'Key 详情', '🧾'],
    ['logs', '请求日志', '📜'],
    ['users', '用户管理', '🛡️']
  ],
  user: [['key-detail', 'Key 详情', '🧾']]
}

export function shell(route, content) {
  const admin = state.user?.role === 'admin'
  const roleText = admin ? '管理员' : '普通用户'
  const navItems = admin ? navConfig.admin : navConfig.user
  const nav = navItems
    .map(
      ([name, label, icon]) => `
        <a class="nav-link ${route === name ? 'active' : ''}" href="#/${name}">
          <span class="nav-icon">${icon}</span>
          <span>${label}</span>
        </a>
      `
    )
    .join('')

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-scroll">
          <div class="brand">
            <div class="brand-logo">🤖</div>
            <div>
              <div class="brand-title">Copilot Manager</div>
              <div class="brand-subtitle">零依赖管理台 · 静态前端</div>
            </div>
          </div>

          <nav class="nav-list">${nav}</nav>

          <div class="sidebar-footer">
            <div class="user-card">
              <div class="row" style="justify-content:space-between;align-items:flex-start;">
                <div>
                  <div><strong>${esc(state.user?.username || '-')}</strong></div>
                  <div class="muted small">当前登录账户</div>
                </div>
                <span class="badge ${admin ? 'warning' : 'info'}">${esc(roleText)}</span>
              </div>
              <div class="user-meta">
                <div class="user-meta-item">
                  <span>访问范围</span>
                  <strong>${admin ? '全局管理' : '仅我的 Key'}</strong>
                </div>
                <div class="user-meta-item">
                  <span>界面风格</span>
                  <strong>深色控制台</strong>
                </div>
              </div>
            </div>
            <button id="logout-btn" class="btn small">退出登录</button>
          </div>
        </div>
      </aside>

      <main class="main">
        <div class="main-inner">${content}</div>
      </main>
    </div>
  `

  document.getElementById('logout-btn').onclick = async () => {
    try {
      await api('/auth/logout', { method: 'POST' }, { allow401: true })
    } catch {}
    cleanup()
    state.user = null
    go('login')
  }
}

export function authShell(content) {
  app.innerHTML = `<div class="login-shell">${content}</div>`
}

export const head = (heading, description, actions = '', meta = []) => `
  <div class="page-head">
    <div class="page-head-copy">
      <h1>${esc(heading)}</h1>
      <p>${esc(description)}</p>
      ${
        Array.isArray(meta) && meta.length
          ? `<div class="hero-meta">${meta
              .map((item) => `<span class="hero-chip">${esc(item)}</span>`)
              .join('')}</div>`
          : ''
      }
    </div>
    <div class="page-actions row wrap">${actions}</div>
  </div>
`

export const table = (headers, rows, empty = '暂无数据') =>
  rows.length
    ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>${headers.map((item) => `<th>${item}</th>`).join('')}</tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `
    : `<div class="empty">${esc(empty)}</div>`

export const badge = (status) => {
  const map = {
    enabled: ['success', '启用'],
    disabled: ['danger', '禁用'],
    admin: ['warning', '管理员'],
    user: ['info', '普通用户']
  }
  const [type, label] = map[status] || ['info', status]
  return `<span class="badge ${type}">${esc(label)}</span>`
}

export const accountTypeBadge = (type) => {
  const map = {
    individual: ['info', '个人版'],
    business: ['success', '商业版'],
    enterprise: ['warning', '企业版']
  }
  const [style, label] = map[type] || ['info', type || '-']
  return `<span class="badge ${style}">${esc(label)}</span>`
}

export const codeBadge = (code) =>
  `<span class="badge ${code < 300 ? 'success' : 'danger'}">${esc(code)}</span>`

export function usageText(usage) {
  const premium = usage?.quota_snapshots?.premium_interactions
  if (!usage) return '<span class="muted">加载失败</span>'
  if (!premium) return '<span class="muted">暂无配额信息</span>'
  if (premium.unlimited) return '<span class="badge success">不限量</span>'
  return `总额 ${esc(premium.entitlement ?? '-')} / 剩余 ${esc(premium.remaining ?? '-')}`
}
