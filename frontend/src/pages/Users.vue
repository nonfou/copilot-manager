<script setup lang="ts">
import { ref, h, onMounted } from 'vue'
import {
  NCard, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect,
  NText, NSpin, useMessage,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import { useApi } from '../composables/useApi'
import { KeyOutline, TrashOutline } from '@vicons/ionicons5'
import { renderActionButton, renderDangerButton } from '../composables/renderTableAction'
import type { User, UsersListResponse } from '../types/api'
import StatusBadge from '../components/StatusBadge.vue'

const api = useApi()
const message = useMessage()

const users = ref<User[]>([])
const loading = ref(true)
let currentUserId = ''

const showCreateModal = ref(false)
const showResetModal = ref(false)

const createForm = ref({ username: '', password: '', role: 'user' })
const resetForm = ref({ userId: '', password: '' })

const roleOptions: SelectOption[] = [
  { label: '普通用户', value: 'user' },
  { label: '管理员', value: 'admin' },
]

function formatDate(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

async function loadUsers() {
  loading.value = true
  try {
    const data = await api.get<UsersListResponse>('/users')
    users.value = data.users ?? []
    currentUserId = data.current_user?.id ?? ''
  } catch (e) {
    message.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

async function createUser() {
  const { username, password, role } = createForm.value
  if (!username.trim()) { message.warning('请填写用户名'); return }
  if (username.trim().length < 3) { message.warning('用户名至少 3 个字符'); return }
  if (!password) { message.warning('请填写密码'); return }
  if (password.length < 6) { message.warning('密码至少 6 个字符'); return }
  try {
    await api.post('/users', { username: username.trim(), password, role })
    message.success('用户创建成功')
    showCreateModal.value = false
    createForm.value = { username: '', password: '', role: 'user' }
    await loadUsers()
  } catch (e) {
    message.error((e as Error).message)
  }
}

function openResetPassword(userId: string) {
  resetForm.value = { userId, password: '' }
  showResetModal.value = true
}

async function resetPassword() {
  const { userId, password } = resetForm.value
  if (!password) { message.warning('请填写新密码'); return }
  if (password.length < 6) { message.warning('密码至少 6 个字符'); return }
  try {
    await api.post(`/users/${userId}/reset-password`, { new_password: password })
    message.success('密码已重置')
    showResetModal.value = false
  } catch (e) {
    message.error((e as Error).message)
  }
}

async function doDeleteUser(id: string) {
  try {
    await api.delete(`/users/${id}`)
    message.success('用户已删除')
    await loadUsers()
  } catch (e) {
    message.error((e as Error).message)
  }
}

const columns: DataTableColumns<User> = [
  { title: '用户名', key: 'username' },
  {
    title: '角色',
    key: 'role',
    width: 90,
    render: (row) => h(StatusBadge, { status: row.role }),
  },
  {
    title: '创建时间',
    key: 'created_at',
    width: 140,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;' }, () => formatDate(row.created_at)),
  },
  {
    title: '最后登录',
    key: 'last_login_at',
    width: 140,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;' }, () => formatDate(row.last_login_at)),
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render: (row) => h('div', { style: 'display:flex; gap:4px;' }, [
      renderActionButton({ icon: KeyOutline, tooltip: '重置密码', onClick: () => openResetPassword(row.id) }),
      ...(row.id !== currentUserId
        ? [renderDangerButton({ icon: TrashOutline, tooltip: '删除', confirmText: `确认删除用户「${row.username}」？此操作不可恢复。`, onConfirm: () => doDeleteUser(row.id) })]
        : []),
    ]),
  },
]

onMounted(loadUsers)
</script>

<template>
  <div>
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>用户管理</h2>
      </div>
      <NButton type="primary" @click="showCreateModal = true">+ 创建用户</NButton>
    </div>

    <NCard>
      <NSpin :show="loading">
        <NDataTable
          :columns="columns"
          :data="users"
          :bordered="false"
          size="small"
          striped
        />
      </NSpin>
    </NCard>

    <!-- 创建用户 Modal -->
    <NModal v-model:show="showCreateModal" style="width: 440px;" preset="card" title="创建用户">
      <NForm>
        <NFormItem label="用户名">
          <NInput v-model:value="createForm.username" placeholder="至少 3 个字符" />
        </NFormItem>
        <NFormItem label="密码">
          <NInput v-model:value="createForm.password" type="password" placeholder="至少 6 个字符" show-password-on="click" />
        </NFormItem>
        <NFormItem label="角色">
          <NSelect v-model:value="createForm.role" :options="roleOptions" />
        </NFormItem>
      </NForm>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
        <NButton @click="showCreateModal = false">取消</NButton>
        <NButton type="primary" @click="createUser">创建</NButton>
      </div>
    </NModal>

    <!-- 重置密码 Modal -->
    <NModal v-model:show="showResetModal" style="width: 400px;" preset="card" title="重置密码">
      <NForm>
        <NFormItem label="新密码">
          <NInput v-model:value="resetForm.password" type="password" placeholder="至少 6 个字符" show-password-on="click" />
        </NFormItem>
      </NForm>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
        <NButton @click="showResetModal = false">取消</NButton>
        <NButton type="primary" @click="resetPassword">确认重置</NButton>
      </div>
    </NModal>
  </div>
</template>
