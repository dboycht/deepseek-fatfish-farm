import { useMemo, useState, type ReactElement } from 'react'
import type { MemoryCard } from '@shared/types'
import { mediaSrc, useStore } from '../state/store'
import { ArtAvatar } from './ArtAvatar'

const KIND_LABEL: Record<string, string> = {
  fact: '事实',
  event: '事件',
  pref: '喜好',
  person: '人物',
  promise: '约定',
  mood: '心情'
}

function fmtDate(t: number): string {
  return new Date(t).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function MemoryRow({ card, onZoom }: { card: MemoryCard; onZoom: (s: string) => void }): ReactElement {
  const s = useStore()
  const [open, setOpen] = useState(false)
  return (
    <div className={`mcard ${card.pin ? 'pinned' : ''} ${card.arch ? 'arch' : ''}`}>
      <div className="top">
        <span className={`kind ${card.pin ? '' : card.kind} ${card.arch ? 'arch' : ''}`}>
          {card.arch ? '归档' : KIND_LABEL[card.kind] ?? card.kind}
        </span>
        <span className="date">{fmtDate(card.t)}</span>
        <span className="acts">
          <button title={card.pin ? '取消钉选' : '钉选（回忆时优先）'} onClick={() => void s.pinCard(card.id, !card.pin)}>
            📌
          </button>
          {card.src?.length ? (
            <button
              title="回到原话"
              onClick={() => {
                void s.locateMessage(card.src[0])
                setOpen(true)
              }}
            >
              ↩
            </button>
          ) : null}
          <button title="删掉这条记忆" onClick={() => void s.deleteCard(card.id)}>
            🗑
          </button>
        </span>
      </div>
      <div className="tx">{card.text}</div>
      {card.tags?.length ? (
        <div className="tags">
          {card.tags.slice(0, 6).map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
          {card.hit > 0 ? <span className="tag">被想起 {card.hit} 次</span> : null}
        </div>
      ) : null}
      {card.img?.length && s.fish ? (
        <div className="thumb">
          <img src={mediaSrc(s.fish.id, card.img[0])} alt="关联图片" onClick={() => onZoom(mediaSrc(s.fish!.id, card.img![0], 'src'))} />
        </div>
      ) : null}
      {open && card.src?.[0] ? <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>已跳到原话</div> : null}
    </div>
  )
}

export function MemoryPanel({ onZoom }: { onZoom: (s: string) => void }): ReactElement {
  const s = useStore()
  const [tab, setTab] = useState<'memory' | 'gallery' | 'plugins'>('memory')
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    if (!q.trim()) return s.cards
    const k = q.trim().toLowerCase()
    return s.cards.filter(
      (c) => c.text.toLowerCase().includes(k) || c.tags.some((t) => t.toLowerCase().includes(k))
    )
  }, [s.cards, q])

  const kb = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`)

  return (
    <aside className="panel right">
      <div className="mem-head">
        <div className="mem-tabs">
          <button className={`tab ${tab === 'memory' ? 'active' : ''}`} onClick={() => setTab('memory')}>
            记忆池
          </button>
          <button className={`tab ${tab === 'gallery' ? 'active' : ''}`} onClick={() => setTab('gallery')}>
            相册
          </button>
          <button className={`tab ${tab === 'plugins' ? 'active' : ''}`} onClick={() => setTab('plugins')}>
            插件
          </button>
        </div>

        {tab === 'memory' ? (
          <>
            <div className="mem-stats">
              <div className="stat">
                <div className="k">记忆卡片</div>
                <div className="v">
                  {s.memStats?.cards ?? 0}
                  <small>条</small>
                </div>
              </div>
              <div className="stat">
                <div className="k">归档压缩</div>
                <div className="v">
                  {s.memStats?.archived ?? 0}
                  <small>张</small>
                </div>
              </div>
              <div className="stat">
                <div className="k">记忆体积</div>
                <div className="v">{kb(s.memStats?.bytes ?? 0)}</div>
              </div>
              <div className="stat">
                <div className="k">约合 token</div>
                <div className="v">≈{s.memStats?.approxTokens ?? 0}</div>
              </div>
            </div>
            <div className="mem-tools">
              <button className="btn sm" onClick={() => void s.distillMemory(true)}>
                回味一次
              </button>
              <button className="btn sm" onClick={() => void s.compactMemory()}>
                压缩归档
              </button>
              <button className="btn sm" onClick={() => void s.exportMemory()}>
                导出
              </button>
              <button className="btn sm" onClick={() => void s.importBundle()}>
                导入
              </button>
            </div>
            <div className="mem-search">
              <input type="text" placeholder="搜记忆（按关键词）" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </>
        ) : null}
      </div>

      {tab === 'memory' ? (
        <div className="mem-list">
          {!filtered.length ? (
            <div className="empty" style={{ padding: 16 }}>
              <ArtAvatar hue={s.fish?.hue ?? 205} size={84} expression="sleepy" />
              <p>
                还没有记忆。跟她聊几句，然后点「回味一次」——它会自己把对话压成英文小卡片，存在自己的文件夹里。
              </p>
            </div>
          ) : (
            filtered.map((c) => <MemoryRow key={c.id} card={c} onZoom={onZoom} />)
          )}
        </div>
      ) : null}

      {tab === 'gallery' ? (
        <div className="mem-list">
          {!s.media.length ? (
            <div className="empty" style={{ padding: 16 }}>
              <p>相册还是空的。在聊天框里发一张图，它会留在这里，也会被写进记忆。</p>
            </div>
          ) : (
            <div className="gallery">
              {s.media.map((m) => (
                <figure key={m.id} onClick={() => s.fish && onZoom(mediaSrc(s.fish.id, m.id, 'src'))}>
                  <img src={mediaSrc(s.fish!.id, m.id)} alt={m.name} />
                  <figcaption title={m.caption ?? m.name}>{m.caption ?? m.name}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'plugins' ? (
        <div className="mem-list">
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => void s.reloadPlugins()}>
              重新扫描
            </button>
            <button className="btn sm" onClick={() => void window.farm.plugins.dir('user').then((d) => window.farm.app.openPath(d))}>
              打开插件目录
            </button>
          </div>
          {s.plugins.map((p) => (
            <div className="plugin-row" key={p.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="n">
                  {p.name}
                  {p.builtin ? <span className="tag">内置</span> : null}
                  {!p.loaded ? <span className="tag" style={{ color: 'var(--coral)' }}>加载失败</span> : null}
                </div>
                <div className="d">{p.description ?? '（没有写简介）'}</div>
                <div className="meta">
                  <span>v{p.version}</span>
                  <span>{p.id}</span>
                  {p.author ? <span>{p.author}</span> : null}
                  {p.permissions?.length ? <span>权限：{p.permissions.join('、')}</span> : null}
                </div>
                {p.error ? <div className="d" style={{ color: 'var(--coral)' }}>{p.error}</div> : null}
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {p.panel ? (
                    <button className="btn sm" onClick={() => s.setPanelPlugin(p)}>
                      打开面板
                    </button>
                  ) : null}
                  {p.commands?.map((c) => (
                    <button
                      key={c.id}
                      className="btn sm ghost"
                      onClick={() =>
                        void s
                          .invokePlugin(p.id, c.id, { fishId: s.fish?.id })
                          .then((r) => s.toast(typeof r === 'string' ? r : `插件 ${p.name} 执行完毕`, 'ok'))
                          .catch((e) => s.toast((e as Error).message, 'err'))
                      }
                    >
                      {c.title}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className={`switch ${p.enabled ? 'on' : ''}`}
                title={p.enabled ? '停用' : '启用'}
                onClick={() => void s.togglePlugin(p.id, !p.enabled)}
              >
                <i />
              </button>
            </div>
          ))}
          <div className="empty" style={{ padding: 10 }}>
            <p style={{ fontSize: 11.5 }}>
              插件放在 <code>plugins/&lt;id&gt;/</code>，一个 manifest.json 就能让软件长出新的能力：面板写 HTML，
              逻辑写 CommonJS 的 activate(api)。示例插件「稻田日记」可以在面板里看到它吃了多少饭。
            </p>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
