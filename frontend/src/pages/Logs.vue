<script setup lang="ts">
import { ref, h, onMounted, computed } from 'vue'
import {
  NCard, NButton, NDataTable, NSelect, NText, NSpace, NSpin, useMessage, NTag,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import { useApi } from '../composables/useApi'
import type { RequestLog, LogsResponse, Account } from '../types/api'

const api = useApi()
const message = useMessage()

const logs = ref<RequestLog[]>([])
const loading = ref(true)
const currentPage = ref(1)
const totalLogs = ref(0)
const pageSize = 50

const filterAccountId = ref('')
const accountFilterOptions = ref<SelectOption[]>([{ label: '所有账号', value: '' }])

const totalPages = computed(() => Math.ceil(totalLogs.value / pageSize) || 1)

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

async function loadAccountFilter() {
  try {
    const accounts = await api.get<Account[]>('/accounts')
    accountFilterOptions.value = [
      { label: '所有账号', value: '' },
      ...accounts.map(a => ({ label: a.name, value: a.id })),
    ]
  } catch {
    // ignore
  }
}

async function loadLogs(page = 1) {
  if (page < 1) return
  loading.value = true
  currentPage.value = page
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize) })
  if (filterAccountId.value) params.set('account_id', filterAccountId.value)
  try {
    const res = await api.get<LogsResponse>(`/logs?${params}`)
    logs.value = res.logs
    totalLogs.value = res.total
  } catch (e) {
    message.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

const columns: DataTableColumns<RequestLog> = [
  {
    title: '时间',
    key: 'created_at',
    width: 140,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px; white-space:nowrap;' }, () => formatDate(row.created_at)),
  },
  { title: '账号', key: 'account_name', width: 100 },
  { title: 'Key', key: 'api_key_name', width: 100, render: (row) => h(NText, { depth: 3 }, () => row.api_key_name) },
  { title: '方法', key: 'method', width: 70, render: (row) => h('code', {}, row.method) },
  { title: '模型', key: 'model', width: 120, render: (row) => h(NText, { depth: 3 }, () => row.model ?? '-') },
  {
    title: 'Tokens',
    key: 'tokens',
    width: 160,
    render: (row) => {
      if (row.prompt_tokens == null && row.completion_tokens == null) return h(NText, { depth: 3 }, () => '-')
      const parts: string[] = []
      if (row.prompt_tokens != null || row.completion_tokens != null) {
        parts.push(`in ${row.prompt_tokens ?? 0} / out ${row.completion_tokens ?? 0}`)
      }
      if (row.total_tokens != null) parts.push(`total ${row.total_tokens}`)
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
    title: '首Token',
    key: 'first_token_ms',
    width: 90,
    render: (row) => row.first_token_ms != null ? h(NText, { depth: 3 }, () => formatDuration(row.first_token_ms!)) : h(NText, { depth: 3 }, () => '-'),
  },
  {
    title: '错误',
    key: 'error',
    width: 140,
    ellipsis: { tooltip: true },
    render: (row) => row.error ? h(NText, { type: 'error', style: 'font-size:12px;' }, () => row.error!) : h('span', {}, ''),
  },
]

onMounted(async () => {
  await loadAccountFilter()
  await loadLogs(1)
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>请求日志</h2>
      <p>最近 5000 条代理请求记录</p>
    </div>

    <NCard>
      <template #header>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <NSpace align="center">
            <span>日志列表</span>
            <NSelect
              v-model:value="filterAccountId"
              :options="accountFilterOptions"
              style="width: 160px;"
              size="small"
              @update:value="loadLogs(1)"
            />
          </NSpace>
          <NButton size="small" @click="loadLogs(currentPage)">刷新</NButton>
        </div>
      </template>
      <NSpin :show="loading">
        <NDataTable
          :columns="columns"
          :data="logs"
          :bordered="false"
          size="small"
          striped
          :max-height="500"
        />
      </NSpin>
      <div style="display:flex; align-items:center; justify-content:center; gap:16px; margin-top:16px;">
        <NButton size="small" :disabled="currentPage <= 1" @click="loadLogs(currentPage - 1)">上一页</NButton>
        <NText depth="3" style="font-size:13px;">第 {{ currentPage }} / {{ totalPages }} 页（共 {{ totalLogs }} 条）</NText>
        <NButton size="small" :disabled="currentPage >= totalPages" @click="loadLogs(currentPage + 1)">下一页</NButton>
      </div>
    </NCard>
  </div>
</template>
