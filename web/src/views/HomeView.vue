<script setup lang="ts">
import imageCompression from 'browser-image-compression'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  buildRenderPrompt,
  buildStoryPrompts,
  effectivePrompt,
  getMangaStyle,
  MANGA_STYLES,
  type MangaStyleId,
} from '../models/MangaStyle'
import {
  loadApiKey,
  loadCurrentProvider,
  loadStoryOptions,
  loadStyleOptions,
} from '../models/JobOptions'
import {
  ApiError,
  fetchJobOutput,
  pollJobUntilDone,
  submitJob,
  submitStoryScript,
  type ErrorCategory,
  type WorkerJobStatus,
} from '../services/api'
import {
  ensureDefaultProject,
  listCharacters,
  loadImageBlob,
  saveMangaWithImages,
} from '../services/db'
import { friendlyError } from '../utils/errorMessages'
import type { Character, MangaItem, MangaStoryScript } from '../models/MangaItem'
import StyleSwatch from '../components/StyleSwatch.vue'

const ACTIVE_JOB_KEY = 'lifemanga.active_job'

interface ActiveJobMarker {
  jobId: string
  styleId: MangaStyleId
  userPrompt?: string
  createdAt: number
}

function saveActiveJob(marker: ActiveJobMarker) {
  localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(marker))
}
function loadActiveJob(): ActiveJobMarker | null {
  const raw = localStorage.getItem(ACTIVE_JOB_KEY)
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as ActiveJobMarker
    if (Date.now() - obj.createdAt > 60 * 60 * 1000) {
      localStorage.removeItem(ACTIVE_JOB_KEY)
      return null
    }
    return obj
  } catch {
    return null
  }
}
function clearActiveJob() {
  localStorage.removeItem(ACTIVE_JOB_KEY)
}

const router = useRouter()

interface Preview {
  file: File
  url: string
  /** 如果来自角色库, 标记来源, UI 显示 chip + 防止误删 */
  charSource?: { charId: string; charName: string }
}

interface CharPickerItem {
  char: Character
  thumbUrl: string | null
}

const previews = ref<Preview[]>([])
const selectedStyle = ref<MangaStyleId>('shonenJump')
const isColor = ref(true)
const userPrompt = ref('')

// 故事模式
const storyMode = ref(false)
const script = ref<MangaStoryScript | null>(null)

// 角色 picker
const charPickerOpen = ref(false)
const charPickerItems = ref<CharPickerItem[]>([])
const charPickerLoading = ref(false)

// 状态机
const phase = ref<
  | 'idle'
  | 'compressing'
  | 'drafting'    // 故事模式: 调 /story 编剧
  | 'scriptReady' // 故事模式: script 拿到, 等用户编辑后点"用此剧本生成漫画"
  | 'submitting'
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
>('idle')
const elapsedSec = ref(0)
const errorCategory = ref<ErrorCategory | undefined>(undefined)
const errorMessage = ref('')
const resultUrls = ref<string[]>([])

// 压缩好的 file 列表 (drafting → 生成漫画 之间复用)
let compressedCache: File[] = []

const fileInput = ref<HTMLInputElement | null>(null)

const isWorking = computed(() =>
  ['compressing', 'drafting', 'submitting', 'pending', 'running'].includes(phase.value),
)

const canDraft = computed(
  () => previews.value.length > 0 && (phase.value === 'idle' || phase.value === 'failed'),
)

const canSubmit = computed(() => {
  // 普通模式: 选了图就能直接生成
  if (!storyMode.value) {
    return previews.value.length > 0 &&
      (phase.value === 'idle' || phase.value === 'done' || phase.value === 'failed')
  }
  // 故事模式: 必须先有 script
  return !!script.value && phase.value === 'scriptReady'
})

const friendly = computed(() =>
  phase.value === 'failed' ? friendlyError(errorCategory.value, errorMessage.value) : null,
)

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'compressing': return '压缩参考图…'
    case 'drafting':    return '编剧中… (5~30 秒)'
    case 'submitting':  return '上传到 Worker…'
    case 'pending':     return '已排队，准备调 AI…'
    case 'running':     return `生成中 ${elapsedSec.value}s`
    case 'done':        return '完成 ✨'
    case 'failed':      return '失败'
  }
  return ''
})

function pickFiles() { fileInput.value?.click() }

function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  for (const f of files) {
    if (previews.value.length >= 5) break
    previews.value.push({ file: f, url: URL.createObjectURL(f) })
  }
  input.value = ''
  // 改图后清掉之前的剧本
  if (storyMode.value) script.value = null
  compressedCache = []
}

function removePreview(i: number) {
  URL.revokeObjectURL(previews.value[i].url)
  previews.value.splice(i, 1)
  script.value = null
  compressedCache = []
}

function pickStyle(id: MangaStyleId) {
  selectedStyle.value = id
  // 风格变了, 之前的剧本 tone 不一致, 清掉
  if (storyMode.value) script.value = null
}

function toggleStoryMode() {
  storyMode.value = !storyMode.value
  script.value = null
  // 清空 phase 到 idle, 让按钮重新可点
  if (phase.value === 'scriptReady' || phase.value === 'done' || phase.value === 'failed') {
    phase.value = 'idle'
    errorCategory.value = undefined
    errorMessage.value = ''
  }
}

// MARK: - 角色 picker

async function openCharPicker() {
  charPickerOpen.value = true
  charPickerLoading.value = true
  document.body.style.overflow = 'hidden'
  try {
    const chars = await listCharacters()
    const items: CharPickerItem[] = []
    for (const c of chars) {
      let thumbUrl: string | null = null
      if (c.views.length > 0) {
        const blob = await loadImageBlob(c.views[0].imageName)
        if (blob) thumbUrl = URL.createObjectURL(blob)
      }
      items.push({ char: c, thumbUrl })
    }
    charPickerItems.value = items
  } finally {
    charPickerLoading.value = false
  }
}

function closeCharPicker() {
  for (const it of charPickerItems.value) {
    if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl)
  }
  charPickerItems.value = []
  charPickerOpen.value = false
  document.body.style.overflow = ''
}

async function loadCharacter(item: CharPickerItem) {
  const view = item.char.views[0]
  if (!view) return
  if (previews.value.length >= 5) {
    closeCharPicker()
    return
  }
  // 防重复加载同一角色
  if (previews.value.some((p) => p.charSource?.charId === item.char.id)) {
    closeCharPicker()
    return
  }
  const blob = await loadImageBlob(view.imageName)
  if (!blob) return
  // 转成 File 让它走跟手动上传完全一样的 pipeline
  const fileName = `char-${item.char.name}.png`
  const file = new File([blob], fileName, { type: blob.type || 'image/png' })
  const url = URL.createObjectURL(blob)
  previews.value.push({
    file,
    url,
    charSource: { charId: item.char.id, charName: item.char.name },
  })
  // 加图后清掉之前的剧本 (保持跟正常上传行为一致)
  if (storyMode.value) script.value = null
  compressedCache = []
  closeCharPicker()
}

async function compressIfNeeded(): Promise<File[] | null> {
  if (compressedCache.length === previews.value.length && compressedCache.length > 0) {
    return compressedCache
  }
  phase.value = 'compressing'
  try {
    const out = await Promise.all(
      previews.value.map((p) =>
        imageCompression(p.file, {
          maxSizeMB: 0.5, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg',
        }),
      ),
    )
    compressedCache = out
    return out
  } catch (e) {
    errorMessage.value = `压缩失败: ${(e as Error).message}`
    errorCategory.value = 'unknown'
    phase.value = 'failed'
    return null
  }
}

// 故事模式 step 1: 拿剧本
async function handleDraftScript() {
  errorMessage.value = ''
  errorCategory.value = undefined
  resultUrls.value.forEach((u) => URL.revokeObjectURL(u))
  resultUrls.value = []
  script.value = null

  const provider = loadCurrentProvider()
  const apiKey = loadApiKey(provider)
  if (!apiKey) {
    errorMessage.value = `请先去「设置」填写 ${provider} 的 API Key`
    errorCategory.value = 'auth'
    phase.value = 'failed'
    return
  }
  if (previews.value.length === 0) return

  const files = await compressIfNeeded()
  if (!files) return

  const style = getMangaStyle(selectedStyle.value)
  if (!style) return

  const storyOpts = loadStoryOptions(provider)
  const { system, user } = buildStoryPrompts(style, storyOpts.panelCount, userPrompt.value)
  const providerBaseUrl = localStorage.getItem('lifemanga.provider_base_url')?.trim() || undefined

  phase.value = 'drafting'
  try {
    const resp = await submitStoryScript({
      apiKey,
      provider,
      providerBaseUrl,
      scriptModel: storyOpts.scriptModel,
      systemPrompt: system,
      userText: user,
      images: files,
    })
    if (!resp.script) {
      errorMessage.value = resp.error ?? '剧本返回为空'
      errorCategory.value = resp.errorCategory ?? 'unknown'
      phase.value = 'failed'
      return
    }
    // 默认每个 panel 的 nullable 字段全填 string (UI 编辑用)
    const fixed: MangaStoryScript = {
      title: resp.script.title ?? '',
      synopsis: resp.script.synopsis ?? '',
      panels: resp.script.panels.map((p) => ({
        description: p.description ?? '',
        dialogue: p.dialogue ?? undefined,
        dialogueJa: p.dialogueJa ?? undefined,
        narration: p.narration ?? undefined,
        narrationJa: p.narrationJa ?? undefined,
        sfx: p.sfx ?? undefined,
      })),
    }
    script.value = fixed
    phase.value = 'scriptReady'
  } catch (e) {
    if (e instanceof ApiError) {
      errorMessage.value = `编剧失败 (${e.status}): ${e.message}`
      errorCategory.value = e.status === 401 ? 'auth' : e.status >= 500 ? 'server' : 'unknown'
    } else {
      errorMessage.value = `编剧失败: ${(e as Error).message}`
      errorCategory.value = 'unknown'
    }
    phase.value = 'failed'
  }
}

// 普通生成 + 故事 step 2 通用流程
async function handleGenerate() {
  errorMessage.value = ''
  errorCategory.value = undefined
  resultUrls.value.forEach((u) => URL.revokeObjectURL(u))
  resultUrls.value = []

  const provider = loadCurrentProvider()
  const apiKey = loadApiKey(provider)
  if (!apiKey) {
    errorMessage.value = `请先去「设置」填写 ${provider} 的 API Key`
    errorCategory.value = 'auth'
    phase.value = 'failed'
    return
  }
  if (previews.value.length === 0) return

  const compressedFiles = await compressIfNeeded()
  if (!compressedFiles) return

  const style = getMangaStyle(selectedStyle.value)
  if (!style) return

  // 故事模式拼 buildRenderPrompt, 普通模式拼 effectivePrompt
  let fullPrompt: string
  let storyForSave: MangaStoryScript | undefined = undefined
  if (storyMode.value && script.value) {
    const storyOpts = loadStoryOptions(provider)
    fullPrompt = buildRenderPrompt(style, script.value, storyOpts.bubbleTextMode, isColor.value)
    storyForSave = script.value
  } else {
    const stylePrompt = effectivePrompt(style, isColor.value)
    fullPrompt = userPrompt.value.trim()
      ? `${stylePrompt}\n\nUSER ADDITIONAL CONTEXT:\n${userPrompt.value.trim()}`
      : stylePrompt
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
    if (e instanceof ApiError) {
      errorMessage.value = `提交失败 (${e.status}): ${e.message}`
      errorCategory.value = e.status === 401 ? 'auth' : e.status >= 500 ? 'server' : 'unknown'
    } else {
      errorMessage.value = `提交失败: ${(e as Error).message}`
      errorCategory.value = 'unknown'
    }
    phase.value = 'failed'
    return
  }

  saveActiveJob({
    jobId: job.id,
    styleId: selectedStyle.value,
    userPrompt: userPrompt.value.trim() || undefined,
    createdAt: Date.now(),
  })

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
    errorCategory.value = 'timeout'
    phase.value = 'failed'
    return
  }

  if (final.status === 'failed') {
    errorMessage.value = final.error ?? '未知错误'
    errorCategory.value = final.errorCategory ?? 'unknown'
    phase.value = 'failed'
    clearActiveJob()
    return
  }
  if (final.status !== 'done') {
    errorMessage.value = `任务状态异常: ${final.status}`
    errorCategory.value = 'unknown'
    phase.value = 'failed'
    clearActiveJob()
    return
  }

  const blobs: Blob[] = []
  try {
    const count = final.outputCount ?? 1
    for (let i = 0; i < count; i++) blobs.push(await fetchJobOutput(job.id, i))
  } catch (e) {
    errorMessage.value = `下载结果失败: ${(e as Error).message}`
    errorCategory.value = 'unknown'
    phase.value = 'failed'
    clearActiveJob()
    return
  }

  const projectId = await ensureDefaultProject()
  const baseManga: Omit<MangaItem, 'outputImageNames'> = {
    id: crypto.randomUUID(), projectId, createdAt: Date.now(),
    style: selectedStyle.value, inputImageNames: [],
    userPrompt: userPrompt.value.trim() || undefined, isFavorite: false,
    storyScript: storyForSave,
  }
  await saveMangaWithImages(baseManga, blobs)

  resultUrls.value = blobs.map((b) => URL.createObjectURL(b))
  phase.value = 'done'
  clearActiveJob()
}

async function resumeActiveJob(marker: ActiveJobMarker) {
  selectedStyle.value = marker.styleId
  if (marker.userPrompt) userPrompt.value = marker.userPrompt
  phase.value = 'pending'

  let final: WorkerJobStatus
  try {
    final = await pollJobUntilDone(marker.jobId, {
      intervalMs: 4000, maxWaitSec: 360,
      onTick: (s) => {
        if (s.status === 'running') { phase.value = 'running'; elapsedSec.value = s.elapsedSeconds ?? 0 }
        else if (s.status === 'pending') phase.value = 'pending'
      },
    })
  } catch (e) {
    errorMessage.value = `恢复轮询失败: ${(e as Error).message}`
    errorCategory.value = 'timeout'
    phase.value = 'failed'
    clearActiveJob()
    return
  }

  if (final.status === 'failed') {
    errorMessage.value = final.error ?? '未知错误'
    errorCategory.value = final.errorCategory ?? 'unknown'
    phase.value = 'failed'
    clearActiveJob()
    return
  }
  if (final.status !== 'done') {
    errorMessage.value = `任务状态异常: ${final.status}`
    errorCategory.value = 'unknown'
    phase.value = 'failed'
    clearActiveJob()
    return
  }

  const blobs: Blob[] = []
  try {
    const count = final.outputCount ?? 1
    for (let i = 0; i < count; i++) blobs.push(await fetchJobOutput(marker.jobId, i))
  } catch (e) {
    errorMessage.value = `恢复下载失败: ${(e as Error).message}`
    errorCategory.value = 'unknown'
    phase.value = 'failed'
    clearActiveJob()
    return
  }

  const projectId = await ensureDefaultProject()
  const baseManga: Omit<MangaItem, 'outputImageNames'> = {
    id: crypto.randomUUID(), projectId, createdAt: Date.now(),
    style: marker.styleId, inputImageNames: [],
    userPrompt: marker.userPrompt, isFavorite: false,
  }
  await saveMangaWithImages(baseManga, blobs)
  resultUrls.value = blobs.map((b) => URL.createObjectURL(b))
  phase.value = 'done'
  clearActiveJob()
}

onMounted(() => {
  // 加载默认 story enabled
  const provider = loadCurrentProvider()
  storyMode.value = loadStoryOptions(provider).enabled
  // 检查是否有未完成的 job
  const marker = loadActiveJob()
  if (marker) resumeActiveJob(marker)
})

onUnmounted(() => {
  previews.value.forEach((p) => URL.revokeObjectURL(p.url))
  resultUrls.value.forEach((u) => URL.revokeObjectURL(u))
})

function goHistory() { router.push('/history') }
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <header class="mb-5">
      <h1 class="text-2xl font-semibold tracking-tight text-ink-50">创作</h1>
      <p class="mt-0.5 text-xs text-ink-300">选风格 + 上传参考图，几分钟后拿到一张漫画</p>
    </header>

    <!-- 上传区 -->
    <section class="mb-5">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium text-ink-100">参考图</h2>
        <button type="button" @click="openCharPicker"
          class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-800/60 px-3 py-1 text-[11px] text-ink-300 backdrop-blur transition hover:border-accent-500/40 hover:text-ink-100">
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M16 14a4 4 0 10-8 0M5 21v-2a4 4 0 014-4h6a4 4 0 014 4v2"/>
          </svg>
          载入角色
        </button>
      </div>
      <div v-if="previews.length === 0">
        <button type="button" @click="pickFiles"
          class="flex w-full flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-ink-800/60 px-6 py-9 text-ink-300 backdrop-blur-md transition hover:border-accent-500/40 hover:bg-ink-800/80">
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
        <div v-for="(p, i) in previews" :key="i" class="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-ink-800">
          <img :src="p.url" class="h-full w-full object-cover" />
          <button type="button" @click="removePreview(i)"
            class="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1.5 text-white backdrop-blur transition hover:bg-black/80">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <!-- 来自角色库的标记 -->
          <div v-if="p.charSource"
            class="absolute inset-x-0 bottom-0 bg-accent-500/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            👤 {{ p.charSource.charName }}
          </div>
        </div>
        <button v-if="previews.length < 5" type="button" @click="pickFiles"
          class="flex aspect-square items-center justify-center rounded-xl border border-dashed border-white/15 bg-ink-800/40 text-ink-300 transition hover:border-accent-500/40 hover:bg-ink-800/80 hover:text-accent-300">
          <span class="text-3xl font-light">+</span>
        </button>
      </div>
      <input ref="fileInput" type="file" accept="image/*" multiple @change="onFilesPicked" class="hidden" />
    </section>

    <!-- 颜色 + 故事开关 -->
    <section class="mb-5 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <span class="text-sm font-medium text-ink-100">颜色</span>
        <div class="inline-flex rounded-full border border-white/10 bg-ink-800/60 p-0.5 backdrop-blur">
          <button type="button" @click="isColor = true"
            :class="['rounded-full px-3 py-1 text-xs font-medium transition', isColor ? 'bg-accent-500 text-white' : 'text-ink-300 hover:text-ink-100']">彩色</button>
          <button type="button" @click="isColor = false"
            :class="['rounded-full px-3 py-1 text-xs font-medium transition', !isColor ? 'bg-ink-50 text-ink-900' : 'text-ink-300 hover:text-ink-100']">黑白</button>
        </div>
      </div>
      <button type="button" @click="toggleStoryMode"
        :class="['inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
          storyMode ? 'border-accent-500 bg-accent-500/15 text-accent-300' : 'border-white/10 bg-ink-800/60 text-ink-300 hover:text-ink-100']">
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 21.5v-17z"/>
        </svg>
        故事模式{{ storyMode ? ' 开' : ' 关' }}
      </button>
    </section>

    <!-- 风格 8 卡 -->
    <section class="mb-5">
      <h2 class="mb-3 text-sm font-medium text-ink-100">漫画风格</h2>
      <div class="grid grid-cols-2 gap-2.5">
        <button v-for="s in MANGA_STYLES" :key="s.id" type="button" @click="pickStyle(s.id)"
          class="overflow-hidden rounded-xl border bg-ink-800/60 p-0 text-left backdrop-blur transition"
          :class="[selectedStyle === s.id ? 'border-accent-500 ring-2 ring-accent-500/30' : 'border-white/10 hover:border-white/20']">
          <div class="h-14 w-full"><StyleSwatch :style="s.id" /></div>
          <div class="px-2.5 py-2">
            <div class="text-xs font-medium text-ink-50">{{ s.displayName }}</div>
            <div class="mt-0.5 line-clamp-1 text-[11px] text-ink-300">{{ s.subtitle }}</div>
          </div>
        </button>
      </div>
    </section>

    <!-- 自定义 prompt / 故事提示 -->
    <section class="mb-5">
      <h2 class="mb-2 text-sm font-medium text-ink-100">
        {{ storyMode ? '故事提示（可选）' : '补充描述（可选）' }}
      </h2>
      <textarea v-model="userPrompt" rows="2"
        :placeholder="storyMode
          ? '例：失意的程序员在便利店遇到童年好友'
          : '例：主角戴墨镜 / 下雨场景'"
        class="w-full rounded-xl border border-white/10 bg-ink-800/60 p-3 text-sm text-ink-50 placeholder:text-ink-500 backdrop-blur focus:border-accent-500/60 focus:outline-none focus:ring-2 focus:ring-accent-500/20" />
    </section>

    <!-- 故事模式: 编剧按钮 / 剧本编辑器 -->
    <section v-if="storyMode" class="mb-5">
      <button v-if="!script" type="button" @click="handleDraftScript" :disabled="!canDraft"
        class="relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl px-6 py-3 text-sm font-semibold transition"
        :class="[canDraft
          ? 'bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-lg shadow-accent-500/30'
          : 'bg-ink-700 text-ink-300']">
        <span v-if="phase === 'compressing' || phase === 'drafting'" class="relative flex h-4 w-4">
          <span class="absolute inset-0 rounded-full border-2 border-white border-t-transparent animate-spin" />
        </span>
        {{ phase === 'compressing' || phase === 'drafting' ? phaseLabel : '生成剧本' }}
      </button>

      <!-- 剧本编辑器 -->
      <div v-if="script" class="space-y-3 rounded-xl border border-accent-500/30 bg-ink-800/60 p-3 backdrop-blur">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1">
            <input v-model="script.title" placeholder="标题"
              class="w-full rounded-lg border border-white/10 bg-ink-900/70 px-2 py-1 text-base font-semibold text-ink-50 focus:border-accent-500/60 focus:outline-none" />
            <input v-model="script.synopsis" placeholder="简介"
              class="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/70 px-2 py-1 text-xs text-ink-300 focus:border-accent-500/60 focus:outline-none" />
          </div>
          <button type="button" @click="handleDraftScript" :disabled="phase === 'drafting'"
            class="shrink-0 rounded-lg border border-white/10 bg-ink-800 px-2 py-1 text-[11px] text-ink-300 transition hover:border-accent-500/40 hover:text-ink-100 disabled:opacity-50">
            重写
          </button>
        </div>

        <details v-for="(p, i) in script.panels" :key="i"
          class="rounded-lg border border-white/10 bg-ink-900/60" open>
          <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-ink-100">
            分镜 {{ i + 1 }} <span class="text-ink-400 font-normal">— {{ p.dialogue || p.narration || '(无台词)' }}</span>
          </summary>
          <div class="space-y-2 px-3 pb-3">
            <div>
              <label class="text-[10px] text-ink-300">画面描述 (英文)</label>
              <textarea v-model="p.description" rows="2"
                class="mt-0.5 w-full rounded border border-white/10 bg-ink-900/70 px-2 py-1 text-[11px] text-ink-100" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[10px] text-ink-300">中文台词</label>
                <input v-model="p.dialogue" placeholder="可空"
                  class="mt-0.5 w-full rounded border border-white/10 bg-ink-900/70 px-2 py-1 text-[11px] text-ink-100" />
              </div>
              <div>
                <label class="text-[10px] text-ink-300">日文气泡</label>
                <input v-model="p.dialogueJa" placeholder="可空"
                  class="mt-0.5 w-full rounded border border-white/10 bg-ink-900/70 px-2 py-1 text-[11px] text-ink-100" />
              </div>
              <div>
                <label class="text-[10px] text-ink-300">中文旁白</label>
                <input v-model="p.narration" placeholder="可空"
                  class="mt-0.5 w-full rounded border border-white/10 bg-ink-900/70 px-2 py-1 text-[11px] text-ink-100" />
              </div>
              <div>
                <label class="text-[10px] text-ink-300">日文旁白</label>
                <input v-model="p.narrationJa" placeholder="可空"
                  class="mt-0.5 w-full rounded border border-white/10 bg-ink-900/70 px-2 py-1 text-[11px] text-ink-100" />
              </div>
              <div class="col-span-2">
                <label class="text-[10px] text-ink-300">拟声词 (英文 / 假名)</label>
                <input v-model="p.sfx" placeholder="例: ドン! バン! 可空"
                  class="mt-0.5 w-full rounded border border-white/10 bg-ink-900/70 px-2 py-1 text-[11px] text-ink-100" />
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>

    <!-- 主生成按钮 (普通: "生成漫画"; 故事模式&有剧本: "用此剧本生成漫画") -->
    <section v-if="!storyMode || script" class="mb-6">
      <button type="button" @click="handleGenerate" :disabled="!canSubmit"
        class="relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl px-6 py-3.5 text-sm font-semibold transition"
        :class="[canSubmit
          ? 'bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-lg shadow-accent-500/30 hover:from-accent-300 hover:to-accent-500'
          : 'bg-ink-700 text-ink-300']">
        <span v-if="isWorking && phase !== 'drafting'" class="relative flex h-4 w-4">
          <span class="absolute inset-0 rounded-full border-2 border-white border-t-transparent animate-spin" />
        </span>
        {{
          isWorking && phase !== 'drafting' ? phaseLabel
          : storyMode ? '用此剧本生成漫画'
          : '生成漫画'
        }}
      </button>
      <p v-if="phase === 'failed' && friendly" class="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-100">
        <span class="block font-semibold text-red-200">{{ friendly.title }}</span>
        <span class="mt-1 block text-red-100/90">{{ friendly.message }}</span>
        <ul v-if="friendly.actions.length" class="mt-2 space-y-0.5 pl-3">
          <li v-for="(a, i) in friendly.actions" :key="i" class="text-[11px] text-red-100/80 list-disc">{{ a }}</li>
        </ul>
        <details v-if="errorMessage" class="mt-2 text-[10px] text-red-100/60">
          <summary class="cursor-pointer">原始错误</summary>
          <code class="mt-1 block break-all font-mono">{{ errorMessage }}</code>
        </details>
      </p>
    </section>

    <!-- 结果 -->
    <section v-if="phase === 'done' && resultUrls.length > 0" class="mb-6">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium text-ink-100">生成结果 ✨</h2>
        <button type="button" @click="goHistory" class="text-xs text-accent-300 hover:underline">去历史看 →</button>
      </div>
      <div class="space-y-3">
        <div v-for="(url, i) in resultUrls" :key="i"
          class="overflow-hidden rounded-2xl border border-white/10 bg-ink-800 p-1">
          <img :src="url" class="w-full rounded-xl" />
        </div>
      </div>
    </section>

    <!-- 角色 picker modal -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0" enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100" leave-to-class="opacity-0">
      <div v-if="charPickerOpen" class="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md"
           @click.self="closeCharPicker">
        <header class="flex items-center justify-between p-3" style="padding-top: max(0.75rem, env(safe-area-inset-top))">
          <button type="button" @click="closeCharPicker"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-ink-50 backdrop-blur transition hover:bg-white/20">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div class="text-sm font-medium text-ink-50">载入角色</div>
          <div class="w-9" />
        </header>

        <div class="flex-1 overflow-y-auto px-4 pb-4">
          <p class="mb-3 text-xs text-ink-300">
            选一个角色作为参考图。会用它的第一张设定图。
          </p>

          <div v-if="charPickerLoading" class="py-12 text-center text-sm text-ink-300">加载中…</div>

          <div v-else-if="charPickerItems.length === 0"
            class="rounded-2xl border border-dashed border-white/10 bg-ink-800/40 px-6 py-12 text-center">
            <p class="text-sm text-ink-100">还没有角色</p>
            <p class="mt-1 text-xs text-ink-300">先到「角色」tab 创建一个</p>
          </div>

          <ul v-else class="grid grid-cols-2 gap-2.5">
            <li v-for="it in charPickerItems" :key="it.char.id">
              <button type="button" @click="loadCharacter(it)"
                class="block w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-800/60 text-left backdrop-blur transition hover:border-accent-500 active:scale-[0.97]">
                <div class="aspect-square w-full overflow-hidden bg-ink-700">
                  <img v-if="it.thumbUrl" :src="it.thumbUrl" class="h-full w-full object-cover" />
                </div>
                <div class="px-3 py-2">
                  <div class="text-sm font-medium text-ink-50">{{ it.char.name }}</div>
                  <div class="mt-0.5 line-clamp-1 text-[11px] text-ink-300">
                    {{ it.char.bio || `${it.char.views.length} 张图` }}
                  </div>
                </div>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </main>
</template>
