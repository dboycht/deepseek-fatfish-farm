import type {
  AppConfig,
  ImageRoute,
  MemoryConfig,
  ProviderProfile,
  RoutesConfig,
  TextRoute,
  UiConfig,
  VisionRoute
} from './types'

/**
 * 配置的纯函数层（不依赖 Electron，可单测）。
 *
 * 与 DeepSeek Harness 对齐的关键点：
 *  - 配置里只写 `apiKeyEnv`（密钥引用名），绝不写密钥；
 *  - 多 provider，每条 route 自己选 provider + model；
 *  - 旧版 v1 配置可以无损迁移到 v2（密钥由主进程从旧 secrets.bin 里取出来再写进 .credentials.yaml）。
 */

export const CONFIG_VERSION = 2
export const REF_RE = /^[A-Z][A-Z0-9_]{1,63}$/

export function sanitizeRef(input: string | undefined, fallback: string): string {
  let s = (input ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!s) return fallback
  if (!/^[A-Z]/.test(s)) s = `KEY_${s}`
  s = s.slice(0, 64).replace(/_+$/g, '')
  return REF_RE.test(s) ? s : fallback
}

export function sanitizeProviderId(input: string | undefined, fallback: string): string {
  const s = (input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || fallback
}

export function defaultProvider(): ProviderProfile {
  return {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-chat', 'deepseek-reasoner']
  }
}

export function defaultRoutes(providerId = 'deepseek', model = 'deepseek-chat'): RoutesConfig {
  return {
    text: {
      providerId,
      model,
      temperature: 1.1,
      maxTokens: 1600,
      reasoning: false,
      timeoutMs: 180_000
    },
    vision: { enabled: false, providerId, model: '' },
    image: { enabled: false, providerId, model: '', size: '1024x1024' }
  }
}

export function defaultMemory(): MemoryConfig {
  return { auto: true, every: 6, maxCards: 400, recall: 6, allowDraw: false }
}

export function defaultUi(): UiConfig {
  return { theme: 'abyss', showReasoning: true, fontSize: 15, animate: true }
}

export function defaultConfig(pondRoot: string): AppConfig {
  const provider = defaultProvider()
  return {
    v: CONFIG_VERSION,
    pondRoot,
    onboarded: false,
    mode: 'api',
    providers: [provider],
    routes: defaultRoutes(provider.id, provider.models[0]),
    memory: defaultMemory(),
    ui: defaultUi(),
    plugins: { disabled: [] }
  }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

export function normalizeProvider(raw: unknown, index: number): ProviderProfile {
  const o = (raw ?? {}) as Record<string, unknown>
  const fallbackId = index === 0 ? 'deepseek' : `provider-${index + 1}`
  const id = sanitizeProviderId(str(o.id), fallbackId)
  const models = Array.isArray(o.models)
    ? [...new Set(o.models.filter((m): m is string => typeof m === 'string').map((m) => m.trim()).filter(Boolean))]
    : typeof o.model === 'string' && o.model.trim()
      ? [o.model.trim()]
      : []
  const headers: Record<string, string> = {}
  if (o.headers && typeof o.headers === 'object' && !Array.isArray(o.headers)) {
    for (const [k, v] of Object.entries(o.headers)) {
      if (typeof v === 'string') headers[k] = v
    }
  }
  return {
    id,
    name: str(o.name) || (id === 'deepseek' ? 'DeepSeek 官方' : `接口 ${index + 1}`),
    baseUrl: str(o.baseUrl).replace(/\/+$/, ''),
    apiKeyEnv: sanitizeRef(str(o.apiKeyEnv), index === 0 ? 'DEEPSEEK_API_KEY' : `PROVIDER_${index + 1}_API_KEY`),
    models,
    ...(Object.keys(headers).length ? { headers } : {})
  }
}

function normalizeRoutes(raw: unknown, providers: ProviderProfile[]): RoutesConfig {
  const o = (raw ?? {}) as Record<string, unknown>
  const first = providers[0]
  const t = (o.text ?? {}) as Record<string, unknown>
  const v = (o.vision ?? {}) as Record<string, unknown>
  const i = (o.image ?? {}) as Record<string, unknown>

  const pick = (candidate: unknown): ProviderProfile => {
    const id = str(candidate)
    return providers.find((p) => p.id === id) ?? first
  }
  const tProvider = pick(t.providerId)
  const vProvider = pick(v.providerId)
  const iProvider = pick(i.providerId)

  const text: TextRoute = {
    providerId: tProvider.id,
    model: str(t.model) || tProvider.models[0] || '',
    temperature: num(t.temperature, 1.1, 0, 2),
    maxTokens: Math.round(num(t.maxTokens, 1600, 128, 8192)),
    reasoning: bool(t.reasoning, false),
    timeoutMs: Math.round(num(t.timeoutMs, 180_000, 10_000, 600_000))
  }
  const vision: VisionRoute = {
    enabled: bool(v.enabled, false),
    providerId: vProvider.id,
    // 视觉/生图不自动回退到对话模型：留空就是没选，避免误用 chat 模型
    model: str(v.model)
  }
  const image: ImageRoute = {
    enabled: bool(i.enabled, false),
    providerId: iProvider.id,
    model: str(i.model),
    size: str(i.size) || '1024x1024'
  }
  return { text, vision, image }
}

export function normalizeConfig(raw: unknown, fallbackPondRoot = ''): AppConfig {
  if (!raw || typeof raw !== 'object') return defaultConfig(fallbackPondRoot)
  const o = raw as Record<string, unknown>
  const providersRaw = Array.isArray(o.providers) ? o.providers : []
  const providers = providersRaw.map((p, idx) => normalizeProvider(p, idx))
  if (!providers.length) providers.push(defaultProvider())
  // 去重 id（保留第一个）
  const seen = new Set<string>()
  for (let i = providers.length - 1; i >= 0; i--) {
    if (seen.has(providers[i].id)) providers.splice(i, 1)
    else seen.add(providers[i].id)
  }

  const memoryRaw = (o.memory ?? {}) as Record<string, unknown>
  const uiRaw = (o.ui ?? {}) as Record<string, unknown>
  const pluginsRaw = (o.plugins ?? {}) as Record<string, unknown>

  const memory: MemoryConfig = {
    auto: bool(memoryRaw.auto, true),
    every: Math.round(num(memoryRaw.every, 6, 2, 40)),
    maxCards: Math.round(num(memoryRaw.maxCards, 400, 50, 5000)),
    recall: Math.round(num(memoryRaw.recall, 6, 0, 20)),
    allowDraw: bool(memoryRaw.allowDraw, false)
  }
  const ui: UiConfig = {
    theme: uiRaw.theme === 'dawn' ? 'dawn' : 'abyss',
    showReasoning: bool(uiRaw.showReasoning, true),
    fontSize: Math.round(num(uiRaw.fontSize, 15, 13, 18)),
    animate: bool(uiRaw.animate, true)
  }

  return {
    v: CONFIG_VERSION,
    pondRoot: str(o.pondRoot) || fallbackPondRoot,
    onboarded: bool(o.onboarded, false),
    mode: o.mode === 'mock' ? 'mock' : 'api',
    providers,
    routes: normalizeRoutes(o.routes, providers),
    memory,
    ui,
    plugins: {
      disabled: Array.isArray(pluginsRaw.disabled)
        ? pluginsRaw.disabled.filter((x): x is string => typeof x === 'string')
        : []
    }
  }
}

/* ------------------------------------------------------------------ *
 * v1 → v2 迁移
 * ------------------------------------------------------------------ */

export interface LegacyV1Config {
  v?: number
  pondRoot?: string
  onboarded?: boolean
  provider?: {
    mode?: 'api' | 'mock'
    baseUrl?: string
    model?: string
    temperature?: number
    maxTokens?: number
    reasoning?: boolean
    timeoutMs?: number
    vision?: { enabled?: boolean; baseUrl?: string; model?: string }
    image?: { enabled?: boolean; baseUrl?: string; model?: string; size?: string }
  }
  memory?: Partial<MemoryConfig>
  ui?: Partial<UiConfig>
  plugins?: { disabled?: string[] }
}

export interface LegacySecrets {
  text?: string
  vision?: string
  image?: string
}

export interface MigrationResult {
  config: AppConfig
  /** ref -> 明文密钥（主进程负责加密写入 .credentials.yaml） */
  credentials: Record<string, string>
  notes: string[]
}

export function isLegacyConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return !Array.isArray(o.providers) && o.provider !== undefined && typeof o.provider === 'object'
}

/**
 * 旧版配置里 text/vision/image 各自有一套 baseUrl/key。
 * 迁移规则：同 URL 且无独立 key → 复用同一 provider；否则为视觉/生图各建一个 provider + 独立引用名。
 */
export function migrateV1(raw: LegacyV1Config, keys: LegacySecrets, fallbackPondRoot: string): MigrationResult {
  const notes: string[] = []
  const p = raw.provider ?? {}
  const baseUrl = str(p.baseUrl) || 'https://api.deepseek.com'
  const model = str(p.model) || 'deepseek-chat'
  const isDeepSeek = /deepseek/i.test(baseUrl)
  const baseRef = isDeepSeek ? 'DEEPSEEK_API_KEY' : 'CUSTOM_API_KEY'
  const baseProvider: ProviderProfile = {
    id: isDeepSeek ? 'deepseek' : 'custom',
    name: isDeepSeek ? 'DeepSeek 官方' : '自定义接口',
    baseUrl,
    apiKeyEnv: baseRef,
    models: [...new Set([model].filter(Boolean))]
  }
  const providers: ProviderProfile[] = [baseProvider]
  const credentials: Record<string, string> = {}
  if (keys.text) credentials[baseRef] = keys.text

  let visionProviderId = baseProvider.id
  let visionModel = str(p.vision?.model)
  if (p.vision?.enabled) {
    const vUrl = str(p.vision?.baseUrl) || baseUrl
    const sameUrl = vUrl.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, '')
    const sameKey = !keys.vision || keys.vision === keys.text
    if (sameUrl && sameKey) {
      visionProviderId = baseProvider.id
      if (keys.vision && !keys.text) credentials[baseRef] = keys.vision
    } else {
      visionProviderId = 'vision'
      providers.push({
        id: 'vision',
        name: '视觉接口',
        baseUrl: vUrl,
        apiKeyEnv: 'VISION_API_KEY',
        models: [...new Set([visionModel].filter(Boolean))]
      })
      if (keys.vision) credentials.VISION_API_KEY = keys.vision
      else if (keys.text) credentials.VISION_API_KEY = keys.text
      notes.push('视觉接口与对话接口不同，已单独建 provider（VISION_API_KEY）')
    }
  }

  let imageProviderId = baseProvider.id
  let imageModel = str(p.image?.model)
  if (p.image?.enabled) {
    const iUrl = str(p.image?.baseUrl) || baseUrl
    const sameUrl = iUrl.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, '')
    const sameKey = !keys.image || keys.image === keys.text
    if (sameUrl && sameKey) {
      imageProviderId = baseProvider.id
    } else {
      imageProviderId = 'image'
      providers.push({
        id: 'image',
        name: '生图接口',
        baseUrl: iUrl,
        apiKeyEnv: 'IMAGE_API_KEY',
        models: [...new Set([imageModel].filter(Boolean))]
      })
      if (keys.image) credentials.IMAGE_API_KEY = keys.image
      else if (keys.text) credentials.IMAGE_API_KEY = keys.text
      notes.push('生图接口与对话接口不同，已单独建 provider（IMAGE_API_KEY）')
    }
  }

  const config: AppConfig = {
    v: CONFIG_VERSION,
    pondRoot: str(raw.pondRoot) || fallbackPondRoot,
    onboarded: raw.onboarded === true,
    mode: p.mode === 'mock' ? 'mock' : 'api',
    providers,
    routes: {
      text: {
        providerId: baseProvider.id,
        model,
        temperature: num(p.temperature, 1.1, 0, 2),
        maxTokens: Math.round(num(p.maxTokens, 1600, 128, 8192)),
        reasoning: bool(p.reasoning, false),
        timeoutMs: Math.round(num(p.timeoutMs, 180_000, 10_000, 600_000))
      },
      vision: {
        enabled: bool(p.vision?.enabled, false),
        providerId: visionProviderId,
        model: visionModel
      },
      image: {
        enabled: bool(p.image?.enabled, false),
        providerId: imageProviderId,
        model: imageModel,
        size: str(p.image?.size) || '1024x1024'
      }
    },
    memory: { ...defaultMemory(), ...(raw.memory ?? {}) },
    ui: { ...defaultUi(), ...(raw.ui ?? {}) },
    plugins: { disabled: raw.plugins?.disabled ?? [] }
  }
  return { config: normalizeConfig(config, fallbackPondRoot), credentials, notes }
}

/* ------------------------------------------------------------------ *
 * 路由选择
 * ------------------------------------------------------------------ */

export function findProvider(cfg: AppConfig, providerId: string): ProviderProfile | undefined {
  return cfg.providers.find((p) => p.id === providerId)
}

export type RouteKind = 'text' | 'vision' | 'image'

export function routeOf(cfg: AppConfig, kind: RouteKind): TextRoute | VisionRoute | ImageRoute {
  return cfg.routes[kind]
}

export function providerForRoute(cfg: AppConfig, kind: RouteKind): ProviderProfile | undefined {
  const route = cfg.routes[kind]
  return findProvider(cfg, route.providerId) ?? cfg.providers[0]
}

export function modelForRoute(cfg: AppConfig, kind: RouteKind): string {
  const route = cfg.routes[kind]
  const provider = providerForRoute(cfg, kind)
  return route.model || provider?.models[0] || ''
}

export function routeEnabled(cfg: AppConfig, kind: RouteKind): boolean {
  if (kind === 'text') return true
  return cfg.routes[kind].enabled
}
