<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { listMangaItems, loadImageURLs } from '../services/db'
import type { MangaItem } from '../models/MangaItem'
import { getMangaStyle } from '../models/MangaStyle'

interface DisplayItem extends MangaItem {
  /** 输出图的 object URL 数组, 跟 outputImageNames 一一对应。null 表示找不到 */
  thumbUrls: (string | null)[]
}

const items = ref<DisplayItem[]>([])
const loading = ref(true)

async function refresh() {
  // 先清掉旧的 object URLs，避免泄漏
  for (const item of items.value) {
    item.thumbUrls.forEach((u) => u && URL.revokeObjectURL(u))
  }
  loading.value = true
  const raw = await listMangaItems()
  const enriched: DisplayItem[] = await Promise.all(
    raw.map(async (m) => ({
      ...m,
      thumbUrls: await loadImageURLs(m.outputImageNames),
    })),
  )
  items.value = enriched
  loading.value = false
}

onMounted(refresh)

onUnmounted(() => {
  // 离开页面时释放所有 object URLs
  for (const item of items.value) {
    item.thumbUrls.forEach((u) => u && URL.revokeObjectURL(u))
  }
})

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
        <p class="mt-1 text-sm text-ink-500">所有生成结果存在浏览器里，关页面也不丢。</p>
      </div>
      <button @click="refresh" type="button" class="text-xs text-accent-500 hover:underline">刷新</button>
    </header>

    <div v-if="loading" class="py-20 text-center text-sm text-ink-300">加载中…</div>

    <div
      v-else-if="items.length === 0"
      class="rounded-xl border border-dashed border-ink-100 px-6 py-16 text-center"
    >
      <p class="text-sm text-ink-500">还没有作品</p>
      <p class="mt-2 text-xs text-ink-300">回「创作」生成一张吧</p>
    </div>

    <ul v-else class="grid grid-cols-2 gap-3">
      <li v-for="item in items" :key="item.id" class="overflow-hidden rounded-xl border border-ink-100 bg-white">
        <!-- 实图: 第一张作为缩略图。没图时 fallback 到 swatch 色块 -->
        <img
          v-if="item.thumbUrls[0]"
          :src="item.thumbUrls[0]!"
          class="aspect-square w-full object-cover"
        />
        <div
          v-else
          :class="['aspect-square w-full', getMangaStyle(item.style)?.swatchClass ?? 'bg-ink-100']"
        />
        <div class="p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-ink-900">
              {{ getMangaStyle(item.style)?.displayName ?? item.style }}
            </span>
            <div class="flex items-center gap-1">
              <span v-if="item.thumbUrls.length > 1" class="text-[10px] text-ink-300">
                ×{{ item.thumbUrls.length }}
              </span>
              <span v-if="item.isFavorite" class="text-xs text-pink-500">★</span>
            </div>
          </div>
          <p class="mt-1 line-clamp-2 text-xs text-ink-500">
            {{ item.userPrompt || '（无 prompt）' }}
          </p>
          <p class="mt-2 text-[10px] text-ink-300">{{ formatTime(item.createdAt) }}</p>
        </div>
      </li>
    </ul>
  </main>
</template>
