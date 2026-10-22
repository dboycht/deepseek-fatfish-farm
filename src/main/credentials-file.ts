import YAML from 'yaml'

/**
 * `.credentials.yaml` 的纯文本层（不依赖 Electron，可单测）。
 *
 * 文件形状与 DeepSeek Harness 的 `~/.dsh/.credentials.yaml` 同构：
 *
 * ```yaml
 * version: 1
 * refs:
 *   DEEPSEEK_API_KEY: enc:v1:...   # 本项目用系统 DPAPI 加密；DSH 里通常是明文
 * records: []
 * ```
 *
 * `apiKeyEnv` / `refs` 的键名是「引用名」，不是密钥本身。
 */

export interface CredentialDocument {
  version: number
  refs: Record<string, string>
  records: unknown[]
}

export const CREDENTIALS_HEADER = `# 密钥引用（与 DeepSeek Harness 的 .credentials.yaml 同构）
# refs.<NAME> 被 config.yaml 里的 providers[].apiKeyEnv 引用。
# 本项目默认用系统 DPAPI 加密（enc:v1:...）；若系统不支持则降级为 raw:v1:<base64>。
# 环境变量同名时也会被使用：解析顺序 refs → 进程环境变量。
# 不要把本文件提交到任何仓库。`

export function isCredentialRef(ref: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(ref)
}

export function emptyCredentialDocument(): CredentialDocument {
  return { version: 1, refs: {}, records: [] }
}

export function parseCredentialDocument(text: string): CredentialDocument {
  if (!text.trim()) return emptyCredentialDocument()
  let parsed: unknown
  try {
    parsed = YAML.parse(text)
  } catch {
    return emptyCredentialDocument()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyCredentialDocument()
  const o = parsed as Record<string, unknown>
  const refs: Record<string, string> = {}
  if (o.refs && typeof o.refs === 'object' && !Array.isArray(o.refs)) {
    for (const [key, value] of Object.entries(o.refs)) {
      if (typeof value === 'string' && value.length > 0 && isCredentialRef(key)) refs[key] = value
    }
  }
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    refs,
    records: Array.isArray(o.records) ? o.records : []
  }
}

export function serializeCredentialDocument(doc: CredentialDocument): string {
  const body = YAML.stringify(
    {
      version: doc.version || 1,
      refs: doc.refs,
      records: doc.records ?? []
    },
    { lineWidth: 0 }
  )
  return `${CREDENTIALS_HEADER}\n${body}`
}

export type CredentialValueKind = 'enc' | 'raw' | 'plain'

export function credentialValueKind(stored: string): CredentialValueKind {
  if (stored.startsWith('enc:v1:')) return 'enc'
  if (stored.startsWith('raw:v1:')) return 'raw'
  return 'plain'
}

/** encrypt 返回 base64 密文；返回 null 表示系统不支持加密 */
export function encodeCredentialValue(value: string, encrypt: (plain: string) => string | null): string {
  const enc = encrypt(value)
  if (enc) return `enc:v1:${enc}`
  return `raw:v1:${Buffer.from(value, 'utf8').toString('base64')}`
}

export function decodeCredentialValue(
  stored: string,
  decrypt: (cipher: string) => string | null
): string | null {
  const kind = credentialValueKind(stored)
  try {
    if (kind === 'enc') return decrypt(stored.slice('enc:v1:'.length))
    if (kind === 'raw') return Buffer.from(stored.slice('raw:v1:'.length), 'base64').toString('utf8')
    return stored
  } catch {
    return null
  }
}

export interface ResolvedCredential {
  value: string
  source: 'store' | 'env'
}

/**
 * 解析顺序与 DSH 一致：credentials store → 进程环境变量。
 * storeValue 是已经解密的明文（由主进程负责解密）。
 */
export function resolveCredentialFromSources(
  storeValue: string | null | undefined,
  env: Record<string, string | undefined>,
  ref: string
): ResolvedCredential | undefined {
  if (typeof storeValue === 'string' && storeValue.length > 0) {
    return { value: storeValue, source: 'store' }
  }
  const ambient = env?.[ref]
  if (typeof ambient === 'string' && ambient.length > 0) {
    return { value: ambient, source: 'env' }
  }
  return undefined
}
