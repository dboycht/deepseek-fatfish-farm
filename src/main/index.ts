import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, Menu, app, dialog, ipcMain, protocol, shell } from 'electron'
import { loadConfig, saveConfig } from './config'
import {
  describeAll,
  encryptionAvailable,
  ensureCredentialsFile,
  importFromDsh,
  removeCredential,
  resolveCredential,
  setCredential
} from './credentials'
import { configFile, configPaths, credentialsFile } from './paths'
import { resolveImageEndpoint, resolveTextEndpoint, resolveVisionEndpoint } from './llm/route'
import {
  cachedProfile,
  createFish,
  deleteFish,
  fishDir,
  flushProfiles,
  invalidateProfile,
  listChatMetas,
  listFish,
  patchStats,
  pondRoot,
  readProfile,
  writeProfile
} from './store/fish'
import { appendMessage, createChat, deleteChat, newMessage, patchMessage, readChat, renameChat } from './store/chat'
import {
  allMedia,
  getMedia,
  importBuffer,
  importPaths,
  loadIndex,
  resolveFile,
  setCaption,
  toDataUrl
} from './store/media'
import {
  compact,
  deleteCard,
  distill,
  loadCards,
  markRecalled,
  memoryDirSize,
  memoryStats,
  pinCard,
  recall,
  searchCards
} from './store/memory'
import { captionImage, chatCompletion, generateImage, testConnection } from './llm/provider'
import { buildMessages, parseCiteAnchors, parseDrawToken } from './llm/prompt'
import { extractStickerDirectives } from '@shared/stickers'
import {
  clearStickerWishes,
  ensureStickerDir,
  exportStickerWishes,
  importStickerPack,
  listStickerState,
  recordStickerWish,
  registerStickerProtocol,
  removeStickerPack,
  resolveStickerFile,
  stickersDir
} from './stickers'
import { mockReply } from './llm/mock'
import { bundledPluginsDir, invokePlugin, listPlugins, reloadPlugins, setPluginEmitter, togglePlugin } from './plugins/loader'
import { mediaUrl, registerMediaProtocol, registerPluginProtocol } from './plugins/protocol'
import { exportFish, exportMemory, importBundle } from './io/bundle'
import { ensureDir, dirSize, pathExists, writeJSON } from './util/fsx'
import { levelFromExp } from '@shared/persona'
import type {
  AppConfig,
  AppInfo,
  DshImportResult,
  FishProfile,
  ImportResult,
  MemoryEvent,
  ProviderView,
  SendInput,
  StreamEvent
} from '@shared/types'

protocol.registerSchemesAsPrivileged([
  { scheme: 'fatfish', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'fatfish-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'fatfish-sticker', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const SHOT_PATH = process.env.FATFISH_SHOT ?? ''
if (process.env.FATFISH_USER_DATA) {
  app.setPath('userData', process.env.FATFISH_USER_DATA)
}

let mainWindow: BrowserWindow | null = null
const inflight = new Map<string, AbortController>()

function emit<T>(channel: string, payload: T): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function stream(ev: StreamEvent): void {
  emit('ev:stream', ev)
}

function memoryEvent(ev: MemoryEvent): void {
  emit('ev:memory', ev)
}

/* ------------------------------------------------------------------ *
 * 状态衰减：肥鱼按真实时间变饿、心情缓慢回落（离线也在长）
 * ------------------------------------------------------------------ */

const HUNGER_PER_HOUR = 3.2
const MOOD_PER_HOUR = -0.8

async function applyDecay(root: string, profile: FishProfile): Promise<FishProfile> {
  const hours = Math.max(0, (Date.now() - (profile.stats.lastSeen || Date.now())) / 3_600_000)
  if (hours < 0.05) return profile
  const hunger = Math.min(100, profile.stats.hunger + hours * HUNGER_PER_HOUR)
  const mood = Math.max(5, Math.min(100, profile.stats.mood + hours * MOOD_PER_HOUR))
  const changed = Math.abs(hunger - profile.stats.hunger) > 0.5 || Math.abs(mood - profile.stats.mood) > 0.5
  if (!changed) return profile
  const updated = await patchStats(root, profile.id, (p) => {
    p.stats.hunger = hunger
    p.stats.mood = mood
    p.stats.lastSeen = Date.now()
  })
  return updated ?? profile
}

/* ------------------------------------------------------------------ *
 * 对话回合
 * ------------------------------------------------------------------ */

async function llmFor(cfg: AppConfig): Promise<((system: string, user: string) => Promise<string>) | undefined> {
  if (cfg.mode !== 'api') return undefined
  const ep = await resolveTextEndpoint(cfg)
  if (!ep.baseUrl || !ep.model) return undefined
  return async (system: string, user: string): Promise<string> => {
    const res = await chatCompletion(ep, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2,
      maxTokens: 900,
      stream: false
    })
    return res.text
  }
}

async function runTurn(input: SendInput): Promise<void> {
  const cfg = await loadConfig()
  const root = cfg.pondRoot
  const profile0 = await cachedProfile(root, input.fishId)
  if (!profile0) throw new Error('找不到这只肥鱼')
  const profile = await applyDecay(root, profile0)
  const chatId = input.chatId || (await createChat(root, input.fishId)).id
  const userMsgId = input.userMsgId ?? newMessage('u', input.text).id
  const assistantMsgId = input.assistantMsgId ?? newMessage('a', '').id
  const ctrl = new AbortController()
  inflight.set(chatId, ctrl)

  // 解析三条路由：对话 / 视觉 / 生图各用各的 provider + 凭据
  const textEp = await resolveTextEndpoint(cfg)
  const visionEp = await resolveVisionEndpoint(cfg)
  const imageEp = await resolveImageEndpoint(cfg)
  const isMock = cfg.mode === 'mock' || !textEp.baseUrl || !textEp.model

  // 可用贴纸：内置 + 用户包；同时收集自定义 id 给提示词
  const stickerState = await listStickerState()
  const knownStickerIds = new Set(stickerState.packs.flatMap((p) => p.items.map((i) => i.id)))
  const customStickers = stickerState.packs
    .filter((p) => !p.builtin)
    .flatMap((p) => p.items.map((i) => ({ id: i.id, label: i.label })))
    .slice(0, 40)

  const finishStats = async (patch: { exp: number; tokens: number; mood: number; hunger: number }): Promise<void> => {
    await patchStats(root, input.fishId, (p) => {
      p.stats.chats += 1
      p.stats.exp += patch.exp
      p.stats.tokens += patch.tokens
      p.stats.mood = Math.max(0, Math.min(100, p.stats.mood + patch.mood))
      p.stats.hunger = Math.max(0, Math.min(100, p.stats.hunger + patch.hunger))
      p.stats.level = levelFromExp(p.stats.exp)
    })
  }

  try {
    // 1) 落盘用户消息
    const mediaIds = input.mediaIds ?? []
    if (input.text.trim() || mediaIds.length || input.sticker) {
      await appendMessage(
        root,
        input.fishId,
        chatId,
        newMessage('u', input.text, { id: userMsgId, imgs: mediaIds.length ? mediaIds : undefined, sticker: input.sticker })
      )
    }
    stream({ kind: 'start', fishId: input.fishId, chatId, msgId: assistantMsgId })

    // 2) 视觉描述（缺描述的图先补上，后面记忆与检索都要用）
    if (!isMock && visionEp && mediaIds.length) {
      for (const mid of mediaIds) {
        const meta = await getMedia(root, input.fishId, mid)
        if (!meta || meta.caption) continue
        stream({ kind: 'stage', fishId: input.fishId, chatId, msgId: assistantMsgId, stage: '在仔细看你的图…' })
        try {
          const dataUrl = await toDataUrl(root, input.fishId, mid)
          if (dataUrl) {
            const cap = await captionImage(visionEp, dataUrl, input.text.slice(0, 120))
            if (cap) await setCaption(root, input.fishId, mid, cap)
          }
        } catch {
          /* 识别失败不影响聊天 */
        }
      }
    }

    // 3) 回忆
    const query = [input.text, ...mediaIds.map(() => '图片')].join(' ')
    const hits = cfg.memory.recall > 0 ? await recall(root, input.fishId, query, { k: cfg.memory.recall }) : []
    if (hits.length) {
      stream({ kind: 'stage', fishId: input.fishId, chatId, msgId: assistantMsgId, stage: `翻到了 ${hits.length} 条旧记忆…` })
    }

    const media = await loadIndex(root, input.fishId)
    const captionOf = (mid: string): string | undefined => media.find((m) => m.id === mid)?.caption
    const visionOn = !isMock && Boolean(visionEp)
    const dataUrls = new Map<string, string>()
    if (visionOn) {
      for (const mid of mediaIds.slice(0, 3)) {
        const url = await toDataUrl(root, input.fishId, mid)
        if (url) dataUrls.set(mid, url)
      }
    }
    // 注意：用户消息在上一步已经落盘，历史里必须把它排除，
    // 否则 buildMessages 会把「当前这句话」再追加一次，模型会以为用户复读。
    const history =
      (await readChat(root, input.fishId, chatId))?.msgs.filter(
        (m) => m.id !== assistantMsgId && m.id !== userMsgId
      ) ?? []
    const messages = buildMessages({
      profile,
      config: cfg,
      history,
      currentText: input.text,
      currentUserMsgId: userMsgId,
      currentImages: mediaIds.map((mid) => ({ id: mid, caption: captionOf(mid) })),
      hits,
      now: new Date(),
      visionEnabled: visionOn,
      stickers: customStickers,
      captionOf,
      dataUrlOf: (mid) => dataUrls.get(mid),
      drawEnabled: !isMock && cfg.memory.allowDraw && Boolean(imageEp)
    })

    let text = ''
    let reason = ''
    let usage: { i: number; o: number } | undefined
    let sticker: string | undefined

    if (isMock) {
      const mock = mockReply({
        profile,
        text: input.text,
        hasImages: mediaIds.length > 0,
        hits
      })
      text = mock.text
      reason = mock.reason
      sticker = mock.sticker
      // 排练模式也逐字吐出来，UI 表现一致
      for (const ch of text) {
        if (ctrl.signal.aborted) throw new Error('已取消')
        stream({ kind: 'delta', fishId: input.fishId, chatId, msgId: assistantMsgId, text: ch })
        await new Promise((r) => setTimeout(r, 12))
      }
      if (reason) stream({ kind: 'reason', fishId: input.fishId, chatId, msgId: assistantMsgId, text: reason })
    } else {
      const res = await chatCompletion(textEp, {
        messages,
        stream: true,
        signal: ctrl.signal,
        onDelta: (chunk) => stream({ kind: 'delta', fishId: input.fishId, chatId, msgId: assistantMsgId, text: chunk }),
        onReason: (chunk) => stream({ kind: 'reason', fishId: input.fishId, chatId, msgId: assistantMsgId, text: chunk })
      })
      text = res.text
      reason = res.reason
      usage = res.usage
    }

    if (!text.trim() && !sticker) text = '唔……我刚刚走神了，你再说一遍好不好？'

    // 4) 解析引用 / 贴纸 / 画图（引用锚点保留在正文里，渲染端把它变成可点击的卡片）
    const directives = extractStickerDirectives(text, knownStickerIds)
    for (const key of [...directives.needs, ...directives.unknown]) {
      void recordStickerWish(key, input.text)
    }
    const anchorText = directives.cleaned
    const anchors = [...new Set(parseCiteAnchors(anchorText))]
    const citeCardIds = anchors
      .map((a) => hits.find((h) => h.anchor === a)?.card.id)
      .filter((v): v is string => Boolean(v))
    const drawPrompt = !isMock && cfg.memory.allowDraw && imageEp ? parseDrawToken(anchorText) : null
    sticker = sticker ?? directives.sticker
    const clean = anchorText
      .replace(/\[{1,2}\s*draw:[\s\S]*?\]{1,2}/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    const msg = newMessage('a', clean, {
      id: assistantMsgId,
      // 内心 OS 始终存下来（体积很小），是否显示由「外观」里的开关控制，
      // 这样用户之后再打开开关也能看到历史回复的 OS。
      reason: reason.trim() ? reason.slice(0, 4000) : undefined,
      cite: citeCardIds.length ? citeCardIds : undefined,
      sticker,
      tok: usage,
      mood: `${Math.round(profile.stats.mood)}/${Math.round(profile.stats.hunger)}`
    })
    await appendMessage(root, input.fishId, chatId, msg)

    if (drawPrompt && imageEp) {
      stream({ kind: 'stage', fishId: input.fishId, chatId, msgId: assistantMsgId, stage: '在给你画…' })
      try {
        const img = await generateImage(imageEp, drawPrompt)
        const meta = await importBuffer(root, input.fishId, img.buffer, `draw.${img.ext}`, 'pic')
        await patchMessage(root, input.fishId, chatId, assistantMsgId, {
          imgs: [...(msg.imgs ?? []), meta.id]
        })
        stream({ kind: 'image', fishId: input.fishId, chatId, msgId: assistantMsgId, mediaId: meta.id })
      } catch (e) {
        stream({ kind: 'stage', fishId: input.fishId, chatId, msgId: assistantMsgId, stage: `画不出来：${(e as Error).message}` })
      }
    }

    if (citeCardIds.length) await markRecalled(root, input.fishId, citeCardIds)

    const finalMsg = (await readChat(root, input.fishId, chatId))?.msgs.find((m) => m.id === assistantMsgId) ?? msg
    stream({ kind: 'done', fishId: input.fishId, chatId, msgId: assistantMsgId, message: finalMsg })

    await finishStats({
      exp: 8,
      tokens: usage?.o ?? Math.ceil(clean.length / 2),
      mood: 2.5,
      hunger: 1.5
    })

    // 5) 自动蒸馏记忆（后台跑，不阻塞对话）
    if (cfg.memory.auto) {
      void runDistill(input.fishId, chatId, false)
    }
  } catch (e) {
    const err = e as Error
    const aborted = ctrl.signal.aborted || /aborted|cancel/i.test(err.message)
    if (!aborted) {
      const partial = await readChat(root, input.fishId, chatId)
      const has = partial?.msgs.some((m) => m.id === assistantMsgId)
      if (has) {
        await patchMessage(root, input.fishId, chatId, assistantMsgId, { err: err.message })
      } else if (partial) {
        await appendMessage(
          root,
          input.fishId,
          chatId,
          newMessage('a', '', { id: assistantMsgId, err: err.message })
        )
      }
      stream({ kind: 'error', fishId: input.fishId, chatId, msgId: assistantMsgId, error: err.message })
    } else {
      stream({ kind: 'stage', fishId: input.fishId, chatId, msgId: assistantMsgId, stage: '（被打断了）' })
      stream({ kind: 'done', fishId: input.fishId, chatId, msgId: assistantMsgId })
    }
  } finally {
    inflight.delete(chatId)
    void flushProfiles()
  }
}

async function runDistill(fishId: string, chatId: string, force: boolean): Promise<void> {
  const cfg = await loadConfig()
  const root = cfg.pondRoot
  memoryEvent({ fishId, state: 'start' })
  try {
    const res = await distill({
      root,
      fishId,
      chatId,
      every: cfg.memory.every,
      maxCards: cfg.memory.maxCards,
      force,
      llm: cfg.mode === 'api' ? await llmFor(cfg) : undefined
    })
    const stats = await memoryStats(root, fishId)
    if (res.added === 0 && res.compacted === 0 && !force) {
      memoryEvent({ fishId, state: 'done', added: 0, compacted: 0, stats })
      return
    }
    await patchStats(root, fishId, (p) => {
      p.stats.memories = stats.cards
    })
    memoryEvent({ fishId, state: 'done', added: res.added, compacted: res.compacted, stats })
  } catch (e) {
    memoryEvent({ fishId, state: 'fail', error: (e as Error).message })
  }
}

async function greet(fishId: string, chatId: string): Promise<void> {
  const cfg = await loadConfig()
  const root = cfg.pondRoot
  const profile = await cachedProfile(root, fishId)
  if (!profile) return
  const msgId = newMessage('a', '').id
  stream({ kind: 'start', fishId, chatId, msgId })
  let text = ''
  let reason = ''
  try {
    const textEp = await resolveTextEndpoint(cfg)
    const isMock = cfg.mode === 'mock' || !textEp.baseUrl || !textEp.model
    if (isMock) {
      const mock = mockReply({ profile, text: '你好', hasImages: false, hits: [] })
      text = `（从水草里钻出来）你来啦。${mock.text}`
      reason = mock.reason
      for (const ch of text) {
        stream({ kind: 'delta', fishId, chatId, msgId, text: ch })
        await new Promise((r) => setTimeout(r, 10))
      }
    } else {
      const res = await chatCompletion(textEp, {
        messages: [
          {
            role: 'system',
            content:
              `你是「${profile.name}」，一只住在用户电脑里的蓝色大肥鱼（DeepSeek 娘二创形象）。` +
              `口头禅「${profile.flavor.phrase}」，最爱${profile.flavor.food}。` +
              '现在用户刚打开这个对话，你要说一句开场白：短、口语、有活人感，1~2 句，不要问「有什么可以帮您」。'
          },
          { role: 'user', content: '（用户打开了对话窗口）' }
        ],
        stream: true,
        maxTokens: 160,
        temperature: 1.15,
        onDelta: (chunk) => stream({ kind: 'delta', fishId, chatId, msgId, text: chunk }),
        onReason: (chunk) => stream({ kind: 'reason', fishId, chatId, msgId, text: chunk })
      })
      text = res.text
      reason = res.reason
    }
  } catch (e) {
    text = ''
    reason = ''
    stream({ kind: 'error', fishId, chatId, msgId, error: (e as Error).message })
  }
  const stickersState = await listStickerState()
  const knownStickerIds = new Set(stickersState.packs.flatMap((p) => p.items.map((i) => i.id)))
  const directives = extractStickerDirectives(text, knownStickerIds)
  for (const key of [...directives.needs, ...directives.unknown]) {
    void recordStickerWish(key, '（开场白）')
  }
  if (directives.cleaned || text) {
    const msg = newMessage('a', directives.cleaned, {
      id: msgId,
      sticker: directives.sticker,
      reason: reason.trim() ? reason.slice(0, 4000) : undefined
    })
    await appendMessage(root, fishId, chatId, msg)
    stream({ kind: 'done', fishId, chatId, msgId, message: msg })
  }
}

/* ------------------------------------------------------------------ *
 * 窗口与菜单
 * ------------------------------------------------------------------ */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#050912',
    title: 'DeepSeek 肥鱼养殖场',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : { color: '#070c17', symbolColor: '#9fd7ff', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.on('did-finish-load', () => {
    const scene = process.env.FATFISH_SCENE
    if (scene) mainWindow?.webContents.send('ev:scene', scene)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '打开鱼塘文件夹', click: () => void openPond() },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function openPond(): Promise<void> {
  const cfg = await loadConfig()
  await ensureDir(cfg.pondRoot)
  await shell.openPath(cfg.pondRoot)
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc(): void {
  const providerViews = async (): Promise<ProviderView[]> => {
    const cfg = await loadConfig()
    const descs = await describeAll(cfg.providers.map((p) => p.apiKeyEnv))
    return cfg.providers.map((p) => ({
      ...p,
      credential:
        descs.find((d) => d.ref === p.apiKeyEnv) ?? { ref: p.apiKeyEnv, configured: false, source: 'none' }
    }))
  }

  ipcMain.handle('app:info', async (): Promise<AppInfo> => {
    const cfg = await loadConfig()
    const paths = configPaths()
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      userData: app.getPath('userData'),
      configDir: paths.configDir,
      configFile: paths.configFile,
      credentialsFile: paths.credentialsFile,
      pondRoot: cfg.pondRoot,
      credentials: await describeAll(cfg.providers.map((p) => p.apiKeyEnv)),
      bundledPluginsDir: bundledPluginsDir()
    }
  })

  ipcMain.handle('app:openPath', async (_e, p: string) => shell.openPath(p))
  ipcMain.handle('app:encryption', () => encryptionAvailable())
  ipcMain.handle('app:pickFolder', async (_e, opts: { title?: string; defaultPath?: string } = {}) => {
    const res = await dialog.showOpenDialog({
      title: opts.title ?? '选择文件夹',
      defaultPath: opts.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // ---- 配置（v2：config.yaml + .credentials.yaml）----
  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => saveConfig(patch))
  ipcMain.handle('config:providers', () => providerViews())
  ipcMain.handle('config:paths', () => configPaths())
  ipcMain.handle('config:open', async (_e, kind: 'config' | 'credentials' = 'config') => {
    const file = kind === 'credentials' ? credentialsFile() : configFile()
    if (kind === 'credentials' && !(await pathExists(file))) await ensureCredentialsFile()
    return shell.openPath(file)
  })

  ipcMain.handle('credentials:set', async (_e, ref: string, value: string) => {
    await setCredential(ref, value)
    return providerViews()
  })
  ipcMain.handle('credentials:remove', async (_e, ref: string) => {
    await removeCredential(ref)
    return providerViews()
  })
  ipcMain.handle('credentials:describe', (_e, ref: string) => describeAll([ref]).then((x) => x[0]))
  ipcMain.handle('credentials:importDsh', async (): Promise<DshImportResult> => importFromDsh())

  ipcMain.handle('providers:test', async (_e, providerId: string) => {
    const cfg = await loadConfig()
    const provider = cfg.providers.find((p) => p.id === providerId)
    if (!provider) return { ok: false, detail: '找不到这个 provider' }
    const cred = await resolveCredential(provider.apiKeyEnv)
    if (!cred && !/localhost|127\.0\.0\.1/i.test(provider.baseUrl)) {
      return { ok: false, detail: `没有找到密钥 ${provider.apiKeyEnv}（.credentials.yaml 或同名环境变量）` }
    }
    const ep = {
      providerId: provider.id,
      providerName: provider.name,
      mode: cfg.mode,
      baseUrl: provider.baseUrl,
      apiKey: cred?.value ?? '',
      apiKeyEnv: provider.apiKeyEnv,
      apiKeySource: cred?.source ?? 'none',
      model: provider.models[0] ?? 'gpt-3.5-turbo',
      temperature: 0,
      maxTokens: 8,
      timeoutMs: 30_000,
      reasoning: false,
      ...(provider.headers ? { headers: provider.headers } : {})
    } as const
    return testConnection(ep)
  })

  ipcMain.handle('config:test', async (_e, target: 'text' | 'vision' | 'image' = 'text') => {
    const cfg = await loadConfig()
    if (cfg.mode === 'mock') return { ok: true, detail: '当前是排练模式，不需要联网' }
    if (target === 'image') {
      const ep = await resolveImageEndpoint(cfg)
      if (!ep) return { ok: false, detail: '生图路由没有启用（或没有可用 provider）' }
      if (!ep.baseUrl) return { ok: false, detail: '生图 provider 的接口地址为空' }
      if (!ep.model) return { ok: false, detail: '生图路由还没有选模型' }
      try {
        const img = await generateImage(ep, 'a cute blue whale girl eating rice, chibi')
        return { ok: true, detail: `生图接口正常，收到 ${Math.round(img.buffer.byteLength / 1024)} KB` }
      } catch (e) {
        return { ok: false, detail: (e as Error).message }
      }
    }
    const ep = target === 'vision' ? await resolveVisionEndpoint(cfg) : await resolveTextEndpoint(cfg)
    if (!ep) return { ok: false, detail: '视觉路由没有启用（或没有可用 provider）' }
    if (!ep.baseUrl) return { ok: false, detail: '接口地址为空' }
    if (!ep.model) return { ok: false, detail: '还没有选模型' }
    if (ep.apiKeySource === 'none' && !/localhost|127\.0\.0\.1/i.test(ep.baseUrl)) {
      return { ok: false, detail: `没有找到密钥 ${ep.apiKeyEnv}（.credentials.yaml 或同名环境变量）` }
    }
    return testConnection(ep)
  })

  // ---- 鱼塘 ----
  ipcMain.handle('pond:open', () => openPond())
  ipcMain.handle('pond:choose', async () => {
    const cfg = await loadConfig()
    const res = await dialog.showOpenDialog({
      title: '选择鱼塘位置（所有肥鱼都住在这里）',
      defaultPath: cfg.pondRoot,
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('pond:migrate', async (_e, newRoot: string) => {
    const cfg = await loadConfig()
    const oldRoot = cfg.pondRoot
    if (!newRoot || newRoot === oldRoot) return cfg
    await ensureDir(newRoot)
    let names: string[] = []
    try {
      names = await fs.readdir(oldRoot)
    } catch {
      names = []
    }
    for (const name of names) {
      const src = join(oldRoot, name)
      const dst = join(newRoot, name)
      if (!(await pathExists(join(src, 'fish.json')))) continue
      if (await pathExists(dst)) continue
      await fs.cp(src, dst, { recursive: true })
    }
    return saveConfig({ pondRoot: newRoot })
  })

  // ---- 肥鱼 ----
  ipcMain.handle('fish:list', async () => {
    const cfg = await loadConfig()
    await ensureDir(cfg.pondRoot)
    const list = await listFish(cfg.pondRoot)
    const out = []
    for (const fish of list) {
      const decayed = await applyDecay(cfg.pondRoot, fish)
      out.push({ ...fish, stats: decayed.stats, bytes: fish.bytes })
    }
    return out
  })
  ipcMain.handle('fish:create', async (_e, opts: { name: string; hue?: number; tagline?: string; seed?: number }) => {
    const cfg = await loadConfig()
    await ensureDir(cfg.pondRoot)
    const profile = await createFish(cfg.pondRoot, opts.name, opts)
    return profile
  })
  ipcMain.handle('fish:update', async (_e, args: { fishId: string; patch: Partial<FishProfile> }) => {
    const cfg = await loadConfig()
    const profile = await readProfile(cfg.pondRoot, args.fishId)
    if (!profile) throw new Error('找不到这只肥鱼')
    const next: FishProfile = { ...profile, ...args.patch, id: profile.id }
    invalidateProfile(args.fishId)
    await writeProfile(cfg.pondRoot, next)
    return next
  })
  ipcMain.handle('fish:delete', async (_e, fishId: string) => {
    const cfg = await loadConfig()
    await flushProfiles()
    invalidateProfile(fishId)
    await deleteFish(cfg.pondRoot, fishId)
    return true
  })
  ipcMain.handle('fish:reveal', async (_e, fishId: string) => {
    const cfg = await loadConfig()
    const dir = fishDir(cfg.pondRoot, fishId)
    await ensureDir(dir)
    return shell.openPath(dir)
  })
  ipcMain.handle('fish:feed', async (_e, fishId: string) => {
    const cfg = await loadConfig()
    const gain = 120 + Math.round(Math.random() * 180)
    return patchStats(cfg.pondRoot, fishId, (p) => {
      p.stats.meals += 1
      p.stats.tokens += gain
      p.stats.hunger = Math.max(0, p.stats.hunger - 28)
      p.stats.mood = Math.min(100, p.stats.mood + 9)
      p.stats.exp += 5
      p.stats.level = levelFromExp(p.stats.exp)
    })
  })
  ipcMain.handle('fish:stats', async (_e, fishId: string) => {
    const cfg = await loadConfig()
    const p = await cachedProfile(cfg.pondRoot, fishId)
    return p ? applyDecay(cfg.pondRoot, p) : null
  })

  // ---- 会话 ----
  ipcMain.handle('chat:list', async (_e, fishId: string) => {
    const root = await pondRoot()
    return listChatMetas(root, fishId)
  })
  ipcMain.handle('chat:create', async (_e, fishId: string, title?: string) => {
    const root = await pondRoot()
    return createChat(root, fishId, title)
  })
  ipcMain.handle('chat:read', async (_e, fishId: string, chatId: string) => {
    const root = await pondRoot()
    return readChat(root, fishId, chatId)
  })
  ipcMain.handle('chat:rename', async (_e, fishId: string, chatId: string, title: string) => {
    const root = await pondRoot()
    await renameChat(root, fishId, chatId, title)
    return true
  })
  ipcMain.handle('chat:delete', async (_e, fishId: string, chatId: string) => {
    const root = await pondRoot()
    await deleteChat(root, fishId, chatId)
    return true
  })
  ipcMain.handle('chat:send', async (_e, input: SendInput) => {
    void runTurn(input).catch((e) => {
      stream({
        kind: 'error',
        fishId: input.fishId,
        chatId: input.chatId,
        msgId: input.assistantMsgId,
        error: (e as Error).message
      })
    })
    return { ok: true }
  })
  ipcMain.handle('chat:greet', async (_e, fishId: string, chatId: string) => {
    void greet(fishId, chatId)
    return { ok: true }
  })
  ipcMain.handle('chat:abort', (_e, chatId: string) => {
    inflight.get(chatId)?.abort()
    return true
  })
  ipcMain.handle('chat:locate', async (_e, fishId: string, msgId: string) => {
    const root = await pondRoot()
    const metas = await listChatMetas(root, fishId)
    for (const meta of metas) {
      const chat = await readChat(root, fishId, meta.id)
      if (chat?.msgs.some((m) => m.id === msgId)) return { chatId: meta.id, title: meta.title }
    }
    return null
  })

  // ---- 素材 ----
  ipcMain.handle('media:pick', async (_e, fishId: string) => {
    const root = await pondRoot()
    const cfg = await loadConfig()
    const res = await dialog.showOpenDialog({
      title: '选择要发给肥鱼的图片',
      defaultPath: cfg.pondRoot,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    })
    if (res.canceled) return []
    return importPaths(root, fishId, res.filePaths)
  })
  ipcMain.handle('media:upload', async (_e, fishId: string, payload: { name: string; base64: string }) => {
    const root = await pondRoot()
    const buf = Buffer.from(payload.base64, 'base64')
    if (buf.byteLength > 24 * 1024 * 1024) throw new Error('图片太大了（上限 24MB）')
    return importBuffer(root, fishId, buf, payload.name || 'pasted.png')
  })
  ipcMain.handle('media:list', async (_e, fishId: string) => {
    const root = await pondRoot()
    return allMedia(root, fishId)
  })
  ipcMain.handle('media:url', (_e, fishId: string, mediaId: string, variant: 'thumb' | 'src' = 'thumb') =>
    mediaUrl(fishId, mediaId, variant)
  )
  ipcMain.handle('media:caption', async (_e, fishId: string, mediaId: string) => {
    const cfg = await loadConfig()
    const ep = await resolveVisionEndpoint(cfg)
    if (cfg.mode !== 'api' || !ep) throw new Error('没有启用视觉模型')
    const root = await pondRoot()
    const url = await toDataUrl(root, fishId, mediaId)
    if (!url) throw new Error('读不到这张图')
    const cap = await captionImage(ep, url, '')
    await setCaption(root, fishId, mediaId, cap)
    return cap
  })

  // ---- 贴纸包 / 缺表情 ----
  ipcMain.handle('stickers:list', () => listStickerState())
  ipcMain.handle('stickers:import', (_e, kind: 'zip' | 'folder') => importStickerPack(kind))
  ipcMain.handle('stickers:remove', async (_e, packId: string) => {
    await removeStickerPack(packId)
    return listStickerState()
  })
  ipcMain.handle('stickers:clearWishes', async () => {
    await clearStickerWishes()
    return listStickerState()
  })
  ipcMain.handle('stickers:exportWishes', () => exportStickerWishes())
  ipcMain.handle('stickers:openDir', async () => shell.openPath(await ensureStickerDir()))

  // ---- 记忆 ----
  ipcMain.handle('memory:list', async (_e, fishId: string) => {
    const root = await pondRoot()
    const cards = await loadCards(root, fishId)
    return { cards: cards.sort((a, b) => b.t - a.t), stats: await memoryStats(root, fishId) }
  })
  ipcMain.handle('memory:search', async (_e, fishId: string, q: string) => {
    const root = await pondRoot()
    return searchCards(root, fishId, q)
  })
  ipcMain.handle('memory:stats', async (_e, fishId: string) => {
    const root = await pondRoot()
    return { ...(await memoryStats(root, fishId)), dirBytes: await memoryDirSize(root, fishId) }
  })
  ipcMain.handle('memory:recall', async (_e, fishId: string, q: string, k?: number) => {
    const root = await pondRoot()
    return recall(root, fishId, q, { k })
  })
  ipcMain.handle('memory:distill', async (_e, fishId: string, chatId: string, force = true) => {
    await runDistill(fishId, chatId, force)
    return memoryStats(await pondRoot(), fishId)
  })
  ipcMain.handle('memory:compact', async (_e, fishId: string) => {
    const cfg = await loadConfig()
    const root = cfg.pondRoot
    const before = await memoryStats(root, fishId)
    const merged = await compact(root, fishId, {
      maxCards: 0,
      llm: cfg.mode === 'api' ? await llmFor(cfg) : undefined
    })
    const after = await memoryStats(root, fishId)
    return { merged, before, after }
  })
  ipcMain.handle('memory:pin', async (_e, fishId: string, cardId: string, pin: boolean) => {
    const root = await pondRoot()
    await pinCard(root, fishId, cardId, pin)
    return true
  })
  ipcMain.handle('memory:delete', async (_e, fishId: string, cardId: string) => {
    const root = await pondRoot()
    await deleteCard(root, fishId, cardId)
    return true
  })

  // ---- 导入导出 ----
  ipcMain.handle('io:exportFish', async (_e, fishId: string) => {
    const cfg = await loadConfig()
    const profile = await readProfile(cfg.pondRoot, fishId)
    const res = await dialog.showSaveDialog({
      title: '导出整只肥鱼',
      defaultPath: `${profile?.name ?? '肥鱼'}-${new Date().toISOString().slice(0, 10)}.fatfish`,
      filters: [{ name: '肥鱼档案', extensions: ['fatfish'] }]
    })
    if (res.canceled || !res.filePath) return null
    const bytes = await exportFish(cfg.pondRoot, fishId, res.filePath)
    return { path: res.filePath, bytes }
  })
  ipcMain.handle('io:exportMemory', async (_e, fishId: string) => {
    const cfg = await loadConfig()
    const profile = await readProfile(cfg.pondRoot, fishId)
    const res = await dialog.showSaveDialog({
      title: '导出记忆包',
      defaultPath: `${profile?.name ?? '肥鱼'}-记忆-${new Date().toISOString().slice(0, 10)}.fatmem`,
      filters: [{ name: '记忆包', extensions: ['fatmem'] }]
    })
    if (res.canceled || !res.filePath) return null
    const bytes = await exportMemory(cfg.pondRoot, fishId, res.filePath)
    return { path: res.filePath, bytes }
  })
  ipcMain.handle('io:import', async (_e, targetFishId?: string): Promise<ImportResult | null> => {
    const cfg = await loadConfig()
    const res = await dialog.showOpenDialog({
      title: '导入肥鱼或记忆包',
      properties: ['openFile'],
      filters: [{ name: '肥鱼档案 / 记忆包', extensions: ['fatfish', 'fatmem', 'gz', 'json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return importBundle(cfg.pondRoot, res.filePaths[0], targetFishId)
  })

  // ---- 插件 ----
  ipcMain.handle('plugins:list', () => listPlugins())
  ipcMain.handle('plugins:reload', () => reloadPlugins())
  ipcMain.handle('plugins:invoke', (_e, pluginId: string, commandId: string, payload?: unknown) =>
    invokePlugin(pluginId, commandId, payload)
  )
  ipcMain.handle('plugins:toggle', (_e, pluginId: string, enabled: boolean) => togglePlugin(pluginId, enabled))
  ipcMain.handle('plugins:dir', async (_e, kind: 'bundled' | 'user' = 'user') => {
    const dir = kind === 'bundled' ? bundledPluginsDir() : join(app.getPath('userData'), 'plugins')
    await ensureDir(dir)
    return dir
  })

  // ---- 统计（设置页展示体积） ----
  ipcMain.handle('stats:pond', async () => {
    const cfg = await loadConfig()
    return { bytes: await dirSize(cfg.pondRoot), root: cfg.pondRoot }
  })

  // ---- 截图模式：渲染端渲染完成后通知主进程抓图 ----
  ipcMain.handle('shot:ready', async () => {
    if (!SHOT_PATH || !mainWindow) return false
    await new Promise((r) => setTimeout(r, 900))
    const scene = process.env.FATFISH_SCENE

    // 等聊天真正画出来（首次冷启动/打包后可能比 ready 慢半拍）
    if (scene === '' || scene === 'send') {
      for (let i = 0; i < 40; i++) {
        const ready = await mainWindow.webContents.executeJavaScript(
          `(() => {
             const ms = document.querySelectorAll('.msg');
             const last = document.querySelector('.msg:last-child .bubble');
             return ms.length > 0 && (!last || (last.innerText || '').trim().length > 0);
           })()`
        )
        if (ready) break
        await new Promise((r) => setTimeout(r, 250))
      }
      if (scene === 'send') await new Promise((r) => setTimeout(r, 1600))
    }

    if (scene === 'cite') {      // 截图不能靠人手点：这里直接在渲染端触发一次引用徽章的点击
      const hit = await mainWindow.webContents.executeJavaScript(
        `(async () => {
           const el = document.querySelector('.cite');
           if (!el) return { found: false };
           el.click();
           await new Promise((r) => setTimeout(r, 500));
           const pop = document.querySelector('.cite-pop');
           if (!pop) return { found: true, pop: false };
           const r = pop.getBoundingClientRect();
           const cs = getComputedStyle(pop);
           const topEl = document.elementFromPoint(Math.min(window.innerWidth - 1, r.x + r.width / 2), Math.min(window.innerHeight - 1, r.y + r.height / 2));
           return {
             found: true, pop: true,
             rect: { x: r.x, y: r.y, w: r.width, h: r.height },
             style: { position: cs.position, z: cs.zIndex, opacity: cs.opacity, visibility: cs.visibility, transform: cs.transform },
             topEl: topEl ? (topEl.className || topEl.tagName) : null
           };
         })()`
      )
      console.log('[shot] cite click =', JSON.stringify(hit))
      await new Promise((r) => setTimeout(r, 400))
    }
    const dom = await mainWindow.webContents.executeJavaScript(
      `(() => {
         const ms = [...document.querySelectorAll('.msg')];
         const first = ms[0];
         const b = document.querySelector('.msg .bubble');
         const rt = b ? b.querySelector('.rt') : null;
         const det = document.querySelector('details.reason');
         const inner = det ? det.querySelector('.inner') : null;
         return {
           count: ms.length,
           first: first ? { h: first.getBoundingClientRect().height, opacity: getComputedStyle(first).opacity } : null,
           bubble: b ? { h: b.getBoundingClientRect().height, ws: getComputedStyle(b).whiteSpace } : null,
           rt: rt ? { h: rt.getBoundingClientRect().height, ps: rt.querySelectorAll('p').length } : null,
           reason: det ? {
             open: det.open,
             h: det.getBoundingClientRect().height,
             innerH: inner ? inner.getBoundingClientRect().height : null,
             text: (inner?.textContent ?? '').slice(0, 60)
           } : null
         };
       })()`
    )
    console.log('[shot] dom =', JSON.stringify(dom))
    const image = await mainWindow.webContents.capturePage()
    await fs.writeFile(SHOT_PATH, image.toPNG())
    setTimeout(() => app.quit(), 300)
    return true
  })
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

/**
 * 端到端自检（开发用）：在真实 Electron 运行时里跑一遍数据层，
 * 覆盖「建鱼 → 聊天落盘 → 启发式蒸馏 → 检索 → 导出 → 导入 → 体积」。
 * 由 scripts/selftest.mjs 通过 FATFISH_SELFTEST 触发，不参与正常启动。
 */
async function runSelfTest(reportPath: string): Promise<void> {
  const cfg = await loadConfig()
  const root = cfg.pondRoot
  const report: { name: string; ok: boolean; detail?: unknown; error?: string }[] = []
  const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      report.push({ name, ok: true, detail: await fn() })
    } catch (e) {
      report.push({ name, ok: false, error: (e as Error).message })
    }
  }

  let fishId = ''
  let chatId = ''
  await step('config v2 (config.yaml + credentials)', async () => {
    const cfg = await loadConfig()
    const paths = configPaths()
    if (!(await pathExists(paths.configFile))) throw new Error('没有生成 config.yaml')
    if (!cfg.providers.length) throw new Error('providers 为空')
    if (!cfg.routes.text.providerId) throw new Error('routes.text 为空')
    return {
      configFile: paths.configFile,
      credentialsFile: paths.credentialsFile,
      version: cfg.v,
      mode: cfg.mode,
      providers: cfg.providers.map((p) => ({ id: p.id, apiKeyEnv: p.apiKeyEnv, baseUrl: p.baseUrl })),
      textRoute: cfg.routes.text
    }
  })
  await step('credential: store + env fallback', async () => {
    const envRef = 'FATFISH_SELFTEST_ENV_KEY'
    process.env[envRef] = 'env-value'
    const envDesc = (await describeAll([envRef]))[0]
    if (envDesc.source !== 'env' || !envDesc.configured) throw new Error('环境变量回落失败')

    await setCredential('FATFISH_SELFTEST_STORE_KEY', 'store-value')
    const storeDesc = (await describeAll(['FATFISH_SELFTEST_STORE_KEY']))[0]
    const resolved = await resolveCredential('FATFISH_SELFTEST_STORE_KEY')
    await removeCredential('FATFISH_SELFTEST_STORE_KEY')
    if (storeDesc.source !== 'store' || resolved?.value !== 'store-value') {
      throw new Error('credentials 存储/解析失败')
    }
    delete process.env[envRef]
    return { env: envDesc, store: { ...storeDesc, valueMatched: true } }
  })
  await step('stickers: pack + wishes', async () => {
    const sample = join(process.cwd(), 'examples', 'sticker-pack')
    if (!(await pathExists(join(sample, 'manifest.json')))) throw new Error('示例贴纸包不存在')
    const dest = join(stickersDir(), 'fatfish-sample-pack')
    if (!(await pathExists(dest))) await fs.cp(sample, dest, { recursive: true })
    const state = await listStickerState()
    const pack = state.packs.find((p) => p.id === 'fatfish-sample-pack')
    if (!pack || pack.items.length !== 3) throw new Error('示例贴纸包没有被识别')
    const file = await resolveStickerFile('fatfish-sample-pack', 'sample-happy.png')
    if (!file) throw new Error('贴纸协议路径解析失败')
    await recordStickerWish('pout', 'selftest: 缺一个鼓嘴表情')
    const wishes = (await listStickerState()).wishes
    if (!wishes.some((w) => w.key === 'pout')) throw new Error('缺表情没有被记录')
    await clearStickerWishes()
    return { packs: state.packs.length, items: pack.items.length, file: file.replace(/\\/g, '/').split('/').slice(-2).join('/'), wishes: wishes.map((w) => w.key) }
  })
  await step('create fish', async () => {
    const fish = await createFish(root, '测试肥鱼')
    fishId = fish.id
    return { fishId: fish.id, name: fish.name }
  })
  await step('create chat + append messages', async () => {
    const chat = await createChat(root, fishId, '自检对话')
    chatId = chat.id
    const lines: [('u' | 'a'), string][] = [
      ['u', '我叫小明，在准备物理实验报告。'],
      ['a', '记住啦，小明。'],
      ['u', '我喜欢喝冰美式，最讨厌香菜。'],
      ['a', '冰美式！香菜的仇我记下了。'],
      ['u', '明天我要去实验室，记得提醒我带 U 盘。'],
      ['a', '好，明天提醒你。'],
      ['u', '今天好累，不过看到你就好多了。'],
      ['a', '那我不吵你，就在这儿游着。']
    ]
    for (const [role, text] of lines) {
      await appendMessage(root, fishId, chatId, newMessage(role, text))
    }
    return { messages: lines.length }
  })
  await step('heuristic distill', async () => {
    const res = await distill({
      root,
      fishId,
      chatId,
      every: 6,
      maxCards: 400,
      force: true
    })
    const stats = await memoryStats(root, fishId)
    if (res.added < 1) throw new Error('没有产生任何记忆卡片')
    return { ...res, stats }
  })
  await step('recall', async () => {
    const hits = await recall(root, fishId, '你还记得我喜欢喝什么吗？', { k: 4 })
    if (!hits.length) throw new Error('检索不到任何记忆')
    return hits.map((h) => ({ anchor: h.anchor, score: h.score, text: h.card.text.slice(0, 60) }))
  })
  await step('export fish', async () => {
    const file = join(app.getPath('temp'), `fatfish-selftest-${Date.now()}.fatfish`)
    const bytes = await exportFish(root, fishId, file)
    if (bytes < 100) throw new Error('导出文件过小')
    return { file, bytes }
  })
  await step('import fish', async () => {
    const dir = join(app.getPath('temp'), 'fatfish-selftest-import')
    await ensureDir(dir)
    const files = await fs.readdir(app.getPath('temp'))
    const latest = files.filter((f) => f.startsWith('fatfish-selftest-') && f.endsWith('.fatfish')).sort().pop()
    if (!latest) throw new Error('找不到刚导出的文件')
    const res = await importBundle(root, join(app.getPath('temp'), latest))
    const cards = await loadCards(root, res.fishId)
    if (!cards.length) throw new Error('导入后没有记忆卡片')
    return { ...res, cards: cards.length }
  })
  await step('memory size', async () => {
    const stats = await memoryStats(root, fishId)
    const dirBytes = await memoryDirSize(root, fishId)
    if (!stats.cards) throw new Error('记忆卡片为 0')
    return { stats, dirBytes }
  })

  await writeJSON(reportPath, { ok: report.every((r) => r.ok), report }, true)
}

void app.whenReady().then(async () => {
  await ensureDir((await loadConfig()).pondRoot)
  registerMediaProtocol(async (fishId, mediaId, variant) =>
    resolveFile((await loadConfig()).pondRoot, fishId, mediaId, variant)
  )
  registerPluginProtocol()
  registerStickerProtocol()
  setPluginEmitter((pluginId, type, payload) => emit('ev:plugin', { pluginId, type, payload }))
  await reloadPlugins()

  if (process.env.FATFISH_SELFTEST) {
    await runSelfTest(process.env.FATFISH_SELFTEST)
    app.quit()
    return
  }

  registerIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void flushProfiles().finally(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})

app.on('before-quit', () => {
  void flushProfiles()
})
