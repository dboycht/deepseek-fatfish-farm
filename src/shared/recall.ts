import type { MemoryCard } from './types'

/**
 * 记忆检索的纯函数部分（不依赖 Electron / 文件系统，方便单测）。
 *
 * 中文没有空格：用「二元组」切词；英文用单词。
 * 排序同时考虑：关键词相关度（IDF 加权）、时间衰减、重要度、钉选、图片线索、被反复想起的惩罚。
 */

export function tokenize(text: string): string[] {
  const out: string[] = []
  const lower = (text ?? '').toLowerCase()
  for (const m of lower.matchAll(/[a-z0-9_]{2,}/g)) out.push(m[0])
  for (const m of lower.matchAll(/[\u3400-\u9fff]+/g)) {
    const run = m[0]
    if (run.length === 1) out.push(run)
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  return [...new Set(out)]
}

export const IMAGE_WORDS = ['图', '照片', '图片', '那张', '拍的', '截图', 'pic', 'photo', 'image', 'screenshot']

export function cardHaystack(card: MemoryCard): string {
  const d = new Date(card.t)
  const ds = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  return `${card.text} ${card.tags.join(' ')} ${ds}`.toLowerCase()
}

export function isImageQuery(query: string): boolean {
  const q = (query ?? '').toLowerCase()
  return IMAGE_WORDS.some((w) => q.includes(w))
}

export interface ScoredCard {
  card: MemoryCard
  score: number
  /** 归一化后的关键词相关度 0..1 */
  rel: number
}

export interface ScoreOptions {
  now?: number
  /** 时间衰减半衰期（天） */
  halfLifeDays?: number
}

export function scoreCards(cards: MemoryCard[], query: string, opts: ScoreOptions = {}): ScoredCard[] {
  const now = opts.now ?? Date.now()
  const halfLife = opts.halfLifeDays ?? 90
  const qTokens = tokenize(query)
  const wantsImage = isImageQuery(query)
  const hays = cards.map(cardHaystack)

  if (!qTokens.length) {
    return cards.map((card) => {
      const recency = Math.exp((-Math.LN2 * Math.max(0, now - card.t)) / (halfLife * 86_400_000))
      const score = 0.5 * (card.salience / 9) + 0.4 * recency + (card.pin ? 0.2 : 0)
      return { card, score, rel: 0 }
    })
  }

  const df = new Map<string, number>()
  for (const tok of qTokens) {
    let n = 0
    for (const h of hays) if (h.includes(tok)) n++
    df.set(tok, n)
  }
  const idf = (tok: string): number => Math.log(1 + cards.length / (1 + (df.get(tok) ?? 0)))
  // 只用「语料里真的出现过」的查询词做归一化：长中文句子里大量二元组是噪声，
  // 若把它们都算进分母，会把一条高度相关的记忆稀释成很低的分。
  const maxIdf = qTokens.reduce((a, t) => a + ((df.get(t) ?? 0) > 0 ? idf(t) : 0), 0) || 1

  return cards.map((card, i) => {
    const hay = hays[i]
    let rel = 0
    for (const tok of qTokens) if (hay.includes(tok)) rel += idf(tok)
    const relN = rel / maxIdf
    const ageDays = Math.max(0, (now - card.t) / 86_400_000)
    const recency = Math.exp((-Math.LN2 * ageDays) / halfLife)
    const salience = card.salience / 9
    const pin = card.pin ? 0.25 : 0
    const imgBoost = wantsImage && card.img?.length ? 0.35 : 0
    const archPenalty = card.arch ? 0.06 : 0
    const hitPenalty = 0.05 * Math.min(card.hit ?? 0, 6)
    const score = 0.62 * relN + 0.18 * recency + 0.14 * salience + pin + imgBoost - archPenalty - hitPenalty
    return { card, score, rel: relN }
  })
}
