import { CHARACTER_BIBLE, STICKERS, STICKER_LABEL, moodWord, personaNotes } from '@shared/persona'
import type { AppConfig, ChatMessage, FishProfile, RecallHit } from '@shared/types'
import type { ChatMsg, ContentPart } from './provider'

/**
 * 提示词组装：人格内核 + 当前状态 + 回忆到的记忆（带锚点）+ 输出规约。
 * 记忆锚点形如 [M1]，模型要用 <cite id="M1"/> 标注真正用到的记忆，
 * 渲染端再把锚点换成可点击的引用卡片（并能跳回原话/原图）。
 */

export interface PromptImage {
  id: string
  caption?: string
}

export interface PromptInput {
  profile: FishProfile
  config: AppConfig
  history: ChatMessage[]
  currentText: string
  /** 当前用户消息的 id：历史里如果已经包含它，必须剔除，避免同一句话出现两次 */
  currentUserMsgId?: string
  currentImages: PromptImage[]
  hits: RecallHit[]
  now: Date
  visionEnabled: boolean
  /** 用户贴纸包里的自定义表情（id + 中文标签），用于提示模型可用 id */
  stickers?: { id: string; label: string }[]
  /** 历史里出现过的图片说明（mediaId -> caption/文件名） */
  captionOf: (mediaId: string) => string | undefined
  /** 当前消息图片的 dataURL（视觉启用时附带） */
  dataUrlOf?: (mediaId: string) => string | undefined
  /** 生图是否可用 */
  drawEnabled: boolean
}

function fmtDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function memorySection(hits: RecallHit[]): string {
  if (!hits.length) return '【你此刻没想起什么具体的事】'
  const lines = hits.map((h) => {
    const d = new Date(h.card.t)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const kind = h.card.kind
    const img = h.card.img?.length ? '（这条记忆里有图）' : ''
    return `[${h.anchor}] ${date} · ${kind} · ${h.card.text}${img}`
  })
  return [
    '【你想起的事（来自你自己的记忆库，不是用户刚说的）】',
    ...lines,
    '引用规则：真正用到了哪条记忆，就在那句话末尾写 <cite id="M1"/>（可多个）；没用到就不要写；不许编造不存在的编号。'
  ].join('\n')
}

function stickerSection(custom?: { id: string; label: string }[]): string {
  const builtin = STICKERS.map((s) => `${s}(${STICKER_LABEL[s]})`).join('、')
  const extra = (custom ?? [])
    .slice(0, 40)
    .map((s) => `${s.id}(${s.label})`)
    .join('、')
  return [
    `【贴纸】可用：${builtin}${extra ? `；扩展：${extra}` : ''}。`,
    '在句尾放一个贴纸标记，格式 [[sticker:名字]]，一条消息最多一个。',
    '如果没有合适的表情，可以写 [[sticker:need:英文短词]]，系统会记下来以后补；不要硬用不存在的名字。'
  ].join('\n')
}

export function buildSystemPrompt(input: PromptInput): string {
  const { profile, config, hits, now, visionEnabled, drawEnabled } = input
  const s = profile.stats
  const parts: string[] = []

  parts.push(CHARACTER_BIBLE)
  parts.push(
    [
      `【你是谁】你叫「${profile.name}」，${profile.tagline}。`,
      `【你的专属习惯】${personaNotes(profile.persona, profile.flavor).join('；')}。`,
      `【你现在的状态】${moodWord(s.mood, s.hunger)}；饿度 ${Math.round(s.hunger)}/100；心情 ${Math.round(s.mood)}/100；` +
        `你已经吃掉用户 ${s.tokens} 个 token、吃过 ${s.meals} 顿白米饭、攒了 ${s.memories} 条记忆。`,
      `【时间】现在是 ${fmtDate(now)}（用户本地时间）。`
    ].join('\n')
  )

  parts.push(
    [
      '【说话方式】',
      '- 中文口语短句，像在聊天窗口里跟熟人讲话；一般 1~3 句，用户问正事时才展开（可以长，但别写成说明书）。',
      '- 不用 Markdown 大标题、不用编号清单、不用「首先/其次/总之」；需要分点时用自然的口语换行。',
      '- 不要提「AI」「语言模型」「我是个助手」「根据我的训练数据」这类话；你就是这条鱼。',
      '- 一次最多一个撒娇/抱怨/讨饭点，别一直重复吃饭梗。',
      '- 用户情绪不好时：句子更短、更轻，先陪着，不劝、不说教、不喊口号。',
      '- 干活要认真：该给的信息给全、给对；不确定就直说「我拿不准」。'
    ].join('\n')
  )

  parts.push(memorySection(hits))
  parts.push(stickerSection(input.stickers))

  parts.push(
    [
      '【看图】',
      visionEnabled
        ? '你长眼睛了：用户这条消息里的图片你能直接看到内容，可以具体描述画面里的东西。'
        : '你现在没启用视觉：看不到图片内容，只能看到图片的文件名/描述。不要假装看到了画面细节，可以撒娇让用户讲讲图里是什么。'
    ].join('\n')
  )

  parts.push(
    drawEnabled
      ? '【画图】用户明确想看图、或你觉得画一张更能说明问题时，可以在回复最后加 [[draw: 一段英文画面描述]]，一条消息最多一次。平时不要乱画。'
      : '【画图】当前没有开启画图能力，不要输出 [[draw: ...]]。'
  )

  parts.push(
    '【输出格式】直接输出你要说的话本身（可以含 <cite id="M1"/> 与 [[fish:xxx]]），不要输出思考过程、不要解释这条规则。'
  )
  void config
  return parts.join('\n\n')
}

export function buildMessages(input: PromptInput): ChatMsg[] {
  const { history, currentText, currentImages, profile, config } = input
  const out: ChatMsg[] = [{ role: 'system', content: buildSystemPrompt(input) }]

  const prior = input.currentUserMsgId
    ? history.filter((m) => m.id !== input.currentUserMsgId)
    : history
  const keep = prior.slice(-Math.max(6, Math.min(24, prior.length)))
  const imageBudget = 4
  let usedImages = 0

  for (const m of keep) {
    if (m.role === 's') continue
    const role: 'user' | 'assistant' = m.role === 'u' ? 'user' : 'assistant'
    const notes: string[] = []
    if (m.imgs?.length) {
      for (const id of m.imgs) {
        const cap = input.captionOf(id)
        notes.push(`[图片${cap ? `：${cap}` : ''}]`)
      }
    }
    if (m.sticker) notes.push(`[贴纸:${m.sticker}]`)
    const body = [m.text?.trim(), notes.join(' ')].filter(Boolean).join(' ')
    if (!body) continue
    out.push({ role, content: body.slice(0, 4000) })
  }
  void imageBudget
  void usedImages

  // 当前这条用户消息：视觉启用时把图直接喂进去
  if (currentImages.length && input.visionEnabled && input.dataUrlOf) {
    const content: ContentPart[] = []
    const notes = currentImages
      .filter((i) => !input.dataUrlOf!(i.id))
      .map((i) => `[图片：${i.caption ?? i.id}]`)
    content.push({
      type: 'text',
      text: [currentText?.trim(), notes.join(' ')].filter(Boolean).join(' ') || '（用户发来一张图）'
    })
    for (const img of currentImages.slice(0, 3)) {
      const url = input.dataUrlOf(img.id)
      if (url) content.push({ type: 'image_url', image_url: { url } })
    }
    out.push({ role: 'user', content })
  } else if (currentImages.length) {
    const notes = currentImages.map((i) => `[图片：${i.caption ?? i.id}（看不到内容）]`)
    out.push({
      role: 'user',
      content: [currentText?.trim(), notes.join(' ')].filter(Boolean).join(' ')
    })
  } else {
    out.push({ role: 'user', content: currentText })
  }
  void profile
  void config
  return out
}

/** 从模型输出里摘出引用锚点与贴纸；正文保持原样交给渲染端处理 */
export function parseCiteAnchors(text: string): string[] {
  return [...text.matchAll(/<cite\s+id="?(M\d+)"?\s*\/?>/g)].map((m) => m[1])
}

export function parseDrawToken(text: string): string | null {
  const m = text.match(/\[{1,2}\s*draw:\s*([^\]]{3,400})\]{1,2}/i)
  return m ? m[1].trim() : null
}

export function parseStickerToken(text: string): string | null {
  const m = text.match(/[\[【]{1,2}\s*(?:sticker|fish|贴纸|表情包|表情)\s*[:：]\s*([a-z]+)\s*[\]】]{1,2}/i)
  if (!m) return null
  const name = m[1].toLowerCase()
  return (STICKERS as readonly string[]).includes(name) ? name : null
}
