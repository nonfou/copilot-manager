<script setup lang="ts">
import { NLayout, NLayoutSider, NLayoutContent } from 'naive-ui'
import AppSidebar from '../components/AppSidebar.vue'
</script>

<template>
  <NLayout has-sider style="height: 100vh; background: #0f0f0f;">
    <NLayoutSider
      bordered
      :native-scrollbar="false"
      :width="220"
      content-style="padding: 0;"
      style="background: #161616;"
    >
      <AppSidebar />
    </NLayoutSider>
    <NLayoutContent
      :native-scrollbar="false"
      content-style="padding: 28px; min-height: 100vh; background: #0f0f0f;"
    >
      <slot />
    </NLayoutContent>
  </NLayout>
</template>
