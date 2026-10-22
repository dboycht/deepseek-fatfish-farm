import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ChatMessage, MediaMeta } from '@shared/types'
import { STICKERS } from '@shared/persona'
import { mediaSrc, useStore } from '../state/store'
import { ArtAvatar, ArtPortrait } from './ArtAvatar'
import { RichText } from './Markdown'
import { Sticker } from './Sticker'

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const QUICK: { label: string; text: string }[] = [
  { label: '🍚 喂口饭', text: '（递过去一碗白米饭）' },
  { label: '✨ 夸夸它', text: '你今天好可爱啊。' },
  { label: '💻 让它干活', text: '帮我整理一下今天的待办事项吧。' },
  { label: '🌙 道晚安', text: '我要去睡了，晚安。' }
]

function MessageRow({
  msg,
  fishId,
  hue,
  onZoom,
  locateTarget
}: {
  msg: ChatMessage
  fishId: string
  hue: number
  onZoom: (src: string) => void
  locateTarget: string | null
}): ReactElement {
  const s = useStore()
  const anchorMap = useMemo(() => {
    const anchors = [...msg.text.matchAll(/<cite\s+id="?(M\d+)"?\s*\/?>/gi)].map((m) => m[1])
    const uniq = [...new Set(anchors)]
    const map = new Map<string, string>()
    uniq.forEach((a, i) => {
      const cid = msg.cite?.[i]
      if (cid) map.set(a, cid)
    })
    return map
  }, [msg.text, msg.cite])

  const isMe = msg.role === 'u'
  const showReason = Boolean(msg.reason && s.cfg?.ui.showReasoning)

  return (
    <div className={`msg ${isMe ? 'me' : ''} ${locateTarget === msg.id ? 'flash' : ''}`} id={`msg-${msg.id}`}>
      <div className="avatar">
        {isMe ? (
          <span style={{ fontSize: 16, color: '#cfe6ff' }}>你</span>
        ) : (
          <ArtAvatar hue={hue} size={40} expression={msg.err ? 'cry' : msg.sticker ? 'happy' : 'idle'} />
        )}
      </div>
      <div className="col">
        <div className={`bubble ${msg.err ? 'err' : ''}`}>
          {msg.imgs?.length ? (
            <div className="imgs">
              {msg.imgs.map((id) => (
                <img
                  key={id}
                  src={mediaSrc(fishId, id)}
                  alt="图片"
                  onClick={() => onZoom(mediaSrc(fishId, id, 'src'))}
                />
              ))}
            </div>
          ) : null}
          {msg.text ? (
            <RichText
              text={msg.text}
              fishId={fishId}
              hue={hue}
              citeCardId={(a) => anchorMap.get(a)}
              cardById={s.cardById}
              onLocate={(id) => void s.locateMessage(id)}
              onZoom={onZoom}
            />
          ) : null}
          {msg.sticker ? (
            <div style={{ marginTop: msg.text ? 8 : 0 }}>
              <Sticker name={msg.sticker} hue={hue} size={120} showLabel={false} />
            </div>
          ) : null}
          {!msg.text && !msg.sticker && !msg.err && !msg.imgs?.length ? (
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          ) : null}
          {msg.err ? <div style={{ marginTop: 6, fontSize: 12 }}>⚠ {msg.err}</div> : null}
        </div>

        {showReason ? (
          <details className="reason">
            <summary>
              <span className="chev">▸</span>
              <span>内心 OS</span>
              <span className="reason-hint">（它自己嘀咕的 · 点开）</span>
              <span className="reason-preview">
                {(msg.reason ?? '').replace(/\s+/g, ' ').slice(0, 64)}
              </span>
            </summary>
            <div className="inner">{msg.reason}</div>
          </details>
        ) : null}

        <div className="msg-meta">
          <span>{fmtTime(msg.t)}</span>
          {msg.tok ? (
            <span>
              ↑{msg.tok.i} ↓{msg.tok.o}
            </span>
          ) : null}
          {msg.cite?.length ? <span>引用了 {msg.cite.length} 条记忆</span> : null}
        </div>
      </div>
    </div>
  )
}

export function ChatView({ onZoom }: { onZoom: (src: string) => void }): ReactElement {
  const s = useStore()
  const [draft, setDraft] = useState('')
  const [attached, setAttached] = useState<MediaMeta[]>([])
  const [showStickers, setShowStickers] = useState(false)
  const [drag, setDrag] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [s.messages, s.stream?.text, s.chat?.id])

  const hue = s.fish?.hue ?? 205
  const busy = Boolean(s.stream)
  const wishes = s.stickerState?.wishes ?? []

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text && !attached.length) return
    const ids = attached.map((a) => a.id)
    setDraft('')
    setAttached([])
    setShowStickers(false)
    await s.send(text, ids)
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onPaste = async (e: React.ClipboardEvent): Promise<void> => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    const metas = await s.uploadFiles(files)
    setAttached((prev) => [...prev, ...metas])
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDrag(false)
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    const metas = await s.uploadFiles(files)
    setAttached((prev) => [...prev, ...metas])
  }

  const pick = async (): Promise<void> => {
    const metas = await s.pickImages()
    setAttached((prev) => [...prev, ...metas])
  }

  if (!s.fish) {
    return (
      <div className="chat">
        <div className="empty">
          <ArtPortrait hue={205} size={200} />
          <h3>鱼塘还是空的</h3>
          <p>先创建一只属于你的蓝色大肥鱼吧。它会拥有自己的记忆文件夹，记住你们聊过的每一件小事。</p>
          <button className="btn primary" onClick={() => s.setCreateOpen(true)}>
            创建第一只肥鱼
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat">
      {s.stream?.stage ? (
        <div className="stream-strip">
          <i className="dot" />
          {s.stream.stage}
        </div>
      ) : null}

      <div className="msgs" ref={listRef}>
        {!s.messages.length ? (
          <div className="empty" style={{ minHeight: 260 }}>
            <ArtPortrait hue={hue} size={180} />
            <h3>「{s.fish.name}」在水草边上看着你</h3>
            <p>
              随便说点什么吧。发图片也行 —— 它会记在心里，过几天你提起时，它会翻出那张图给你看。
              <br />
              记忆以压缩卡片的形式存在它自己的文件夹里，随时可以导出、导入。
            </p>
          </div>
        ) : (
          s.messages.map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              fishId={s.fish!.id}
              hue={hue}
              onZoom={onZoom}
              locateTarget={s.locateTarget}
            />
          ))
        )}
      </div>

      <div className="composer">
        {attached.length ? (
          <div className="attach-row">
            {attached.map((a) => (
              <div className="attach" key={a.id}>
                <img src={mediaSrc(s.fish!.id, a.id)} alt={a.name} />
                <button onClick={() => setAttached((prev) => prev.filter((x) => x.id !== a.id))}>×</button>
              </div>
            ))}
          </div>
        ) : null}

        {showStickers ? (
          <div className="sticker-panel">
            <div className="sticker-panel-head">
              <strong>贴纸</strong>
              <span className="hint">缺的表情会被记下来</span>
              <span style={{ flex: 1 }} />
              <button className="btn sm" onClick={() => void s.importStickers('zip')}>
                导入 zip
              </button>
              <button className="btn sm" onClick={() => void s.importStickers('folder')}>
                导入文件夹
              </button>
              <button className="btn sm ghost" onClick={() => void s.openStickerDir()}>
                打开目录
              </button>
              <button className="btn sm ghost" onClick={() => setShowStickers(false)}>
                收起
              </button>
            </div>

            <div className="sticker-scroll">
              <div className="sticker-section-head">内置</div>
              <div className="sticker-picker">
                {STICKERS.map((name) => (
                  <button
                    key={name}
                    title={name}
                    onClick={() => {
                      setShowStickers(false)
                      void s.send('', [], name)
                    }}
                  >
                    <Sticker name={name} hue={hue} size={56} showLabel={false} />
                  </button>
                ))}
              </div>

              {(s.stickerState?.packs ?? [])
                .filter((p) => !p.builtin)
                .map((pack) => (
                  <div key={pack.id}>
                    <div className="sticker-section-head">
                      <span>{pack.name}</span>
                      <span className="tag">{pack.items.length}</span>
                      <button
                        className="link"
                        onClick={() => {
                          if (window.confirm(`删除贴纸包「${pack.name}」？`)) void s.removeStickerPack(pack.id)
                        }}
                      >
                        删除
                      </button>
                    </div>
                    <div className="sticker-picker">
                      {pack.items.map((it) => (
                        <button
                          key={it.id}
                          title={it.label}
                          onClick={() => {
                            setShowStickers(false)
                            void s.send('', [], it.id)
                          }}
                        >
                          <Sticker name={it.id} hue={hue} size={56} showLabel={false} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

              {!(s.stickerState?.packs ?? []).some((p) => !p.builtin) ? (
                <div className="hint" style={{ padding: '4px 2px' }}>
                  还没有导入过贴纸包。可以用 GPT 批量画好，再「导入 zip / 文件夹」；
                  缺的表情会自动记录，导出的需求清单里直接带好了给 GPT 的提示词。
                </div>
              ) : null}
            </div>

            <div className="sticker-wishes">
              <div>
                <strong>缺少的表情</strong>{' '}
                {!wishes.length ? (
                  <span className="hint">还没有记录</span>
                ) : (
                  wishes.slice(0, 10).map((w) => (
                    <span className="wish" key={w.key} title={w.samples[0] ?? w.key}>
                      {w.key} ×{w.count}
                    </span>
                  ))
                )}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void s.exportStickerWishes()}>
                  导出需求清单（含 GPT 提示词）
                </button>
                {wishes.length ? (
                  <button className="btn sm ghost" onClick={() => void s.clearStickerWishes()}>
                    清空记录
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={`input-wrap ${drag ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => void onDrop(e)}
        >
          <textarea
            ref={taRef}
            value={draft}
            placeholder={`跟「${s.fish.name}」说点什么…（Enter 发送 / Shift+Enter 换行，可直接粘贴或拖入图片）`}
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.target as HTMLTextAreaElement
              el.style.height = 'auto'
              el.style.height = `${Math.min(168, el.scrollHeight)}px`
            }}
            onPaste={(e) => void onPaste(e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className="tools">
            <button className="tool" title="发图片" onClick={() => void pick()}>
              🖼
            </button>
            <button className="tool" title="发贴纸" data-testid="sticker-toggle" onClick={() => setShowStickers((v) => !v)}>
              🐟
            </button>
            {busy ? (
              <button className="tool" title="打断它" onClick={() => void s.abort()}>
                ⏹
              </button>
            ) : null}
            <button className="send" disabled={!draft.trim() && !attached.length} onClick={() => void submit()}>
              发送
            </button>
          </div>
        </div>

        <div className="hint-row">
          <div className="quick-actions">
            {QUICK.map((q) => (
              <button
                key={q.label}
                className="btn sm ghost"
                onClick={() => {
                  setDraft(q.text)
                  taRef.current?.focus()
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <span>
            <kbd>Enter</kbd> 发送
          </span>
          <span>
            <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行
          </span>
        </div>
      </div>
    </div>
  )
}
