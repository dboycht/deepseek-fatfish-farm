import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialog, nativeImage, net, protocol } from 'electron'
import { unzipSync } from 'fflate'
import { readJSON, writeAtomic, writeJSON } from './util/fsx'
import { configDir } from './paths'
import {
  builtinStickerPack,
  MAX_STICKER_BYTES,
  normalizeWishKey,
  validateStickerManifest,
  type StickerManifest
} from '@shared/stickers'
import type { StickerImportResult, StickerPack, StickerState, StickerWish } from '@shared/types'

/**
 * 用户贴纸包与「缺表情」记录。
 *
 *   <configDir>/stickers/<packId>/manifest.json + 图片
 *   <configDir>/stickers/wishes.json
 *
 * 贴纸包可以用 GPT 批量生成后导入（文件夹或 zip）。
 * 导入时校验 id 冲突、文件存在、体积、能否解码、是否接近正方形。
 */

export function stickersDir(): string {
  return join(configDir(), 'stickers')
}

function wishesFile(): string {
  return join(stickersDir(), 'wishes.json')
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(stickersDir(), { recursive: true })
}

export async function ensureStickerDir(): Promise<string> {
  await ensureDir()
  return stickersDir()
}

function safeRel(rel: string): string | null {
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean || clean.split('/').includes('..') || /^[a-zA-Z]:/.test(clean) || clean.includes('\0')) return null
  return clean
}

async function readManifestAt(dir: string): Promise<StickerManifest | null> {
  const raw = await readJSON<unknown>(join(dir, 'manifest.json'), null)
  if (!raw) return null
  const v = validateStickerManifest(raw, new Set())
  return v.ok && v.manifest ? v.manifest : null
}

export async function listPacks(): Promise<StickerPack[]> {
  await ensureDir()
  const packs: StickerPack[] = [builtinStickerPack()]
  let names: string[] = []
  try {
    names = await fs.readdir(stickersDir())
  } catch {
    names = []
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const dir = join(stickersDir(), name)
    let st
    try {
      st = await fs.stat(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const manifest = await readManifestAt(dir)
    if (!manifest) continue
    // 目录名与 manifest.id 不一致时跳过，避免协议路径与 token 对不上
    if (manifest.id !== name) {
      console.warn(`[stickers] 跳过 ${name}：manifest.id=${manifest.id} 与目录名不一致`)
      continue
    }
    packs.push({
      ...manifest,
      dir,
      items: manifest.items.map((it) => ({ ...it, packId: manifest.id }))
    })
  }
  return packs
}

export async function listStickerState(): Promise<StickerState> {
  return { packs: await listPacks(), wishes: await listWishes(), dir: stickersDir() }
}

/* ------------------------------------------------------------------ *
 * 缺表情记录
 * ------------------------------------------------------------------ */

interface WishesDoc {
  v: number
  wishes: StickerWish[]
}

async function loadWishes(): Promise<StickerWish[]> {
  const doc = await readJSON<WishesDoc>(wishesFile(), { v: 1, wishes: [] })
  return Array.isArray(doc.wishes) ? doc.wishes : []
}

export async function listWishes(): Promise<StickerWish[]> {
  return (await loadWishes()).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
}

export async function recordStickerWish(rawKey: string, sample: string): Promise<void> {
  const key = normalizeWishKey(rawKey)
  if (!key) return
  await ensureDir()
  const wishes = await loadWishes()
  const now = Date.now()
  const hit = wishes.find((w) => w.key === key)
  const snippet = sample.trim().replace(/\s+/g, ' ').slice(0, 120)
  if (hit) {
    hit.count += 1
    hit.lastAt = now
    if (snippet && !hit.samples.includes(snippet)) {
      hit.samples = [...hit.samples, snippet].slice(-3)
    }
  } else {
    wishes.push({ key, count: 1, firstAt: now, lastAt: now, samples: snippet ? [snippet] : [] })
  }
  await writeJSON(wishesFile(), { v: 1, wishes }, true)
}

export async function clearStickerWishes(): Promise<void> {
  await writeJSON(wishesFile(), { v: 1, wishes: [] }, true)
}

/* ------------------------------------------------------------------ *
 * 导入
 * ------------------------------------------------------------------ */

async function validatePackDir(dir: string): Promise<{ manifest: StickerManifest; warnings: string[] }> {
  const raw = await readJSON<unknown>(join(dir, 'manifest.json'), null)
  if (!raw) throw new Error('缺少 manifest.json')
  const packs = await listPacks()
  const existing = new Set(packs.flatMap((p) => [p.id, ...p.items.map((i) => i.id)]))
  const v = validateStickerManifest(raw, existing)
  if (!v.ok || !v.manifest) throw new Error(`manifest 校验失败：\n${v.errors.join('\n')}`)
  const warnings = [...v.warnings]
  for (const item of v.manifest.items) {
    const p = resolve(dir, item.file)
    if (!(p === dir || p.startsWith(dir + sep))) throw new Error(`文件越界：${item.file}`)
    let st
    try {
      st = await fs.stat(p)
    } catch {
      throw new Error(`缺少文件：${item.file}`)
    }
    if (st.size > MAX_STICKER_BYTES) throw new Error(`${item.file} 超过 4MB`)
    if (st.size < 256) warnings.push(`${item.file} 很小（${st.size} B），可能不是有效图片`)
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) throw new Error(`无法解码：${item.file}`)
    const { width, height } = img.getSize()
    if (width < 64 || height < 64) throw new Error(`${item.file} 尺寸太小（${width}×${height}）`)
    if (Math.abs(width - height) > Math.max(8, width * 0.12)) {
      warnings.push(`${item.file} 不是正方形（${width}×${height}），显示时会留边`)
    }
  }
  return { manifest: v.manifest, warnings }
}

async function installPackFromDir(src: string): Promise<StickerImportResult> {
  const { manifest, warnings } = await validatePackDir(src)
  const dest = join(stickersDir(), manifest.id)
  try {
    await fs.access(dest)
    throw new Error(`已存在同名贴纸包「${manifest.id}」，请先删除旧的`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  await fs.cp(src, dest, { recursive: true })
  return { packId: manifest.id, name: manifest.name, items: manifest.items.length, warnings }
}

async function importZipFile(zipPath: string): Promise<StickerImportResult> {
  const stat = await fs.stat(zipPath)
  if (stat.size > 60 * 1024 * 1024) throw new Error('zip 超过 60MB')
  const buf = await fs.readFile(zipPath)
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(buf))
  } catch {
    throw new Error('不是有效的 zip 文件')
  }
  const keys = Object.keys(entries).filter((k) => !k.includes('__MACOSX/') && !k.endsWith('/'))
  const manifestKey = keys
    .filter((k) => basename(k) === 'manifest.json')
    .sort((a, b) => a.split('/').length - b.split('/').length)[0]
  if (!manifestKey) throw new Error('zip 里没有 manifest.json（可以放在根目录或单一文件夹里）')
  const base = manifestKey.slice(0, -'manifest.json'.length)
  const temp = join(stickersDir(), `.import-${Date.now()}`)
  await fs.mkdir(temp, { recursive: true })
  try {
    let total = 0
    for (const key of keys) {
      if (!key.startsWith(base)) continue
      const rel = key.slice(base.length)
      const safe = safeRel(rel)
      if (!safe) continue
      const data = entries[key]
      total += data.byteLength
      if (total > 60 * 1024 * 1024) throw new Error('解压后超过 60MB')
      const out = join(temp, safe)
      await fs.mkdir(dirname(out), { recursive: true })
      await fs.writeFile(out, data)
    }
    return await installPackFromDir(temp)
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}

export async function importStickerPack(kind: 'zip' | 'folder'): Promise<StickerImportResult | null> {
  await ensureDir()
  if (kind === 'zip') {
    const res = await dialog.showOpenDialog({
      title: '导入贴纸包（zip）',
      properties: ['openFile'],
      filters: [{ name: '贴纸包', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return importZipFile(res.filePaths[0])
  }
  const res = await dialog.showOpenDialog({
    title: '选择贴纸包文件夹（里面应有 manifest.json）',
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return null
  return installPackFromDir(res.filePaths[0])
}

export async function removeStickerPack(packId: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(packId)) throw new Error('非法包 id')
  const dir = join(stickersDir(), packId)
  const base = resolve(stickersDir())
  const target = resolve(dir)
  if (!target.startsWith(base + sep)) throw new Error('非法路径')
  await fs.rm(target, { recursive: true, force: true })
}

/* ------------------------------------------------------------------ *
 * 导出需求清单（给 GPT 用）
 * ------------------------------------------------------------------ */

const GPT_PROMPT = `你是一个角色表情包生成助手。角色是「蓝色大肥鱼」：Q 版鲸鱼娘，深蓝到浅蓝渐变长发、呆毛、白色女仆发带、蓝色眼睛、白色围裙（上面有蓝色小鲸鱼）、一条蓝色鲸尾，圆滚滚、呆萌、带点屑。
请按下面的「缺失表情」列表，为每一个表情生成一张图：
- 512×512 PNG，透明背景，角色居中，半身或全身 Q 版，粗描边、干净赛璐璐上色
- 表情夸张但可爱，符合列表里的使用场景；不要文字、不要水印、不要多余角色
- 保持同一角色的发型、发带、围裙、鲸尾、配色一致
- 每张图一个文件，文件名用列表里的 id（例如 pout.png）
- 同时输出 manifest.json（我可以直接导入软件），格式见下
不要参考或模仿任何具体画师/作品的画风；使用通用的日系 Q 版风格。`

function buildWishRows(wishes: StickerWish[]): { id: string; key: string; count: number; sample: string }[] {
  const used = new Set<string>()
  return wishes.map((w, i) => {
    let base = w.key
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!base) base = `emote-${i + 1}`
    let id = base
    let n = 2
    while (used.has(id)) id = `${base}-${n++}`
    used.add(id)
    return { id, key: w.key, count: w.count, sample: w.samples[0] ?? '' }
  })
}

function buildWishDoc(wishes: StickerWish[]): string {
  const rows = buildWishRows(wishes)
  const lines: string[] = []
  lines.push('# 肥鱼贴纸需求清单')
  lines.push('')
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('## 缺失的表情')
  if (!rows.length) {
    lines.push('（暂时没有记录到缺失表情）')
  } else {
    for (const r of rows) {
      lines.push(`- \`${r.id}\`（${r.key}）× ${r.count} —— 例：${r.sample || '（无上下文）'}`)
    }
  }
  lines.push('')
  lines.push('## 给 GPT 的批量生成提示词（直接复制）')
  lines.push('')
  lines.push('```text')
  lines.push(GPT_PROMPT)
  lines.push('')
  lines.push('缺失表情（文件名 id：含义 / 使用场景）：')
  for (const r of rows) lines.push(`- ${r.id}：${r.key} / ${r.sample || r.key}`)
  lines.push('```')
  lines.push('')
  lines.push('## 输出目录与 manifest')
  lines.push('')
  lines.push('```text')
  lines.push('my-sticker-pack/')
  lines.push('├── manifest.json')
  for (const r of rows.slice(0, 5)) lines.push(`├── ${r.id}.png`)
  lines.push('└── ...')
  lines.push('```')
  lines.push('')
  lines.push('manifest.json 模板：')
  lines.push('')
  lines.push('```json')
  lines.push(
    JSON.stringify(
      {
        id: 'my-sticker-pack',
        name: '我的大肥鱼表情包',
        version: '1.0.0',
        author: 'your-name',
        license: 'CC-BY-NC-4.0',
        description: '用 GPT 批量生成的补充表情',
        items: rows.map((r) => ({
          id: r.id,
          label: r.key,
          file: `${r.id}.png`,
          tags: [r.key]
        }))
      },
      null,
      2
    )
  )
  lines.push('```')
  lines.push('')
  lines.push('## 导入')
  lines.push('')
  lines.push('1. 软件里「聊天输入框 → 🐟 → 导入贴纸包」，选 zip 或文件夹；')
  lines.push('2. 包 id 不能与内置/已安装的冲突；图片建议 ≤ 4MB/张；')
  lines.push('3. 导入后，模型会在 `[[sticker:<id>]]` 里使用这些新表情。')
  return lines.join('\n')
}

export async function exportStickerWishes(): Promise<{ path: string; bytes: number } | null> {
  const wishes = await listWishes()
  const res = await dialog.showSaveDialog({
    title: '导出贴纸需求清单',
    defaultPath: `肥鱼贴纸需求-${new Date().toISOString().slice(0, 10)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (res.canceled || !res.filePath) return null
  const text = buildWishDoc(wishes)
  await writeAtomic(res.filePath, text)
  return { path: res.filePath, bytes: Buffer.byteLength(text) }
}

/* ------------------------------------------------------------------ *
 * 协议：fatfish-sticker://<packId>/<file>
 * ------------------------------------------------------------------ */

export async function resolveStickerFile(packId: string, rel: string): Promise<string | null> {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(packId)) return null
  const safe = safeRel(rel)
  if (!safe) return null
  const base = resolve(stickersDir(), packId)
  const file = resolve(base, safe)
  if (!file.startsWith(base + sep)) return null
  try {
    await fs.access(file)
    return file
  } catch {
    return null
  }
}

export function registerStickerProtocol(): void {
  protocol.handle('fatfish-sticker', async (request) => {
    const url = new URL(request.url)
    const packId = decodeURIComponent(url.hostname)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = await resolveStickerFile(packId, rel)
    if (!file) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

export function stickersRoot(): string {
  return stickersDir()
}
