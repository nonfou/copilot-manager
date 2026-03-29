<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterView } from 'vue-router'
import { NConfigProvider, darkTheme, type GlobalThemeOverrides } from 'naive-ui'
import DefaultLayout from './layouts/DefaultLayout.vue'
import AuthLayout from './layouts/AuthLayout.vue'

const route = useRoute()
const layout = computed(() =>
  route.meta.layout === 'auth' ? AuthLayout : DefaultLayout
)

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#6c63ff',
    primaryColorHover: '#8178ff',
    primaryColorPressed: '#5a52d5',
    primaryColorSuppl: '#6c63ff',
    fontFamily: '"Inter", "SF Pro Text", system-ui, sans-serif',
  },
  Button: {
    borderRadiusMedium: '6px',
    borderRadiusSmall: '4px',
  },
  Card: {
    borderRadius: '8px',
  },
}
</script>

<template>
  <NConfigProvider :theme="darkTheme" :theme-overrides="themeOverrides">
    <component :is="layout">
      <RouterView />
    </component>
  </NConfigProvider>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  height: 100%;
  background: #0f0f0f;
  color: #e8e8e8;
  font-family: 'Inter', 'SF Pro Text', system-ui, sans-serif;
  font-size: 14px;
}

#app {
  height: 100%;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: #1a1a1a;
}

::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #444;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h2 {
  font-size: 20px;
  font-weight: 600;
  color: #e8e8e8;
  margin-bottom: 4px;
}

.page-header p {
  color: #888;
  font-size: 13px;
}

.monospace {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}
</style>
