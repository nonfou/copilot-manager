<script setup lang="ts">
import { ref, h, onMounted, onUnmounted } from 'vue'
import {
  NCard, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect,
  NTabs, NTabPane, NText, NSpace, NSpin, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useApi } from '../composables/useApi'
import { useAccountsStore } from '../stores/accounts'
import { RefreshOutline, ListOutline, CreateOutline, TrashOutline } from '@vicons/ionicons5'
import { renderActionButton, renderDangerButton } from '../composables/renderTableAction'
import type { Account, AuthStartResponse, AuthPollResponse } from '../types/api'
import UsageBar from '../components/UsageBar.vue'
import type { UsageData } from '../types/api'

const api = useApi()
const accountsStore = useAccountsStore()
const message = useMessage()

const loading = ref(true)
const usageMap = ref<Map<string, UsageData | 'loading' | 'error'>>(new Map())

// ─── Modal state ─────────────────────────────────────────────────────────────
const showAddModal = ref(false)
const showEditModal = ref(false)
const showModelsModal = ref(false)

// Add modal - tabs
const addTab = ref<'oauth' | 'token' | 'apionly'>('oauth')

// OAuth flow
const oauthForm = ref({ name: '', api_url: '', account_type: 'individual' })
const oauthWaiting = ref(false)
const oauthCode = ref('')
const oauthUrl = ref('')
const currentAuthId = ref<string | null>(null)
let authPollTimer: ReturnType<typeof setInterval> | null = null

// Token form
const tokenForm = ref({ name: '', api_url: '', account_type: 'individual', github_token: '' })

// ApiOnly form
const apionlyForm = ref({ name: '', api_url: '', account_type: 'individual' })

// Edit modal
const editForm = ref({ id: '', name: '', api_url: '', account_type: 'individual', github_token: '' })

// Models modal
const modelsModalTitle = ref('')
const modelsData = ref<{ id: string; display_name?: string }[]>([])
const modelsLoading = ref(false)
const currentModelsId = ref('')

const accountTypeOptions = [
  { label: '个人版 (Individual)', value: 'individual' },
  { label: '商业版 (Business)', value: 'business' },
  { label: '企业版 (Enterprise)', value: 'enterprise' },
]

// ─── Load data ────────────────────────────────────────────────────────────────

async function loadAccounts() {
  loading.value = true
  try {
    await accountsStore.fetchAccounts()
    loadAllUsage()
  } catch (e) {
    message.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

async function loadAllUsage() {
  for (const acc of accountsStore.accounts) {
    usageMap.value.set(acc.id, 'loading')
    accountsStore.getUsage(acc.id).then(data => {
      usageMap.value.set(acc.id, data)
    }).catch(() => {
      usageMap.value.set(acc.id, 'error')
    })
  }
}

async function refreshUsage(id: string) {
  usageMap.value.set(id, 'loading')
  try {
    const data = await accountsStore.getUsage(id, true)
    usageMap.value.set(id, data)
  } catch {
    usageMap.value.set(id, 'error')
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteAccount(id: string, _name: string) {
  try {
    await api.delete(`/accounts/${id}`)
    accountsStore.invalidateCache(id)
    message.success('账号已删除')
    await loadAccounts()
  } catch (e) {
    message.error((e as Error).message)
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

function openEdit(acc: Account) {
  editForm.value = { id: acc.id, name: acc.name, api_url: acc.api_url, account_type: acc.account_type, github_token: '' }
  showEditModal.value = true
}

async function saveEdit() {
  const { id, name, api_url, account_type, github_token } = editForm.value
  if (!name.trim()) { message.warning('请填写账号名称'); return }
  if (!api_url.trim()) { message.warning('请填写 copilot-api 地址'); return }
  const body: Record<string, string> = { name: name.trim(), api_url: api_url.trim(), account_type }
  if (github_token.trim()) body.github_token = github_token.trim()
  try {
    await api.put(`/accounts/${id}`, body)
    accountsStore.invalidateCache(id)
    message.success('保存成功')
    showEditModal.value = false
    await loadAccounts()
  } catch (e) {
    message.error((e as Error).message)
  }
}

// ─── OAuth Device Flow ────────────────────────────────────────────────────────

function openAddModal() {
  cancelOAuth()
  oauthForm.value = { name: '', api_url: '', account_type: 'individual' }
  tokenForm.value = { name: '', api_url: '', account_type: 'individual', github_token: '' }
  apionlyForm.value = { name: '', api_url: '', account_type: 'individual' }
  addTab.value = 'oauth'
  oauthWaiting.value = false
  showAddModal.value = true
}

async function startOAuth() {
  const { name, api_url, account_type } = oauthForm.value
  if (!name.trim()) { message.warning('请填写账号名称'); return }
  if (!api_url.trim()) { message.warning('请填写 copilot-api 地址'); return }
  try {
    const res = await api.post<AuthStartResponse>('/accounts/auth/start', { name: name.trim(), account_type, api_url: api_url.trim() })
    currentAuthId.value = res.auth_id
    oauthCode.value = res.user_code
    oauthUrl.value = res.verification_uri
    oauthWaiting.value = true
    authPollTimer = setInterval(() => pollAuth(), (res.interval || 5) * 1000)
  } catch (e) {
    message.error((e as Error).message)
  }
}

async function pollAuth() {
  if (!currentAuthId.value) return
  try {
    const res = await api.get<AuthPollResponse>(`/accounts/auth/poll/${currentAuthId.value}`)
    if (res.status === 'success') {
      cancelOAuth()
      showAddModal.value = false
      message.success(`账号「${res.account?.name}」已添加！`)
      await loadAccounts()
    } else if (res.status === 'expired') {
      cancelOAuth()
      oauthWaiting.value = false
      message.warning('授权已过期，请重新尝试')
    }
  } catch (e) {
    cancelOAuth()
    message.error((e as Error).message)
  }
}

function cancelOAuth() {
  if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null }
  currentAuthId.value = null
  oauthWaiting.value = false
}

function copyCode() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(oauthCode.value)
    message.success('已复制')
  }
}

// ─── Create with Token ────────────────────────────────────────────────────────

async function createWithToken() {
  const { name, api_url, account_type, github_token } = tokenForm.value
  if (!name.trim()) { message.warning('请填写账号名称'); return }
  if (!api_url.trim()) { message.warning('请填写 copilot-api 地址'); return }
  if (!github_token.trim()) { message.warning('请填写 GitHub Token'); return }
  try {
    await api.post('/accounts', { name: name.trim(), api_url: api_url.trim(), account_type, github_token: github_token.trim() })
    message.success('账号已创建')
    showAddModal.value = false
    await loadAccounts()
  } catch (e) {
    message.error((e as Error).message)
  }
}

// ─── Create API Only ──────────────────────────────────────────────────────────

async function createWithApiOnly() {
  const { name, api_url, account_type } = apionlyForm.value
  if (!name.trim()) { message.warning('请填写账号名称'); return }
  if (!api_url.trim()) { message.warning('请填写 copilot-api 地址'); return }
  try {
    await api.post('/accounts', { name: name.trim(), api_url: api_url.trim(), account_type })
    message.success('账号已创建')
    showAddModal.value = false
    await loadAccounts()
  } catch (e) {
    message.error((e as Error).message)
  }
}

// ─── Models modal ─────────────────────────────────────────────────────────────

async function showModels(acc: Account, forceRefresh = false) {
  currentModelsId.value = acc.id
  modelsModalTitle.value = `可用模型 - ${acc.name}`
  modelsLoading.value = true
  modelsData.value = []
  showModelsModal.value = true
  try {
    const data = await accountsStore.getModels(acc.id, forceRefresh)
    modelsData.value = Array.isArray(data.data) ? data.data : []
  } catch (e) {
    message.error((e as Error).message)
  } finally {
    modelsLoading.value = false
  }
}

// ─── Table columns ────────────────────────────────────────────────────────────

const columns: DataTableColumns<Account> = [
  {
    title: '名称',
    key: 'name',
    render: (row) => h('div', {}, [
      h('strong', {}, row.name),
      h(NText, { depth: 3, style: 'font-size:11px; display:block; font-family:monospace;' }, () => row.id),
    ]),
  },
  {
    title: 'API 地址',
    key: 'api_url',
    ellipsis: { tooltip: true },
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px; font-family:monospace;' }, () => row.api_url || '-'),
  },
  { title: '类型', key: 'account_type', width: 100 },
  {
    title: '用量 (Premium)',
    key: 'usage',
    width: 200,
    render: (row) => {
      const u = usageMap.value.get(row.id)
      if (u === 'loading') return h(NText, { depth: 3 }, () => '加载中...')
      if (u === 'error') return h(NText, { style: 'color:#f56c6c;' }, () => '获取失败')
      if (!u) return h(NText, { depth: 3 }, () => '-')
      return h(UsageBar, { data: u })
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    render: (row) => h('div', { style: 'display:flex; gap:4px;' }, [
      renderActionButton({ icon: RefreshOutline, tooltip: '刷新用量', onClick: () => refreshUsage(row.id) }),
      renderActionButton({ icon: ListOutline, tooltip: '可用模型', onClick: () => showModels(row) }),
      renderActionButton({ icon: CreateOutline, tooltip: '编辑', onClick: () => openEdit(row) }),
      renderDangerButton({ icon: TrashOutline, tooltip: '删除', confirmText: `确认删除账号「${row.name}」？关联的所有 API Key 也将被删除，此操作不可恢复。`, onConfirm: () => deleteAccount(row.id, row.name) }),
    ]),
  },
]

onMounted(loadAccounts)
onUnmounted(() => {
  if (authPollTimer) clearInterval(authPollTimer)
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>账号管理</h2>
      <p>管理 GitHub Copilot 账号，每个账号对应一个外部运行的 copilot-api 实例</p>
    </div>

    <NCard>
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span>账号列表</span>
          <NSpace>
            <NButton size="small" @click="loadAccounts">刷新</NButton>
            <NButton size="small" type="primary" @click="openAddModal">+ 添加账号</NButton>
          </NSpace>
        </div>
      </template>
      <NSpin :show="loading">
        <NDataTable
          :columns="columns"
          :data="accountsStore.accounts"
          :bordered="false"
          size="small"
          striped
        />
      </NSpin>
    </NCard>

    <!-- 添加账号 Modal -->
    <NModal v-model:show="showAddModal" :mask-closable="false" style="width: 520px;" preset="card" title="添加账号">
      <NTabs v-model:value="addTab" type="line" animated>
        <!-- OAuth -->
        <NTabPane name="oauth" tab="GitHub OAuth 授权">
          <div v-if="!oauthWaiting">
            <NForm>
              <NFormItem label="账号名称">
                <NInput v-model:value="oauthForm.name" placeholder="例：我的 Copilot 账号" />
              </NFormItem>
              <NFormItem label="copilot-api 地址">
                <NInput v-model:value="oauthForm.api_url" placeholder="例：http://localhost:8080" />
              </NFormItem>
              <NFormItem label="账号类型">
                <NSelect v-model:value="oauthForm.account_type" :options="accountTypeOptions" />
              </NFormItem>
            </NForm>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
              <NButton @click="showAddModal = false">取消</NButton>
              <NButton type="primary" @click="startOAuth">GitHub 授权</NButton>
            </div>
          </div>
          <div v-else style="text-align: center; padding: 16px;">
            <NText>请在浏览器中打开以下地址：</NText>
            <div style="margin: 12px 0;">
              <a :href="oauthUrl" target="_blank" style="color: #6c63ff; font-size: 13px;">{{ oauthUrl }}</a>
            </div>
            <div style="font-size: 28px; font-weight: 700; letter-spacing: 8px; color: #6c63ff; margin: 16px 0;">
              {{ oauthCode }}
            </div>
            <NSpace justify="center" style="margin-bottom: 16px;">
              <NButton size="small" @click="copyCode">复制验证码</NButton>
              <NButton size="small" type="primary" tag="a" :href="oauthUrl" target="_blank">打开浏览器</NButton>
            </NSpace>
            <NText depth="3">
              <NSpin size="small" style="margin-right: 8px;" />
              等待授权中...
            </NText>
            <div style="margin-top: 16px;">
              <NButton @click="cancelOAuth">取消</NButton>
            </div>
          </div>
        </NTabPane>

        <!-- Token -->
        <NTabPane name="token" tab="直接粘贴 Token">
          <NForm>
            <NFormItem label="账号名称">
              <NInput v-model:value="tokenForm.name" placeholder="例：我的 Copilot 账号" />
            </NFormItem>
            <NFormItem label="copilot-api 地址">
              <NInput v-model:value="tokenForm.api_url" placeholder="例：http://localhost:8080" />
            </NFormItem>
            <NFormItem label="账号类型">
              <NSelect v-model:value="tokenForm.account_type" :options="accountTypeOptions" />
            </NFormItem>
            <NFormItem label="GitHub Token">
              <NInput v-model:value="tokenForm.github_token" type="password" placeholder="ghp_xxxxxxxxxxxx" show-password-on="click" />
            </NFormItem>
          </NForm>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
            <NButton @click="showAddModal = false">取消</NButton>
            <NButton type="primary" @click="createWithToken">创建账号</NButton>
          </div>
        </NTabPane>

        <!-- API Only -->
        <NTabPane name="apionly" tab="仅 API 地址">
          <NForm>
            <NFormItem label="账号名称">
              <NInput v-model:value="apionlyForm.name" placeholder="例：我的 Copilot 账号" />
            </NFormItem>
            <NFormItem label="copilot-api 地址">
              <NInput v-model:value="apionlyForm.api_url" placeholder="例：http://localhost:8080" />
            </NFormItem>
            <NFormItem label="账号类型">
              <NSelect v-model:value="apionlyForm.account_type" :options="accountTypeOptions" />
            </NFormItem>
          </NForm>
          <NText depth="3" style="font-size: 12px;">copilot-api 实例已在外部配置好 Token，此处无需填写</NText>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
            <NButton @click="showAddModal = false">取消</NButton>
            <NButton type="primary" @click="createWithApiOnly">创建账号</NButton>
          </div>
        </NTabPane>
      </NTabs>
    </NModal>

    <!-- 编辑 Modal -->
    <NModal v-model:show="showEditModal" style="width: 480px;" preset="card" title="编辑账号">
      <NForm>
        <NFormItem label="账号名称">
          <NInput v-model:value="editForm.name" />
        </NFormItem>
        <NFormItem label="copilot-api 地址">
          <NInput v-model:value="editForm.api_url" placeholder="例：http://localhost:8080" />
        </NFormItem>
        <NFormItem label="账号类型">
          <NSelect v-model:value="editForm.account_type" :options="accountTypeOptions" />
        </NFormItem>
        <NFormItem label="更新 GitHub Token（留空不更改）">
          <NInput v-model:value="editForm.github_token" type="password" placeholder="留空不更改" show-password-on="click" />
        </NFormItem>
      </NForm>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <NButton @click="showEditModal = false">取消</NButton>
        <NButton type="primary" @click="saveEdit">保存</NButton>
      </div>
    </NModal>

    <!-- 可用模型 Modal -->
    <NModal v-model:show="showModelsModal" style="width: 520px;" preset="card" :title="modelsModalTitle">
      <NSpin :show="modelsLoading">
        <div v-if="!modelsLoading && modelsData.length === 0" style="color: #888;">暂无可用模型</div>
        <div v-else style="max-height: 380px; overflow-y: auto;">
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px;">共 {{ modelsData.length }} 个模型</NText>
          <div
            v-for="m in modelsData"
            :key="m.id"
            style="padding: 6px 0; border-bottom: 1px solid #252525;"
          >
            <code style="font-size: 12px;">{{ m.id }}</code>
            <NText v-if="m.display_name" depth="3" style="margin-left: 8px; font-size: 12px;">{{ m.display_name }}</NText>
          </div>
        </div>
      </NSpin>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <NButton @click="showModelsModal = false">关闭</NButton>
        <NButton @click="showModels({ id: currentModelsId, name: modelsModalTitle } as any, true)">刷新</NButton>
      </div>
    </NModal>
  </div>
</template>
