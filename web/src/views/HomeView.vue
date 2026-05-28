<script setup lang="ts">
import imageCompression from 'browser-image-compression'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  bubbleDirective,
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
}

interface CharPreview {
  file: File
  url: string
  charId: string
  charName: string
}

interface CharPickerItem {
  char: Character
  thumbUrl: string | null
}

const previews = ref<Preview[]>([])
const charPreviews = ref<CharPreview[]>([])
const selectedStyle = ref<MangaStyleId>('shonenJump')
const isColor = ref(false)
const userPrompt = ref('')

// 故事模式
const storyMode = ref(false)
const script = ref<MangaStoryScript | null>(null)

// 角色 picker
const charPickerOpen = ref(false)
const charPickerItems = ref<CharPickerItem[]>([])
const charPickerLoading = ref(false)
const pickerStage = ref<'list' | 'views'>('list')
const pickerActiveChar = ref<CharPickerItem | null>(null)
const pickerViewUrls = ref<(string | null)[]>([])

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

const hasAnyImage = computed(() => previews.value.length > 0 || charPreviews.value.length > 0)

const canDraft = computed(
  () => hasAnyImage.value && (phase.value === 'idle' || phase.value === 'failed'),
)

const canSubmit = computed(() => {
  if (!storyMode.value) {
    return hasAnyImage.value &&
      (phase.value === 'idle' || phase.value === 'done' || phase.value === 'failed')
  }
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
  pickerStage.value = 'list'
  pickerActiveChar.value = null
  pickerViewUrls.value = []
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
  // 二级 view 缩略图也释放
  for (const u of pickerViewUrls.value) {
    if (u) URL.revokeObjectURL(u)
  }
  pickerViewUrls.value = []
  pickerStage.value = 'list'
  pickerActiveChar.value = null
  charPickerOpen.value = false
  document.body.style.overflow = ''
}

/**
 * 点 char 卡的入口:
 * - char.views.length === 1 → 直接加载 view 0
 * - char.views.length > 1 → 进二级, 加载所有 view 缩略图, 让用户选
 */
async function pickCharacter(item: CharPickerItem) {
  if (charPreviews.value.length >= 3) return
  if (charPreviews.value.some((c) => c.charId === item.char.id)) return

  if (item.char.views.length <= 1) {
    await loadCharacterView(item, 0)
    return
  }

  // 二级: 加载该角色全部 view 的缩略图
  pickerActiveChar.value = item
  pickerStage.value = 'views'
  // 释放上一次的 view urls (理论上空)
  for (const u of pickerViewUrls.value) {
    if (u) URL.revokeObjectURL(u)
  }
  pickerViewUrls.value = []

  charPickerLoading.value = true
  try {
    const urls = await Promise.all(
      item.char.views.map(async (v) => {
        const blob = await loadImageBlob(v.imageName)
        return blob ? URL.createObjectURL(blob) : null
      }),
    )
    pickerViewUrls.value = urls
  } finally {
    charPickerLoading.value = false
  }
}

function backToList() {
  for (const u of pickerViewUrls.value) {
    if (u) URL.revokeObjectURL(u)
  }
  pickerViewUrls.value = []
  pickerActiveChar.value = null
  pickerStage.value = 'list'
}

/** 角色库选中后落到 charPreviews。viewIdx 是该 char.views 数组下标。 */
async function loadCharacterView(item: CharPickerItem, viewIdx: number) {
  const view = item.char.views[viewIdx]
  if (!view) return
  if (charPreviews.value.length >= 3) {
    closeCharPicker()
    return
  }
  if (charPreviews.value.some((c) => c.charId === item.char.id)) {
    closeCharPicker()
    return
  }
  const blob = await loadImageBlob(view.imageName)
  if (!blob || blob.size === 0) return
  const safeType = blob.type?.startsWith('image/') ? blob.type : 'image/png'
  const ext = safeType.split('/')[1] === 'jpeg' ? 'jpg' : safeType.split('/')[1]
  const fileName = `char-${item.char.name}-${view.label}.${ext}`
  const file = new File([blob], fileName, { type: safeType })
  const url = URL.createObjectURL(blob)
  charPreviews.value.push({ file, url, charId: item.char.id, charName: item.char.name })
  if (storyMode.value) script.value = null
  compressedCache = []
  closeCharPicker()
}

function removeCharPreview(i: number) {
  URL.revokeObjectURL(charPreviews.value[i].url)
  charPreviews.value.splice(i, 1)
  script.value = null
  compressedCache = []
}

const COMPRESSIBLE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif',
])

function validateImageFile(file: File): string | null {
  if (COMPRESSIBLE_TYPES.has(file.type)) return null
  if (!file.type.startsWith('image/')) return `「${file.name}」不是图片文件`
  // image/heic, image/heif, image/svg+xml, image/tiff 等
  const ext = file.name.split('.').pop()?.toUpperCase() ?? ''
  return `「${file.name}」格式 (${file.type || ext}) 不支持，请转为 JPG/PNG 后重试`
}

/** 角色参考指令: 告诉 AI 哪些图是角色参考, 要保持外形一致 (对齐 iOS charactersDirective) */
function buildCharacterDirective(): string | null {
  if (charPreviews.value.length === 0) return null
  const names = charPreviews.value.map((c) => c.charName)
  return [
    'CHARACTER REFERENCE:',
    `I have attached ${names.length} character reference image(s) at the end of the input set.`,
    `These represent the recurring characters that should appear in this page (${names.join('、')}).`,
    'Match their faces, hair, outfits and overall design EXACTLY as shown. Do not redesign them.',
  ].join(' ')
}

const COMPRESSED_TOTAL = computed(() => previews.value.length + charPreviews.value.length)

async function compressIfNeeded(): Promise<File[] | null> {
  const total = COMPRESSED_TOTAL.value
  if (total === 0) return null
  if (compressedCache.length === total && compressedCache.length > 0) {
    return compressedCache
  }
  // 校验所有文件格式
  for (const p of [...previews.value, ...charPreviews.value]) {
    const err = validateImageFile(p.file)
    if (err) {
      errorMessage.value = err
      errorCategory.value = 'unknown'
      phase.value = 'failed'
      return null
    }
  }
  phase.value = 'compressing'
  try {
    const compress = (f: File) =>
      imageCompression(f, {
        maxSizeMB: 0.5, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg',
      })
    const [sceneOut, charOut] = await Promise.all([
      Promise.all(previews.value.map((p) => compress(p.file))),
      Promise.all(charPreviews.value.map((c) => compress(c.file))),
    ])
    // 顺序: 素材在前, 角色在后 (对齐 iOS 端)
    compressedCache = [...sceneOut, ...charOut]
    return compressedCache
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
  if (!hasAnyImage.value) return

  const files = await compressIfNeeded()
  if (!files) return

  const style = getMangaStyle(selectedStyle.value)
  if (!style) return

  const storyOpts = loadStoryOptions(provider)

  // 从 charPreviews 解析角色 bio, 喂给 AI 让它知道主角是谁
  let storyCharacters: { name: string; bio?: string }[] | undefined
  if (charPreviews.value.length > 0) {
    const allChars = await listCharacters()
    storyCharacters = charPreviews.value
      .map((cp) => allChars.find((c) => c.id === cp.charId))
      .filter((c): c is Character => !!c)
      .map((c) => ({ name: c.name, bio: c.bio }))
  }

  const { system, user } = buildStoryPrompts(
    style,
    storyOpts.panelCount,
    userPrompt.value,
    storyCharacters,
  )
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
  if (!hasAnyImage.value) return

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
    const styleOpts2 = loadStoryOptions(provider)
    const stylePrompt = effectivePrompt(style, isColor.value)
    const parts = [stylePrompt, bubbleDirective(styleOpts2.bubbleTextMode)]
    if (userPrompt.value.trim()) {
      parts.push(`Additional user note: ${userPrompt.value.trim()}`)
    }
    fullPrompt = parts.join('\n\n')
  }

  // 角色参考指令: 告诉 AI 末尾的图是角色参考, 要保持外形一致
  const charDirective = buildCharacterDirective()
  if (charDirective) {
    fullPrompt += `\n\n${charDirective}`
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
  charPreviews.value.forEach((c) => URL.revokeObjectURL(c.url))
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
      <h2 class="mb-2 text-sm font-medium text-ink-100">素材图片</h2>
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
        </div>
        <button v-if="previews.length < 5" type="button" @click="pickFiles"
          class="flex aspect-square items-center justify-center rounded-xl border border-dashed border-white/15 bg-ink-800/40 text-ink-300 transition hover:border-accent-500/40 hover:bg-ink-800/80 hover:text-accent-300">
          <span class="text-3xl font-light">+</span>
        </button>
      </div>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/bmp,image/gif" multiple @change="onFilesPicked" class="hidden" />
    </section>

    <!-- 角色参考区 -->
    <section class="mb-5">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium text-ink-100">角色参考</h2>
        <button type="button" @click="openCharPicker" :disabled="charPreviews.length >= 3"
          class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-800/60 px-3 py-1 text-[11px] text-ink-300 backdrop-blur transition hover:border-accent-500/40 hover:text-ink-100 disabled:opacity-40">
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M16 14a4 4 0 10-8 0M5 21v-2a4 4 0 014-4h6a4 4 0 014 4v2"/>
          </svg>
          载入角色
        </button>
      </div>
      <div v-if="charPreviews.length === 0" class="rounded-xl border border-dashed border-white/10 bg-ink-800/30 px-4 py-3 text-center text-[11px] text-ink-400">
        从角色库载入角色，AI 会保持角色外形一致（最多 3 个）
      </div>
      <div v-else class="grid grid-cols-3 gap-2">
        <div v-for="(c, i) in charPreviews" :key="c.charId" class="relative aspect-square overflow-hidden rounded-xl border border-accent-500/30 bg-ink-800">
          <img :src="c.url" class="h-full w-full object-cover" />
          <button type="button" @click="removeCharPreview(i)"
            class="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1.5 text-white backdrop-blur transition hover:bg-black/80">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div class="absolute inset-x-0 bottom-0 bg-accent-500/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            {{ c.charName }}
          </div>
        </div>
      </div>
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
    <section v-if="!storyMode || script || phase === 'failed'" class="mb-6">
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
          <button v-if="pickerStage === 'list'" type="button" @click="closeCharPicker"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-ink-50 backdrop-blur transition hover:bg-white/20">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button v-else type="button" @click="backToList"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-ink-50 backdrop-blur transition hover:bg-white/20">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div class="text-sm font-medium text-ink-50">
            {{ pickerStage === 'list' ? '载入角色' : `${pickerActiveChar?.char.name} · 选视图` }}
          </div>
          <div class="w-9" />
        </header>

        <div class="flex-1 overflow-y-auto px-4 pb-4">
          <!-- 一级: 角色列表 -->
          <template v-if="pickerStage === 'list'">
            <p class="mb-3 text-xs text-ink-300">
              选一个角色作为参考图。多视图角色会让你二级选择。
            </p>

            <div v-if="charPickerLoading" class="py-12 text-center text-sm text-ink-300">加载中…</div>

            <div v-else-if="charPickerItems.length === 0"
              class="rounded-2xl border border-dashed border-white/10 bg-ink-800/40 px-6 py-12 text-center">
              <p class="text-sm text-ink-100">还没有角色</p>
              <p class="mt-1 text-xs text-ink-300">先到「角色」tab 创建一个</p>
            </div>

            <ul v-else class="grid grid-cols-2 gap-2.5">
              <li v-for="it in charPickerItems" :key="it.char.id">
                <button type="button" @click="pickCharacter(it)"
                  class="block w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-800/60 text-left backdrop-blur transition hover:border-accent-500 active:scale-[0.97]">
                  <div class="relative aspect-square w-full overflow-hidden bg-ink-700">
                    <img v-if="it.thumbUrl" :src="it.thumbUrl" class="h-full w-full object-cover" />
                    <span v-if="it.char.views.length > 1"
                      class="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
                      ×{{ it.char.views.length }}
                    </span>
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
          </template>

          <!-- 二级: view 列表 -->
          <template v-else-if="pickerActiveChar">
            <p v-if="pickerActiveChar.char.bio" class="mb-3 rounded-lg bg-ink-800/40 px-3 py-2 text-xs text-ink-200">
              {{ pickerActiveChar.char.bio }}
            </p>
            <p v-else class="mb-3 text-xs text-ink-300">点一张作为参考图。</p>

            <div v-if="charPickerLoading" class="py-12 text-center text-sm text-ink-300">加载视图…</div>
            <ul v-else class="grid grid-cols-2 gap-2.5">
              <li v-for="(v, i) in pickerActiveChar.char.views" :key="v.id">
                <button type="button" @click="loadCharacterView(pickerActiveChar, i)"
                  class="block w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-800/60 text-left backdrop-blur transition hover:border-accent-500 active:scale-[0.97]">
                  <div class="aspect-square w-full overflow-hidden bg-ink-700">
                    <img v-if="pickerViewUrls[i]" :src="pickerViewUrls[i]!" class="h-full w-full object-cover" />
                  </div>
                  <div class="px-3 py-2 text-[11px] text-ink-100 line-clamp-1">{{ v.label }}</div>
                </button>
              </li>
            </ul>
          </template>
        </div>
      </div>
    </Transition>
  </main>
</template>
