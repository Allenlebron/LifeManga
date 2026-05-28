<script setup lang="ts">
import imageCompression from 'browser-image-compression'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  CHARACTER_ART_STYLES,
  type CharacterArtStyleId,
  getCharacterArtStyle,
} from '../models/CharacterArtStyle'
import { POSE_GROUPS, type CharacterPose } from '../models/CharacterPoses'
import { MANGA_STYLES, type MangaStyleId, getMangaStyle } from '../models/MangaStyle'
import {
  buildCharacterSheetPrompt,
  buildPoseSheetPrompt,
} from '../models/CharacterPrompts'
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
  type ErrorCategory,
  type WorkerJobStatus,
} from '../services/api'
import {
  deleteCharacter,
  listCharacters,
  loadImageURLs,
  saveCharacterWithImage,
} from '../services/db'
import { friendlyError } from '../utils/errorMessages'
import type { Character } from '../models/MangaItem'
import StyleSwatch from '../components/StyleSwatch.vue'

type Tab = 'list' | 'create'
type Mode = 'sheet' | 'poses'

interface DisplayChar extends Character {
  thumbUrls: (string | null)[]
}

const activeTab = ref<Tab>('list')
const items = ref<DisplayChar[]>([])
const loadingList = ref(true)

// 创建表单状态
const photoFile = ref<File | null>(null)
const photoUrl = ref<string>('')
const charName = ref('')
const charBio = ref('')
const mode = ref<Mode>('sheet')
const artStyleId = ref<CharacterArtStyleId>('jpAnime')
const mangaStyleId = ref<MangaStyleId>('shonenJump')
const isColor = ref(true)
const selectedPoses = ref<Set<string>>(new Set())

const phase = ref<
  | 'idle'
  | 'compressing'
  | 'submitting'
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
>('idle')
const elapsedSec = ref(0)
const errorCategory = ref<ErrorCategory | undefined>(undefined)
const errorMessage = ref('')
const friendly = computed(() =>
  phase.value === 'failed' ? friendlyError(errorCategory.value, errorMessage.value) : null,
)

// 详情 modal
const activeChar = ref<DisplayChar | null>(null)

const fileInput = ref<HTMLInputElement | null>(null)

const isWorking = computed(() =>
  ['compressing', 'submitting', 'pending', 'running'].includes(phase.value),
)

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'compressing': return '压缩参考图…'
    case 'submitting': return '上传到 Worker…'
    case 'pending': return '已排队…'
    case 'running': return `生成中 ${elapsedSec.value}s`
    case 'done': return '完成 ✨'
    case 'failed': return '失败'
  }
  return ''
})

const canGenerate = computed(() => {
  if (!photoFile.value || !charName.value.trim()) return false
  if (mode.value === 'poses' && selectedPoses.value.size === 0) return false
  return phase.value === 'idle' || phase.value === 'done' || phase.value === 'failed'
})

const allPosesByLabel = computed(() => {
  const m: Record<string, CharacterPose> = {}
  for (const g of POSE_GROUPS) for (const p of g.poses) m[p.label] = p
  return m
})

async function refresh() {
  for (const it of items.value) {
    it.thumbUrls.forEach((u) => u && URL.revokeObjectURL(u))
  }
  loadingList.value = true
  const raw = await listCharacters()
  items.value = await Promise.all(
    raw.map(async (c) => ({
      ...c,
      thumbUrls: await loadImageURLs(c.views.map((v) => v.imageName)),
    })),
  )
  loadingList.value = false
}

onMounted(refresh)

onUnmounted(() => {
  for (const it of items.value) {
    it.thumbUrls.forEach((u) => u && URL.revokeObjectURL(u))
  }
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
})

function pickPhoto() { fileInput.value?.click() }

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
  photoFile.value = f
  photoUrl.value = URL.createObjectURL(f)
  input.value = ''
}

function togglePose(label: string) {
  if (selectedPoses.value.has(label)) selectedPoses.value.delete(label)
  else selectedPoses.value.add(label)
  // trigger reactivity
  selectedPoses.value = new Set(selectedPoses.value)
}

function resetForm() {
  photoFile.value = null
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
  photoUrl.value = ''
  charName.value = ''
  charBio.value = ''
  selectedPoses.value = new Set()
  phase.value = 'idle'
  errorCategory.value = undefined
  errorMessage.value = ''
}

async function handleGenerate() {
  if (!photoFile.value || !charName.value.trim()) return

  errorMessage.value = ''
  errorCategory.value = undefined

  const provider = loadCurrentProvider()
  const apiKey = loadApiKey(provider)
  if (!apiKey) {
    errorMessage.value = `请先去「设置」填写 ${provider} 的 API Key`
    errorCategory.value = 'auth'
    phase.value = 'failed'
    return
  }

  const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'])
  const pf = photoFile.value
  if (!COMPRESSIBLE.has(pf.type)) {
    const ext = pf.name.split('.').pop()?.toUpperCase() ?? ''
    errorMessage.value = pf.type.startsWith('image/')
      ? `「${pf.name}」格式 (${pf.type || ext}) 不支持，请转为 JPG/PNG 后重试`
      : `「${pf.name}」不是图片文件`
    errorCategory.value = 'unknown'
    phase.value = 'failed'
    return
  }

  phase.value = 'compressing'
  let compressed: File
  try {
    compressed = await imageCompression(pf, {
      maxSizeMB: 0.5, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg',
    })
  } catch (e) {
    errorMessage.value = `压缩失败: ${(e as Error).message}`
    errorCategory.value = 'unknown'
    phase.value = 'failed'
    return
  }

  // 拼 prompt
  let prompt: string
  let viewLabel: string
  if (mode.value === 'sheet') {
    const art = getCharacterArtStyle(artStyleId.value)
    if (!art) return
    prompt = buildCharacterSheetPrompt(charName.value.trim(), charBio.value.trim() || undefined, art)
    viewLabel = `设定稿 · ${art.displayName}`
  } else {
    const style = getMangaStyle(mangaStyleId.value)
    if (!style) return
    const poses: CharacterPose[] = Array.from(selectedPoses.value)
      .map((l) => allPosesByLabel.value[l])
      .filter((p): p is CharacterPose => !!p)
    prompt = buildPoseSheetPrompt(
      charName.value.trim(),
      charBio.value.trim() || undefined,
      poses,
      style,
      isColor.value,
    )
    viewLabel = `动作集 · ${style.displayName} (${poses.length} 个)`
  }

  phase.value = 'submitting'
  const styleOpts = loadStyleOptions(provider)
  const providerBaseUrl = localStorage.getItem('lifemanga.provider_base_url')?.trim() || undefined

  let job: WorkerJobStatus
  try {
    job = await submitJob({
      apiKey, provider, providerBaseUrl,
      prompt,
      model: styleOpts.model,
      // 角色图建议竖版 1024x1536 (除非 SF 不支持就用 1024x1024)
      size: styleOpts.size,
      quality: styleOpts.quality,
      n: 1,
      images: [compressed],
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

  phase.value = 'pending'
  let final: WorkerJobStatus
  try {
    final = await pollJobUntilDone(job.id, {
      intervalMs: 4000, maxWaitSec: 360,
      onTick: (s) => {
        if (s.status === 'running') { phase.value = 'running'; elapsedSec.value = s.elapsedSeconds ?? 0 }
        else if (s.status === 'pending') phase.value = 'pending'
      },
    })
  } catch (e) {
    errorMessage.value = `轮询失败: ${(e as Error).message}`
    errorCategory.value = 'timeout'
    phase.value = 'failed'
    return
  }

  if (final.status !== 'done') {
    errorMessage.value = final.error ?? `任务状态: ${final.status}`
    errorCategory.value = final.errorCategory ?? 'unknown'
    phase.value = 'failed'
    return
  }

  let blob: Blob
  try {
    blob = await fetchJobOutput(job.id, 0)
  } catch (e) {
    errorMessage.value = `下载结果失败: ${(e as Error).message}`
    errorCategory.value = 'unknown'
    phase.value = 'failed'
    return
  }

  // 写库
  await saveCharacterWithImage(
    {
      id: crypto.randomUUID(),
      name: charName.value.trim(),
      bio: charBio.value.trim() || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    viewLabel,
    blob,
  )

  phase.value = 'done'
  resetForm()
  await refresh()
  activeTab.value = 'list'
}

function openChar(c: DisplayChar) {
  activeChar.value = c
  document.body.style.overflow = 'hidden'
}
function closeChar() {
  activeChar.value = null
  document.body.style.overflow = ''
}
async function handleDeleteChar() {
  if (!activeChar.value) return
  if (!confirm(`删除角色「${activeChar.value.name}」？所有图片会一起删掉。`)) return
  await deleteCharacter(activeChar.value.id)
  activeChar.value.thumbUrls.forEach((u) => u && URL.revokeObjectURL(u))
  closeChar()
  await refresh()
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <header class="mb-5 flex items-end justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink-50">角色库</h1>
        <p class="mt-0.5 text-xs text-ink-300">真人照 → 漫画角色设定</p>
      </div>
    </header>

    <!-- Tab 切换 -->
    <div class="mb-5 inline-flex rounded-full border border-white/10 bg-ink-800/60 p-0.5 backdrop-blur">
      <button type="button" @click="activeTab = 'list'"
        :class="['rounded-full px-4 py-1 text-xs font-medium transition', activeTab === 'list' ? 'bg-accent-500 text-white' : 'text-ink-300 hover:text-ink-100']">
        我的角色 ({{ items.length }})
      </button>
      <button type="button" @click="activeTab = 'create'"
        :class="['rounded-full px-4 py-1 text-xs font-medium transition', activeTab === 'create' ? 'bg-accent-500 text-white' : 'text-ink-300 hover:text-ink-100']">
        新建
      </button>
    </div>

    <!-- 列表 tab -->
    <section v-if="activeTab === 'list'">
      <div v-if="loadingList" class="py-20 text-center text-sm text-ink-300">加载中…</div>
      <div v-else-if="items.length === 0"
        class="rounded-2xl border border-dashed border-white/10 bg-ink-800/40 px-6 py-16 text-center backdrop-blur">
        <p class="text-sm text-ink-100">还没有角色</p>
        <p class="mt-1 text-xs text-ink-300">点上方「新建」上传一张照片开始</p>
      </div>
      <ul v-else class="grid grid-cols-2 gap-2.5">
        <li v-for="c in items" :key="c.id">
          <button type="button" @click="openChar(c)"
            class="group block w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-800/60 text-left backdrop-blur transition hover:border-accent-500/40 active:scale-[0.98]">
            <div class="aspect-square w-full overflow-hidden bg-ink-700">
              <img v-if="c.thumbUrls[0]" :src="c.thumbUrls[0]!"
                class="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
            </div>
            <div class="px-3 py-2">
              <div class="text-sm font-medium text-ink-50">{{ c.name }}</div>
              <div class="mt-0.5 flex items-center justify-between text-[11px] text-ink-300">
                <span class="line-clamp-1">{{ c.bio || '（无设定）' }}</span>
                <span class="shrink-0 ml-2">{{ c.views.length }} 张</span>
              </div>
            </div>
          </button>
        </li>
      </ul>
    </section>

    <!-- 创建 tab -->
    <section v-else class="space-y-5">
      <!-- 照片 -->
      <div>
        <label class="mb-1.5 block text-xs text-ink-300">参考真人照片 *</label>
        <div v-if="!photoUrl">
          <button type="button" @click="pickPhoto"
            class="flex h-32 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-ink-800/60 text-ink-300 backdrop-blur transition hover:border-accent-500/40">
            <svg class="h-7 w-7 text-accent-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 16.5V19a2 2 0 002 2h14a2 2 0 002-2v-2.5M16 8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span class="text-xs">点击拍照 / 选图</span>
          </button>
        </div>
        <div v-else class="relative h-40 w-32 overflow-hidden rounded-xl border border-white/10 bg-ink-800">
          <img :src="photoUrl" class="h-full w-full object-cover" />
          <button type="button" @click="pickPhoto"
            class="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-[10px] text-white backdrop-blur">换图</button>
        </div>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/bmp,image/gif" @change="onFilePicked" class="hidden" />
      </div>

      <!-- 名字 + 设定 -->
      <div>
        <label class="mb-1.5 block text-xs text-ink-300">角色名 *</label>
        <input v-model="charName" type="text" placeholder="例: 小林"
          class="w-full rounded-xl border border-white/10 bg-ink-800/60 px-3 py-2 text-sm text-ink-50 backdrop-blur focus:border-accent-500/60 focus:outline-none" />
      </div>
      <div>
        <label class="mb-1.5 block text-xs text-ink-300">角色设定（可选）</label>
        <textarea v-model="charBio" rows="2"
          placeholder="例: 30 岁咖啡师，戴圆框眼镜，喜欢看推理小说"
          class="w-full rounded-xl border border-white/10 bg-ink-800/60 p-2.5 text-sm text-ink-50 backdrop-blur focus:border-accent-500/60 focus:outline-none" />
      </div>

      <!-- 模式 -->
      <div>
        <label class="mb-1.5 block text-xs text-ink-300">生成类型</label>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" @click="mode = 'sheet'"
            :class="['rounded-xl border p-3 text-left transition', mode === 'sheet' ? 'border-accent-500 bg-accent-500/10' : 'border-white/10 bg-ink-800/60 hover:border-white/20']">
            <div class="text-sm font-medium text-ink-50">设定稿</div>
            <div class="mt-0.5 text-[11px] text-ink-300">主体 + 4 表情 + 配饰</div>
          </button>
          <button type="button" @click="mode = 'poses'"
            :class="['rounded-xl border p-3 text-left transition', mode === 'poses' ? 'border-accent-500 bg-accent-500/10' : 'border-white/10 bg-ink-800/60 hover:border-white/20']">
            <div class="text-sm font-medium text-ink-50">动作合集</div>
            <div class="mt-0.5 text-[11px] text-ink-300">多动作 / 镜头一张图</div>
          </button>
        </div>
      </div>

      <!-- 设定稿模式: 9 种艺术风格 -->
      <div v-if="mode === 'sheet'">
        <label class="mb-1.5 block text-xs text-ink-300">艺术风格</label>
        <div class="grid grid-cols-3 gap-2">
          <button v-for="a in CHARACTER_ART_STYLES" :key="a.id" type="button"
            @click="artStyleId = a.id"
            :class="['rounded-lg border px-2 py-1.5 text-center transition', artStyleId === a.id ? 'border-accent-500 bg-accent-500/10' : 'border-white/10 bg-ink-800/60 hover:border-white/20']">
            <div class="text-xs font-medium text-ink-50">{{ a.displayName }}</div>
            <div class="mt-0.5 line-clamp-1 text-[10px] text-ink-300">{{ a.subtitle }}</div>
          </button>
        </div>
      </div>

      <!-- 动作合集: 漫画风格 + pose 多选 -->
      <div v-if="mode === 'poses'">
        <label class="mb-1.5 block text-xs text-ink-300">漫画风格</label>
        <div class="mb-3 grid grid-cols-2 gap-2">
          <button v-for="s in MANGA_STYLES" :key="s.id" type="button"
            @click="mangaStyleId = s.id"
            :class="['overflow-hidden rounded-lg border', mangaStyleId === s.id ? 'border-accent-500 ring-1 ring-accent-500/30' : 'border-white/10']">
            <div class="h-9 w-full"><StyleSwatch :style="s.id" /></div>
            <div class="px-2 py-1 text-[11px] font-medium text-ink-50">{{ s.displayName }}</div>
          </button>
        </div>

        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs text-ink-300">颜色</span>
          <div class="inline-flex rounded-full border border-white/10 bg-ink-800/60 p-0.5">
            <button @click="isColor = true" :class="['rounded-full px-2.5 py-0.5 text-[11px]', isColor ? 'bg-accent-500 text-white' : 'text-ink-300']">彩色</button>
            <button @click="isColor = false" :class="['rounded-full px-2.5 py-0.5 text-[11px]', !isColor ? 'bg-ink-50 text-ink-900' : 'text-ink-300']">黑白</button>
          </div>
        </div>

        <label class="mb-1.5 block text-xs text-ink-300">
          选动作 / 镜头 (已选 {{ selectedPoses.size }} 个)
        </label>
        <div class="space-y-2">
          <div v-for="g in POSE_GROUPS" :key="g.id"
            class="rounded-xl border border-white/10 bg-ink-800/40 p-2 backdrop-blur">
            <div class="mb-1 px-1 text-[11px] font-medium text-ink-300">{{ g.title }}</div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="p in g.poses" :key="p.label" type="button"
                @click="togglePose(p.label)"
                :class="['rounded-full border px-2 py-0.5 text-[11px] transition',
                  selectedPoses.has(p.label) ? 'border-accent-500 bg-accent-500 text-white' : 'border-white/10 bg-ink-900/60 text-ink-300 hover:border-white/30']">
                {{ p.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 生成按钮 + 错误 -->
      <div>
        <button type="button" @click="handleGenerate" :disabled="!canGenerate"
          class="relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl px-6 py-3.5 text-sm font-semibold transition"
          :class="[canGenerate
            ? 'bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-lg shadow-accent-500/30'
            : 'bg-ink-700 text-ink-300']">
          <span v-if="isWorking" class="relative flex h-4 w-4">
            <span class="absolute inset-0 rounded-full border-2 border-white border-t-transparent animate-spin" />
          </span>
          {{ isWorking ? phaseLabel : '生成角色' }}
        </button>
        <p v-if="phase === 'failed' && friendly" class="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-100">
          <span class="block font-semibold text-red-200">{{ friendly.title }}</span>
          <span class="mt-1 block text-red-100/90">{{ friendly.message }}</span>
        </p>
      </div>
    </section>

    <!-- 详情 modal -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0" enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100" leave-to-class="opacity-0">
      <div v-if="activeChar" class="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md" @click.self="closeChar">
        <header class="flex items-center justify-between p-3" style="padding-top: max(0.75rem, env(safe-area-inset-top))">
          <button type="button" @click="closeChar"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-ink-50 backdrop-blur transition hover:bg-white/20">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div class="text-sm text-ink-50">{{ activeChar.name }}</div>
          <button type="button" @click="handleDeleteChar"
            class="rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-300 transition hover:bg-red-500/30">删除</button>
        </header>

        <div class="flex-1 overflow-y-auto px-4 pb-4">
          <p v-if="activeChar.bio" class="mb-3 rounded-lg bg-ink-800/40 px-3 py-2 text-sm text-ink-200">{{ activeChar.bio }}</p>
          <div class="space-y-3">
            <div v-for="(v, i) in activeChar.views" :key="v.id"
              class="overflow-hidden rounded-2xl border border-white/10 bg-ink-800">
              <img v-if="activeChar.thumbUrls[i]" :src="activeChar.thumbUrls[i]!" class="w-full" />
              <div class="px-3 py-2 text-xs text-ink-300">{{ v.label }}</div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </main>
</template>
