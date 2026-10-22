import type { ReactElement } from 'react'
import { useStore } from '../state/store'
import { ArtAvatar } from './ArtAvatar'

function hungerClass(hunger: number): string {
  if (hunger >= 80) return 'hunger bad'
  if (hunger >= 55) return 'hunger warn'
  return 'hunger'
}

export function Rail(): ReactElement {
  const s = useStore()
  return (
    <aside className="rail">
      {s.fishList.map((f) => (
        <button
          key={f.id}
          className={`fish-chip ${f.id === s.fish?.id ? 'active' : ''}`}
          onClick={() => void s.selectFish(f.id)}
          title={`${f.name} · ${f.tagline}`}
        >
          <i className={hungerClass(f.stats.hunger)} />
          <ArtAvatar
            hue={f.hue}
            size={44}
            expression={f.stats.hunger >= 80 ? 'hungry' : f.stats.mood >= 75 ? 'happy' : 'idle'}
          />
          <span className="name">{f.name}</span>
        </button>
      ))}
      <button className="rail-add" onClick={() => s.setCreateOpen(true)}>
        ＋ 新肥鱼
      </button>
      <button className="rail-add" onClick={() => void s.importBundle()}>
        ⇩ 导入
      </button>
    </aside>
  )
}

export function ChatList(): ReactElement {
  const s = useStore()
  const fmt = (t: number): string => {
    const d = new Date(t)
    const today = new Date()
    const sameDay = d.toDateString() === today.toDateString()
    return sameDay ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : `${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <span>对话</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => void s.newChat(true)} title="开一个新对话">
          ＋ 新对话
        </button>
      </div>
      <div className="chat-list">
        {!s.chats.length ? (
          <div className="empty" style={{ padding: 12 }}>
            <p>还没有对话。点上面「新对话」，它会探出头来跟你说第一句话。</p>
          </div>
        ) : (
          s.chats.map((c) => (
            <div
              key={c.id}
              className={`chat-item ${c.id === s.chat?.id ? 'active' : ''}`}
              onClick={() => void s.selectChat(c.id)}
            >
              <div className="t">{c.title || '新的对话'}</div>
              <div className="m">
                <span>{fmt(c.updated)}</span>
                <span>{c.count} 条</span>
              </div>
              <button
                className="x"
                title="删除对话"
                onClick={(e) => {
                  e.stopPropagation()
                  void s.removeChat(c.id)
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
