import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { nativeImage } from 'electron'
import { ensureDir, pathExists, readGzJSON, writeGzJSON } from '../util/fsx'
import { id } from '../util/ids'
import { mediaDir } from './fish'
import type { MediaMeta } from '@shared/types'

/**
 * 素材仓库。省空间策略：
 *  - 缩略图统一转 JPEG（最长边 768），列表与上下文都用缩略图；
 *  - 原图超过 2.5MB 时不留原文件，改存最长边 1600 的 JPEG；
 *  - 其余情况保留原文件以便用户另存为。
 */

const THUMB_MAX = 768
const KEEP_ORIGINAL_UNDER = 2.5 * 1024 * 1024
const BIG_MAX = 1600

function indexPath(root: string, fishId: string): string {
  return join(mediaDir(root, fishId), 'index.json.gz')
}

export async function loadIndex(root: string, fishId: string): Promise<MediaMeta[]> {
  const data = await readGzJSON<{ items: MediaMeta[] }>(indexPath(root, fishId), { items: [] })
  return data.items ?? []
}

async function saveIndex(root: string, fishId: string, items: MediaMeta[]): Promise<void> {
  await writeGzJSON(indexPath(root, fishId), { items })
}

export async function importPaths(root: string, fishId: string, paths: string[]): Promise<MediaMeta[]> {
  const out: MediaMeta[] = []
  for (const p of paths) {
    try {
      const buf = await fs.readFile(p)
      out.push(await importBuffer(root, fishId, buf, basename(p)))
    } catch {
      /* 跳过读不了的文件 */
    }
  }
  return out
}

export async function importBuffer(
  root: string,
  fishId: string,
  buf: Buffer,
  name: string,
  kind: MediaMeta['kind'] = 'pic'
): Promise<MediaMeta> {
  const dir = mediaDir(root, fishId)
  await ensureDir(dir)
  const mediaId = id(12)
  let ext = (extname(name).replace('.', '') || 'png').toLowerCase()
  if (ext === 'jpeg') ext = 'jpg'

  const img = nativeImage.createFromBuffer(buf)
  let w = 0
  let h = 0
  let thumb: string | undefined
  let src: string | undefined

  if (!img.isEmpty()) {
    const size = img.getSize()
    w = size.width
    h = size.height
    const scale = Math.min(1, THUMB_MAX / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const thumbImg = scale < 1 ? img.resize({ width: tw, height: th, quality: 'good' }) : img
    thumb = `${mediaId}_t.jpg`
    await fs.writeFile(join(dir, thumb), thumbImg.toJPEG(84))

    if (buf.byteLength <= KEEP_ORIGINAL_UNDER && ext !== 'gif') {
      src = `${mediaId}.${ext}`
      await fs.writeFile(join(dir, src), buf)
    } else if (ext !== 'gif') {
      const bigScale = Math.min(1, BIG_MAX / Math.max(w, h))
      const bw = Math.max(1, Math.round(w * bigScale))
      const bh = Math.max(1, Math.round(h * bigScale))
      const big = bigScale < 1 ? img.resize({ width: bw, height: bh, quality: 'good' }) : img
      src = `${mediaId}.jpg`
      await fs.writeFile(join(dir, src), big.toJPEG(88))
    } else {
      // GIF 动图：保留原文件，缩略图直接用浏览器解码
      src = `${mediaId}.gif`
      await fs.writeFile(join(dir, src), buf)
      thumb = src
    }
  } else {
    // 非图片或无法解码：原样保存
    src = `${mediaId}.${ext}`
    await fs.writeFile(join(dir, src), buf)
    thumb = src
  }

  const meta: MediaMeta = {
    id: mediaId,
    name: name.slice(0, 120),
    ext,
    bytes: buf.byteLength,
    w,
    h,
    thumb,
    src,
    kind,
    created: Date.now()
  }
  const items = await loadIndex(root, fishId)
  items.push(meta)
  await saveIndex(root, fishId, items)
  return meta
}

export async function getMedia(root: string, fishId: string, mediaId: string): Promise<MediaMeta | null> {
  const items = await loadIndex(root, fishId)
  return items.find((m) => m.id === mediaId) ?? null
}

export async function getMany(root: string, fishId: string, ids: string[]): Promise<MediaMeta[]> {
  const items = await loadIndex(root, fishId)
  return ids.map((i) => items.find((m) => m.id === i)).filter((m): m is MediaMeta => Boolean(m))
}

export async function setCaption(root: string, fishId: string, mediaId: string, caption: string): Promise<void> {
  const items = await loadIndex(root, fishId)
  const item = items.find((m) => m.id === mediaId)
  if (!item) return
  item.caption = caption.slice(0, 400)
  item.captionAt = Date.now()
  await saveIndex(root, fishId, items)
}

export async function resolveFile(
  root: string,
  fishId: string,
  mediaId: string,
  variant: 'thumb' | 'src' = 'thumb'
): Promise<string | null> {
  const meta = await getMedia(root, fishId, mediaId)
  if (!meta) return null
  const name = variant === 'thumb' ? (meta.thumb ?? meta.src) : (meta.src ?? meta.thumb)
  if (!name) return null
  const p = join(mediaDir(root, fishId), name)
  return (await pathExists(p)) ? p : null
}

/** 给视觉模型用的 base64（用缩略图，省 token 也省内存） */
export async function toDataUrl(root: string, fishId: string, mediaId: string): Promise<string | null> {
  const p = await resolveFile(root, fishId, mediaId, 'thumb')
  if (!p) return null
  try {
    const buf = await fs.readFile(p)
    const ext = extname(p).replace('.', '').toLowerCase()
    const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : `image/${ext}`
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

export async function mediaBytes(root: string, fishId: string, ids: string[]): Promise<number> {
  const items = await getMany(root, fishId, ids)
  return items.reduce((a, m) => a + m.bytes, 0)
}

export async function allMedia(root: string, fishId: string): Promise<MediaMeta[]> {
  const items = await loadIndex(root, fishId)
  return items.sort((a, b) => b.created - a.created)
}
