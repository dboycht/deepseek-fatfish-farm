import { useMemo, type ReactElement } from 'react'
import { expForLevel, moodWord } from '@shared/persona'
import { useStore } from '../state/store'
import { ArtAvatar } from './ArtAvatar'

export function FishTank(): ReactElement {
  const s = useStore()
  const fish = s.fish

  const bubbles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: `${(i * 7.3 + (i % 3) * 4) % 96}%`,
        size: 4 + ((i * 3) % 9),
        delay: `${(i * 0.83) % 7}s`,
        duration: `${5 + ((i * 1.7) % 5)}s`
      })),
    []
  )

  if (!fish) {
    return (
      <div className="tank">
        <div className="bubbles">
          {bubbles.map((b, i) => (
            <i
              key={i}
              style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay, animationDuration: b.duration }}
            />
          ))}
        </div>
        <div className="tank-top">
          <div className="who">
            <h1>鱼塘</h1>
            <div className="tagline">还没有鱼。创建一只，它就会在这里游起来。</div>
          </div>
        </div>
      </div>
    )
  }

  const { stats, persona, flavor } = fish
  const expression =
    stats.hunger >= 82 ? 'hungry' : stats.mood >= 78 ? 'happy' : stats.hunger >= 60 ? 'idle' : 'sleepy'
  const levelBase = expForLevel(stats.level)
  const levelNeed = Math.max(1, expForLevel(stats.level + 1) - levelBase)
  const levelPct = Math.max(0, Math.min(100, ((stats.exp - levelBase) / levelNeed) * 100))

  return (
    <div className="tank">
      <div className="bubbles">
        {bubbles.map((b, i) => (
          <i
            key={i}
            style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay, animationDuration: b.duration }}
          />
        ))}
      </div>

      <div className="tank-top">
        <div className="bob" style={{ marginBottom: -4 }}>
          <ArtAvatar hue={fish.hue} size={72} expression={expression} mode="full" radius={16} />
        </div>
        <div className="who">
          <h1 title={fish.name}>
            <span className="fish-name">{fish.name}</span>
            <span className="pill">Lv.{stats.level}</span>
            <span className="pill">{moodWord(stats.mood, stats.hunger)}</span>
          </h1>
          <div className="tagline" title={`${fish.tagline} · 口头禅「${flavor.phrase}」· 最爱${flavor.food} · ${flavor.quirk}`}>
            {fish.tagline} · 口头禅「{flavor.phrase}」· 最爱{flavor.food}
          </div>
        </div>
        <div className="tank-actions">
          <button className="btn primary" onClick={() => void s.feed()} title="喂一碗白米饭">
            🍚 喂饭
          </button>
          <button className="btn icon" onClick={() => void s.distillMemory(true)} title="把刚才的对话压成记忆卡片">
            🧠
          </button>
          <button className="btn icon" onClick={() => void s.exportMemory()} title="导出记忆包">
            🧾
          </button>
          <button
            className="btn icon"
            title="打开它的文件夹"
            onClick={() => s.fish && void window.farm.fish.reveal(s.fish.id)}
          >
            📂
          </button>
        </div>
      </div>

      <div className="tank-bottom">
        <div className="meters">
          <div className="meter mood">
            <div className="lab">
              <span>心情</span>
              <span>{Math.round(stats.mood)}</span>
            </div>
            <div className="bar">
              <i style={{ width: `${stats.mood}%` }} />
            </div>
          </div>
          <div className="meter hunger">
            <div className="lab">
              <span>饿度</span>
              <span>{Math.round(stats.hunger)}</span>
            </div>
            <div className="bar">
              <i style={{ width: `${stats.hunger}%` }} />
            </div>
          </div>
          <div className="meter">
            <div className="lab">
              <span>成长</span>
              <span>{Math.round(levelPct)}%</span>
            </div>
            <div className="bar">
              <i style={{ width: `${levelPct}%`, background: 'linear-gradient(90deg,#7ff0d0,#5ad2ff)' }} />
            </div>
          </div>
        </div>
        <div className="tank-meta">
          <span>token {stats.tokens.toLocaleString()}</span>
          <span>·</span>
          <span>白米饭 {stats.meals} 碗</span>
          <span>·</span>
          <span>记忆 {stats.memories} 条</span>
          <span>·</span>
          <span>
            {persona.appetite > 60 ? '贪吃' : '斯文'} / {persona.tsundere > 60 ? '傲娇' : '坦率'} /{' '}
            {persona.laziness > 60 ? '爱摸鱼' : '勤快'}
          </span>
        </div>
        <div className="tank-actions">
          <button className="btn sm ghost" onClick={() => void s.exportFish()} title="导出整只肥鱼（档案+会话+记忆+图片）">
            导出整只鱼
          </button>
        </div>
      </div>
    </div>
  )
}
