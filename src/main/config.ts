import { app } from 'electron'
import { join } from 'node:path'
import { readJSON, writeJSON } from './util/fsx'
import type { AppConfig } from '@shared/types'

export function defaultPondRoot(): string {
  return join(app.getPath('documents'), 'DeepSeek肥鱼养殖场')
}

export function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function defaultConfig(): AppConfig {
  return {
    v: 1,
    pondRoot: defaultPondRoot(),
    onboarded: false,
    provider: {
      mode: 'api',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      temperature: 1.1,
      maxTokens: 1600,
      reasoning: false,
      timeoutMs: 180000,
      vision: { enabled: false, baseUrl: 'https://api.deepseek.com', model: '' },
      image: { enabled: false, baseUrl: '', model: '', size: '1024x1024' }
    },
    memory: { auto: true, every: 6, maxCards: 400, recall: 6, allowDraw: false },
    ui: { theme: 'abyss', showReasoning: true, fontSize: 15, animate: true },
    plugins: { disabled: [] }
  }
}

let cache: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  if (cache) return cache
  const raw = await readJSON<Partial<AppConfig>>(configFile(), {})
  const def = defaultConfig()
  cache = {
    ...def,
    ...raw,
    provider: {
      ...def.provider,
      ...(raw.provider ?? {}),
      vision: { ...def.provider.vision, ...(raw.provider?.vision ?? {}) },
      image: { ...def.provider.image, ...(raw.provider?.image ?? {}) }
    },
    memory: { ...def.memory, ...(raw.memory ?? {}) },
    ui: { ...def.ui, ...(raw.ui ?? {}) },
    plugins: { ...def.plugins, ...(raw.plugins ?? {}) }
  }
  return cache
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const cur = await loadConfig()
  const next: AppConfig = {
    ...cur,
    ...patch,
    provider: {
      ...cur.provider,
      ...(patch.provider ?? {}),
      vision: { ...cur.provider.vision, ...(patch.provider?.vision ?? {}) },
      image: { ...cur.provider.image, ...(patch.provider?.image ?? {}) }
    },
    memory: { ...cur.memory, ...(patch.memory ?? {}) },
    ui: { ...cur.ui, ...(patch.ui ?? {}) },
    plugins: { ...cur.plugins, ...(patch.plugins ?? {}) }
  }
  cache = next
  await writeJSON(configFile(), next, true)
  return next
}
