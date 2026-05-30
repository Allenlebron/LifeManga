// Provider dispatcher。DO 调这一个函数，按 input.provider 路由到具体实现。

import type { JobInput } from '../types'
import { callChatImageGenerations } from './chatimage'
import { callOpenAIEdits } from './openai'
import { callSiliconFlowGenerations } from './siliconflow'
import type { ProviderCallResult } from './shared'

export async function callProvider(input: JobInput): Promise<ProviderCallResult> {
  switch (input.provider) {
    case 'openai':
      return callOpenAIEdits(input)
    case 'siliconflow':
    case 'freemodel':
      return callSiliconFlowGenerations(input)
    case 'chatimage':
      return callChatImageGenerations(input)
    default: {
      const _exhaustive: never = input.provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}

export { ProviderError, bytesToBase64 } from './shared'
