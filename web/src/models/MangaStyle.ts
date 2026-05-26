// 漫画风格定义。从 iOS 端 MangaStyle.swift 1:1 翻译。
//
// Prompt 设计原则（避免出现"脏画面"）:
// - 强调 CLEAN, CONFIDENT INK LINES (干净自信的描线)
// - 强调 GENEROUS WHITE SPACE (大量留白)
// - 屏蔽掉过度的 crosshatching / stippling / sketchy
// - 用现代主流日漫作品做参考 (间谍过家家 / 咒术回战 / 我推的孩子 等)

export type MangaStyleId =
  | 'shonenJump'
  | 'sliceOfLife'
  | 'darkSeinen'
  | 'retroGekiga'
  | 'chibi4Koma'
  | 'sportsHotBlooded'
  | 'scifiMecha'
  | 'horrorJunjiIto'

export interface MangaStyle {
  id: MangaStyleId
  /** 中文显示名 */
  displayName: string
  /** 风格描述（用户在风格选择页看到的副标题） */
  subtitle: string
  /** Tailwind class 名，用作 Web 端风格卡片背景；后续 Weekend 5 可以替换成更细的视觉预览 */
  swatchClass: string
  /** 给 OpenAI 的"基础风格 prompt"——不含色彩/清爽规则，由 effectivePrompt 注入 */
  basePrompt: string
  /** 这个风格本身就允许密集线条，跳过全局清爽规则 */
  allowsDenseInk: boolean
}

// 全局"清爽线条"硬性指令。除了剧画/伊藤润二那种本身就该密集的风格之外，所有风格都要叠加。
const GLOBAL_CLEAN_INK_RULE = `CRITICAL DRAWING RULES (override anything else if conflict):
- CLEAN, CONFIDENT INK LINES with strong weight variation, like a printed manga page that just came off a professional inker's desk.
- GENEROUS WHITE SPACE. Faces and clothing should be mostly white with just a few decisive shadow shapes.
- DO NOT use sketchy, scribbly, pencil-rough, charcoal, or photo-realistic textures.
- Use SOLID FLAT BLACKS for major shadows, screen-tone dot patterns ONLY where appropriate (hair, clothing folds), NOT scattered everywhere.
- Avoid heavy crosshatching/stippling on faces and skin — keep skin almost entirely white.
- Backgrounds should be SIMPLIFIED: clean perspective lines, geometric shapes, lots of white. No noisy textures.
- Speech bubbles must be perfectly clean ovals with crisp single-line borders.
- The page should look CRISP and READABLE at thumbnail size.`

export const MANGA_STYLES: readonly MangaStyle[] = [
  {
    id: 'shonenJump',
    displayName: '经典少年Jump风',
    subtitle: '间谍过家家 / 咒术回战 那种现代少年漫干净线条',
    swatchClass: 'bg-white',
    allowsDenseInk: false,
    basePrompt: `Modern mainstream Weekly Shonen Jump manga style, in the vein of Spy x Family, Jujutsu Kaisen, Chainsaw Man, My Hero Academia, or Oshi no Ko. Clean confident inking with strong line-weight variation. Big expressive eyes with sharp highlights, dynamic but readable poses, sharp angular hair drawn as simple solid black silhouettes. Use screen-tone halftones SPARINGLY (only on hair, eyes, and one or two key shadow areas). Plenty of white space. Speed lines used purposefully — not scattered all over the page. The page must read crisp and clean.`,
  },
  {
    id: 'sliceOfLife',
    displayName: '日常治愈风',
    subtitle: '辉夜大小姐 / 邻家女孩 那种温柔日常感',
    swatchClass: 'bg-gradient-to-br from-pink-100 to-amber-50',
    allowsDenseInk: false,
    basePrompt: `Gentle modern Japanese slice-of-life manga style, like Kaguya-sama: Love is War, Komi Can't Communicate, or Yotsuba&!. Soft, very clean ink lines. Mostly white faces with subtle delicate shading. Calm warm composition, lots of negative space. Speech bubbles are clean rounded rectangles or soft ovals. Backgrounds are simplified and uncluttered. NO heavy crosshatching, NO sketchy lines.`,
  },
  {
    id: 'darkSeinen',
    displayName: '暗黑剧情风',
    subtitle: '我推的孩子 / 链锯人 那种有质感的剧情漫画',
    swatchClass: 'bg-ink-900',
    allowsDenseInk: false,
    basePrompt: `Modern seinen manga style, in the vein of Oshi no Ko, Chainsaw Man, or 20th Century Boys. Sharp confident inking with strong contrast: large solid-black shadow shapes versus clean white skin. Mature realistic proportions but still stylized. Atmospheric lighting through bold black silhouettes, NOT through scribbly hatching. Use screen tones for clothing and dramatic gradients. Keep faces and skin clean — let the silhouettes carry the mood.`,
  },
  {
    id: 'retroGekiga',
    displayName: '复古剧画风',
    subtitle: '70-80 年代写实剧画，浓厚老派气息',
    swatchClass: 'bg-amber-100',
    allowsDenseInk: true,
    basePrompt: `Retro 1970s-80s Japanese gekiga manga style, like early Naoki Urasawa or Yoshihiro Tatsumi. Realistic but still firmly stylized — confident hand-inked lines, classic crosshatching used DELIBERATELY for shadows on clothing and backgrounds (not scattered randomly). Vintage screen-tone patterns. Faces remain mostly clean with character. Period-appropriate composition. Avoid pencil-sketch roughness — this should still look like a finished printed page.`,
  },
  {
    id: 'chibi4Koma',
    displayName: '萌系四格风',
    subtitle: 'Q 版四格漫画，可爱搞笑',
    swatchClass: 'bg-pink-100',
    allowsDenseInk: false,
    basePrompt: `Cute chibi 4-koma comedy manga style, like Lucky Star, K-On!, or Azumanga Daioh. Super-deformed rounded character proportions, large simple eyes, clean thin confident ink lines. Almost no shading — just a tiny bit of light screen tone. Tons of white space, light and airy composition. Add small cute symbols (sparkles, sweat drops, music notes, hearts) tastefully. Speech bubbles are perfect clean ovals.`,
  },
  {
    id: 'sportsHotBlooded',
    displayName: '运动热血风',
    subtitle: '灌篮高手 / 排球少年 那种动感燃系',
    swatchClass: 'bg-gradient-to-br from-orange-400 to-red-500',
    allowsDenseInk: false,
    basePrompt: `Modern sports manga style, like Haikyuu!!, Kuroko no Basket, or Blue Lock. Dynamic action with confident clean inking, dramatic foreshortened poses, intense determined expressions. Speed lines used PURPOSEFULLY — radiating from a single focal point, not scattered. Sweat drops and motion effects with crisp clean lines. Backgrounds simplified to focus attention on the characters. Keep faces and skin mostly white — let the body language carry the energy.`,
  },
  {
    id: 'scifiMecha',
    displayName: '科幻机甲风',
    subtitle: '攻壳机动队 / AKIRA 那种赛博机械感',
    swatchClass: 'bg-gradient-to-b from-indigo-900 to-slate-900',
    allowsDenseInk: false,
    basePrompt: `Detailed sci-fi mecha manga style, like Ghost in the Shell, AKIRA, or modern Mobile Suit Gundam manga. Mechanical and architectural elements drawn with precise ruler-clean lines and accurate perspective. Characters with clean sharp inking, mature stylized proportions. Use screen tones thoughtfully on metal surfaces and lighting gradients. Keep human skin/faces relatively clean. Cyberpunk or hard-sci-fi atmosphere through composition, not noisy textures.`,
  },
  {
    id: 'horrorJunjiIto',
    displayName: '悬疑氛围风',
    subtitle: 'Monster / 死亡笔记 那种紧张心理悬疑感（非暴力）',
    swatchClass: 'bg-gradient-to-b from-zinc-600 to-zinc-900',
    allowsDenseInk: true,
    basePrompt: `Atmospheric mystery-thriller manga style, in the vein of Naoki Urasawa's Monster and 20th Century Boys, or Death Note. Dense but precise and CONTROLLED crosshatching for dramatic shadow — every stroke deliberate, never sketchy. Strong cinematic chiaroscuro: deep solid blacks against crisp clean whites. Tension comes from COMPOSITION and LIGHTING — long shadows, off-kilter camera angles, half-lit faces, fog, empty corridors, silhouettes — NOT from violent or graphic imagery.

STRICT CONTENT GUARDRAILS (always honor these):
- NO blood, NO wounds, NO injury, NO gore.
- NO monsters, NO body horror, NO disfigurement, NO weapons drawn aggressively.
- NO depictions of death or harm.
- Keep all characters fully clothed, intact, and unharmed.
- The mood is suspenseful and psychological, like a detective thriller, not a horror movie.`,
  },
] as const

/** 通过 id 拿到风格定义。找不到时返回 undefined。 */
export function getMangaStyle(id: MangaStyleId): MangaStyle | undefined {
  return MANGA_STYLES.find((s) => s.id === id)
}

/**
 * 根据彩色/黑白模式，把"风格 prompt + 全局清爽规则 + 颜色指令"拼到一起。
 * 跟 iOS 端 MangaStyle.effectivePrompt(isColor:) 完全一致。
 */
export function effectivePrompt(style: MangaStyle, isColor: boolean): string {
  const cleanRule = style.allowsDenseInk ? '' : '\n\n' + GLOBAL_CLEAN_INK_RULE

  if (isColor) {
    return `COLOR MODE OVERRIDE — RENDER IN FULL COLOR:
Render this page as a FULL-COLOR manga illustration with vivid, harmonious colors, natural skin tones, atmospheric lighting, and clean cel-shading. Polished anime/manga color palette. IGNORE any "black and white", "no color", "monochrome", "screen tone only", or "pure ink" instructions in the style guide below — those are overridden by this full-color directive. Keep ink linework strong, clean, and confident.

STYLE GUIDE:
${style.basePrompt}${cleanRule}`
  }

  return `COLOR MODE OVERRIDE — PURE BLACK AND WHITE:
Pure black-and-white manga ink art. No colors. Solid blacks for shadow shapes, screen-tone halftone dots used sparingly and deliberately. Follow the style guide below.

STYLE GUIDE:
${style.basePrompt}${cleanRule}`
}
