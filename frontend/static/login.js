import { authShell, state, title, api, checkAuth, toast, defaultRoute, go } from './common.js'

export async function renderLogin() {
  title('登录')

  authShell(`
    <section class="login-card">
      <div class="login-mark">🤖</div>
      <h1 class="login-title">Copilot Manager</h1>
      <p class="login-subtitle">多账号 GitHub Copilot 代理管理系统<br/>轻量静态管理台 · 适合小内存服务器部署</p>

      <div class="login-feature-list">
        <div class="login-feature">
          <span>🔒</span>
          <span><strong>Session 登录</strong>基于安全 Cookie 管理会话，无需额外前端构建链。</span>
        </div>
        <div class="login-feature">
          <span>⚡</span>
          <span><strong>轻量部署</strong>原生静态页面 + Go 后端，适合资源受限环境快速上线。</span>
        </div>
      </div>

      ${
        state.initialized
          ? '<div class="alert info">登录后可统一管理账号、Key、日志与用户。</div>'
          : '<div class="alert warning">系统未初始化，请先通过命令行创建管理员账号。</div>'
      }

      <div id="login-error" class="alert error hidden"></div>

      <form id="login-form">
        <label class="label">用户名</label>
        <input id="login-user" class="input" autocomplete="username" placeholder="请输入用户名" />

        <label class="label" style="margin-top:14px;">密码</label>
        <div class="input-with-action">
          <input id="login-pass" class="input" type="password" autocomplete="current-password" placeholder="请输入密码" />
          <button id="toggle-password" type="button" class="field-action">显示</button>
        </div>

        <div class="login-meta">
          <span>Session 登录</span>
          <span>安全 Cookie</span>
        </div>

        <div class="form-actions" style="margin-top:20px;">
          <button id="login-btn" class="btn primary" style="width:100%;" ${state.initialized ? '' : 'disabled'}>登录</button>
        </div>
      </form>
    </section>
  `)

  const errorBox = document.getElementById('login-error')
  const passwordInput = document.getElementById('login-pass')
  const toggleButton = document.getElementById('toggle-password')

  toggleButton.onclick = () => {
    const isPassword = passwordInput.type === 'password'
    passwordInput.type = isPassword ? 'text' : 'password'
    toggleButton.textContent = isPassword ? '隐藏' : '显示'
  }

  document.getElementById('login-form').onsubmit = async (event) => {
    event.preventDefault()
    errorBox.classList.add('hidden')

    const username = document.getElementById('login-user').value.trim()
    const password = passwordInput.value
    if (!username || !password) {
      errorBox.textContent = '请输入用户名和密码'
      errorBox.classList.remove('hidden')
      return
    }

    const button = document.getElementById('login-btn')
    button.disabled = true
    button.textContent = '登录中...'

    try {
      await api(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ username, password }) },
        { allow401: true }
      )
      await checkAuth()
      toast('登录成功', 'success')
      go(defaultRoute())
    } catch (error) {
      errorBox.textContent = error.message
      errorBox.classList.remove('hidden')
    } finally {
      button.disabled = !state.initialized
      button.textContent = '登录'
    }
  }
}
