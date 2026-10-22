import type {
  AppConfig,
  AppInfo,
  ChatFile,
  ChatMessage,
  ChatMeta,
  FishProfile,
  FishSummary,
  ImportResult,
  MediaMeta,
  MemoryCard,
  MemoryEvent,
  MemoryStats,
  PluginInfo,
  RecallHit,
  SendInput,
  StreamEvent
} from './types'

export interface TestResult {
  ok: boolean
  detail: string
  models?: string[]
}

export interface ExportResult {
  path: string
  bytes: number
}

export interface PluginEvent {
  pluginId: string
  type: string
  payload?: unknown
}

export interface FarmApi {
  app: {
    info(): Promise<AppInfo>
    openPath(p: string): Promise<string>
    pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
    encryption(): Promise<boolean>
    onStream(cb: (ev: StreamEvent) => void): () => void
    onMemory(cb: (ev: MemoryEvent) => void): () => void
    onPlugin(cb: (ev: PluginEvent) => void): () => void
    /** 开发期截图用：主进程指定要打开的场景 */
    onScene(cb: (scene: string) => void): () => void
    shotReady(): Promise<boolean>
  }
  config: {
    get(): Promise<AppConfig>
    set(patch: Partial<AppConfig>): Promise<AppConfig>
    setSecrets(patch: { text?: string; vision?: string; image?: string }): Promise<AppInfo['hasSecret']>
    secretsState(): Promise<AppInfo['hasSecret']>
    test(target: 'text' | 'vision' | 'image'): Promise<TestResult>
  }
  pond: {
    open(): Promise<string>
    choose(): Promise<string | null>
    migrate(newRoot: string): Promise<AppConfig>
  }
  fish: {
    list(): Promise<FishSummary[]>
    create(opts: { name: string; hue?: number; tagline?: string; seed?: number }): Promise<FishProfile>
    update(args: { fishId: string; patch: Partial<FishProfile> }): Promise<FishProfile>
    remove(fishId: string): Promise<boolean>
    reveal(fishId: string): Promise<string>
    feed(fishId: string): Promise<FishProfile | null>
    stats(fishId: string): Promise<FishProfile | null>
  }
  chat: {
    list(fishId: string): Promise<ChatMeta[]>
    create(fishId: string, title?: string): Promise<ChatFile>
    read(fishId: string, chatId: string): Promise<ChatFile | null>
    rename(fishId: string, chatId: string, title: string): Promise<boolean>
    remove(fishId: string, chatId: string): Promise<boolean>
    send(input: SendInput): Promise<{ ok: boolean }>
    greet(fishId: string, chatId: string): Promise<{ ok: boolean }>
    abort(chatId: string): Promise<boolean>
    locate(fishId: string, msgId: string): Promise<{ chatId: string; title: string } | null>
  }
  media: {
    pick(fishId: string): Promise<MediaMeta[]>
    upload(fishId: string, payload: { name: string; base64: string }): Promise<MediaMeta>
    list(fishId: string): Promise<MediaMeta[]>
    url(fishId: string, mediaId: string, variant?: 'thumb' | 'src'): Promise<string>
    caption(fishId: string, mediaId: string): Promise<string>
  }
  memory: {
    list(fishId: string): Promise<{ cards: MemoryCard[]; stats: MemoryStats }>
    search(fishId: string, q: string): Promise<MemoryCard[]>
    stats(fishId: string): Promise<MemoryStats & { dirBytes: number }>
    recall(fishId: string, q: string, k?: number): Promise<RecallHit[]>
    distill(fishId: string, chatId: string, force?: boolean): Promise<MemoryStats>
    compact(fishId: string): Promise<{ merged: number; before: MemoryStats; after: MemoryStats }>
    pin(fishId: string, cardId: string, pin: boolean): Promise<boolean>
    remove(fishId: string, cardId: string): Promise<boolean>
  }
  io: {
    exportFish(fishId: string): Promise<ExportResult | null>
    exportMemory(fishId: string): Promise<ExportResult | null>
    import(targetFishId?: string): Promise<ImportResult | null>
  }
  plugins: {
    list(): Promise<PluginInfo[]>
    reload(): Promise<PluginInfo[]>
    invoke(pluginId: string, commandId: string, payload?: unknown): Promise<unknown>
    toggle(pluginId: string, enabled: boolean): Promise<PluginInfo[]>
    dir(kind?: 'bundled' | 'user'): Promise<string>
  }
  stats: {
    pond(): Promise<{ bytes: number; root: string }>
  }
}

export type { ChatMessage }
