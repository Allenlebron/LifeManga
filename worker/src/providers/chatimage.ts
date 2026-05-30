// Chat-image provider: 调 /v1/chat/completions, 从 markdown content 提取图片 URL。
// 用于 Gemini image generation 等通过 chat 接口出图的模型。

import type { JobInput } from '../types'
import {
  bytesToBase64,
  fetchWithDeadline,
  PROVIDER_DEFAULT_BASE_URL,
  ProviderCallResult,
  ProviderError,
} from './shared'

const DEADLINE_SEC = 300

interface ChatChoice {
  message?: { content?: string }
}
interface ChatResponse {
  choices?: ChatChoice[]
  error?: { message: string; code?: string }
}

/** 从 markdown 或 URL 字符串中提取第一个图片 URL */
function extractImageUrl(content: string): string | null {
  // markdown: ![...](url)
  const mdMatch = content.match(/!\[[^\]]*\]\(([^)]+)\)/)
  if (mdMatch) return mdMatch[1]
  // 纯 URL
  const urlMatch = content.match(/https?:\/\/\S+\.(?:png|jpg|jpeg|webp|gif)/i)
  if (urlMatch) return urlMatch[0]
  return null
}

export async function callChatImageGenerations(
  input: JobInput,
): Promise<ProviderCallResult> {
  if (!input.apiKey) {
    throw new ProviderError(401, 'Missing API key', 'invalid_api_key')
  }

  const base = input.baseUrl || PROVIDER_DEFAULT_BASE_URL.chatimage
  const url = `${base.replace(/\/$/, '')}/v1/chat/completions`

  const body = {
    model: input.model,
    messages: [
      { role: 'user', content: input.prompt },
    ],
    stream: false,
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
    let parsed: ChatResponse = {}
    let raw = ''
    try {
      raw = await res.text()
      parsed = JSON.parse(raw)
    } catch { /* not JSON */ }
    const msg = parsed.error?.message ?? raw.slice(0, 240) ?? `HTTP ${res.status}`
    throw new ProviderError(res.status, msg, parsed.error?.code)
  }

  const json = (await res.json()) as ChatResponse
  const content = json.choices?.[0]?.message?.content ?? ''
  if (!content) {
    throw new ProviderError(502, 'Chat completion returned empty content', 'empty_content')
  }

  const imageUrl = extractImageUrl(content)
  if (!imageUrl) {
    throw new ProviderError(502, 'No image URL found in response', 'no_image_url')
  }

  // 下载图片
  const imgRes = await fetchWithDeadline(imageUrl, undefined, 60)
  if (!imgRes.ok) {
    throw new ProviderError(imgRes.status, `Failed to download image from ${imageUrl}`, 'image_download_failed')
  }
  const buf = new Uint8Array(await imgRes.arrayBuffer())
  const mime = imgRes.headers.get('content-type') ?? 'image/png'

  return { outputs: [{ mime, base64: bytesToBase64(buf) }] }
}
