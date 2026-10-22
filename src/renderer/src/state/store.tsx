import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { FarmApi } from '@shared/api'
import type {
  AppConfig,
  AppInfo,
  ChatFile,
  ChatMessage,
  ChatMeta,
  DshImportResult,
  FishProfile,
  FishSummary,
  MediaMeta,
  MemoryCard,
  MemoryStats,
  PluginInfo,
  ProviderView,
  StickerImportResult,
  StickerState,
  StreamEvent
} from '@shared/types'

declare global {
  interface Window {
    farm: FarmApi
  }
}

const api = window.farm

export interface Toast {
  id: string
  text: string
  kind: 'info' | 'ok' | 'err'
}

export interface StreamState {
  msgId: string
  text: string
  reason: string
  stage: string
}

function rid(): string {
  return Math.random().toString(36).slice(2, 12)
}

export function mediaSrc(fishId: string, mediaId: string, variant: 'thumb' | 'src' = 'thumb'): string {
  return `fatfish://media/${encodeURIComponent(fishId)}/${encodeURIComponent(mediaId)}?v=${variant}`
}

interface StoreShape {
  ready: boolean
  cfg: AppConfig | null
  info: AppInfo | null
  fishList: FishSummary[]
  fish: FishSummary | null
  chats: ChatMeta[]
  chat: ChatMeta | null
  messages: ChatMessage[]
  stream: StreamState | null
  cards: MemoryCard[]
  memStats: MemoryStats | null
  media: MediaMeta[]
  providers: ProviderView[]
  stickerState: StickerState | null
  plugins: PluginInfo[]
  panelPlugin: PluginInfo | null
  settingsOpen: boolean
  createOpen: boolean
  showMemory: boolean
  toast: (text: string, kind?: Toast['kind']) => void
  toasts: Toast[]
  dismissToast: (id: string) => void
  refreshFish: () => Promise<void>
  selectFish: (fishId: string) => Promise<void>
  createFish: (opts: { name: string; hue?: number; tagline?: string; seed?: number }) => Promise<void>
  updateFish: (patch: Partial<FishProfile>) => Promise<void>
  deleteFish: (fishId: string) => Promise<void>
  feed: () => Promise<void>
  selectChat: (chatId: string) => Promise<void>
  newChat: (withGreeting?: boolean) => Promise<void>
  removeChat: (chatId: string) => Promise<void>
  renameChat: (chatId: string, title: string) => Promise<void>
  send: (text: string, mediaIds?: string[], sticker?: string) => Promise<void>
  abort: () => Promise<void>
  pickImages: () => Promise<MediaMeta[]>
  uploadFiles: (files: File[]) => Promise<MediaMeta[]>
  refreshMemory: () => Promise<void>
  distillMemory: (force?: boolean) => Promise<void>
  compactMemory: () => Promise<void>
  pinCard: (cardId: string, pin: boolean) => Promise<void>
  deleteCard: (cardId: string) => Promise<void>
  refreshMedia: () => Promise<void>
  refreshStickers: () => Promise<void>
  importStickers: (kind: 'zip' | 'folder') => Promise<StickerImportResult | null>
  removeStickerPack: (packId: string) => Promise<void>
  clearStickerWishes: () => Promise<void>
  exportStickerWishes: () => Promise<void>
  openStickerDir: () => Promise<void>
  exportFish: () => Promise<void>
  exportMemory: () => Promise<void>
  importBundle: () => Promise<void>
  saveConfig: (patch: Partial<AppConfig>) => Promise<void>
  /** 写 .credentials.yaml（ref 是 config 里的 apiKeyEnv） */
  setCredential: (ref: string, value: string) => Promise<void>
  removeCredential: (ref: string) => Promise<void>
  importDsh: () => Promise<DshImportResult>
  refreshProviders: () => Promise<void>
  testConnection: (target: 'text' | 'vision' | 'image') => Promise<{ ok: boolean; detail: string }>
  testProvider: (providerId: string) => Promise<{ ok: boolean; detail: string }>
  setSettingsOpen: (v: boolean) => void
  setCreateOpen: (v: boolean) => void
  setShowMemory: (v: boolean) => void
  setPanelPlugin: (p: PluginInfo | null) => void
  reloadPlugins: () => Promise<void>
  togglePlugin: (id: string, enabled: boolean) => Promise<void>
  invokePlugin: (pluginId: string, commandId: string, payload?: unknown) => Promise<unknown>
  cardById: (id: string) => MemoryCard | undefined
  locateMessage: (msgId: string) => Promise<void>
  /** 刚刚被「跳回原话」定位到的消息 id（用于高亮） */
  locateTarget: string | null
}

const StoreCtx = createContext<StoreShape | null>(null)

export function useStore(): StoreShape {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用')
  return ctx
}

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false)
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [fishList, setFishList] = useState<FishSummary[]>([])
  const [fishId, setFishId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatMeta[]>([])
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [stream, setStream] = useState<StreamState | null>(null)
  const [cards, setCards] = useState<MemoryCard[]>([])
  const [memStats, setMemStats] = useState<MemoryStats | null>(null)
  const [media, setMedia] = useState<MediaMeta[]>([])
  const [providers, setProviders] = useState<ProviderView[]>([])
  const [stickerState, setStickerState] = useState<StickerState | null>(null)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [panelPlugin, setPanelPlugin] = useState<PluginInfo | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [showMemory, setShowMemory] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [memoryStage, setMemoryStage] = useState<string | null>(null)
  const [locateTarget, setLocateTarget] = useState<string | null>(null)

  const fishIdRef = useRef<string | null>(null)
  const chatIdRef = useRef<string | null>(null)
  const pluginsRef = useRef<PluginInfo[]>([])
  const sceneRef = useRef<string>('')
  fishIdRef.current = fishId
  chatIdRef.current = chatId
  pluginsRef.current = plugins

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = rid()
    setToasts((prev) => [...prev.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3600)
  }, [])

  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])

  /* ---------------- 初始化 ---------------- */

  useEffect(() => {
    void (async () => {
      const [c, i, pv] = await Promise.all([api.config.get(), api.app.info(), api.config.providers()])
      setCfg(c)
      setInfo(i)
      setProviders(pv)
      setStickerState(await api.stickers.list())
      const list = await api.fish.list()
      setFishList(list)
      if (list.length) await selectFishInternal(list[0].id)
      setReady(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- 数据加载 ---------------- */

  const refreshFish = useCallback(async () => {
    setFishList(await api.fish.list())
  }, [])

  const refreshMemory = useCallback(async () => {
    const id = fishIdRef.current
    if (!id) return
    const res = await api.memory.list(id)
    setCards(res.cards)
    setMemStats(res.stats)
  }, [])

  const refreshMedia = useCallback(async () => {
    const id = fishIdRef.current
    if (!id) return
    setMedia(await api.media.list(id))
  }, [])

  const refreshStickers = useCallback(async () => {
    setStickerState(await api.stickers.list())
  }, [])

  const importStickers = useCallback(
    async (kind: 'zip' | 'folder'): Promise<StickerImportResult | null> => {
      try {
        const res = await api.stickers.import(kind)
        setStickerState(await api.stickers.list())
        if (res) {
          toast(
            `导入「${res.name}」${res.items} 张` +
              (res.warnings.length ? `（${res.warnings.length} 条提醒）` : ''),
            'ok'
          )
        }
        return res
      } catch (e) {
        toast((e as Error).message, 'err')
        return null
      }
    },
    [toast]
  )

  const removeStickerPack = useCallback(
    async (packId: string) => {
      setStickerState(await api.stickers.remove(packId))
      toast(`已移除贴纸包 ${packId}`, 'ok')
    },
    [toast]
  )

  const clearStickerWishes = useCallback(async () => {
    setStickerState(await api.stickers.clearWishes())
    toast('缺表情记录已清空', 'ok')
  }, [toast])

  const exportStickerWishes = useCallback(async () => {
    const res = await api.stickers.exportWishes()
    if (res) toast(`需求清单已导出（${Math.round(res.bytes / 1024)} KB）`, 'ok')
  }, [toast])

  const openStickerDir = useCallback(async () => {
    await api.stickers.openDir()
  }, [])

  const refreshChats = useCallback(async (id: string) => {
    const list = await api.chat.list(id)
    setChats(list)
    return list
  }, [])

  const selectChat = useCallback(
    async (id: string) => {
      const fid = fishIdRef.current
      if (!fid) return
      setChatId(id)
      chatIdRef.current = id
      const chat = await api.chat.read(fid, id)
      setMessages(chat?.msgs ?? [])
    },
    []
  )

  const newChat = useCallback(
    async (withGreeting = true) => {
      const fid = fishIdRef.current
      if (!fid) return
      const chat = await api.chat.create(fid)
      setChats((prev) => [
        { id: chat.id, title: chat.title, created: chat.created, updated: chat.updated, count: 0 },
        ...prev
      ])
      setChatId(chat.id)
      chatIdRef.current = chat.id
      setMessages([])
      if (withGreeting) {
        setStream({ msgId: '', text: '', reason: '', stage: '（它探出头来了）' })
        void api.chat.greet(fid, chat.id)
      }
    },
    []
  )

  const selectFishInternal = useCallback(
    async (id: string) => {
      setFishId(id)
      fishIdRef.current = id
      setStream(null)
      const list = await refreshChats(id)
      await Promise.all([refreshMemory(), refreshMedia()])
      if (list.length) await selectChat(list[0].id)
      else {
        setChatId(null)
        setMessages([])
        await newChat(true)
      }
    },
    [newChat, refreshChats, refreshMedia, refreshMemory, selectChat]
  )

  const selectFish = useCallback(
    async (id: string) => {
      if (id === fishIdRef.current) return
      await selectFishInternal(id)
    },
    [selectFishInternal]
  )

  /* ---------------- 流式事件 ---------------- */

  const upsertAssistant = useCallback((msgId: string, patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId)
      if (idx < 0) return prev
      const copy = [...prev]
      copy[idx] = patch(copy[idx])
      return copy
    })
  }, [])

  useEffect(() => {
    const offStream = api.app.onStream((ev: StreamEvent) => {
      if (ev.fishId !== fishIdRef.current) return
      if (ev.chatId && ev.chatId !== chatIdRef.current) {
        // 别的对话在跑：刷新会话列表即可
        void refreshChats(ev.fishId)
        return
      }
      if (ev.kind === 'start' && ev.msgId) {
        setStream({ msgId: ev.msgId, text: '', reason: '', stage: '' })
        setMessages((prev) =>
          prev.some((m) => m.id === ev.msgId)
            ? prev
            : [...prev, { id: ev.msgId!, role: 'a', t: Date.now(), text: '' }]
        )
        return
      }
      if (ev.kind === 'stage') {
        setStream((s) => (s ? { ...s, stage: ev.stage ?? '' } : s))
        if (ev.stage) setMemoryStage(ev.stage)
        return
      }
      if (ev.kind === 'delta' && ev.msgId) {
        const chunk = ev.text ?? ''
        upsertAssistant(ev.msgId, (m) => ({ ...m, text: (m.text ?? '') + chunk }))
        setStream((s) => (s && s.msgId === ev.msgId ? { ...s, text: s.text + chunk, stage: '' } : s))
        return
      }
      if (ev.kind === 'reason' && ev.msgId) {
        const chunk = ev.text ?? ''
        upsertAssistant(ev.msgId, (m) => ({ ...m, reason: (m.reason ?? '') + chunk }))
        setStream((s) => (s && s.msgId === ev.msgId ? { ...s, reason: s.reason + chunk } : s))
        return
      }
      if (ev.kind === 'image') {
        void refreshMedia()
        return
      }
      if (ev.kind === 'done' && ev.msgId) {
        if (ev.message) {
          upsertAssistant(ev.msgId, () => ev.message as ChatMessage)
        }
        setStream(null)
        void refreshChats(ev.fishId)
        void refreshFish()
        void refreshMedia()
        setTimeout(() => void refreshMemory(), 800)
        return
      }
      if (ev.kind === 'error' && ev.msgId) {
        upsertAssistant(ev.msgId, (m) => ({ ...m, err: ev.error ?? '出错了' }))
        setStream(null)
        toast(ev.error ?? '出错了', 'err')
      }
    })

    const offMemory = api.app.onMemory((ev) => {
      if (ev.fishId !== fishIdRef.current) return
      if (ev.state === 'start') {
        setMemoryStage('在把刚才的对话压成记忆…')
        return
      }
      setMemoryStage(null)
      if (ev.state === 'done' && (ev.added ?? 0) > 0) {
        toast(`记住了 ${ev.added} 件小事${ev.compacted ? `，顺手压缩了 ${ev.compacted} 张旧卡` : ''}`, 'ok')
        void refreshMemory()
      }
      if (ev.state === 'fail' && ev.error) toast(`记忆没整理好：${ev.error}`, 'err')
    })

    return () => {
      offStream()
      offMemory()
    }
  }, [refreshChats, refreshFish, refreshMedia, refreshMemory, toast, upsertAssistant])

  /* ---------------- 动作 ---------------- */

  const createFish = useCallback(
    async (opts: { name: string; hue?: number; tagline?: string; seed?: number }) => {
      const profile = await api.fish.create(opts)
      await refreshFish()
      await selectFishInternal(profile.id)
      toast(`${profile.name} 已经住进鱼塘啦`, 'ok')
    },
    [refreshFish, selectFishInternal, toast]
  )

  const updateFish = useCallback(
    async (patch: Partial<FishProfile>) => {
      const id = fishIdRef.current
      if (!id) return
      await api.fish.update({ fishId: id, patch })
      await refreshFish()
    },
    [refreshFish]
  )

  const deleteFish = useCallback(
    async (id: string) => {
      await api.fish.remove(id)
      const list = await api.fish.list()
      setFishList(list)
      if (id === fishIdRef.current) {
        setFishId(null)
        fishIdRef.current = null
        setMessages([])
        setChats([])
        setChatId(null)
        if (list.length) await selectFishInternal(list[0].id)
      }
      toast('它搬走了（文件已放进回收站）', 'info')
    },
    [selectFishInternal, toast]
  )

  const feed = useCallback(async () => {
    const id = fishIdRef.current
    if (!id) return
    const profile = await api.fish.feed(id)
    await refreshFish()
    if (profile) toast(`喂了一碗白米饭，它吃掉了 ${profile.stats.tokens} token`, 'ok')
  }, [refreshFish, toast])

  const removeChat = useCallback(
    async (id: string) => {
      const fid = fishIdRef.current
      if (!fid) return
      await api.chat.remove(fid, id)
      const list = await refreshChats(fid)
      if (id === chatIdRef.current) {
        if (list.length) await selectChat(list[0].id)
        else await newChat(true)
      }
    },
    [newChat, refreshChats, selectChat]
  )

  const renameChat = useCallback(
    async (id: string, title: string) => {
      const fid = fishIdRef.current
      if (!fid) return
      await api.chat.rename(fid, id, title)
      await refreshChats(fid)
    },
    [refreshChats]
  )

  const send = useCallback(
    async (text: string, mediaIds: string[] = [], sticker?: string) => {
      const fid = fishIdRef.current
      let cid = chatIdRef.current
      if (!fid) return
      if (!cid) {
        const chat = await api.chat.create(fid)
        cid = chat.id
        setChatId(cid)
        chatIdRef.current = cid
        setChats((prev) => [{ id: chat.id, title: chat.title, created: chat.created, updated: chat.updated, count: 0 }, ...prev])
      }
      const userMsgId = rid()
      const assistantMsgId = rid()
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'u',
        t: Date.now(),
        text,
        imgs: mediaIds.length ? mediaIds : undefined,
        sticker
      }
      setMessages((prev) => [...prev, userMsg, { id: assistantMsgId, role: 'a', t: Date.now(), text: '' }])
      setStream({ msgId: assistantMsgId, text: '', reason: '', stage: '' })
      try {
        await api.chat.send({ fishId: fid, chatId: cid, text, mediaIds, sticker, userMsgId, assistantMsgId })
      } catch (e) {
        setStream(null)
        toast((e as Error).message, 'err')
      }
    },
    [toast]
  )

  const abort = useCallback(async () => {
    const cid = chatIdRef.current
    if (cid) await api.chat.abort(cid)
    setStream(null)
  }, [])

  const pickImages = useCallback(async () => {
    const fid = fishIdRef.current
    if (!fid) return []
    const metas = await api.media.pick(fid)
    if (metas.length) void refreshMedia()
    return metas
  }, [refreshMedia])

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const fid = fishIdRef.current
      if (!fid) return []
      const out: MediaMeta[] = []
      for (const f of files.slice(0, 6)) {
        const buf = await f.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
        out.push(await api.media.upload(fid, { name: f.name || 'pasted.png', base64 }))
      }
      if (out.length) void refreshMedia()
      return out
    },
    [refreshMedia]
  )

  const distillMemory = useCallback(
    async (force = true) => {
      const fid = fishIdRef.current
      const cid = chatIdRef.current
      if (!fid || !cid) return
      setMemoryStage('在把刚才的对话压成记忆…')
      try {
        const stats = await api.memory.distill(fid, cid, force)
        setMemStats(stats)
        await refreshMemory()
        toast('记忆整理好了', 'ok')
      } catch (e) {
        toast((e as Error).message, 'err')
      } finally {
        setMemoryStage(null)
      }
    },
    [refreshMemory, toast]
  )

  const compactMemory = useCallback(async () => {
    const fid = fishIdRef.current
    if (!fid) return
    setMemoryStage('在压缩旧记忆…')
    try {
      const res = await api.memory.compact(fid)
      await refreshMemory()
      toast(
        res.merged > 0
          ? `把 ${res.merged} 张旧卡压成了 ${res.after.cards + res.after.archived} 张，省了 ${Math.max(
              0,
              Math.round((res.before.bytes - res.after.bytes) / 1024)
            )} KB`
          : '现在还不算多，不用压',
        'ok'
      )
    } finally {
      setMemoryStage(null)
    }
  }, [refreshMemory, toast])

  const pinCard = useCallback(
    async (cardId: string, pin: boolean) => {
      const fid = fishIdRef.current
      if (!fid) return
      await api.memory.pin(fid, cardId, pin)
      await refreshMemory()
    },
    [refreshMemory]
  )

  const deleteCard = useCallback(
    async (cardId: string) => {
      const fid = fishIdRef.current
      if (!fid) return
      await api.memory.remove(fid, cardId)
      await refreshMemory()
    },
    [refreshMemory]
  )

  const exportFish = useCallback(async () => {
    const fid = fishIdRef.current
    if (!fid) return
    const res = await api.io.exportFish(fid)
    if (res) toast(`导出完成（${Math.round(res.bytes / 1024)} KB）`, 'ok')
  }, [toast])

  const exportMemory = useCallback(async () => {
    const fid = fishIdRef.current
    if (!fid) return
    const res = await api.io.exportMemory(fid)
    if (res) toast(`记忆包导出完成（${Math.round(res.bytes / 1024)} KB）`, 'ok')
  }, [toast])

  const importBundle = useCallback(async () => {
    const res = await api.io.import(fishIdRef.current ?? undefined)
    if (!res) return
    await refreshFish()
    const list = await api.fish.list()
    setFishList(list)
    if (res.mode === 'fish') {
      await selectFishInternal(res.fishId)
      toast(`「${res.name}」搬进来了`, 'ok')
    } else {
      await refreshMemory()
      toast(`记忆已合并进「${res.name}」`, 'ok')
    }
  }, [refreshFish, refreshMemory, selectFishInternal, toast])

  const refreshProviders = useCallback(async () => {
    setProviders(await api.config.providers())
  }, [])

  const saveConfig = useCallback(
    async (patch: Partial<AppConfig>) => {
      const next = await api.config.set(patch)
      setCfg(next)
      setProviders(await api.config.providers())
      setInfo(await api.app.info())
    },
    []
  )

  const setCredential = useCallback(
    async (ref: string, value: string) => {
      try {
        const list = await api.credentials.set(ref, value)
        setProviders(list)
        setInfo(await api.app.info())
        toast(value.trim() ? `${ref} 已保存到 .credentials.yaml` : `${ref} 已清除`, 'ok')
      } catch (e) {
        toast((e as Error).message, 'err')
        throw e
      }
    },
    [toast]
  )

  const removeCredential = useCallback(async (ref: string) => {
    setProviders(await api.credentials.remove(ref))
    setInfo(await api.app.info())
  }, [])

  const importDsh = useCallback(async () => {
    const res = await api.config.importDsh()
    setProviders(await api.config.providers())
    setInfo(await api.app.info())
    if (res.error) toast(res.error, 'err')
    else
      toast(
        `从 DSH 导入 ${res.imported.length} 个凭据${res.skipped.length ? `，跳过 ${res.skipped.length} 个已存在/无法识别的` : ''}`,
        'ok'
      )
    return res
  }, [toast])

  const testConnection = useCallback((target: 'text' | 'vision' | 'image') => api.config.test(target), [])
  const testProvider = useCallback((providerId: string) => api.config.testProvider(providerId), [])

  const reloadPlugins = useCallback(async () => {
    const list = await api.plugins.reload()
    setPlugins(list)
  }, [])

  const togglePlugin = useCallback(async (id: string, enabled: boolean) => {
    const list = await api.plugins.toggle(id, enabled)
    setPlugins(list)
  }, [])

  const invokePlugin = useCallback((pluginId: string, commandId: string, payload?: unknown) => {
    return api.plugins.invoke(pluginId, commandId, payload)
  }, [])

  const cardById = useCallback((id: string) => cards.find((c) => c.id === id), [cards])

  const locateMessage = useCallback(
    async (msgId: string) => {
      const fid = fishIdRef.current
      if (!fid) return
      const found = await api.chat.locate(fid, msgId)
      if (!found) {
        toast('这条原话所在的对话已经不在了', 'info')
        return
      }
      if (found.chatId !== chatIdRef.current) await selectChat(found.chatId)
      setLocateTarget(msgId)
      setTimeout(() => {
        document.getElementById(`msg-${msgId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 120)
      setTimeout(() => setLocateTarget(null), 2400)
    },
    [selectChat, toast]
  )

  useEffect(() => {
    if (ready && !settingsOpen) return
    // 打开设置时无需额外加载
  }, [ready, settingsOpen])

  useEffect(() => {
    const off = api.app.onScene((scene) => {
      sceneRef.current = scene
      if (scene === 'settings') setSettingsOpen(true)
      if (scene === 'create') setCreateOpen(true)
      if (scene === 'plugins') setShowMemory(true)
      if (scene === 'plugin') {
        const p = pluginsRef.current.find((x) => x.panel)
        if (p) setPanelPlugin(p)
      }
      if (scene === 'send') {
        setTimeout(() => void send('（排练模式自检）在吗？随便说句话听听'), 700)
      }
      if (scene === 'stickers') {
        setTimeout(() => document.querySelector<HTMLElement>('[data-testid="sticker-toggle"]')?.click(), 700)
      }
      if (scene === 'reason') {
        setTimeout(() => document.querySelector<HTMLDetailsElement>('details.reason')?.setAttribute('open', ''), 600)
      }
    })
    return off
  }, [])

  // 截图场景：等聊天渲染出来之后再点开引用气泡 / 插件面板
  useEffect(() => {
    if (sceneRef.current !== 'cite' || !messages.length) return
    const timer = setTimeout(() => {
      document.querySelector<HTMLElement>('.cite')?.click()
    }, 400)
    return () => clearTimeout(timer)
  }, [messages])

  useEffect(() => {
    if (sceneRef.current !== 'plugin' || !plugins.length) return
    const p = plugins.find((x) => x.panel)
    if (p) setPanelPlugin(p)
  }, [plugins])

  useEffect(() => {
    if (ready) void reloadPlugins()
  }, [ready, reloadPlugins])

  const value = useMemo<StoreShape>(() => {
    const fish = fishList.find((f) => f.id === fishId) ?? null
    const chat = chats.find((c) => c.id === chatId) ?? null
    return {
      ready,
      cfg,
      info,
      fishList,
      fish,
      chats,
      chat,
      messages,
      stream,
      cards,
      memStats,
      media,
      providers,
      stickerState,
      plugins,
      panelPlugin,
      settingsOpen,
      createOpen,
      showMemory,
      toast,
      toasts,
      dismissToast,
      refreshFish,
      selectFish,
      createFish,
      updateFish,
      deleteFish,
      feed,
      selectChat,
      newChat,
      removeChat,
      renameChat,
      send,
      abort,
      pickImages,
      uploadFiles,
      refreshMemory,
      distillMemory,
      compactMemory,
      pinCard,
      deleteCard,
      refreshMedia,
      refreshStickers,
      importStickers,
      removeStickerPack,
      clearStickerWishes,
      exportStickerWishes,
      openStickerDir,
      exportFish,
      exportMemory,
      importBundle,
      saveConfig,
      setCredential,
      removeCredential,
      importDsh,
      refreshProviders,
      testConnection,
      testProvider,
      setSettingsOpen,
      setCreateOpen,
      setShowMemory,
      setPanelPlugin,
      reloadPlugins,
      togglePlugin,
      invokePlugin,
      cardById,
      locateMessage,
      locateTarget
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    cfg,
    info,
    fishList,
    fishId,
    chats,
    chatId,
    messages,
    stream,
    cards,
    memStats,
    media,
    providers,
    stickerState,
    plugins,
    panelPlugin,
    settingsOpen,
    createOpen,
    showMemory,
    toasts,
    memoryStage,
    locateTarget
  ])

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export type { ChatFile, FishProfile, MemoryCard }
