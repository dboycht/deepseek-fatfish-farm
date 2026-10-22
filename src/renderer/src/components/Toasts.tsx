import { useEffect, type ReactElement } from 'react'
import { useStore } from '../state/store'
import { ArtAvatar } from './ArtAvatar'

export function Toasts(): ReactElement {
  const s = useStore()
  return (
    <div className="toasts">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => s.dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function PluginFrame(): ReactElement | null {
  const s = useStore()
  const p = s.panelPlugin
  if (!p) return null
  const src = `fatfish-plugin://${p.id}/${p.panel?.entry ?? 'panel.html'}`
  return (
    <div className="plugin-frame-wrap">
      <header>
        <ArtAvatar hue={s.fish?.hue ?? 205} size={22} expression="work" />
        <strong>{p.panel?.title ?? p.name}</strong>
        <span className="tag">{p.id}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={() => s.setPanelPlugin(null)}>
          收起
        </button>
      </header>
      <iframe
        title={p.name}
        src={src}
        sandbox="allow-scripts allow-forms allow-same-origin"
        onLoad={(e) => {
          const frame = e.currentTarget
          const send = (): void =>
            frame.contentWindow?.postMessage(
              {
                type: 'farm:init',
                pluginId: p.id,
                context: {
                  fishId: s.fish?.id,
                  fishName: s.fish?.name,
                  hue: s.fish?.hue,
                  stats: s.fish?.stats,
                  memories: s.memStats?.cards ?? 0,
                  theme: s.cfg?.ui.theme
                }
              },
              '*'
            )
          send()
        }}
      />
      <PluginBridge pluginId={p.id} />
    </div>
  )
}

/** iframe 面板 ↔ 主进程桥：面板发 postMessage，这里转成 plugins:invoke */
function PluginBridge({ pluginId }: { pluginId: string }): ReactElement | null {
  const s = useStore()
  usePluginMessages(async (data) => {
    if (data?.type === 'farm:invoke' && typeof data.command === 'string') {
      try {
        const r = await s.invokePlugin(pluginId, data.command, data.payload)
        postToPlugin(pluginId, { type: 'farm:result', id: data.id, ok: true, result: r })
      } catch (e) {
        postToPlugin(pluginId, { type: 'farm:result', id: data.id, ok: false, error: (e as Error).message })
        s.toast((e as Error).message, 'err')
      }
    }
    if (data?.type === 'farm:toast' && typeof data.text === 'string') {
      s.toast(data.text, data.kind === 'err' ? 'err' : 'ok')
    }
  })
  return null
}

function usePluginMessages(handler: (data: any) => void | Promise<void>): void {
  useEffect(() => {
    const listener = (e: MessageEvent): void => {
      const d = e.data
      if (!d || typeof d !== 'object') return
      if (typeof d.type === 'string' && d.type.startsWith('farm:')) void handler(d)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [handler])
}

function postToPlugin(pluginId: string, payload: unknown): void {
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    if (frame.getAttribute('src')?.includes(pluginId)) {
      frame.contentWindow?.postMessage(payload, '*')
    }
  }
}
