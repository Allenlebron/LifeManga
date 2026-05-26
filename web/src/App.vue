<script setup lang="ts">
import { onMounted } from 'vue'
import BottomTabBar from './components/BottomTabBar.vue'
import { ensureDefaultProject } from './services/db'

onMounted(async () => {
  await ensureDefaultProject()
})
</script>

<template>
  <!-- 全局背景: 接近黑底 + 顶部紫色光晕 (跟 iOS 端的沉浸式氛围一致) -->
  <div
    class="relative min-h-screen text-ink-50"
    style="background: radial-gradient(120% 60% at 50% 0%, rgba(170, 59, 255, 0.18) 0%, rgba(13, 12, 20, 0) 60%), #0d0c14;"
  >
    <RouterView />
    <BottomTabBar />
  </div>
</template>
