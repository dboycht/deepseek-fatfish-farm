/**
 * 主进程 / 渲染进程共享的数据契约。
 *
 * 存储侧约定：磁盘上的 JSON 一律使用短键名 + gzip，以把「记忆体积」压到最小；
 * 内存与 IPC 上使用可读的长键名。这里的类型描述 IPC 形态，
 * 磁盘形态见 src/main/store/*.ts 内部的 Disk* 类型。
 */

export type Role = 'u' | 'a' | 's'

/** 一条图片/贴纸素材的元数据（媒体索引项） */
export interface MediaMeta {
  id: string
  name: string
  /** 图片格式，不含点；贴纸为 'svg' */
  ext: string
  bytes: number
  w: number
  h: number
  /** 缩略图文件名（媒体目录内） */
  thumb?: string
  /** 视觉模型给出的英文压缩描述，用于记忆与检索 */
  caption?: string
  captionAt?: number
  kind: 'pic' | 'sticker'
  created: number
  /** 原始分辨率文件名（可能为空，表示只留了压缩版） */
  src?: string
}

export interface ChatMessage {
  id: string
  role: Role
  /** epoch ms */
  t: number
  text: string
  /** 引用到的媒体 id */
  imgs?: string[]
  /** 引用到的记忆卡片 id */
  cite?: string[]
  /** 内心 OS（DeepSeek reasoner 的 reasoning_content） */
  reason?: string
  /** token 用量 */
  tok?: { i: number; o: number }
  /** 贴纸情绪名（对应内置 SVG 贴纸） */
  sticker?: string
  err?: string
  /** 发送这条消息时的肥鱼状态快照，用于回溯 */
  mood?: string
}

export interface ChatMeta {
  id: string
  title: string
  created: number
  updated: number
  count: number
}

export interface ChatFile extends ChatMeta {
  msgs: ChatMessage[]
}

export type MemoryKind = 'fact' | 'event' | 'pref' | 'person' | 'promise' | 'mood'

/** 压缩记忆卡片：英文短句，体积最小化 */
export interface MemoryCard {
  id: string
  /** 事情发生/被记住的时间 */
  t: number
  kind: MemoryKind
  /** 英文压缩描述（<= 200 字符） */
  text: string
  tags: string[]
  /** 来源消息 id，用于「引用回链」 */
  src: string[]
  /** 关联图片 id */
  img?: string[]
  /** 重要度 0..9 */
  salience: number
  /** 被回忆次数 */
  hit: number
  /** 最近一次被回忆的时间 */
  last?: number
  /** 归档卡（由多张旧卡压缩而来） */
  arch?: boolean
  /** 用户钉选 */
  pin?: boolean
}

export interface MemoryStats {
  cards: number
  archived: number
  bytes: number
  approxTokens: number
  lastDistill?: number
}

/** 每只肥鱼的「独一无二」风味（由 seed 决定，创建后稳定） */
export interface FishFlavor {
  /** 口头禅 */
  phrase: string
  /** 最爱的下饭菜 */
  food: string
  /** 小怪癖 */
  quirk: string
  /** 自称 */
  nick: string
}

export interface FishPersona {
  /** 0..100 */
  appetite: number
  clingy: number
  tsundere: number
  mischief: number
  laziness: number
  sleepy: number
}

export interface FishStats {
  /** 心情 0..100 */
  mood: number
  /** 饥饿 0..100，越高越饿 */
  hunger: number
  /** 累计吃掉的 token */
  tokens: number
  /** 喂饭次数 */
  meals: number
  /** 对话条数 */
  chats: number
  /** 记忆卡片数 */
  memories: number
  level: number
  exp: number
  lastSeen: number
}

export interface FishProfile {
  v: number
  id: string
  name: string
  tagline: string
  created: number
  updated: number
  /** 角色主色相 0..360 */
  hue: number
  seed: number
  flavor: FishFlavor
  persona: FishPersona
  stats: FishStats
  /** 用户可写的「饲养备注」 */
  note?: string
}

export interface FishSummary extends FishProfile {
  dir: string
  bytes: number
  chats: number
  lastChat?: { id: string; title: string; updated: number }
}

export interface ProviderConfig {
  /** api = 真实接口；mock = 本地排练模式（不联网） */
  mode: 'api' | 'mock'
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  /** 是否请求并展示内心 OS */
  reasoning: boolean
  timeoutMs: number
  vision: { enabled: boolean; baseUrl: string; model: string }
  image: { enabled: boolean; baseUrl: string; model: string; size: string }
}

export interface MemoryConfig {
  /** 自动蒸馏 */
  auto: boolean
  /** 每积累多少条消息蒸馏一次 */
  every: number
  /** 卡片上限，超出后压缩归档 */
  maxCards: number
  /** 每次带进上下文的最大回忆条数 */
  recall: number
  /** 是否允许模型主动生图 */
  allowDraw: boolean
}

export interface UiConfig {
  theme: 'abyss' | 'dawn'
  showReasoning: boolean
  fontSize: number
  animate: boolean
}

export interface AppConfig {
  v: number
  /** 鱼塘根目录：所有肥鱼实例的父目录 */
  pondRoot: string
  onboarded: boolean
  provider: ProviderConfig
  memory: MemoryConfig
  ui: UiConfig
  plugins: { disabled: string[] }
}

export interface Secrets {
  text?: string
  vision?: string
  image?: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  /** 主进程入口（相对插件目录），CommonJS */
  main?: string
  /** 渲染进程面板入口（相对插件目录） */
  panel?: { title: string; entry: string; icon?: string; width?: number }
  /** 需要的能力声明，仅作展示与审计 */
  permissions?: string[]
  /** 由加载器填充 */
  dir?: string
  builtin?: boolean
}

export interface PluginInfo extends PluginManifest {
  enabled: boolean
  loaded: boolean
  error?: string
  commands?: { id: string; title: string }[]
}

export interface AppInfo {
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
  userData: string
  pondRoot: string
  hasSecret: { text: boolean; vision: boolean; image: boolean }
  bundledPluginsDir: string
}

export interface RecallHit {
  card: MemoryCard
  score: number
  /** 引用锚点，如 M1 */
  anchor: string
}

export interface SendInput {
  fishId: string
  chatId: string
  /** 渲染端预生成的 id，便于先乐观渲染再落盘 */
  userMsgId?: string
  assistantMsgId?: string
  text: string
  /** 已导入的媒体 id */
  mediaIds?: string[]
  sticker?: string
  /** 强制回忆（用户点了「回忆一下」） */
  forceRecall?: boolean
}

export interface StreamEvent {
  kind: 'start' | 'delta' | 'reason' | 'image' | 'done' | 'error' | 'stage'
  fishId: string
  chatId: string
  msgId?: string
  text?: string
  /** stage 事件用的人类可读进度，如「在翻记忆…」 */
  stage?: string
  mediaId?: string
  message?: ChatMessage
  error?: string
}

export interface MemoryEvent {
  fishId: string
  state: 'start' | 'done' | 'fail'
  added?: number
  compacted?: number
  stats?: MemoryStats
  error?: string
}

export interface ImportResult {
  fishId: string
  name: string
  mode: 'fish' | 'memory'
}
