import { useState, type ReactElement } from 'react'
import { flavorFromSeed, personaFromSeed, randomSeed } from '@shared/persona'
import { useStore } from '../state/store'
import { ArtAvatar, ArtPortrait } from './ArtAvatar'

export function CreateFishModal(): ReactElement | null {
  const s = useStore()
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [hue, setHue] = useState(205)
  const [seed, setSeed] = useState(() => randomSeed())
  const [busy, setBusy] = useState(false)

  if (!s.createOpen) return null

  const persona = personaFromSeed(seed)
  const flavor = flavorFromSeed(seed, name || '大肥鱼')
  const rows: { k: keyof typeof persona; label: string }[] = [
    { k: 'appetite', label: '贪吃' },
    { k: 'clingy', label: '黏人' },
    { k: 'tsundere', label: '傲娇' },
    { k: 'mischief', label: '调皮' },
    { k: 'laziness', label: '摸鱼' },
    { k: 'sleepy', label: '犯困' }
  ]

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      s.toast('先给它起个名字吧', 'err')
      return
    }
    setBusy(true)
    try {
      await s.createFish({ name: name.trim(), hue, tagline: tagline.trim() || undefined, seed })
      s.setCreateOpen(false)
      setName('')
      setTagline('')
      setSeed(randomSeed())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={() => s.setCreateOpen(false)}>
      <div className="modal" style={{ width: 'min(720px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <ArtAvatar hue={hue} size={30} expression="happy" />
          <h2>养一条新的肥鱼</h2>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => s.setCreateOpen(false)}>
            关闭
          </button>
        </div>
        <div className="modal-body">
          <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
            <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
              <ArtPortrait hue={hue} size={196} />
              <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>外观预览（会随手感色相变化）</span>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <label>名字</label>
                <input
                  type="text"
                  value={name}
                  autoFocus
                  maxLength={24}
                  placeholder="比如：小肥、鲸鲸、白饭终结者"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit()
                  }}
                />
              </div>
              <div className="field">
                <label>一句话简介（可留空）</label>
                <input
                  type="text"
                  value={tagline}
                  maxLength={60}
                  placeholder="一只住在鱼塘里、见饭眼开的蓝色大肥鱼"
                  onChange={(e) => setTagline(e.target.value)}
                />
              </div>
              <div className="field">
                <label>体色</label>
                <div className="slider-row">
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>色相 {hue}</span>
                  <input type="range" min={170} max={250} value={hue} onChange={(e) => setHue(Number(e.target.value))} />
                  <span className="val">蓝</span>
                </div>
              </div>
              <div className="field">
                <label>性格骰子</label>
                <div className="row">
                  <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                    🎲 重掷性格
                  </button>
                  <span className="hint">每只鱼的性格由种子决定，独一无二、之后可以在档案里微调。</span>
                </div>
              </div>
            </div>
          </div>

          <div className="section-title">性格预览</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px' }}>
            {rows.map((r) => (
              <div className="slider-row" key={r.k}>
                <span>{r.label}</span>
                <div className="meter" style={{ width: '100%' }}>
                  <div className="bar">
                    <i
                      style={{
                        width: `${persona[r.k]}%`,
                        background: 'linear-gradient(90deg, rgba(90,210,255,.9), rgba(120,120,255,.9))'
                      }}
                    />
                  </div>
                </div>
                <span className="val">{persona[r.k]}</span>
              </div>
            ))}
          </div>

          <div className="hint" style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.7 }}>
            它的专属习惯：口头禅「{flavor.phrase}」· 最爱吃{flavor.food} · {flavor.quirk}。
            创建后会在鱼塘里得到独立文件夹（档案 / 会话 / 记忆 / 图片分开存放）。
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={() => s.setCreateOpen(false)}>
            取消
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? '正在放鱼入塘…' : '开始养它'}
          </button>
        </div>
      </div>
    </div>
  )
}
