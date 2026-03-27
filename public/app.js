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

// ─── 侧边栏（统一 fetch 注入）────────────────────────────────────────────────

/**
 * 加载侧边栏并高亮当前页链接
 * 使用 sessionStorage 缓存 sidebar HTML，避免每次页面导航时出现闪烁
 * @param {string} activeHref  当前页的 href，例如 '/ui/accounts.html'
 */
async function loadSidebar(activeHref) {
  try {
    const el = document.getElementById('sidebar')
    if (!el) return

    // 优先使用缓存，立即渲染（消除闪烁）
    const cached = sessionStorage.getItem('sidebar_html')
    if (cached) {
      el.innerHTML = cached
      applySidebarActive(activeHref)
      if (currentUser) updateUIForUser(currentUser)
    }

    // 后台静默更新缓存（不更改已渲染内容，除非确实有变化）
    const res = await fetch('/ui/sidebar.html')
    const html = await res.text()
    if (html !== cached) {
      sessionStorage.setItem('sidebar_html', html)
      el.innerHTML = html
      applySidebarActive(activeHref)
      if (currentUser) updateUIForUser(currentUser)
    }
  } catch (err) {
    console.error('Failed to load sidebar:', err)
  }
}

function applySidebarActive(activeHref) {
  document.querySelectorAll('.nav-item').forEach((link) => {
    const href = link.getAttribute('href')
    link.classList.toggle('active', href === activeHref || (activeHref === '/ui/' && (href === '/ui/' || href === '/ui')))
  })
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
  // navigator.clipboard 仅在 HTTPS 或 localhost 可用，HTTP 下用 execCommand 兜底
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(
      () => toast('已复制到剪贴板', 'success'),
      () => toast('复制失败', 'error'),
    )
  } else {
    const el = document.createElement('textarea')
    el.value = text
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
    document.body.appendChild(el)
    el.focus()
    el.select()
    try {
      document.execCommand('copy')
      toast('已复制到剪贴板', 'success')
    } catch {
      toast('复制失败，请手动复制', 'error')
    }
    document.body.removeChild(el)
  }
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
window.loadSidebar = loadSidebar
window.getCurrentUser = () => currentUser
