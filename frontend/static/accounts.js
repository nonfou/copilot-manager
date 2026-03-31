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
  usageText,
  stopOAuth,
  accountTypeBadge,
  showConfirm,
  skeleton
} from './common.js'

async function loadData() {
  const accounts = await api('/accounts')
  const usageMap = new Map(
    await Promise.all(
      accounts.map(async (account) => {
        try {
          return [account.id, await api(`/accounts/${account.id}/usage`)]
        } catch {
          return [account.id, null]
        }
      })
    )
  )
  return { accounts, usageMap }
}

function createHtml() {
  const mode = state.accounts.mode
  const oauth = state.accounts.oauth
  const tabDefs = [
    ['oauth', 'GitHub OAuth', '推荐的授权方式，适合在线快速添加账号'],
    ['token', '直接粘贴 Token', '适合你已经持有 ghu_xxx Token 的场景'],
    ['apionly', '仅 API 地址', '适合账号与凭证由系统外部统一维护']
  ]

  return `
    <div class="split-panel">
      <div>
        <div class="tabs">
          ${tabDefs
            .map(
              ([key, label, description]) => `
                <button type="button" class="tab-btn ${mode === key ? 'active' : ''}" data-mode="${key}">
                  <span class="tab-label">${label}</span>
                  <span class="tab-desc">${description}</span>
                </button>
              `
            )
            .join('')}
        </div>

        <form id="account-create-form">
          <div class="form-grid">
            <div>
              <label class="label">账号名称</label>
              <input class="input" name="name" placeholder="例如：main-account" />
              <div class="form-help">建议使用能体现用途的名称，便于后续绑定 Key。</div>
            </div>
            <div>
              <label class="label">账号类型</label>
              <select class="select" name="account_type">
                <option value="individual">个人版</option>
                <option value="business">商业版</option>
                <option value="enterprise">企业版</option>
              </select>
            </div>
            <div class="full">
              <label class="label">copilot-api 地址</label>
              <input class="input" name="api_url" placeholder="http://localhost:8080" />
              <div class="form-help">建议填写稳定的内网地址或反向代理地址，避免后续 Key 调用失败。</div>
            </div>
            ${
              mode === 'token'
                ? `
                  <div class="full">
                    <label class="label">GitHub Token</label>
                    <input class="input" name="github_token" placeholder="ghu_xxx" />
                  </div>
                `
                : ''
            }
          </div>
          <div class="form-actions">
            <button class="btn primary">${mode === 'oauth' ? '开始授权' : '创建账号'}</button>
          </div>
        </form>
      </div>

      <aside class="panel-note">
        <h3>${
          mode === 'oauth'
            ? '推荐：OAuth 授权'
            : mode === 'token'
              ? '手动输入 Token'
              : '仅登记 API 地址'
        }</h3>
        <p>${
          mode === 'oauth'
            ? '适合在线授权，无需手动复制 GitHub Token。授权完成后会自动轮询结果。'
            : mode === 'token'
              ? '适合你已经持有 ghu_xxx Token，想直接写入系统。'
              : '适合 copilot-api 实例由外部托管，当前系统仅做路由与管理。'
        }</p>
        <ul>
          <li>账号创建后即可在 Key 管理中分配代理 Key</li>
          <li>配额和模型信息可随时手动刷新</li>
          <li>建议按“环境 / 用途 / 负责人”命名账号</li>
        </ul>
      </aside>
    </div>

    ${
      oauth
        ? `
          <div class="details-box" style="margin-top:16px;">
            <div class="alert info">请在浏览器完成 GitHub 授权，系统会自动轮询结果。</div>
            <div class="kv-list">
              <div class="kv-row">
                <div class="key">授权地址</div>
                <div><a class="btn link" target="_blank" rel="noreferrer" href="${esc(oauth.verification_uri)}">${esc(oauth.verification_uri)}</a></div>
              </div>
              <div class="kv-row">
                <div class="key">用户代码</div>
                <div class="revealed-key">
                  <span class="mono">${esc(oauth.user_code)}</span>
                  <button id="oauth-copy" class="btn small">复制</button>
                </div>
              </div>
            </div>
            <div class="form-actions">
              <button id="oauth-cancel" class="btn">取消等待</button>
            </div>
          </div>
        `
        : ''
    }
  `
}

function editHtml(account) {
  if (!account) return ''

  return `
    <section class="card">
      <div class="card-title">
        <h2>编辑账号</h2>
      </div>

      <form id="account-edit-form">
        <div class="section-tip">仅在需要时填写新的 GitHub Token；留空则保持不变。</div>
        <input type="hidden" name="id" value="${esc(account.id)}" />
        <div class="form-grid">
          <div>
            <label class="label">账号名称</label>
            <input class="input" name="name" value="${esc(account.name)}" />
          </div>
          <div>
            <label class="label">账号类型</label>
            <select class="select" name="account_type">
              <option value="individual" ${account.account_type === 'individual' ? 'selected' : ''}>个人版</option>
              <option value="business" ${account.account_type === 'business' ? 'selected' : ''}>商业版</option>
              <option value="enterprise" ${account.account_type === 'enterprise' ? 'selected' : ''}>企业版</option>
            </select>
          </div>
          <div class="full">
            <label class="label">copilot-api 地址</label>
            <input class="input" name="api_url" value="${esc(account.api_url)}" />
          </div>
          <div class="full">
            <label class="label">新的 GitHub Token（可选）</label>
            <input class="input" name="github_token" placeholder="留空则不修改" />
          </div>
        </div>
        <div class="form-actions">
          <button id="edit-cancel" type="button" class="btn">取消</button>
          <button class="btn primary">保存修改</button>
        </div>
      </form>
    </section>
  `
}

function modelsHtml() {
  const modelsState = state.accounts.models
  if (!modelsState) return ''

  return `
    <section class="card">
      <div class="card-title">
        <h2>可用模型 - ${esc(modelsState.name)}</h2>
        <div class="row wrap">
          <button id="models-refresh" class="btn small">刷新模型</button>
          <button id="models-close" class="btn small">关闭</button>
        </div>
      </div>

      ${
        modelsState.loading
          ? '<div class="row"><span class="loader"></span><span class="muted">加载中...</span></div>'
          : table(
              ['模型 ID', '展示名称'],
              (modelsState.data || []).map(
                (item) => `
                  <tr>
                    <td><span class="mono">${esc(item.id)}</span></td>
                    <td>${esc(item.display_name || '-')}</td>
                  </tr>
                `
              ),
              '暂无模型数据'
            )
      }
    </section>
  `
}

async function poll(authId, interval) {
  stopOAuth()
  state.accounts.timer = setTimeout(async () => {
    try {
      const data = await api(`/accounts/auth/poll/${authId}`)
      if (data.status === 'success') {
        state.accounts.oauth = null
        toast(`账号「${data.account?.name || '新账号'}」已添加`, 'success')
        await renderAccounts()
        return
      }
      if (data.status === 'expired') {
        state.accounts.oauth = null
        toast('授权已过期，请重新尝试', 'warning')
        await renderAccounts()
        return
      }
      poll(authId, interval)
    } catch (error) {
      state.accounts.oauth = null
      toast(error.message, 'error')
      if (state.activeRoute === 'accounts') await renderAccounts()
    }
  }, interval * 1000)
}

async function loadModels(account) {
  state.accounts.models = { accountId: account.id, name: account.name, loading: true, data: [] }
  await renderAccounts()

  try {
    const data = await api(`/accounts/${account.id}/models?refresh=true`)
    state.accounts.models = {
      accountId: account.id,
      name: account.name,
      loading: false,
      data: Array.isArray(data.data) ? data.data : []
    }
  } catch (error) {
    state.accounts.models = { accountId: account.id, name: account.name, loading: false, data: [] }
    toast(error.message, 'error')
  }

  if (state.activeRoute === 'accounts') await renderAccounts()
}

export async function renderAccounts() {
  title('账号管理')
  shell('accounts', head('账号管理', '管理 copilot-api 账号与授权方式') + skeleton(6))

  const { accounts, usageMap } = await loadData()
  const edit = accounts.find((item) => item.id === state.accounts.editId)
  const individualCount = accounts.filter((item) => item.account_type === 'individual').length
  const businessCount = accounts.filter((item) => item.account_type === 'business').length
  const enterpriseCount = accounts.filter((item) => item.account_type === 'enterprise').length
  const usageLoadedCount = accounts.filter((item) => usageMap.get(item.id)).length

  const rows = accounts.map(
    (account) => `
      <tr>
        <td>
          <strong>${esc(account.name)}</strong>
          <div class="muted small mono">${esc(account.id)}</div>
        </td>
        <td>
          <div class="mono small">${esc(account.api_url)}</div>
          <div class="muted small">建议保持可稳定访问</div>
        </td>
        <td>${accountTypeBadge(account.account_type)}</td>
        <td>${usageText(usageMap.get(account.id))}</td>
        <td>${esc(formatDate(account.created_at))}</td>
        <td>
          <div class="actions">
            <button class="btn small" data-act="usage" data-id="${esc(account.id)}">刷新配额</button>
            <button class="btn small" data-act="models" data-id="${esc(account.id)}">查看模型</button>
            <button class="btn small" data-act="edit" data-id="${esc(account.id)}">编辑</button>
            <button class="btn small danger" data-act="delete" data-id="${esc(account.id)}">删除</button>
          </div>
        </td>
      </tr>
    `
  )

  shell(
    'accounts',
    `
      ${head(
        '账号管理',
        '管理 copilot-api 账号与授权方式',
        '',
        [
          `账号总数：${accounts.length}`,
          `配额可见：${usageLoadedCount}`,
          `授权模式：${state.accounts.mode === 'oauth' ? 'OAuth' : state.accounts.mode === 'token' ? 'Token' : '仅 API'}`
        ]
      )}

      <section class="stats-grid fade-in">
        <div class="card stat-card">
          <h3>全部账号</h3>
          <div class="stat-value">${esc(accounts.length)}</div>
          <div class="stat-help">当前系统已接入的账号总数</div>
        </div>
        <div class="card stat-card">
          <h3>个人版</h3>
          <div class="stat-value">${esc(individualCount)}</div>
          <div class="stat-help">适合个人开发与轻量使用</div>
        </div>
        <div class="card stat-card">
          <h3>商业版</h3>
          <div class="stat-value">${esc(businessCount)}</div>
          <div class="stat-help">适合团队内部共享场景</div>
        </div>
        <div class="card stat-card">
          <h3>企业版</h3>
          <div class="stat-value">${esc(enterpriseCount)}</div>
          <div class="stat-help">适合有统一治理要求的环境</div>
        </div>
      </section>

      <section class="card">
        <div class="card-title">
          <h2>添加账号</h2>
        </div>
        ${createHtml()}
      </section>

      ${editHtml(edit)}

      <section class="card">
        <div class="card-title">
          <h2>账号列表</h2>
          <div class="toolbar-group">
            <span class="metric-pill">已加载配额 ${esc(usageLoadedCount)} / ${esc(accounts.length)}</span>
            <button id="accounts-refresh" class="btn small">刷新</button>
          </div>
        </div>
        <div class="inline-note">你可以先刷新配额确认账号健康度，再查看模型列表决定是否分配 Key。</div>
        ${table(['名称', 'API 地址', '类型', '配额', '创建时间', '操作'], rows, '暂无账号')}
      </section>

      ${modelsHtml()}
    `
  )

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.onclick = () => {
      state.accounts.mode = button.dataset.mode
      renderAccounts()
    }
  })

  document.getElementById('accounts-refresh').onclick = () => renderAccounts()

  document.getElementById('account-create-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = {
      name: String(form.get('name') || '').trim(),
      api_url: String(form.get('api_url') || '').trim(),
      account_type: String(form.get('account_type') || 'individual'),
      github_token: String(form.get('github_token') || '').trim()
    }

    if (!body.name || !body.api_url) {
      toast('请填写账号名称和 API 地址', 'warning')
      return
    }

    try {
      if (state.accounts.mode === 'oauth') {
        const data = await api('/accounts/auth/start', {
          method: 'POST',
          body: JSON.stringify({
            name: body.name,
            api_url: body.api_url,
            account_type: body.account_type
          })
        })
        state.accounts.oauth = data
        poll(data.auth_id, data.interval || 5)
        toast('已开始 GitHub 授权', 'info')
      } else if (state.accounts.mode === 'token') {
        if (!body.github_token) {
          toast('请填写 GitHub Token', 'warning')
          return
        }
        await api('/accounts', { method: 'POST', body: JSON.stringify(body) })
        toast('账号已创建', 'success')
      } else {
        await api('/accounts', {
          method: 'POST',
          body: JSON.stringify({
            name: body.name,
            api_url: body.api_url,
            account_type: body.account_type
          })
        })
        toast('账号已创建', 'success')
      }

      await renderAccounts()
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  if (document.getElementById('oauth-copy')) {
    document.getElementById('oauth-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(state.accounts.oauth.user_code)
        toast('授权码已复制', 'success')
      } catch {
        toast('复制失败', 'warning')
      }
    }

    document.getElementById('oauth-cancel').onclick = () => {
      stopOAuth()
      state.accounts.oauth = null
      renderAccounts()
    }
  }

  if (document.getElementById('account-edit-form')) {
    document.getElementById('edit-cancel').onclick = () => {
      state.accounts.editId = ''
      renderAccounts()
    }

    document.getElementById('account-edit-form').onsubmit = async (event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const id = String(form.get('id'))
      const payload = {
        name: String(form.get('name') || '').trim(),
        api_url: String(form.get('api_url') || '').trim(),
        account_type: String(form.get('account_type') || 'individual')
      }
      const token = String(form.get('github_token') || '').trim()

      if (!payload.name || !payload.api_url) {
        toast('请填写账号名称和 API 地址', 'warning')
        return
      }

      if (token) payload.github_token = token

      try {
        await api(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        state.accounts.editId = ''
        toast('账号已更新', 'success')
        await renderAccounts()
      } catch (error) {
        toast(error.message, 'error')
      }
    }
  }

  document.querySelectorAll('[data-act]').forEach((button) => {
    button.onclick = async () => {
      const account = accounts.find((item) => item.id === button.dataset.id)
      if (!account) return

      const action = button.dataset.act
      if (action === 'usage') {
        try {
          await api(`/accounts/${account.id}/usage?refresh=true`)
          toast(`已刷新 ${account.name} 的配额`, 'success')
          await renderAccounts()
        } catch (error) {
          toast(error.message, 'error')
        }
      }

      if (action === 'models') await loadModels(account)

      if (action === 'edit') {
        state.accounts.editId = account.id
        await renderAccounts()
      }

      if (action === 'delete') {
        const confirmed = await showConfirm({
          title: '删除账号',
          message: `确认删除账号「${account.name}」？关联 Key 也会一并删除。`,
          confirmText: '删除',
          danger: true
        })
        if (!confirmed) return
        try {
          await api(`/accounts/${account.id}`, { method: 'DELETE' })
          if (state.accounts.models?.accountId === account.id) state.accounts.models = null
          state.accounts.editId = ''
          toast('账号已删除', 'success')
          await renderAccounts()
        } catch (error) {
          toast(error.message, 'error')
        }
      }
    }
  })

  if (document.getElementById('models-close')) {
    document.getElementById('models-close').onclick = () => {
      state.accounts.models = null
      renderAccounts()
    }

    document.getElementById('models-refresh').onclick = async () => {
      const account = accounts.find((item) => item.id === state.accounts.models?.accountId)
      if (account) await loadModels(account)
    }
  }
}
