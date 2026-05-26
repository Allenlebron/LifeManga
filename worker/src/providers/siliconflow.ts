// SiliconFlow / FreeModel /v1/images/generations 调用。
// JSON body, 单 image 字段（data URL 形式）。
// 跟 iOS 端 callSiliconFlowImageGen 行为对齐。

import type { JobInput } from '../types'
import {
  bytesToBase64,
  fetchWithDeadline,
  PROVIDER_DEFAULT_BASE_URL,
  ProviderCallResult,
  ProviderError,
} from './shared'

const DEADLINE_SEC = 300 // SF 一般 30-90s 内返回，给 5 分钟足够

interface SFImageItem {
  b64_json?: string
  url?: string
}
interface SFResponse {
  data?: SFImageItem[]
  images?: SFImageItem[]
  // 错误响应（兼容 OpenAI 格式 + SF 自家格式）
  error?: { message: string; code?: string }
  message?: string
}

export async function callSiliconFlowGenerations(
  input: JobInput,
): Promise<ProviderCallResult> {
  if (!input.apiKey) {
    throw new ProviderError(401, 'Missing API key', 'invalid_api_key')
  }
  if (input.inputImages.length === 0) {
    throw new ProviderError(400, 'inputImages cannot be empty', 'no_input_images')
  }

  const provider = input.provider === 'freemodel' ? 'freemodel' : 'siliconflow'
  const base = input.baseUrl || PROVIDER_DEFAULT_BASE_URL[provider]
  const url = `${base.replace(/\/$/, '')}/v1/images/generations`

  // SF 只用第一张参考图（跟 iOS 端策略一致）
  const first = input.inputImages[0]
  const dataUrl = `data:${first.mime};base64,${first.base64}`

  const body = {
    model: input.model || 'Qwen/Qwen-Image-Edit',
    prompt: input.prompt,
    image_size: input.size || '1024x1024',
    batch_size: Math.max(1, Math.min(4, input.n)),
    image: dataUrl,
  }

  const res = await fetchWithDeadline(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    DEADLINE_SEC,
  )

  if (!res.ok) {
    let parsed: SFResponse = {}
    let raw = ''
    try {
      raw = await res.text()
      parsed = JSON.parse(raw)
    } catch {
      // 响应不是 JSON
    }
    const msg =
      parsed.error?.message ??
      parsed.message ??
      raw.slice(0, 240) ??
      `HTTP ${res.status}`
    throw new ProviderError(res.status, msg, parsed.error?.code)
  }

  const json = (await res.json()) as SFResponse
  const items = json.data ?? json.images ?? []
  if (items.length === 0) {
    throw new ProviderError(502, 'Provider returned no images', 'no_data')
  }

  const outputs: ProviderCallResult['outputs'] = []
  for (const item of items) {
    if (item.b64_json) {
      outputs.push({ mime: 'image/png', base64: item.b64_json })
      continue
    }
    if (item.url) {
      // SF 经常返回 url 而不是 b64_json，需要再下载一次
      const imgRes = await fetchWithDeadline(item.url, undefined, 60)
      if (!imgRes.ok) {
        throw new ProviderError(
          imgRes.status,
          `Failed to download generated image from ${item.url}`,
          'image_download_failed',
        )
      }
      const buf = new Uint8Array(await imgRes.arrayBuffer())
      const mime = imgRes.headers.get('content-type') ?? 'image/png'
      outputs.push({ mime, base64: bytesToBase64(buf) })
    }
  }
  if (outputs.length === 0) {
    throw new ProviderError(502, 'Provider returned no decodable images', 'no_data')
  }
  return { outputs }
}
