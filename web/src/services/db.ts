// IndexedDB 持久化层。dexie 包一下原生 IndexedDB API。
//
// schema 设计 (v2):
// - projects   主键 id (string UUID), 索引 name + updatedAt
// - mangas     主键 id (string UUID), 索引 projectId / createdAt / style / isFavorite
// - characters 主键 id (string UUID), 索引 name + updatedAt
// - images     主键 id (string UUID), value 是 Blob (PNG/JPEG bytes)
//                MangaItem.outputImageNames 存 images 表的 id, 不是文件路径
//
// version 2 比 v1 加了 images 表。dexie 自动处理迁移 (空表加进去, 老数据不动)。

import Dexie, { type Table } from 'dexie'
import type { Character, MangaItem, MangaProject } from '../models/MangaItem'
import type { MangaStyleId } from '../models/MangaStyle'
import { newProject } from '../models/MangaItem'

interface StoredImage {
  id: string
  blob: Blob
  /** epoch ms */
  createdAt: number
  /** 多大 (bytes), 方便 storage 统计 */
  byteSize: number
}

export class LifeMangaDB extends Dexie {
  projects!: Table<MangaProject, string>
  mangas!: Table<MangaItem, string>
  characters!: Table<Character, string>
  images!: Table<StoredImage, string>

  constructor() {
    super('LifeMangaDB')
    // v1: projects + mangas + characters
    this.version(1).stores({
      projects: '&id, name, updatedAt',
      mangas: '&id, projectId, createdAt, style, isFavorite',
      characters: '&id, name, updatedAt',
    })
    // v2: 加 images 表存 Blob
    this.version(2).stores({
      projects: '&id, name, updatedAt',
      mangas: '&id, projectId, createdAt, style, isFavorite',
      characters: '&id, name, updatedAt',
      images: '&id, createdAt',
    })
  }
}

export const db = new LifeMangaDB()

/**
 * 把一个 Blob 存进 images 表, 返回新 id。
 */
export async function saveImage(blob: Blob): Promise<string> {
  const id = crypto.randomUUID()
  await db.images.add({
    id,
    blob,
    createdAt: Date.now(),
    byteSize: blob.size,
  })
  return id
}

/**
 * 拿回 Blob (展示给 <img> 用)。找不到返回 null。
 */
export async function loadImageBlob(id: string): Promise<Blob | null> {
  const rec = await db.images.get(id)
  return rec?.blob ?? null
}

/**
 * 一次性把多张图从 Blob 拿到, 转成 object URL (用 URL.createObjectURL)。
 * 调用方负责在合适时机 URL.revokeObjectURL 释放, 否则会内存泄漏。
 *
 * 没找到的 imageName 在结果里对应位置是 null。
 */
export async function loadImageURLs(
  ids: string[],
): Promise<(string | null)[]> {
  return Promise.all(
    ids.map(async (id) => {
      const blob = await loadImageBlob(id)
      return blob ? URL.createObjectURL(blob) : null
    }),
  )
}

/**
 * 把一个 MangaItem + N 张输出 Blob 一起原子写入。
 * 返回写入的 MangaItem。
 */
export async function saveMangaWithImages(
  base: Omit<MangaItem, 'outputImageNames'>,
  outputBlobs: Blob[],
): Promise<MangaItem> {
  const imageIds: string[] = []
  return await db.transaction('rw', db.mangas, db.images, async () => {
    for (const blob of outputBlobs) {
      const id = crypto.randomUUID()
      await db.images.add({
        id,
        blob,
        createdAt: Date.now(),
        byteSize: blob.size,
      })
      imageIds.push(id)
    }
    const item: MangaItem = { ...base, outputImageNames: imageIds }
    await db.mangas.add(item)
    return item
  })
}

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
 * 写入 1 个工程 + 5 条 manga item, 验证整个 IndexedDB 读写闭环工作。
 *
 * 注意: 假数据没有真实 Blob, outputImageNames 为空。HistoryView 会显示色块占位。
 */
export async function seedFakeData(): Promise<{
  projectId: string
  mangaCount: number
}> {
  // 清掉旧数据, 每次按钮都从头来
  await db.mangas.clear()
  await db.projects.clear()
  await db.characters.clear()
  await db.images.clear()

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
    createdAt: now - i * 60_000,
    style,
    inputImageNames: [],
    outputImageNames: [],
    userPrompt: userPrompts[i],
    isFavorite: i === 0,
  }))

  await db.mangas.bulkAdd(items)
  return { projectId: proj.id, mangaCount: items.length }
}

/** 读所有 manga item, 按 createdAt 倒序返回 (最新的在前)。 */
export async function listMangaItems(): Promise<MangaItem[]> {
  return await db.mangas.orderBy('createdAt').reverse().toArray()
}

/** 读所有工程, 按 updatedAt 倒序。 */
export async function listProjects(): Promise<MangaProject[]> {
  return await db.projects.orderBy('updatedAt').reverse().toArray()
}

/** 计算 images 表占用的总字节数 (设置页给用户看)。 */
export async function imagesTotalBytes(): Promise<number> {
  const all = await db.images.toArray()
  return all.reduce((acc, x) => acc + x.byteSize, 0)
}
