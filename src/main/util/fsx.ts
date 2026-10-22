import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

/** 原子写：先写临时文件再 rename，避免断电/崩溃留下半截文件 */
export async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await ensureDir(dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, file)
}

export async function writeJSON(file: string, value: unknown, pretty = false): Promise<void> {
  await writeAtomic(file, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value))
}

export async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** gzip 压缩写（记忆/会话的落盘格式） */
export async function writeGzJSON(file: string, value: unknown): Promise<void> {
  const raw = Buffer.from(JSON.stringify(value), 'utf8')
  const packed = await gzipAsync(raw, { level: 9 })
  await writeAtomic(file, packed)
}

export async function readGzJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    const packed = await fs.readFile(file)
    const raw = await gunzipAsync(packed)
    return JSON.parse(raw.toString('utf8')) as T
  } catch {
    return fallback
  }
}

export async function fileSize(file: string): Promise<number> {
  try {
    const st = await fs.stat(file)
    return st.size
  } catch {
    return 0
  }
}

/** 递归统计目录体积（字节） */
export async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) total += await dirSize(p)
    else total += await fileSize(p)
  }
  return total
}

export async function rmrf(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true })
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
