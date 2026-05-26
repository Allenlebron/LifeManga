// 角色设定稿艺术风格。从 iOS 端 MangaItem.swift 的 CharacterArtStyle enum 1:1 翻译。
//
// 注意：避免提及具体品牌 (Marvel/DC)、武打作品、儿童相关词汇等可能触发 OpenAI 安全系统的词。

export type CharacterArtStyleId =
  | 'jpAnime'
  | 'usComics'
  | 'krManhwa'
  | 'kawaii'
  | 'chibi'
  | 'render3D'
  | 'semiReal'
  | 'watercolor'
  | 'pixelArt'

export interface CharacterArtStyle {
  id: CharacterArtStyleId
  displayName: string
  subtitle: string
  prompt: string
}

export const CHARACTER_ART_STYLES: readonly CharacterArtStyle[] = [
  {
    id: 'jpAnime',
    displayName: '日漫风',
    subtitle: '京阿尼 / 新海诚 现代动画风',
    prompt: `Modern Japanese anime/manga character illustration style. Clean cel-shaded coloring with crisp confident lineart. Large expressive anime eyes with highlights, stylized hair with shine, vibrant clean color palette. Polished modern TV-anime production aesthetic.`,
  },
  {
    id: 'usComics',
    displayName: '美漫风',
    subtitle: 'Marvel / DC 美式漫画',
    prompt: `Modern American graphic-novel character illustration style. Bold confident inking with strong line-weight variation. Realistic body proportions with slightly stylized features. Strong cel-shading with dramatic but tasteful shadows. Polished, painterly, professional comic illustration aesthetic. (No specific franchise; original character design.)`,
  },
  {
    id: 'krManhwa',
    displayName: '韩漫风',
    subtitle: '顶级 webtoon · 精致细腻',
    prompt: `Modern Korean webtoon character illustration style — polished glossy digital illustration with clean painterly cel-shading. Realistic body proportions with softly anime-influenced features, beautifully detailed expressive eyes, sharp confident lineart, vibrant modern color palette, smooth gradient shading on skin and hair. High-production-value webtoon aesthetic with cinematic lighting and dramatic poses. Original character design.`,
  },
  {
    id: 'kawaii',
    displayName: '可爱风',
    subtitle: '粉嫩、大眼、软萌',
    prompt: `Soft kawaii illustration style with a pastel palette (pinks, peaches, lavenders, mint). Large sparkly round eyes, simplified soft features, gentle rounded shapes, dreamy peaceful atmosphere. Cute mascot-friendly aesthetic. (Adult character; cute style only — keep adult facial structure and proportions.)`,
  },
  {
    id: 'chibi',
    displayName: 'Q 版',
    subtitle: '2~3 头身 SD 缩小可爱',
    prompt: `Stylized chibi / super-deformed cartoon ART STYLE applied to an ADULT character — playfully exaggerated proportions (about 3-4 heads tall), simplified rounded body, large expressive eyes, simplified hands. IMPORTANT: this is an adult character rendered in chibi STYLE (like an adult mascot or comedic short-form animation spinoff). NOT a depiction of a child, baby, or minor — keep the adult outfit, adult bearing, and any adult props (work bag, glasses, etc) visible. Cute, comedic cartoon aesthetic.`,
  },
  {
    id: 'render3D',
    displayName: '3D 渲染',
    subtitle: '皮克斯 / 平行宇宙 3D 渲染',
    prompt: `Modern 3D-animated film character illustration style — soft realistic lighting with subtle sub-surface skin scattering, painterly fabric textures, stylized but rendered look, gentle depth of field. Polished feature-film CG aesthetic. Original character design (no specific franchise).`,
  },
  {
    id: 'semiReal',
    displayName: '半写实',
    subtitle: '半写实插画感',
    prompt: `Semi-realistic illustration style halfway between anime and realism. Realistic shading and proportions with softly anime-influenced features. Smooth realistic skin shading, detailed expressive eyes, stylized hair. Polished modern webtoon / character-portrait illustration aesthetic.`,
  },
  {
    id: 'watercolor',
    displayName: '水彩风',
    subtitle: '水彩晕染 + 纸纹',
    prompt: `Traditional watercolor illustration style. Soft loose washes of color, organic blooming edges, visible paper texture, painterly imperfection. Controlled detail in the face with looser strokes elsewhere. Romantic, gentle, hand-painted feel. Studio-Ghibli-inspired concept-art aesthetic.`,
  },
  {
    id: 'pixelArt',
    displayName: '像素风',
    subtitle: '16-bit JRPG / 复古游戏立绘',
    prompt: `16-bit JRPG pixel-art character illustration style. Clean visible square pixels, limited vivid retro color palette, color blocking with deliberate dithering for shading. Distinct chunky pixel shapes for hair, eyes, and clothing. SNES / Game Boy Advance era role-playing game character portrait aesthetic. Render every element (character, callouts, expressions, items) in pixel-art form with a clearly visible pixel grid. Do NOT smooth the pixels into a normal illustration.`,
  },
] as const

export function getCharacterArtStyle(
  id: CharacterArtStyleId,
): CharacterArtStyle | undefined {
  return CHARACTER_ART_STYLES.find((s) => s.id === id)
}
