/**
 * 项目内临时目录工具（规则 18）。
 *
 * 所有演示/截图/自检数据只能落在 <项目>/.tmp 下，绝不能再写盘根或系统 TEMP。
 * 调用方在 finally 里调用 cleanWorkDir(kind)，保证失败也清理。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const tmpRoot = join(projectRoot, '.tmp')

export function newWorkDir(kind, prefix) {
  const root = join(tmpRoot, kind)
  mkdirSync(root, { recursive: true })
  return mkdtempSync(join(root, prefix))
}

export function cleanWorkDir(kind) {
  rmSync(join(tmpRoot, kind), { recursive: true, force: true })
}
