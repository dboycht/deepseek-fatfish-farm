import type { ReactElement } from 'react'
import sheetUrl from '../assets/art/expressions.png'
import portraitUrl from '../assets/art/portrait.png'

/**
 * 角色立绘与表情。
 *
 * 素材来源：YunYueSama/codex-deepseek-pet（大肥鱼项目署名许可 1.0，
 * 允许使用 / 修改 / 分享 / 商用，须署名并保留许可）。
 * 详见仓库根目录 THIRD_PARTY_ART.md 与 resources/art/LICENSE.txt。
 * 表情表为 4×4 共 16 格、每格 512×512（见 resources/art/manifest.json）。
 */

export type ArtExpression =
  | 'idle'
  | 'happy'
  | 'hungry'
  | 'sleepy'
  | 'shy'
  | 'angry'
  | 'cry'
  | 'work'
  | 'love'
  | 'dizzy'
  | 'smug'
  | 'proud'
  | 'joy'
  | 'rice'

/** [列, 行]，从 0 开始 */
const CELLS: Record<ArtExpression, [number, number]> = {
  idle: [0, 0],
  shy: [1, 0],
  work: [0, 1],
  rice: [2, 1],
  happy: [3, 1],
  joy: [3, 1],
  proud: [3, 1],
  love: [3, 1],
  hungry: [0, 2],
  dizzy: [1, 2],
  angry: [2, 2],
  smug: [3, 2],
  cry: [2, 3],
  sleepy: [3, 3]
}

/** 把「格内焦点」换算成 background-position 百分比 */
function positionPct(cell: number, focus: number, zoom: number): number {
  const k = 4 * zoom
  const raw = (((cell + focus) * k) / 4 - 0.5) / (k - 1)
  return Math.max(0, Math.min(100, raw * 100))
}

export interface ArtAvatarProps {
  expression?: ArtExpression
  size?: number
  hue?: number
  /** face = 只取头部特写；full = 整个小人 */
  mode?: 'face' | 'full'
  radius?: number
  className?: string
  title?: string
}

export function ArtAvatar({
  expression = 'idle',
  size = 44,
  hue = 210,
  mode = 'face',
  radius = 12,
  className,
  title
}: ArtAvatarProps): ReactElement {
  const [col, row] = CELLS[expression] ?? CELLS.idle
  const zoom = mode === 'face' ? 2.1 : 1.02
  const focusX = mode === 'face' ? 0.5 : 0.5
  const focusY = mode === 'face' ? 0.4 : 0.5
  const k = 4 * zoom

  return (
    <span
      className={`art-avatar ${className ?? ''}`}
      role="img"
      aria-label={title ?? '蓝色大肥鱼'}
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundImage: `url(${sheetUrl})`,
        backgroundSize: `${k * 100}% ${k * 100}%`,
        backgroundPosition: `${positionPct(col, focusX, zoom)}% ${positionPct(row, focusY, zoom)}%`,
        filter: `hue-rotate(${hue - 210}deg) saturate(1.04)`
      }}
    />
  )
}

export function ArtPortrait({
  size = 260,
  hue = 210,
  className,
  animated = true
}: {
  size?: number
  hue?: number
  className?: string
  animated?: boolean
}): ReactElement {
  return (
    <img
      src={portraitUrl}
      width={size}
      height={size}
      alt="蓝色大肥鱼立绘"
      draggable={false}
      className={`art-portrait ${animated ? 'bob' : ''} ${className ?? ''}`}
      style={{ filter: `hue-rotate(${hue - 210}deg) drop-shadow(0 18px 32px rgba(20,90,180,0.35))` }}
    />
  )
}
