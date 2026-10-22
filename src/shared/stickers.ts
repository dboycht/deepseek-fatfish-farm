import { STICKERS, STICKER_LABEL } from './persona'
import type { StickerItem, StickerPack } from './types'

/**
 * 贴纸包与贴纸指令的纯函数层。
 *
 * 模型可以输出：
 *   [[sticker:joy]]             使用已有贴纸（内置或用户包）
 *   [[sticker:need:委屈]]       想要一个当前没有的表情（会被记录成需求）
 *   [[fish:joy]]                兼容旧写法
 * 未知 id 也会被记录，方便之后用 GPT 批量补图。
 */

export const STICKER_ID_RE = /^[a-z][a-z0-9-]{1,31}$/
export const STICKER_FILE_RE = /\.(png|webp|gif|jpg|jpeg)$/i
export const MAX_STICKER_BYTES = 4 * 1024 * 1024

export function builtinStickerPack(): StickerPack {
  const items: StickerItem[] = STICKERS.map((name) => ({
    id: name,
    label: STICKER_LABEL[name] ?? name,
    file: '',
    tags: [STICKER_LABEL[name] ?? name],
    packId: 'builtin'
  }))
  return {
    id: 'builtin',
    name: '内置表情',
    version: '1.0.0',
    description: '随软件附带的 12 个基础表情（代码绘制）',
    builtin: true,
    items
  }
}

export interface StickerDirectives {
  cleaned: string
  /** 第一个可用的贴纸 id */
  sticker?: string
  /** model 明确要的新表情 */
  needs: string[]
  /** model 用了但当前不存在的 id */
  unknown: string[]
}

const DIRECTIVE_RE =
  /\[{1,2}\s*sticker:\s*([a-z0-9:_\-\u3400-\u9fff]+)\s*\]{1,2}|\[{1,2}\s*fish:\s*([a-z0-9\-\u3400-\u9fff]+)\s*\]{1,2}/gi

export function extractStickerDirectives(text: string, known: ReadonlySet<string>): StickerDirectives {
  let sticker: string | undefined
  const needs: string[] = []
  const unknown: string[] = []
  const cleaned = text.replace(DIRECTIVE_RE, (_m, a: string | undefined, b: string | undefined) => {
    const raw = String(a ?? b ?? '').toLowerCase()
    if (!raw) return ''
    if (raw.startsWith('need:')) {
      const key = normalizeWishKey(raw.slice(5))
      if (key) needs.push(key)
      return ''
    }
    if (known.has(raw)) {
      if (!sticker) sticker = raw
      return ''
    }
    const key = normalizeWishKey(raw)
    if (key) unknown.push(key)
    return ''
  })
  return {
    cleaned: cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    ...(sticker ? { sticker } : {}),
    needs: [...new Set(needs)],
    unknown: [...new Set(unknown)]
  }
}

/** 需求 key：保留中英文与短横线，方便直接交给 GPT 理解 */
export function normalizeWishKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export interface StickerManifestItem {
  id: string
  label: string
  file: string
  tags?: string[]
}

export interface StickerManifest {
  id: string
  name: string
  version: string
  author?: string
  license?: string
  description?: string
  items: StickerManifestItem[]
}

export interface ManifestValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  manifest?: StickerManifest
}

/**
 * 校验 manifest（不检查文件是否真的存在，那一步在主进程做）。
 * existingIds 是「内置 + 其它已安装包」的 id，避免全局冲突。
 */
export function validateStickerManifest(raw: unknown, existingIds: ReadonlySet<string>): ManifestValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['manifest.json 不是对象'], warnings }
  const o = raw as Record<string, unknown>

  const id = typeof o.id === 'string' ? o.id.trim().toLowerCase() : ''
  if (!STICKER_ID_RE.test(id)) errors.push('包 id 必须是 2~32 位小写字母/数字/短横线，且以字母开头')
  if (existingIds.has(id)) errors.push(`包 id「${id}」已经被内置或其它贴纸包占用`)

  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!name || name.length > 60) errors.push('name 必填，且不超过 60 字')

  const version = typeof o.version === 'string' && o.version.trim() ? o.version.trim() : '1.0.0'
  const itemsRaw = Array.isArray(o.items) ? o.items : []
  if (!itemsRaw.length) errors.push('items 不能为空')
  if (itemsRaw.length > 200) errors.push('一个包最多 200 张')

  const seen = new Set<string>()
  const items: StickerManifestItem[] = []
  itemsRaw.forEach((it, i) => {
    if (!it || typeof it !== 'object') {
      errors.push(`items[${i}] 不是对象`)
      return
    }
    const x = it as Record<string, unknown>
    const itemId = typeof x.id === 'string' ? x.id.trim().toLowerCase() : ''
    const label = typeof x.label === 'string' ? x.label.trim() : ''
    const file = typeof x.file === 'string' ? x.file.trim().replace(/\\/g, '/') : ''
    if (!STICKER_ID_RE.test(itemId)) errors.push(`items[${i}].id 不合法（${itemId || '空'}）`)
    if (seen.has(itemId)) errors.push(`贴纸 id 重复：${itemId}`)
    if (existingIds.has(itemId)) errors.push(`贴纸 id「${itemId}」与内置或其它贴纸包冲突`)
    seen.add(itemId)
    if (!label) warnings.push(`items[${i}] 没有 label，会用 id 代替`)
    if (!file) errors.push(`items[${i}].file 为空`)
    else if (/^([a-z]:|\/)/i.test(file) || file.split('/').includes('..')) errors.push(`items[${i}].file 不能是绝对路径或包含 ..`)
    else if (!STICKER_FILE_RE.test(file)) errors.push(`items[${i}].file 必须是 png/webp/gif/jpg`)
    const tags = Array.isArray(x.tags)
      ? x.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, 8)
      : undefined
    items.push({ id: itemId, label: label || itemId, file, ...(tags?.length ? { tags } : {}) })
  })

  if (errors.length) return { ok: false, errors, warnings }
  return {
    ok: true,
    errors,
    warnings,
    manifest: {
      id,
      name,
      version,
      ...(typeof o.author === 'string' && o.author.trim() ? { author: o.author.trim() } : {}),
      ...(typeof o.license === 'string' && o.license.trim() ? { license: o.license.trim() } : {}),
      ...(typeof o.description === 'string' && o.description.trim() ? { description: o.description.trim() } : {}),
      items
    }
  }
}

export function stickerSrc(packId: string, file: string): string {
  return `fatfish-sticker://${encodeURIComponent(packId)}/${file
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')}`
}
