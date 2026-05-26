<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { db, listMangaItems, loadImageURLs } from '../services/db'
import type { MangaItem } from '../models/MangaItem'
import { getMangaStyle } from '../models/MangaStyle'
import StyleSwatch from '../components/StyleSwatch.vue'

interface DisplayItem extends MangaItem {
  thumbUrls: (string | null)[]
}

const items = ref<DisplayItem[]>([])
const loading = ref(true)

// 详情 modal 状态
const activeItem = ref<DisplayItem | null>(null)
const activeIndex = ref(0)

async function refresh() {
  for (const item of items.value) item.thumbUrls.forEach((u) => u && URL.revokeObjectURL(u))
  loading.value = true
  const raw = await listMangaItems()
  items.value = await Promise.all(
    raw.map(async (m) => ({ ...m, thumbUrls: await loadImageURLs(m.outputImageNames) })),
  )
  loading.value = false
}

onMounted(refresh)
onUnmounted(() => {
  for (const item of items.value) item.thumbUrls.forEach((u) => u && URL.revokeObjectURL(u))
})

function formatTime(ms: number): string {
  const d = new Date(ms)
  const now = Date.now()
  const diff = (now - ms) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function openItem(item: DisplayItem) {
  if (item.thumbUrls.length === 0 || !item.thumbUrls.some((u) => u)) return
  activeItem.value = item
  activeIndex.value = 0
  // 阻止背后页面滚动
  document.body.style.overflow = 'hidden'
}

function closeItem() {
  activeItem.value = null
  document.body.style.overflow = ''
}

async function toggleFavorite() {
  if (!activeItem.value) return
  const next = !activeItem.value.isFavorite
  await db.mangas.update(activeItem.value.id, { isFavorite: next })
  activeItem.value.isFavorite = next
  // items 数组里同步
  const idx = items.value.findIndex((x) => x.id === activeItem.value!.id)
  if (idx >= 0) items.value[idx].isFavorite = next
}

async function deleteItem() {
  if (!activeItem.value) return
  if (!confirm('删除这条作品？图片也会从本地一起删掉。')) return
  // 删图 blob
  for (const id of activeItem.value.outputImageNames) {
    await db.images.delete(id)
  }
  await db.mangas.delete(activeItem.value.id)
  // 释放 URL
  activeItem.value.thumbUrls.forEach((u) => u && URL.revokeObjectURL(u))
  // 从列表里移除
  const idx = items.value.findIndex((x) => x.id === activeItem.value!.id)
  if (idx >= 0) items.value.splice(idx, 1)
  closeItem()
}

function downloadCurrent() {
  if (!activeItem.value) return
  const url = activeItem.value.thumbUrls[activeIndex.value]
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = `lifemanga-${activeItem.value.id.slice(0, 8)}-${activeIndex.value + 1}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <header class="mb-5 flex items-end justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink-50">历史</h1>
        <p class="mt-0.5 text-xs text-ink-300">所有生成结果存浏览器里，关页面也不丢</p>
      </div>
      <button @click="refresh" type="button" class="text-xs text-accent-300 hover:underline">刷新</button>
    </header>

    <div v-if="loading" class="py-20 text-center text-sm text-ink-300">加载中…</div>

    <div v-else-if="items.length === 0"
      class="rounded-2xl border border-dashed border-white/10 bg-ink-800/40 px-6 py-16 text-center backdrop-blur">
      <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-500/15">
        <svg class="h-6 w-6 text-accent-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-6h13M5 5v14a2 2 0 002 2h12a2 2 0 002-2V9.5L13.5 3H7a2 2 0 00-2 2z"/>
        </svg>
      </div>
      <p class="text-sm text-ink-100">还没有作品</p>
      <p class="mt-1 text-xs text-ink-300">回「创作」生成一张吧</p>
    </div>

    <ul v-else class="grid grid-cols-2 gap-2.5">
      <li v-for="item in items" :key="item.id">
        <button
          type="button"
          @click="openItem(item)"
          class="group block w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-800/60 text-left backdrop-blur transition hover:border-accent-500/40 hover:shadow-lg hover:shadow-accent-500/10 active:scale-[0.98]"
        >
          <div class="relative aspect-square w-full overflow-hidden">
            <img v-if="item.thumbUrls[0]" :src="item.thumbUrls[0]!"
              class="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
            <div v-else class="h-full w-full">
              <StyleSwatch :style="item.style" />
            </div>
            <div class="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">
              {{ getMangaStyle(item.style)?.displayName ?? item.style }}
            </div>
            <span v-if="item.isFavorite"
              class="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-pink-500/85 text-[11px] text-white">★</span>
            <span v-if="item.thumbUrls.length > 1"
              class="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white backdrop-blur">
              ×{{ item.thumbUrls.length }}
            </span>
          </div>
          <div class="px-2.5 py-2">
            <p class="line-clamp-1 text-[11px] text-ink-100">{{ item.userPrompt || '（无 prompt）' }}</p>
            <p class="mt-1 text-[10px] text-ink-300">{{ formatTime(item.createdAt) }}</p>
          </div>
        </button>
      </li>
    </ul>

    <!-- 详情 Modal -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="activeItem" class="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md"
           @click.self="closeItem">
        <!-- 顶部条 -->
        <header class="flex items-center justify-between p-3" style="padding-top: max(0.75rem, env(safe-area-inset-top))">
          <button type="button" @click="closeItem"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-ink-50 backdrop-blur transition hover:bg-white/20">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <span v-if="activeItem.thumbUrls.length > 1" class="text-xs text-ink-300">
            {{ activeIndex + 1 }} / {{ activeItem.thumbUrls.length }}
          </span>
          <button type="button" @click="toggleFavorite"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20"
            :class="activeItem.isFavorite ? 'text-pink-400' : 'text-ink-300'">
            <svg class="h-5 w-5" :fill="activeItem.isFavorite ? 'currentColor' : 'none'" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
            </svg>
          </button>
        </header>

        <!-- 大图 -->
        <div class="flex flex-1 items-center justify-center overflow-y-auto px-4">
          <img v-if="activeItem.thumbUrls[activeIndex]"
               :src="activeItem.thumbUrls[activeIndex]!"
               class="max-h-full max-w-full rounded-xl shadow-2xl" />
        </div>

        <!-- 多图分页指示 -->
        <div v-if="activeItem.thumbUrls.length > 1" class="flex justify-center gap-2 py-3">
          <button v-for="(_, i) in activeItem.thumbUrls" :key="i" type="button"
            @click="activeIndex = i"
            class="h-2 rounded-full transition"
            :class="[i === activeIndex ? 'w-6 bg-white' : 'w-2 bg-white/30']" />
        </div>

        <!-- 底部 meta + actions -->
        <div class="border-t border-white/10 bg-ink-900/80 backdrop-blur"
             style="padding-bottom: env(safe-area-inset-bottom)">
          <div class="px-4 py-3">
            <div class="mb-2 flex items-center gap-2">
              <span class="rounded-full bg-accent-500/20 px-2 py-0.5 text-[11px] font-medium text-accent-300">
                {{ getMangaStyle(activeItem.style)?.displayName ?? activeItem.style }}
              </span>
              <span class="text-[11px] text-ink-300">{{ formatTime(activeItem.createdAt) }}</span>
            </div>
            <p v-if="activeItem.userPrompt" class="mb-3 text-sm text-ink-100">{{ activeItem.userPrompt }}</p>
            <div class="flex gap-2">
              <button type="button" @click="downloadCurrent"
                class="flex-1 rounded-xl border border-white/10 bg-ink-800/60 px-3 py-2 text-xs font-medium text-ink-50 transition hover:border-accent-500/40">
                下载图片
              </button>
              <button type="button" @click="deleteItem"
                class="flex-1 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition hover:border-red-500/50">
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </main>
</template>
