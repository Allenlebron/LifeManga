// Provider 调用失败时统一抛这个。
//
// status: HTTP 状态码 (401/403/429/500/...) 或自定义码 (502 = parsing failure)
// code:   provider 给的细分 code，如 "invalid_api_key" / "insufficient_quota"
// message: 给用户看的简短消息（DO 写进 state.error）

export class ProviderError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.code = code
  }
}

/** 把 base64 字符串转成 Uint8Array。Workers 用 atob。 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** 把 Uint8Array 转成 base64 字符串。32KB 分块避免 String.fromCharCode 爆栈。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/** 给一个 fetch 加 N 秒墙钟硬截止。超过抛 ProviderError。 */
export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  deadlineSec: number,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), deadlineSec * 1000)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ProviderError(
        408,
        `Request exceeded ${deadlineSec}s wall-clock deadline`,
        'wallclock_timeout',
      )
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 各 provider 默认 base URL。可被 JobInput.baseUrl 覆盖。 */
export const PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  openai: 'https://api.openai.com',
  siliconflow: 'https://api.siliconflow.cn',
  freemodel: 'https://api.freemodel.dev',
  chatimage: 'http://127.0.0.1:8000',
}

/** Provider 调用结果。 */
export interface ProviderCallResult {
  outputs: { mime: string; base64: string }[]
}
