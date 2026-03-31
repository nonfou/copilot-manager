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

function createFormHtml(accountOptions, userOptions) {
  if (!accountOptions) {
    return '<div class="alert warning">请先在账号管理中创建至少一个账号，再生成代理 Key。</div>'
  }
  return `
    <form id="key-create-form">
      <div class="form-grid">
        <div>
          <label class="label">Key 名称</label>
          <input class="input" name="name" placeholder="例如：team-a-prod" />
        </div>
        <div>
          <label class="label">关联账号</label>
          <select class="select" name="account_id">${accountOptions}</select>
        </div>
        <div class="full">
          <label class="label">归属用户（可选）</label>
          <select class="select" name="owner_id">
            <option value="">默认跟随账号拥有者</option>
            ${userOptions}
          </select>
          <div class="form-help">如需限制到某个用户，可在此直接指定归属关系。</div>
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">
          <span class="btn-text">创建 Key</span>
        </button>
      </div>
    </form>
  `
}

function editFormHtml(key) {
  return `
    <form id="key-edit-form">
      <input type="hidden" name="id" value="${esc(key.id)}" />
      <div class="form-grid">
        <div>
          <label class="label">Key 名称</label>
          <input class="input" name="name" value="${esc(key.name)}" />
        </div>
        <div>
          <label class="label">状态</label>
          <select class="select" name="enabled">
            <option value="true" ${key.enabled ? 'selected' : ''}>启用</option>
            <option value="false" ${!key.enabled ? 'selected' : ''}>禁用</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">保存修改</button>
      </div>
    </form>
  `
}

function revealedKeyHtml(keyValue) {
  return `
    <div class="alert warning">该 Key 仅展示一次，建议立即复制并妥善保管。</div>
    <div class="revealed-key">
      <div class="mono">${esc(keyValue)}</div>
      <button id="copy-key" class="btn small">复制到剪贴板</button>
    </div>
  `
}

function bindCreateModal() {
  const form = document.getElementById('key-create-form')
  if (!form) return

  const createBtn = form.querySelector('button[type="submit"]')
  const btnText = createBtn.querySelector('.btn-text')

  form.onsubmit = async (event) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = {
      name: String(formData.get('name') || '').trim(),
      account_id: String(formData.get('account_id') || '')
    }
    const ownerId = String(formData.get('owner_id') || '').trim()

    if (!payload.name || !payload.account_id) {
      toast('请填写 Key 名称并选择关联账号', 'warning')
      return
    }

    if (ownerId) payload.owner_id = ownerId

    createBtn.disabled = true
    btnText.innerHTML = '<span class="loader"></span>'

    try {
      const data = await api('/keys', { method: 'POST', body: JSON.stringify(payload) })
      state.keys.revealedKey = data.key || ''
      toast('Key 已创建', 'success')
      // Update modal to show the revealed key
      const modalBody = document.querySelector('#_modal-overlay .modal-body')
      if (modalBody) {
        modalBody.innerHTML = revealedKeyHtml(state.keys.revealedKey)
        bindRevealedKeyModal()
      }
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      createBtn.disabled = false
      btnText.textContent = '创建 Key'
    }
  }
}

function bindRevealedKeyModal() {
  const copyBtn = document.getElementById('copy-key')
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(state.keys.revealedKey)
        toast('已复制到剪贴板', 'success')
      } catch {
        toast('复制失败', 'warning')
      }
    }
  }
}

function bindEditModal() {
  const form = document.getElementById('key-edit-form')
  if (!form) return

  form.onsubmit = async (event) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const id = String(formData.get('id') || '')
    const payload = {
      name: String(formData.get('name') || '').trim(),
      enabled: String(formData.get('enabled') || 'true') === 'true'
    }

    if (!payload.name) {
      toast('请填写 Key 名称', 'warning')
      return
    }

    try {
      await api(`/keys/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      closeModal()
      toast('Key 已更新', 'success')
      await renderKeys()
    } catch (error) {
      toast(error.message, 'error')
    }
  }
}

export async function renderKeys() {
  title('Key 管理')
  shell('keys', head('Key 管理', '管理代理 Key 与归属账号') + skeleton(6))

  const [accounts, keys, usersRes] = await Promise.all([
    api('/accounts'),
    api(`/keys${state.keys.filterAccountId ? `?account_id=${encodeURIComponent(state.keys.filterAccountId)}` : ''}`),
    api('/users').catch(() => ({ users: [] }))
  ])

  const accountMap = new Map(accounts.map((item) => [item.id, item]))
  const enabledCount = keys.filter((item) => item.enabled).length
  const disabledCount = keys.filter((item) => !item.enabled).length
  const usedCount = keys.filter((item) => item.last_used_at).length
  const accountOptions = accounts.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')
  const filterOptions = ['<option value="">所有账号</option>']
    .concat(accounts.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`))
    .join('')
  const userOptions = (usersRes.users || [])
    .map(
      (item) =>
        `<option value="${esc(item.id)}">${esc(item.username)}${item.role === 'admin' ? ' (admin)' : ''}</option>`
    )
    .join('')

  const rows = keys.map(
    (key) => `
      <tr>
        <td><strong>${esc(key.name)}</strong></td>
        <td>${esc(key.owner_username || key.owner_id || '-')}</td>
        <td>${esc(accountMap.get(key.account_id)?.name || key.account_id)}</td>
        <td><span class="mono small">${esc(key.masked_key || key.key || '-')}</span></td>
        <td>${badge(key.enabled ? 'enabled' : 'disabled')}</td>
        <td>${esc(key.request_count ?? 0)}</td>
        <td>${esc(formatDate(key.last_used_at))}</td>
        <td>
          <div class="actions">
            <button class="btn small" data-act="detail" data-id="${esc(key.id)}">详情</button>
            <button class="btn small" data-act="edit" data-id="${esc(key.id)}">编辑</button>
            <button class="btn small warning" data-act="regen" data-id="${esc(key.id)}">重置</button>
            <button class="btn small danger" data-act="delete" data-id="${esc(key.id)}">删除</button>
          </div>
        </td>
      </tr>
    `
  )

  shell(
    'keys',
    `
      ${head(
        'Key 管理',
        '管理代理 Key 与归属账号',
        '<button id="btn-create-key" class="btn primary">新增 Key</button>',
        [
          `Key 总数：${keys.length}`,
          `启用中：${enabledCount}`,
          `已关联账号：${accounts.length}`,
          `已产生请求：${usedCount}`
        ]
      )}

      <section class="stats-grid fade-in">
        <div class="card stat-card">
          <h3>全部 Key</h3>
          <div class="stat-value">${esc(keys.length)}</div>
          <div class="stat-help">当前筛选条件下的 Key 数量</div>
        </div>
        <div class="card stat-card">
          <h3>已启用</h3>
          <div class="stat-value">${esc(enabledCount)}</div>
          <div class="stat-help">可直接用于代理调用</div>
        </div>
        <div class="card stat-card">
          <h3>已禁用</h3>
          <div class="stat-value">${esc(disabledCount)}</div>
          <div class="stat-help">可在编辑中重新启用</div>
        </div>
        <div class="card stat-card">
          <h3>已使用</h3>
          <div class="stat-value">${esc(usedCount)}</div>
          <div class="stat-help">至少产生过一次代理请求</div>
        </div>
      </section>

      <section class="card fade-in">
        <div class="card-title">
          <h2>Key 列表</h2>
          <div class="toolbar-group">
            <select id="key-filter" class="select" style="width:200px;">${filterOptions}</select>
            <button id="keys-refresh" class="btn small">刷新</button>
          </div>
        </div>
        ${table(['名称', '归属用户', '关联账号', 'Key 值', '状态', '请求数', '最后使用', '操作'], rows, '暂无 Key')}
      </section>
    `
  )

  // Create Key button
  document.getElementById('btn-create-key').onclick = () => {
    showModal({ title: '新增 Key', body: createFormHtml(accountOptions || null, userOptions) })
    bindCreateModal()
  }

  document.getElementById('key-filter').value = state.keys.filterAccountId
  document.getElementById('key-filter').onchange = (event) => {
    state.keys.filterAccountId = event.target.value
    renderKeys()
  }

  document.getElementById('keys-refresh').onclick = () => renderKeys()

  // Table actions
  document.querySelectorAll('[data-act]').forEach((button) => {
    button.onclick = async () => {
      const key = keys.find((item) => item.id === button.dataset.id)
      if (!key) return

      const action = button.dataset.act

      if (action === 'detail') {
        location.hash = `#/key-detail?id=${encodeURIComponent(key.id)}`
        return
      }

      if (action === 'edit') {
        showModal({ title: '编辑 Key', body: editFormHtml(key) })
        bindEditModal()
        return
      }

      if (action === 'regen') {
        const confirmed = await showConfirm({
          title: '重新生成 Key',
          message: `确认重新生成 Key「${key.name}」？旧 Key 将立即失效。`,
          confirmText: '重新生成',
          danger: true
        })
        if (!confirmed) return

        try {
          const data = await api(`/keys/${key.id}/regenerate`, { method: 'POST' })
          state.keys.revealedKey = data.key || ''
          toast('Key 已重新生成', 'success')
          showModal({ title: '新 Key', body: revealedKeyHtml(state.keys.revealedKey) })
          bindRevealedKeyModal()
          await renderKeys()
        } catch (error) {
          toast(error.message, 'error')
        }
      }

      if (action === 'delete') {
        const confirmed = await showConfirm({
          title: '删除 Key',
          message: `确认删除 Key「${key.name}」？此操作不可撤销。`,
          confirmText: '删除',
          danger: true
        })
        if (!confirmed) return

        try {
          await api(`/keys/${key.id}`, { method: 'DELETE' })
          toast('Key 已删除', 'success')
          await renderKeys()
        } catch (error) {
          toast(error.message, 'error')
        }
      }
    }
  })
}
