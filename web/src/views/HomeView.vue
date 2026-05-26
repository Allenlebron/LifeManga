<script setup lang="ts">
import imageCompression from 'browser-image-compression'
import { computed, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { effectivePrompt, getMangaStyle, MANGA_STYLES, type MangaStyleId } from '../models/MangaStyle'
import { loadApiKey, loadCurrentProvider, loadStyleOptions } from '../models/JobOptions'
import {
  ApiError,
  fetchJobOutput,
  pollJobUntilDone,
  submitJob,
  type WorkerJobStatus,
} from '../services/api'
import { ensureDefaultProject, saveMangaWithImages } from '../services/db'
import type { MangaItem } from '../models/MangaItem'
import StyleSwatch from '../components/StyleSwatch.vue'

const router = useRouter()

interface Preview {
  file: File
  url: string
}

const previews = ref<Preview[]>([])
const selectedStyle = ref<MangaStyleId>('shonenJump')
const isColor = ref(true)
const userPrompt = ref('')

const phase = ref<'idle' | 'compressing' | 'submitting' | 'pending' | 'running' | 'done' | 'failed'>(
  'idle',
)
const elapsedSec = ref(0)
const errorMessage = ref('')
const resultUrls = ref<string[]>([])

const fileInput = ref<HTMLInputElement | null>(null)

const canSubmit = computed(
  () =>
    previews.value.length > 0 &&
    (phase.value === 'idle' || phase.value === 'done' || phase.value === 'failed'),
)

const isWorking = computed(() =>
  ['compressing', 'submitting', 'pending', 'running'].includes(phase.value),
)

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'compressing': return '压缩参考图…'
    case 'submitting': return '上传到 Worker…'
    case 'pending': return '已排队，准备调 AI…'
    case 'running': return `生成中 ${elapsedSec.value}s`
    case 'done': return '完成 ✨'
    case 'failed': return '失败'
  }
  return ''
})

function pickFiles() {
  fileInput.value?.click()
}

function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  for (const f of files) {
    if (previews.value.length >= 5) break
    previews.value.push({ file: f, url: URL.createObjectURL(f) })
  }
  input.value = ''
}

function removePreview(i: number) {
  URL.revokeObjectURL(previews.value[i].url)
  previews.value.splice(i, 1)
}

function pickStyle(id: MangaStyleId) { selectedStyle.value = id }

async function handleGenerate() {
  errorMessage.value = ''
  resultUrls.value.forEach((u) => URL.revokeObjectURL(u))
  resultUrls.value = []

  const provider = loadCurrentProvider()
  const apiKey = loadApiKey(provider)
  if (!apiKey) {
    errorMessage.value = `请先去「设置」填写 ${provider} 的 API Key。`
    phase.value = 'failed'
    return
  }
  if (previews.value.length === 0) return

  const style = getMangaStyle(selectedStyle.value)
  if (!style) return
  const stylePrompt = effectivePrompt(style, isColor.value)
  const fullPrompt = userPrompt.value.trim()
    ? `${stylePrompt}\n\nUSER ADDITIONAL CONTEXT:\n${userPrompt.value.trim()}`
    : stylePrompt

  phase.value = 'compressing'
  let compressedFiles: File[]
  try {
    compressedFiles = await Promise.all(
      previews.value.map((p) =>
        imageCompression(p.file, { maxSizeMB: 0.5, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg' }),
      ),
    )
  } catch (e) {
    errorMessage.value = `压缩失败: ${(e as Error).message}`
    phase.value = 'failed'
    return
  }

  phase.value = 'submitting'
  const styleOpts = loadStyleOptions(provider)
  const providerBaseUrl = localStorage.getItem('lifemanga.provider_base_url')?.trim() || undefined

  let job: WorkerJobStatus
  try {
    job = await submitJob({
      apiKey, provider, providerBaseUrl,
      prompt: fullPrompt, model: styleOpts.model, size: styleOpts.size,
      quality: styleOpts.quality, n: styleOpts.n, images: compressedFiles,
    })
  } catch (e) {
    errorMessage.value = e instanceof ApiError ? `提交失败 (${e.status}): ${e.message}` : `提交失败: ${(e as Error).message}`
    phase.value = 'failed'
    return
  }

  phase.value = 'pending'

  let final: WorkerJobStatus
  try {
    final = await pollJobUntilDone(job.id, {
      intervalMs: 4000, maxWaitSec: 360,
      onTick: (s) => {
        if (s.status === 'running') {
          phase.value = 'running'
          elapsedSec.value = s.elapsedSeconds ?? 0
        } else if (s.status === 'pending') {
          phase.value = 'pending'
        }
      },
    })
  } catch (e) {
    errorMessage.value = `轮询失败: ${(e as Error).message}`
    phase.value = 'failed'
    return
  }

  if (final.status === 'failed') {
    errorMessage.value = final.error ?? '未知错误'
    phase.value = 'failed'
    return
  }
  if (final.status !== 'done') {
    errorMessage.value = `任务状态异常: ${final.status}`
    phase.value = 'failed'
    return
  }

  const blobs: Blob[] = []
  try {
    const count = final.outputCount ?? 1
    for (let i = 0; i < count; i++) blobs.push(await fetchJobOutput(job.id, i))
  } catch (e) {
    errorMessage.value = `下载结果失败: ${(e as Error).message}`
    phase.value = 'failed'
    return
  }

  const projectId = await ensureDefaultProject()
  const baseManga: Omit<MangaItem, 'outputImageNames'> = {
    id: crypto.randomUUID(), projectId, createdAt: Date.now(),
    style: selectedStyle.value, inputImageNames: [],
    userPrompt: userPrompt.value.trim() || undefined, isFavorite: false,
  }
  await saveMangaWithImages(baseManga, blobs)

  resultUrls.value = blobs.map((b) => URL.createObjectURL(b))
  phase.value = 'done'
}

onUnmounted(() => {
  previews.value.forEach((p) => URL.revokeObjectURL(p.url))
  resultUrls.value.forEach((u) => URL.revokeObjectURL(u))
})

function goHistory() { router.push('/history') }
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <!-- Hero -->
    <header class="mb-5">
      <h1 class="text-2xl font-semibold tracking-tight text-ink-50">创作</h1>
      <p class="mt-0.5 text-xs text-ink-300">选风格 + 上传参考图，几分钟后拿到一张漫画</p>
    </header>

    <!-- 上传区 -->
    <section class="mb-5">
      <div v-if="previews.length === 0">
        <button
          type="button" @click="pickFiles"
          class="flex w-full flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-ink-800/60 px-6 py-9 text-ink-300 backdrop-blur-md transition hover:border-accent-500/40 hover:bg-ink-800/80"
        >
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-accent-500/15 text-accent-300">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 16.5V19a2 2 0 002 2h14a2 2 0 002-2v-2.5M16 8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div class="text-center">
            <div class="text-sm font-medium text-ink-100">点击拍照 / 选图</div>
            <div class="mt-0.5 text-[11px] text-ink-300">最多 5 张，自动压缩到 500KB</div>
          </div>
        </button>
      </div>
      <div v-else class="grid grid-cols-3 gap-2">
        <div v-for="(p, i) in previews" :key="i" class="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-ink-800">
          <img :src="p.url" class="h-full w-full object-cover" />
          <button type="button" @click="removePreview(i)"
            class="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1.5 text-white backdrop-blur transition hover:bg-black/80">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <button v-if="previews.length < 5" type="button" @click="pickFiles"
          class="flex aspect-square items-center justify-center rounded-xl border border-dashed border-white/15 bg-ink-800/40 text-ink-300 transition hover:border-accent-500/40 hover:bg-ink-800/80 hover:text-accent-300">
          <span class="text-3xl font-light">+</span>
        </button>
      </div>
      <input ref="fileInput" type="file" accept="image/*" multiple @change="onFilesPicked" class="hidden" />
    </section>

    <!-- 颜色 -->
    <section class="mb-5 flex items-center justify-between">
      <span class="text-sm font-medium text-ink-100">颜色</span>
      <div class="inline-flex rounded-full border border-white/10 bg-ink-800/60 p-0.5 backdrop-blur">
        <button type="button" @click="isColor = true"
          :class="['rounded-full px-3 py-1 text-xs font-medium transition', isColor ? 'bg-accent-500 text-white' : 'text-ink-300 hover:text-ink-100']">彩色</button>
        <button type="button" @click="isColor = false"
          :class="['rounded-full px-3 py-1 text-xs font-medium transition', !isColor ? 'bg-ink-50 text-ink-900' : 'text-ink-300 hover:text-ink-100']">黑白</button>
      </div>
    </section>

    <!-- 风格 8 卡 -->
    <section class="mb-5">
      <h2 class="mb-3 text-sm font-medium text-ink-100">漫画风格</h2>
      <div class="grid grid-cols-2 gap-2.5">
        <button
          v-for="s in MANGA_STYLES" :key="s.id" type="button" @click="pickStyle(s.id)"
          class="overflow-hidden rounded-xl border bg-ink-800/60 p-0 text-left backdrop-blur transition"
          :class="[
            selectedStyle === s.id
              ? 'border-accent-500 ring-2 ring-accent-500/30'
              : 'border-white/10 hover:border-white/20'
          ]"
        >
          <!-- 视觉预览 SVG: 紧凑 56px 高 -->
          <div class="h-14 w-full">
            <StyleSwatch :style="s.id" />
          </div>
          <div class="px-2.5 py-2">
            <div class="text-xs font-medium text-ink-50">{{ s.displayName }}</div>
            <div class="mt-0.5 line-clamp-1 text-[11px] text-ink-300">{{ s.subtitle }}</div>
          </div>
        </button>
      </div>
    </section>

    <!-- 自定义 prompt -->
    <section class="mb-5">
      <h2 class="mb-2 text-sm font-medium text-ink-100">补充描述（可选）</h2>
      <textarea v-model="userPrompt" rows="2"
        placeholder="例：主角戴墨镜 / 下雨场景 / 4 格漫画"
        class="w-full rounded-xl border border-white/10 bg-ink-800/60 p-3 text-sm text-ink-50 placeholder:text-ink-500 backdrop-blur focus:border-accent-500/60 focus:outline-none focus:ring-2 focus:ring-accent-500/20" />
    </section>

    <!-- 生成按钮 -->
    <section class="mb-6">
      <button
        type="button" @click="handleGenerate" :disabled="!canSubmit"
        class="relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl px-6 py-3.5 text-sm font-semibold transition"
        :class="[
          canSubmit
            ? 'bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-lg shadow-accent-500/30 hover:from-accent-300 hover:to-accent-500'
            : 'bg-ink-700 text-ink-300'
        ]"
      >
        <!-- spinner -->
        <span v-if="isWorking" class="relative flex h-4 w-4">
          <span class="absolute inset-0 rounded-full border-2 border-white border-t-transparent animate-spin" />
        </span>
        {{ isWorking ? phaseLabel : '生成漫画' }}
      </button>
      <p v-if="phase === 'failed'" class="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
        {{ errorMessage }}
      </p>
    </section>

    <!-- 结果 -->
    <section v-if="phase === 'done' && resultUrls.length > 0" class="mb-6">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium text-ink-100">生成结果 ✨</h2>
        <button type="button" @click="goHistory" class="text-xs text-accent-300 hover:underline">
          去历史看 →
        </button>
      </div>
      <div class="space-y-3">
        <div v-for="(url, i) in resultUrls" :key="i"
          class="overflow-hidden rounded-2xl border border-white/10 bg-ink-800 p-1">
          <img :src="url" class="w-full rounded-xl" />
        </div>
      </div>
    </section>
  </main>
</template>
