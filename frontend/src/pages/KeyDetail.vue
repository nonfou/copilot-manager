<script setup lang="ts">
import { ref, h, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  NCard, NButton, NDataTable, NSelect, NText, NSpace, NSpin, useMessage,
  NGrid, NGridItem, NTag,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import { useApi } from '../composables/useApi'
import { useAccountsStore } from '../stores/accounts'
import { useAuthStore } from '../stores/auth'
import type { ApiKey, RequestLog, LogsResponse, UsageData } from '../types/api'
import UsageBar from '../components/UsageBar.vue'
import StatusBadge from '../components/StatusBadge.vue'

const api = useApi()
const accountsStore = useAccountsStore()
const auth = useAuthStore()
const route = useRoute()
const message = useMessage()

const loading = ref(true)
const currentKey = ref<ApiKey | null>(null)
const keys = ref<ApiKey[]>([])
const selectedKeyId = ref('')
const keyOptions = ref<SelectOption[]>([])

const usageData = ref<UsageData | null>(null)
const usageLoading = ref(false)
const modelsData = ref<{ id: string; display_name?: string }[]>([])
const modelsLoading = ref(false)

// Logs pagination
const logs = ref<RequestLog[]>([])
const logsLoading = ref(false)
const currentPage = ref(1)
const totalLogs = ref(0)
const pageSize = 50

const totalPages = computed(() => Math.ceil(totalLogs.value / pageSize) || 1)

function formatDate(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// ─── Load key ────────────────────────────────────────────────────────────────

async function loadKeyById(id: string) {
  loading.value = true
  try {
    const key = await api.get<ApiKey>(`/keys/${id}`)
    currentKey.value = key
    selectedKeyId.value = id
    if (key.account) {
      loadUsage(key.account.id)
      loadModels(key.account.id)
    } else {
      usageData.value = null
      modelsData.value = []
    }
    await loadLogs(1)
  } catch (e) {
    message.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

async function init() {
  const urlId = route.query.id as string | undefined
  if (urlId) {
    await loadKeyById(urlId)
    return
  }

  try {
    keys.value = await api.get<ApiKey[]>('/keys')
    if (keys.value.length === 0) {
      loading.value = false
      return
    }
    keyOptions.value = keys.value.map(k => ({ label: k.name, value: k.id }))
    await loadKeyById(keys.value[0].id)
  } catch (e) {
    message.error((e as Error).message)
    loading.value = false
  }
}

// ─── Usage & Models ───────────────────────────────────────────────────────────

async function loadUsage(accountId: string, forceRefresh = false) {
  usageLoading.value = true
  try {
    usageData.value = await accountsStore.getUsage(accountId, forceRefresh)
  } catch {
    usageData.value = null
  } finally {
    usageLoading.value = false
  }
}

async function refreshUsage() {
  if (!currentKey.value?.account) return
  await loadUsage(currentKey.value.account.id, true)
}

async function loadModels(accountId: string, forceRefresh = false) {
  modelsLoading.value = true
  try {
    const data = await accountsStore.getModels(accountId, forceRefresh)
    modelsData.value = Array.isArray(data.data) ? data.data : []
  } catch {
    modelsData.value = []
  } finally {
    modelsLoading.value = false
  }
}

async function refreshModels() {
  if (!currentKey.value?.account) return
  await loadModels(currentKey.value.account.id, true)
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

async function loadLogs(page: number) {
  if (!selectedKeyId.value) return
  logsLoading.value = true
  currentPage.value = page
  const params = new URLSearchParams({
    page: String(page),
    limit: String(pageSize),
    api_key_id: selectedKeyId.value,
  })
  try {
    const res = await api.get<LogsResponse>(`/logs?${params}`)
    logs.value = res.logs
    totalLogs.value = res.total
  } catch (e) {
    message.error((e as Error).message)
  } finally {
    logsLoading.value = false
  }
}

const logColumns: DataTableColumns<RequestLog> = [
  {
    title: '时间',
    key: 'created_at',
    width: 140,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;' }, () => formatDate(row.created_at)),
  },
  { title: '方法', key: 'method', width: 70, render: (row) => h('code', {}, row.method) },
  { title: '模型', key: 'model', width: 130, render: (row) => h(NText, { depth: 3 }, () => row.model ?? '-') },
  {
    title: 'Tokens',
    key: 'tokens',
    width: 160,
    render: (row) => {
      if (row.prompt_tokens == null && row.completion_tokens == null)
        return h(NText, { depth: 3 }, () => '-')
      const parts: string[] = []
      if (row.prompt_tokens != null || row.completion_tokens != null)
        parts.push(`in ${row.prompt_tokens ?? 0} / out ${row.completion_tokens ?? 0}`)
      if (row.total_tokens != null)
        parts.push(`total ${row.total_tokens}`)
      return h('span', { style: 'font-size:12px; white-space:nowrap;' }, parts.join(' | '))
    },
  },
  {
    title: '路径',
    key: 'path',
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'monospace', style: 'font-size:12px;' }, row.path),
  },
  {
    title: '状态码',
    key: 'status_code',
    width: 80,
    render: (row) => {
      const type = row.status_code < 300 ? 'success' : row.status_code < 500 ? 'warning' : 'error'
      return h(NTag, { type, size: 'small', bordered: false }, () => String(row.status_code))
    },
  },
  {
    title: '耗时',
    key: 'duration_ms',
    width: 80,
    render: (row) => h(NText, { depth: 3 }, () => formatDuration(row.duration_ms)),
  },
  {
    title: '错误',
    key: 'error',
    width: 150,
    ellipsis: { tooltip: true },
    render: (row) => row.error ? h(NText, { type: 'error', style: 'font-size:12px;' }, () => row.error!) : h('span', {}, ''),
  },
]

onMounted(init)
</script>

<template>
  <div>
    <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h2>Key 详情</h2>
      </div>
      <NSpace align="center">
        <NSelect
          v-if="!route.query.id && keys.length > 1"
          v-model:value="selectedKeyId"
          :options="keyOptions"
          style="width: 200px;"
          size="small"
          @update:value="loadKeyById"
        />
        <NButton
          v-if="route.query.id && auth.user?.role === 'admin'"
          size="small"
          @click="$router.back()"
        >
          ← 返回
        </NButton>
      </NSpace>
    </div>

    <NSpin :show="loading">
      <div v-if="!loading && !currentKey" style="text-align:center; padding: 48px;">
        <NText depth="3">暂无可用的 API Key</NText>
      </div>

      <div v-if="currentKey">
        <NGrid :cols="3" :x-gap="16" style="margin-bottom: 20px;">
          <!-- Key 信息 -->
          <NGridItem>
            <NCard title="Key 信息" size="small">
              <div class="info-row">
                <NText depth="3" class="info-label">名称</NText>
                <strong>{{ currentKey.name }}</strong>
              </div>
              <div class="info-row">
                <NText depth="3" class="info-label">状态</NText>
                <StatusBadge :status="currentKey.enabled ? 'enabled' : 'disabled'" />
              </div>
              <div class="info-row">
                <NText depth="3" class="info-label">Key 值</NText>
                <span class="monospace" style="font-size:11px; word-break:break-all;">{{ currentKey.masked_key || currentKey.key }}</span>
              </div>
              <div class="info-row">
                <NText depth="3" class="info-label">请求数</NText>
                {{ currentKey.request_count }}
              </div>
              <div class="info-row">
                <NText depth="3" class="info-label">最后使用</NText>
                <NText depth="3" style="font-size:12px;">{{ currentKey.last_used_at ? formatDate(currentKey.last_used_at) : '-' }}</NText>
              </div>
              <div class="info-row">
                <NText depth="3" class="info-label">关联账号</NText>
                <span>{{ currentKey.account?.name ?? '已删除' }}</span>
              </div>
            </NCard>
          </NGridItem>

          <!-- 账号用量 -->
          <NGridItem>
            <NCard size="small">
              <template #header>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span>账号用量</span>
                  <NButton size="tiny" :loading="usageLoading" :disabled="!currentKey.account" @click="refreshUsage">↻ 刷新</NButton>
                </div>
              </template>
              <NSpin :show="usageLoading">
                <div v-if="!currentKey.account">
                  <NText depth="3">关联账号已删除</NText>
                </div>
                <UsageBar v-else :data="usageData" />
              </NSpin>
            </NCard>
          </NGridItem>

          <!-- 可用模型 -->
          <NGridItem>
            <NCard size="small">
              <template #header>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span>可用模型</span>
                  <NButton size="tiny" :loading="modelsLoading" :disabled="!currentKey.account" @click="refreshModels">↻ 刷新</NButton>
                </div>
              </template>
              <NSpin :show="modelsLoading">
                <div v-if="!currentKey.account">
                  <NText depth="3">关联账号已删除</NText>
                </div>
                <div v-else-if="modelsData.length === 0">
                  <NText depth="3">暂无可用模型</NText>
                </div>
                <div v-else style="max-height: 180px; overflow-y: auto;">
                  <NText depth="3" style="font-size:12px; display:block; margin-bottom:6px;">共 {{ modelsData.length }} 个模型</NText>
                  <div
                    v-for="m in modelsData"
                    :key="m.id"
                    style="padding:4px 0; border-bottom:1px solid #252525; font-size:12px;"
                  >
                    <code>{{ m.id }}</code>
                    <NText v-if="m.display_name" depth="3" style="margin-left:6px; font-size:11px;">{{ m.display_name }}</NText>
                  </div>
                </div>
              </NSpin>
            </NCard>
          </NGridItem>
        </NGrid>

        <!-- 请求日志 -->
        <NCard>
          <template #header>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>请求日志</span>
              <NButton size="small" @click="loadLogs(currentPage)">刷新</NButton>
            </div>
          </template>
          <NSpin :show="logsLoading">
            <NDataTable
              :columns="logColumns"
              :data="logs"
              :bordered="false"
              size="small"
              striped
            />
          </NSpin>
          <div style="display:flex; align-items:center; justify-content:center; gap:16px; margin-top:16px;">
            <NButton size="small" :disabled="currentPage <= 1" @click="loadLogs(currentPage - 1)">上一页</NButton>
            <NText depth="3" style="font-size:13px;">第 {{ currentPage }} / {{ totalPages }} 页（共 {{ totalLogs }} 条）</NText>
            <NButton size="small" :disabled="currentPage >= totalPages" @click="loadLogs(currentPage + 1)">下一页</NButton>
          </div>
        </NCard>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.info-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}

.info-label {
  font-size: 12px;
  min-width: 64px;
  flex-shrink: 0;
}
</style>
