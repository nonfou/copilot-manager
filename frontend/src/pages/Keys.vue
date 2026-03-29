<script setup lang="ts">
import { ref, h, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect,
  NText, NSpace, NSpin, useMessage,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import { useApi } from '../composables/useApi'
import type { ApiKey, Account, User } from '../types/api'
import StatusBadge from '../components/StatusBadge.vue'

const api = useApi()
const router = useRouter()
const message = useMessage()

const keys = ref<ApiKey[]>([])
const accounts = ref<Account[]>([])
const users = ref<User[]>([])
const loading = ref(true)

const filterAccountId = ref('')

// Modals
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showRevealModal = ref(false)

// Create form
const createForm = ref({ name: '', account_id: '', owner_id: '' })

// Edit form
const editForm = ref({ id: '', name: '', enabled: 'true' })

// Revealed key (one-time display)
const revealedKey = ref('')
let revealTimer: ReturnType<typeof setTimeout> | null = null

function clearRevealedKey() {
  revealedKey.value = ''
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null }
}

function closeRevealModal() {
  clearRevealedKey()
  showRevealModal.value = false
}

// ─── Options ──────────────────────────────────────────────────────────────────

const accountOptions = ref<SelectOption[]>([])
const accountFilterOptions = ref<SelectOption[]>([{ label: '所有账号', value: '' }])
const userOptions = ref<SelectOption[]>([])
const enabledOptions: SelectOption[] = [
  { label: '启用', value: 'true' },
  { label: '禁用', value: 'false' },
]

async function loadAccountOptions() {
  try {
    accounts.value = await api.get<Account[]>('/accounts')
    accountOptions.value = accounts.value.map(a => ({ label: a.name, value: a.id }))
    accountFilterOptions.value = [
      { label: '所有账号', value: '' },
      ...accounts.value.map(a => ({ label: a.name, value: a.id })),
    ]
  } catch (e) {
    message.error((e as Error).message)
  }
}

async function loadUserOptions() {
  try {
    const data = await api.get<{ users: User[] }>('/users')
    users.value = data.users ?? []
    userOptions.value = users.value.map(u => ({
      label: u.username + (u.role === 'admin' ? ' (admin)' : ''),
      value: u.id,
    }))
  } catch {
    // non-admin silence
  }
}

// ─── Load keys ────────────────────────────────────────────────────────────────

async function loadKeys() {
  loading.value = true
  try {
    const params = filterAccountId.value ? `?account_id=${filterAccountId.value}` : ''
    keys.value = await api.get<ApiKey[]>(`/keys${params}`)
  } catch (e) {
    message.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

// ─── Create key ───────────────────────────────────────────────────────────────

function openCreateModal() {
  createForm.value = { name: '', account_id: '', owner_id: '' }
  showCreateModal.value = true
}

async function createKey() {
  const { name, account_id, owner_id } = createForm.value
  if (!name.trim()) { message.warning('请填写 Key 名称'); return }
  if (!account_id) { message.warning('请选择关联账号'); return }
  const body: Record<string, string> = { name: name.trim(), account_id }
  if (owner_id) body.owner_id = owner_id
  try {
    const key = await api.post<ApiKey>('/keys', body)
    revealedKey.value = key.key ?? ''
    showCreateModal.value = false
    showRevealModal.value = true
    if (revealTimer) clearTimeout(revealTimer)
    revealTimer = setTimeout(clearRevealedKey, 5 * 60 * 1000)
    await loadKeys()
  } catch (e) {
    message.error((e as Error).message)
  }
}

function copyRevealedKey() {
  if (!revealedKey.value) return
  if (navigator.clipboard) {
    navigator.clipboard.writeText(revealedKey.value)
    message.success('已复制到剪贴板')
  }
  setTimeout(clearRevealedKey, 500)
}

// ─── Edit key ─────────────────────────────────────────────────────────────────

function editKey(k: ApiKey) {
  editForm.value = { id: k.id, name: k.name, enabled: String(k.enabled) }
  showEditModal.value = true
}

async function saveKeyEdit() {
  const { id, name, enabled } = editForm.value
  if (!name.trim()) { message.warning('请填写 Key 名称'); return }
  try {
    await api.put(`/keys/${id}`, { name: name.trim(), enabled: enabled === 'true' })
    message.success('保存成功')
    showEditModal.value = false
    await loadKeys()
  } catch (e) {
    message.error((e as Error).message)
  }
}

// ─── Regenerate key ───────────────────────────────────────────────────────────

async function regenerateKey(k: ApiKey) {
  if (!confirm(`确认重新生成 Key「${k.name}」？旧的 Key 将立即失效。`)) return
  try {
    const key = await api.post<ApiKey>(`/keys/${k.id}/regenerate`)
    revealedKey.value = key.key ?? ''
    showRevealModal.value = true
    if (revealTimer) clearTimeout(revealTimer)
    revealTimer = setTimeout(clearRevealedKey, 5 * 60 * 1000)
    await loadKeys()
  } catch (e) {
    message.error((e as Error).message)
  }
}

// ─── Delete key ───────────────────────────────────────────────────────────────

async function deleteKey(k: ApiKey) {
  if (!confirm(`确认删除 Key「${k.name}」？此操作不可恢复。`)) return
  try {
    await api.delete(`/keys/${k.id}`)
    message.success('Key 已删除')
    await loadKeys()
  } catch (e) {
    message.error((e as Error).message)
  }
}

// ─── Table ────────────────────────────────────────────────────────────────────

const accMap = ref<Record<string, string>>({})

function formatDate(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const columns: DataTableColumns<ApiKey> = [
  { title: '名称', key: 'name', render: (row) => h('strong', {}, row.name) },
  {
    title: '归属用户',
    key: 'owner',
    render: (row) => h(NText, { depth: 3 }, () => row.owner_username ?? row.owner_id),
  },
  {
    title: '关联账号',
    key: 'account',
    render: (row) => accMap.value[row.account_id] || row.account_id,
  },
  {
    title: 'Key 值',
    key: 'masked_key',
    render: (row) => h('span', { class: 'monospace', style: 'font-size:12px;' }, row.masked_key || row.key),
  },
  {
    title: '状态',
    key: 'enabled',
    width: 70,
    render: (row) => h(StatusBadge, { status: row.enabled ? 'enabled' : 'disabled' }),
  },
  { title: '请求数', key: 'request_count', width: 80 },
  {
    title: '最后使用',
    key: 'last_used_at',
    width: 140,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;' }, () => formatDate(row.last_used_at)),
  },
  {
    title: '操作',
    key: 'actions',
    width: 260,
    render: (row) => h(NSpace, {}, {
      default: () => [
        h(NButton, { size: 'small', onClick: () => router.push({ name: 'KeyDetail', query: { id: row.id } }) }, { default: () => '详情' }),
        h(NButton, { size: 'small', onClick: () => editKey(row) }, { default: () => '编辑' }),
        h(NButton, { size: 'small', onClick: () => regenerateKey(row) }, { default: () => '重新生成' }),
        h(NButton, { size: 'small', type: 'error', onClick: () => deleteKey(row) }, { default: () => '删除' }),
      ],
    }),
  },
]

onMounted(async () => {
  await Promise.all([loadAccountOptions(), loadUserOptions()])
  accMap.value = Object.fromEntries(accounts.value.map(a => [a.id, a.name]))
  await loadKeys()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>Key 管理</h2>
      <p>管理 API Keys，每个 Key 关联一个账号</p>
    </div>

    <NCard>
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <NSpace align="center">
            <span>Key 列表</span>
            <NSelect
              v-model:value="filterAccountId"
              :options="accountFilterOptions"
              style="width: 160px;"
              size="small"
              @update:value="loadKeys"
            />
          </NSpace>
          <NSpace>
            <NButton size="small" @click="loadKeys">刷新</NButton>
            <NButton size="small" type="primary" @click="openCreateModal">+ 新建 Key</NButton>
          </NSpace>
        </div>
      </template>
      <NSpin :show="loading">
        <NDataTable
          :columns="columns"
          :data="keys"
          :bordered="false"
          size="small"
          striped
        />
      </NSpin>
    </NCard>

    <!-- 新建 Key Modal -->
    <NModal v-model:show="showCreateModal" style="width: 440px;" preset="card" title="新建 API Key">
      <NForm>
        <NFormItem label="Key 名称">
          <NInput v-model:value="createForm.name" placeholder="例：Claude Code Key" />
        </NFormItem>
        <NFormItem label="关联账号">
          <NSelect v-model:value="createForm.account_id" :options="accountOptions" placeholder="请选择账号" />
        </NFormItem>
        <NFormItem label="归属用户">
          <NSelect v-model:value="createForm.owner_id" :options="userOptions" clearable placeholder="请选择用户" />
        </NFormItem>
      </NForm>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <NButton @click="showCreateModal = false">取消</NButton>
        <NButton type="primary" @click="createKey">创建</NButton>
      </div>
    </NModal>

    <!-- Key 创建成功展示 Modal -->
    <NModal
      v-model:show="showRevealModal"
      :mask-closable="false"
      :close-on-esc="false"
      style="width: 480px;"
      preset="card"
      title="Key 创建成功"
      @update:show="(v) => { if (!v) closeRevealModal() }"
    >
      <p style="margin-bottom: 12px;">请立即复制并保存以下 API Key，<strong>它只会显示一次</strong>：</p>
      <div style="
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 6px;
        padding: 16px;
        font-family: monospace;
        font-size: 13px;
        word-break: break-all;
        color: #6c63ff;
        margin-bottom: 12px;
      ">{{ revealedKey }}</div>
      <NText type="warning" style="font-size: 12px; display: block; margin-bottom: 16px;">
        ⚠️ 离开此页面后将无法再次查看完整 Key 值
      </NText>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <NButton type="primary" @click="copyRevealedKey">复制 Key</NButton>
        <NButton @click="closeRevealModal">关闭</NButton>
      </div>
    </NModal>

    <!-- 编辑 Key Modal -->
    <NModal v-model:show="showEditModal" style="width: 440px;" preset="card" title="编辑 Key">
      <NForm>
        <NFormItem label="Key 名称">
          <NInput v-model:value="editForm.name" />
        </NFormItem>
        <NFormItem label="状态">
          <NSelect v-model:value="editForm.enabled" :options="enabledOptions" />
        </NFormItem>
      </NForm>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <NButton @click="showEditModal = false">取消</NButton>
        <NButton type="primary" @click="saveKeyEdit">保存</NButton>
      </div>
    </NModal>
  </div>
</template>
