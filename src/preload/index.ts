import { contextBridge, ipcRenderer } from 'electron'
import type { FarmApi } from '@shared/api'
import type { AppConfig, FishProfile, MemoryEvent, SendInput, StreamEvent } from '@shared/types'
import type { PluginEvent } from '@shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: FarmApi = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openPath: (p) => ipcRenderer.invoke('app:openPath', p),
    pickFolder: (opts) => ipcRenderer.invoke('app:pickFolder', opts ?? {}),
    encryption: () => ipcRenderer.invoke('app:encryption'),
    onStream: (cb) => subscribe<StreamEvent>('ev:stream', cb),
    onMemory: (cb) => subscribe<MemoryEvent>('ev:memory', cb),
    onPlugin: (cb) => subscribe<PluginEvent>('ev:plugin', cb),
    onScene: (cb) => subscribe<string>('ev:scene', cb),
    shotReady: () => ipcRenderer.invoke('shot:ready')
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch: Partial<AppConfig>) => ipcRenderer.invoke('config:set', patch),
    providers: () => ipcRenderer.invoke('config:providers'),
    paths: () => ipcRenderer.invoke('config:paths'),
    open: (kind: 'config' | 'credentials' = 'config') => ipcRenderer.invoke('config:open', kind),
    test: (target) => ipcRenderer.invoke('config:test', target),
    testProvider: (providerId: string) => ipcRenderer.invoke('providers:test', providerId),
    importDsh: () => ipcRenderer.invoke('credentials:importDsh')
  },
  credentials: {
    set: (ref: string, value: string) => ipcRenderer.invoke('credentials:set', ref, value),
    remove: (ref: string) => ipcRenderer.invoke('credentials:remove', ref),
    describe: (ref: string) => ipcRenderer.invoke('credentials:describe', ref)
  },
  pond: {
    open: () => ipcRenderer.invoke('pond:open'),
    choose: () => ipcRenderer.invoke('pond:choose'),
    migrate: (newRoot: string) => ipcRenderer.invoke('pond:migrate', newRoot)
  },
  fish: {
    list: () => ipcRenderer.invoke('fish:list'),
    create: (opts) => ipcRenderer.invoke('fish:create', opts),
    update: (args: { fishId: string; patch: Partial<FishProfile> }) => ipcRenderer.invoke('fish:update', args),
    remove: (fishId: string) => ipcRenderer.invoke('fish:delete', fishId),
    reveal: (fishId: string) => ipcRenderer.invoke('fish:reveal', fishId),
    feed: (fishId: string) => ipcRenderer.invoke('fish:feed', fishId),
    stats: (fishId: string) => ipcRenderer.invoke('fish:stats', fishId)
  },
  chat: {
    list: (fishId: string) => ipcRenderer.invoke('chat:list', fishId),
    create: (fishId: string, title?: string) => ipcRenderer.invoke('chat:create', fishId, title),
    read: (fishId: string, chatId: string) => ipcRenderer.invoke('chat:read', fishId, chatId),
    rename: (fishId: string, chatId: string, title: string) =>
      ipcRenderer.invoke('chat:rename', fishId, chatId, title),
    remove: (fishId: string, chatId: string) => ipcRenderer.invoke('chat:delete', fishId, chatId),
    send: (input: SendInput) => ipcRenderer.invoke('chat:send', input),
    greet: (fishId: string, chatId: string) => ipcRenderer.invoke('chat:greet', fishId, chatId),
    abort: (chatId: string) => ipcRenderer.invoke('chat:abort', chatId),
    locate: (fishId: string, msgId: string) => ipcRenderer.invoke('chat:locate', fishId, msgId)
  },
  media: {
    pick: (fishId: string) => ipcRenderer.invoke('media:pick', fishId),
    upload: (fishId: string, payload: { name: string; base64: string }) =>
      ipcRenderer.invoke('media:upload', fishId, payload),
    list: (fishId: string) => ipcRenderer.invoke('media:list', fishId),
    url: (fishId: string, mediaId: string, variant: 'thumb' | 'src' = 'thumb') =>
      ipcRenderer.invoke('media:url', fishId, mediaId, variant),
    caption: (fishId: string, mediaId: string) => ipcRenderer.invoke('media:caption', fishId, mediaId)
  },
  memory: {
    list: (fishId: string) => ipcRenderer.invoke('memory:list', fishId),
    search: (fishId: string, q: string) => ipcRenderer.invoke('memory:search', fishId, q),
    stats: (fishId: string) => ipcRenderer.invoke('memory:stats', fishId),
    recall: (fishId: string, q: string, k?: number) => ipcRenderer.invoke('memory:recall', fishId, q, k),
    distill: (fishId: string, chatId: string, force = true) =>
      ipcRenderer.invoke('memory:distill', fishId, chatId, force),
    compact: (fishId: string) => ipcRenderer.invoke('memory:compact', fishId),
    pin: (fishId: string, cardId: string, pin: boolean) => ipcRenderer.invoke('memory:pin', fishId, cardId, pin),
    remove: (fishId: string, cardId: string) => ipcRenderer.invoke('memory:delete', fishId, cardId)
  },
  io: {
    exportFish: (fishId: string) => ipcRenderer.invoke('io:exportFish', fishId),
    exportMemory: (fishId: string) => ipcRenderer.invoke('io:exportMemory', fishId),
    import: (targetFishId?: string) => ipcRenderer.invoke('io:import', targetFishId)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    reload: () => ipcRenderer.invoke('plugins:reload'),
    invoke: (pluginId: string, commandId: string, payload?: unknown) =>
      ipcRenderer.invoke('plugins:invoke', pluginId, commandId, payload),
    toggle: (pluginId: string, enabled: boolean) => ipcRenderer.invoke('plugins:toggle', pluginId, enabled),
    dir: (kind: 'bundled' | 'user' = 'user') => ipcRenderer.invoke('plugins:dir', kind)
  },
  stats: {
    pond: () => ipcRenderer.invoke('stats:pond')
  }
}

contextBridge.exposeInMainWorld('farm', api)
