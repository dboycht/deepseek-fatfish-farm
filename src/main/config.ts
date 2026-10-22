import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import YAML from 'yaml'
import { readJSON, writeAtomic } from './util/fsx'
import { configFile, legacyConfigFile } from './paths'
import { readLegacySecrets, retireLegacySecrets, setCredentialValues } from './credentials'
import {
  defaultConfig,
  isLegacyConfig,
  migrateV1,
  normalizeConfig,
  type LegacyV1Config
} from '@shared/config'
import type { AppConfig } from '@shared/types'

/**
 * 配置（v2）：`config.yaml`。
 *
 * 与 DSH 对齐：
 *  - 人类可读的 YAML，可手改；
 *  - provider 只写 baseUrl + apiKeyEnv（引用名）+ models；
 *  - 真正的密钥在同目录 `.credentials.yaml`；
 *  - 首次启动检测到 v1 的 config.json / secrets.bin 时自动迁移并留档。
 */

export function defaultPondRoot(): string {
  return join(app.getPath('documents'), 'DeepSeek肥鱼养殖场')
}

const CONFIG_HEADER = `# DeepSeek 肥鱼养殖场 · 配置
# 密钥不在这里：providers[].apiKeyEnv 只是引用名，
# 值在同目录 .credentials.yaml 的 refs 下（也可用同名环境变量）。
# 直接改这个文件也可以，保存后下一次请求生效。`

let cache: { cfg: AppConfig; mtime: number } | null = null

async function mtimeOf(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).mtimeMs
  } catch {
    return 0
  }
}

async function writeConfig(cfg: AppConfig): Promise<void> {
  const file = configFile()
  const text = `${CONFIG_HEADER}\n${YAML.stringify(cfg, { lineWidth: 0 })}`
  await writeAtomic(file, text)
  cache = { cfg, mtime: await mtimeOf(file) }
}

async function backupLegacyConfig(): Promise<void> {
  const file = legacyConfigFile()
  try {
    await fs.rename(file, `${file}.v1.bak`)
  } catch {
    /* 不存在就算了 */
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const file = configFile()
  const mtime = await mtimeOf(file)
  if (cache && cache.mtime === mtime) return cache.cfg

  let text = ''
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    text = ''
  }
  if (text.trim()) {
    try {
      const raw = YAML.parse(text)
      const cfg = normalizeConfig(raw, defaultPondRoot())
      cache = { cfg, mtime }
      return cfg
    } catch (e) {
      console.warn('[config] config.yaml 解析失败，尝试旧配置：', (e as Error).message)
    }
  }

  // 旧版 config.json → v2
  const legacy = await readJSON<LegacyV1Config | null>(legacyConfigFile(), null)
  if (legacy && isLegacyConfig(legacy)) {
    const keys = await readLegacySecrets()
    const migrated = migrateV1(legacy, keys, defaultPondRoot())
    if (Object.keys(migrated.credentials).length) await setCredentialValues(migrated.credentials)
    await writeConfig(migrated.config)
    await backupLegacyConfig()
    await retireLegacySecrets()
    console.log(
      `[config] 已把 v1 配置迁移为 v2（providers=${migrated.config.providers.length}）` +
        (migrated.notes.length ? `；${migrated.notes.join('；')}` : '')
    )
    return migrated.config
  }

  const fresh = defaultConfig(defaultPondRoot())
  cache = { cfg: fresh, mtime: 0 }
  return fresh
}

function mergeConfig(current: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const merged: AppConfig = {
    ...current,
    ...patch,
    pondRoot: typeof patch.pondRoot === 'string' && patch.pondRoot.trim() ? patch.pondRoot.trim() : current.pondRoot,
    providers: Array.isArray(patch.providers) ? patch.providers : current.providers,
    routes: {
      text: { ...current.routes.text, ...(patch.routes?.text ?? {}) },
      vision: { ...current.routes.vision, ...(patch.routes?.vision ?? {}) },
      image: { ...current.routes.image, ...(patch.routes?.image ?? {}) }
    },
    memory: { ...current.memory, ...(patch.memory ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) },
    plugins: { ...current.plugins, ...(patch.plugins ?? {}) }
  }
  return normalizeConfig(merged, current.pondRoot)
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig()
  const next = mergeConfig(current, patch)
  await writeConfig(next)
  return next
}

/** 测试/迁移用：强制从磁盘重读 */
export function invalidateConfigCache(): void {
  cache = null
}
