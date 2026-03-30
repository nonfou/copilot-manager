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
  badge,
  state
} from './common.js'

export async function renderDashboard() {
  title('仪表盘')
  shell('dashboard', head('仪表盘', '系统整体运行状态概览') + '<div class="card"><span class="loader"></span></div>')

  const [stats, logsRes] = await Promise.all([api('/stats'), api('/logs?limit=20')])
  const logs = logsRes.logs || []
  const successCount = logs.filter((item) => Number(item.status_code) < 300).length
  const errorCount = logs.filter((item) => Number(item.status_code) >= 400).length
  const avgDuration =
    logs.length > 0
      ? Math.round(logs.reduce((sum, item) => sum + Number(item.duration_ms || 0), 0) / logs.length)
      : 0
  const modelCount = new Set(logs.map((item) => item.model).filter(Boolean)).size

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
      </tr>
    `
  )

  shell(
    'dashboard',
    `
      ${head(
        '仪表盘',
        '系统整体运行状态概览',
        '<button id="dashboard-refresh" class="btn">刷新</button>',
        [
          `当前用户：${state.user?.username || '-'}`,
          `最近日志：${logs.length} 条`,
          `最近模型：${modelCount} 个`
        ]
      )}

      <section class="stats-grid">
        <div class="card stat-card">
          <h3>📦 账号总数</h3>
          <div class="stat-value">${esc(stats.total_accounts ?? '-')}</div>
          <div class="stat-help">当前托管的 copilot-api 账号数</div>
        </div>
        <div class="card stat-card">
          <h3>🔑 启用 Key</h3>
          <div class="stat-value">${esc(stats.enabled_keys ?? '-')}</div>
          <div class="stat-help">可直接用于代理调用的 Key 数量</div>
        </div>
        <div class="card stat-card">
          <h3>📈 今日请求</h3>
          <div class="stat-value">${esc(stats.today_requests ?? '-')}</div>
          <div class="stat-help">按日志统计的今日代理请求</div>
        </div>
        <div class="card stat-card">
          <h3>🧾 历史总请求</h3>
          <div class="stat-value">${esc(stats.total_requests ?? '-')}</div>
          <div class="stat-help">累计记录到日志的请求总数</div>
        </div>
      </section>

      <section class="insight-grid">
        <div class="soft-card">
          <h3>请求健康度</h3>
          <div class="soft-list">
            <div class="soft-item"><span>成功响应</span><strong>${esc(successCount)} 条</strong></div>
            <div class="soft-item"><span>失败响应</span><strong>${esc(errorCount)} 条</strong></div>
            <div class="soft-item"><span>平均耗时</span><strong>${esc(formatMs(avgDuration))}</strong></div>
          </div>
        </div>
        <div class="soft-card">
          <h3>当前运行环境</h3>
          <div class="soft-list">
            <div class="soft-item"><span>登录用户</span><strong>${esc(state.user?.username || '-')}</strong></div>
            <div class="soft-item"><span>访问角色</span><strong>${badge(state.user?.role || 'user')}</strong></div>
            <div class="soft-item"><span>前端架构</span><strong>原生 HTML / CSS / JS</strong></div>
            <div class="soft-item"><span>数据库驱动</span><strong>纯 Go SQLite</strong></div>
          </div>
        </div>
        <div class="soft-card">
          <h3>轻量部署提示</h3>
          <div class="soft-list">
            <div class="soft-item"><span>适用场景</span><strong>小内存服务器 / Docker</strong></div>
            <div class="soft-item"><span>维护建议</span><strong>定期刷新账号配额与模型</strong></div>
            <div class="soft-item"><span>排障入口</span><strong>优先检查请求日志与 Key 详情</strong></div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-title">
          <h2>最近请求</h2>
          <div class="metric-row">
            <span class="metric-pill">成功 ${esc(successCount)}</span>
            <span class="metric-pill">失败 ${esc(errorCount)}</span>
            <span class="metric-pill">平均耗时 ${esc(formatMs(avgDuration))}</span>
          </div>
        </div>
        ${table(['时间', '账号', 'Key', '方法', '模型', 'Tokens', '路径', '状态', '耗时'], rows, '暂无请求日志')}
      </section>
    `
  )

  document.getElementById('dashboard-refresh').onclick = () => renderDashboard()
}
