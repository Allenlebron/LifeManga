// 共享类型。Worker 入口和 DO 都用这一份。
//
// 设计原则:
// - Job 状态机 5 个状态：pending → running → done / failed / canceled
// - 永远不自动重试 (跟 iOS 端策略一致 — gpt-image-2 长 GPU 任务超时后无法判断是否还在跑，
//   自动重试会重复扣费)
// - 输入和输出图都用 base64 编码存在 DO SQLite storage 里，每张一个 cell
//   (cell 上限 2MB，对 medium quality 图够用)

/** Cloudflare Worker 环境绑定。绑定名跟 wrangler.toml 里 [[durable_objects.bindings]] / [vars] 对齐。 */
export interface Env {
  /** JobRunner Durable Object 命名空间 */
  JOBS: DurableObjectNamespace
  /** 允许跨域的源。Cloudflare Pages 域名。生产值在 wrangler.toml [vars] 里写死。 */
  ALLOWED_ORIGIN: string
}

/** Job 生命周期状态。 */
export type JobStatus =
  | 'pending' // start handler 写完, alarm 还没跑
  | 'running' // alarm() 在调 OpenAI
  | 'done' // OpenAI 成功返回, output 已存进 DO storage
  | 'failed' // OpenAI 失败 / 网络异常 / 任何异常
  | 'canceled' // 用户主动取消 (本期 v0.1 不实现, 留接口)

/** 支持的 image API provider。 */
export type Provider = 'openai' | 'siliconflow' | 'freemodel'

/** 提交一个 job 的参数 (DO 内部格式)。 */
export interface JobInput {
  /** 走哪个 provider。决定 endpoint / body 格式 / 字段名映射。 */
  provider: Provider
  /** 自定义 base URL（覆盖 provider 默认）。用于 OpenAI 兼容反代场景。可选。 */
  baseUrl?: string
  /** 模型名 (provider-specific)。OpenAI 默认 gpt-image-2，SF/FM 默认 Qwen/Qwen-Image-Edit */
  model: string
  /** 完整 prompt (前端拼好 effectivePrompt 后传过来) */
  prompt: string
  /** 1-10 (OpenAI) / 1-4 (SF) */
  n: number
  /** OpenAI: "auto" | "1024x1024" | "1024x1536" | "1536x1024"
   *  SF:     image_size, "1024x1024" 这种 */
  size: string
  /** OpenAI 专用: "low" | "medium" | "high" | "auto"。SF 忽略此字段。 */
  quality: string
  /** 输入参考图，base64 (无 data: 前缀) + mime。
   *  - OpenAI 接受 1-10 张 (image[])
   *  - SF 只用第一张 (单 image 字段) */
  inputImages: { mime: string; base64: string }[]
  /** API Key。完整任务结束后从 storage 删掉，不长期保留。 */
  apiKey: string
}

/** Job 状态体（GET /jobs/:id 返回这个的 sanitized 版本，apiKey 永远不返回）。 */
export interface JobState {
  id: string
  status: JobStatus
  /** epoch ms */
  createdAt: number
  /** epoch ms, 进 running 时填 */
  startedAt?: number
  /** epoch ms, 进 done/failed 时填 */
  finishedAt?: number
  /** 失败时填，描述错误。 */
  error?: string
  /** 成功时填，输出图片张数。具体 base64 通过 GET /jobs/:id/output/:idx 拿。 */
  outputCount?: number
  /** 输出图的 mime type, 一般是 image/png */
  outputMime?: string
  /** 每张输出图的分片字节数列表。outputChunkSizes[i] = [片0字节数, 片1字节数, ...] */
  outputChunkSizes?: number[][]
  input: JobInput
}

/** 给前端返回的 sanitized 状态体（去掉 apiKey 和 inputImages 的 base64 详情，避免响应过大）。 */
export interface JobStatusResponse {
  id: string
  status: JobStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  outputCount?: number
  outputMime?: string
  /** 用户体验用：当前已经等了多少秒 (server 端算好) */
  elapsedSeconds?: number
}

/** 把 JobState 转成 sanitized 给客户端用的体。 */
export function toStatusResponse(state: JobState): JobStatusResponse {
  const now = Date.now()
  const elapsedFrom = state.startedAt ?? state.createdAt
  return {
    id: state.id,
    status: state.status,
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    error: state.error,
    outputCount: state.outputCount,
    outputMime: state.outputMime,
    elapsedSeconds:
      state.status === 'running' || state.status === 'pending'
        ? Math.floor((now - elapsedFrom) / 1000)
        : undefined,
  }
}

/** 错误时 Worker / DO 返回的统一格式。 */
export interface ApiError {
  error: string
  /** 可选的 HTTP-style 状态码 hint */
  status?: number
}
