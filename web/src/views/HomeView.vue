<script setup lang="ts">
import imageCompression from 'browser-image-compression'
import { computed, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { effectivePrompt, getMangaStyle, MANGA_STYLES, type MangaStyleId } from '../models/MangaStyle'
import {
  loadApiKey,
  loadCurrentProvider,
  loadStyleOptions,
} from '../models/JobOptions'
import {
  ApiError,
  fetchJobOutput,
  pollJobUntilDone,
  submitJob,
  type WorkerJobStatus,
} from '../services/api'
import { ensureDefaultProject, saveMangaWithImages } from '../services/db'
import type { MangaItem } from '../models/MangaItem'

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

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'idle':
      return ''
    case 'compressing':
      return '压缩参考图…'
    case 'submitting':
      return '上传到 Worker…'
    case 'pending':
      return '已排队，准备调 AI…'
    case 'running':
      return `生成中 ${elapsedSec.value}s (一般 30~120 秒)`
    case 'done':
      return '完成 ✓'
    case 'failed':
      return '失败'
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
  // 清空 input value，让用户能反复选同一张照片
  input.value = ''
}

function removePreview(i: number) {
  URL.revokeObjectURL(previews.value[i].url)
  previews.value.splice(i, 1)
}

function pickStyle(id: MangaStyleId) {
  selectedStyle.value = id
}

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

  // 1. 压缩参考图
  phase.value = 'compressing'
  let compressedFiles: File[]
  try {
    compressedFiles = await Promise.all(
      previews.value.map((p) =>
        imageCompression(p.file, {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 1024,
          useWebWorker: true,
          fileType: 'image/jpeg',
        }),
      ),
    )
  } catch (e) {
    errorMessage.value = `压缩失败: ${(e as Error).message}`
    phase.value = 'failed'
    return
  }

  // 2. 提交 Worker
  phase.value = 'submitting'
  const styleOpts = loadStyleOptions(provider)
  const providerBaseUrl =
    localStorage.getItem('lifemanga.provider_base_url')?.trim() || undefined

  let job: WorkerJobStatus
  try {
    job = await submitJob({
      apiKey,
      provider,
      providerBaseUrl,
      prompt: fullPrompt,
      model: styleOpts.model,
      size: styleOpts.size,
      quality: styleOpts.quality,
      n: styleOpts.n,
      images: compressedFiles,
    })
  } catch (e) {
    if (e instanceof ApiError) {
      errorMessage.value = `提交失败 (${e.status}): ${e.message}`
    } else {
      errorMessage.value = `提交失败: ${(e as Error).message}`
    }
    phase.value = 'failed'
    return
  }

  phase.value = 'pending'

  // 3. 轮询直到 done/failed
  let final: WorkerJobStatus
  try {
    final = await pollJobUntilDone(job.id, {
      intervalMs: 4000,
      maxWaitSec: 360,
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
    errorMessage.value = `任务结束但状态异常: ${final.status}`
    phase.value = 'failed'
    return
  }

  // 4. 下载所有输出图
  const blobs: Blob[] = []
  try {
    const count = final.outputCount ?? 1
    for (let i = 0; i < count; i++) {
      const blob = await fetchJobOutput(job.id, i)
      blobs.push(blob)
    }
  } catch (e) {
    errorMessage.value = `下载结果失败: ${(e as Error).message}`
    phase.value = 'failed'
    return
  }

  // 5. 写入 IndexedDB + 显示
  const projectId = await ensureDefaultProject()
  const baseManga: Omit<MangaItem, 'outputImageNames'> = {
    id: crypto.randomUUID(),
    projectId,
    createdAt: Date.now(),
    style: selectedStyle.value,
    inputImageNames: [],
    userPrompt: userPrompt.value.trim() || undefined,
    isFavorite: false,
  }
  await saveMangaWithImages(baseManga, blobs)

  resultUrls.value = blobs.map((b) => URL.createObjectURL(b))
  phase.value = 'done'
}

onUnmounted(() => {
  previews.value.forEach((p) => URL.revokeObjectURL(p.url))
  resultUrls.value.forEach((u) => URL.revokeObjectURL(u))
})

function goHistory() {
  router.push('/history')
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">创作</h1>
      <p class="mt-1 text-sm text-ink-500">选风格 + 上传参考图，几分钟后拿到一张漫画。</p>
    </header>

    <!-- 文件选择 + 预览 -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-700">参考图（最多 5 张）</h2>
      <div v-if="previews.length === 0" class="mb-3">
        <button
          type="button"
          @click="pickFiles"
          class="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-100 px-6 py-10 text-ink-300 transition hover:border-accent-500/40 hover:text-ink-500"
        >
          <svg class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 16.5V19a2 2 0 002 2h14a2 2 0 002-2v-2.5M16 8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span class="text-sm">点击拍照 / 选图</span>
        </button>
      </div>
      <div v-else class="mb-3 grid grid-cols-3 gap-2">
        <div v-for="(p, i) in previews" :key="i" class="relative aspect-square overflow-hidden rounded-lg border border-ink-100">
          <img :src="p.url" class="h-full w-full object-cover" />
          <button
            type="button"
            @click="removePreview(i)"
            class="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-white"
          >
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <button
          v-if="previews.length < 5"
          type="button"
          @click="pickFiles"
          class="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-ink-100 text-ink-300 hover:border-accent-500/40 hover:text-ink-500"
        >
          <span class="text-2xl">+</span>
        </button>
      </div>
      <input ref="fileInput" type="file" accept="image/*" multiple @change="onFilesPicked" class="hidden" />
    </section>

    <!-- 颜色 -->
    <section class="mb-6 flex items-center justify-between">
      <span class="text-sm font-medium text-ink-700">颜色</span>
      <div class="inline-flex rounded-lg border border-ink-100 p-0.5">
        <button type="button" @click="isColor = true" :class="['px-3 py-1 text-xs font-medium transition rounded-md', isColor ? 'bg-accent-500 text-white' : 'text-ink-500 hover:text-ink-900']">彩色</button>
        <button type="button" @click="isColor = false" :class="['px-3 py-1 text-xs font-medium transition rounded-md', !isColor ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900']">黑白</button>
      </div>
    </section>

    <!-- 风格 -->
    <section class="mb-6">
      <h2 class="mb-3 text-sm font-medium text-ink-700">漫画风格</h2>
      <div class="grid grid-cols-2 gap-3">
        <button v-for="s in MANGA_STYLES" :key="s.id" type="button" @click="pickStyle(s.id)" :class="['rounded-xl border p-3 text-left transition', selectedStyle === s.id ? 'border-accent-500 ring-2 ring-accent-500/30' : 'border-ink-100 hover:border-ink-300']">
          <div :class="['h-16 w-full rounded-md mb-2 ring-1 ring-inset ring-ink-100/60', s.swatchClass]" />
          <div class="text-sm font-medium text-ink-900">{{ s.displayName }}</div>
          <div class="mt-0.5 line-clamp-2 text-xs text-ink-500">{{ s.subtitle }}</div>
        </button>
      </div>
    </section>

    <!-- 自定义 prompt -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-700">补充描述（可选）</h2>
      <textarea
        v-model="userPrompt"
        rows="2"
        placeholder="例：主角戴墨镜 / 下雨场景 / 4 格漫画"
        class="w-full rounded-lg border border-ink-100 bg-white p-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
      />
    </section>

    <!-- 生成按钮 -->
    <section class="mb-6">
      <button
        type="button"
        @click="handleGenerate"
        :disabled="!canSubmit"
        :class="['w-full rounded-xl px-6 py-3 text-sm font-medium transition', canSubmit ? 'bg-accent-500 text-white hover:bg-accent-500/90' : 'bg-ink-300 text-white opacity-60']"
      >
        {{ phase === 'idle' || phase === 'done' || phase === 'failed' ? '生成漫画' : phaseLabel }}
      </button>
      <p v-if="phaseLabel && (phase === 'submitting' || phase === 'pending' || phase === 'running' || phase === 'compressing')" class="mt-2 text-center text-xs text-ink-500">{{ phaseLabel }}</p>
      <p v-if="phase === 'failed'" class="mt-2 text-center text-xs text-red-600">{{ errorMessage }}</p>
    </section>

    <!-- 结果 -->
    <section v-if="phase === 'done' && resultUrls.length > 0" class="mb-6">
      <h2 class="mb-2 text-sm font-medium text-ink-900">生成结果 ✨</h2>
      <div class="space-y-3">
        <img v-for="(url, i) in resultUrls" :key="i" :src="url" class="w-full rounded-xl border border-ink-100" />
      </div>
      <button
        type="button"
        @click="goHistory"
        class="mt-3 w-full rounded-lg border border-ink-100 px-4 py-2 text-sm font-medium text-ink-900 hover:border-accent-500/40"
      >
        在历史里查看 →
      </button>
    </section>
  </main>
</template>
