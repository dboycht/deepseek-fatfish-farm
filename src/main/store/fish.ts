import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { shell } from 'electron'
import { dirSize, ensureDir, pathExists, readJSON, rmrf, writeJSON } from '../util/fsx'
import { id } from '../util/ids'
import { flavorFromSeed, levelFromExp, personaFromSeed, randomSeed } from '@shared/persona'
import type { ChatMeta, FishProfile, FishStats, FishSummary } from '@shared/types'
import { loadConfig } from '../config'

/**
 * 一只肥鱼 = 鱼塘目录下的一个独立文件夹：
 *   <pond>/<fishId>/fish.json          身份、性格、状态
 *   <pond>/<fishId>/chats/*.json.gz    会话（gzip）
 *   <pond>/<fishId>/chats/index.json   会话索引（明文小文件，供列表秒开）
 *   <pond>/<fishId>/memory/*.json.gz   压缩记忆卡片
 *   <pond>/<fishId>/media/*            图片与缩略图
 */

export function fishDir(root: string, fishId: string): string {
  return join(root, fishId)
}

export function profileFile(root: string, fishId: string): string {
  return join(fishDir(root, fishId), 'fish.json')
}

export function chatsDir(root: string, fishId: string): string {
  return join(fishDir(root, fishId), 'chats')
}

export function memoryDir(root: string, fishId: string): string {
  return join(fishDir(root, fishId), 'memory')
}

export function mediaDir(root: string, fishId: string): string {
  return join(fishDir(root, fishId), 'media')
}

export async function pondRoot(): Promise<string> {
  const cfg = await loadConfig()
  return cfg.pondRoot
}

export async function ensurePond(root: string): Promise<void> {
  await ensureDir(root)
}

export function freshStats(): FishStats {
  return {
    mood: 72,
    hunger: 35,
    tokens: 0,
    meals: 0,
    chats: 0,
    memories: 0,
    level: 1,
    exp: 0,
    lastSeen: Date.now()
  }
}

export async function createFish(
  root: string,
  name: string,
  opts: { hue?: number; tagline?: string; seed?: number } = {}
): Promise<FishProfile> {
  const seed = opts.seed ?? randomSeed()
  const fishId = id(12)
  const dir = fishDir(root, fishId)
  await ensureDir(join(dir, 'chats'))
  await ensureDir(join(dir, 'memory'))
  await ensureDir(join(dir, 'media'))
  const profile: FishProfile = {
    v: 1,
    id: fishId,
    name: name.trim().slice(0, 24) || '大肥鱼',
    tagline: opts.tagline?.trim().slice(0, 60) || '一只住在鱼塘里的蓝色大肥鱼',
    created: Date.now(),
    updated: Date.now(),
    hue: opts.hue ?? Math.round(190 + Math.random() * 40),
    seed,
    flavor: flavorFromSeed(seed, name.trim() || '大肥鱼'),
    persona: personaFromSeed(seed),
    stats: freshStats()
  }
  await writeJSON(profileFile(root, fishId), profile, true)
  await writeJSON(join(chatsDir(root, fishId), 'index.json'), { chats: [] }, false)
  return profile
}

export async function readProfile(root: string, fishId: string): Promise<FishProfile | null> {
  const p = profileFile(root, fishId)
  if (!(await pathExists(p))) return null
  return readJSON<FishProfile | null>(p, null)
}

export async function writeProfile(root: string, profile: FishProfile): Promise<void> {
  profile.updated = Date.now()
  await writeJSON(profileFile(root, profile.id), profile, true)
}

export async function listChatMetas(root: string, fishId: string): Promise<ChatMeta[]> {
  const idx = await readJSON<{ chats: ChatMeta[] }>(join(chatsDir(root, fishId), 'index.json'), { chats: [] })
  return [...idx.chats].sort((a, b) => b.updated - a.updated)
}

export async function writeChatMetas(root: string, fishId: string, metas: ChatMeta[]): Promise<void> {
  await writeJSON(join(chatsDir(root, fishId), 'index.json'), { chats: metas }, false)
}

export async function listFish(root: string): Promise<FishSummary[]> {
  let names: string[] = []
  try {
    names = await fs.readdir(root)
  } catch {
    return []
  }
  const out: FishSummary[] = []
  for (const name of names) {
    const dir = join(root, name)
    const profile = await readProfile(root, name)
    if (!profile) continue
    const metas = await listChatMetas(root, name)
    out.push({
      ...profile,
      dir,
      bytes: await dirSize(dir),
      chats: metas.length,
      lastChat: metas[0] ? { id: metas[0].id, title: metas[0].title, updated: metas[0].updated } : undefined
    })
  }
  return out.sort((a, b) => b.stats.lastSeen - a.stats.lastSeen)
}

export async function deleteFish(root: string, fishId: string): Promise<void> {
  const dir = fishDir(root, fishId)
  if (!(await pathExists(dir))) return
  try {
    await shell.trashItem(dir)
  } catch {
    await rmrf(dir)
  }
}

/* ------------------------------------------------------------------ *
 * 状态更新（带防抖，避免每说一句话都写盘）
 * ------------------------------------------------------------------ */

const profileCache = new Map<string, FishProfile>()
const pendingSave = new Map<string, NodeJS.Timeout>()

export async function cachedProfile(root: string, fishId: string): Promise<FishProfile | null> {
  const key = `${root}::${fishId}`
  const hit = profileCache.get(key)
  if (hit) return hit
  const p = await readProfile(root, fishId)
  if (p) profileCache.set(key, p)
  return p
}

export function invalidateProfile(fishId: string): void {
  for (const k of [...profileCache.keys()]) if (k.endsWith(`::${fishId}`)) profileCache.delete(k)
}

function scheduleSave(root: string, profile: FishProfile): void {
  const key = `${root}::${profile.id}`
  const t = pendingSave.get(key)
  if (t) clearTimeout(t)
  pendingSave.set(
    key,
    setTimeout(() => {
      pendingSave.delete(key)
      void writeProfile(root, profile)
    }, 600)
  )
}

/** 原子地更新肥鱼状态；fn 直接改传入对象 */
export async function patchStats(
  root: string,
  fishId: string,
  fn: (p: FishProfile) => void
): Promise<FishProfile | null> {
  const profile = await cachedProfile(root, fishId)
  if (!profile) return null
  fn(profile)
  profile.stats.level = levelFromExp(profile.stats.exp)
  profile.stats.lastSeen = Date.now()
  profile.updated = Date.now()
  scheduleSave(root, profile)
  return profile
}

export async function flushProfiles(): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const [key, t] of pendingSave) {
    clearTimeout(t)
    const profile = profileCache.get(key)
    if (profile) {
      const root = key.split('::')[0]
      jobs.push(writeProfile(root, profile))
    }
  }
  pendingSave.clear()
  await Promise.all(jobs)
}
