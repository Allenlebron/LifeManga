// Provider dispatcher。DO 调这一个函数，按 input.provider 路由到具体实现。

import type { JobInput } from '../types'
import { callOpenAIEdits } from './openai'
import { callSiliconFlowGenerations } from './siliconflow'
import type { ProviderCallResult } from './shared'

export async function callProvider(input: JobInput): Promise<ProviderCallResult> {
  switch (input.provider) {
    case 'openai':
      return callOpenAIEdits(input)
    case 'siliconflow':
    case 'freemodel':
      // SF 和 FreeModel 共用 JSON 协议，只是 base URL 不同。
      return callSiliconFlowGenerations(input)
    default: {
      // 让 TS 帮我们 exhaustive check
      const _exhaustive: never = input.provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}

export { ProviderError, bytesToBase64 } from './shared'
