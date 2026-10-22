import { promises as fs } from 'node:fs'
import { safeStorage } from 'electron'
import { writeAtomic } from './util/fsx'
import { credentialsFile, dshCredentialsFile, legacySecretsFile } from './paths'
import {
  credentialValueKind,
  decodeCredentialValue,
  encodeCredentialValue,
  emptyCredentialDocument,
  isCredentialRef,
  parseCredentialDocument,
  resolveCredentialFromSources,
  serializeCredentialDocument,
  type CredentialDocument,
  type ResolvedCredential
} from './credentials-file'
import type { CredentialDescriptor, DshImportResult } from '@shared/types'

/**
 * 凭据仓库（DSH 风格的 `.credentials.yaml`）。
 *
 * 解析顺序：refs（本文件）→ 进程环境变量（同名）。
 * 写盘：默认 DPAPI（enc:v1:），系统不支持时降级为 raw:v1:<base64>。
 * 每次读取都会看 mtime，手改文件后下一次请求即生效（与 DSH 一致）。
 */

let cache: { doc: CredentialDocument; mtime: number } | null = null

async function mtimeOf(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).mtimeMs
  } catch {
    return 0
  }
}

async function loadDoc(): Promise<CredentialDocument> {
  const file = credentialsFile()
  const mtime = await mtimeOf(file)
  if (cache && cache.mtime === mtime) return cache.doc
  let text = ''
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    text = ''
  }
  const doc = parseCredentialDocument(text)
  cache = { doc, mtime }
  return doc
}

async function saveDoc(doc: CredentialDocument): Promise<void> {
  const file = credentialsFile()
  await writeAtomic(file, serializeCredentialDocument(doc))
  try {
    await fs.chmod(file, 0o600)
  } catch {
    /* Windows 上可能不支持，忽略 */
  }
  cache = { doc, mtime: await mtimeOf(file) }
}

function encrypt(plain: string): string | null {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    /* 落到 raw */
  }
  return null
}

function decrypt(cipher: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return null
  }
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function resolveCredential(ref: string): Promise<ResolvedCredential | undefined> {
  if (!ref) return undefined
  const doc = await loadDoc()
  const stored = doc.refs[ref]
  const plain = stored ? decodeCredentialValue(stored, decrypt) : null
  return resolveCredentialFromSources(plain, process.env, ref)
}

export async function describeCredential(ref: string): Promise<CredentialDescriptor> {
  const doc = await loadDoc()
  const stored = doc.refs[ref]
  const plain = stored ? decodeCredentialValue(stored, decrypt) : null
  const resolved = resolveCredentialFromSources(plain, process.env, ref)
  const encrypted = stored ? credentialValueKind(stored) === 'enc' : undefined
  return {
    ref,
    configured: Boolean(resolved),
    source: resolved?.source ?? 'none',
    ...(resolved?.source === 'store' && encrypted !== undefined ? { encrypted } : {})
  }
}

export async function describeAll(refs: string[]): Promise<CredentialDescriptor[]> {
  const out: CredentialDescriptor[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    out.push(await describeCredential(ref))
  }
  return out
}

export async function setCredential(ref: string, value: string): Promise<CredentialDescriptor> {
  const name = ref.trim()
  if (!isCredentialRef(name)) {
    throw new Error('引用名必须像 DEEPSEEK_API_KEY 这样（大写字母/数字/下划线）')
  }
  const doc = await loadDoc()
  const v = value.trim()
  if (!v) {
    delete doc.refs[name]
  } else {
    doc.refs[name] = encodeCredentialValue(v, encrypt)
  }
  await saveDoc(doc)
  return describeCredential(name)
}

/** 批量写入（迁移/导入用），只落一次盘 */
export async function setCredentialValues(values: Record<string, string>): Promise<void> {
  const doc = await loadDoc()
  let changed = false
  for (const [ref, value] of Object.entries(values)) {
    if (!isCredentialRef(ref) || !value) continue
    doc.refs[ref] = encodeCredentialValue(value, encrypt)
    changed = true
  }
  if (changed) await saveDoc(doc)
}

export async function removeCredential(ref: string): Promise<void> {
  const doc = await loadDoc()
  if (doc.refs[ref]) {
    delete doc.refs[ref]
    await saveDoc(doc)
  }
}

export async function listCredentialRefs(): Promise<string[]> {
  return Object.keys((await loadDoc()).refs).sort()
}

/** 首次打开/点「打开密钥文件」时确保文件存在 */
export async function ensureCredentialsFile(): Promise<void> {
  const doc = await loadDoc()
  if (!(await mtimeOf(credentialsFile()))) await saveDoc(doc)
}

/** 从 DeepSeek Harness 的 ~/.dsh/.credentials.yaml 导入（只导入本机还没有的引用） */
export async function importFromDsh(): Promise<DshImportResult> {
  const path = dshCredentialsFile()
  let text = ''
  try {
    text = await fs.readFile(path, 'utf8')
  } catch {
    return { path, imported: [], skipped: [], error: '没有找到 DeepSeek Harness 的 .credentials.yaml' }
  }
  const source = parseCredentialDocument(text)
  const doc = await loadDoc()
  const imported: string[] = []
  const skipped: string[] = []
  for (const [ref, value] of Object.entries(source.refs)) {
    if (doc.refs[ref]) {
      skipped.push(ref)
      continue
    }
    if (!value || value.startsWith('enc:')) {
      skipped.push(ref)
      continue
    }
    doc.refs[ref] = encodeCredentialValue(value, encrypt)
    imported.push(ref)
  }
  if (imported.length) await saveDoc(doc)
  return { path, imported, skipped }
}

/** 兼容 v1：从旧的 secrets.bin 读出明文（迁移后由 config.ts 调用，然后退休文件） */
export async function readLegacySecrets(): Promise<{ text?: string; vision?: string; image?: string }> {
  let raw: Record<string, string> = {}
  try {
    const text = await fs.readFile(legacySecretsFile(), 'utf8')
    raw = JSON.parse(text) as Record<string, string>
  } catch {
    return {}
  }
  const out: { text?: string; vision?: string; image?: string } = {}
  for (const key of ['text', 'vision', 'image'] as const) {
    const stored = raw[key]
    if (!stored) continue
    let value = ''
    if (stored.startsWith('enc:')) {
      try {
        value = safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      } catch {
        value = ''
      }
    } else if (stored.startsWith('raw:')) {
      value = Buffer.from(stored.slice(4), 'base64').toString('utf8')
    }
    if (value) out[key] = value
  }
  return out
}

/** 迁移完成后把旧密钥文件改名留档，避免两个来源同时存在 */
export async function retireLegacySecrets(): Promise<void> {
  const file = legacySecretsFile()
  try {
    await fs.rename(file, `${file}.v1.bak`)
  } catch {
    /* 不存在或改名失败都不影响 */
  }
}

export function emptyDoc(): CredentialDocument {
  return emptyCredentialDocument()
}
