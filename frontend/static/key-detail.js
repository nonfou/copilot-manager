import {
  title,
  shell,
  head,
  api,
  table,
  esc,
  formatDate,
  formatMs,
  formatTokens,
  codeBadge,
  state,
  usageText,
  badge,
  skeleton,
  accountTypeBadge
} from './common.js'

export async function renderKeyDetail() {
  title('Key 详情')
  shell('key-detail', head('Key 详情', '查看单个 Key 的关联账号、模型与请求日志') + skeleton(8))

  const hash = location.hash.split('?')[1] || ''
  const query = new URLSearchParams(hash)
  const keys = await api('/keys')
  const explicitId = query.get('id') || ''
  const id = explicitId || state.detail.keyId || keys[0]?.id || ''
  state.detail.keyId = id

  if (!id) {
    shell(
      'key-detail',
      `
        ${head('Key 详情', '查看单个 Key 的关联账号、模型与请求日志')}
        <section class="card">
          <div class="empty">暂无可用的 API Key</div>
        </section>
      `
    )
    return
  }

  const [key, res] = await Promise.all([api(`/keys/${id}`), api(`/logs?page=${state.detail.page}&limit=50&api_key_id=${encodeURIComponent(id)}`)])

  let usage = null
  let models = []
  if (key.account?.id) {
    try {
      usage = await api(`/accounts/${key.account.id}/usage`)
    } catch {}
    try {
      const data = await api(`/accounts/${key.account.id}/models`)
      models = Array.isArray(data.data) ? data.data : []
    } catch {}
  }

  const logs = res.logs || []
  const successCount = logs.filter((item) => Number(item.status_code) < 300).length
  const errorCount = logs.filter((item) => Number(item.status_code) >= 400).length
  const avgDuration =
    logs.length > 0
      ? Math.round(logs.reduce((sum, item) => sum + Number(item.duration_ms || 0), 0) / logs.length)
      : 0

  const options = keys
    .map(
      (item) => `
        <option value="${esc(item.id)}" ${item.id === id ? 'selected' : ''}>
          ${esc(item.name)}
        </option>
      `
    )
    .join('')

  const rows = logs.map(
    (item) => `
      <tr>
        <td>${esc(formatDate(item.created_at))}</td>
        <td><span class="mono">${esc(item.method || '-')}</span></td>
        <td>${esc(item.model || '-')}</td>
        <td>${esc(formatTokens(item))}</td>
        <td><span class="mono small">${esc(item.path || '-')}</span></td>
        <td>${codeBadge(item.status_code)}</td>
        <td>${esc(formatMs(item.duration_ms))}</td>
        <td>${esc(item.error || '-')}</td>
      </tr>
    `
  )

  const pages = Math.max(1, Math.ceil((res.total || 0) / 50))

  shell(
    'key-detail',
    `
      ${head(
        'Key 详情',
        '查看单个 Key 的关联账号、模型与请求日志',
        `
          <select id="detail-select" class="select" style="width:200px;">${options}</select>
          ${query.get('id') && state.user.role === 'admin' ? '<button id="detail-back" class="btn">返回</button>' : ''}
        `,
        [
          `Key 名称：${key.name}`,
          `日志总数：${res.total || 0}`,
          `模型数：${models.length}`,
          `状态：${key.enabled ? '启用' : '禁用'}`
        ]
      )}

      <section class="stats-grid fade-in">
        <div class="card stat-card">
          <h3>请求总数</h3>
          <div class="stat-value">${esc(key.request_count ?? 0)}</div>
          <div class="stat-help">当前 Key 累计产生的代理请求数</div>
        </div>
        <div class="card stat-card">
          <h3>当前页成功</h3>
          <div class="stat-value">${esc(successCount)}</div>
          <div class="stat-help">当前页日志中状态码小于 300 的请求数</div>
        </div>
        <div class="card stat-card">
          <h3>当前页错误</h3>
          <div class="stat-value">${esc(errorCount)}</div>
          <div class="stat-help">当前页日志中状态码大于等于 400 的请求数</div>
        </div>
        <div class="card stat-card">
          <h3>平均耗时</h3>
          <div class="stat-value">${esc(formatMs(avgDuration))}</div>
          <div class="stat-help">按当前页日志估算的平均响应耗时</div>
        </div>
      </section>

      <section class="card detail-hero fade-in">
        <div class="detail-hero-main">
          <div class="detail-title-row">
            <div>
              <div class="muted small">当前选中 Key</div>
              <h2 style="margin:6px 0 8px;">${esc(key.name)}</h2>
            </div>
            ${key.enabled ? '<span class="badge success">启用中</span>' : '<span class="badge danger">已禁用</span>'}
          </div>
          <div class="detail-pill-row">
            <span class="detail-pill">请求数：${esc(key.request_count ?? 0)}</span>
            <span class="detail-pill">最后使用：${esc(formatDate(key.last_used_at))}</span>
            <span class="detail-pill mono">${esc(key.masked_key || key.key || '-')}</span>
          </div>
        </div>
        <div class="detail-hero-side">
          <div class="muted small">归属用户</div>
          <div style="margin-top:8px;">${esc(key.owner_username || key.owner_id || state.user?.username || '-')}</div>
          ${
            key.account?.name
              ? `
                <div class="muted small" style="margin-top:12px;">关联账号</div>
                <div style="margin-top:8px;">${esc(key.account.name)}</div>
              `
              : ''
          }
        </div>
      </section>

      <section class="grid-3 fade-in">
        <div class="card">
          <div class="card-title">
            <h2>Key 信息</h2>
          </div>
          <div class="kv-list">
            <div class="kv-row"><div class="key">名称</div><div>${esc(key.name)}</div></div>
            <div class="kv-row"><div class="key">状态</div><div>${key.enabled ? badge('enabled') : badge('disabled')}</div></div>
            <div class="kv-row"><div class="key">Key 值</div><div class="mono small">${esc(key.masked_key || key.key || '-')}</div></div>
            <div class="kv-row"><div class="key">请求数</div><div>${esc(key.request_count ?? 0)}</div></div>
            <div class="kv-row"><div class="key">最后使用</div><div>${esc(formatDate(key.last_used_at))}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <h2>关联账号</h2>
          </div>
          ${
            key.account
              ? `
                <div class="kv-list">
                  <div class="kv-row"><div class="key">名称</div><div>${esc(key.account.name)}</div></div>
                  <div class="kv-row"><div class="key">类型</div><div>${accountTypeBadge(key.account.account_type)}</div></div>
                  <div class="kv-row"><div class="key">API 地址</div><div class="mono small">${esc(key.account.api_url)}</div></div>
                  <div class="kv-row"><div class="key">配额</div><div>${usageText(usage)}</div></div>
                </div>
              `
              : '<div class="empty">未关联账号</div>'
          }
        </div>

        <div class="card">
          <div class="card-title">
            <h2>可用模型</h2>
          </div>
          ${
            models.length
              ? `
                <div class="soft-list">
                  ${models
                    .map(
                      (item) => `
                        <div class="soft-item">
                          <span class="mono small">${esc(item.id)}</span>
                          ${item.display_name ? `<span class="muted">${esc(item.display_name)}</span>` : ''}
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
              : '<div class="empty">暂无模型信息</div>'
          }
        </div>
      </section>

      <section class="card fade-in">
        <div class="card-title">
          <h2>请求日志</h2>
          <div class="toolbar-group">
            <span class="metric-pill">成功 ${esc(successCount)}</span>
            <span class="metric-pill">错误 ${esc(errorCount)}</span>
            <button id="detail-refresh" class="btn small">刷新</button>
          </div>
        </div>
        ${table(['时间', '方法', '模型', 'Tokens', '路径', '状态', '耗时', '错误'], rows, '暂无日志')}
        <div class="pagination">
          <button id="detail-prev" class="btn small" ${state.detail.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="muted small">第 ${esc(state.detail.page)} / ${esc(pages)} 页（共 ${esc(res.total || 0)} 条）</span>
          <button id="detail-next" class="btn small" ${state.detail.page >= pages ? 'disabled' : ''}>下一页</button>
        </div>
      </section>
    `
  )

  document.getElementById('detail-select').onchange = (event) => {
    state.detail.page = 1
    state.detail.keyId = event.target.value
    location.hash = `#/key-detail?id=${encodeURIComponent(event.target.value)}`
  }

  if (document.getElementById('detail-back')) {
    document.getElementById('detail-back').onclick = () => history.back()
  }

  document.getElementById('detail-refresh').onclick = () => renderKeyDetail()
  document.getElementById('detail-prev').onclick = () => {
    if (state.detail.page > 1) {
      state.detail.page -= 1
      renderKeyDetail()
    }
  }
  document.getElementById('detail-next').onclick = () => {
    if (state.detail.page < pages) {
      state.detail.page += 1
      renderKeyDetail()
    }
  }
}
