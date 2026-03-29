<script setup lang="ts">
import { computed } from 'vue'
import { NProgress, NText } from 'naive-ui'
import type { UsageData } from '../types/api'

const props = defineProps<{
  data: UsageData | null
}>()

const info = computed(() => {
  const premium = props.data?.quota_snapshots?.premium_interactions
  if (!premium) return null
  if (premium.unlimited) return { unlimited: true, used: 0, total: 0, pct: 0, resetDate: '' }

  const total = premium.entitlement ?? 0
  const remaining = premium.remaining ?? 0
  const used = total - remaining
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  const resetDate = props.data?.quota_reset_date_utc
    ? new Date(props.data.quota_reset_date_utc).toLocaleDateString('zh-CN')
    : ''
  return { unlimited: false, used, total, pct, resetDate }
})

const barStatus = computed(() => {
  const p = info.value?.pct ?? 0
  if (p >= 90) return 'error'
  if (p >= 70) return 'warning'
  return 'success'
})
</script>

<template>
  <div v-if="!info">
    <NText depth="3">-</NText>
  </div>
  <div v-else-if="info.unlimited">
    <NText depth="3">无限制</NText>
  </div>
  <div v-else style="min-width: 140px;">
    <NProgress
      type="line"
      :percentage="info.pct"
      :status="barStatus"
      :show-indicator="false"
      style="margin-bottom: 4px;"
    />
    <NText depth="3" style="font-size: 11px;">
      {{ info.used }}/{{ info.total }} ({{ info.pct }}%)
      <span v-if="info.resetDate"> · 重置：{{ info.resetDate }}</span>
    </NText>
  </div>
</template>
