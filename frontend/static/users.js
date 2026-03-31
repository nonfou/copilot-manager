import {
  title,
  shell,
  head,
  api,
  table,
  esc,
  formatDate,
  toast,
  state,
  badge,
  showConfirm,
  showModal,
  closeModal,
  skeleton
} from './common.js'

function createFormHtml() {
  return `
    <div class="inline-note">建议为管理员设置更强密码，并定期重置长期未使用账号的凭据。</div>
    <form id="user-create-form">
      <div class="form-grid">
        <div>
          <label class="label">用户名</label>
          <input class="input" name="username" placeholder="至少 3 个字符" />
        </div>
        <div>
          <label class="label">密码</label>
          <input class="input" type="password" name="password" placeholder="至少 6 个字符" />
        </div>
        <div>
          <label class="label">角色</label>
          <select class="select" name="role">
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn primary">创建用户</button>
      </div>
    </form>
  `
}

function resetPasswordHtml(user) {
  return `
    <form id="user-reset-form">
      <input type="hidden" name="id" value="${esc(user.id)}" />
      <label class="label">新密码</label>
      <input class="input" type="password" name="password" placeholder="请输入新的登录密码" />
      <div class="form-actions">
        <button type="submit" class="btn primary">确认重置</button>
      </div>
    </form>
  `
}

function bindCreateModal() {
  const form = document.getElementById('user-create-form')
  if (!form) return

  form.onsubmit = async (event) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = {
      username: String(formData.get('username') || '').trim(),
      password: String(formData.get('password') || ''),
      role: String(formData.get('role') || 'user')
    }

    if (payload.username.length < 3 || payload.password.length < 6) {
      toast('用户名至少 3 个字符，密码至少 6 个字符', 'warning')
      return
    }

    try {
      await api('/users', { method: 'POST', body: JSON.stringify(payload) })
      closeModal()
      toast('用户已创建', 'success')
      await renderUsers()
    } catch (error) {
      toast(error.message, 'error')
    }
  }
}

function bindResetModal() {
  const form = document.getElementById('user-reset-form')
  if (!form) return

  form.onsubmit = async (event) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const id = String(formData.get('id') || '')
    const password = String(formData.get('password') || '')

    if (password.length < 6) {
      toast('密码至少 6 个字符', 'warning')
      return
    }

    try {
      await api(`/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: password })
      })
      closeModal()
      toast('密码已重置', 'success')
      await renderUsers()
    } catch (error) {
      toast(error.message, 'error')
    }
  }
}

export async function renderUsers() {
  title('用户管理')
  shell('users', head('用户管理', '创建、删除用户并重置密码') + skeleton(6))

  const data = await api('/users')
  const users = data.users || []
  const selfId = data.current_user?.id || ''
  const adminCount = users.filter((item) => item.role === 'admin').length
  const userCount = users.filter((item) => item.role === 'user').length
  const loggedInCount = users.filter((item) => item.last_login_at).length

  const rows = users.map(
    (user) => `
      <tr>
        <td>
          <strong>${esc(user.username)}</strong>
          ${user.id === selfId ? '<div class="muted small">当前会话用户</div>' : ''}
        </td>
        <td>${badge(user.role)}</td>
        <td>${esc(formatDate(user.created_at))}</td>
        <td>${esc(formatDate(user.last_login_at))}</td>
        <td>
          <div class="actions">
            <button class="btn small" data-act="reset" data-id="${esc(user.id)}">重置密码</button>
            ${user.id !== selfId ? `<button class="btn small danger" data-act="delete" data-id="${esc(user.id)}">删除</button>` : ''}
          </div>
        </td>
      </tr>
    `
  )

  shell(
    'users',
    `
      ${head(
        '用户管理',
        '创建、删除用户并重置密码',
        '<button id="btn-create-user" class="btn primary">新增用户</button>',
        [
          `用户总数：${users.length}`,
          `管理员：${adminCount}`,
          `普通用户：${userCount}`,
          `有登录记录：${loggedInCount}`
        ]
      )}

      <section class="stats-grid fade-in">
        <div class="card stat-card">
          <h3>全部用户</h3>
          <div class="stat-value">${esc(users.length)}</div>
          <div class="stat-help">当前系统已创建的用户总数</div>
        </div>
        <div class="card stat-card">
          <h3>管理员</h3>
          <div class="stat-value">${esc(adminCount)}</div>
          <div class="stat-help">拥有全局配置与管理权限</div>
        </div>
        <div class="card stat-card">
          <h3>普通用户</h3>
          <div class="stat-value">${esc(userCount)}</div>
          <div class="stat-help">通常仅访问自己的 Key 与详情页</div>
        </div>
        <div class="card stat-card">
          <h3>已登录过</h3>
          <div class="stat-value">${esc(loggedInCount)}</div>
          <div class="stat-help">至少存在一次成功登录记录</div>
        </div>
      </section>

      <section class="card fade-in">
        <div class="card-title">
          <h2>用户列表</h2>
          <div class="toolbar-group">
            <span class="metric-pill">当前会话：${esc(data.current_user?.username || '-')}</span>
            <button id="users-refresh" class="btn small">刷新</button>
          </div>
        </div>
        ${table(['用户名', '角色', '创建时间', '最后登录', '操作'], rows, '暂无用户')}
      </section>
    `
  )

  // Create user button
  document.getElementById('btn-create-user').onclick = () => {
    showModal({ title: '新增用户', body: createFormHtml() })
    bindCreateModal()
  }

  document.getElementById('users-refresh').onclick = () => renderUsers()

  // Table actions
  document.querySelectorAll('[data-act]').forEach((button) => {
    button.onclick = async () => {
      const user = users.find((item) => item.id === button.dataset.id)
      if (!user) return

      if (button.dataset.act === 'reset') {
        showModal({ title: `重置密码 - ${user.username}`, body: resetPasswordHtml(user) })
        bindResetModal()
        return
      }

      const confirmed = await showConfirm({
        title: '删除用户',
        message: `确认删除用户「${user.username}」？`,
        confirmText: '删除',
        danger: true
      })
      if (!confirmed) return

      try {
        await api(`/users/${user.id}`, { method: 'DELETE' })
        toast('用户已删除', 'success')
        await renderUsers()
      } catch (error) {
        toast(error.message, 'error')
      }
    }
  })
}
