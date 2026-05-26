<script setup lang="ts">
import { onMounted } from 'vue'
import BottomTabBar from './components/BottomTabBar.vue'
import { ensureDefaultProject } from './services/db'

onMounted(async () => {
  // App 启动时确保有一个默认工程，避免后续创作流落空
  await ensureDefaultProject()
})
</script>

<template>
  <div class="min-h-screen bg-ink-50 text-ink-700">
    <RouterView />
    <BottomTabBar />
  </div>
</template>
