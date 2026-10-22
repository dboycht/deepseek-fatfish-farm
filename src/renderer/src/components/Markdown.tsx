import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, useState, type ReactElement } from 'react'
import type { MemoryCard } from '@shared/types'
import { mediaSrc } from '../state/store'
import { Sticker } from './Sticker'

marked.setOptions({ gfm: true, breaks: true })

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span'
]

export function htmlOf(md: string): string {
  const html = marked.parse(md) as string
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'title', 'class', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i
  })
  // 标签之间的换行在 pre-wrap 时代会变成空行；这里统一收紧
  return clean.replace(/>\s+</g, '><').trim()
}

const CITE_RE = /<cite\s+id="?(M\d+)"?\s*\/?>/gi
const CITE_PLACEHOLDER_RE = /\[\[CITE:(M\d+)\]\]/g
/** 兼容模型偶尔写成的单层方括号 [fish:shy] */
const STICKER_RE = /\[{1,2}\s*fish:\s*([a-z]+)\s*\]{1,2}/gi

export interface CitePopoverProps {
  anchor: string
  card?: MemoryCard
  fishId: string
  x: number
  y: number
  onClose: () => void
  onLocate: (msgId: string) => void
  onZoom: (src: string) => void
}

function CitePopover({ anchor, card, fishId, x, y, onClose, onLocate, onZoom }: CitePopoverProps): ReactElement {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={onClose} />
      <div className="cite-pop" style={{ left: x, top: y }}>
        <div className="h">
          <span>记忆 · {card ? new Date(card.t).toLocaleString('zh-CN') : '未知时间'}</span>
          <span style={{ flex: 1 }} />
          {card?.pin ? <span title="已钉选">📌</span> : <span>{anchor}</span>}
        </div>
        <div>{card?.text ?? '这条记忆已经被删掉了'}</div>
        {card?.img?.length ? (
          <img
            src={mediaSrc(fishId, card.img[0])}
            alt="记忆里的图"
            onClick={(e) => {
              e.stopPropagation()
              onZoom(mediaSrc(fishId, card.img![0], 'src'))
            }}
          />
        ) : null}
        <div className="go">
          {card?.src?.[0] ? (
            <button
              className="btn sm"
              onClick={() => {
                onLocate(card.src[0])
                onClose()
              }}
            >
              回到原话
            </button>
          ) : null}
          <button className="btn sm ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </>
  )
}

export interface RichTextProps {
  text: string
  fishId: string
  hue?: number
  citeCardId?: (anchor: string) => string | undefined
  cardById: (id: string) => MemoryCard | undefined
  onLocate: (msgId: string) => void
  onZoom: (src: string) => void
}

/**
 * 富文本渲染：
 * 1. 引用锚点先换成占位符，整体过 markdown（保持行内文本流，不会被拆成多个 <p>）；
 * 2. DOMPurify 清洗后再把占位符换成引用按钮（内容全部由本地数据生成，安全）；
 * 3. 贴纸 token 摘出来，作为气泡内的图块渲染。
 */
export function RichText({
  text,
  fishId,
  hue = 205,
  citeCardId,
  cardById,
  onLocate,
  onZoom
}: RichTextProps): ReactElement {
  const [pop, setPop] = useState<{ anchor: string; x: number; y: number } | null>(null)

  const { html, stickers } = useMemo(() => {
    const found: string[] = []
    const stripped = text.replace(STICKER_RE, (_m, name: string) => {
      found.push(String(name).toLowerCase())
      return ''
    })
    const markedDown = stripped.replace(CITE_RE, (_m, anchor: string) => `[[CITE:${anchor}]]`)
    let out = htmlOf(markedDown)
    out = out.replace(CITE_PLACEHOLDER_RE, (_m, anchor: string) => {
      const cid = citeCardId?.(anchor)
      const card = cid ? cardById(cid) : undefined
      const label = card
        ? new Date(card.t).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
        : anchor
      const safe = label.replace(/[^\d./M-]/g, '')
      return `<button type="button" class="cite" data-anchor="${anchor}" title="这条话是从记忆里翻出来的">📎 ${safe}</button>`
    })
    return { html: out, stickers: found }
  }, [text, citeCardId, cardById])

  const onClick = (e: React.MouseEvent): void => {
    const el = (e.target as HTMLElement).closest('[data-anchor]') as HTMLElement | null
    if (!el) return
    const r = el.getBoundingClientRect()
    const estHeight = 360
    const below = r.bottom + 8
    const top = below + estHeight > window.innerHeight ? Math.max(10, r.top - estHeight - 8) : below
    setPop({
      anchor: el.dataset.anchor ?? 'M1',
      x: Math.max(8, Math.min(r.left, window.innerWidth - 340)),
      y: top
    })
  }

  const cid = pop ? citeCardId?.(pop.anchor) : undefined

  return (
    <>
      <div className="rt" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {stickers.length ? (
        <div className="msg-stickers">
          {stickers.map((name, i) => (
            <Sticker key={`${name}-${i}`} name={name} hue={hue} size={112} showLabel={false} />
          ))}
        </div>
      ) : null}
      {pop ? (
        <CitePopover
          anchor={pop.anchor}
          card={cid ? cardById(cid) : undefined}
          fishId={fishId}
          x={pop.x}
          y={pop.y}
          onClose={() => setPop(null)}
          onLocate={onLocate}
          onZoom={onZoom}
        />
      ) : null}
    </>
  )
}

/** 仅摘取贴纸 token（供外部统计/渲染用） */
export function stickerTokens(text: string): string[] {
  return [...text.matchAll(STICKER_RE)].map((m) => m[1].toLowerCase())
}
