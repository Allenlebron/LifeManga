// OpenAI /v1/images/edits 调用。
// gpt-image-2 multipart 协议。

import type { JobInput } from '../types'
import {
  base64ToBytes,
  fetchWithDeadline,
  PROVIDER_DEFAULT_BASE_URL,
  ProviderCallResult,
  ProviderError,
} from './shared'

/** 跟 iOS 端 timeoutIntervalForResource 对齐: 10 分钟。 */
const DEADLINE_SEC = 600

interface OpenAIErrorBody {
  error?: { message: string; type?: string; code?: string }
}
interface OpenAIImagesEditResponse {
  data?: { b64_json?: string }[]
}

export async function callOpenAIEdits(input: JobInput): Promise<ProviderCallResult> {
  if (!input.apiKey || !input.apiKey.startsWith('sk-')) {
    throw new ProviderError(401, 'Missing or invalid API key', 'invalid_api_key')
  }
  if (input.inputImages.length === 0) {
    throw new ProviderError(400, 'inputImages cannot be empty', 'no_input_images')
  }

  const base = input.baseUrl || PROVIDER_DEFAULT_BASE_URL.openai
  const url = `${base.replace(/\/$/, '')}/v1/images/edits`

  const form = new FormData()
  form.append('model', input.model || 'gpt-image-2')
  form.append('prompt', input.prompt)
  form.append('n', String(Math.max(1, Math.min(10, input.n))))
  form.append('size', input.size || 'auto')
  form.append('quality', input.quality || 'medium')

  for (let i = 0; i < input.inputImages.length; i++) {
    const img = input.inputImages[i]
    const blob = new Blob([base64ToBytes(img.base64)], { type: img.mime })
    form.append(
      'image[]',
      blob,
      `input_${i}.${img.mime.endsWith('png') ? 'png' : 'jpg'}`,
    )
  }

  const res = await fetchWithDeadline(
    url,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
    },
    DEADLINE_SEC,
  )

  if (!res.ok) {
    let body: OpenAIErrorBody = {}
    try {
      body = await res.json()
    } catch {
      /* 非 JSON 响应 */
    }
    throw new ProviderError(
      res.status,
      body.error?.message ?? `HTTP ${res.status}`,
      body.error?.code,
    )
  }

  const json = (await res.json()) as OpenAIImagesEditResponse
  const data = json.data ?? []
  if (data.length === 0) {
    throw new ProviderError(502, 'OpenAI returned no images', 'no_data')
  }

  const outputs: ProviderCallResult['outputs'] = []
  for (const d of data) {
    if (d.b64_json) outputs.push({ mime: 'image/png', base64: d.b64_json })
  }
  if (outputs.length === 0) {
    throw new ProviderError(502, 'OpenAI returned no decodable images', 'no_data')
  }
  return { outputs }
}
