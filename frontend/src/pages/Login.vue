<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard, NForm, NFormItem, NInput, NButton, NAlert, NText, NSpin,
} from 'naive-ui'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const initialized = ref(true)
const checkingStatus = ref(true)

onMounted(async () => {
  try {
    const res = await fetch('/api/auth/status', { credentials: 'same-origin' })
    const status = await res.json()
    initialized.value = status.initialized
  } catch {
    // ignore
  } finally {
    checkingStatus.value = false
  }
})

async function handleLogin() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  try {
    await auth.login(username.value.trim(), password.value)
    if (auth.user?.role === 'admin') {
      router.push({ name: 'Dashboard' })
    } else {
      router.push({ name: 'KeyDetail' })
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-card-wrap">
    <NSpin :show="checkingStatus">
      <NCard class="login-card" :bordered="false">
        <template #header>
          <div class="login-header">
            <div class="login-logo">🤖</div>
            <div class="login-title">Copilot Manager</div>
          </div>
        </template>

        <NAlert
          v-if="!initialized"
          type="warning"
          title="系统未初始化"
          class="login-alert"
        >
          管理员账号需通过命令行创建，请联系系统管理员
        </NAlert>

        <NAlert
          v-if="error"
          type="error"
          :title="error"
          class="login-alert"
          closable
          @close="error = ''"
        />

        <NForm @submit.prevent="handleLogin">
          <NFormItem label="用户名">
            <NInput
              v-model:value="username"
              placeholder="请输入用户名"
              :disabled="!initialized || loading"
              autocomplete="username"
              @keydown.enter="handleLogin"
            />
          </NFormItem>
          <NFormItem label="密码">
            <NInput
              v-model:value="password"
              type="password"
              placeholder="请输入密码"
              :disabled="!initialized || loading"
              show-password-on="click"
              autocomplete="current-password"
              @keydown.enter="handleLogin"
            />
          </NFormItem>
          <NButton
            type="primary"
            block
            :loading="loading"
            :disabled="!initialized"
            @click="handleLogin"
          >
            {{ initialized ? '登录' : '系统未初始化' }}
          </NButton>
        </NForm>

        <div class="login-footer">
          <NText depth="3" class="login-version">Copilot Manager v1.0</NText>
        </div>
      </NCard>
    </NSpin>
  </div>
</template>

<style scoped>
.login-card-wrap {
  width: 100%;
  max-width: 420px;
}

.login-card {
  border-radius: 16px !important;
  background: #1a1a2e !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(108, 99, 255, 0.15) !important;
}

.login-header {
  text-align: center;
  padding: 12px 0 4px;
}

.login-logo {
  font-size: 36px;
  margin-bottom: 10px;
  line-height: 1;
}

.login-title {
  font-size: 22px;
  font-weight: 700;
  color: #e8e8e8;
  letter-spacing: 0.5px;
}

.login-alert {
  margin-bottom: 16px;
}

.login-footer {
  text-align: center;
  margin-top: 20px;
}

.login-version {
  font-size: 12px;
}

/* 覆盖浏览器自动填充背景色 */
:deep(input:-webkit-autofill),
:deep(input:-webkit-autofill:hover),
:deep(input:-webkit-autofill:focus) {
  -webkit-box-shadow: 0 0 0 1000px #2a2a42 inset !important;
  -webkit-text-fill-color: #e8e8e8 !important;
  caret-color: #e8e8e8;
  transition: background-color 5000s ease-in-out 0s;
}
</style>
