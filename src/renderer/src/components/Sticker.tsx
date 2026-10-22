import type { ReactElement } from 'react'
import { STICKER_LABEL } from '@shared/persona'
import { ArtAvatar, type ArtExpression } from './ArtAvatar'

const EXPR: Record<string, ArtExpression> = {
  joy: 'happy',
  hungry: 'hungry',
  rice: 'rice',
  sleepy: 'sleepy',
  proud: 'proud',
  shy: 'shy',
  angry: 'angry',
  cry: 'cry',
  work: 'work',
  love: 'love',
  dizzy: 'dizzy',
  smug: 'smug'
}

const DECOR: Record<string, string> = {
  joy: '✨',
  hungry: '🍚',
  rice: '🍚',
  sleepy: '💤',
  proud: '⭐',
  shy: '💗',
  angry: '💢',
  cry: '💧',
  work: '💻',
  love: '💞',
  dizzy: '💫',
  smug: '😏'
}

export interface StickerProps {
  name: string
  hue?: number
  size?: number
  showLabel?: boolean
}

/** 内置贴纸：从授权表情表里取一格，加一个渐变底与情绪点缀 */
export function Sticker({ name, hue = 210, size = 132, showLabel = true }: StickerProps): ReactElement {
  const expr = EXPR[name] ?? 'happy'
  const decor = DECOR[name] ?? '✨'
  const radius = Math.round(size * 0.26)

  return (
    <div className="sticker" style={{ width: size, height: size }} title={STICKER_LABEL[name] ?? name}>
      <div
        className="sticker-card"
        style={{
          borderRadius: radius,
          background: `linear-gradient(160deg, hsl(${hue + 4} 74% 28% / 0.96), hsl(${hue + 26} 72% 12% / 0.96))`
        }}
      >
        <ArtAvatar expression={expr} hue={hue} size={size * 0.9} mode="full" radius={radius - 2} />
        <span className="sticker-decor" style={{ fontSize: size * 0.17 }}>
          {decor}
        </span>
        {showLabel && (
          <span className="sticker-label" style={{ fontSize: Math.max(9, size * 0.1) }}>
            {STICKER_LABEL[name] ?? name}
          </span>
        )}
      </div>
    </div>
  )
}
