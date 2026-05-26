// 把 Worker 的 errorCategory + 原始 error 转成给用户看的友好文案。
// 跟 iOS 端 OpenAIService.prettyError 风格对齐：每一类都给具体可操作的下一步。

import type { ErrorCategory } from '../services/api'

interface FriendlyError {
  /** 标题, 大字粗体 */
  title: string
  /** 主文案, 一两句话 */
  message: string
  /** 可操作建议, 数组每条一个 bullet */
  actions: string[]
}

export function friendlyError(
  category: ErrorCategory | undefined,
  rawError: string | undefined,
): FriendlyError {
  switch (category) {
    case 'auth':
      return {
        title: 'API Key 无效',
        message: '后端 Provider 拒绝了这把 key。',
        actions: [
          '去「设置」检查 key 是不是粘错了 (有没有多空格/换行)',
          '确认这把 key 对应的是当前选的 Provider (SF / OpenAI 不能混用)',
          '去 provider dashboard 确认 key 没被 revoke',
        ],
      }
    case 'org_verify':
      return {
        title: 'OpenAI 需要组织验证',
        message: 'gpt-image-2 必须做 organization verification 才能调用。',
        actions: [
          '去 platform.openai.com → Settings → Organization → Verify Organization',
          '一般要交身份证 / 护照照片, 1~2 个工作日审核',
          '验证完后回来重试',
        ],
      }
    case 'quota':
      return {
        title: 'Provider 配额耗尽',
        message: '账户余额不足或速率限制。',
        actions: [
          '去 provider 充值 (OpenAI: Billing 充 $5+; SiliconFlow: 充值入口在控制台)',
          '如果是按分钟限流, 等 60 秒再试',
        ],
      }
    case 'safety':
      return {
        title: '内容安全系统拒绝',
        message: '上游模型的安全检测拦了这次请求。可能原因有 3 种：',
        actions: [
          '① 照片里有可识别的婴儿/儿童 (Provider 严格禁止真人小孩做参考图)',
          '② 成年人被误判为儿童 (常见误报, 尤其亚洲面孔/年轻人/仰拍角度)',
          '③ 图被判为其它敏感内容',
          '解决: 换张明显成年特征的半身/全身照, 或重新生成一次 (有随机性)',
        ],
      }
    case 'server':
      return {
        title: 'Provider 服务器内部错误',
        message: 'Provider 后端处理时崩了, 跟你的输入通常无关。',
        actions: [
          '等 5~10 分钟再试 (多数是临时故障)',
          '如果是 OpenAI, 看 status.openai.com 是否有 incident',
          '换张参考图试试 (极少数情况是图触发了边界 case)',
        ],
      }
    case 'gateway':
      return {
        title: '网关错误',
        message: 'Cloudflare 或 provider 上游网关临时故障 (502/503/504)。',
        actions: [
          '等 10~30 秒再试一次, 这类错误通常是临时的',
          '如果反复出现, 看 Provider 状态页是否有大面积故障',
        ],
      }
    case 'timeout':
      return {
        title: '任务超时',
        message: '10 分钟内没拿到结果, 任务被自动终止。',
        actions: [
          '检查 Provider 当前是否非常慢 (高峰期常见)',
          '等几分钟再试',
          '如果是多图生成, 试着把 n 改成 1',
        ],
      }
    case 'unknown':
    default:
      return {
        title: '生成失败',
        message: rawError ?? '未知错误。',
        actions: [
          '检查网络连接',
          '回「设置」确认 Provider 和 key 配置',
          '过一会儿再试',
        ],
      }
  }
}
