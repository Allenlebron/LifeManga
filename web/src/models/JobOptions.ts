// 提交一次生成任务用的"非 prompt 类参数"。
//
// 跟 iOS 端 AppSettings 里 imageCount / imageSize / imageQuality / imageModel 对齐。
// 用户在 SettingsView 里改这些, localStorage 持久化, HomeView 调用时读出来。

import type { ProviderId } from '../services/api'

export interface JobStyleOptions {
  /** OpenAI: gpt-image-2; SF/FM: Qwen/Qwen-Image-Edit */
  model: string
  /** "1024x1024" / "1024x1536" / "1536x1024" / "auto" (OpenAI only) */
  size: string
  /** "low" | "medium" | "high" | "auto"。SF 忽略此字段。 */
  quality: string
  /** 一次生成几张, 1-N */
  n: number
}

/** 各 provider 的默认值。 */
export const DEFAULT_OPTIONS_BY_PROVIDER: Record<ProviderId, JobStyleOptions> = {
  openai: {
    model: 'gpt-image-2',
    size: '1024x1536',
    quality: 'medium',
    n: 1,
  },
  siliconflow: {
    model: 'Qwen/Qwen-Image-Edit',
    size: '1024x1536',
    quality: 'medium',
    n: 1,
  },
  freemodel: {
    model: 'Qwen/Qwen-Image-Edit',
    size: '1024x1536',
    quality: 'medium',
    n: 1,
  },
}

/** 各 provider 允许的 size 选项 (UI 下拉用)。 */
export const SIZE_OPTIONS_BY_PROVIDER: Record<ProviderId, string[]> = {
  openai: ['auto', '1024x1024', '1024x1536', '1536x1024'],
  siliconflow: ['1024x1024', '1024x1536', '1536x1024', '1280x720', '720x1280'],
  freemodel: ['1024x1024', '1024x1536', '1536x1024'],
}

/** Provider 对应的 BYOK key 在 localStorage 里的 key 名。 */
export function apiKeyStorageKey(provider: ProviderId): string {
  return `lifemanga.api_key.${provider}`
}

export function loadApiKey(provider: ProviderId): string {
  return localStorage.getItem(apiKeyStorageKey(provider)) ?? ''
}

export function saveApiKey(provider: ProviderId, key: string): void {
  if (key.trim()) {
    localStorage.setItem(apiKeyStorageKey(provider), key.trim())
  } else {
    localStorage.removeItem(apiKeyStorageKey(provider))
  }
}

const PROVIDER_KEY = 'lifemanga.current_provider'
const OPTIONS_KEY = 'lifemanga.style_options'

export function loadCurrentProvider(): ProviderId {
  const v = localStorage.getItem(PROVIDER_KEY)
  if (v === 'openai' || v === 'siliconflow' || v === 'freemodel') return v
  return 'siliconflow' // 跟 iOS 端默认一致
}

export function saveCurrentProvider(p: ProviderId): void {
  localStorage.setItem(PROVIDER_KEY, p)
}

export function loadStyleOptions(provider: ProviderId): JobStyleOptions {
  const raw = localStorage.getItem(OPTIONS_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed &&
        typeof parsed.model === 'string' &&
        typeof parsed.size === 'string' &&
        typeof parsed.n === 'number'
      ) {
        return {
          model: parsed.model,
          size: parsed.size,
          quality: parsed.quality ?? 'medium',
          n: parsed.n,
        }
      }
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_OPTIONS_BY_PROVIDER[provider]
}

export function saveStyleOptions(opts: JobStyleOptions): void {
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(opts))
}

// MARK: - 故事模式 settings

import type { BubbleTextMode } from './MangaStyle'

export interface StoryOptions {
  /** 故事模式默认是否启用 (用户在 HomeView 还能临时切) */
  enabled: boolean
  /** 期望分镜格数, 2-9 */
  panelCount: number
  /** 视觉编剧模型. 不同 provider 默认值不同, 用户可在 Settings 里自己改 */
  scriptModel: string
  /** 气泡里写什么文字 */
  bubbleTextMode: BubbleTextMode
}

export const DEFAULT_STORY_OPTIONS_BY_PROVIDER: Record<ProviderId, StoryOptions> = {
  openai: {
    enabled: false,
    panelCount: 6,
    scriptModel: 'gpt-4o-mini', // vision-capable, 比 gpt-5 便宜
    bubbleTextMode: 'chinese',
  },
  siliconflow: {
    enabled: false,
    panelCount: 6,
    scriptModel: 'Qwen/Qwen3-VL-8B-Instruct',
    bubbleTextMode: 'chinese',
  },
  freemodel: {
    enabled: false,
    panelCount: 6,
    scriptModel: 'Qwen/Qwen3-VL-8B-Instruct',
    bubbleTextMode: 'chinese',
  },
}

const STORY_KEY = 'lifemanga.story_options'

const DISABLED_MODELS = new Set([
  'Qwen/Qwen2.5-VL-72B-Instruct',
  'Qwen/Qwen2.5-VL-7B-Instruct',
])

export function loadStoryOptions(provider: ProviderId): StoryOptions {
  const raw = localStorage.getItem(STORY_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed &&
        typeof parsed.enabled === 'boolean' &&
        typeof parsed.panelCount === 'number' &&
        typeof parsed.scriptModel === 'string' &&
        typeof parsed.bubbleTextMode === 'string'
      ) {
        const fallback = DEFAULT_STORY_OPTIONS_BY_PROVIDER[provider]
        return {
          enabled: parsed.enabled,
          panelCount: Math.max(2, Math.min(9, parsed.panelCount)),
          scriptModel: DISABLED_MODELS.has(parsed.scriptModel) ? fallback.scriptModel : parsed.scriptModel,
          bubbleTextMode: parsed.bubbleTextMode as BubbleTextMode,
        }
      }
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_STORY_OPTIONS_BY_PROVIDER[provider]
}

export function saveStoryOptions(opts: StoryOptions): void {
  localStorage.setItem(STORY_KEY, JSON.stringify(opts))
}

export const BUBBLE_TEXT_MODES: { id: BubbleTextMode; label: string; hint: string }[] = [
  { id: 'chinese', label: '中文', hint: '气泡里画中文台词（推荐）' },
  { id: 'japanese', label: '日文假名', hint: '气泡里画日文假名，怀旧 manga 感' },
  { id: 'english', label: '英文', hint: '气泡里画英文台词（最稳，海外漫画感）' },
  { id: 'empty', label: '留空', hint: '气泡画出来但里面不写字' },
  { id: 'none', label: '无对话框', hint: '完全不画对话框，纯视觉漫画' },
]
