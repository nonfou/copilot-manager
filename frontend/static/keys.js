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
  skeleton
} from './common.js'

export async function renderKeys() {
  title('Key 管理')
  shell('keys', head('Key 管理', '管理代理 Key 与归属账号') + skeleton(6))

  const [accounts, keys, usersRes] = await Promise.all([
    api('/accounts'),
    api(`/keys${state.keys.filterAccountId ? `?account_id=${encodeURIComponent(state.keys.filterAccountId)}` : ''}`),
    api('/users').catch(() => ({ users: [] }))
  ])

  const edit = keys.find((item) => item.id === state.keys.editId)
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
        '',
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
          <div class="stat-help">可在编辑表单中重新启用</div>
        </div>
        <div class="card stat-card">
          <h3>已使用</h3>
          <div class="stat-value">${esc(usedCount)}</div>
          <div class="stat-help">至少产生过一次代理请求</div>
        </div>
      </section>

      ${
        state.keys.revealedKey
          ? `
            <section class="card fade-in">
              <div class="card-title">
                <h2>新生成的 Key</h2>
                <button id="hide-key" class="btn small">隐藏</button>
              </div>
              <div class="details-box">
                <div class="alert warning">该 Key 仅展示一次，建议立即复制并妥善保管。</div>
                <div class="revealed-key">
                  <div class="mono">${esc(state.keys.revealedKey)}</div>
                  <button id="copy-key" class="btn small">复制到剪贴板</button>
                </div>
              </div>
            </section>
          `
          : ''
      }

      <section class="card fade-in">
        <div class="card-title">
          <h2>创建 Key</h2>
        </div>
        ${
          accounts.length
            ? `
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
            : '<div class="alert warning">请先在账号管理中创建至少一个账号，再生成代理 Key。</div>'
        }
      </section>

      ${
        edit
          ? `
            <section class="card fade-in">
              <div class="card-title">
                <h2>编辑 Key</h2>
              </div>
              <form id="key-edit-form">
                <input type="hidden" name="id" value="${esc(edit.id)}" />
                <div class="form-grid">
                  <div>
                    <label class="label">Key 名称</label>
                    <input class="input" name="name" value="${esc(edit.name)}" />
                  </div>
                  <div>
                    <label class="label">状态</label>
                    <select class="select" name="enabled">
                      <option value="true" ${edit.enabled ? 'selected' : ''}>启用</option>
                      <option value="false" ${!edit.enabled ? 'selected' : ''}>禁用</option>
                    </select>
                  </div>
                </div>
                <div class="form-actions">
                  <button id="key-edit-cancel" type="button" class="btn">取消</button>
                  <button type="submit" class="btn primary">保存修改</button>
                </div>
              </form>
            </section>
          `
          : ''
      }

      <section class="card fade-in">
        <div class="card-title">
          <h2>Key 列表</h2>
          <div class="toolbar-group">
            <select id="key-filter" class="select" style="width:200px;">${filterOptions}</select>
            <button id="keys-refresh" class="btn small">刷新</button>
          </div>
        </div>
        <div class="inline-note">建议按账号或使用场景拆分 Key，方便配额排查与日志追踪。</div>
        ${table(['名称', '归属用户', '关联账号', 'Key 值', '状态', '请求数', '最后使用', '操作'], rows, '暂无 Key')}
      </section>
    `
  )

  document.getElementById('key-filter').value = state.keys.filterAccountId
  document.getElementById('key-filter').onchange = (event) => {
    state.keys.filterAccountId = event.target.value
    renderKeys()
  }

  document.getElementById('keys-refresh').onclick = () => renderKeys()

  if (document.getElementById('hide-key')) {
    document.getElementById('hide-key').onclick = () => {
      state.keys.revealedKey = ''
      renderKeys()
    }

    document.getElementById('copy-key').onclick = async () => {
      try {
        await navigator.clipboard.writeText(state.keys.revealedKey)
        toast('已复制到剪贴板', 'success')
      } catch {
        toast('复制失败', 'warning')
      }
    }
  }

  const createForm = document.getElementById('key-create-form')
  if (createForm) {
    const createBtn = createForm.querySelector('button[type="submit"]')
    const btnText = createBtn.querySelector('.btn-text')

    createForm.onsubmit = async (event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const payload = {
        name: String(form.get('name') || '').trim(),
        account_id: String(form.get('account_id') || '')
      }
      const ownerId = String(form.get('owner_id') || '').trim()

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
        await renderKeys()
      } catch (error) {
        toast(error.message, 'error')
      } finally {
        createBtn.disabled = false
        btnText.textContent = '创建 Key'
      }
    }
  }

  if (document.getElementById('key-edit-form')) {
    document.getElementById('key-edit-cancel').onclick = () => {
      state.keys.editId = ''
      renderKeys()
    }

    document.getElementById('key-edit-form').onsubmit = async (event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const id = String(form.get('id') || '')
      const payload = {
        name: String(form.get('name') || '').trim(),
        enabled: String(form.get('enabled') || 'true') === 'true'
      }

      if (!payload.name) {
        toast('请填写 Key 名称', 'warning')
        return
      }

      try {
        await api(`/keys/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        state.keys.editId = ''
        toast('Key 已更新', 'success')
        await renderKeys()
      } catch (error) {
        toast(error.message, 'error')
      }
    }
  }

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
        state.keys.editId = key.id
        await renderKeys()
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
          state.keys.editId = ''
          toast('Key 已删除', 'success')
          await renderKeys()
        } catch (error) {
          toast(error.message, 'error')
        }
      }
    }
  })
}
