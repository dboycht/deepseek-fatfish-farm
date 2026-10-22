import type { ReactElement } from 'react'
import { STICKER_LABEL } from '@shared/persona'
import { stickerSrc } from '@shared/stickers'
import { useStore } from '../state/store'
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

/**
 * 贴纸渲染：
 *  - 先找用户导入的贴纸包（fatfish-sticker:// 图片）；
 *  - 找不到再回退到内置的 12 个代码绘制表情。
 */
export function Sticker({ name, hue = 210, size = 132, showLabel = true }: StickerProps): ReactElement {
  const s = useStore()
  const custom = s.stickerState?.packs
    .filter((p) => !p.builtin)
    .flatMap((p) => p.items.map((i) => ({ ...i, packId: p.id })))
    .find((i) => i.id === name && i.file)

  if (custom?.packId) {
    const radius = Math.round(size * 0.26)
    return (
      <div className="sticker" style={{ width: size, height: size }} title={custom.label}>
        <div
          className="sticker-card"
          style={{
            borderRadius: radius,
            background: `linear-gradient(160deg, hsl(${hue + 4} 60% 22% / 0.9), hsl(${hue + 26} 60% 10% / 0.9))`
          }}
        >
          <img
            src={stickerSrc(custom.packId, custom.file)}
            alt={custom.label}
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
          {showLabel && (
            <span className="sticker-label" style={{ fontSize: Math.max(9, size * 0.1) }}>
              {custom.label}
            </span>
          )}
        </div>
      </div>
    )
  }

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
