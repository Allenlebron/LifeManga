<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  db,
  imagesTotalBytes,
  listMangaItems,
  listProjects,
  seedFakeData,
} from '../services/db'
import { getWorkerUrl, setWorkerUrl, type ProviderId } from '../services/api'
import {
  DEFAULT_OPTIONS_BY_PROVIDER,
  SIZE_OPTIONS_BY_PROVIDER,
  loadApiKey,
  loadCurrentProvider,
  loadStyleOptions,
  saveApiKey,
  saveCurrentProvider,
  saveStyleOptions,
  type JobStyleOptions,
} from '../models/JobOptions'

const PROVIDERS: { id: ProviderId; label: string; hint: string }[] = [
  { id: 'siliconflow', label: 'SiliconFlow（硅基流动）', hint: '国内可直连 · Qwen Image' },
  { id: 'openai', label: 'OpenAI', hint: 'gpt-image-2 · 需翻墙 + 验证' },
  { id: 'freemodel', label: 'FreeModel', hint: '兼容 SF JSON 协议' },
]

const provider = ref<ProviderId>('siliconflow')
const apiKey = ref('')
const isKeyVisible = ref(false)
const saved = ref(false)

const styleOptions = ref<JobStyleOptions>({ ...DEFAULT_OPTIONS_BY_PROVIDER.siliconflow })

const showAdvanced = ref(false)
const workerUrlInput = ref('')
const providerBaseUrlInput = ref('')

const stats = ref<{ projects: number; mangas: number; characters: number; imagesMB: string }>({
  projects: 0,
  mangas: 0,
  characters: 0,
  imagesMB: '0',
})
const seedMessage = ref('')
const isSeeding = ref(false)

const sizeOptions = computed(() => SIZE_OPTIONS_BY_PROVIDER[provider.value])
const showQuality = computed(() => provider.value === 'openai')

async function refreshStats() {
  const [projects, mangas, characters, bytes] = await Promise.all([
    listProjects(),
    listMangaItems(),
    db.characters.toArray(),
    imagesTotalBytes(),
  ])
  stats.value = {
    projects: projects.length,
    mangas: mangas.length,
    characters: characters.length,
    imagesMB: (bytes / 1024 / 1024).toFixed(2),
  }
}

onMounted(() => {
  provider.value = loadCurrentProvider()
  apiKey.value = loadApiKey(provider.value)
  styleOptions.value = loadStyleOptions(provider.value)
  workerUrlInput.value = localStorage.getItem('lifemanga.worker_url') ?? ''
  providerBaseUrlInput.value = localStorage.getItem('lifemanga.provider_base_url') ?? ''
  refreshStats()
})

// provider 切换: 保存当前 provider, 自动加载对应 key + 默认 styleOptions
watch(provider, (newP) => {
  saveCurrentProvider(newP)
  apiKey.value = loadApiKey(newP)
  // 如果 size 不在新 provider 的合法 size 列表里, 重置成 default
  const validSizes = SIZE_OPTIONS_BY_PROVIDER[newP]
  if (!validSizes.includes(styleOptions.value.size)) {
    styleOptions.value = { ...DEFAULT_OPTIONS_BY_PROVIDER[newP] }
  } else {
    styleOptions.value.model = DEFAULT_OPTIONS_BY_PROVIDER[newP].model
  }
})

// styleOptions 实时持久化
watch(styleOptions, (v) => saveStyleOptions(v), { deep: true })

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
    seedMessage.value = `已写入 1 个工程 + ${r.mangaCount} 条 manga。去「历史」看看。`
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
  seedMessage.value = '已清空所有数据。'
  await refreshStats()
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">设置</h1>
      <p class="mt-1 text-sm text-ink-500">BYOK + 后端 Provider + 本地数据</p>
    </header>

    <!-- Provider 选择 -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-900">后端 Provider</h2>
      <div class="space-y-2">
        <label
          v-for="p in PROVIDERS"
          :key="p.id"
          class="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-100 bg-white p-3 transition hover:border-accent-500/40"
          :class="{ 'border-accent-500 ring-1 ring-accent-500/30': provider === p.id }"
        >
          <input
            type="radio"
            :value="p.id"
            v-model="provider"
            class="mt-1 accent-accent-500"
          />
          <div>
            <div class="text-sm font-medium text-ink-900">{{ p.label }}</div>
            <div class="text-xs text-ink-500">{{ p.hint }}</div>
          </div>
        </label>
      </div>
    </section>

    <!-- BYOK -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-900">API Key</h2>
      <p class="mb-3 text-xs text-ink-500">
        粘贴你 {{ PROVIDERS.find((p) => p.id === provider)?.label }} 账户的 key。Key 只存这台设备的浏览器里 (localStorage)，源码不会上传任何 key。每个 provider 独立保存。
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

    <!-- 生成参数 -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-900">生成参数</h2>
      <div class="space-y-3 rounded-lg border border-ink-100 bg-white p-3">
        <div>
          <label class="text-xs text-ink-500">模型</label>
          <input
            v-model="styleOptions.model"
            type="text"
            class="mt-1 w-full rounded border border-ink-100 px-2 py-1.5 text-sm font-mono"
          />
        </div>
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="text-xs text-ink-500">尺寸</label>
            <select
              v-model="styleOptions.size"
              class="mt-1 w-full rounded border border-ink-100 bg-white px-2 py-1.5 text-sm"
            >
              <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="w-24">
            <label class="text-xs text-ink-500">张数</label>
            <input
              v-model.number="styleOptions.n"
              type="number"
              min="1"
              max="4"
              class="mt-1 w-full rounded border border-ink-100 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div v-if="showQuality">
          <label class="text-xs text-ink-500">质量 (仅 OpenAI)</label>
          <select
            v-model="styleOptions.quality"
            class="mt-1 w-full rounded border border-ink-100 bg-white px-2 py-1.5 text-sm"
          >
            <option value="auto">auto</option>
            <option value="low">low</option>
            <option value="medium">medium (推荐)</option>
            <option value="high">high (谨慎: 单图可能 &gt; 2MB 撑爆 DO cell)</option>
          </select>
        </div>
      </div>
    </section>

    <!-- 数据统计 -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-900">本地数据</h2>
      <div class="grid grid-cols-4 gap-2">
        <div class="rounded-lg border border-ink-100 bg-white p-3 text-center">
          <div class="text-lg font-semibold text-ink-900">{{ stats.projects }}</div>
          <div class="mt-0.5 text-xs text-ink-500">工程</div>
        </div>
        <div class="rounded-lg border border-ink-100 bg-white p-3 text-center">
          <div class="text-lg font-semibold text-ink-900">{{ stats.mangas }}</div>
          <div class="mt-0.5 text-xs text-ink-500">作品</div>
        </div>
        <div class="rounded-lg border border-ink-100 bg-white p-3 text-center">
          <div class="text-lg font-semibold text-ink-900">{{ stats.characters }}</div>
          <div class="mt-0.5 text-xs text-ink-500">角色</div>
        </div>
        <div class="rounded-lg border border-ink-100 bg-white p-3 text-center">
          <div class="text-lg font-semibold text-ink-900">{{ stats.imagesMB }}</div>
          <div class="mt-0.5 text-xs text-ink-500">MB 图</div>
        </div>
      </div>
    </section>

    <!-- 高级 -->
    <section class="mb-6">
      <button
        type="button"
        @click="showAdvanced = !showAdvanced"
        class="flex w-full items-center justify-between text-sm font-medium text-ink-900"
      >
        <span>高级</span>
        <span class="text-xs text-ink-500">{{ showAdvanced ? '收起' : '展开' }}</span>
      </button>
      <div v-if="showAdvanced" class="mt-3 space-y-3 rounded-lg border border-ink-100 bg-white p-3">
        <p class="text-xs text-ink-500">
          一般用户不用动这里。Worker URL 留空走默认部署 ({{ getWorkerUrl() }})。Provider base URL 是想绑定 OpenAI 兼容反代时填。
        </p>
        <div>
          <label class="text-xs text-ink-500">Worker URL 覆盖</label>
          <input
            v-model="workerUrlInput"
            type="text"
            placeholder="留空 = 默认 prod"
            class="mt-1 w-full rounded border border-ink-100 px-2 py-1.5 text-xs font-mono"
          />
        </div>
        <div>
          <label class="text-xs text-ink-500">Provider Base URL 覆盖</label>
          <input
            v-model="providerBaseUrlInput"
            type="text"
            placeholder="留空 = 默认 ({{ provider }} 官方)"
            class="mt-1 w-full rounded border border-ink-100 px-2 py-1.5 text-xs font-mono"
          />
        </div>
        <button
          @click="applyAdvanced"
          class="w-full rounded-lg border border-ink-100 px-3 py-1.5 text-xs font-medium hover:border-accent-500/40"
        >
          应用高级配置
        </button>
      </div>
    </section>

    <!-- Dev 工具 -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-900">开发工具</h2>
      <div class="space-y-2">
        <button
          type="button"
          @click="handleSeed"
          :disabled="isSeeding"
          class="w-full rounded-lg border border-ink-100 bg-white px-4 py-2 text-sm font-medium text-ink-900 transition hover:border-accent-500/40 disabled:opacity-50"
        >
          {{ isSeeding ? '写入中…' : '塞 5 条假数据 (无图)' }}
        </button>
        <button
          type="button"
          @click="handleClear"
          class="w-full rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:border-red-300"
        >
          清空所有本地数据 (含图片)
        </button>
      </div>
      <p v-if="seedMessage" class="mt-3 text-xs text-ink-700">{{ seedMessage }}</p>
    </section>

    <!-- 关于 -->
    <section>
      <h2 class="mb-2 text-sm font-medium text-ink-900">关于</h2>
      <p class="text-xs text-ink-500">漫画人生 LifeManga · Web 版 v0.1.0 · MIT</p>
      <p class="mt-1 text-xs text-ink-300">
        iOS 版同源 ·
        <a
          href="https://github.com/Allenlebron/LifeManga"
          target="_blank"
          rel="noreferrer"
          class="text-accent-500 hover:underline"
        >
          GitHub
        </a>
      </p>
    </section>
  </main>
</template>
