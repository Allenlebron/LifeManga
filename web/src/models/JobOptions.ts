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
    size: '1024x1024',
    quality: 'medium',
    n: 1,
  },
  freemodel: {
    model: 'Qwen/Qwen-Image-Edit',
    size: '1024x1024',
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
