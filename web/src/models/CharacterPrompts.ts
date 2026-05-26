// 角色生成两种 prompt 模板。从 iOS 端 OpenAIService.buildCharacterSheetPrompt
// 和 buildPoseSheetPrompt 1:1 移植。

import type { CharacterArtStyle } from './CharacterArtStyle'
import type { CharacterPose } from './CharacterPoses'
import { effectivePrompt, type MangaStyle } from './MangaStyle'

/**
 * 设定稿 prompt: 主体 + 4 表情 + 1 配饰 + 3 生活道具, 单张白底, 双语标注。
 */
export function buildCharacterSheetPrompt(
  name: string,
  bio: string | undefined,
  artStyle: CharacterArtStyle,
): string {
  const lines: string[] = []
  lines.push(
    'Stylize the adult person in the reference photo into a polished character illustration.',
  )
  lines.push('')
  lines.push('Composition (single image, white background):')
  lines.push('• Center: full-body or 3/4 body portrait, natural pose, signature outfit.')
  lines.push(
    '• Top-right: 4 small head sketches with different expressions (smile / thoughtful / laugh / calm).',
  )
  lines.push(
    '• Right side: 1 signature accessory (glasses/watch/scarf etc fitting the bio) as a small callout with bilingual caption (中文 / English), thin arrow pointing to the spot on the character.',
  )
  lines.push(
    '• Bottom: 3 small life-style items (journal / phone / coffee / bag etc fitting the bio), each with a tiny bilingual caption (中文 / English).',
  )
  lines.push('')
  const bioLine = bio?.trim() ? ` ${bio.trim()}.` : ''
  lines.push(`Character: ${name}.${bioLine}`)
  lines.push('')
  lines.push(`Art style: ${artStyle.prompt}`)
  lines.push('')
  lines.push(
    'Rules: ADULT character (not a child). Modest clothing. White background. Match face/hair/build from photo. Same person in all expressions. Real legible Chinese characters.',
  )
  return lines.join('\n')
}

/**
 * 动作合集 prompt: 选 N 个 pose, 在一张白底图里平铺展示 (3 列网格), 每个带双语 caption。
 */
export function buildPoseSheetPrompt(
  name: string,
  bio: string | undefined,
  poses: CharacterPose[],
  style: MangaStyle,
  isColor: boolean,
): string {
  const lines: string[] = []
  lines.push(
    `Create a single character pose sheet illustration on plain white background — show the SAME adult character drawn ${poses.length} times in different poses, all arranged on ONE page.`,
  )
  lines.push('')
  const bioLine = bio?.trim() ? ` ${bio.trim()}.` : ''
  lines.push(`Character: ${name}.${bioLine}`)
  lines.push('')
  lines.push(`Show the character in these ${poses.length} poses:`)
  poses.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.label} — ${p.prompt}`)
  })
  lines.push('')
  lines.push(
    'Layout: white background, balanced grid (e.g. 3 columns × needed rows). Each pose has a small bilingual caption below it (中文 / English).',
  )
  lines.push('')
  lines.push(`Art style:`)
  lines.push(effectivePrompt(style, isColor))
  lines.push('')
  lines.push(
    'Rules: ADULT character (not a child). Modest clothing. Same person in all poses (face/hair/build/outfit consistent). White background. Real legible Chinese characters in captions.',
  )
  return lines.join('\n')
}
