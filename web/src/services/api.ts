// Worker HTTP client。
//
// Worker URL 是 production 部署地址。开发期可以通过 SettingsView 里的
// "高级 → Worker URL" 字段覆盖 (写入 localStorage)。

import type { JobStyleOptions } from '../models/JobOptions'

const DEFAULT_WORKER_URL = 'https://lifemanga-worker.myzwilpan.workers.dev'

export type ProviderId = 'openai' | 'siliconflow' | 'freemodel'

export type JobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'canceled'

export type ErrorCategory =
  | 'auth'
  | 'org_verify'
  | 'quota'
  | 'safety'
  | 'server'
  | 'gateway'
  | 'timeout'
  | 'unknown'

/** Worker 返回的 sanitized job 状态。 */
export interface WorkerJobStatus {
  id: string
  status: JobStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  errorCategory?: ErrorCategory
  outputCount?: number
  outputMime?: string
  elapsedSeconds?: number
}

export interface SubmitJobInput {
  apiKey: string
  provider: ProviderId
  /** 自定义 worker base URL (可选, 默认 prod) */
  workerUrl?: string
  /** 自定义 provider base URL (可选, 走 OpenAI 兼容反代) */
  providerBaseUrl?: string
  prompt: string
  model: string
  size: string
  quality: string
  n: number
  /** 1-N 张 File 对象, 来自 <input type=file> */
  images: File[]
}

/** 拿到当前要用的 worker base URL。 */
export function getWorkerUrl(): string {
  return (
    localStorage.getItem('lifemanga.worker_url')?.trim() || DEFAULT_WORKER_URL
  )
}

export function setWorkerUrl(url: string): void {
  if (url.trim()) {
    localStorage.setItem('lifemanga.worker_url', url.trim())
  } else {
    localStorage.removeItem('lifemanga.worker_url')
  }
}

/** POST /jobs 提交一个新任务，返回 Worker 的 sanitized 状态体。 */
export async function submitJob(input: SubmitJobInput): Promise<WorkerJobStatus> {
  const base = (input.workerUrl || getWorkerUrl()).replace(/\/$/, '')

  const form = new FormData()
  form.append('provider', input.provider)
  form.append('prompt', input.prompt)
  form.append('model', input.model)
  form.append('size', input.size)
  form.append('quality', input.quality)
  form.append('n', String(input.n))
  if (input.providerBaseUrl) {
    form.append('baseUrl', input.providerBaseUrl)
  }
  for (const file of input.images) {
    form.append('image[]', file, file.name || 'input.jpg')
  }

  const res = await fetch(`${base}/jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: form,
  })

  const text = await res.text()
  let body: unknown = {}
  try {
    body = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = isErrorResp(body)
      ? body.error
      : `HTTP ${res.status}: ${text.slice(0, 200)}`
    throw new ApiError(res.status, msg)
  }
  return body as WorkerJobStatus
}

/** GET /jobs/:id 轮询单次。 */
export async function fetchJobStatus(jobId: string): Promise<WorkerJobStatus> {
  const base = getWorkerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}/jobs/${jobId}`)
  if (!res.ok) {
    throw new ApiError(res.status, `Worker returned ${res.status}`)
  }
  return (await res.json()) as WorkerJobStatus
}

/** GET /jobs/:id/output/:idx, 拿生成图的 Blob。 */
export async function fetchJobOutput(jobId: string, idx: number): Promise<Blob> {
  const base = getWorkerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}/jobs/${jobId}/output/${idx}`)
  if (!res.ok) {
    throw new ApiError(res.status, `Worker output fetch returned ${res.status}`)
  }
  return await res.blob()
}

/**
 * 持续轮询直到任务终态 (done/failed/canceled) 或超过 maxWaitSec 秒。
 * onTick 每次拿到状态后回调一次，UI 用来更新进度条。
 */
export async function pollJobUntilDone(
  jobId: string,
  options: {
    intervalMs?: number
    maxWaitSec?: number
    onTick?: (s: WorkerJobStatus) => void
    abortSignal?: AbortSignal
  } = {},
): Promise<WorkerJobStatus> {
  const interval = options.intervalMs ?? 4000
  const maxWait = options.maxWaitSec ?? 300
  const startedAt = Date.now()

  while (true) {
    if (options.abortSignal?.aborted) {
      throw new ApiError(0, 'Polling aborted')
    }
    const s = await fetchJobStatus(jobId)
    options.onTick?.(s)
    if (s.status === 'done' || s.status === 'failed' || s.status === 'canceled') {
      return s
    }
    if ((Date.now() - startedAt) / 1000 > maxWait) {
      throw new ApiError(
        408,
        `Polling exceeded ${maxWait}s without terminal state`,
      )
    }
    await sleep(interval)
  }
}

/** 提交故事编剧请求, 拿到 MangaStoryScript JSON。 */
export interface SubmitStoryInput {
  apiKey: string
  provider: ProviderId
  workerUrl?: string
  providerBaseUrl?: string
  /** Vision 模型, 比如 gpt-4o-mini / Qwen/Qwen2.5-VL-72B-Instruct */
  scriptModel: string
  systemPrompt: string
  userText: string
  images: File[]
}

export interface StoryScriptResponse {
  script?: {
    title: string
    synopsis: string
    panels: Array<{
      description: string
      dialogue?: string | null
      dialogueJa?: string | null
      narration?: string | null
      narrationJa?: string | null
      sfx?: string | null
    }>
  }
  error?: string
  errorCategory?: ErrorCategory
  rawContent?: string
}

export async function submitStoryScript(input: SubmitStoryInput): Promise<StoryScriptResponse> {
  const base = (input.workerUrl || getWorkerUrl()).replace(/\/$/, '')

  const form = new FormData()
  form.append('provider', input.provider)
  form.append('scriptModel', input.scriptModel)
  form.append('systemPrompt', input.systemPrompt)
  form.append('userText', input.userText)
  if (input.providerBaseUrl) {
    form.append('baseUrl', input.providerBaseUrl)
  }
  for (const file of input.images) {
    form.append('image[]', file, file.name || 'input.jpg')
  }

  const res = await fetch(`${base}/story`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: form,
  })

  const text = await res.text()
  let body: StoryScriptResponse = {}
  try {
    body = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return body
}

/** 把 SettingsView 里保存的 provider 选项 + 用户输入合并出 SubmitJobInput。 */
export function buildSubmitInput(opts: {
  apiKey: string
  provider: ProviderId
  workerUrl?: string
  providerBaseUrl?: string
  styleOptions: JobStyleOptions
  prompt: string
  images: File[]
}): SubmitJobInput {
  return {
    apiKey: opts.apiKey,
    provider: opts.provider,
    workerUrl: opts.workerUrl,
    providerBaseUrl: opts.providerBaseUrl,
    prompt: opts.prompt,
    model: opts.styleOptions.model,
    size: opts.styleOptions.size,
    quality: opts.styleOptions.quality,
    n: opts.styleOptions.n,
    images: opts.images,
  }
}

// MARK: - utils

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function isErrorResp(v: unknown): v is { error: string } {
  return (
    typeof v === 'object' && v !== null && typeof (v as { error?: unknown }).error === 'string'
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
