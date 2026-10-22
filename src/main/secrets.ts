import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readJSON, writeJSON } from './util/fsx'
import type { Secrets } from '@shared/types'

/**
 * API Key 落盘策略：
 *  - 系统支持时用 Electron safeStorage（Windows 下走 DPAPI，绑定当前用户）加密；
 *  - 不支持时降级为明文并加 `raw:` 前缀，UI 会给出提示。
 * 任何情况下 key 都不会出现在日志、配置或导出的肥鱼包里。
 */

function secretsFile(): string {
  return join(app.getPath('userData'), 'secrets.bin')
}

type Stored = Partial<Record<keyof Secrets, string>>

let cache: Stored | null = null

async function load(): Promise<Stored> {
  if (!cache) cache = (await readJSON<Stored>(secretsFile(), {})) ?? {}
  return cache
}

function encrypt(value: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(value).toString('base64')}`
    }
  } catch {
    /* 落到明文兜底 */
  }
  return `raw:${Buffer.from(value, 'utf8').toString('base64')}`
}

function decrypt(stored: string): string {
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('raw:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8')
    }
  } catch {
    return ''
  }
  return ''
}

export async function getSecrets(): Promise<Secrets> {
  const stored = await load()
  const out: Secrets = {}
  for (const k of ['text', 'vision', 'image'] as (keyof Secrets)[]) {
    const v = stored[k]
    if (v) out[k] = decrypt(v)
  }
  return out
}

export async function getSecret(key: keyof Secrets): Promise<string> {
  const s = await getSecrets()
  return s[key] ?? ''
}

export async function setSecrets(patch: Secrets): Promise<void> {
  const stored = { ...(await load()) }
  for (const k of ['text', 'vision', 'image'] as (keyof Secrets)[]) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === '') delete stored[k]
    else stored[k] = encrypt(v)
  }
  cache = stored
  await writeJSON(secretsFile(), stored, false)
}

export async function hasSecrets(): Promise<{ text: boolean; vision: boolean; image: boolean }> {
  const stored = await load()
  return {
    text: Boolean(stored.text && decrypt(stored.text)),
    vision: Boolean(stored.vision && decrypt(stored.vision)),
    image: Boolean(stored.image && decrypt(stored.image))
  }
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}
