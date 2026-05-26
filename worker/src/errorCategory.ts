// 把 ProviderError 分类为 6 种用户能理解的范畴。
//
// 跟 iOS 端 OpenAIService.prettyError 的分类对齐:
//
//   auth         — Key 错 / 不存在 / 格式错 (HTTP 401)
//   org_verify   — OpenAI 要求 organization 验证才能调 gpt-image-2 (HTTP 403)
//   quota        — 配额耗尽 / 计费问题 (HTTP 429 + body 含 quota/billing)
//   safety       — 内容安全系统拒绝 (HTTP 400 + body 含 safety/moderation)
//   server       — 上游服务挂掉 (HTTP 5xx + 非网关错误)
//   gateway      — Cloudflare/反代网关错误 (HTTP 502/503/504/524 + HTML 响应)
//   timeout      — 我们的 wallclock 截止生效 (HTTP 408)
//   unknown      — 其它未识别的情况
//
// 前端拿到 errorCategory 后用 ERROR_FRIENDLY_TEXT[category] 显示给用户看。

import type { ProviderError } from './providers/shared'

export type ErrorCategory =
  | 'auth'
  | 'org_verify'
  | 'quota'
  | 'safety'
  | 'server'
  | 'gateway'
  | 'timeout'
  | 'unknown'

export function categorizeProviderError(err: ProviderError): ErrorCategory {
  const status = err.status
  const msg = (err.message ?? '').toLowerCase()
  const code = (err.code ?? '').toLowerCase()

  // 我们自己的 wallclock timeout (在 fetchWithDeadline 抛的)
  if (status === 408 || code === 'wallclock_timeout') return 'timeout'

  // 401 一律算 auth
  if (status === 401) return 'auth'

  // 403 + organization/verify 关键词
  if (status === 403 && (msg.includes('verify') || msg.includes('organization'))) {
    return 'org_verify'
  }

  // 429 / quota / billing
  if (status === 429 || msg.includes('quota') || msg.includes('billing') || msg.includes('insufficient')) {
    return 'quota'
  }

  // 400 + safety system
  if (
    status === 400 &&
    (msg.includes('safety') ||
      msg.includes('rejected') ||
      msg.includes('moderation') ||
      msg.includes('content policy'))
  ) {
    return 'safety'
  }

  // 5xx 网关层 (502/503/504/524 通常是 Cloudflare/反代)
  if (status === 502 || status === 503 || status === 504 || status === 524) {
    return 'gateway'
  }

  // 其它 5xx
  if (status >= 500 && status < 600) return 'server'

  return 'unknown'
}
