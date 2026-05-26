<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listMangaItems } from '../services/db'
import type { MangaItem } from '../models/MangaItem'
import { getMangaStyle } from '../models/MangaStyle'

const items = ref<MangaItem[]>([])
const loading = ref(true)

async function refresh() {
  loading.value = true
  items.value = await listMangaItems()
  loading.value = false
}

onMounted(refresh)

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <header class="mb-6 flex items-end justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink-900">历史</h1>
        <p class="mt-1 text-sm text-ink-500">
          所有生成结果存在浏览器里，关页面也不丢。
        </p>
      </div>
      <button
        @click="refresh"
        type="button"
        class="text-xs text-accent-500 hover:underline"
      >
        刷新
      </button>
    </header>

    <!-- 加载中 -->
    <div v-if="loading" class="py-20 text-center text-sm text-ink-300">
      加载中…
    </div>

    <!-- 空状态 -->
    <div
      v-else-if="items.length === 0"
      class="rounded-xl border border-dashed border-ink-100 px-6 py-16 text-center"
    >
      <p class="text-sm text-ink-500">还没有作品</p>
      <p class="mt-2 text-xs text-ink-300">
        去「设置 → 开发工具 → 塞 5 条假数据」试一下
      </p>
    </div>

    <!-- 列表 -->
    <ul v-else class="grid grid-cols-2 gap-3">
      <li
        v-for="item in items"
        :key="item.id"
        class="overflow-hidden rounded-xl border border-ink-100 bg-white"
      >
        <div
          :class="[
            'aspect-square w-full',
            getMangaStyle(item.style)?.swatchClass ?? 'bg-ink-100',
          ]"
        />
        <div class="p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-ink-900">
              {{ getMangaStyle(item.style)?.displayName ?? item.style }}
            </span>
            <span v-if="item.isFavorite" class="text-xs text-pink-500">★</span>
          </div>
          <p class="mt-1 line-clamp-2 text-xs text-ink-500">
            {{ item.userPrompt || '（无 prompt）' }}
          </p>
          <p class="mt-2 text-[10px] text-ink-300">
            {{ formatTime(item.createdAt) }}
          </p>
        </div>
      </li>
    </ul>
  </main>
</template>
