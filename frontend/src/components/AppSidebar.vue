<script setup lang="ts">
import { h, computed } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { NMenu, NButton, NDivider, NText } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

function renderLabel(label: string, to: string) {
  return () => h(RouterLink, { to }, { default: () => label })
}

const menuOptions: MenuOption[] = [
  {
    label: renderLabel('仪表盘', '/ui/dashboard'),
    key: '/dashboard',
    show: auth.user?.role === 'admin',
  },
  {
    label: renderLabel('账号管理', '/ui/accounts'),
    key: '/accounts',
    show: auth.user?.role === 'admin',
  },
  {
    label: renderLabel('Key 管理', '/ui/keys'),
    key: '/keys',
    show: auth.user?.role === 'admin',
  },
  {
    label: renderLabel('Key 详情', '/ui/key-detail'),
    key: '/key-detail',
  },
  {
    label: renderLabel('用户管理', '/ui/users'),
    key: '/users',
    show: auth.user?.role === 'admin',
  },
  {
    label: renderLabel('请求日志', '/ui/logs'),
    key: '/logs',
    show: auth.user?.role === 'admin',
  },
]

const activeKey = computed(() => router.currentRoute.value.path)

async function handleLogout() {
  await auth.logout()
  router.push({ name: 'Login' })
}
</script>

<template>
  <div class="sidebar-wrap">
    <div class="sidebar-logo">
      <span class="logo-icon">🤖</span>
      <span class="logo-text">Copilot Manager</span>
    </div>

    <NMenu
      :options="menuOptions.filter(o => o.show !== false)"
      :value="activeKey"
      :indent="16"
      style="flex: 1;"
      @update:value="(key: string) => router.push(key)"
    />

    <div class="sidebar-footer">
      <NDivider style="margin: 8px 0;" />
      <div class="user-info">
        <NText depth="3" style="font-size: 12px;">{{ auth.user?.username }}</NText>
        <NText
          depth="3"
          style="font-size: 11px; color: #6c63ff; margin-left: 6px;"
        >{{ auth.user?.role }}</NText>
      </div>
      <NButton
        text
        type="error"
        size="small"
        style="width: 100%; justify-content: flex-start; margin-top: 4px;"
        @click="handleLogout"
      >
        退出登录
      </NButton>
    </div>
  </div>
</template>

<style scoped>
.sidebar-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  font-weight: 600;
  font-size: 15px;
  color: #e8e8e8;
  border-bottom: 1px solid #252525;
}

.logo-icon {
  font-size: 20px;
}

.sidebar-footer {
  padding: 8px 16px 16px;
}

.user-info {
  display: flex;
  align-items: center;
  padding: 4px 0;
}
</style>
