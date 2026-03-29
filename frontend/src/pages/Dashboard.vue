<script setup lang="ts">
import { ref, onMounted, onUnmounted, h } from 'vue'
import {
  NCard, NGrid, NGridItem, NStatistic, NDataTable, NButton, NTag, NSpin, NText,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useApi } from '../composables/useApi'
import type { Stats, RequestLog, LogsResponse } from '../types/api'

const api = useApi()
const stats = ref<Stats | null>(null)
const logs = ref<RequestLog[]>([])
const loading = ref(true)
let timer: ReturnType<typeof setInterval> | null = null

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

const columns: DataTableColumns<RequestLog> = [
  {
    title: '时间',
    key: 'created_at',
    width: 130,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;' }, () => formatDate(row.created_at)),
  },
  { title: '账号', key: 'account_name', width: 100 },
  {
    title: 'Key',
    key: 'api_key_name',
    width: 100,
    render: (row) => h(NText, { depth: 3 }, () => row.api_key_name),
  },
  {
    title: '方法',
    key: 'method',
    width: 70,
    render: (row) => h('code', {}, row.method),
  },
  {
    title: '模型',
    key: 'model',
    width: 120,
    render: (row) => h(NText, { depth: 3 }, () => row.model ?? '-'),
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
]

async function loadData() {
  try {
    const [statsData, logsRes] = await Promise.all([
      api.get<Stats>('/stats'),
      api.get<LogsResponse>('/logs?limit=20'),
    ])
    stats.value = statsData
    logs.value = logsRes.logs
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
  timer = setInterval(loadData, 15_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>仪表盘</h2>
      <p>系统整体运行状态概览</p>
    </div>

    <NGrid :cols="4" :x-gap="16" style="margin-bottom: 24px;">
      <NGridItem>
        <NCard>
          <NStatistic label="账号总数" :value="stats?.total_accounts ?? '-'" />
        </NCard>
      </NGridItem>
      <NGridItem>
        <NCard>
          <NStatistic label="启用的 Key" :value="stats?.enabled_keys ?? '-'" />
        </NCard>
      </NGridItem>
      <NGridItem>
        <NCard>
          <NStatistic label="今日请求" :value="stats?.today_requests ?? '-'" />
        </NCard>
      </NGridItem>
      <NGridItem>
        <NCard>
          <NStatistic label="历史总请求" :value="stats?.total_requests ?? '-'" />
        </NCard>
      </NGridItem>
    </NGrid>

    <NCard>
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span>最近请求</span>
          <NButton size="small" @click="loadData">刷新</NButton>
        </div>
      </template>
      <NSpin :show="loading">
        <NDataTable
          :columns="columns"
          :data="logs"
          :max-height="400"
          size="small"
          :bordered="false"
          striped
        />
      </NSpin>
    </NCard>
  </div>
</template>
