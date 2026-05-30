// Worker 入口。
//
// 路由:
//   POST   /jobs              — 提交一个新任务，返回 { jobId, status }
//   GET    /jobs/:id          — 拿任务状态 (sanitized)
//   GET    /jobs/:id/output/:idx — 拿某张输出图 (image/png 二进制)
//   OPTIONS *                 — CORS preflight
//
// API Key (BYOK): Authorization: Bearer sk-... 头。
//   - 在 POST /jobs 时由 Worker 解析，转给 DO 存到 storage。
//   - DO 完成或失败后从 storage 清掉，不长期保留。
//
// 安全简化: 学习项目, 不做 rate limiting / IP 限制 / 请求签名。

import { JobRunner } from './do'
import type { Env, JobInput, Provider } from './types'
import { bytesToBase64 } from './providers'
import { callChatCompletion } from './providers/chat'
import { PROVIDER_DEFAULT_BASE_URL, ProviderError } from './providers/shared'
import { categorizeProviderError } from './errorCategory'

// Cloudflare 要求 DO class 从入口文件导出，wrangler.toml 才能找到。
export { JobRunner }

const ALLOWED_HEADERS = 'Content-Type, Authorization'
const ALLOWED_METHODS = 'GET, POST, OPTIONS'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? ''
    const allowedOrigin = pickAllowedOrigin(origin, env.ALLOWED_ORIGIN)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      })
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      // POST /jobs
      if (path === '/jobs' && request.method === 'POST') {
        return withCors(await handleSubmitJob(request, env), allowedOrigin)
      }

      // POST /story
      if (path === '/story' && request.method === 'POST') {
        return withCors(await handleSubmitStory(request), allowedOrigin)
      }

      // GET /jobs/:id  or  GET /jobs/:id/output/:idx
      const m = path.match(/^\/jobs\/([0-9a-fA-F-]{36})(\/output\/(\d+))?$/)
      if (m && request.method === 'GET') {
        const jobId = m[1]
        const outputIdx = m[3] ? parseInt(m[3], 10) : undefined
        return withCors(
          await handleGetJob(env, jobId, outputIdx),
          allowedOrigin,
          // 输出图 binary 不要被 CORS 拦截，需要 Allow-Origin
        )
      }

      return withCors(json({ error: 'Not Found' }, 404), allowedOrigin)
    } catch (err) {
      // 兜底错误处理
      const msg = err instanceof Error ? err.message : String(err)
      return withCors(json({ error: `Worker error: ${msg}` }, 500), allowedOrigin)
    }
  },
}

/** 从 multipart/form-data 里解出 JobInput 然后调 DO /start。 */
async function handleSubmitJob(request: Request, env: Env): Promise<Response> {
  // 1. 取 API key（OpenAI 用 sk-... 开头, SF 也用 sk-... 开头, 不强校验前缀）
  const auth = request.headers.get('Authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
  if (!apiKey) {
    return json(
      {
        error: 'Missing Authorization header. Expected: Authorization: Bearer <api-key>',
      },
      401,
    )
  }

  // 2. 解 multipart
  const ct = request.headers.get('Content-Type') ?? ''
  if (!ct.includes('multipart/form-data')) {
    return json({ error: 'Expected multipart/form-data body' }, 400)
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch (e) {
    return json(
      { error: `Failed to parse multipart body: ${(e as Error).message}` },
      400,
    )
  }

  // 3. 抽参数
  const prompt = String(form.get('prompt') ?? '').trim()
  if (!prompt) return json({ error: 'Missing prompt' }, 400)

  // provider: openai | siliconflow | freemodel。默认 siliconflow（学习/测试默认）
  const providerRaw = String(form.get('provider') ?? 'siliconflow').toLowerCase()
  const validProviders: Provider[] = ['openai', 'siliconflow', 'freemodel', 'chatimage']
  if (!validProviders.includes(providerRaw as Provider)) {
    return json(
      { error: `Invalid provider: ${providerRaw}. Expected one of: ${validProviders.join(', ')}` },
      400,
    )
  }
  const provider = providerRaw as Provider

  // baseUrl 可选, 用于自定义反代场景
  const baseUrlRaw = String(form.get('baseUrl') ?? '').trim()
  const baseUrl = baseUrlRaw || undefined

  // model 默认按 provider 区分
  const defaultModel = provider === 'openai' ? 'gpt-image-2'
    : provider === 'chatimage' ? 'gemini-3.0-pro-image-three-four'
    : 'Qwen/Qwen-Image-Edit'
  const model = String(form.get('model') ?? defaultModel)

  const n = parseInt(String(form.get('n') ?? '1'), 10)
  const size = String(form.get('size') ?? (provider === 'openai' ? 'auto' : '1024x1024'))
  const quality = String(form.get('quality') ?? 'medium')

  // 4. 抽图。FormData 里 image[] 字段可能多次出现。
  // Workers runtime 对 binary multipart 字段返回 File 对象，但 workers-types
  // 的 getAll 签名声明为 string[]（兼容遗留 API）。这里强制 cast。
  const rawValues = form.getAll('image[]') as unknown as Array<File | string>
  const files = rawValues.filter(
    (v): v is File => typeof v === 'object' && v !== null && 'arrayBuffer' in v,
  )
  if (files.length === 0) {
    return json(
      { error: 'Missing image[] field. Send 1-5 reference images as multipart files.' },
      400,
    )
  }
  if (files.length > 10) {
    return json({ error: 'Too many images (max 10)' }, 400)
  }

  const inputImages: JobInput['inputImages'] = []
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer())
    inputImages.push({
      mime: f.type || 'image/jpeg',
      base64: bytesToBase64(buf),
    })
  }

  // 5. 生成 jobId, 拿 DO stub, 调 /start
  const jobId = crypto.randomUUID()
  const id = env.JOBS.idFromName(jobId)
  const stub = env.JOBS.get(id)

  const input: JobInput = {
    provider,
    baseUrl,
    model,
    prompt,
    n: Math.max(1, Math.min(10, isNaN(n) ? 1 : n)),
    size,
    quality,
    inputImages,
    apiKey,
  }

  const startRes = await stub.fetch('https://do/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: jobId, input }),
  })
  // 把 DO 的响应原样返回（已是 JobStatusResponse JSON）
  return new Response(await startRes.text(), {
    status: startRes.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** POST /story: 同步调 chat completion 拿剧本 JSON, 直接返回给前端。 */
async function handleSubmitStory(request: Request): Promise<Response> {
  const auth = request.headers.get('Authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
  if (!apiKey) {
    return json({ error: 'Missing Authorization header. Expected: Authorization: Bearer <api-key>' }, 401)
  }

  const ct = request.headers.get('Content-Type') ?? ''
  if (!ct.includes('multipart/form-data')) {
    return json({ error: 'Expected multipart/form-data body' }, 400)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch (e) {
    return json({ error: `Failed to parse multipart body: ${(e as Error).message}` }, 400)
  }

  const providerRaw = String(form.get('provider') ?? 'siliconflow').toLowerCase()
  const validProviders: Provider[] = ['openai', 'siliconflow', 'freemodel', 'chatimage']
  if (!validProviders.includes(providerRaw as Provider)) {
    return json({ error: `Invalid provider: ${providerRaw}` }, 400)
  }
  const provider = providerRaw as Provider
  const baseUrl =
    String(form.get('baseUrl') ?? '').trim() || PROVIDER_DEFAULT_BASE_URL[provider]

  // 必填: scriptModel, systemPrompt, userText
  const scriptModel = String(form.get('scriptModel') ?? '').trim()
  const systemPrompt = String(form.get('systemPrompt') ?? '').trim()
  const userText = String(form.get('userText') ?? '').trim()
  if (!scriptModel || !systemPrompt || !userText) {
    return json(
      { error: 'Missing required fields: scriptModel, systemPrompt, userText' },
      400,
    )
  }

  // 抽图 (复用跟 /jobs 一样的逻辑)
  const rawValues = form.getAll('image[]') as unknown as Array<File | string>
  const files = rawValues.filter(
    (v): v is File => typeof v === 'object' && v !== null && 'arrayBuffer' in v,
  )
  if (files.length === 0) {
    return json({ error: 'Missing image[] field. Send 1-5 reference images' }, 400)
  }
  if (files.length > 10) {
    return json({ error: 'Too many images (max 10)' }, 400)
  }

  const images: { mime: string; base64: string }[] = []
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer())
    images.push({ mime: f.type || 'image/jpeg', base64: bytesToBase64(buf) })
  }

  // 调 chat completion
  let rawJson: string
  try {
    rawJson = await callChatCompletion({
      baseUrl,
      apiKey,
      model: scriptModel,
      systemPrompt,
      userText,
      images,
      maxCompletionTokens: 4000,
      jsonMode: false,
    })
  } catch (err) {
    if (err instanceof ProviderError) {
      return json(
        {
          error: `Provider ${err.status}: ${err.message}${err.code ? ` (${err.code})` : ''}`,
          errorCategory: categorizeProviderError(err),
        },
        err.status >= 400 && err.status < 600 ? err.status : 502,
      )
    }
    return json({ error: (err as Error).message ?? 'unknown' }, 500)
  }

  // 尝试 parse JSON, 失败也回传 raw 让前端显示给用户
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    return json(
      {
        error: 'Model returned non-JSON content',
        rawContent: rawJson.slice(0, 4000),
      },
      502,
    )
  }

  return json({ script: parsed })
}

/** GET /jobs/:id 或 GET /jobs/:id/output/:idx 都走这里。 */
async function handleGetJob(
  env: Env,
  jobId: string,
  outputIdx?: number,
): Promise<Response> {
  const id = env.JOBS.idFromName(jobId)
  const stub = env.JOBS.get(id)

  if (outputIdx !== undefined) {
    const res = await stub.fetch(`https://do/output/${outputIdx}`, { method: 'GET' })
    // 透传 binary
    const headers = new Headers(res.headers)
    return new Response(res.body, { status: res.status, headers })
  }

  const res = await stub.fetch('https://do/status', { method: 'GET' })
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// MARK: - 工具

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function withCors(res: Response, origin: string): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    headers.set(k, v)
  }
  return new Response(res.body, { status: res.status, headers })
}

/**
 * 选择回写给客户端的 Allow-Origin。
 * 配置里 ALLOWED_ORIGIN 可以是逗号分隔列表，也支持 "*" (开发用)。
 * 如果客户端 Origin 命中允许列表，就回写它本身；否则回写第一个允许值。
 */
function pickAllowedOrigin(reqOrigin: string, allowed: string): string {
  const list = allowed.split(',').map((s) => s.trim()).filter(Boolean)
  if (list.includes('*')) return '*'
  if (list.includes(reqOrigin)) return reqOrigin
  return list[0] ?? '*'
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
