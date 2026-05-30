<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { db, imagesTotalBytes, listMangaItems, listProjects, seedFakeData } from '../services/db'
import { getWorkerUrl, setWorkerUrl, type ProviderId } from '../services/api'
import {
  BUBBLE_TEXT_MODES,
  DEFAULT_OPTIONS_BY_PROVIDER,
  DEFAULT_STORY_OPTIONS_BY_PROVIDER,
  SIZE_OPTIONS_BY_PROVIDER,
  loadApiKey, loadCurrentProvider, loadStoryOptions, loadStyleOptions,
  saveApiKey, saveCurrentProvider, saveStoryOptions, saveStyleOptions,
  type JobStyleOptions,
  type StoryOptions,
} from '../models/JobOptions'

const PROVIDERS: { id: ProviderId; label: string; hint: string }[] = [
  { id: 'siliconflow', label: 'SiliconFlow', hint: '硅基流动 · 国内可直连 · Qwen Image' },
  { id: 'openai', label: 'OpenAI', hint: 'gpt-image-2 · 需翻墙 + 验证' },
  { id: 'freemodel', label: 'FreeModel', hint: '兼容 SF JSON 协议' },
  { id: 'chatimage', label: 'Chat Image', hint: 'Chat Completions 出图 · 本地 API / Gemini' },
]

const provider = ref<ProviderId>('siliconflow')
const apiKey = ref('')
const isKeyVisible = ref(false)
const saved = ref(false)
const styleOptions = ref<JobStyleOptions>({ ...DEFAULT_OPTIONS_BY_PROVIDER.siliconflow })
const storyOptions = ref<StoryOptions>({ ...DEFAULT_STORY_OPTIONS_BY_PROVIDER.siliconflow })
const showAdvanced = ref(false)
const workerUrlInput = ref('')
const providerBaseUrlInput = ref('')

const stats = ref<{ projects: number; mangas: number; characters: number; imagesMB: string }>({
  projects: 0, mangas: 0, characters: 0, imagesMB: '0',
})
const seedMessage = ref('')
const isSeeding = ref(false)

const sizeOptions = computed(() => SIZE_OPTIONS_BY_PROVIDER[provider.value])
const showQuality = computed(() => provider.value === 'openai')

async function refreshStats() {
  const [projects, mangas, characters, bytes] = await Promise.all([
    listProjects(), listMangaItems(), db.characters.toArray(), imagesTotalBytes(),
  ])
  stats.value = {
    projects: projects.length, mangas: mangas.length, characters: characters.length,
    imagesMB: (bytes / 1024 / 1024).toFixed(2),
  }
}

onMounted(() => {
  provider.value = loadCurrentProvider()
  apiKey.value = loadApiKey(provider.value)
  styleOptions.value = loadStyleOptions(provider.value)
  storyOptions.value = loadStoryOptions(provider.value)
  workerUrlInput.value = localStorage.getItem('lifemanga.worker_url') ?? ''
  providerBaseUrlInput.value = localStorage.getItem('lifemanga.provider_base_url') ?? ''
  refreshStats()
})

watch(provider, (newP) => {
  saveCurrentProvider(newP)
  apiKey.value = loadApiKey(newP)
  const validSizes = SIZE_OPTIONS_BY_PROVIDER[newP]
  if (!validSizes.includes(styleOptions.value.size)) {
    styleOptions.value = { ...DEFAULT_OPTIONS_BY_PROVIDER[newP] }
  } else {
    styleOptions.value.model = DEFAULT_OPTIONS_BY_PROVIDER[newP].model
  }
  // story scriptModel 也跟着 provider 走
  storyOptions.value.scriptModel = DEFAULT_STORY_OPTIONS_BY_PROVIDER[newP].scriptModel
})

watch(styleOptions, (v) => saveStyleOptions(v), { deep: true })
watch(storyOptions, (v) => saveStoryOptions(v), { deep: true })

function saveKey() {
  saveApiKey(provider.value, apiKey.value)
  saved.value = true
  setTimeout(() => (saved.value = false), 1600)
}

function applyAdvanced() {
  setWorkerUrl(workerUrlInput.value)
  if (providerBaseUrlInput.value.trim()) {
    localStorage.setItem('lifemanga.provider_base_url', providerBaseUrlInput.value.trim())
  } else {
    localStorage.removeItem('lifemanga.provider_base_url')
  }
  saved.value = true
  setTimeout(() => (saved.value = false), 1600)
}

async function handleSeed() {
  isSeeding.value = true
  seedMessage.value = ''
  try {
    const r = await seedFakeData()
    seedMessage.value = `已写入 1 个工程 + ${r.mangaCount} 条 manga`
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
  await db.open()
  seedMessage.value = '已清空所有数据'
  await refreshStats()
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-8 pb-28">
    <header class="mb-6">
      <h1 class="text-3xl font-semibold tracking-tight text-ink-50">设置</h1>
      <p class="mt-1 text-sm text-ink-300">BYOK + 后端 Provider + 本地数据</p>
    </header>

    <!-- Provider -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-100">后端 Provider</h2>
      <div class="space-y-2">
        <label v-for="p in PROVIDERS" :key="p.id"
          class="flex cursor-pointer items-start gap-3 rounded-xl border bg-ink-800/60 p-3 backdrop-blur transition"
          :class="[provider === p.id ? 'border-accent-500 ring-1 ring-accent-500/40' : 'border-white/10 hover:border-white/20']">
          <input type="radio" :value="p.id" v-model="provider" class="mt-1 accent-accent-500" />
          <div>
            <div class="text-sm font-medium text-ink-50">{{ p.label }}</div>
            <div class="text-xs text-ink-300">{{ p.hint }}</div>
          </div>
        </label>
      </div>
    </section>

    <!-- BYOK -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-100">API Key</h2>
      <p class="mb-3 text-xs text-ink-300">
        粘贴 {{ PROVIDERS.find((p) => p.id === provider)?.label }} 的 key。仅存本机浏览器，每个 provider 独立保存。
      </p>
      <div class="flex gap-2">
        <input :type="isKeyVisible ? 'text' : 'password'" v-model="apiKey" placeholder="sk-..."
          class="flex-1 rounded-xl border border-white/10 bg-ink-800/60 px-3 py-2.5 text-sm text-ink-50 placeholder:text-ink-500 backdrop-blur focus:border-accent-500/60 focus:outline-none focus:ring-2 focus:ring-accent-500/20" />
        <button type="button" @click="isKeyVisible = !isKeyVisible"
          class="rounded-xl border border-white/10 bg-ink-800/60 px-3 text-xs text-ink-300 transition hover:text-ink-100">
          {{ isKeyVisible ? '隐藏' : '显示' }}
        </button>
      </div>
      <button type="button" @click="saveKey"
        class="mt-3 w-full rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-500/20 transition hover:from-accent-300 hover:to-accent-500">
        {{ saved ? '已保存 ✓' : '保存' }}
      </button>
    </section>

    <!-- 生成参数 -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-100">生成参数</h2>
      <div class="space-y-3 rounded-xl border border-white/10 bg-ink-800/60 p-4 backdrop-blur">
        <div>
          <label class="text-xs text-ink-300">模型</label>
          <input v-model="styleOptions.model" type="text"
            class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 font-mono text-sm text-ink-50 focus:border-accent-500/60 focus:outline-none" />
        </div>
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="text-xs text-ink-300">尺寸</label>
            <select v-model="styleOptions.size"
              class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 text-sm text-ink-50 focus:border-accent-500/60 focus:outline-none">
              <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="w-24">
            <label class="text-xs text-ink-300">张数</label>
            <input v-model.number="styleOptions.n" type="number" min="1" max="4"
              class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 text-sm text-ink-50 focus:border-accent-500/60 focus:outline-none" />
          </div>
        </div>
        <div v-if="showQuality">
          <label class="text-xs text-ink-300">质量 (仅 OpenAI)</label>
          <select v-model="styleOptions.quality"
            class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 text-sm text-ink-50 focus:border-accent-500/60 focus:outline-none">
            <option value="auto">auto</option>
            <option value="low">low</option>
            <option value="medium">medium (推荐)</option>
            <option value="high">high (谨慎: 单图可能 &gt; 2MB)</option>
          </select>
        </div>
      </div>
    </section>

    <!-- 故事模式参数 -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-100">故事模式</h2>
      <p class="mb-3 text-xs text-ink-300">
        AI 看你的照片自动写多格剧本 (你可以编辑后再画)。
      </p>
      <div class="space-y-3 rounded-xl border border-white/10 bg-ink-800/60 p-4 backdrop-blur">
        <label class="flex items-center justify-between">
          <span class="text-xs text-ink-100">默认开启</span>
          <input type="checkbox" v-model="storyOptions.enabled"
            class="h-5 w-5 rounded accent-accent-500" />
        </label>
        <div>
          <label class="text-xs text-ink-300">分镜格数</label>
          <input v-model.number="storyOptions.panelCount" type="number" min="2" max="9"
            class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 text-sm text-ink-50 focus:border-accent-500/60 focus:outline-none" />
          <p class="mt-1 text-[10px] text-ink-300">2~9 格, 越多越费 token</p>
        </div>
        <div>
          <label class="text-xs text-ink-300">编剧模型 (vision-capable)</label>
          <input v-model="storyOptions.scriptModel" type="text"
            class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 font-mono text-xs text-ink-50 focus:border-accent-500/60 focus:outline-none" />
          <p class="mt-1 text-[10px] text-ink-300">
            OpenAI 推荐 gpt-4o-mini · SF 推荐 Qwen/Qwen2.5-VL-72B-Instruct
          </p>
        </div>
        <div>
          <label class="text-xs text-ink-300">气泡文字模式</label>
          <select v-model="storyOptions.bubbleTextMode"
            class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 text-sm text-ink-50 focus:border-accent-500/60 focus:outline-none">
            <option v-for="m in BUBBLE_TEXT_MODES" :key="m.id" :value="m.id">
              {{ m.label }} — {{ m.hint }}
            </option>
          </select>
        </div>
      </div>
    </section>

    <!-- 数据 -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-100">本地数据</h2>
      <div class="grid grid-cols-4 gap-2">
        <div v-for="(s, i) in [
          { v: stats.projects, l: '工程' },
          { v: stats.mangas, l: '作品' },
          { v: stats.characters, l: '角色' },
          { v: stats.imagesMB, l: 'MB 图' },
        ]" :key="i"
          class="rounded-xl border border-white/10 bg-ink-800/60 p-3 text-center backdrop-blur">
          <div class="text-lg font-semibold text-ink-50">{{ s.v }}</div>
          <div class="mt-0.5 text-xs text-ink-300">{{ s.l }}</div>
        </div>
      </div>
    </section>

    <!-- 高级 -->
    <section class="mb-6">
      <button type="button" @click="showAdvanced = !showAdvanced"
        class="flex w-full items-center justify-between text-sm font-medium text-ink-100">
        <span>高级</span>
        <span class="text-xs text-ink-300">{{ showAdvanced ? '收起' : '展开' }}</span>
      </button>
      <div v-if="showAdvanced" class="mt-3 space-y-3 rounded-xl border border-white/10 bg-ink-800/60 p-4 backdrop-blur">
        <p class="text-xs text-ink-300">
          一般用户不用动这里。Worker URL 留空走默认 ({{ getWorkerUrl() }})。Provider base URL 用于绑定 OpenAI 兼容反代。
        </p>
        <div>
          <label class="text-xs text-ink-300">Worker URL 覆盖</label>
          <input v-model="workerUrlInput" type="text" placeholder="留空 = 默认 prod"
            class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 font-mono text-xs text-ink-50 focus:border-accent-500/60 focus:outline-none" />
        </div>
        <div>
          <label class="text-xs text-ink-300">Provider Base URL 覆盖</label>
          <input v-model="providerBaseUrlInput" type="text" placeholder="留空 = provider 官方"
            class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 font-mono text-xs text-ink-50 focus:border-accent-500/60 focus:outline-none" />
        </div>
        <button @click="applyAdvanced"
          class="w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-xs font-medium text-ink-100 hover:border-accent-500/40">
          应用高级配置
        </button>
      </div>
    </section>

    <!-- Dev -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-100">开发工具</h2>
      <div class="space-y-2">
        <button type="button" @click="handleSeed" :disabled="isSeeding"
          class="w-full rounded-xl border border-white/10 bg-ink-800/60 px-4 py-2.5 text-sm font-medium text-ink-50 backdrop-blur transition hover:border-accent-500/40 disabled:opacity-50">
          {{ isSeeding ? '写入中…' : '塞 5 条假数据 (无图)' }}
        </button>
        <button type="button" @click="handleClear"
          class="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-300 transition hover:border-red-500/50 hover:bg-red-500/15">
          清空所有本地数据 (含图片)
        </button>
      </div>
      <p v-if="seedMessage" class="mt-3 text-xs text-ink-100">{{ seedMessage }}</p>
    </section>

    <!-- 关于 -->
    <section>
      <h2 class="mb-2 text-sm font-medium text-ink-100">关于</h2>
      <p class="text-xs text-ink-300">漫画人生 LifeManga · Web 版 v0.2.0 · MIT</p>
      <p class="mt-1 text-xs text-ink-500">
        iOS 版同源 ·
        <a href="https://github.com/Allenlebron/LifeManga" target="_blank" rel="noreferrer" class="text-accent-300 hover:underline">
          GitHub
        </a>
      </p>
    </section>
  </main>
</template>
