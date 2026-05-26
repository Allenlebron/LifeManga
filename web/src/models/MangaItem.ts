// 数据模型。从 iOS 端 MangaItem.swift 1:1 翻译。
//
// 设计决策（跟 Swift 端的差异）：
// 1. UUID 用 string (crypto.randomUUID() 生成的 v4 UUID 字符串) 而不是对象。
//    JSON-friendly、IndexedDB-friendly、跟 Worker 通信也简单。
// 2. Date 用 number (epoch ms) 而不是 Date 对象。
//    避免序列化/反序列化时的边界 case，IndexedDB 也能直接索引。
// 3. 旧数据迁移逻辑 (CodingKeys.init from decoder) 这里没移植——
//    因为 Web 端是全新数据，不存在"旧版本数据兼容"问题。

import type { MangaStyleId } from './MangaStyle'

// MARK: - 工程

export interface MangaProject {
  id: string
  name: string
  /** epoch ms */
  createdAt: number
  /** epoch ms */
  updatedAt: number
  /** 用作封面的 MangaItem.id（可选） */
  coverItemId?: string
  /** 备注 / 故事大纲（可选） */
  notes?: string
}

// MARK: - 故事模式：剧本结构

export interface MangaPanel {
  description: string
  dialogue?: string
  dialogueJa?: string
  narration?: string
  narrationJa?: string
  sfx?: string
}

export interface MangaStoryScript {
  title: string
  synopsis: string
  panels: MangaPanel[]
}

// MARK: - 一次生成的结果

export interface MangaItem {
  id: string
  projectId: string
  /** epoch ms */
  createdAt: number
  style: MangaStyleId
  /** 输入参考图的本地标识符（IndexedDB blob key 或 R2 path，待 Weekend 4 决定） */
  inputImageNames: string[]
  /** 生成结果图的本地标识符 */
  outputImageNames: string[]
  userPrompt?: string
  storyScript?: MangaStoryScript
  isFavorite: boolean
}

// MARK: - 任务日志（仅运行时内存，不持久化）

export type JobLogLevel = 'info' | 'success' | 'warning' | 'error' | 'detail'

export interface JobLogEntry {
  id: string
  /** epoch ms */
  timestamp: number
  level: JobLogLevel
  message: string
}

// MARK: - 角色库

export interface CharacterView {
  id: string
  /** "正面 / 背面 / 侧面 / 战斗姿势" 等 */
  label: string
  /** 本地存储的图片标识符 */
  imageName: string
  /** epoch ms */
  createdAt: number
}

export interface Character {
  id: string
  name: string
  /** 性格 / 背景设定 */
  bio?: string
  /** 用户上传的真人参考照片（仅用于生成；不会被打包到漫画里） */
  sourcePhotoName?: string
  views: CharacterView[]
  /** epoch ms */
  createdAt: number
  /** epoch ms */
  updatedAt: number
}

// MARK: - 工厂函数

/** 创建一个新工程，自动填 id / 时间戳 */
export function newProject(name: string, notes?: string): MangaProject {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    notes,
  }
}

/** 创建一个新角色，自动填 id / 时间戳 / 空 views */
export function newCharacter(name: string, bio?: string): Character {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    bio,
    views: [],
    createdAt: now,
    updatedAt: now,
  }
}
