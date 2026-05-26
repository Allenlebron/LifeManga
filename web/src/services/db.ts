// IndexedDB 持久化层。用 dexie 包一下原生 IndexedDB API。
//
// schema 设计：
// - projects 主键 id (string UUID), 索引 name + updatedAt 方便后续按时间倒序拉
// - mangas   主键 id (string UUID), 索引 projectId / createdAt / style / isFavorite
//            (跨工程查"我的所有收藏"或"按风格筛选历史"都靠这几个 secondary index)
// - characters 主键 id (string UUID), 索引 name + updatedAt
//
// `&` 前缀代表 unique primary key, 不带前缀的字段是普通 secondary index。

import Dexie, { type Table } from 'dexie'
import type { Character, MangaItem, MangaProject } from '../models/MangaItem'
import type { MangaStyleId } from '../models/MangaStyle'
import { newProject } from '../models/MangaItem'

export class LifeMangaDB extends Dexie {
  projects!: Table<MangaProject, string>
  mangas!: Table<MangaItem, string>
  characters!: Table<Character, string>

  constructor() {
    super('LifeMangaDB')
    this.version(1).stores({
      projects: '&id, name, updatedAt',
      mangas: '&id, projectId, createdAt, style, isFavorite',
      characters: '&id, name, updatedAt',
    })
  }
}

export const db = new LifeMangaDB()

/**
 * 确保有一个默认工程存在。第一次启动 App 时调用。
 * 返回该工程的 id。
 */
export async function ensureDefaultProject(): Promise<string> {
  const existing = await db.projects.toArray()
  if (existing.length > 0) {
    return existing[0].id
  }
  const proj = newProject('我的第一个工程', '默认工程，用来放还没归类的作品')
  await db.projects.add(proj)
  return proj.id
}

/**
 * 给开发期用的 "塞 5 条假数据" 按钮调用。
 * 写入 1 个工程 + 5 条 manga item，验证整个 IndexedDB 读写闭环工作。
 */
export async function seedFakeData(): Promise<{ projectId: string; mangaCount: number }> {
  // 清掉旧数据，每次按钮都从头来
  await db.mangas.clear()
  await db.projects.clear()
  await db.characters.clear()

  const proj = newProject('演示工程 (假数据)', 'Weekend 2 验证 IndexedDB 用')
  await db.projects.add(proj)

  const styles: MangaStyleId[] = [
    'shonenJump',
    'sliceOfLife',
    'darkSeinen',
    'chibi4Koma',
    'sportsHotBlooded',
  ]
  const userPrompts = [
    '主角戴墨镜，在天台上眺望城市',
    '雨天的便利店门口，两个高中生分享一把伞',
    '地下停车场，紧张对峙的氛围',
    '咖啡店里聊天的两只小猫，超萌',
    '篮球比赛最后 3 秒，全场屏息',
  ]

  const now = Date.now()
  const items: MangaItem[] = styles.map((style, i) => ({
    id: crypto.randomUUID(),
    projectId: proj.id,
    // 让每条数据时间戳错开 1 分钟，按时间倒序看是 5,4,3,2,1
    createdAt: now - i * 60_000,
    style,
    inputImageNames: [`fake-input-${i}.jpg`],
    outputImageNames: [`fake-output-${i}.jpg`],
    userPrompt: userPrompts[i],
    isFavorite: i === 0,
  }))

  await db.mangas.bulkAdd(items)

  return { projectId: proj.id, mangaCount: items.length }
}

/**
 * 读所有 manga item，按 createdAt 倒序返回（最新的在前）。
 */
export async function listMangaItems(): Promise<MangaItem[]> {
  return await db.mangas.orderBy('createdAt').reverse().toArray()
}

/** 读所有工程，按 updatedAt 倒序。 */
export async function listProjects(): Promise<MangaProject[]> {
  return await db.projects.orderBy('updatedAt').reverse().toArray()
}
