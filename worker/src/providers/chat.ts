// OpenAI 兼容 /v1/chat/completions 调用 (含 vision)。
// SF / OpenAI / FreeModel 都用同一份 JSON 协议, 只换 base URL + model。
//
// 跟 iOS 端 generateScript() 行为对齐:
// - system 提示让模型输出严格 JSON
// - user content 是 [text, image_url, image_url, ...] 数组
// - response_format = { type: "json_object" }
// - max_completion_tokens = 4000 (gpt-5 系列改名了, 但 SF 也支持这个键)

import { fetchWithDeadline, ProviderError } from './shared'

const DEADLINE_SEC = 180 // 视觉编剧一般 5-30s 内, 给 3 分钟兜底

export interface ChatVisionInput {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  userText: string
  /** 输入图，base64 (无 data: 前缀) + mime */
  images: { mime: string; base64: string }[]
  /** 完成的 JSON token 上限 */
  maxCompletionTokens?: number
  /** 强制 JSON 模式. 默认 true */
  jsonMode?: boolean
}

interface ChatChoice {
  message?: { content?: string }
}
interface ChatResponse {
  choices?: ChatChoice[]
  error?: { message: string; code?: string }
}

/**
 * 调 chat completion 拿 JSON 字符串。返回 raw content (调用方自己 JSON.parse)。
 */
export async function callChatCompletion(input: ChatVisionInput): Promise<string> {
  if (!input.apiKey) {
    throw new ProviderError(401, 'Missing API key', 'invalid_api_key')
  }

  const userContent: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: input.userText }]

  for (const img of input.images) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    })
  }

  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_completion_tokens: input.maxCompletionTokens ?? 4000,
  }
  if (input.jsonMode !== false) {
    body.response_format = { type: 'json_object' }
  }

  const url = `${input.baseUrl.replace(/\/$/, '')}/v1/chat/completions`

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
    } catch {
      /* 非 JSON */
    }
    const msg =
      parsed.error?.message ?? raw.slice(0, 240) ?? `HTTP ${res.status}`
    throw new ProviderError(res.status, msg, parsed.error?.code)
  }

  const json = (await res.json()) as ChatResponse
  const content = json.choices?.[0]?.message?.content ?? ''
  if (!content) {
    throw new ProviderError(502, 'Chat completion returned empty content', 'empty_content')
  }
  return content
}
