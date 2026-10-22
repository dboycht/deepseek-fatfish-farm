import { useEffect, useState, type ReactElement } from 'react'
import { useStore } from './state/store'
import { ChatList, Rail } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { FishTank } from './components/FishTank'
import { MemoryPanel } from './components/MemoryPanel'
import { Onboarding } from './components/Onboarding'
import { CreateFishModal } from './components/CreateFishModal'
import { SettingsModal } from './components/SettingsModal'
import { PluginFrame, Toasts } from './components/Toasts'
import { ArtAvatar, ArtPortrait } from './components/ArtAvatar'

function TitleBar(): ReactElement {
  const s = useStore()
  return (
    <header className="titlebar">
      <div className="brand">
        <ArtAvatar hue={s.fish?.hue ?? 205} size={22} expression="happy" />
        DeepSeek 肥鱼养殖场
        <small>Fat Fish Farm</small>
      </div>
      <span className="spacer" />
      <div className="tb-actions">
        {s.cfg?.provider.mode === 'mock' ? (
          <span className="pill mode-mock">排练模式（不联网）</span>
        ) : (
          <span className="pill mode-api">{s.cfg?.provider.model || '未配置模型'}</span>
        )}
        {s.memStats ? <span className="pill">记忆 {s.memStats.cards} 条 · {((s.memStats.bytes ?? 0) / 1024).toFixed(1)} KB</span> : null}
        <button
          className="btn sm"
          onClick={() => s.setShowMemory(!s.showMemory)}
          title={s.showMemory ? '收起右侧面板' : '展开右侧面板'}
        >
          {s.showMemory ? '收起面板' : '记忆面板'}
        </button>
        <button className="btn sm" onClick={() => s.setSettingsOpen(true)}>
          ⚙ 设置
        </button>
      </div>
    </header>
  )
}

export default function App(): ReactElement {
  const s = useStore()
  const [zoom, setZoom] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (zoom) setZoom(null)
        else if (s.settingsOpen) s.setSettingsOpen(false)
        else if (s.createOpen) s.setCreateOpen(false)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        s.setSettingsOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void s.newChat(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s, zoom])

  useEffect(() => {
    if (s.ready) void window.farm.app.shotReady()
  }, [s.ready, s.messages.length, s.cards.length])

  if (!s.ready || !s.cfg) {
    return (
      <div className="app">
        <div className="aurora" />
        <div className="empty" style={{ height: '100vh' }}>
          <ArtPortrait hue={205} size={220} />
          <h3>正在注水……</h3>
        </div>
      </div>
    )
  }

  if (!s.cfg.onboarded) {
    return (
      <div className={`app theme-${s.cfg.ui.theme}`} style={{ fontSize: s.cfg.ui.fontSize }}>
        <div className="aurora" />
        <Onboarding />
        <Toasts />
      </div>
    )
  }

  return (
    <div className={`app theme-${s.cfg.ui.theme}`} style={{ fontSize: s.cfg.ui.fontSize }}>
      <div className="aurora" />
      <TitleBar />
      <div className="body" style={{ gridTemplateColumns: s.showMemory ? '96px 244px minmax(0,1fr) 344px' : '96px 244px minmax(0,1fr)' }}>
        <Rail />
        <ChatList />
        <main className="main">
          <FishTank />
          <ChatView onZoom={setZoom} />
        </main>
        {s.showMemory ? <MemoryPanel onZoom={setZoom} /> : null}
      </div>

      <CreateFishModal />
      <SettingsModal />
      <PluginFrame />
      <Toasts />

      {zoom ? (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="查看大图" />
        </div>
      ) : null}
    </div>
  )
}
