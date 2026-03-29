<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'

const props = defineProps<{
  status: string
}>()

type TagType = 'success' | 'error' | 'warning' | 'info' | 'default'

const tagType = computed((): TagType => {
  switch (props.status) {
    case 'enabled':
    case 'success':
      return 'success'
    case 'disabled':
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'admin':
      return 'info'
    default:
      return 'default'
  }
})

const label = computed(() => {
  switch (props.status) {
    case 'enabled': return '启用'
    case 'disabled': return '禁用'
    case 'admin': return 'admin'
    case 'user': return 'user'
    default: return props.status
  }
})
</script>

<template>
  <NTag :type="tagType" size="small" :bordered="false">{{ label }}</NTag>
</template>
