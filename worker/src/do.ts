// JobRunner Durable Object.
//
// 一个 jobId 一个 DO 实例。生命周期 storage：
//   "state"     -> JobState (JSON)
//   "output:0"  -> base64 string (输出图 0 的 base64)
//   "output:1"  -> ...
//
// 关键模式：alarm() 在 start 之后 ~100ms 触发，独立于客户端的 HTTP 连接，
// 所以即使客户端断开/超时，OpenAI 调用照样在 DO 里跑完。这就是 Cloudflare
// 在边缘上跑长任务的核心路径。
//
// 不自动重试：alarm 失败后状态转 failed，错误消息留在 state.error 里。
// gpt-image-2 是长 GPU 任务，自动重试有重复扣费风险（跟 iOS 端策略一致）。

import { callProvider, ProviderError } from './providers'
import type { Env, JobInput, JobState } from './types'
import { toStatusResponse } from './types'

const STATE_KEY = 'state'
/** 一张输出图分片存。每片 ≤ 1.5MB binary，远在 SQLite 单 cell 2MB 限制内。 */
const CHUNK_SIZE = 1_500_000
const OUTPUT_CHUNK_KEY = (imgIdx: number, chunkIdx: number) =>
  `output:${imgIdx}:${chunkIdx}`

/** base64 → Uint8Array */
function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export class JobRunner {
  private state: DurableObjectState
  // env 暂时没用到，但保留构造参数确保和 cloudflare-workers 的 DO 签名一致
  // (env: Env 在以后接 R2 / KV / Queues 时会用到，先放着不报 TS 错)
  // @ts-expect-error 保留供将来扩展
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  /** Worker 通过 stub.fetch() 调进来，按 URL 分路。 */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/start' && request.method === 'POST') {
      return this.handleStart(request)
    }
    if (path === '/status' && request.method === 'GET') {
      return this.handleStatus()
    }
    // /output/0, /output/1 等
    const outputMatch = path.match(/^\/output\/(\d+)$/)
    if (outputMatch && request.method === 'GET') {
      return this.handleOutput(parseInt(outputMatch[1], 10))
    }

    return json({ error: 'DO route not found' }, 404)
  }

  /** POST /start: 接收 JobInput, 写入 storage, 排 alarm。 */
  private async handleStart(request: Request): Promise<Response> {
    // 防 replay：同一个 jobId 不允许 start 两次
    const existing = await this.state.storage.get<JobState>(STATE_KEY)
    if (existing) {
      return json({ error: 'Job already started', status: 409 }, 409)
    }

    const body = (await request.json()) as { id: string; input: JobInput }
    const now = Date.now()
    const newState: JobState = {
      id: body.id,
      status: 'pending',
      createdAt: now,
      input: body.input,
    }
    await this.state.storage.put(STATE_KEY, newState)
    // 100ms 后触发 alarm，让 start handler 能尽快返回给客户端
    await this.state.storage.setAlarm(now + 100)

    return json(toStatusResponse(newState))
  }

  /** GET /status: 返回 sanitized 状态体。 */
  private async handleStatus(): Promise<Response> {
    const s = await this.state.storage.get<JobState>(STATE_KEY)
    if (!s) {
      return json({ error: 'Job not found', status: 404 }, 404)
    }
    return json(toStatusResponse(s))
  }

  /** GET /output/:idx: 返回某张输出图的二进制 (image/png)。重组分片。 */
  private async handleOutput(idx: number): Promise<Response> {
    const s = await this.state.storage.get<JobState>(STATE_KEY)
    if (!s) return json({ error: 'Job not found' }, 404)
    if (s.status !== 'done') {
      return json({ error: `Job not done (status=${s.status})` }, 409)
    }
    const count = s.outputCount ?? 0
    if (idx < 0 || idx >= count) {
      return json({ error: 'Output index out of range' }, 404)
    }
    const sizes = s.outputChunkSizes?.[idx]
    if (!sizes || sizes.length === 0) {
      return json({ error: 'Output chunks missing' }, 500)
    }

    // 重组所有分片
    const total = sizes.reduce((a, b) => a + b, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (let c = 0; c < sizes.length; c++) {
      const chunk = await this.state.storage.get<Uint8Array>(OUTPUT_CHUNK_KEY(idx, c))
      if (!chunk) {
        return json({ error: `Output chunk ${c} missing` }, 500)
      }
      out.set(chunk, off)
      off += chunk.length
    }
    return new Response(out, {
      headers: {
        'Content-Type': s.outputMime ?? 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  }

  /**
   * Cloudflare 触发的 alarm 回调。在 start 之后 100ms 跑。
   * 跟 fetch handler 完全独立，不受客户端 HTTP 连接影响。
   * 这是这个项目"长任务在边缘活下来"的核心机制。
   */
  async alarm(): Promise<void> {
    const s = await this.state.storage.get<JobState>(STATE_KEY)
    if (!s) {
      // alarm 触发但找不到 state，可能 storage 被清掉了，无能为力
      return
    }
    if (s.status !== 'pending') {
      // alarm 不重试。任何非 pending 状态都意味着已经处理过 / 处理中崩了。
      // 如果是 running，说明上次 alarm 跑到一半 worker 重启 / 容器重排，
      // 此时不再重试，转 failed 让用户看到错误。
      if (s.status === 'running') {
        s.status = 'failed'
        s.error = 'Alarm reentry detected (likely instance restart). No auto-retry.'
        s.finishedAt = Date.now()
        await this.state.storage.put(STATE_KEY, s)
      }
      return
    }

    // 进 running
    s.status = 'running'
    s.startedAt = Date.now()
    await this.state.storage.put(STATE_KEY, s)

    try {
      const result = await callProvider(s.input)
      // 把每张输出图分片存进 SQLite (单 cell 2MB 限制 → 1.5MB binary 分片)
      const chunkSizes: number[][] = []
      for (let i = 0; i < result.outputs.length; i++) {
        const bytes = decodeB64(result.outputs[i].base64)
        const sizes: number[] = []
        for (let off = 0; off < bytes.length; off += CHUNK_SIZE) {
          const chunk = bytes.slice(off, off + CHUNK_SIZE)
          await this.state.storage.put(OUTPUT_CHUNK_KEY(i, sizes.length), chunk)
          sizes.push(chunk.length)
        }
        chunkSizes.push(sizes)
      }
      s.status = 'done'
      s.outputCount = result.outputs.length
      s.outputMime = result.outputs[0]?.mime ?? 'image/png'
      s.outputChunkSizes = chunkSizes
      s.finishedAt = Date.now()
      // 清掉 apiKey + 输入图 base64，节省 storage 空间，也减少长期保留 key 的暴露面
      s.input = {
        ...s.input,
        apiKey: '',
        inputImages: [],
      }
      await this.state.storage.put(STATE_KEY, s)
    } catch (err) {
      s.status = 'failed'
      if (err instanceof ProviderError) {
        s.error = `Provider ${err.status}: ${err.message}${err.code ? ` (${err.code})` : ''}`
      } else if (err instanceof Error) {
        s.error = err.message
      } else {
        s.error = String(err)
      }
      s.finishedAt = Date.now()
      // 失败也清掉 apiKey
      s.input = { ...s.input, apiKey: '', inputImages: [] }
      await this.state.storage.put(STATE_KEY, s)
    }
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
