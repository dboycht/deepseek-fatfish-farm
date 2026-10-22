import { join } from 'node:path'
import { dirSize, fileSize, readGzJSON, writeGzJSON } from '../util/fsx'
import { id } from '../util/ids'
import { cachedProfile, memoryDir, patchStats } from './fish'
import { readChat } from './chat'
import { getMany } from './media'
import { cardHaystack, scoreCards, tokenize } from '@shared/recall'
import type { ChatMessage, MemoryCard, MemoryKind, MemoryStats, RecallHit } from '@shared/types'

/**
 * 压缩类记忆引擎。
 *
 * 设计目标：**用最小的体积记住最该记住的事，并且能引用回原话**。
 *  - 卡片正文用英文（同样语义下比中文省 token、也省字节）；
 *  - 全会话 gzip 落盘，卡片库 gzip 落盘，索引里只留短键；
 *  - 有 API 时由模型蒸馏，无 API 时用启发式规则兜底，保证离线也能长记忆；
 *  - 卡片数量超过上限后自动「归档压缩」：多张旧卡合成一张 arch 卡，体积有界；
 *  - 每张卡保留来源消息 id 与图片 id ⇒ 聊天框里可以输出「引用」并跳回原话。
 */

interface DiskMemory {
  v: number
  cards: MemoryCard[]
}

interface MemState {
  chats: Record<string, { upTo: string; n: number }>
  lastDistill?: number
  compactedAt?: number
}

function cardsPath(root: string, fishId: string): string {
  return join(memoryDir(root, fishId), 'cards.json.gz')
}

function statePath(root: string, fishId: string): string {
  return join(memoryDir(root, fishId), 'state.json')
}

export async function loadCards(root: string, fishId: string): Promise<MemoryCard[]> {
  const disk = await readGzJSON<DiskMemory>(cardsPath(root, fishId), { v: 1, cards: [] })
  return disk.cards ?? []
}

export async function saveCards(root: string, fishId: string, cards: MemoryCard[]): Promise<void> {
  await writeGzJSON(cardsPath(root, fishId), { v: 1, cards } satisfies DiskMemory)
  await patchStats(root, fishId, (p) => {
    p.stats.memories = cards.filter((c) => !c.arch).length
  })
}

async function loadState(root: string, fishId: string): Promise<MemState> {
  return readGzJSON<MemState>(statePath(root, fishId), { chats: {} })
}

async function saveState(root: string, fishId: string, state: MemState): Promise<void> {
  await writeGzJSON(statePath(root, fishId), state)
}

export async function memoryStats(root: string, fishId: string): Promise<MemoryStats> {
  const cards = await loadCards(root, fishId)
  const state = await loadState(root, fishId)
  const bytes = (await fileSize(cardsPath(root, fishId))) + (await fileSize(statePath(root, fishId)))
  const approx = cards.reduce((a, c) => a + Math.ceil((c.text.length + c.tags.join(',').length) / 4), 0)
  return {
    cards: cards.filter((c) => !c.arch).length,
    archived: cards.filter((c) => c.arch).length,
    bytes,
    approxTokens: approx,
    lastDistill: state.lastDistill
  }
}

export async function memoryDirSize(root: string, fishId: string): Promise<number> {
  return dirSize(memoryDir(root, fishId))
}

/* ------------------------------------------------------------------ *
 * 检索（打分逻辑在 @shared/recall，便于单测）
 * ------------------------------------------------------------------ */

export interface RecallOptions {
  k?: number
  /** 仅调试用：返回全部候选分数 */
  explain?: boolean
}

export async function recall(
  root: string,
  fishId: string,
  query: string,
  opts: RecallOptions = {}
): Promise<RecallHit[]> {
  const cards = await loadCards(root, fishId)
  if (!cards.length) return []
  const k = opts.k ?? 6
  const scored = scoreCards(cards, query)
    .sort((a, b) => b.score - a.score)

  const hits = scored
    .filter((s) => s.score >= 0.2 && (s.rel > 0.12 || tokenize(query).length === 0))
    .slice(0, k)
    .map((s, i) => ({ card: s.card, score: Number(s.score.toFixed(3)), anchor: `M${i + 1}` }))

  if (!hits.length && opts.explain) {
    return scored.slice(0, k).map((s, i) => ({ card: s.card, score: Number(s.score.toFixed(3)), anchor: `M${i + 1}` }))
  }
  return hits
}

export async function markRecalled(root: string, fishId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  const cards = await loadCards(root, fishId)
  const now = Date.now()
  let touched = false
  for (const c of cards) {
    if (ids.includes(c.id)) {
      c.hit = (c.hit ?? 0) + 1
      c.last = now
      touched = true
    }
  }
  if (touched) await saveCards(root, fishId, cards)
}

export async function searchCards(root: string, fishId: string, q: string): Promise<MemoryCard[]> {
  const cards = await loadCards(root, fishId)
  if (!q.trim()) return cards.sort((a, b) => b.t - a.t)
  const toks = tokenize(q)
  return cards
    .map((c) => {
      const hay = cardHaystack(c)
      const score = toks.reduce((a, t) => a + (hay.includes(t) ? 1 : 0), 0)
      return { c, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.c.t - a.c.t)
    .map((x) => x.c)
}

export async function pinCard(root: string, fishId: string, cardId: string, pin: boolean): Promise<void> {
  const cards = await loadCards(root, fishId)
  const c = cards.find((x) => x.id === cardId)
  if (!c) return
  c.pin = pin
  await saveCards(root, fishId, cards)
}

export async function deleteCard(root: string, fishId: string, cardId: string): Promise<void> {
  const cards = (await loadCards(root, fishId)).filter((c) => c.id !== cardId)
  await saveCards(root, fishId, cards)
}

/* ------------------------------------------------------------------ *
 * 蒸馏：把「还没消化的对话」压成卡片
 * ------------------------------------------------------------------ */

export const DISTILL_SYSTEM = [
  'You are the memory compressor for a virtual pet fish that lives on the user\'s computer.',
  'Read the transcript and output ONLY strict JSON (no markdown, no commentary):',
  '{"cards":[{"k":"fact|event|pref|person|promise|mood","x":"<=160 chars English, third person, concrete, past tense","tags":["3-6 lowercase keywords"],"s":0-9,"m":[transcript indexes]}]}',
  'Rules:',
  '- At most 3 cards. Prefer fewer, higher-value cards.',
  '- Keep only durable information: identity, preferences, people, places, plans, promises, notable events, strong feelings, inside jokes.',
  '- Skip small talk, transient states, and anything secret (API keys, passwords, addresses, ID numbers).',
  '- Each card must stand alone: include the subject ("User", a person\'s name, or the pet\'s name).',
  '- Tags must be useful for later keyword recall; include the languages actually used.'
].join('\n')

function transcriptLines(msgs: ChatMessage[], captions: Map<string, string>): string[] {
  return msgs.map((m, i) => {
    const who = m.role === 'u' ? 'U' : 'A'
    const day = new Date(m.t).toISOString().slice(0, 10)
    const imgs = (m.imgs ?? [])
      .map((mid) => `(picture: ${captions.get(mid) ?? 'no caption'})`)
      .join(' ')
    const body = (m.text ?? '').replace(/\s+/g, ' ').slice(0, 400)
    const sticker = m.sticker ? `[sticker:${m.sticker}]` : ''
    return `#${i} [${who} ${day}] ${body} ${sticker} ${imgs}`.trim()
  })
}

export interface DistillOptions {
  root: string
  fishId: string
  chatId: string
  every: number
  maxCards: number
  force?: boolean
  /** 模型蒸馏；不传则走启发式兜底 */
  llm?: (system: string, user: string) => Promise<string>
}

export interface DistillResult {
  added: number
  compacted: number
  used: 'llm' | 'heuristic' | 'none'
}

export async function distill(opts: DistillOptions): Promise<DistillResult> {
  const { root, fishId, chatId } = opts
  const chat = await readChat(root, fishId, chatId)
  if (!chat) return { added: 0, compacted: 0, used: 'none' }
  const state = await loadState(root, fishId)
  const mark = state.chats[chatId]
  const startIdx = mark ? chat.msgs.findIndex((m) => m.id === mark.upTo) + 1 : 0
  const pendingAll = chat.msgs.slice(Math.max(0, startIdx))
  const pending = pendingAll.filter((m) => m.role !== 's' && !m.err && (m.text?.trim() || m.imgs?.length))
  if (!pending.length) return { added: 0, compacted: 0, used: 'none' }
  if (!opts.force && pending.length < opts.every) return { added: 0, compacted: 0, used: 'none' }

  const imgIds = [...new Set(pending.flatMap((m) => m.imgs ?? []))]
  const medias = await getMany(root, fishId, imgIds)
  const captions = new Map(medias.map((m) => [m.id, m.caption ?? m.name]))

  let fresh: MemoryCard[] = []
  let used: DistillResult['used'] = 'heuristic'

  if (opts.llm) {
    try {
      const lines = transcriptLines(pending, captions)
      const raw = await opts.llm(DISTILL_SYSTEM, `Transcript:\n${lines.join('\n')}`)
      fresh = parseCards(raw, pending, captions, imgIds)
      used = fresh.length ? 'llm' : 'heuristic'
    } catch {
      used = 'heuristic'
    }
  }
  if (!fresh.length) {
    fresh = heuristicCards(pending, captions, chat.title)
    used = 'heuristic'
  }

  const existing = await loadCards(root, fishId)
  const merged: MemoryCard[] = []
  for (const card of fresh) {
    const dup = existing.find(
      (e) => !e.arch && e.kind === card.kind && normalize(e.text) === normalize(card.text)
    )
    if (!dup) merged.push(card)
  }
  const all = [...existing, ...merged]
  await saveCards(root, fishId, all)

  const last = pending[pending.length - 1]
  state.chats[chatId] = { upTo: last.id, n: pending.length }
  state.lastDistill = Date.now()
  await saveState(root, fishId, state)

  const compacted = await compact(root, fishId, { maxCards: opts.maxCards, llm: opts.llm })
  const profile = await cachedProfile(root, fishId)
  if (profile) {
    await patchStats(root, fishId, (p) => {
      p.stats.exp += 6 + merged.length * 3
      p.stats.hunger = Math.min(100, p.stats.hunger + merged.length * 2)
    })
  }
  return { added: merged.length, compacted, used }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '').slice(0, 90)
}

function parseCards(
  raw: string,
  pending: ChatMessage[],
  captions: Map<string, string>,
  imgIds: string[]
): MemoryCard[] {
  const jsonText = extractJson(raw)
  if (!jsonText) return []
  let data: { cards?: unknown }
  try {
    data = JSON.parse(jsonText) as { cards?: unknown }
  } catch {
    return []
  }
  if (!Array.isArray(data.cards)) return []
  const out: MemoryCard[] = []
  for (const item of data.cards.slice(0, 3)) {
    if (typeof item !== 'object' || !item) continue
    const o = item as Record<string, unknown>
    const text = typeof o.x === 'string' ? o.x.trim().slice(0, 200) : ''
    if (!text) continue
    const kind = (['fact', 'event', 'pref', 'person', 'promise', 'mood'] as MemoryKind[]).includes(
      o.k as MemoryKind
    )
      ? (o.k as MemoryKind)
      : 'event'
    const idxs = Array.isArray(o.m) ? o.m.filter((n): n is number => typeof n === 'number') : []
    const src = idxs.map((i) => pending[i]?.id).filter((v): v is string => Boolean(v))
    const imgs = idxs.flatMap((i) => pending[i]?.imgs ?? [])
    const tags = Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().slice(0, 20)).slice(0, 6)
      : []
    const t = idxs.length ? (pending[Math.min(...idxs)]?.t ?? Date.now()) : Date.now()
    out.push({
      id: id(10),
      t,
      kind,
      text,
      tags,
      src: src.length ? src : pending.slice(-2).map((m) => m.id),
      img: [...new Set(imgs.length ? imgs : [])].slice(0, 4),
      salience: typeof o.s === 'number' ? Math.max(0, Math.min(9, Math.round(o.s))) : 5,
      hit: 0
    })
  }
  // 无图片 id 时，若这段对话里有图且卡片是 event，则挂上最后一张图
  for (const c of out) {
    if (!c.img?.length && c.kind === 'event' && imgIds.length) c.img = [imgIds[imgIds.length - 1]]
  }
  void captions
  return out
}

function extractJson(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return raw.slice(start, end + 1)
}

/** 无 API 时的兜底：正则抽取身份/喜好/计划/图片事件 */
export function heuristicCards(
  pending: ChatMessage[],
  captions: Map<string, string>,
  chatTitle: string
): MemoryCard[] {
  const out: MemoryCard[] = []
  const push = (
    kind: MemoryKind,
    text: string,
    tags: string[],
    msgs: ChatMessage[],
    salience = 5
  ): void => {
    const imgs = [...new Set(msgs.flatMap((m) => m.imgs ?? []))].slice(0, 3)
    out.push({
      id: id(10),
      t: msgs[0]?.t ?? Date.now(),
      kind,
      text: text.slice(0, 200),
      tags: tags.slice(0, 6),
      src: msgs.map((m) => m.id).slice(0, 6),
      img: imgs.length ? imgs : undefined,
      salience,
      hit: 0
    })
  }

  const patterns: { re: RegExp; kind: MemoryKind; make: (m: RegExpMatchArray) => string; tags: string[] }[] = [
    { re: /我(?:叫|是|的名字是|名字叫)([^\s，。,.!?！？、]{1,12})/, kind: 'person', make: (m) => `User's name or nickname is "${m[1]}".`, tags: ['name', 'identity'] },
    { re: /我(?:喜欢|最爱|爱|超爱)([^。！？!?\n]{1,20})/, kind: 'pref', make: (m) => `User likes: ${m[1].trim()}.`, tags: ['preference', 'like'] },
    { re: /我(?:讨厌|不喜欢|害怕|受不了)([^。！？!?\n]{1,20})/, kind: 'pref', make: (m) => `User dislikes: ${m[1].trim()}.`, tags: ['preference', 'dislike'] },
    { re: /我(?:在|住在|来自|工作在|就读于)([^。！？!?\n]{1,20})/, kind: 'fact', make: (m) => `User is at / from: ${m[1].trim()}.`, tags: ['place', 'fact'] },
    { re: /我(?:的)?(?:生日|年龄|岁数)([^。！？!?\n]{0,20})/, kind: 'fact', make: (m) => `User's personal fact: ${m[1].trim() || m[0]}.`, tags: ['personal'] },
    { re: /(明天|后天|下周|下个月|周末|今晚|待会|回头)([^。！？!?\n]{1,24})/, kind: 'promise', make: (m) => `User mentioned a plan: ${m[1]}${m[2]}.`, tags: ['plan', 'promise'] },
    { re: /(记住|别忘了|提醒我)([^。！？!?\n]{1,28})/, kind: 'promise', make: (m) => `User asked to remember: ${m[2].trim()}.`, tags: ['remember', 'promise'], }
  ]

  for (const msg of pending) {
    if (msg.role !== 'u' || !msg.text) continue
    for (const p of patterns) {
      const m = msg.text.match(p.re)
      if (m) push(p.kind, p.make(m), [...p.tags, ...tokenize(m[0]).slice(0, 3)], [msg], 6)
    }
  }

  // 图片事件
  const imgMsgs = pending.filter((m) => m.imgs?.length)
  if (imgMsgs.length) {
    const last = imgMsgs[imgMsgs.length - 1]
    const mid = last.imgs![last.imgs!.length - 1]
    const cap = captions.get(mid)
    push(
      'event',
      `User sent a picture${cap ? `: ${cap}` : ''}.`,
      ['picture', ...tokenize(cap ?? '').slice(0, 3)],
      [last],
      6
    )
  }

  // 兜底事件卡：这段对话在聊什么
  if (!out.length) {
    const firstUser = pending.find((m) => m.role === 'u')
    const snippet = (firstUser?.text ?? '').replace(/\s+/g, ' ').slice(0, 100)
    push('event', `Chat "${chatTitle}" happened${snippet ? `; User said: ${snippet}` : ''}.`, ['chat'], pending.slice(0, 3), 3)
  }
  return out.slice(0, 3)
}

/* ------------------------------------------------------------------ *
 * 有界压缩：卡片库超过上限时，把最旧的若干张合成一张归档卡
 * ------------------------------------------------------------------ */

export const COMPACT_SYSTEM = [
  'You compress old memory cards of a virtual pet into ONE archive card.',
  'Output ONLY strict JSON: {"x":"<=200 chars English, third person, keeps names, preferences and promises","tags":["<=6 lowercase keywords"]}',
  'Merge duplicates, drop trivia, never invent facts.'
].join('\n')

export async function compact(
  root: string,
  fishId: string,
  opts: { maxCards: number; llm?: (system: string, user: string) => Promise<string>; chunk?: number }
): Promise<number> {
  let cards = await loadCards(root, fishId)
  const live = cards.filter((c) => !c.arch)
  if (live.length <= opts.maxCards) return 0
  const overflow = live.length - opts.maxCards
  const chunkSize = Math.max(opts.chunk ?? 8, Math.min(16, overflow + 1))
  const oldest = [...live].sort((a, b) => a.t - b.t).slice(0, chunkSize)
  if (oldest.length < 3) return 0

  let text = ''
  let tags: string[] = []
  if (opts.llm) {
    try {
      const raw = await opts.llm(
        COMPACT_SYSTEM,
        oldest.map((c, i) => `#${i} [${c.kind}] ${c.text} | tags: ${c.tags.join(',')}`).join('\n')
      )
      const j = extractJson(raw)
      if (j) {
        const parsed = JSON.parse(j) as { x?: string; tags?: string[] }
        text = (parsed.x ?? '').trim()
        tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).toLowerCase().slice(0, 20)) : []
      }
    } catch {
      /* 落到拼接 */
    }
  }
  if (!text) {
    text = `Archived memories: ${oldest
      .map((c) => c.text.replace(/\.$/, ''))
      .join(' | ')
      .slice(0, 200)}.`
  }
  if (!tags.length) tags = [...new Set(oldest.flatMap((c) => c.tags))].slice(0, 6)

  const arch: MemoryCard = {
    id: id(10),
    t: oldest[0].t,
    kind: 'event',
    text: text.slice(0, 220),
    tags,
    src: [...new Set(oldest.flatMap((c) => c.src))].slice(0, 14),
    img: [...new Set(oldest.flatMap((c) => c.img ?? []))].slice(0, 3),
    salience: Math.max(3, Math.round(oldest.reduce((a, c) => a + c.salience, 0) / oldest.length)),
    hit: 0,
    arch: true
  }
  const removeIds = new Set(oldest.map((c) => c.id))
  cards = cards.filter((c) => !removeIds.has(c.id))
  cards.push(arch)
  cards.sort((a, b) => a.t - b.t)
  await saveCards(root, fishId, cards)
  const state = await loadState(root, fishId)
  state.compactedAt = Date.now()
  await saveState(root, fishId, state)
  return oldest.length - 1
}

/** 整只鱼记忆重建（导入/手工触发用） */
export async function replaceCards(root: string, fishId: string, cards: MemoryCard[]): Promise<void> {
  await saveCards(root, fishId, cards)
}
