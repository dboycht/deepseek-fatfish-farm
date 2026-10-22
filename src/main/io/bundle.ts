import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { ensureDir, pathExists, readGzJSON, writeGzJSON } from '../util/fsx'
import { id } from '../util/ids'
import {
  createFish,
  chatsDir,
  listChatMetas,
  mediaDir,
  memoryDir,
  readProfile,
  writeChatMetas,
  writeProfile
} from '../store/fish'
import { readChat } from '../store/chat'
import { loadCards, replaceCards } from '../store/memory'
import { loadIndex } from '../store/media'
import type { ChatFile, ImportResult, MediaMeta, MemoryCard } from '@shared/types'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/**
 * 记忆与肥鱼的导入导出。
 *
 *  - `.fatfish`：整只肥鱼（档案 + 会话 + 记忆卡片 + 图片）
 *  - `.fatmem` ：只打包记忆（卡片 + 被引用到的会话片段 + 引用到的图）
 * 两种都是 gzip 压缩的单个 JSON，体积小、可手动备份、可跨机器搬。
 * 导出包里**不含 API Key**。
 */

interface BundleMedia {
  meta: MediaMeta
  files: { name: string; data: string }[]
}

interface Bundle {
  format: 'fatfish-bundle'
  v: number
  kind: 'fish' | 'memory'
  app: string
  exportedAt: number
  profile?: Record<string, unknown>
  chats?: ChatFile[]
  cards?: MemoryCard[]
  media?: BundleMedia[]
  memoryState?: Record<string, unknown>
}

async function readMediaFiles(root: string, fishId: string, metas: MediaMeta[]): Promise<BundleMedia[]> {
  const dir = mediaDir(root, fishId)
  const out: BundleMedia[] = []
  for (const meta of metas) {
    const names = [...new Set([meta.thumb, meta.src].filter((n): n is string => Boolean(n)))]
    const files: { name: string; data: string }[] = []
    for (const name of names) {
      const p = join(dir, name)
      if (!(await pathExists(p))) continue
      try {
        files.push({ name, data: (await fs.readFile(p)).toString('base64') })
      } catch {
        /* 跳过读不到的文件 */
      }
    }
    if (files.length) out.push({ meta, files })
  }
  return out
}

export async function exportFish(root: string, fishId: string, outPath: string): Promise<number> {
  const profile = await readProfile(root, fishId)
  if (!profile) throw new Error('找不到这只肥鱼')
  const metas = await listChatMetas(root, fishId)
  const chats: ChatFile[] = []
  for (const m of metas) {
    const c = await readChat(root, fishId, m.id)
    if (c) chats.push(c)
  }
  const cards = await loadCards(root, fishId)
  const media = await readMediaFiles(root, fishId, await loadIndex(root, fishId))
  const memoryState = await readGzJSON<Record<string, unknown>>(join(memoryDir(root, fishId), 'state.json'), {})
  const bundle: Bundle = {
    format: 'fatfish-bundle',
    v: 1,
    kind: 'fish',
    app: 'deepseek-fatfish-farm',
    exportedAt: Date.now(),
    profile: profile as unknown as Record<string, unknown>,
    chats,
    cards,
    media,
    memoryState
  }
  const packed = await gzipAsync(Buffer.from(JSON.stringify(bundle), 'utf8'), { level: 9 })
  await fs.writeFile(outPath, packed)
  return packed.byteLength
}

export async function exportMemory(root: string, fishId: string, outPath: string): Promise<number> {
  const profile = await readProfile(root, fishId)
  if (!profile) throw new Error('找不到这只肥鱼')
  const cards = await loadCards(root, fishId)
  const srcIds = new Set(cards.flatMap((c) => c.src))
  const imgIds = new Set(cards.flatMap((c) => c.img ?? []))

  const metas = await listChatMetas(root, fishId)
  const chats: ChatFile[] = []
  for (const m of metas) {
    const c = await readChat(root, fishId, m.id)
    if (!c) continue
    const kept = c.msgs.filter((msg) => srcIds.has(msg.id))
    if (kept.length) chats.push({ ...c, msgs: kept, count: kept.length })
  }
  const allMedia = await loadIndex(root, fishId)
  const media = await readMediaFiles(
    root,
    fishId,
    allMedia.filter((m) => imgIds.has(m.id))
  )
  const memoryState = await readGzJSON<Record<string, unknown>>(join(memoryDir(root, fishId), 'state.json'), {})
  const bundle: Bundle = {
    format: 'fatfish-bundle',
    v: 1,
    kind: 'memory',
    app: 'deepseek-fatfish-farm',
    exportedAt: Date.now(),
    profile: { id: profile.id, name: profile.name } as unknown as Record<string, unknown>,
    chats,
    cards,
    media,
    memoryState
  }
  const packed = await gzipAsync(Buffer.from(JSON.stringify(bundle), 'utf8'), { level: 9 })
  await fs.writeFile(outPath, packed)
  return packed.byteLength
}

export async function readBundle(file: string): Promise<Bundle> {
  const packed = await fs.readFile(file)
  const raw = await gunzipAsync(packed)
  const bundle = JSON.parse(raw.toString('utf8')) as Bundle
  if (bundle?.format !== 'fatfish-bundle') throw new Error('这个文件不是肥鱼记忆包')
  return bundle
}

async function writeBundleMedia(root: string, fishId: string, media: BundleMedia[] | undefined): Promise<MediaMeta[]> {
  const dir = mediaDir(root, fishId)
  await ensureDir(dir)
  const existing = await loadIndex(root, fishId)
  const byId = new Map(existing.map((m) => [m.id, m]))
  for (const item of media ?? []) {
    for (const f of item.files) {
      await fs.writeFile(join(dir, f.name), Buffer.from(f.data, 'base64'))
    }
    byId.set(item.meta.id, item.meta)
  }
  const items = [...byId.values()]
  await writeGzJSON(join(dir, 'index.json.gz'), { items })
  return items
}

async function writeBundleChats(root: string, fishId: string, chats: ChatFile[] | undefined, suffix = ''): Promise<void> {
  await ensureDir(chatsDir(root, fishId))
  const metas = await listChatMetas(root, fishId)
  for (const chat of chats ?? []) {
    const existing = await readChat(root, fishId, chat.id)
    if (existing) {
      const have = new Set(existing.msgs.map((m) => m.id))
      const add = chat.msgs.filter((m) => !have.has(m.id))
      existing.msgs.push(...add)
      await writeGzJSON(join(chatsDir(root, fishId), `${chat.id}.json.gz`), existing)
      const idx = metas.findIndex((m) => m.id === chat.id)
      const meta = { ...chat, msgs: existing.msgs, count: existing.msgs.length, updated: Date.now() }
      const metaOut = { id: meta.id, title: meta.title, created: meta.created, updated: meta.updated, count: meta.count }
      if (idx >= 0) metas[idx] = metaOut
      else metas.push(metaOut)
    } else {
      const copy: ChatFile = { ...chat, title: `${chat.title}${suffix}`.slice(0, 28) }
      await writeGzJSON(join(chatsDir(root, fishId), `${copy.id}.json.gz`), copy)
      metas.push({
        id: copy.id,
        title: copy.title,
        created: copy.created,
        updated: copy.updated,
        count: copy.msgs.length
      })
    }
  }
  metas.sort((a, b) => b.updated - a.updated)
  await writeChatMetas(root, fishId, metas)
}

export async function importBundle(root: string, file: string, targetFishId?: string): Promise<ImportResult> {
  const bundle = await readBundle(file)

  if (bundle.kind === 'fish') {
    const src = (bundle.profile ?? {}) as Record<string, unknown>
    const name = String(src.name ?? '大肥鱼')
    const profile = await createFish(root, name, {
      hue: typeof src.hue === 'number' ? src.hue : undefined,
      tagline: typeof src.tagline === 'string' ? src.tagline : undefined
    })
    // 继承原鱼的灵魂，但换上新 id（避免覆盖现有鱼）
    const merged = {
      ...profile,
      persona: (src.persona as typeof profile.persona) ?? profile.persona,
      flavor: (src.flavor as typeof profile.flavor) ?? profile.flavor,
      seed: typeof src.seed === 'number' ? src.seed : profile.seed,
      note: typeof src.note === 'string' ? src.note : undefined,
      stats: { ...profile.stats, ...((src.stats as Record<string, number>) ?? {}) },
      created: typeof src.created === 'number' ? src.created : profile.created
    }
    await writeProfile(root, merged)
    await writeBundleMedia(root, profile.id, bundle.media)
    await writeBundleChats(root, profile.id, bundle.chats)
    await replaceCards(root, profile.id, bundle.cards ?? [])
    if (bundle.memoryState) {
      await writeGzJSON(join(memoryDir(root, profile.id), 'state.json'), bundle.memoryState)
    }
    return { fishId: profile.id, name: merged.name, mode: 'fish' }
  }

  // 记忆包：合并进指定肥鱼
  const fishId = targetFishId
  if (!fishId) throw new Error('导入记忆需要先选一只肥鱼')
  const profile = await readProfile(root, fishId)
  if (!profile) throw new Error('找不到要导入的肥鱼')
  await writeBundleMedia(root, fishId, bundle.media)
  await writeBundleChats(root, fishId, bundle.chats, '（导入的记忆）')
  const existing = await loadCards(root, fishId)
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '').slice(0, 90)
  const seen = new Set(existing.map((c) => norm(c.text)))
  const merged = [...existing]
  for (const c of bundle.cards ?? []) {
    if (seen.has(norm(c.text))) continue
    seen.add(norm(c.text))
    merged.push({ ...c, id: c.id || id(10) })
  }
  await replaceCards(root, fishId, merged)
  return { fishId, name: profile.name, mode: 'memory' }
}
