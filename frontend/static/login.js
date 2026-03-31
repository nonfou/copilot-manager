import { authShell, state, title, api, checkAuth, toast, defaultRoute, go, esc } from './common.js'

export async function renderLogin() {
  title('登录')

  authShell(`
    <section class="login-card">
      <div class="login-mark">⚡</div>
      <h1 class="login-title">Copilot Manager</h1>
      <p class="login-subtitle">多账号 GitHub Copilot 代理管理系统</p>

      ${
        state.initialized
          ? ''
          : '<div class="alert warning">系统未初始化，请先通过命令行创建管理员账号。</div>'
      }

      <div id="login-error" class="alert error hidden"></div>

      <form id="login-form">
        <label class="label">用户名</label>
        <input id="login-user" class="input" autocomplete="username" placeholder="请输入用户名" ${state.initialized ? '' : 'disabled'} />

        <label class="label" style="margin-top:12px;">密码</label>
        <div class="input-with-action">
          <input id="login-pass" class="input" type="password" autocomplete="current-password" placeholder="请输入密码" ${state.initialized ? '' : 'disabled'} />
          <button id="toggle-password" type="button" class="field-action">显示</button>
        </div>

        <div class="form-actions" style="margin-top:18px;">
          <button id="login-btn" class="btn primary" style="width:100%;" ${state.initialized ? '' : 'disabled'}>
            <span class="btn-text">登录</span>
          </button>
        </div>
      </form>
    </section>
  `)

  const errorBox = document.getElementById('login-error')
  const passwordInput = document.getElementById('login-pass')
  const toggleButton = document.getElementById('toggle-password')
  const loginButton = document.getElementById('login-btn')
  const buttonText = loginButton.querySelector('.btn-text')

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

    loginButton.disabled = true
    buttonText.innerHTML = '<span class="loader"></span>'

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
      loginButton.disabled = !state.initialized
      buttonText.textContent = '登录'
    }
  }
}
