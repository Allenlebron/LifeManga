<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { db, listMangaItems, listProjects, seedFakeData } from '../services/db'

const apiKey = ref('')
const isKeyVisible = ref(false)
const saved = ref(false)

const stats = ref<{ projects: number; mangas: number; characters: number }>({
  projects: 0,
  mangas: 0,
  characters: 0,
})

const seedMessage = ref('')
const isSeeding = ref(false)

async function refreshStats() {
  const [projects, mangas, characters] = await Promise.all([
    listProjects(),
    listMangaItems(),
    db.characters.toArray(),
  ])
  stats.value = {
    projects: projects.length,
    mangas: mangas.length,
    characters: characters.length,
  }
}

onMounted(() => {
  // 注：localStorage 不是真正安全的存储，只是用来在 BYOK 上不让用户每次都重新粘贴
  // Weekend 4 接 Worker 时改用 sessionStorage 或 in-memory 减少持久泄漏面
  apiKey.value = localStorage.getItem('lifemanga.openai_api_key') ?? ''
  refreshStats()
})

function saveKey() {
  localStorage.setItem('lifemanga.openai_api_key', apiKey.value.trim())
  saved.value = true
  setTimeout(() => (saved.value = false), 1600)
}

async function handleSeed() {
  isSeeding.value = true
  seedMessage.value = ''
  try {
    const result = await seedFakeData()
    seedMessage.value = `已写入 1 个工程 + ${result.mangaCount} 条 manga。去「历史」看看。`
    await refreshStats()
  } catch (e) {
    seedMessage.value = `失败: ${(e as Error).message}`
  } finally {
    isSeeding.value = false
  }
}

async function handleClear() {
  if (!confirm('确认清空所有本地数据？此操作不可逆。')) return
  await db.delete()
  // 重建 schema
  await db.open()
  seedMessage.value = '已清空所有数据。'
  await refreshStats()
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">设置</h1>
      <p class="mt-1 text-sm text-ink-500">本地 BYOK + 数据管理</p>
    </header>

    <!-- BYOK -->
    <section class="mb-8">
      <h2 class="mb-2 text-sm font-medium text-ink-900">OpenAI API Key</h2>
      <p class="mb-3 text-xs text-ink-500">
        粘贴你自己的 OpenAI API Key (sk-...)。Key 只存在你这台设备的浏览器里 (localStorage)，源码不会上传任何 Key。
      </p>
      <div class="flex gap-2">
        <input
          :type="isKeyVisible ? 'text' : 'password'"
          v-model="apiKey"
          placeholder="sk-..."
          class="flex-1 rounded-lg border border-ink-100 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
        />
        <button
          type="button"
          @click="isKeyVisible = !isKeyVisible"
          class="rounded-lg border border-ink-100 px-3 text-xs text-ink-500 transition hover:border-ink-300"
        >
          {{ isKeyVisible ? '隐藏' : '显示' }}
        </button>
      </div>
      <button
        type="button"
        @click="saveKey"
        class="mt-3 w-full rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500/90"
      >
        {{ saved ? '已保存' : '保存' }}
      </button>
    </section>

    <!-- 数据统计 -->
    <section class="mb-8">
      <h2 class="mb-2 text-sm font-medium text-ink-900">本地数据</h2>
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-lg border border-ink-100 bg-white p-3 text-center">
          <div class="text-xl font-semibold text-ink-900">{{ stats.projects }}</div>
          <div class="mt-0.5 text-xs text-ink-500">工程</div>
        </div>
        <div class="rounded-lg border border-ink-100 bg-white p-3 text-center">
          <div class="text-xl font-semibold text-ink-900">{{ stats.mangas }}</div>
          <div class="mt-0.5 text-xs text-ink-500">作品</div>
        </div>
        <div class="rounded-lg border border-ink-100 bg-white p-3 text-center">
          <div class="text-xl font-semibold text-ink-900">{{ stats.characters }}</div>
          <div class="mt-0.5 text-xs text-ink-500">角色</div>
        </div>
      </div>
    </section>

    <!-- Dev 工具 -->
    <section class="mb-8">
      <h2 class="mb-2 text-sm font-medium text-ink-900">开发工具</h2>
      <p class="mb-3 text-xs text-ink-500">仅供开发期使用，验证 IndexedDB 持久化是否工作。</p>
      <div class="space-y-2">
        <button
          type="button"
          @click="handleSeed"
          :disabled="isSeeding"
          class="w-full rounded-lg border border-ink-100 bg-white px-4 py-2 text-sm font-medium text-ink-900 transition hover:border-accent-500/40 disabled:opacity-50"
        >
          {{ isSeeding ? '写入中…' : '塞 5 条假数据' }}
        </button>
        <button
          type="button"
          @click="handleClear"
          class="w-full rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:border-red-300"
        >
          清空所有本地数据
        </button>
      </div>
      <p v-if="seedMessage" class="mt-3 text-xs text-ink-700">
        {{ seedMessage }}
      </p>
    </section>

    <!-- 关于 -->
    <section>
      <h2 class="mb-2 text-sm font-medium text-ink-900">关于</h2>
      <p class="text-xs text-ink-500">
        漫画人生 LifeManga · Web 版 v0.0.2 · MIT
      </p>
      <p class="mt-1 text-xs text-ink-300">
        iOS 版同源 ·
        <a
          href="https://github.com/iam567/LifeManga"
          target="_blank"
          rel="noreferrer"
          class="text-accent-500 hover:underline"
        >
          github.com/iam567/LifeManga
        </a>
      </p>
    </section>
  </main>
</template>
