<script setup lang="ts">
</script>

<template>
  <div class="auth-layout">
    <slot />
  </div>
</template>

<style scoped>
.auth-layout {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at 50% 30%, #1a1535 0%, #0a0a14 60%, #0f0f0f 100%);
  padding: 24px;
}
</style>
