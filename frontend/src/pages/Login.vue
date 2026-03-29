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
      <NCard style="width: 400px;" :bordered="false">
        <template #header>
          <div style="text-align: center; padding: 8px 0;">
            <div style="font-size: 32px; margin-bottom: 8px;">🤖</div>
            <div style="font-size: 20px; font-weight: 600; color: #e8e8e8;">Copilot Manager</div>
          </div>
        </template>

        <NAlert
          v-if="!initialized"
          type="warning"
          title="系统未初始化"
          style="margin-bottom: 16px;"
        >
          管理员账号需通过命令行创建，请联系系统管理员
        </NAlert>

        <NAlert
          v-if="error"
          type="error"
          :title="error"
          style="margin-bottom: 16px;"
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

        <div style="text-align: center; margin-top: 16px;">
          <NText depth="3" style="font-size: 12px;">Copilot Manager v1.0</NText>
        </div>
      </NCard>
    </NSpin>
  </div>
</template>

<style scoped>
.login-card-wrap {
  width: 100%;
  max-width: 440px;
}
</style>
