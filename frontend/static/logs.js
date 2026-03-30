import { title, shell, head, api, table, esc, formatDate, formatMs, formatTokens, codeBadge, state } from './common.js'

export async function renderLogs() {
  title('请求日志')
  shell('logs', head('请求日志', '查看最近代理请求记录') + '<div class="card"><span class="loader"></span></div>')

  const [accounts, res] = await Promise.all([
    api('/accounts'),
    api(`/logs?page=${state.logs.page}&limit=50${state.logs.filterAccountId ? `&account_id=${encodeURIComponent(state.logs.filterAccountId)}` : ''}`)
  ])

  const logs = res.logs || []
  const successCount = logs.filter((item) => Number(item.status_code) < 300).length
  const errorCount = logs.filter((item) => Number(item.status_code) >= 400).length
  const slowCount = logs.filter((item) => Number(item.duration_ms || 0) >= 3000).length
  const avgDuration =
    logs.length > 0
      ? Math.round(logs.reduce((sum, item) => sum + Number(item.duration_ms || 0), 0) / logs.length)
      : 0

  const rows = logs.map(
    (item) => `
      <tr>
        <td>${esc(formatDate(item.created_at))}</td>
        <td>${esc(item.account_name || '-')}</td>
        <td>${esc(item.api_key_name || '-')}</td>
        <td><span class="mono">${esc(item.method || '-')}</span></td>
        <td>${esc(item.model || '-')}</td>
        <td>${esc(formatTokens(item))}</td>
        <td><span class="mono small">${esc(item.path || '-')}</span></td>
        <td>${codeBadge(item.status_code)}</td>
        <td>${esc(formatMs(item.duration_ms))}</td>
        <td>${item.first_token_ms != null ? esc(formatMs(item.first_token_ms)) : '-'}</td>
        <td>${esc(item.error || '-')}</td>
      </tr>
    `
  )

  const pages = Math.max(1, Math.ceil((res.total || 0) / 50))
  const options = ['<option value="">所有账号</option>']
    .concat(accounts.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`))
    .join('')

  shell(
    'logs',
    `
      ${head(
        '请求日志',
        '查看最近代理请求记录',
        '<button id="logs-refresh" class="btn">刷新</button>',
        [
          `当前页：${state.logs.page} / ${pages}`,
          `总记录：${res.total || 0}`,
          `账号筛选：${state.logs.filterAccountId ? '已启用' : '全部'}`
        ]
      )}

      <section class="stats-grid">
        <div class="card stat-card">
          <h3>📄 当前页日志</h3>
          <div class="stat-value">${esc(logs.length)}</div>
          <div class="stat-help">每页最多展示 50 条请求记录</div>
        </div>
        <div class="card stat-card">
          <h3>✅ 成功请求</h3>
          <div class="stat-value">${esc(successCount)}</div>
          <div class="stat-help">状态码小于 300 的记录数</div>
        </div>
        <div class="card stat-card">
          <h3>⚠️ 错误请求</h3>
          <div class="stat-value">${esc(errorCount)}</div>
          <div class="stat-help">状态码大于等于 400 的记录数</div>
        </div>
        <div class="card stat-card">
          <h3>🐢 慢请求</h3>
          <div class="stat-value">${esc(slowCount)}</div>
          <div class="stat-help">耗时大于等于 3 秒的记录数</div>
        </div>
      </section>

      <section class="card">
        <div class="card-title">
          <h2>日志列表</h2>
          <div class="toolbar-group">
            <select id="logs-filter" class="select" style="width:220px;">${options}</select>
            <button id="logs-refresh-secondary" class="btn small">刷新数据</button>
          </div>
        </div>
        <div class="inline-note">建议先按账号筛选，再结合状态码、首 Token 与错误信息定位问题。</div>
        <div class="metric-row" style="margin-bottom:14px;">
          <span class="metric-pill">平均耗时 ${esc(formatMs(avgDuration))}</span>
          <span class="metric-pill">慢请求 ${esc(slowCount)}</span>
          <span class="metric-pill">错误 ${esc(errorCount)}</span>
        </div>
        ${table(['时间', '账号', 'Key', '方法', '模型', 'Tokens', '路径', '状态', '耗时', '首 Token', '错误'], rows, '暂无日志')}
        <div class="pagination">
          <button id="logs-prev" class="btn small" ${state.logs.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="muted small">第 ${esc(state.logs.page)} / ${esc(pages)} 页（共 ${esc(res.total || 0)} 条）</span>
          <button id="logs-next" class="btn small" ${state.logs.page >= pages ? 'disabled' : ''}>下一页</button>
        </div>
      </section>
    `
  )

  document.getElementById('logs-filter').value = state.logs.filterAccountId
  document.getElementById('logs-filter').onchange = (event) => {
    state.logs.filterAccountId = event.target.value
    state.logs.page = 1
    renderLogs()
  }

  document.getElementById('logs-refresh').onclick = () => renderLogs()
  document.getElementById('logs-refresh-secondary').onclick = () => renderLogs()
  document.getElementById('logs-prev').onclick = () => {
    if (state.logs.page > 1) {
      state.logs.page -= 1
      renderLogs()
    }
  }
  document.getElementById('logs-next').onclick = () => {
    if (state.logs.page < pages) {
      state.logs.page += 1
      renderLogs()
    }
  }
}
