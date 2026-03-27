// ─── API 封装 ─────────────────────────────────────────────────────────────

const api = {
  async get(path) {
    const res = await fetch(`/api${path}`, { credentials: 'same-origin' })
    if (res.status === 401) {
      window.location.href = '/ui/login.html'
      throw new Error('Not authenticated')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  },
  async post(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      window.location.href = '/ui/login.html'
      throw new Error('Not authenticated')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  },
  async put(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
    if (res.status === 401) {
      window.location.href = '/ui/login.html'
      throw new Error('Not authenticated')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  },
  async delete(path) {
    const res = await fetch(`/api${path}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    if (res.status === 401) {
      window.location.href = '/ui/login.html'
      throw new Error('Not authenticated')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  },
}

// ─── 认证相关 ─────────────────────────────────────────────────────────────

let currentUser = null

async function checkAuth() {
  try {
    const data = await api.get('/auth/me')
    currentUser = data
    updateUIForUser(data)
    return data
  } catch (err) {
    return null
  }
}

function updateUIForUser(user) {
  // 更新用户信息显示
  const usernameEl = document.getElementById('current-username')
  const roleEl = document.getElementById('current-role')
  if (usernameEl) usernameEl.textContent = user.username
  if (roleEl) roleEl.textContent = user.role

  // Admin 显示用户管理菜单
  const usersNav = document.getElementById('users-nav')
  if (usersNav) {
    usersNav.classList.toggle('hidden', user.role !== 'admin')
  }
}

async function logout() {
  try {
    await api.post('/auth/logout')
    window.location.href = '/ui/login.html'
  } catch (err) {
    toast('登出失败: ' + err.message, 'error')
  }
}

// ─── Toast 通知 ────────────────────────────────────────────────────────────

function getToastContainer() {
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    container.className = 'toast-container'
    document.body.appendChild(container)
  }
  return container
}

function toast(message, type = 'info', duration = 3500) {
  const container = getToastContainer()
  const el = document.createElement('div')
  el.className = `toast ${type}`

  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' }
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${escHtml(message)}</span>`
  container.appendChild(el)

  setTimeout(() => {
    el.classList.add('removing')
    el.addEventListener('animationend', () => el.remove())
  }, duration)
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`
}

function statusCodeBadge(code) {
  const cls = code < 300 ? 'success' : code < 500 ? 'warning' : 'error'
  return `<span class="badge ${cls}">${code}</span>`
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('已复制到剪贴板', 'success'),
    () => toast('复制失败', 'error'),
  )
}

// ─── Modal 辅助 ────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden')
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden')
}

// 点击遮罩关闭
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden')
  }
})

// ─── 导出全局 ─────────────────────────────────────────────────────────────

window.api = api
window.toast = toast
window.escHtml = escHtml
window.formatDate = formatDate
window.formatDuration = formatDuration
window.statusBadge = statusBadge
window.statusCodeBadge = statusCodeBadge
window.copyToClipboard = copyToClipboard
window.openModal = openModal
window.closeModal = closeModal
window.checkAuth = checkAuth
window.logout = logout
window.getCurrentUser = () => currentUser
